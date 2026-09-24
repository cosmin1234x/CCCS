import test from "node:test";
import assert from "node:assert/strict";
import handler, {
  createHandler,
  compactProgress,
  toMillis,
} from "../api/training-progress.js";

function response() {
  return {
    code: 200,
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
    status(n) {
      this.code = n;
      return this;
    },
    json(d) {
      this.data = d;
      return this;
    },
  };
}

const snapOf = (items) => ({
  docs: items.map(([id, value]) => ({ id, data: () => value })),
});

// Minimal Firestore Admin fake: users (with a storeId filter) and each
// user's portalTraining sub-collection.
function fakeDb({ users, training, failTrainingFor = [] }) {
  const calls = { where: [], trainingReads: [] };
  const db = {
    calls,
    collection(name) {
      assert.equal(name, "users");
      return {
        where(field, op, value) {
          calls.where.push([field, op, value]);
          return {
            limit(n) {
              calls.limit = n;
              return {
                async get() {
                  return snapOf(
                    Object.entries(users).filter(
                      ([, u]) => u[field] === value,
                    ),
                  );
                },
              };
            },
          };
        },
        doc(uid) {
          return {
            collection(sub) {
              assert.equal(sub, "portalTraining");
              return {
                limit() {
                  return {
                    async get() {
                      calls.trainingReads.push(uid);
                      if (failTrainingFor.includes(uid))
                        throw new Error("read failed");
                      return snapOf(Object.entries(training[uid] || {}));
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
  return db;
}

const users = {
  "mgr-1": { name: "Cosmin Blidaru", role: "manager", storeId: "1170", storeName: "1170 · Hayle" },
  "crew-1": { name: "Amelia Wilson", role: "crew", storeId: "1170", verifiedStations: ["Fries", 7] },
  "crew-2": { name: "Ryan Davies", role: "Crew", storeId: "1170" },
  "trainer-1": { name: "Maya Patel", role: "trainer", storeId: "1170" },
  "old-1": { name: "Left Store", role: "crew", storeId: "1170", deactivated: true },
  "old-2": { name: "Paused Account", role: "crew", storeId: "1170", status: "inactive" },
  "other-1": { name: "Other Store", role: "crew", storeId: "2222" },
};
const training = {
  "crew-1": {
    "food-safety": {
      completed: true,
      xp: 120,
      score: 100,
      completedAt: { toMillis: () => 1758700000000 },
      secretNote: "not returned",
    },
    allergens: { completed: false, score: 40 },
    "bad id!": { completed: true },
  },
  "crew-2": {
    "first-shift": { completed: true, completedAt: "2026-09-20T10:00:00Z", score: 87.6 },
  },
};

function managerHandler(role = "manager", extra = {}) {
  const db = fakeDb({ users, training, ...extra });
  const h = createHandler({
    getAuthenticatedProfile: async () => ({
      profile: { id: "mgr-1", ...users["mgr-1"], role },
    }),
    adminDb: () => db,
  });
  return { h, db };
}

test("training progress only accepts GET", async () => {
  const r = response();
  await handler({ method: "POST", headers: {} }, r);
  assert.equal(r.code, 405);
  assert.equal(r.headers.Allow, "GET");
});

test("training progress rejects unsigned requests", async () => {
  const r = response();
  await handler({ method: "GET", headers: {} }, r);
  assert.equal(r.code, 401);
  assert.match(r.data.error, /Sign in/);
});

test("crew members cannot read team progress", async () => {
  const db = fakeDb({ users, training });
  const h = createHandler({
    getAuthenticatedProfile: async () => ({
      profile: { id: "crew-1", ...users["crew-1"], role: "crew" },
    }),
    adminDb: () => db,
  });
  const r = response();
  await h({ method: "GET", headers: {} }, r);
  assert.equal(r.code, 403);
  assert.equal(db.calls.where.length, 0, "no Firestore reads for crew");
});

test("managers get compact progress for their own store only", async () => {
  const { h, db } = managerHandler();
  const r = response();
  await h({ method: "GET", headers: {} }, r);
  assert.equal(r.code, 200);
  assert.equal(r.headers["Cache-Control"], "no-store");
  assert.deepEqual(db.calls.where, [["storeId", "==", "1170"]]);
  assert.equal(db.calls.limit, 150);
  const names = r.data.members.map((m) => m.name);
  assert.deepEqual(names, ["Amelia Wilson", "Cosmin Blidaru", "Maya Patel", "Ryan Davies"]);
  assert.ok(!names.includes("Other Store"));
  assert.ok(!names.includes("Left Store"), "deactivated accounts are hidden");
  assert.ok(!names.includes("Paused Account"), "inactive accounts are hidden");
  assert.ok(!db.calls.trainingReads.includes("other-1"));
  const amelia = r.data.members.find((m) => m.id === "crew-1");
  assert.deepEqual(amelia.progress, {
    "food-safety": { completed: true, completedAt: 1758700000000, score: 100 },
    allergens: { completed: false, completedAt: null, score: 40 },
  });
  assert.deepEqual(amelia.verifiedStations, ["Fries"]);
  assert.equal(amelia.role, "crew");
  assert.equal(amelia.roleLabel, "Crew Member");
  const ryan = r.data.members.find((m) => m.id === "crew-2");
  assert.equal(ryan.progress["first-shift"].completedAt, Date.parse("2026-09-20T10:00:00Z"));
  assert.equal(ryan.progress["first-shift"].score, 88);
  assert.equal(r.data.members.find((m) => m.id === "trainer-1").role, "crewTrainer");
  assert.equal(r.data.members.find((m) => m.id === "mgr-1").you, true);
  assert.equal(r.data.store.id, "1170");
  assert.equal(r.data.viewer.role, "manager");
  assert.ok(!JSON.stringify(r.data).includes("secretNote"));
});

test("crew trainers can read team progress", async () => {
  const { h } = managerHandler("crewTrainer");
  const r = response();
  await h({ method: "GET", headers: {} }, r);
  assert.equal(r.code, 200);
  assert.equal(r.data.viewer.role, "crewTrainer");
  assert.equal(r.data.members.length, 4);
});

test("one unreadable member does not fail the whole team", async () => {
  const { h } = managerHandler("manager", { failTrainingFor: ["crew-2"] });
  const r = response();
  await h({ method: "GET", headers: {} }, r);
  assert.equal(r.code, 200);
  const ryan = r.data.members.find((m) => m.id === "crew-2");
  assert.deepEqual(ryan.progress, {});
  assert.equal(ryan.progressAvailable, false);
});

test("server errors return a safe message", async () => {
  const h = createHandler({
    getAuthenticatedProfile: async () => ({
      profile: { id: "mgr-1", role: "manager", storeId: "1170" },
    }),
    adminDb: () => {
      throw new Error("credentials leaked in message");
    },
  });
  const r = response();
  const original = console.error;
  console.error = () => {};
  try {
    await h({ method: "GET", headers: {} }, r);
  } finally {
    console.error = original;
  }
  assert.equal(r.code, 500);
  assert.equal(r.data.error, "Could not load team learning progress.");
});

test("timestamps and progress are normalised", () => {
  assert.equal(toMillis(null), null);
  assert.equal(toMillis(1700000000000), 1700000000000);
  assert.equal(toMillis({ seconds: 10, nanoseconds: 5e6 }), 10005);
  assert.equal(toMillis("not a date"), null);
  assert.deepEqual(
    compactProgress(snapOf([["x", { completed: "yes", completedAt: 5, score: 250 }]]).docs),
    { x: { completed: false, completedAt: null, score: 100 } },
  );
});
