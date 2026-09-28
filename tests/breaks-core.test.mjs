import test from "node:test";
import assert from "node:assert/strict";
import * as B from "../breaks-core.js";

const menu = B.normalizeMenu();
const settings = B.normalizeSettings();
const noon = new Date("2026-09-28T11:00:00Z"); // 12:00 in Hayle (BST)
const early = new Date("2026-09-28T07:30:00Z"); // 08:30 in Hayle
const ev = (items, extra = {}) => B.evaluate({ items, menu, settings, now: noon, ...extra });
const item = (id) => menu.find((m) => m.id === id);
const jess = { id: "u-jess", name: "Jess Taylor" };

test("a main, a side and a drink within 4 points is allowed", () => {
  const result = ev(["bigmac", "fries-m", "coke"]);
  assert.equal(result.ok, true);
  assert.equal(result.points, 4);
  assert.equal(result.after, 0);
});

test("two mains in one break are blocked", () => {
  const result = ev(["cb", "hb"]);
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /1 main per break/);
});

test("going over the daily points is blocked", () => {
  const result = ev(["dqpc", "fries-s"]);
  assert.equal(result.ok, false);
  assert.equal(result.points, 5);
  assert.match(result.errors[0], /you have 4 left/);
});

test("points already used today count toward the limit", () => {
  assert.equal(ev(["bigmac"], { used: 2 }).ok, false);
  assert.equal(ev(["cb", "fries-s"], { used: 2 }).ok, true);
});

test("a side on its own needs a main unless the manager turns that off", () => {
  assert.equal(ev(["fries-m", "coke"]).ok, false);
  assert.match(ev(["fries-m"]).errors.join(" "), /Add a main/);
  const relaxed = B.normalizeSettings({ sideNeedsMain: false });
  assert.equal(B.evaluate({ items: ["fries-m"], menu, settings: relaxed, now: noon }).ok, true);
});

test("a drink on its own is free and allowed", () => {
  const result = ev(["coke"]);
  assert.equal(result.ok, true);
  assert.equal(result.points, 0);
});

test("break orders per day are limited", () => {
  assert.equal(ev(["cb"], { ordersToday: 2 }).ok, false);
  assert.equal(ev(["cb"], { ordersToday: 1 }).ok, true);
});

test("an empty tray cannot be put through", () => {
  const result = ev([]);
  assert.equal(result.ok, false);
  assert.equal(result.empty, true);
});

test("breakfast items lock after breakfast hours", () => {
  assert.equal(ev(["smuffin", "hashbrown"], { now: early }).ok, true);
  assert.equal(ev(["smuffin"]).ok, false);
  assert.equal(B.canAdd(item("smuffin"), { items: [], menu, settings, now: noon }).ok, false);
  const always = B.normalizeSettings({ enforceBreakfastHours: false });
  assert.equal(B.canAdd(item("smuffin"), { items: [], menu, settings: always, now: noon }).ok, true);
});

test("switched-off items cannot be ordered", () => {
  const off = B.normalizeMenu(menu.map((m) => (m.id === "bigmac" ? { ...m, on: false } : m)));
  assert.equal(B.evaluate({ items: ["bigmac"], menu: off, settings, now: noon }).ok, false);
  const bigmac = off.find((m) => m.id === "bigmac");
  assert.equal(B.canAdd(bigmac, { items: [], menu: off, settings, now: noon }).reason, "Not available today");
});

test("canAdd explains why an item is locked", () => {
  const ctx = (items) => ({ items, menu, settings, now: noon });
  assert.equal(B.canAdd(item("bigmac"), ctx([])).ok, true);
  assert.equal(B.canAdd(item("cb"), ctx(["bigmac"])).reason, "Only 1 main per break");
  assert.equal(B.canAdd(item("mcflurry"), ctx(["bigmac", "fries-m"])).reason, "No points left");
  assert.equal(B.canAdd(item("mcflurry"), ctx(["bigmac"])).reason, "Needs 2 pts · 1 left");
});

test("createOrder snapshots the items and throws on a broken rule", () => {
  const order = B.createOrder({ crew: jess, items: ["bigmac", "fries-m", "coke"], note: "  No pickles  ", menu, settings, orders: [], no: 7, now: noon });
  assert.equal(order.code, "B-007");
  assert.equal(order.points, 4);
  assert.equal(order.note, "No pickles");
  assert.equal(order.day, "2026-09-28");
  assert.equal(order.status, "placed");
  assert.equal(order.items[0].name, "Big Mac");
  assert.throws(
    () => B.createOrder({ crew: jess, items: ["cb"], menu, settings, orders: [order], no: 8, now: noon }),
    (error) => error.code === "RULES" && /no points left/i.test(error.message),
  );
});

test("voided orders give their points back", () => {
  const order = B.createOrder({ crew: jess, items: ["bigmac", "fries-m"], menu, settings, orders: [], no: 1, now: noon });
  assert.equal(B.crewDay([order], jess.id, "2026-09-28").pointsUsed, 4);
  const voided = B.voidOrder(order, { id: "u-mgr", name: "Morgan" }, noon);
  assert.equal(voided.status, "void");
  assert.equal(voided.voidedByName, "Morgan");
  assert.equal(B.crewDay([voided], jess.id, "2026-09-28").pointsUsed, 0);
});

test("settings are clamped and the menu keeps every default item", () => {
  const s = B.normalizeSettings({ dailyPoints: 999, maxMains: -3, breakfastUntil: "soon", timeZone: "Mars/Base" });
  assert.equal(s.dailyPoints, 20);
  assert.equal(s.maxMains, 0);
  assert.equal(s.breakfastUntil, "10:30");
  assert.equal(s.timeZone, "Europe/London");
  const edited = B.normalizeMenu([{ id: "bigmac", pts: 5, type: "treat", name: "Hacked" }, { id: "made-up", pts: 0 }]);
  assert.equal(edited.length, B.DEFAULT_MENU.length);
  assert.equal(edited.find((i) => i.id === "bigmac").pts, 5);
  assert.equal(edited.find((i) => i.id === "bigmac").name, "Big Mac");
  assert.equal(edited.find((i) => i.id === "made-up"), undefined);
  assert.deepEqual(B.menuForSave(edited)[0], { id: "bigmac", type: "treat", pts: 5, on: true });
});

test("days follow Hayle time and the manager summary adds up", () => {
  assert.equal(B.dayKey(new Date("2026-09-28T23:30:00Z")), "2026-09-29");
  assert.equal(B.clockKey(new Date("2026-09-28T09:05:00Z")), "10:05");
  assert.equal(B.shiftDay("2026-03-01", -1), "2026-02-28");
  const a = B.createOrder({ crew: jess, items: ["bigmac", "fries-m"], menu, settings, orders: [], no: 1, now: noon });
  const b = B.createOrder({ crew: { id: "u-kai", name: "Kai" }, items: ["cb"], menu, settings, orders: [], no: 2, now: noon });
  const report = B.summary([a, B.voidOrder(b)], settings);
  assert.deepEqual(report, { count: 1, voided: 1, points: 4, crew: 1, minutesSaved: 4 });
  assert.equal(B.shortName("Jess Taylor"), "Jess T.");
});
