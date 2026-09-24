import {
  FieldValue,
  adminDb,
  canPlanShifts,
  cleanText,
  getAuthenticatedProfile,
  normalizeRole,
} from "../server/portal-admin.js";

const ALLOWED = new Set(["crewTrainer", "manager"]);

function serialise(value) {
  if (value == null) return value;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (Array.isArray(value)) return value.map(serialise);
  if (typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, serialise(v)]));
  return value;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const { decoded, profile } = await getAuthenticatedProfile(req);
    const db = adminDb();

    if (req.method === "GET") {
      if (!canPlanShifts(profile.role))
        return res.status(403).json({ error: "Only managers can review role requests." });
      const snap = await db
        .collection("roleRequests")
        .where("storeId", "==", profile.storeId)
        .where("status", "==", "pending")
        .limit(100)
        .get();
      return res.status(200).json({
        requests: snap.docs.map((d) => serialise({ id: d.id, ...d.data() })),
      });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ error: "Method not allowed" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const action = cleanText(body.action, 20);

    if (action === "request") {
      const requestedRole = normalizeRole(body.requestedRole);
      if (!ALLOWED.has(requestedRole))
        return res.status(400).json({ error: "Choose Crew Trainer or Manager." });

      await db.collection("roleRequests").doc(decoded.uid).set(
        {
          uid: decoded.uid,
          name: profile.name || "Crew member",
          email: profile.email || decoded.email || "",
          storeId: profile.storeId,
          requestedRole,
          status: "pending",
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      await db.collection("users").doc(decoded.uid).set(
        {
          requestedRole,
          roleRequestStatus: "pending",
          roleRequestUpdatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return res.status(200).json({ ok: true, requestedRole });
    }

    if (!canPlanShifts(profile.role))
      return res.status(403).json({ error: "Only managers can approve role requests." });

    const uid = cleanText(body.uid, 128);
    if (!uid) return res.status(400).json({ error: "User ID is required." });
    const requestRef = db.collection("roleRequests").doc(uid);
    const userRef = db.collection("users").doc(uid);
    const [requestSnap, userSnap] = await Promise.all([requestRef.get(), userRef.get()]);
    if (!requestSnap.exists || !userSnap.exists)
      return res.status(404).json({ error: "Role request not found." });
    const request = requestSnap.data();
    const user = userSnap.data();
    if (request.storeId !== profile.storeId || user.storeId !== profile.storeId)
      return res.status(403).json({ error: "That account belongs to another store." });
    if (uid === decoded.uid)
      return res.status(403).json({ error: "Another manager needs to review your own role request." });
    if (["approve", "reject"].includes(action) && request.status !== "pending")
      return res.status(409).json({
        error: "This request has already been " + (request.status || "reviewed") + ".",
      });

    if (action === "approve") {
      const requestedRole = normalizeRole(request.requestedRole);
      if (!ALLOWED.has(requestedRole))
        return res.status(400).json({ error: "Requested role is invalid." });
      const batch = db.batch();
      batch.set(
        userRef,
        {
          role: requestedRole,
          requestedRole,
          roleRequestStatus: "approved",
          roleApprovedBy: decoded.uid,
          roleApprovedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      batch.set(
        requestRef,
        {
          status: "approved",
          reviewedBy: decoded.uid,
          reviewedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      await batch.commit();
      return res.status(200).json({ ok: true, role: requestedRole });
    }

    if (action === "reject") {
      const batch = db.batch();
      batch.set(
        userRef,
        {
          requestedRole: "",
          roleRequestStatus: "rejected",
          roleApprovedBy: decoded.uid,
          roleApprovedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      batch.set(
        requestRef,
        {
          status: "rejected",
          reviewedBy: decoded.uid,
          reviewedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      await batch.commit();
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: "Unknown role request action." });
  } catch (error) {
    console.error("Role request failed", { name: error.name, message: error.message });
    return res
      .status(error.status || 500)
      .json({ error: error.status ? error.message : "Could not update role request." });
  }
}
