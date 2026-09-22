import {
  FieldValue,
  adminDb,
  canPlanShifts,
  cleanText,
  findStoreMember,
  normalizeRole,
  roleLabel,
  timeOk,
} from "./portal-admin.js";

const ROLE_VALUES = new Set(["crew", "crewTrainer", "manager"]);
const DAY_VALUES = new Set(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);

function managerOnly(context) {
  if (!canPlanShifts(context?.profile?.role)) {
    throw Object.assign(new Error("Only Managers can use that McAssist action."), { status: 403 });
  }
  return context.profile;
}

function serialise(value) {
  if (value == null) return value;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (Array.isArray(value)) return value.map(serialise);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, serialise(v)]));
  }
  return value;
}

function cleanRole(value) {
  const raw = String(value || "").trim().toLowerCase().replace(/[\s_-]/g, "");
  if (["crew", "crewmember", "member"].includes(raw)) return "crew";
  if (["crewtrainer", "trainer"].includes(raw)) return "crewTrainer";
  if (["manager", "shiftcreator", "admin"].includes(raw)) return "manager";
  return null;
}

async function memberFor(context, args) {
  const profile = managerOnly(context);
  const member = await findStoreMember(
    profile.storeId,
    args.memberId || args.memberName || args.name,
  );
  if (!member) {
    throw Object.assign(new Error("I could not find that team member in your store."), { status: 404 });
  }
  return member;
}

async function writeAudit({
  actor,
  context,
  action,
  member,
  before = null,
  after = null,
  details = null,
}) {
  try {
    const db = adminDb();
    await db
      .collection("stores")
      .doc(context.profile.storeId)
      .collection("assistantAudit")
      .add({
        action,
        actorId: actor.uid,
        actorName: context.profile.name || "Manager",
        targetUserId: member?.id || null,
        targetUserName: member?.name || null,
        before: serialise(before),
        after: serialise(after),
        details: serialise(details),
        source: "mcassist",
        createdAt: FieldValue.serverTimestamp(),
      });
  } catch (error) {
    console.error("McAssist audit write failed", {
      action,
      message: error?.message,
    });
  }
}

export async function managerLookupMember(user, context, args) {
  const profile = managerOnly(context);
  const member = await memberFor(context, args);
  const db = adminDb();

  const [trainingSnap, shiftsSnap, verificationSnap] = await Promise.all([
    db.collection("users").doc(member.id).collection("portalTraining").limit(100).get(),
    db
      .collection("stores")
      .doc(profile.storeId)
      .collection("Shifts")
      .where("userId", "==", member.id)
      .limit(120)
      .get(),
    db
      .collection("stores")
      .doc(profile.storeId)
      .collection("verifications")
      .where("crewId", "==", member.id)
      .limit(100)
      .get(),
  ]);

  const details = {
    id: member.id,
    name: member.name || "Crew member",
    email: member.email || "",
    role: normalizeRole(member.role),
    roleLabel: roleLabel(member.role),
    storeId: member.storeId || "",
    storeName: member.storeName || "",
    hourlyRate: Number.isFinite(Number(member.hourlyRate)) ? Number(member.hourlyRate) : null,
    stars: Number(member.stars) || 0,
    badge: member.badge || "",
    notes: member.notes || "",
    availability: member.availability || {},
    verifiedStations: Array.isArray(member.verifiedStations) ? member.verifiedStations : [],
    requestedRole: member.requestedRole || "",
    roleRequestStatus: member.roleRequestStatus || "",
    training: Object.fromEntries(
      trainingSnap.docs.map((d) => [d.id, serialise(d.data())]),
    ),
    shifts: shiftsSnap.docs
      .map((d) => ({ id: d.id, ...serialise(d.data()) }))
      .sort((a, b) => String(a.date + a.start).localeCompare(String(b.date + b.start))),
    verifications: verificationSnap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        station: data.station || "",
        status: data.status || "",
        trainerName: data.trainerName || "",
        createdAt: serialise(data.createdAt),
        completedAt: serialise(data.completedAt),
        crewSigned: Boolean(data.crewSignature),
        trainerSigned: Boolean(data.trainerSignature),
      };
    }),
  };

  return {
    reply: "I loaded the current Firestore details for " + details.name + ".",
    data: details,
  };
}

