import test from "node:test";
import assert from "node:assert/strict";
import { breaksRequest } from "../api/breaks.js";

// In-memory Firestore Admin fake: nested collections/docs, where ==/in
// queries, set (merge) and runTransaction with t.get/t.set.
function fakeDb() {
  const docs = new Map();
  let auto = 0;
  const docRef = (path) => ({
    id: path.split("/").pop(),
    path,
    collection: (name) => collectionRef(`${path}/${name}`),
    async get() {
      const data = docs.get(path);
      return { id: path.split("/").pop(), exists: data !== undefined, data: () => (data ? structuredClone(data) : undefined) };
    },
    async set(data, options) {
      docs.set(path, options?.merge ? { ...(docs.get(path) || {}), ...structuredClone(data) } : structuredClone(data));
    },
  });
  const query = (path, filters) => ({
    where: (field, op, value) => query(path, [...filters, [field, op, value]]),
    async get() {
      const found = [...docs.entries()]
        .filter(([p]) => p.startsWith(path + "/") && !p.slice(path.length + 1).includes("/"))
        .filter(([, d]) => filters.every(([f, op, v]) => (op === "in" ? v.includes(d[f]) : d[f] === v)))
        .map(([p, d]) => ({ id: p.split("/").pop(), data: () => structuredClone(d) }));
      return { docs: found, size: found.length, empty: !found.length };
    },
  });
  const collectionRef = (path) => ({
    doc: (id) => docRef(`${path}/${id || "auto" + ++auto}`),
    where: (field, op, value) => query(path, [[field, op, value]]),
    get: () => query(path, []).get(),
  });
  return {
    docs,
    collection: (name) => collectionRef(name),
    async runTransaction(fn) {
      return fn({ get: (ref) => ref.get(), set: (ref, data, options) => ref.set(data, options) });
    },
  };
}

const NOW = new Date("2026-09-28T11:00:00Z");
const crew = { id: "u-jess", name: "Jess Taylor", role: "crew", storeId: "1170" };
const kai = { id: "u-kai", name: "Kai Morgan", role: "crewTrainer", storeId: "1170" };
const manager = { id: "u-mgr", name: "Morgan Manager", role: "shiftCreator", storeId: "1170" };
const other = { id: "u-far", name: "Far Away", role: "manager", storeId: "2280" };
const call = (db, profile, method, body = {}, query = {}, now = NOW) =>
  breaksRequest(db, { profile, uid: profile.id, method, body, query, now });
const place = (db, profile, items, note) => call(db, profile, "POST", { action: "place", items, note });

test("GET gives defaults, and crew never see the store log", async () => {
  const db = fakeDb();
  const res = await call(db, crew, "GET");
  assert.equal(res.status, 200);
  assert.equal(res.body.settings.dailyPoints, 4);
  assert.ok(res.body.menu.find((m) => m.id === "bigmac"));
  assert.deepEqual(res.body.mine, []);
  assert.equal(res.body.log, undefined);
  assert.equal(res.body.manager, false);
});

test("crew put a break through and get a numbered order", async () => {
  const db = fakeDb();
  const res = await place(db, crew, ["bigmac", "fries-m", "coke"], "No pickles");
  assert.equal(res.status, 201);
  assert.equal(res.body.order.code, "B-001");
  assert.equal(res.body.order.crewId, "u-jess");
  assert.equal(res.body.order.crewName, "Jess Taylor");
  assert.equal(res.body.order.points, 4);
  assert.equal(res.body.mine.length, 1);
  const second = await place(db, kai, ["cb", "fries-s"]);
  assert.equal(second.body.order.code, "B-002");
  const stored = db.docs.get(`stores/1170/breakOrders/${res.body.order.id}`);
  assert.equal(stored.storeId, "1170");
});

test("the server enforces the rules, and a refused order uses no number", async () => {
  const db = fakeDb();
  const twoMains = await place(db, crew, ["cb", "hb"]);
  assert.equal(twoMains.status, 422);
  assert.equal(twoMains.body.code, "RULES");
  await place(db, crew, ["bigmac", "fries-m"]);
  const over = await place(db, crew, ["cb"]);
  assert.equal(over.status, 422);
  assert.match(over.body.error, /no points left/i);
  const next = await place(db, kai, ["cb"]);
  assert.equal(next.body.order.code, "B-002");
});

