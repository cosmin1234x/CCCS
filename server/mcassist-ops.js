// Atomic McAssist write operations. Every operation has:
//   roles      – approved roles allowed to run it (re-checked on every call)
//   risk(args) – "low" | "medium" | "high" (server policy, never the model's)
//   validate() – checks it against live data and returns a human label plus a
//                status of ok | warning | blocked
//   execute()  – performs the write and returns what to audit
// Validation runs twice: when the change is staged during the chat turn and
// again immediately before execution after the user confirms.
import { normalizeRole, roleLabel } from "./portal-admin.js";
import {
  clean,
  db,
  forgetMember,
  futureShiftsOf,
  loadMember,
  memberShifts,
  serialise,
  shiftsRef,
  writeAudit,
} from "./mcassist-session.js";
import { evaluateShift, fitsAvailability, hoursLabel, paidMinutes, timeRange } from "./mcassist-shifts.js";
import { DAY_SHORT, WEEK_ORDER, dateLabel, timeOk, weekdayKey } from "./mcassist-time.js";
import { findModule, moduleCatalog, normaliseVerifyStation, VERIFY_STATIONS } from "./mcassist-catalog.js";
import { accountOps } from "./mcassist-manager.js";

export const MANAGER = ["manager"];
export const EVERYONE = ["crew", "crewTrainer", "manager"];

export function newPlanState() {
  return { addedShifts: [], removedShiftIds: new Set(), changedShifts: new Map() };
}

export function blocked(label, note, extra = {}) {
  return { status: "blocked", label, note, ...extra };
}

const money = (n) => "£" + Number(n).toFixed(2);

// The member's shifts as they would look with the rest of the plan applied.
export async function shiftsWithPlan(session, memberId, plan, excludeId = null) {
  const base = (await memberShifts(session, memberId))
    .filter((s) => s.id !== excludeId && !plan?.removedShiftIds?.has(s.id))
    .map((s) => (plan?.changedShifts?.has(s.id) ? { ...s, ...plan.changedShifts.get(s.id) } : s));
  const added = (plan?.addedShifts || []).filter((s) => s.userId === memberId);
  return [...base, ...added];
}

export function shiftLabel(name, shift) {
  return (name || "Crew member") + " · " + dateLabel(shift.date) + " · " + timeRange(shift) + " · " + (shift.station || "TBC");
}

function shiftDetail(shift) {
  const brk = Number(shift.breakMinutes) || 0;
  return hoursLabel(paidMinutes(shift)) + " paid" + (brk ? " · " + brk + " min break" : " · no break");
}

// ---- Availability helpers --------------------------------------------------

export function availabilityLabel(days) {
  return WEEK_ORDER.filter((d) => days[d])
    .map((d) => DAY_SHORT[d] + " " + (days[d].available ? days[d].start + "–" + days[d].end : "off"))
    .join(" · ");
}

function validateDays(days) {
  const entries = Object.entries(days || {});
  if (!entries.length) return "Tell me which days to change.";
  for (const [day, value] of entries) {
    if (!WEEK_ORDER.includes(day)) return "\"" + day + "\" isn't a day of the week.";
    if (value.available && (!timeOk(value.start) || !timeOk(value.end) || value.start === value.end))
      return "I need a valid start and end time for " + DAY_SHORT[day] + ".";
  }
  return null;
}

async function availabilityConflicts(session, member, days) {
  const { future } = await futureShiftsOf(session, member.id);
  const next = { ...(member.availability || {}), ...days };
  return future.filter((s) => {
    if (!days[weekdayKey(s.date)]) return false;
    const fit = fitsAvailability(next, s);
    return fit.status === "off" || fit.status === "outside";
  });
}

function mergedAvailability(current, days) {
  const next = { ...(current || {}) };
  for (const [day, value] of Object.entries(days)) {
    next[day] = value.available
      ? { available: true, start: value.start, end: value.end }
      : { available: false, start: "09:00", end: "17:00" };
  }
  return next;
}

// ---- Operations --------------------------------------------------------------

