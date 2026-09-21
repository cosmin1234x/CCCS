import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const projectId = process.env.FIREBASE_PROJECT_ID || "mc-training-portal";

function getAdminApp() {
  if (getApps().length) return getApps()[0];
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (raw) {
    let serviceAccount;
    try {
      serviceAccount = JSON.parse(raw);
    } catch {
      throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.");
    }
    return initializeApp({ credential: cert(serviceAccount), projectId });
  }
  return initializeApp({ projectId });
}

export function adminDb() {
  return getFirestore(getAdminApp());
}

export { FieldValue };

export async function authenticateRequest(req) {
  const token = String(req.headers?.authorization || "").match(/^Bearer (.+)$/)?.[1];
  if (!token) throw Object.assign(new Error("Sign in to continue."), { status: 401 });
  try {
    const decoded = await getAuth(getAdminApp()).verifyIdToken(token);
    return { decoded, token };
  } catch {
    throw Object.assign(new Error("Your session has expired. Please sign in again."), { status: 401 });
  }
}

export function normalizeRole(role) {
  const value = String(role || "").toLowerCase().replace(/[\s_-]/g, "");
  if (["manager", "shiftcreator", "admin"].includes(value)) return "manager";
  if (["crewtrainer", "trainer"].includes(value)) return "crewTrainer";
  return "crew";
}

export function roleLabel(role) {
  const normalized = normalizeRole(role);
  return normalized === "manager"
    ? "Manager"
    : normalized === "crewTrainer"
      ? "Crew Trainer"
      : "Crew Member";
}

export function canPlanShifts(role) {
  return normalizeRole(role) === "manager";
}

export function canVerify(role) {
  return normalizeRole(role) === "crewTrainer";
}

export function canSeeTeam(role) {
  return ["manager", "crewTrainer"].includes(normalizeRole(role));
}

export async function getProfile(uid) {
  const snap = await adminDb().doc("users/" + uid).get();
  if (!snap.exists) throw Object.assign(new Error("Your crew profile is missing."), { status: 403 });
  return { id: snap.id, ...snap.data(), role: normalizeRole(snap.data().role) };
}

export async function getAuthenticatedProfile(req) {
  const { decoded, token } = await authenticateRequest(req);
  const profile = await getProfile(decoded.uid);
  if (!profile.storeId) throw Object.assign(new Error("Your profile needs a store ID."), { status: 403 });
  return { decoded, token, profile };
}

export function cleanText(value, max = 120) {
  return String(value ?? "").trim().slice(0, max);
}

export function isoDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function timeOk(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ""));
}

export function shiftDurationMinutes(start, end) {
  if (!timeOk(start) || !timeOk(end)) return 0;
  const mins = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  let duration = mins(end) - mins(start);
  if (duration <= 0) duration += 1440;
  return duration;
}

export async function findStoreMember(storeId, nameOrId) {
  const db = adminDb();
  const exact = cleanText(nameOrId, 120);
  if (!exact) return null;
  const direct = await db.doc("users/" + exact).get();
  if (direct.exists && direct.data().storeId === storeId)
    return { id: direct.id, ...direct.data(), role: normalizeRole(direct.data().role) };

  const snap = await db.collection("users").where("storeId", "==", storeId).limit(100).get();
  const wanted = exact.toLowerCase();
  const members = snap.docs.map((d) => ({ id: d.id, ...d.data(), role: normalizeRole(d.data().role) }));
  return (
    members.find((m) => String(m.name || "").toLowerCase() === wanted) ||
    members.find((m) => String(m.name || "").toLowerCase().startsWith(wanted)) ||
    members.find((m) => String(m.name || "").toLowerCase().includes(wanted)) ||
    null
  );
}

export function publicProfile(profile) {
  return {
    id: profile.id,
    name: profile.name || "Crew member",
    role: normalizeRole(profile.role),
    roleLabel: roleLabel(profile.role),
    storeId: profile.storeId || "",
    storeName: profile.storeName || "",
    stars: Number(profile.stars) || 0,
    badge: profile.badge || "",
    notes: profile.notes || "",
    verifiedStations: Array.isArray(profile.verifiedStations) ? profile.verifiedStations : [],
    requestedRole: profile.requestedRole || "",
    roleRequestStatus: profile.roleRequestStatus || "",
    availability: profile.availability || {},
    hourlyRate: Number.isFinite(Number(profile.hourlyRate)) ? Number(profile.hourlyRate) : null,
  };
}
