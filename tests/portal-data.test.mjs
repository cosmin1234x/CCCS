import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveStoreName,
  trainerRota,
  teamEntry,
  errorCode,
  isInactive,
} from "../api/portal-data.js";

// Minimal Firestore Admin fake: stores/{id} reads, a users storeId query and
// users/{id} merge writes (recorded).
function fakeDb({ stores = {}, users = {}, failStores = false } = {}) {
  const writes = [];
  const queries = [];
  return {
    writes,
    queries,
    collection(name) {
      if (name === "stores")
        return {
          doc: (id) => ({
            async get() {
              if (failStores) throw new Error("unavailable");
              return { exists: id in stores, data: () => stores[id] };
            },
          }),
        };
      assert.equal(name, "users");
      return {
        doc: (id) => ({
          async set(data, options) {
            writes.push([id, data, options]);
          },
        }),
        where(field, op, value) {
          queries.push([field, op, value]);
          return {
            limit: () => ({
              async get() {
                return {
                  docs: Object.entries(users)
                    .filter(([, u]) => u[field] === value)
                    .map(([id, u]) => ({ id, data: () => u })),
                };
              },
            }),
          };
        },
      };
    },
  };
}

const newcomer = { id: "new-1", name: "Nia New", storeId: "1170", role: "crew" };

test("a profile that already has a store name keeps it and writes nothing", async () => {
  const db = fakeDb({ stores: { 1170: { storeName: "Other" } } });
  const name = await resolveStoreName(db, { ...newcomer, storeName: "1170 · Hayle" });
  assert.equal(name, "1170 · Hayle");
  assert.deepEqual(db.writes, []);
});

test("new sign-ups get the name from stores/{storeId} and it is saved back", async () => {
  const db = fakeDb({ stores: { 1170: { storeId: "1170", storeName: "1170 · Hayle" } } });
  assert.equal(await resolveStoreName(db, newcomer), "1170 · Hayle");
  assert.deepEqual(db.writes, [["new-1", { storeName: "1170 · Hayle" }, { merge: true }]]);
});

test("without a store document the name most members carry is used", async () => {
  const db = fakeDb({
    failStores: true,
    users: {
      a: { storeId: "1170", storeName: "1170 · Hayle" },
      b: { storeId: "1170", storeName: "1170 · Hayle" },
      c: { storeId: "1170", storeName: "Hayle (old)" },
      d: { storeId: "2280", storeName: "2280 · Truro" },
      "new-1": { storeId: "1170", storeName: "" },
    },
  });
  assert.equal(await resolveStoreName(db, newcomer), "1170 · Hayle");
  assert.deepEqual(db.queries, [["storeId", "==", "1170"]]);
  assert.deepEqual(db.writes, [["new-1", { storeName: "1170 · Hayle" }, { merge: true }]]);
});

test("team members already loaded are used instead of another query", async () => {
  const db = fakeDb();
  const members = [
    { id: "x", storeId: "1170", storeName: "1170 · Hayle" },
    { id: "y", storeId: "1170" },
  ];
  assert.equal(await resolveStoreName(db, newcomer, members), "1170 · Hayle");
  assert.deepEqual(db.queries, []);
});

test("nothing to go on: no name and no write", async () => {
  const db = fakeDb({ users: { "new-1": { storeId: "1170" } } });
  assert.equal(await resolveStoreName(db, newcomer), "");
  assert.deepEqual(db.writes, []);
});

test("the trainer rota keeps the window, drops deactivated people and private fields", () => {
  const docs = [
    { date: "2026-09-24", start: "16:00", end: "22:00", station: "Fries", userId: "sam", userName: "Sam", breakMinutes: 30, hourlyRate: 12, notes: "x" },
    { date: "2026-09-23", start: "22:00", end: "06:00", station: "Grill", userId: "ann", userName: "Ann" },
    { date: "2026-09-24", start: "09:00", end: "13:00", userId: "gone", userName: "Gone" },
    { date: "2026-09-20", start: "09:00", end: "13:00", userId: "sam", userName: "Sam" },
    { date: "2026-10-30", start: "09:00", end: "13:00", userId: "sam", userName: "Sam" },
    { date: "2026-09-25", start: "", end: "13:00", userId: "sam" },
  ].map((d) => ({ data: () => d }));
  const rota = trainerRota(docs, {
    inactive: new Set(["gone"]),
    from: "2026-09-23",
    until: "2026-10-08",
  });
  assert.deepEqual(rota, [
    { date: "2026-09-23", start: "22:00", end: "06:00", station: "Grill", userId: "ann", userName: "Ann" },
    { date: "2026-09-24", start: "16:00", end: "22:00", station: "Fries", userId: "sam", userName: "Sam" },
  ]);
});

test("team entries say whether an account is deactivated, for every role", () => {
  const member = {
    id: "m1",
    name: "Casey",
    role: "crew",
    storeId: "1170",
    hourlyRate: 12.5,
    notes: "private",
    email: "c@example.invalid",
    status: "inactive",
  };
  const forManager = teamEntry(member, true);
  assert.equal(forManager.status, "inactive");
  assert.equal(forManager.hourlyRate, 12.5);
  const forTrainer = teamEntry(member, false);
  assert.equal(forTrainer.status, "inactive");
  assert.equal("hourlyRate" in forTrainer, false);
  assert.equal("notes" in forTrainer, false);
  assert.equal(teamEntry({ ...member, status: "active" }, false).status, "active");
  assert.equal(isInactive({ deactivated: true }), true);
  assert.equal(isInactive({ status: "Inactive" }), true);
  assert.equal(isInactive({}), false);
});

test("account problems carry a machine-readable code", () => {
  const e = (status, message, code) => Object.assign(new Error(message), { status, code });
  assert.equal(errorCode(e(403, "Your crew profile is missing.")), "profile-missing");
  assert.equal(errorCode(e(403, "Your profile needs a store ID.")), "store-missing");
  assert.equal(errorCode(e(403, "Deactivated.", "deactivated")), "deactivated");
  assert.equal(errorCode(e(401, "Your session has expired.")), "");
  assert.equal(errorCode(new Error("boom")), "");
  assert.equal(errorCode(Object.assign(new Error("x"), { code: "ECONNRESET" })), "");
});