export const OPS = {
  create_shift: {
    roles: MANAGER,
    risk: () => "low",
    async validate(session, args, plan) {
      const member = await loadMember(session, args.memberId);
      const shift = {
        date: args.date,
        start: args.start,
        end: args.end,
        station: args.station || "TBC",
        breakMinutes: Number(args.breakMinutes) || 0,
      };
      const label = shiftLabel(member?.name || args.memberName, shift);
      if (!member) return blocked(label, "That person is no longer in your store.");
      const others = await shiftsWithPlan(session, member.id, plan);
      const verdict = evaluateShift({ member, shift, others, today: session.today, nowMinutes: session.nowMinutes });
      if (verdict.status !== "blocked") plan.addedShifts.push({ ...shift, userId: member.id });
      return {
        status: verdict.status,
        label,
        detail: shiftDetail(shift),
        note: verdict.notes.join(" "),
        member,
        shift,
      };
    },
    async execute(session, args, v) {
      const ref = shiftsRef(session).doc();
      const data = {
        userId: v.member.id,
        userName: v.member.name || "Crew member",
        role: normalizeRole(v.member.role),
        date: v.shift.date,
        start: v.shift.start,
        end: v.shift.end,
        station: v.shift.station,
        breakMinutes: v.shift.breakMinutes,
        createdBy: session.uid,
        createdByName: session.profile.name || "Manager",
        createdAt: session.deps.FieldValue.serverTimestamp(),
        source: "mcassist",
      };
      await ref.set(data);
      forgetMember(session, v.member.id);
      return {
        message: "Created " + v.label,
        target: v.member,
        after: { shiftId: ref.id, date: data.date, start: data.start, end: data.end, station: data.station, breakMinutes: data.breakMinutes },
      };
    },
  },

  update_shift: {
    roles: MANAGER,
    risk: () => "low",
    async validate(session, args, plan) {
      const snap = await shiftsRef(session).doc(String(args.shiftId || "")).get();
      if (!snap.exists) return blocked("Shift " + (args.shiftId || ""), "That shift no longer exists.");
      const current = { id: snap.id, ...serialise(snap.data()) };
      const patch = args.patch || {};
      const next = { ...current, ...patch };
      const changes = [];
      if (patch.date && patch.date !== current.date) changes.push(dateLabel(patch.date));
      if ((patch.start && patch.start !== current.start) || (patch.end && patch.end !== current.end))
        changes.push(timeRange(next));
      if (patch.station && patch.station !== current.station) changes.push(patch.station);
      if (patch.breakMinutes != null && Number(patch.breakMinutes) !== Number(current.breakMinutes || 0))
        changes.push(patch.breakMinutes + " min break");
      const label =
        (current.userName || "Crew member") +
        " · " +
        dateLabel(current.date) +
        " · " +
        timeRange(current) +
        (changes.length ? " → " + changes.join(" · ") : "");
      if (!changes.length) return blocked(label, "That shift already looks like that — nothing to change.");
      const member = await loadMember(session, current.userId);
      const others = member ? await shiftsWithPlan(session, member.id, plan, current.id) : [];
      const verdict = evaluateShift({
        member: member || { name: current.userName, availability: null },
        shift: next,
        others,
        today: session.today,
        nowMinutes: session.nowMinutes,
        allowPast: true,
      });
      if (verdict.status !== "blocked") plan.changedShifts.set(current.id, patch);
      return {
        status: verdict.status,
        label,
        detail: shiftDetail(next),
        note: verdict.notes.join(" "),
        member: member || { id: current.userId, name: current.userName },
        current,
        patch,
      };
    },
    async execute(session, args, v) {
      await shiftsRef(session)
        .doc(v.current.id)
        .set(
          clean({
            ...v.patch,
            updatedBy: session.uid,
            updatedAt: session.deps.FieldValue.serverTimestamp(),
            source: "mcassist",
          }),
          { merge: true },
        );
      forgetMember(session, v.current.userId);
      const pick = (s) => ({ date: s.date, start: s.start, end: s.end, station: s.station, breakMinutes: s.breakMinutes ?? 0 });
      return {
        message: "Updated " + v.label,
        target: v.member,
        before: { shiftId: v.current.id, ...pick(v.current) },
        after: { shiftId: v.current.id, ...pick({ ...v.current, ...v.patch }) },
      };
    },
  },

  delete_shift: {
    roles: MANAGER,
    risk: () => "medium",
    async validate(session, args, plan) {
      const snap = await shiftsRef(session).doc(String(args.shiftId || "")).get();
      if (!snap.exists) return blocked("Shift " + (args.shiftId || ""), "That shift has already been removed.");
      const shift = { id: snap.id, ...serialise(snap.data()) };
      plan.removedShiftIds.add(shift.id);
      const past = String(shift.date || "") < session.today;
      return {
        status: past ? "warning" : "ok",
        label: shiftLabel(shift.userName, shift),
        detail: shiftDetail(shift),
        note: past ? "This shift has already happened, so removing it changes the history." : "",
        shift,
      };
    },
    async execute(session, args, v) {
      await shiftsRef(session).doc(v.shift.id).delete();
      forgetMember(session, v.shift.userId);
      return {
        message: "Deleted " + v.label,
        target: { id: v.shift.userId, name: v.shift.userName },
        before: v.shift,
      };
    },
  },

  set_own_availability: {
    roles: EVERYONE,
    risk: () => "low",
    async validate(session, args) {
      const days = args.days || {};
      const label = "Your availability · " + availabilityLabel(days);
      const problem = validateDays(days);
      if (problem) return blocked(label, problem);
      const member = await loadMember(session, session.uid, { fresh: true });
      if (!member) return blocked(label, "Your profile could not be found.");
      const conflicts = await availabilityConflicts(session, member, days);
      return {
        status: conflicts.length ? "warning" : "ok",
        label,
        note: conflicts.length
          ? "You're already rostered " +
            conflicts
              .slice(0, 3)
              .map((s) => dateLabel(s.date) + " " + timeRange(s))
              .join(", ") +
            ", outside these hours — speak to your manager about that shift."
          : "",
        member,
        days,
      };
    },
    async execute(session, args, v) {
      const before = Object.fromEntries(Object.keys(v.days).map((d) => [d, v.member.availability?.[d] ?? null]));
      const availability = mergedAvailability(v.member.availability, v.days);
      await db(session)
        .collection("users")
        .doc(session.uid)
        .set({ availability, updatedAt: session.deps.FieldValue.serverTimestamp(), updatedBy: session.uid }, { merge: true });
      forgetMember(session, session.uid);
      return {
        message: "Updated your availability · " + availabilityLabel(v.days),
        target: v.member,
        before,
        after: Object.fromEntries(Object.keys(v.days).map((d) => [d, availability[d]])),
        uiAction: null,
      };
    },
  },

  set_member_availability: {
    roles: MANAGER,
    risk: () => "low",
    async validate(session, args) {
      const member = await loadMember(session, args.memberId, { fresh: true });
      const days = args.days || {};
      const label = (member?.name || args.memberName || "Team member") + "'s availability · " + availabilityLabel(days);
      if (!member) return blocked(label, "That person is no longer in your store.");
      const problem = validateDays(days);
      if (problem) return blocked(label, problem);
      const conflicts = await availabilityConflicts(session, member, days);
      return {
        status: conflicts.length ? "warning" : "ok",
        label,
        note: conflicts.length
          ? "Already rostered outside the new hours: " +
            conflicts
              .slice(0, 3)
              .map((s) => dateLabel(s.date) + " " + timeRange(s))
              .join(", ") +
            "."
          : "",
        member,
        days,
      };
    },
    async execute(session, args, v) {
      const before = Object.fromEntries(Object.keys(v.days).map((d) => [d, v.member.availability?.[d] ?? null]));
      const availability = mergedAvailability(v.member.availability, v.days);
      await db(session)
        .collection("users")
        .doc(v.member.id)
        .set({ availability, updatedAt: session.deps.FieldValue.serverTimestamp(), updatedBy: session.uid }, { merge: true });
      forgetMember(session, v.member.id);
      return {
        message: "Updated " + v.label,
        target: v.member,
        before,
        after: Object.fromEntries(Object.keys(v.days).map((d) => [d, availability[d]])),
      };
    },
  },

  set_hourly_rate: {
    roles: MANAGER,
    risk: () => "medium",
    async validate(session, args) {
      const member = await loadMember(session, args.memberId, { fresh: true });
      const rate = Math.round(Number(args.hourlyRate) * 100) / 100;
      const current = Number.isFinite(Number(member?.hourlyRate)) && member?.hourlyRate !== null && member?.hourlyRate !== "" ? Number(member.hourlyRate) : null;
      const label =
        (member?.name || args.memberName || "Team member") +
        " · hourly rate " +
        (current == null ? "not set" : money(current)) +
        " → " +
        (Number.isFinite(rate) ? money(rate) : "?");
      if (!member) return blocked(label, "That person is no longer in your store.");
      if (!Number.isFinite(rate) || rate < 0 || rate > 100) return blocked(label, "Hourly rate must be between £0 and £100.");
      if (current === rate) return blocked(label, (member.name || "They") + " is already on " + money(rate) + ".");
      const note = rate > 0 && rate < 5 ? "That's unusually low for an hourly rate — double-check it." : "";
      return { status: note ? "warning" : "ok", label, note, member, rate, current };
    },
    async execute(session, args, v) {
      await db(session)
        .collection("users")
        .doc(v.member.id)
        .set({ hourlyRate: v.rate, updatedAt: session.deps.FieldValue.serverTimestamp(), updatedBy: session.uid }, { merge: true });
      forgetMember(session, v.member.id);
      return {
        message: "Set " + (v.member.name || "their") + "'s hourly rate to " + money(v.rate),
        target: v.member,
        before: { hourlyRate: v.current },
        after: { hourlyRate: v.rate },
      };
    },
  },

  set_role: {
    roles: MANAGER,
    risk: () => "high",
    async validate(session, args) {
      const member = await loadMember(session, args.memberId, { fresh: true });
      const role = cleanRole(args.role);
      const label =
        (member?.name || args.memberName || "Team member") +
        " · " +
        roleLabel(member?.role) +
        " → " +
        (role ? roleLabel(role) : String(args.role || "?"));
      if (!member) return blocked(label, "That person is no longer in your store.");
      if (!role) return blocked(label, "Role must be Crew Member, Crew Trainer or Manager.");
      if (member.id === session.uid && role !== "manager")
        return blocked(label, "McAssist won't demote your own account — that could lock you out.");
      if (normalizeRole(member.role) === role) return blocked(label, (member.name || "They") + " is already a " + roleLabel(role) + ".");
      return {
        status: "ok",
        label,
        note: role === "manager" ? "Managers can change pay, roles and accounts for the whole store." : "",
        member,
        role,
      };
    },
    async execute(session, args, v) {
      await applyRole(session, v.member, v.role);
      return {
        message: (v.member.name || "They") + " is now a " + roleLabel(v.role),
        target: v.member,
        before: { role: normalizeRole(v.member.role) },
        after: { role: v.role },
      };
    },
  },

  update_profile: {
    roles: MANAGER,
    risk: () => "low",
    async validate(session, args) {
      const member = await loadMember(session, args.memberId, { fresh: true });
      const patch = args.patch || {};
      const parts = [];
      if (patch.name !== undefined) parts.push("name → " + patch.name);
      if (patch.badge !== undefined) parts.push(patch.badge ? "badge “" + patch.badge + "”" : "badge removed");
      if (patch.notes !== undefined) parts.push(patch.notes ? "notes updated" : "notes cleared");
      const label = (member?.name || args.memberName || "Team member") + " · " + (parts.join(" · ") || "profile");
      if (!member) return blocked(label, "That person is no longer in your store.");
      if (!parts.length) return blocked(label, "Tell me which profile field to change (name, badge or notes).");
      if (patch.name !== undefined && !patch.name) return blocked(label, "The name can't be empty.");
      return { status: "ok", label, detail: patch.notes ? "Notes: " + patch.notes.slice(0, 140) : "", member, patch };
    },
    async execute(session, args, v) {
      const before = Object.fromEntries(Object.keys(v.patch).map((k) => [k, v.member[k] ?? null]));
      await db(session)
        .collection("users")
        .doc(v.member.id)
        .set(
          clean({ ...v.patch, updatedAt: session.deps.FieldValue.serverTimestamp(), updatedBy: session.uid }),
          { merge: true },
        );
      forgetMember(session, v.member.id);
      return { message: "Updated " + v.label, target: v.member, before, after: v.patch };
    },
  },

  adjust_stars: {
    roles: MANAGER,
    risk: () => "low",
    async validate(session, args) {
      const member = await loadMember(session, args.memberId, { fresh: true });
      const amount = Math.trunc(Number(args.amount));
      const label =
        (member?.name || args.memberName || "Team member") +
        " · " +
        (amount > 0 ? "+" : "") +
        (Number.isFinite(amount) ? amount : "?") +
        " McStar" +
        (Math.abs(amount) === 1 ? "" : "s") +
        (args.note ? " · " + args.note : "");
      if (!member) return blocked(label, "That person is no longer in your store.");
      if (!Number.isFinite(amount) || amount === 0 || amount < -100 || amount > 100)
        return blocked(label, "McStars changes must be a whole number from -100 to 100 (not zero).");
      if (member.id === session.uid) return blocked(label, "You can't give McStars to yourself.");
      const current = Math.max(0, Number(member.stars) || 0);
      const note = amount < 0 && current + amount < 0 ? (member.name || "They") + " only has " + current + "; the total will stop at 0." : "";
      return { status: note ? "warning" : "ok", label, note, member, amount, noteText: args.note || "" };
    },
    async execute(session, args, v) {
      const ref = db(session).collection("users").doc(v.member.id);
      let before = 0;
      let after = 0;
      await db(session).runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw Object.assign(new Error("That person no longer exists."), { status: 404 });
        before = Math.max(0, Number(snap.data().stars) || 0);
        after = Math.max(0, before + v.amount);
        tx.set(ref, { stars: after, updatedAt: session.deps.FieldValue.serverTimestamp(), updatedBy: session.uid }, { merge: true });
      });
      await db(session)
        .collection("stores")
        .doc(session.storeId)
        .collection("recognition")
        .add({
          userId: v.member.id,
          userName: v.member.name || "Crew member",
          amount: after - before,
          note: v.noteText,
          createdBy: session.uid,
          createdAt: session.deps.FieldValue.serverTimestamp(),
          source: "mcassist",
        });
      forgetMember(session, v.member.id);
      return {
        message: (v.amount > 0 ? "Gave " : "Removed ") + Math.abs(v.amount) + " McStar" + (Math.abs(v.amount) === 1 ? "" : "s") + (v.amount > 0 ? " to " : " from ") + (v.member.name || "them") + " (now " + after + ")",
        target: v.member,
        before: { stars: before },
        after: { stars: after },
        details: { requested: v.amount, note: v.noteText },
      };
    },
  },

  set_training_progress: {
    roles: MANAGER,
    risk: () => "low",
    async validate(session, args) {
      const member = await loadMember(session, args.memberId, { fresh: true });
      const module = findModule(args.moduleId);
      const completed = args.completed !== false;
      const label =
        (member?.name || args.memberName || "Team member") +
        " · " +
        (module?.title || args.moduleId || "module") +
        " → " +
        (completed ? "completed" : "not completed");
      if (!member) return blocked(label, "That person is no longer in your store.");
      if (!module)
        return blocked(label, "I couldn't find that learning module. Modules include: " + moduleCatalog().slice(0, 8).map((m) => m.title).join(", ") + ".");
      return { status: "ok", label, member, module, completed };
    },
    async execute(session, args, v) {
      const ref = db(session).collection("users").doc(v.member.id).collection("portalTraining").doc(v.module.id);
      const beforeSnap = await ref.get();
      const FV = session.deps.FieldValue;
      await ref.set(
        v.completed
          ? { completed: true, completedAt: FV.serverTimestamp(), completedBy: session.uid, source: "mcassist-manager" }
          : { completed: false, resetAt: FV.serverTimestamp(), resetBy: session.uid, source: "mcassist-manager" },
        { merge: true },
      );
      return {
        message: "Marked " + v.label,
        target: v.member,
        before: { moduleId: v.module.id, completed: Boolean(beforeSnap.exists && beforeSnap.data()?.completed) },
        after: { moduleId: v.module.id, completed: v.completed },
      };
    },
  },

  review_role_request: {
    roles: MANAGER,
    risk: (args) => (args.decision === "approve" ? "high" : "medium"),
    async validate(session, args) {
      const member = await loadMember(session, args.memberId, { fresh: true });
      const decision = args.decision === "reject" ? "reject" : "approve";
      const snap = member ? await db(session).collection("roleRequests").doc(member.id).get() : null;
      const request = snap?.exists ? snap.data() : null;
      const requested = cleanRole(request?.requestedRole);
      const label =
        (member?.name || args.memberName || "Team member") +
        " · " +
        (decision === "approve" ? "approve" : "reject") +
        " " +
        (requested ? roleLabel(requested) : "role") +
        " request";
      if (!member) return blocked(label, "That person is no longer in your store.");
      if (!request || String(request.status || "") !== "pending")
        return blocked(label, (member.name || "They") + " doesn't have a pending role request.");
      if (request.storeId && request.storeId !== session.storeId) return blocked(label, "That request belongs to another store.");
      if (decision === "approve" && !["crewTrainer", "manager"].includes(requested))
        return blocked(label, "That role request is invalid.");
      return { status: "ok", label, member, decision, requested, request };
    },
    async execute(session, args, v) {
      if (v.decision === "approve") {
        await applyRole(session, v.member, v.requested);
        return {
          message: "Approved " + (v.member.name || "their") + "'s " + roleLabel(v.requested) + " request",
          target: v.member,
          before: { role: normalizeRole(v.member.role), request: "pending" },
          after: { role: v.requested, request: "approved" },
        };
      }
      const FV = session.deps.FieldValue;
      const batch = db(session).batch();
      batch.set(
        db(session).collection("roleRequests").doc(v.member.id),
        { status: "rejected", reviewedBy: session.uid, reviewedAt: FV.serverTimestamp(), source: "mcassist" },
        { merge: true },
      );
      batch.set(
        db(session).collection("users").doc(v.member.id),
        { requestedRole: "", roleRequestStatus: "rejected", roleApprovedBy: session.uid, roleApprovedAt: FV.serverTimestamp() },
        { merge: true },
      );
      await batch.commit();
      forgetMember(session, v.member.id);
      return {
        message: "Rejected " + (v.member.name || "their") + "'s role request",
        target: v.member,
        before: { requestedRole: v.request.requestedRole || "", status: "pending" },
        after: { status: "rejected" },
      };
    },
  },

  revoke_station: {
    roles: MANAGER,
    risk: () => "medium",
    async validate(session, args) {
      const member = await loadMember(session, args.memberId, { fresh: true });
      const stations = Array.isArray(member?.verifiedStations) ? member.verifiedStations : [];
      const wanted = normaliseVerifyStation(args.station) || String(args.station || "").trim();
      const station = stations.find((s) => String(s).toLowerCase() === String(wanted).toLowerCase());
      const label =
        (member?.name || args.memberName || "Team member") +
        " · revoke " +
        (station || wanted || "station") +
        " verification" +
        (args.reason ? " · " + args.reason : "");
      if (!member) return blocked(label, "That person is no longer in your store.");
      if (!station)
        return blocked(
          label,
          (member.name || "They") +
            " isn't verified on " +
            (wanted || "that station") +
            (stations.length ? " (verified: " + stations.join(", ") + ")." : " — they have no verified stations."),
        );
      return { status: "ok", label, note: "They'll need a new sign-off before working it unsupervised.", member, station, stations, reason: args.reason || "" };
    },
    async execute(session, args, v) {
      const FV = session.deps.FieldValue;
      const verifications = db(session).collection("stores").doc(session.storeId).collection("verifications");
      const snap = await verifications.where("crewId", "==", v.member.id).limit(100).get();
      const batch = db(session).batch();
      batch.set(
        db(session).collection("users").doc(v.member.id),
        { verifiedStations: FV.arrayRemove(v.station), updatedAt: FV.serverTimestamp(), updatedBy: session.uid },
        { merge: true },
      );
      for (const doc of snap.docs) {
        const data = doc.data();
        if (String(data.station || "").toLowerCase() === v.station.toLowerCase() && data.status === "verified")
          batch.set(doc.ref, { status: "revoked", revokedBy: session.uid, revokedAt: FV.serverTimestamp(), revokeReason: v.reason }, { merge: true });
      }
      await batch.commit();
      forgetMember(session, v.member.id);
      return {
        message: "Revoked " + (v.member.name || "their") + "'s " + v.station + " verification",
        target: v.member,
        before: { verifiedStations: v.stations },
        after: { verifiedStations: v.stations.filter((s) => s !== v.station) },
        details: { station: v.station, reason: v.reason },
      };
    },
  },

  start_verification: {
    roles: ["crewTrainer"],
    risk: () => "low",
    async validate(session, args) {
      const member = await loadMember(session, args.memberId, { fresh: true });
      const station = normaliseVerifyStation(args.station);
      const label = (member?.name || args.memberName || "Crew member") + " · " + (station || args.station || "station") + " verification";
      if (!member) return blocked(label, "That person is no longer in your store.");
      if (member.id === session.uid) return blocked(label, "You can't verify yourself.");
      if (normalizeRole(member.role) !== "crew") return blocked(label, "Station verification is for Crew Members.");
      if (!station) return blocked(label, "Choose one of these stations: " + VERIFY_STATIONS.join(", ") + ".");
      const already = (member.verifiedStations || []).some((s) => String(s).toLowerCase() === station.toLowerCase());
      return {
        status: "ok",
        label,
        note: already ? (member.name || "They") + " is already verified on " + station + "; this starts a fresh check." : "",
        detail: "Both of you sign on the verification page — McAssist never signs for anyone.",
        member,
        station,
      };
    },
    async execute(session, args, v) {
      const ref = db(session).collection("stores").doc(session.storeId).collection("verifications");
      const recent = await ref.where("crewId", "==", v.member.id).limit(50).get();
      const existing = recent.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .find((x) => x.station === v.station && x.status === "pending_signatures");
      if (existing)
        return {
          message: "Opened the existing " + v.station + " verification for " + (v.member.name || "them"),
          target: v.member,
          after: { verificationId: existing.id, station: v.station, reused: true },
          uiAction: { type: "openVerification", id: existing.id },
        };
      const created = await ref.add({
        storeId: session.storeId,
        crewId: v.member.id,
        crewName: v.member.name || "Crew member",
        trainerId: session.uid,
        trainerName: session.profile.name || "Crew Trainer",
        station: v.station,
        status: "pending_signatures",
        crewSignature: null,
        trainerSignature: null,
        createdAt: session.deps.FieldValue.serverTimestamp(),
        createdBy: session.uid,
      });
      return {
        message: "Started a " + v.station + " verification for " + (v.member.name || "them"),
        target: v.member,
        after: { verificationId: created.id, station: v.station },
        uiAction: { type: "openVerification", id: created.id },
      };
    },
  },

  ...accountOps,
};