test("the crew member is always the signed-in account", async () => {
  const db = fakeDb();
  const res = await call(db, crew, "POST", { action: "place", items: ["cb"], crewId: "u-kai", crewName: "Kai" });
  assert.equal(res.body.order.crewId, "u-jess");
});

test("managers see the store log, void orders and give points back", async () => {
  const db = fakeDb();
  const placed = await place(db, crew, ["bigmac", "fries-m"]);
  await call(db, other, "POST", { action: "place", items: ["cb"] });
  const log = await call(db, manager, "GET");
  assert.equal(log.body.manager, true);
  assert.deepEqual(log.body.log.map((o) => o.crewName), ["Jess Taylor"]);
  assert.equal((await call(db, crew, "POST", { action: "void", id: placed.body.order.id })).status, 403);
  assert.equal((await call(db, other, "POST", { action: "void", id: placed.body.order.id })).status, 404);
  const voided = await call(db, manager, "POST", { action: "void", id: placed.body.order.id });
  assert.equal(voided.status, 200);
  const order = voided.body.log.find((o) => o.id === placed.body.order.id);
  assert.equal(order.status, "void");
  assert.equal(order.voidedByName, "Morgan Manager");
  assert.equal((await place(db, crew, ["bigmac", "fries-m"])).status, 201);
});

test("managers change the rules and points; crew cannot", async () => {
  const db = fakeDb();
  assert.equal((await call(db, crew, "POST", { action: "config", settings: { dailyPoints: 10 } })).status, 403);
  const saved = await call(db, manager, "POST", {
    action: "config",
    settings: { dailyPoints: 6, maxMains: 2 },
    menu: [{ id: "bigmac", pts: 4 }, { id: "coke", on: false }],
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.settings.dailyPoints, 6);
  assert.equal(saved.body.menu.find((m) => m.id === "bigmac").pts, 4);
  assert.equal(saved.body.configUpdatedBy, "Morgan Manager");
  const res = await place(db, crew, ["bigmac", "cb"]);
  assert.equal(res.status, 201);
  assert.equal(res.body.order.points, 5);
  assert.equal((await place(db, kai, ["coke"])).status, 422);
  // A later settings-only save keeps the menu.
  await call(db, manager, "POST", { action: "config", settings: { maxOrdersPerDay: 3 } });
  const state = await call(db, crew, "GET");
  assert.equal(state.body.menu.find((m) => m.id === "bigmac").pts, 4);
  assert.equal(state.body.settings.maxOrdersPerDay, 3);
});

test("managers can look at an earlier day, but not the future", async () => {
  const db = fakeDb();
  await place(db, crew, ["cb"]);
  const tomorrow = new Date("2026-09-29T11:00:00Z");
  const yesterdayView = await call(db, manager, "GET", {}, { day: "2026-09-28" }, tomorrow);
  assert.equal(yesterdayView.body.day, "2026-09-28");
  assert.equal(yesterdayView.body.log.length, 1);
  const future = await call(db, manager, "GET", {}, { day: "2026-12-25" });
  assert.equal(future.body.day, "2026-09-28");
  // Crew history keeps yesterday's break; today's points are fresh.
  const crewNextDay = await call(db, crew, "GET", {}, {}, tomorrow);
  assert.equal(crewNextDay.body.mine.length, 1);
  assert.equal((await call(db, crew, "POST", { action: "place", items: ["bigmac", "fries-m"] }, {}, tomorrow)).status, 201);
});

test("unknown actions and methods are refused", async () => {
  const db = fakeDb();
  assert.equal((await call(db, crew, "POST", { action: "delete" })).status, 400);
  assert.equal((await call(db, crew, "PUT")).status, 405);
  assert.equal((await call(db, { ...crew, storeId: "" }, "GET")).status, 403);
});
