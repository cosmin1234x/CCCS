// Seeds the LOCAL Firebase emulators with a realistic restaurant for the
// end-to-end harness. It never touches production: assertLocalEmulators()
// refuses to run unless both emulator hosts point at 127.0.0.1 and the
// project is a demo-* project.
//
//   node scripts/e2e-seed.mjs            wipe the emulators, then seed
//   node scripts/e2e-seed.mjs --no-wipe  seed on top of existing data
//
// Tests import { resetAndSeed, SEED, adminFor } from this file.
import { pathToFileURL } from "node:url";
import { deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { assertLocalEmulators, e2eEnv } from "./e2e-guard.mjs";

export const E2E_PASSWORD = "hayle-e2e-2026";

const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Monday-based week dates (same rule as portal-core.js weekDates).
export function weekDates(offset = 0, now = new Date()) {
  const start = new Date(now);
  start.setHours(12, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7) + offset * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return iso(d);
  });
}

export function daysFromToday(n, now = new Date()) {
  const d = new Date(now);
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return iso(d);
}

const open = (start, end) => ({ available: true, start, end });
const off = () => ({ available: false, start: "09:00", end: "17:00" });

// Fixed UIDs keep the specs readable ("e2e-cosmin" instead of random IDs).
export const SEED = {
  password: E2E_PASSWORD,
  store: { id: "1170", name: "1170 · Hayle" },
  otherStore: { id: "2280", name: "2280 · Truro" },
  users: {
    maya: {
      uid: "e2e-maya",
      name: "Maya Manager",
      email: "maya.manager@e2e.test",
      role: "manager",
      storeId: "1170",
      hourlyRate: 14.5,
      stars: 20,
      badge: "Shift lead",
    },
    tara: {
      uid: "e2e-tara",
      name: "Tara Trainer",
      email: "tara.trainer@e2e.test",
      role: "crewTrainer",
      storeId: "1170",
      hourlyRate: 12.9,
      stars: 14,
      badge: "Crew Trainer",
    },
    cosmin: {
      uid: "e2e-cosmin",
      name: "Cosmin Blidaru",
      email: "cosmin@e2e.test",
      role: "crew",
      storeId: "1170",
      hourlyRate: 12.55,
      stars: 12,
      badge: "Team player",
      availability: {
        mon: open("09:00", "23:00"),
        tue: open("09:00", "23:00"),
        wed: off(),
        thu: open("09:00", "23:00"),
        fri: open("09:00", "23:00"),
        sat: open("09:00", "23:00"),
        sun: off(),
      },
    },
    amelia: {
      uid: "e2e-amelia",
      name: "Amelia Wilson",
      email: "amelia@e2e.test",
      role: "crew",
      storeId: "1170",
      hourlyRate: 12.21,
      stars: 7,
      verifiedStations: ["Fries"],
      availability: {
        mon: open("07:00", "20:00"),
        tue: open("07:00", "20:00"),
        wed: open("07:00", "20:00"),
        thu: open("07:00", "20:00"),
        fri: open("07:00", "20:00"),
        sat: off(),
        sun: open("10:00", "18:00"),
      },
    },
    ryan: {
      uid: "e2e-ryan",
      name: "Ryan Davies",
      email: "ryan@e2e.test",
      role: "crew",
      storeId: "1170",
      hourlyRate: 12.21,
      stars: 5,
      availability: {
        mon: open("16:00", "23:59"),
        tue: open("16:00", "23:59"),
        wed: open("16:00", "23:59"),
        thu: open("16:00", "23:59"),
        fri: open("16:00", "23:59"),
        sat: open("09:00", "23:59"),
        sun: open("09:00", "23:59"),
      },
    },
    priya: {
      uid: "e2e-priya",
      name: "Priya Shah",
      email: "priya@e2e.test",
      role: "crew",
      storeId: "1170",
      stars: 3,
      requestedRole: "crewTrainer",
      roleRequestStatus: "pending",
    },
    owen: {
      uid: "e2e-owen",
      name: "Owen Truro",
      email: "owen.manager@e2e.test",
      role: "manager",
      storeId: "2280",
      stars: 4,
    },
    olivia: {
      uid: "e2e-olivia",
      name: "Olivia Truro",
      email: "olivia@e2e.test",
      role: "crew",
      storeId: "2280",
      stars: 2,
      availability: {
        mon: open("09:00", "17:00"),
        tue: open("09:00", "17:00"),
        wed: open("09:00", "17:00"),
        thu: open("09:00", "17:00"),
        fri: open("09:00", "17:00"),
      },
    },
  },
};

