// seed-auth-users.cjs
// Creates Firebase Auth users + matching Firestore user profiles

const admin = require("firebase-admin");
const path = require("path");

const serviceAccount = require(path.join(__dirname, "serviceAccountKey.json"));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const auth = admin.auth();
const db = admin.firestore();

const STORE_ID = "store001";

// 🔴 CHANGE emails if you want real logins
const USERS = [
  {
    name: "Cosmin Blidaru",
    email: "cosmin.blidaru@test.com",
    password: "McDonalds123!",
    role: "crew",
    maxHoursPerWeek: 40,
    skills: { grill: true, chicken: true, line: true, fries: true, front: true, drive: true },
    availability: {
      mon: [{ start: "16:00", end: "23:00" }],
      tue: [{ start: "16:00", end: "23:00" }],
      wed: [{ start: "16:00", end: "23:00" }],
      thu: [{ start: "16:00", end: "23:00" }],
      fri: [{ start: "16:00", end: "23:00" }],
      sat: [{ start: "12:00", end: "23:00" }],
      sun: [{ start: "12:00", end: "22:00" }],
    },
  },
  {
    name: "Shynia Westwood",
    email: "shynia.westwood@test.com",
    password: "McDonalds123!",
    role: "crew",
    maxHoursPerWeek: 32,
    skills: { grill: false, chicken: true, line: true, fries: true, front: true, drive: true },
    availability: {
      mon: [{ start: "16:00", end: "22:00" }],
      tue: [{ start: "16:00", end: "22:00" }],
      wed: [{ start: "16:00", end: "22:00" }],
      thu: [{ start: "16:00", end: "22:00" }],
      fri: [{ start: "16:00", end: "22:00" }],
      sat: [{ start: "12:00", end: "20:00" }],
      sun: [{ start: "12:00", end: "20:00" }],
    },
  },
  {
    name: "Alex Trey",
    email: "alex.trey@test.com",
    password: "McDonalds123!",
    role: "crew",
    maxHoursPerWeek: 40,
    skills: { grill: true, chicken: false, line: true, fries: true, front: false, drive: true },
    availability: {
      mon: [{ start: "16:00", end: "23:00" }],
      tue: [{ start: "16:00", end: "23:00" }],
      wed: [{ start: "16:00", end: "23:00" }],
      thu: [{ start: "16:00", end: "23:00" }],
      fri: [{ start: "16:00", end: "23:00" }],
      sat: [{ start: "12:00", end: "23:00" }],
      sun: [{ start: "12:00", end: "22:00" }],
    },
  },
];

async function upsertAuthUser(email, password, displayName) {
  try {
    const existing = await auth.getUserByEmail(email);
    await auth.updateUser(existing.uid, { password, displayName });
    return existing.uid;
  } catch (err) {
    if (err.code !== "auth/user-not-found") throw err;
    const created = await auth.createUser({ email, password, displayName });
    return created.uid;
  }
}

async function run() {
  for (const u of USERS) {
    const uid = await upsertAuthUser(u.email, u.password, u.name);

    await db.collection("users").doc(uid).set(
      {
        name: u.name,
        email: u.email,
        role: u.role,
        storeId: STORE_ID,
        maxHoursPerWeek: u.maxHoursPerWeek,
        skills: u.skills,
        availability: u.availability,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    console.log(`✅ Auth + Firestore created: ${u.name} (${uid})`);
  }

  console.log("🎉 All crew accounts ready");
  process.exit(0);
}

run().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