export async function managerSetHourlyRate(user, context, args) {
  const member = await memberFor(context, args);
  const rate = Number(args.hourlyRate);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    throw Object.assign(new Error("Hourly rate must be a number from £0 to £100."), { status: 400 });
  }
  const rounded = Math.round(rate * 100) / 100;
  const db = adminDb();
  await db.collection("users").doc(member.id).set(
    {
      hourlyRate: rounded,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: user.uid,
    },
    { merge: true },
  );
  await writeAudit({
    actor: user,
    context,
    action: "set_hourly_rate",
    member,
    before: { hourlyRate: Number.isFinite(Number(member.hourlyRate)) ? Number(member.hourlyRate) : null },
    after: { hourlyRate: rounded },
  });
  return {
    reply: "Set " + (member.name || "that team member") + "'s hourly rate to £" + rounded.toFixed(2) + ".",
    dataChanged: true,
  };
}

export async function managerSetRole(user, context, args) {
  const member = await memberFor(context, args);
  const role = cleanRole(args.role);
  if (!role || !ROLE_VALUES.has(role)) {
    throw Object.assign(new Error("Role must be Crew Member, Crew Trainer or Manager."), { status: 400 });
  }
  if (member.id === user.uid && role !== "manager") {
    throw Object.assign(
      new Error("McAssist will not demote the signed-in Manager account because that could lock you out. Change your own role manually in Firebase if you really need to."),
      { status: 409 },
    );
  }

  const db = adminDb();
  const userRef = db.collection("users").doc(member.id);
  const requestRef = db.collection("roleRequests").doc(member.id);
  const batch = db.batch();
  batch.set(
    userRef,
    {
      role,
      requestedRole: role,
      roleRequestStatus: "approved",
      roleApprovedBy: user.uid,
      roleApprovedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: user.uid,
    },
    { merge: true },
  );
  batch.set(
    requestRef,
    {
      uid: member.id,
      name: member.name || "Crew member",
      email: member.email || "",
      storeId: context.profile.storeId,
      requestedRole: role,
      status: "approved",
      reviewedBy: user.uid,
      reviewedAt: FieldValue.serverTimestamp(),
      source: "mcassist",
    },
    { merge: true },
  );
  await batch.commit();

  await writeAudit({
    actor: user,
    context,
    action: "set_role",
    member,
    before: { role: normalizeRole(member.role) },
    after: { role },
  });

  return {
    reply: (member.name || "That team member") + " is now " + roleLabel(role) + ".",
    dataChanged: true,
  };
}

export async function managerUpdateProfile(user, context, args) {
  const member = await memberFor(context, args);
  const patch = {};

  if (args.name !== undefined) {
    const name = cleanText(args.name, 100);
    if (!name) throw Object.assign(new Error("Name cannot be empty."), { status: 400 });
    patch.name = name;
  }
  if (args.badge !== undefined) patch.badge = cleanText(args.badge, 80);
  if (args.notes !== undefined) patch.notes = cleanText(args.notes, 1000);
  if (args.storeName !== undefined) patch.storeName = cleanText(args.storeName, 120);

  if (!Object.keys(patch).length) {
    throw Object.assign(new Error("Tell me which profile field you want to change."), { status: 400 });
  }

  const before = Object.fromEntries(Object.keys(patch).map((k) => [k, member[k] ?? null]));
  patch.updatedAt = FieldValue.serverTimestamp();
  patch.updatedBy = user.uid;

  const db = adminDb();
  await db.collection("users").doc(member.id).set(patch, { merge: true });

  const after = Object.fromEntries(
    Object.entries(patch)
      .filter(([k]) => !["updatedAt", "updatedBy"].includes(k)),
  );
  await writeAudit({
    actor: user,
    context,
    action: "update_profile",
    member,
    before,
    after,
  });

  return {
    reply: "Updated " + (member.name || "that team member") + "'s profile.",
    dataChanged: true,
  };
}