const storeName = (storeId) =>
  storeId === SEED.store.id ? SEED.store.name : SEED.otherStore.name;

// Shifts are relative to "now" so the rota always looks current.
export function seedShifts(now = new Date()) {
  const next = weekDates(1, now);
  const u = SEED.users;
  const shift = (id, user, date, start, end, station, breakMinutes = 30) => ({
    id,
    storeId: user.storeId,
    data: {
      userId: user.uid,
      userName: user.name,
      role: user.role,
      date,
      start,
      end,
      station,
      breakMinutes,
      createdBy: user.storeId === "1170" ? u.maya.uid : u.owen.uid,
    },
  });
  return [
    shift("e2e-shift-amelia-today", u.amelia, daysFromToday(0, now), "08:00", "16:00", "Fries"),
    shift("e2e-shift-ryan-tomorrow", u.ryan, daysFromToday(1, now), "17:00", "23:00", "Drive-thru"),
    shift("e2e-shift-cosmin-soon", u.cosmin, daysFromToday(2, now), "16:00", "23:00", "Drive-thru"),
    // Cosmin already works next Friday: McAssist must plan around it.
    shift("e2e-shift-cosmin-nextfri", u.cosmin, next[4], "17:00", "23:00", "Fries"),
    shift("e2e-shift-amelia-nextmon", u.amelia, next[0], "08:00", "14:00", "Front Counter"),
    shift("e2e-shift-olivia", u.olivia, daysFromToday(1, now), "09:00", "15:00", "Front Counter"),
  ];
}

export function adminFor(name = "e2e-admin") {
  assertLocalEmulators(process.env, name);
  const existing = getApps().find((a) => a.name === name);
  const app =
    existing || initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID }, name);
  return { app, auth: getAuth(app), db: getFirestore(app) };
}

export async function wipeEmulators() {
  const project = assertLocalEmulators(process.env, "e2e-seed wipe");
  const fsHost = process.env.FIRESTORE_EMULATOR_HOST;
  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const calls = [
    fetch(`http://${fsHost}/emulator/v1/projects/${project}/databases/(default)/documents`, {
      method: "DELETE",
    }),
    fetch(`http://${authHost}/emulator/v1/projects/${project}/accounts`, {
      method: "DELETE",
    }),
  ];
  const responses = await Promise.all(calls);
  for (const r of responses)
    if (!r.ok) throw new Error("Emulator wipe failed: " + r.status + " " + (await r.text()));
}

