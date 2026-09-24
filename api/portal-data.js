import {
  FieldValue,
  adminDb,
  canPlanShifts,
  canSeeTeam,
  canVerify,
  cleanText,
  getAuthenticatedProfile,
  isoDate,
  publicProfile,
} from "../server/portal-admin.js";

function serialise(value) {
  if (value == null) return value;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (Array.isArray(value)) return value.map(serialise);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, serialise(v)]),
    );
  }
  return value;
}

const fromDocs = (snap) =>
  snap.docs.map((d) => ({ id: d.id, ...serialise(d.data()) }));
const newestFirst = (a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0);

/** Monday of last week (Europe/London), so managers get last week's rota too. */
export function rotaWindowStart(now = new Date()) {
  const today = new Date(isoDate(now) + "T12:00:00Z");
  const back = ((today.getUTCDay() + 6) % 7) + 7;
  today.setUTCDate(today.getUTCDate() - back);
  return today.toISOString().slice(0, 10);
}

/** Deactivated accounts (McAssist "deactivate") keep their data but no access. */
export const isInactive = (profile) =>
  String(profile?.status || "").toLowerCase() === "inactive" ||
  profile?.deactivated === true;
const statusOf = (profile) => (isInactive(profile) ? "inactive" : "active");

// Crew Trainers see the team to start verifications, but never pay rates or
// manager notes. Everyone sees whether an account is deactivated.
export function teamEntry(profile, manager) {
  const full = publicProfile(profile);
  if (manager)
    return { ...full, email: profile.email || "", status: statusOf(profile) };
  return {
    id: full.id,
    name: full.name,
    role: full.role,
    roleLabel: full.roleLabel,
    storeId: full.storeId,
    storeName: full.storeName,
    stars: full.stars,
    badge: full.badge,
    verifiedStations: full.verifiedStations,
    status: statusOf(profile),
  };
}

function httpError(status, message, code = "") {
  return Object.assign(new Error(message), { status, code });
}