export async function managerAdjustStars(user, context, args) {
  const member = await memberFor(context, args);
  const delta = Math.trunc(Number(args.amount));
  if (!Number.isFinite(delta) || delta === 0 || delta < -100 || delta > 100) {
    throw Object.assign(new Error("McStars adjustment must be between -100 and 100, excluding zero."), { status: 400 });
  }

  const db = adminDb();
  const userRef = db.collection("users").doc(member.id);
  let beforeStars = 0;
  let afterStars = 0;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists) throw Object.assign(new Error("Team member no longer exists."), { status: 404 });
    beforeStars = Math.max(0, Number(snap.data().stars) || 0);
    afterStars = Math.max(0, beforeStars + delta);
    tx.set(
      userRef,
      {
        stars: afterStars,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: user.uid,
      },
      { merge: true },
    );
  });

  const note = cleanText(args.note, 240);
  await db
    .collection("stores")
    .doc(context.profile.storeId)
    .collection("recognition")
    .add({
      userId: member.id,
      userName: member.name || "Crew member",
      amount: afterStars - beforeStars,
      note,
      createdBy: user.uid,
      createdAt: FieldValue.serverTimestamp(),
      source: "mcassist",
    });

  await writeAudit({
    actor: user,
    context,
    action: "adjust_mcstars",
    member,
    before: { stars: beforeStars },
    after: { stars: afterStars },
    details: { requestedAdjustment: delta, note },
  });

  return {
    reply:
      (member.name || "That team member") +
      " now has " +
      afterStars +
      " McStar" +
      (afterStars === 1 ? "" : "s") +
      ".",
    dataChanged: true,
  };
}

export async function managerSetAvailability(user, context, args) {
  const member = await memberFor(context, args);
  const day = cleanText(args.day, 12).toLowerCase().slice(0, 3);
  if (!DAY_VALUES.has(day)) {
    throw Object.assign(new Error("Choose a valid day of the week."), { status: 400 });
  }
  const available = args.available !== false;
  if (available && (!timeOk(args.start) || !timeOk(args.end) || args.start === args.end)) {
    throw Object.assign(new Error("Availability needs a valid start and end time."), { status: 400 });
  }

  const availability = { ...(member.availability || {}) };
  const before = availability[day] || null;
  availability[day] = available
    ? { available: true, start: args.start, end: args.end }
    : { available: false, start: "09:00", end: "17:00" };

  const db = adminDb();
  await db.collection("users").doc(member.id).set(
    {
      availability,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: user.uid,
    },
    { merge: true },
  );

  await writeAudit({
    actor: user,
    context,
    action: "set_availability",
    member,
    before: { [day]: before },
    after: { [day]: availability[day] },
  });

  return {
    reply:
      "Updated " +
      (member.name || "that team member") +
      "'s " +
      day.toUpperCase() +
      " availability.",
    dataChanged: true,
  };
}

export async function managerSetTrainingProgress(user, context, args) {
  const member = await memberFor(context, args);
  const moduleId = cleanText(args.moduleId, 100);
  if (!moduleId) throw Object.assign(new Error("Learning module ID is required."), { status: 400 });
  const completed = args.completed === true;

  const db = adminDb();
  const ref = db.collection("users").doc(member.id).collection("portalTraining").doc(moduleId);
  const beforeSnap = await ref.get();
  const before = beforeSnap.exists ? serialise(beforeSnap.data()) : null;

  const update = completed
    ? {
        completed: true,
        completedAt: FieldValue.serverTimestamp(),
        completedBy: user.uid,
        source: "mcassist-manager",
      }
    : {
        completed: false,
        resetAt: FieldValue.serverTimestamp(),
        resetBy: user.uid,
        source: "mcassist-manager",
      };

  await ref.set(update, { merge: true });

  await writeAudit({
    actor: user,
    context,
    action: "set_training_progress",
    member,
    before: { moduleId, progress: before },
    after: { moduleId, completed },
  });

  return {
    reply:
      (member.name || "That team member") +
      "'s " +
      moduleId +
      " module is now marked " +
      (completed ? "completed" : "not completed") +
      ".",
    dataChanged: true,
  };
}

