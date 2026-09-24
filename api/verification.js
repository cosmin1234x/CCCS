import {
  FieldValue,
  adminDb,
  canVerify,
  cleanText,
  findStoreMember,
  getAuthenticatedProfile,
  normalizeRole,
} from "../server/portal-admin.js";

const STATIONS = {
  fries: "Fries",
  fry: "Fries",
  grill: "Grill",
  beef: "Grill",
  chicken: "Chicken & Fryer",
  fryer: "Chicken & Fryer",
  "chicken fryer": "Chicken & Fryer",
  "front counter": "Front Counter",
  counter: "Front Counter",
  till: "Front Counter",
  "drive thru": "Drive-thru",
  "drive-thru": "Drive-thru",
  headset: "Drive-thru",
  drinks: "Drinks & McCafé",
  mccafe: "Drinks & McCafé",
  "mc cafe": "Drinks & McCafé",
  assembly: "Kitchen Assembly",
  kitchen: "Kitchen Assembly",
  breakfast: "Breakfast",
  lobby: "Dining Area",
  "dining area": "Dining Area",
  cleaning: "Dining Area",
};

// Canonical names as shown in the app (e.g. "Chicken & Fryer") are accepted
// case-insensitively, as well as the short aliases above.
const CANONICAL = [...new Set(Object.values(STATIONS))];

export function normaliseStation(value) {
  const key = cleanText(value, 80).toLowerCase().replace(/\s+/g, " ");
  if (!key) return null;
  return (
    STATIONS[key] ||
    CANONICAL.find((name) => name.toLowerCase() === key) ||
    STATIONS[key.replace(/\s*&\s*/g, " ").replace(/é/g, "e")] ||
    null
  );
}

function serialise(value) {
  if (value == null) return value;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (Array.isArray(value)) return value.map(serialise);
  if (typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, serialise(v)]));
  return value;
}

function safeSignature(body) {
  const typedName = cleanText(body.typedName, 100);
  const signatureData = String(body.signatureData || "");
  if (typedName.length < 2)
    throw Object.assign(new Error("Type your full name before signing."), { status: 400 });
  if (signatureData && (!signatureData.startsWith("data:image/png;base64,") || signatureData.length > 140000))
    throw Object.assign(new Error("Signature image is invalid or too large."), { status: 400 });
  return { typedName, signatureData: signatureData || null };
}