export function cleanRole(value) {
  const raw = String(value || "").trim().toLowerCase().replace(/[\s_-]/g, "");
  if (["crew", "crewmember", "member"].includes(raw)) return "crew";
  if (["crewtrainer", "trainer"].includes(raw)) return "crewTrainer";
  if (["manager", "shiftcreator", "admin", "shiftmanager"].includes(raw)) return "manager";
  return null;
}

async function applyRole(session, member, role) {
  const FV = session.deps.FieldValue;
  const batch = db(session).batch();
  batch.set(
    db(session).collection("users").doc(member.id),
    {
      role,
      requestedRole: role,
      roleRequestStatus: "approved",
      roleApprovedBy: session.uid,
      roleApprovedAt: FV.serverTimestamp(),
      updatedAt: FV.serverTimestamp(),
      updatedBy: session.uid,
    },
    { merge: true },
  );
  batch.set(
    db(session).collection("roleRequests").doc(member.id),
    {
      uid: member.id,
      name: member.name || "Crew member",
      email: member.email || "",
      storeId: session.storeId,
      requestedRole: role,
      status: "approved",
      reviewedBy: session.uid,
      reviewedAt: FV.serverTimestamp(),
      source: "mcassist",
    },
    { merge: true },
  );
  await batch.commit();
  forgetMember(session, member.id);
}

// Runs validation for an op; unknown kinds and wrong roles are blocked here so
// nothing can execute without passing the server-side role check.
export async function validateOp(session, kind, args, plan) {
  const op = OPS[kind];
  if (!op) return { status: "blocked", label: kind, note: "That action isn't supported." };
  if (!op.roles.includes(session.role))
    return {
      status: "blocked",
      label: kind.replace(/_/g, " "),
      note: "Your role (" + roleLabel(session.role) + ") can't do that.",
      forbidden: true,
    };
  try {
    const result = await op.validate(session, args, plan);
    return { ...result, risk: op.risk(args) };
  } catch (error) {
    console.error("McAssist validation failed", { kind, message: error?.message });
    return { status: "blocked", label: kind.replace(/_/g, " "), note: "I couldn't check that change right now." };
  }
}

// Executes one validated op and audits it.
export async function executeOp(session, kind, args, validation, { pendingId = null } = {}) {
  const op = OPS[kind];
  const result = await op.execute(session, args, validation, { pendingId });
  if (!op.auditsItself)
    await writeAudit(session, {
      action: kind,
      target: result.target,
      before: result.before,
      after: result.after,
      details: result.details,
      pendingId,
    });
  return result;
}