export async function seed({ now = new Date() } = {}) {
  const { auth, db } = adminFor("e2e-seed");
  const created = Timestamp.fromDate(new Date(now.getTime() - 14 * 86400000));

  // Auth accounts (emulator only) with known passwords.
  await Promise.all(
    Object.values(SEED.users).map((u) =>
      auth.createUser({
        uid: u.uid,
        email: u.email,
        password: SEED.password,
        displayName: u.name,
        emailVerified: true,
      }),
    ),
  );

  const batch = db.batch();
  batch.set(db.doc("stores/" + SEED.store.id), {
    storeId: SEED.store.id,
    storeName: SEED.store.name,
    address: "Carwin Rise, Loggans, TR27 5DG",
  });
  batch.set(db.doc("stores/" + SEED.otherStore.id), {
    storeId: SEED.otherStore.id,
    storeName: SEED.otherStore.name,
  });

  for (const u of Object.values(SEED.users)) {
    const { uid, ...profile } = u;
    batch.set(db.doc("users/" + uid), {
      verifiedStations: [],
      notes: "",
      ...profile,
      storeName: storeName(u.storeId),
      createdAt: created,
    });
  }

  // Pending role request (Priya wants Crew Trainer access).
  batch.set(db.doc("roleRequests/" + SEED.users.priya.uid), {
    uid: SEED.users.priya.uid,
    name: SEED.users.priya.name,
    email: SEED.users.priya.email,
    storeId: SEED.users.priya.storeId,
    requestedRole: "crewTrainer",
    status: "pending",
    createdAt: created,
  });

  for (const s of seedShifts(now))
    batch.set(db.doc(`stores/${s.storeId}/Shifts/${s.id}`), {
      ...s.data,
      createdAt: created,
    });

  // Learning progress.
  batch.set(db.doc(`users/${SEED.users.cosmin.uid}/portalTraining/first-shift`), {
    completed: true,
    xp: 80,
    completedAt: now.getTime() - 3 * 86400000,
  });
  batch.set(db.doc(`users/${SEED.users.amelia.uid}/portalTraining/first-shift`), {
    completed: true,
    xp: 80,
    completedAt: now.getTime() - 7 * 86400000,
  });
  batch.set(db.doc(`users/${SEED.users.amelia.uid}/portalTraining/food-safety`), {
    completed: true,
    xp: 90,
    completedAt: now.getTime() - 6 * 86400000,
  });

  // A completed two-signature verification for Amelia on Fries.
  batch.set(db.doc(`stores/${SEED.store.id}/verifications/e2e-verify-amelia-fries`), {
    storeId: SEED.store.id,
    crewId: SEED.users.amelia.uid,
    crewName: SEED.users.amelia.name,
    trainerId: SEED.users.tara.uid,
    trainerName: SEED.users.tara.name,
    station: "Fries",
    status: "verified",
    crewSignature: { uid: SEED.users.amelia.uid, name: SEED.users.amelia.name, typedName: SEED.users.amelia.name, signatureData: null, signedAt: created },
    trainerSignature: { uid: SEED.users.tara.uid, name: SEED.users.tara.name, typedName: SEED.users.tara.name, signatureData: null, signedAt: created },
    createdAt: created,
    completedAt: created,
    createdBy: SEED.users.tara.uid,
  });

  // Recognition history.
  batch.set(db.doc(`stores/${SEED.store.id}/recognition/e2e-recognition-1`), {
    userId: SEED.users.amelia.uid,
    userName: SEED.users.amelia.name,
    amount: 2,
    note: "Brilliant lunch rush on fries",
    createdBy: SEED.users.maya.uid,
    createdAt: created,
  });

  await batch.commit();
  return SEED;
}

export async function resetAndSeed(options) {
  await wipeEmulators();
  return seed(options);
}

export async function closeAdminApps() {
  await Promise.all(getApps().filter((a) => a.name.startsWith("e2e-")).map((a) => deleteApp(a)));
}

// CLI entry point.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Fill in the local defaults, but never override something that points elsewhere:
  // the guard below then refuses to continue.
  for (const [key, value] of Object.entries(e2eEnv()))
    if (process.env[key] === undefined) process.env[key] = value;
  try {
    assertLocalEmulators(process.env, "e2e-seed");
    if (!process.argv.includes("--no-wipe")) await wipeEmulators();
    await seed();
    console.log(
      `Seeded ${Object.keys(SEED.users).length} accounts in stores ${SEED.store.id} and ${SEED.otherStore.id} (password "${SEED.password}").`,
    );
    await closeAdminApps();
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}
