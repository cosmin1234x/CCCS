import {
  adminDb,
  canPlanShifts,
  canSeeTeam,
  canVerify,
  getAuthenticatedProfile,
  isoDate,
  publicProfile,
} from "../server/portal-admin.js";

function serialise(value) {
  if (value == null) return value;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (Array.isArray(value)) return value.map(serialise);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, serialise(v)]));
  }
  return value;
}

const fromDocs = (snap) =>
  snap.docs.map((d) => ({ id: d.id, ...serialise(d.data()) }));

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { decoded, profile } = await getAuthenticatedProfile(req);
    const db = adminDb();
    const storeId = profile.storeId;
    const isManager = canPlanShifts(profile.role);
    const isTrainer = canVerify(profile.role);

    const shiftsRef = db.collection("stores").doc(storeId).collection("Shifts");
    const shiftsPromise = isManager
      ? shiftsRef.where("date", ">=", isoDate()).limit(250).get()
      : shiftsRef.where("userId", "==", decoded.uid).limit(120).get();

    const progressPromise = db
      .collection("users")
      .doc(decoded.uid)
      .collection("portalTraining")
      .limit(100)
      .get();

    const teamPromise = canSeeTeam(profile.role)
      ? db.collection("users").where("storeId", "==", storeId).limit(150).get()
      : Promise.resolve(null);

    const verificationRef = db
      .collection("stores")
      .doc(storeId)
      .collection("verifications");
    const verificationPromise = profile.role === "crew"
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

    const [shiftsSnap, progressSnap, teamSnap, verificationSnap, roleRequestSnap] =
      await Promise.all([
        shiftsPromise,
        progressPromise,
        teamPromise,
        verificationPromise,
        roleRequestsPromise,
      ]);

    const progress = Object.fromEntries(
      progressSnap.docs.map((d) => [d.id, serialise(d.data())]),
    );

    const team = teamSnap
      ? teamSnap.docs.map((d) => publicProfile({ id: d.id, ...d.data() }))
      : [];

    return res.status(200).json({
      profile: publicProfile(profile),
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
      verifications: fromDocs(verificationSnap).sort(
        (a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0),
      ),
      roleRequests: roleRequestSnap ? fromDocs(roleRequestSnap) : [],
    });
  } catch (error) {
    console.error("Portal data request failed", { name: error.name, message: error.message });
    return res
      .status(error.status || 500)
      .json({ error: error.status ? error.message : "Could not load portal data." });
  }
}