/** YYYY-MM-DD plus a number of days (calendar arithmetic, no time zones). */
function addDays(iso, days) {
  const date = new Date(iso + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * The store's display name for a profile that has none yet (new sign-ups
 * only enter a store ID). Taken from stores/{storeId}, or else the name most
 * of the store's members already carry, and saved back to the profile.
 */
export async function resolveStoreName(db, profile, members = null) {
  const current = cleanText(profile.storeName, 80);
  if (current || !profile.storeId) return current;
  let name = "";
  try {
    const snap = await db.collection("stores").doc(profile.storeId).get();
    if (snap.exists) {
      const store = snap.data() || {};
      name = cleanText(store.storeName || store.name, 80);
    }
  } catch (error) {
    console.warn("Store lookup failed", error.message);
  }
  if (!name) {
    let pool = members;
    if (!pool) {
      const snap = await db
        .collection("users")
        .where("storeId", "==", profile.storeId)
        .limit(40)
        .get()
        .catch(() => null);
      pool = snap ? snap.docs.map((d) => ({ id: d.id, ...d.data() })) : [];
    }
    const counts = new Map();
    for (const member of pool) {
      if (member.id === profile.id || member.storeId !== profile.storeId) continue;
      const value = cleanText(member.storeName, 80);
      if (value) counts.set(value, (counts.get(value) || 0) + 1);
    }
    name = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
  }
  if (name)
    await db
      .collection("users")
      .doc(profile.id)
      .set({ storeName: name }, { merge: true })
      .catch((error) => console.warn("Could not save the store name", error.message));
  return name;
}

/**
 * Upcoming store rota for Crew Trainers: who works when and where, and
 * nothing else (no pay, breaks or notes). Deactivated people are left out.
 */
export function trainerRota(docs, { inactive = new Set(), from, until } = {}) {
  return docs
    .map((d) => (typeof d.data === "function" ? d.data() : d))
    .filter(
      (s) =>
        s &&
        typeof s.date === "string" &&
        s.date >= from &&
        s.date <= until &&
        s.start &&
        s.end &&
        s.userId &&
        !inactive.has(s.userId),
    )
    .map((s) => ({
      date: s.date,
      start: s.start,
      end: s.end,
      station: s.station || "",
      userId: s.userId,
      userName: s.userName || "Team member",
    }))
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
}

async function handleGet(req, res, { decoded, profile }) {
  const db = adminDb();
  const storeId = profile.storeId;
  const isManager = canPlanShifts(profile.role);
  const isTrainer = canVerify(profile.role);
  const store = db.collection("stores").doc(storeId);

  const shiftsRef = store.collection("Shifts");
  const shiftsPromise = isManager
    ? shiftsRef.where("date", ">=", rotaWindowStart()).limit(600).get()
    : shiftsRef.where("userId", "==", decoded.uid).limit(200).get();

  const progressPromise = db
    .collection("users")
    .doc(decoded.uid)
    .collection("portalTraining")
    .limit(100)
    .get();

  const teamPromise = canSeeTeam(profile.role)
    ? db.collection("users").where("storeId", "==", storeId).limit(150).get()
    : Promise.resolve(null);

  const verificationRef = store.collection("verifications");
  const verificationPromise =
    profile.role === "crew"
      ? verificationRef.where("crewId", "==", decoded.uid).limit(100).get()
      : verificationRef.limit(200).get();

  const roleRequestsPromise = isManager
    ? db
        .collection("roleRequests")
        .where("storeId", "==", storeId)
        .where("status", "==", "pending")
        .limit(100)
        .get()
    : Promise.resolve(null);

  const recognitionRef = store.collection("recognition");
  const recognitionPromise = (
    isManager
      ? recognitionRef.orderBy("createdAt", "desc").limit(60).get()
      : recognitionRef.where("userId", "==", decoded.uid).limit(60).get()
  ).catch((error) => {
    console.warn("Recognition query failed", error.message);
    return null;
  });

  // Crew Trainers plan training and sign-offs around the store rota: the
  // next two weeks (from yesterday, for overnight shifts still running).
  const today = isoDate();
  const rotaFrom = addDays(today, -1);
  const rotaUntil = addDays(today, 14);
  const storeShiftsPromise = isTrainer
    ? shiftsRef
        .where("date", ">=", rotaFrom)
        .where("date", "<=", rotaUntil)
        .orderBy("date")
        .limit(400)
        .get()
        .catch((error) => {
          console.warn("Store rota query failed", error.message);
          return null;
        })
    : Promise.resolve(null);

  const [
    shiftsSnap,
    progressSnap,
    teamSnap,
    verificationSnap,
    roleRequestSnap,
    recognitionSnap,
    storeShiftsSnap,
  ] = await Promise.all([
    shiftsPromise,
    progressPromise,
    teamPromise,
    verificationPromise,
    roleRequestsPromise,
    recognitionPromise,
    storeShiftsPromise,
  ]);

  const progress = Object.fromEntries(
    progressSnap.docs.map((d) => [d.id, serialise(d.data())]),
  );
  const teamDocs = teamSnap ? teamSnap.docs : [];
  const members = teamDocs.map((d) => ({ id: d.id, ...d.data() }));
  // New sign-ups carry only a store ID: give them the store's name.
  const storeName = await resolveStoreName(
    db,
    profile,
    teamSnap ? members : null,
  );
  const team = members.map((m) =>
    teamEntry(m.storeName ? m : { ...m, storeName }, isManager),
  );

  // Team learning: completed module IDs per member (managers only). One small
  // IDs-only query per member, all in parallel.
  let teamProgress = {};
  if (isManager && teamDocs.length) {
    const results = await Promise.all(
      teamDocs.slice(0, 120).map((d) =>
        d.ref
          .collection("portalTraining")
          .where("completed", "==", true)
          .select()
          .limit(100)
          .get()
          .then((snap) => [d.id, snap.docs.map((x) => x.id)])
          .catch(() => [d.id, null]),
      ),
    );
    teamProgress = Object.fromEntries(results.filter(([, ids]) => ids));
  }

  const verifications = fromDocs(verificationSnap).sort(newestFirst);
  const roleRequests = roleRequestSnap ? fromDocs(roleRequestSnap) : [];
  const recognition = recognitionSnap
    ? fromDocs(recognitionSnap).sort(newestFirst).slice(0, 60)
    : [];
  // Friendly "from" names for recognition written before createdByName existed.
  const names = new Map(team.map((m) => [m.id, m.name]));
  names.set(decoded.uid, profile.name || "");
  const missing = [
    ...new Set(
      recognition
        .filter((r) => !r.createdByName && r.createdBy && !names.has(r.createdBy))
        .map((r) => r.createdBy),
    ),
  ].slice(0, 20);
  if (missing.length) {
    const snaps = await db
      .getAll(...missing.map((id) => db.collection("users").doc(id)))
      .catch(() => []);
    snaps.forEach((snap) => {
      if (snap.exists && snap.data().storeId === storeId)
        names.set(snap.id, snap.data().name || "");
    });
  }
  recognition.forEach((r) => {
    if (!r.createdByName && names.get(r.createdBy))
      r.createdByName = names.get(r.createdBy);
  });

  const pending = verifications.filter((v) => v.status !== "verified");
  const inactiveIds = new Set(members.filter(isInactive).map((m) => m.id));
  return res.status(200).json({
    profile: { ...publicProfile(profile), storeName, status: statusOf(profile) },
    ...(isTrainer
      ? {
          storeShifts: storeShiftsSnap
            ? trainerRota(storeShiftsSnap.docs, {
                inactive: inactiveIds,
                from: rotaFrom,
                until: rotaUntil,
              })
            : [],
        }
      : {}),
    permissions: {
      canPlanShifts: isManager,
      canVerify: isTrainer,
      canSeeTeam: canSeeTeam(profile.role),
    },
    shifts: fromDocs(shiftsSnap).sort((a, b) =>
      String(a.date + a.start).localeCompare(String(b.date + b.start)),
    ),
    team,
    progress,
    teamProgress,
    verifications,
    roleRequests,
    recognition,
    counts: {
      pendingVerifications: pending.length,
      awaitingMySignature: pending.filter(
        (v) =>
          (v.crewId === decoded.uid && !v.crewSignature) ||
          (isTrainer && v.trainerId === decoded.uid && !v.trainerSignature),
      ).length,
      pendingRoleRequests: roleRequests.length,
    },
    today,
  });
}

// Manager edits from the team page. The page writes to Firestore directly
// when the deployed security rules allow it and falls back to this endpoint,
// which re-checks manager role and store membership on the server.
async function handlePost(req, res, { decoded, profile }) {
  const body =
    typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const action = cleanText(body.action, 30);
  if (!["updateMember", "giveStars", "saveAvailability"].includes(action))
    throw httpError(400, "Unknown action.");
  const db = adminDb();
  if (action === "saveAvailability") {
    // Anyone may save their own availability (older deployed rules can
    // refuse the browser write for legacy profiles).
    const input = body.availability && typeof body.availability === "object" ? body.availability : null;
    if (!input) throw httpError(400, "Availability is required.");
    const time = /^([01]\d|2[0-3]):[0-5]\d$/;
    const availability = {};
    for (const day of ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]) {
      const d = input[day] || {};
      if (d.available) {
        if (!time.test(d.start) || !time.test(d.end) || d.start === d.end)
          throw httpError(400, "Check the times for " + day + ".");
        availability[day] = { available: true, start: d.start, end: d.end };
      } else availability[day] = { available: false, start: "", end: "" };
    }
    await db.collection("users").doc(decoded.uid).set(
      { availability, availabilityUpdatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    return res.status(200).json({ ok: true, availability });
  }
  if (!canPlanShifts(profile.role))
    throw httpError(403, "Only managers can change team details.");
  const uid = cleanText(body.uid, 128);
  if (!uid) throw httpError(400, "Choose a team member.");
  if (uid === decoded.uid)
    throw httpError(403, "Another manager needs to change your own pay or McStars.");
  const ref = db.collection("users").doc(uid);
  const snap = await ref.get();
  if (!snap.exists) throw httpError(404, "That team member no longer exists.");
  if (snap.data().storeId !== profile.storeId)
    throw httpError(403, "That team member belongs to another store.");

  if (action === "updateMember") {
    const input = body.patch && typeof body.patch === "object" ? body.patch : {};
    const patch = {};
    if ("hourlyRate" in input) {
      if (input.hourlyRate === null || input.hourlyRate === "")
        patch.hourlyRate = null;
      else {
        const rate = Math.round(Number(input.hourlyRate) * 100) / 100;
        if (!Number.isFinite(rate) || rate <= 0 || rate > 100)
          throw httpError(400, "Hourly rate must be between £0.01 and £100.");
        patch.hourlyRate = rate;
      }
    }
    if ("badge" in input) patch.badge = cleanText(input.badge, 60);
    if ("notes" in input) patch.notes = cleanText(input.notes, 1000);
    if (!Object.keys(patch).length) throw httpError(400, "Nothing to update.");
    await ref.set(
      { ...patch, updatedAt: FieldValue.serverTimestamp(), updatedBy: decoded.uid },
      { merge: true },
    );
    return res.status(200).json({
      ok: true,
      profile: teamEntry({ id: uid, ...snap.data(), ...patch }, true),
    });
  }

  const amount = Math.trunc(Number(body.amount));
  if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 100)
    throw httpError(400, "McStars must be between -100 and 100.");
  const note = cleanText(body.note, 200);
  const recognitionRef = db
    .collection("stores")
    .doc(profile.storeId)
    .collection("recognition")
    .doc();
  let stars = 0;
  await db.runTransaction(async (tx) => {
    const latest = await tx.get(ref);
    const before = Math.max(0, Number(latest.data()?.stars) || 0);
    stars = Math.max(0, before + amount);
    tx.set(
      ref,
      { stars, updatedAt: FieldValue.serverTimestamp(), updatedBy: decoded.uid },
      { merge: true },
    );
    tx.set(recognitionRef, {
      userId: uid,
      userName: snap.data().name || "Crew member",
      amount: stars - before,
      note,
      createdBy: decoded.uid,
      createdByName: profile.name || "Manager",
      createdAt: FieldValue.serverTimestamp(),
      source: "portal",
    });
  });
  return res.status(200).json({ ok: true, stars, recognitionId: recognitionRef.id });
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const auth = await getAuthenticatedProfile(req);
    // A deactivated account keeps a (short-lived) ID token until it expires;
    // it gets no data.
    if (isInactive(auth.profile))
      throw httpError(
        403,
        "Your account has been deactivated. Speak to your manager if you think this is a mistake.",
        "deactivated",
      );
    if (req.method === "POST") return await handlePost(req, res, auth);
    return await handleGet(req, res, auth);
  } catch (error) {
    console.error("Portal data request failed", {
      name: error.name,
      message: error.message,
    });
    const code = errorCode(error);
    return res.status(error.status || 500).json({
      error: error.status ? error.message : "Could not load portal data.",
      ...(code ? { code } : {}),
    });
  }
}

// Machine-readable reasons, so the app can tell an account problem (missing
// profile or store, deactivated) from a connection problem.
export function errorCode(error) {
  if (!error?.status) return "";
  if (error.code && typeof error.code === "string") return error.code;
  if (error.status !== 403) return "";
  const message = String(error.message || "");
  if (/profile is missing/i.test(message)) return "profile-missing";
  if (/store ID/i.test(message)) return "store-missing";
  return "";
}
