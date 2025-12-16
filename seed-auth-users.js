import admin from "firebase-admin";
import serviceAccount from "./serviceAccountKey.json" assert { type: "json" };

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

const storeId = "store001";

const staff = [
  {
    name: "Cosmin Blidaru",
    email: "cosmin.blidaru@demo-store.com",
    password: "Temp12345!",
    role: "shiftCreator",
    maxHoursPerWeek: 40,
    skills: { grill:true, chicken:false, line:true, fries:true, front:true, drive:false },
    availability: {
      mon:[{start:"16:00", end:"23:00"}],
      tue:[{start:"16:00", end:"23:00"}],
      wed:[{start:"16:00", end:"23:00"}],
      thu:[{start:"16:00", end:"23:00"}],
      fri:[{start:"16:00", end:"23:00"}],
      sat:[{start:"12:00", end:"23:00"}],
      sun:[{start:"12:00", end:"22:00"}],
    },
  },
  {
    name: "Shynia Westwood",
    email: "shynia.westwood@demo-store.com",
    password: "Temp12345!",
    role: "crew",
    maxHoursPerWeek: 32,
    skills: { grill:false, chicken:true, line:true, fries:true, front:true, drive:true },
    availability: {
      mon:[{start:"17:00", end:"23:00"}],
      tue:[{start:"17:00", end:"23:00"}],
      wed:[{start:"17:00", end:"23:00"}],
      thu:[{start:"17:00", end:"23:00"}],
      fri:[{start:"17:00", end:"23:00"}],
      sat:[{start:"12:00", end:"23:00"}],
      sun:[{start:"12:00", end:"22:00"}],
    },
  },
  {
    name: "Alex Trey",
    email: "alex.trey@demo-store.com",
    password: "Temp12345!",
    role: "crew",
    maxHoursPerWeek: 32,
    skills: { grill:true, chicken:true, line:true },
    availability: {
      mon:[{start:"17:00", end:"23:00"}],
      tue:[{start:"17:00", end:"23:00"}],
      wed:[{start:"17:00", end:"23:00"}],
      thu:[{start:"17:00", end:"23:00"}],
      fri:[{start:"17:00", end:"23:30"}],
      sat:[{start:"16:00", end:"23:30"}],
      sun:[{start:"16:00", end:"22:30"}],
    },
  },
];

async function upsertUser(person) {
  let user;

  try {
    user = await admin.auth().getUserByEmail(person.email);
    console.log(`ℹ️ Auth exists: ${person.email}`);
  } catch {
    user = await admin.auth().createUser({
      email: person.email,
      password: person.password,
      displayName: person.name,
    });
    console.log(`✅ Created Auth: ${person.email}`);
  }

  await db.collection("users").doc(user.uid).set(
    {
      name: person.name,
      email: person.email,
      role: person.role,
      storeId,
      maxHoursPerWeek: person.maxHoursPerWeek,
      skills: person.skills,
      availability: person.availability,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  console.log(`✅ Firestore profile saved for ${person.name}`);
}

async function main() {
  for (const p of staff) {
    await upsertUser(p);
  }
  console.log("🎉 AUTH + USERS SEEDED SUCCESSFULLY");
  process.exit(0);
}

main().catch(console.error);
