// GET /api/training-progress
// Team learning overview for Managers and Crew Trainers. Returns compact,
// store-scoped learning progress for every team member in the caller's store.
// Permissions are always re-checked here with the Admin SDK profile; the
// browser role is never trusted.
import {
  adminDb as defaultAdminDb,
  canSeeTeam,
  getAuthenticatedProfile as defaultGetAuthenticatedProfile,
  normalizeRole,
  roleLabel,
} from "../server/portal-admin.js";

const MAX_MEMBERS = 150;
const MAX_MODULES = 100;

// Firestore Timestamps, {seconds} objects, ISO strings and numbers all become
// epoch milliseconds (or null).
export function toMillis(value) {
  if (value == null || value === "") return null;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "object" && Number.isFinite(value.seconds))
    return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6);
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

export function compactProgress(docs) {
  const progress = {};
  for (const d of docs) {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(d.id)) continue;
    const value = d.data() || {};
    const score = Number(value.score);
    progress[d.id] = {
      completed: value.completed === true,
      completedAt: value.completed === true ? toMillis(value.completedAt) : null,
      score: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : null,
    };
  }
  return progress;
}

function inactive(member) {
  return (
    member.deactivated === true ||
    member.disabled === true ||
    ["inactive", "deactivated", "disabled"].includes(String(member.status || "").toLowerCase())
  );
}

export function createHandler({
  getAuthenticatedProfile = defaultGetAuthenticatedProfile,
  adminDb = defaultAdminDb,
} = {}) {
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ error: "Method not allowed" });
    }
    try {
      const { profile } = await getAuthenticatedProfile(req);
      if (!canSeeTeam(profile.role))
        return res.status(403).json({
          error: "Team learning progress is available to Managers and Crew Trainers.",
        });
      const storeId = String(profile.storeId || "");
      if (!storeId)
        return res.status(403).json({ error: "Your profile needs a store ID." });

      const db = adminDb();
      const teamSnap = await db
        .collection("users")
        .where("storeId", "==", storeId)
        .limit(MAX_MEMBERS)
        .get();
      const people = teamSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        // Defence in depth: never return someone from another store.
        .filter((m) => m.storeId === storeId && !inactive(m));

      const progressSnaps = await Promise.all(
        people.map((m) =>
          db
            .collection("users")
            .doc(m.id)
            .collection("portalTraining")
            .limit(MAX_MODULES)
            .get()
            .catch(() => null),
        ),
      );

      const members = people
        .map((m, i) => ({
          id: m.id,
          name: String(m.name || "Crew member").slice(0, 80),
          role: normalizeRole(m.role),
          roleLabel: roleLabel(m.role),
          verifiedStations: Array.isArray(m.verifiedStations)
            ? m.verifiedStations.filter((s) => typeof s === "string").slice(0, 30)
            : [],
          progress: progressSnaps[i] ? compactProgress(progressSnaps[i].docs) : {},
          progressAvailable: Boolean(progressSnaps[i]),
          you: m.id === profile.id,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "en-GB"));

      return res.status(200).json({
        store: { id: storeId, name: String(profile.storeName || "") },
        viewer: { id: profile.id, role: normalizeRole(profile.role) },
        generatedAt: Date.now(),
        members,
      });
    } catch (error) {
      if (!error.status)
        console.error("Training progress request failed", {
          name: error.name,
          message: error.message,
        });
      return res.status(error.status || 500).json({
        error: error.status ? error.message : "Could not load team learning progress.",
      });
    }
  };
}

export default createHandler();