export async function managerReviewRoleRequest(user, context, args) {
  const member = await memberFor(context, args);
  const action = cleanText(args.action, 20).toLowerCase();
  if (!["approve", "reject"].includes(action)) {
    throw Object.assign(new Error("Role request action must be approve or reject."), { status: 400 });
  }

  const db = adminDb();
  const requestRef = db.collection("roleRequests").doc(member.id);
  const requestSnap = await requestRef.get();
  if (!requestSnap.exists) {
    throw Object.assign(new Error((member.name || "That team member") + " does not have a role request."), { status: 404 });
  }
  const request = requestSnap.data();
  if (request.storeId !== context.profile.storeId) {
    throw Object.assign(new Error("That role request belongs to another store."), { status: 403 });
  }

  if (action === "approve") {
    const requestedRole = cleanRole(request.requestedRole);
    if (!requestedRole || !["crewTrainer", "manager"].includes(requestedRole)) {
      throw Object.assign(new Error("That pending role request is invalid."), { status: 400 });
    }
    await managerSetRole(user, context, {
      memberId: member.id,
      role: requestedRole,
    });
    return {
      reply:
        "Approved " +
        (member.name || "that team member") +
        "'s request for " +
        roleLabel(requestedRole) +
        ".",
      dataChanged: true,
    };
  }

  const batch = db.batch();
  batch.set(
    requestRef,
    {
      status: "rejected",
      reviewedBy: user.uid,
      reviewedAt: FieldValue.serverTimestamp(),
      source: "mcassist",
    },
    { merge: true },
  );
  batch.set(
    db.collection("users").doc(member.id),
    {
      requestedRole: "",
      roleRequestStatus: "rejected",
      roleApprovedBy: user.uid,
      roleApprovedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  await batch.commit();

  await writeAudit({
    actor: user,
    context,
    action: "reject_role_request",
    member,
    before: {
      requestedRole: request.requestedRole || "",
      status: request.status || "",
    },
    after: { status: "rejected" },
  });

  return {
    reply: "Rejected " + (member.name || "that team member") + "'s role request.",
    dataChanged: true,
  };
}

export async function managerRevokeStation(user, context, args) {
  const member = await memberFor(context, args);
  const requested = cleanText(args.station, 80);
  if (!requested) throw Object.assign(new Error("Tell me which station to revoke."), { status: 400 });

  const stations = Array.isArray(member.verifiedStations) ? member.verifiedStations : [];
  const station = stations.find((s) => String(s).toLowerCase() === requested.toLowerCase());
  if (!station) {
    throw Object.assign(
      new Error((member.name || "That team member") + " is not currently verified on " + requested + "."),
      { status: 404 },
    );
  }

  const reason = cleanText(args.reason, 300);
  const db = adminDb();
  const userRef = db.collection("users").doc(member.id);
  const verificationsRef = db
    .collection("stores")
    .doc(context.profile.storeId)
    .collection("verifications");
  const snap = await verificationsRef.where("crewId", "==", member.id).limit(100).get();
  const matching = snap.docs.filter((d) => {
    const data = d.data();
    return String(data.station || "").toLowerCase() === station.toLowerCase() && data.status === "verified";
  });

  const batch = db.batch();
  batch.set(
    userRef,
    {
      verifiedStations: FieldValue.arrayRemove(station),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: user.uid,
    },
    { merge: true },
  );
  for (const doc of matching) {
    batch.set(
      doc.ref,
      {
        status: "revoked",
        revokedBy: user.uid,
        revokedAt: FieldValue.serverTimestamp(),
        revokeReason: reason,
      },
      { merge: true },
    );
  }
  await batch.commit();

  await writeAudit({
    actor: user,
    context,
    action: "revoke_station",
    member,
    before: { verifiedStations: stations },
    after: { verifiedStations: stations.filter((s) => s !== station) },
    details: { station, reason },
  });

  return {
    reply:
      "Revoked " +
      (member.name || "that team member") +
      "'s " +
      station +
      " verification" +
      (reason ? " — " + reason : "") +
      ".",
    dataChanged: true,
  };
}

export async function executeManagerTool(user, context, name, args) {
  if (name === "manager_lookup_member") return managerLookupMember(user, context, args);
  if (name === "manager_set_hourly_rate") return managerSetHourlyRate(user, context, args);
  if (name === "manager_set_role") return managerSetRole(user, context, args);
  if (name === "manager_update_profile") return managerUpdateProfile(user, context, args);
  if (name === "manager_adjust_mcstars") return managerAdjustStars(user, context, args);
  if (name === "manager_set_availability") return managerSetAvailability(user, context, args);
  if (name === "manager_set_training_progress") return managerSetTrainingProgress(user, context, args);
  if (name === "manager_review_role_request") return managerReviewRoleRequest(user, context, args);
  if (name === "manager_revoke_station") return managerRevokeStation(user, context, args);
  return null;
}

export function managerToolSchemas() {
  const memberSelector = {
    memberName: { type: "string", description: "Team member name as shown in the store team list." },
    memberId: { type: "string", description: "Optional exact Firebase user ID when known." },
  };

  return [
    {
      type: "function",
      function: {
        name: "manager_lookup_member",
        description:
          "Load a team member's current profile, pay rate, role, availability, learning progress, upcoming shifts and verification summary from Firestore.",
        parameters: {
          type: "object",
          properties: { ...memberSelector },
          required: ["memberName"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "manager_set_hourly_rate",
        description:
          "Set a team member's hourly pay rate in their Firestore profile. Only use after the Manager clearly specifies the person and rate.",
        parameters: {
          type: "object",
          properties: {
            ...memberSelector,
            hourlyRate: { type: "number", description: "Hourly rate in GBP, e.g. 13.55." },
          },
          required: ["memberName", "hourlyRate"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "manager_set_role",
        description:
          "Change a team member's approved role to Crew Member, Crew Trainer or Manager. This is a privileged Manager action.",
        parameters: {
          type: "object",
          properties: {
            ...memberSelector,
            role: {
              type: "string",
              enum: ["crew", "crewTrainer", "manager"],
            },
          },
          required: ["memberName", "role"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "manager_update_profile",
        description:
          "Update safe editable profile fields for a team member: name, badge, manager notes or store display name.",
        parameters: {
          type: "object",
          properties: {
            ...memberSelector,
            name: { type: "string" },
            badge: { type: "string" },
            notes: { type: "string" },
            storeName: { type: "string" },
          },
          required: ["memberName"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "manager_adjust_mcstars",
        description:
          "Add or remove McStars from a team member. Positive adds stars and negative removes stars. The final total cannot go below zero.",
        parameters: {
          type: "object",
          properties: {
            ...memberSelector,
            amount: { type: "number", description: "Integer adjustment from -100 to 100, excluding zero." },
            note: { type: "string" },
          },
          required: ["memberName", "amount"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "manager_set_availability",
        description:
          "Update a team member's regular availability for one day. Use only when the Manager explicitly asks to change it.",
        parameters: {
          type: "object",
          properties: {
            ...memberSelector,
            day: { type: "string" },
            available: { type: "boolean" },
            start: { type: "string", description: "HH:MM when available." },
            end: { type: "string", description: "HH:MM when available." },
          },
          required: ["memberName", "day", "available"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "manager_set_training_progress",
        description:
          "Mark one learning module completed or not completed for a team member. This changes learning progress only, never station verification.",
        parameters: {
          type: "object",
          properties: {
            ...memberSelector,
            moduleId: { type: "string" },
            completed: { type: "boolean" },
          },
          required: ["memberName", "moduleId", "completed"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "manager_review_role_request",
        description:
          "Approve or reject a pending Crew Trainer or Manager role request for a team member.",
        parameters: {
          type: "object",
          properties: {
            ...memberSelector,
            action: { type: "string", enum: ["approve", "reject"] },
          },
          required: ["memberName", "action"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "manager_revoke_station",
        description:
          "Revoke an existing verified station from a team member when retraining is required. This cannot grant a verification.",
        parameters: {
          type: "object",
          properties: {
            ...memberSelector,
            station: { type: "string" },
            reason: { type: "string" },
          },
          required: ["memberName", "station"],
        },
      },
    },
  ];
}
