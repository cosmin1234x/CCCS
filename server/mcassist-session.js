// Per-request McAssist session: who is asking, their store and role, the data
// layer (Firestore + Auth, injectable for tests), cached lookups, the trace of
// checks made ("steps") and audit logging.
import {
  FieldValue as AdminFieldValue,
  adminAuth,
  adminDb,
  canPlanShifts,
  canSeeTeam,
  canVerify,
  normalizeRole,
  publicProfile,
  roleLabel,
} from "./portal-admin.js";
import { londonNow } from "./mcassist-time.js";
import { resolveMember, rosterEntry, memberLabel } from "./mcassist-people.js";
import { sortShifts } from "./mcassist-shifts.js";

export function defaultDeps() {
  return {
    db: adminDb,
    auth: adminAuth,
    FieldValue: AdminFieldValue,
    now: () => Date.now(),
    loadWaste: defaultWasteLoader,
  };
}

let wasteModulePromise = null;
// The waste feature is optional: only offer waste insights when its store
// module exists and exposes readWasteRecord.
export async function defaultWasteLoader() {
  if (!wasteModulePromise) {
    wasteModulePromise = import("./waste-store.js")
      .then((mod) => (typeof mod?.readWasteRecord === "function" ? mod : null))
      .catch(() => null);
  }
  return wasteModulePromise;
}

export function serialise(value) {
  if (value == null) return value;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (Array.isArray(value)) return value.map(serialise);
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, serialise(v)]));
  return value;
}

// Firestore rejects undefined values; drop them (recursively) before writing.
export function clean(value) {
  if (Array.isArray(value)) return value.filter((v) => v !== undefined).map(clean);
  if (value && typeof value === "object" && value.constructor === Object) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, clean(v)]),
    );
  }
  return value;
}

export function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

export function permissionsFor(role) {
  return {
    canPlanShifts: canPlanShifts(role),
    canVerify: canVerify(role),
    canSeeTeam: canSeeTeam(role),
  };
}

// Default context loader: a fresh profile read on every request, so role and
// store are re-checked server-side each time.
export async function loadContext(user, deps) {
  const db = deps.db();
  const snap = await db.doc("users/" + user.uid).get();
  if (!snap.exists) throw httpError(403, "Your crew profile is missing.");
  const data = snap.data() || {};
  const profile = { ...data, id: snap.id, role: normalizeRole(data.role) };
  if (!profile.storeId) throw httpError(403, "Your profile needs a store ID.");
  if (String(profile.status || "").toLowerCase() === "inactive")
    throw httpError(403, "Your account has been deactivated. Speak to your manager.");
  const permissions = permissionsFor(profile.role);
  const today = londonNow(deps.now()).date;

  const rosterPromise = permissions.canSeeTeam
    ? db.collection("users").where("storeId", "==", profile.storeId).limit(300).get()
    : Promise.resolve(null);
  const ownShiftsPromise = db
    .collection("stores")
    .doc(profile.storeId)
    .collection("Shifts")
    .where("userId", "==", user.uid)
    .limit(300)
    .get();
  const [rosterSnap, ownSnap] = await Promise.all([rosterPromise, ownShiftsPromise]);
  const roster = rosterSnap
    ? rosterSnap.docs.map((d) => rosterEntry({ ...d.data(), id: d.id }))
    : [rosterEntry(profile)];
  if (!roster.some((m) => m.id === profile.id)) roster.push(rosterEntry(profile));
  const ownShifts = sortShifts(
    ownSnap.docs.map((d) => ({ id: d.id, ...serialise(d.data()) })).filter((s) => String(s.date || "") >= today),
  );
  return {
    profile: { ...publicProfile(profile), email: profile.email || "", status: profile.status || "active" },
    permissions,
    roster,
    team: roster.map((m) => publicProfile(m)),
    ownShifts,
  };
}

export function createSession({ user, context, deps }) {
  const nowMs = deps.now();
  const now = londonNow(nowMs);
  const profile = context.profile || {};
  const role = normalizeRole(profile.role);
  const roster = Array.isArray(context.roster)
    ? context.roster
    : Array.isArray(context.team) && context.team.length
      ? context.team.map(rosterEntry)
      : [rosterEntry({ ...profile, id: profile.id || user.uid })];
  return {
    uid: user.uid,
    profile: { ...profile, id: profile.id || user.uid, role },
    role,
    roleLabel: roleLabel(role),
    storeId: profile.storeId,
    permissions: permissionsFor(role),
    context,
    deps,
    nowMs,
    today: now.date,
    nowTime: now.time,
    nowMinutes: now.minutes,
    roster,
    rosterLoaded: Array.isArray(context.roster),
    cache: { members: new Map(), shifts: new Map() },
    steps: [],
    staged: [],
    ambiguity: null,
    forbidden: false,
    uiAction: null,
  };
}