async function readVerification(db, storeId, id) {
  const ref = db.collection("stores").doc(storeId).collection("verifications").doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw Object.assign(new Error("Verification not found."), { status: 404 });
  return { ref, data: { id: snap.id, ...snap.data() } };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const { decoded, profile } = await getAuthenticatedProfile(req);
    const db = adminDb();
    const storeId = profile.storeId;

    if (req.method === "GET") {
      const id = cleanText(req.query?.id, 120);
      const ref = db.collection("stores").doc(storeId).collection("verifications");

      if (id) {
        const item = await readVerification(db, storeId, id);
        const v = item.data;
        const allowed =
          decoded.uid === v.crewId ||
          decoded.uid === v.trainerId ||
          normalizeRole(profile.role) === "manager";
        if (!allowed)
          return res.status(403).json({ error: "You cannot view this verification." });
        return res.status(200).json({ verification: serialise(v) });
      }

      const snap =
        normalizeRole(profile.role) === "crew"
          ? await ref.where("crewId", "==", decoded.uid).limit(100).get()
          : await ref.limit(200).get();
      return res.status(200).json({
        verifications: snap.docs.map((d) => serialise({ id: d.id, ...d.data() })),
      });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ error: "Method not allowed" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const action = cleanText(body.action, 40);

    if (action === "create") {
      if (!canVerify(profile.role))
        return res.status(403).json({ error: "Only Crew Trainers can start a verification." });

      const crew = await findStoreMember(storeId, body.crewId || body.crewName);
      if (!crew) return res.status(404).json({ error: "Crew member not found in your store." });
      if (crew.id === decoded.uid)
        return res.status(400).json({ error: "A Crew Trainer cannot verify themselves." });
      if (normalizeRole(crew.role) !== "crew")
        return res.status(400).json({ error: "Station verification is for Crew Members." });

      const station = normaliseStation(body.station);
      if (!station) return res.status(400).json({ error: "Choose a supported station." });

      const verificationRef = db.collection("stores").doc(storeId).collection("verifications");
      const recent = await verificationRef.where("crewId", "==", crew.id).limit(50).get();
      const existing = recent.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .find((v) => v.station === station && v.status === "pending_signatures");
      if (existing)
        return res.status(200).json({
          verification: serialise(existing),
          uiAction: { type: "openVerification", id: existing.id },
          reply: "That verification is already waiting for signatures.",
        });

      const created = await verificationRef.add({
        storeId,
        crewId: crew.id,
        crewName: crew.name || "Crew member",
        trainerId: decoded.uid,
        trainerName: profile.name || "Crew Trainer",
        station,
        status: "pending_signatures",
        crewSignature: null,
        trainerSignature: null,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: decoded.uid,
      });
      return res.status(201).json({
        verification: {
          id: created.id,
          crewId: crew.id,
          crewName: crew.name || "Crew member",
          trainerId: decoded.uid,
          trainerName: profile.name || "Crew Trainer",
          station,
          status: "pending_signatures",
        },
        uiAction: { type: "openVerification", id: created.id },
        reply: "Verification opened for " + (crew.name || "the crew member") + " on " + station + ". Both signatures are required.",
      });
    }

    if (action === "sign") {
      const id = cleanText(body.id, 120);
      if (!id) return res.status(400).json({ error: "Verification ID is required." });
      const signature = safeSignature(body);
      const item = await readVerification(db, storeId, id);
      const current = item.data;

      const isCrew = decoded.uid === current.crewId;
      const isTrainer = decoded.uid === current.trainerId && canVerify(profile.role);
      if (!isCrew && !isTrainer)
        return res.status(403).json({ error: "You are not one of the two people assigned to sign this verification." });
      if (current.status === "verified")
        return res.status(200).json({ verification: serialise(current), reply: "This station is already verified." });

      await db.runTransaction(async (tx) => {
        const snap = await tx.get(item.ref);
        if (!snap.exists) throw Object.assign(new Error("Verification not found."), { status: 404 });
        const latest = snap.data();
        const field = isCrew ? "crewSignature" : "trainerSignature";
        const otherField = isCrew ? "trainerSignature" : "crewSignature";
        if (latest.status === "verified")
          throw Object.assign(new Error("This station is already verified."), { status: 409 });
        if (latest[field])
          throw Object.assign(new Error("You have already signed this verification."), { status: 409 });
        const ownSignature = {
          uid: decoded.uid,
          name: profile.name || signature.typedName,
          typedName: signature.typedName,
          signatureData: signature.signatureData,
          signedAt: FieldValue.serverTimestamp(),
        };
        const bothSigned = Boolean(latest[otherField]);
        const update = {
          [field]: ownSignature,
          updatedAt: FieldValue.serverTimestamp(),
        };
        if (bothSigned) {
          update.status = "verified";
          update.completedAt = FieldValue.serverTimestamp();
        }
        tx.update(item.ref, update);
        if (bothSigned) {
          tx.set(
            db.collection("users").doc(latest.crewId),
            {
              verifiedStations: FieldValue.arrayUnion(latest.station),
              lastVerificationAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
        }
      });

      const fresh = await item.ref.get();
      const verification = serialise({ id: fresh.id, ...fresh.data() });
      return res.status(200).json({
        verification,
        reply:
          verification.status === "verified"
            ? verification.crewName + " is now verified on " + verification.station + "."
            : "Your signature is saved. The other signature is still required.",
      });
    }

    return res.status(400).json({ error: "Unknown verification action." });
  } catch (error) {
    console.error("Verification request failed", { name: error.name, message: error.message });
    return res
      .status(error.status || 500)
      .json({ error: error.status ? error.message : "Could not update verification." });
  }
}