export function db(session) {
  return session.deps.db();
}

export function shiftsRef(session) {
  return db(session).collection("stores").doc(session.storeId).collection("Shifts");
}

export function addStep(session, label) {
  const text = String(label || "").trim();
  if (text && !session.steps.includes(text) && session.steps.length < 12) session.steps.push(text);
}

export async function getRoster(session) {
  if (session.rosterLoaded) return session.roster;
  if (!session.permissions.canSeeTeam) return session.roster;
  try {
    const snap = await db(session).collection("users").where("storeId", "==", session.storeId).limit(300).get();
    session.roster = snap.docs.map((d) => rosterEntry({ ...d.data(), id: d.id }));
    session.rosterLoaded = true;
  } catch {
    /* Fall back to the roster supplied with the context. */
  }
  return session.roster;
}

// Resolves a person the user mentioned. Crew can only ever resolve themselves.
export async function findPerson(session, query, { allowSelf = true } = {}) {
  const roster = session.permissions.canSeeTeam
    ? await getRoster(session)
    : session.roster.filter((m) => m.id === session.uid);
  const result = resolveMember(roster, query, { selfId: allowSelf ? session.uid : null });
  if (result.status === "ambiguous") {
    session.ambiguity = { query: String(query), candidates: result.candidates.map((m) => m.name || "Crew member") };
  }
  return result;
}

export function personProblem(result, query) {
  if (result.status === "ambiguous") {
    return {
      ok: false,
      needsClarification: true,
      error: "More than one person matches \"" + String(query) + "\".",
      candidates: result.candidates.map(memberLabel),
      instruction: "Call ask_user and offer these people's names as suggestions.",
    };
  }
  return {
    ok: false,
    notFound: true,
    error: "Nobody called \"" + String(query) + "\" is in your store's team.",
    closestMatches: (result.suggestions || []).map(memberLabel),
    instruction: (result.suggestions || []).length
      ? "Ask the user whether they meant one of the closest matches (use ask_user with their names as suggestions)."
      : "Tell the user you couldn't find that person in their store.",
  };
}

// Fresh, store-checked read of one team member (cached per request).
export async function loadMember(session, memberId, { fresh = false } = {}) {
  if (!memberId) return null;
  if (!fresh && session.cache.members.has(memberId)) return session.cache.members.get(memberId);
  const snap = await db(session).doc("users/" + memberId).get();
  const member =
    snap.exists && snap.data()?.storeId === session.storeId ? rosterEntry({ ...snap.data(), id: snap.id }) : null;
  session.cache.members.set(memberId, member);
  return member;
}

export function forgetMember(session, memberId) {
  session.cache.members.delete(memberId);
  session.cache.shifts.delete(memberId);
}

export async function memberShifts(session, memberId) {
  if (session.cache.shifts.has(memberId)) return session.cache.shifts.get(memberId);
  const snap = await shiftsRef(session).where("userId", "==", memberId).limit(500).get();
  const list = sortShifts(snap.docs.map((d) => ({ id: d.id, ...serialise(d.data()) })));
  session.cache.shifts.set(memberId, list);
  return list;
}

export async function futureShiftsOf(session, memberId) {
  const list = await memberShifts(session, memberId);
  return {
    future: list.filter((s) => String(s.date || "") >= session.today),
    past: list.filter((s) => String(s.date || "") < session.today),
  };
}

export async function deleteDocsInChunks(session, refs) {
  for (let i = 0; i < refs.length; i += 400) {
    const batch = db(session).batch();
    for (const ref of refs.slice(i, i + 400)) batch.delete(ref);
    await batch.commit();
  }
}

export async function storeShifts(session, from, to) {
  const snap = await shiftsRef(session).where("date", ">=", from).where("date", "<=", to).limit(800).get();
  return sortShifts(snap.docs.map((d) => ({ id: d.id, ...serialise(d.data()) })));
}

export async function writeAudit(session, { action, target = null, before = null, after = null, details = null, pendingId = null }) {
  try {
    await db(session)
      .collection("stores")
      .doc(session.storeId)
      .collection("assistantAudit")
      .add(
        clean({
          action,
          actorId: session.uid,
          actorName: session.profile.name || "Team member",
          actorRole: session.role,
          targetUserId: target?.id || null,
          targetUserName: target?.name || null,
          before: serialise(before) ?? null,
          after: serialise(after) ?? null,
          details: serialise(details) ?? null,
          pendingId: pendingId || null,
          source: "mcassist",
          createdAt: session.deps.FieldValue.serverTimestamp(),
          createdAtMs: session.deps.now(),
        }),
      );
    return true;
  } catch (error) {
    console.error("McAssist audit write failed", { action, message: error?.message });
    return false;
  }
}
