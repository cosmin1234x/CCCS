import test from "node:test";
import assert from "node:assert/strict";
import * as B from "../breaks-core.js";
import { FOOD_IDS } from "../breaks-art.js";

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
  assert.equal(s.breakfastUntil, "11:00");
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

test("breakfast runs until 11:00 like McDonald's UK", () => {
  const at = (utc) => new Date(`2026-09-28T${utc}:00Z`); // BST = UTC+1
  assert.equal(ev(["smuffin"], { now: at("09:59") }).ok, true);
  assert.equal(ev(["smuffin"], { now: at("10:00") }).ok, false);
});

test("every standard item has a picture, a type and its own customisations", () => {
  const ids = new Set();
  for (const i of B.DEFAULT_MENU) {
    assert.ok(!ids.has(i.id), `duplicate id ${i.id}`);
    ids.add(i.id);
    assert.ok(B.ART.includes(i.icon), `${i.id} picture`);
    assert.ok(B.TYPES[i.type], `${i.id} type`);
    assert.deepEqual(B.normalizeOptions(i.options), i.options, `${i.id} options`);
  }
  assert.deepEqual([...B.ART].sort(), [...FOOD_IDS].sort());
  assert.ok(item("coke").options.includes("No ice"));
  assert.ok(item("bigmac").options.includes("No pickles"));
});

test("customisations go on the ticket, only the item's own", () => {
  const order = B.createOrder({
    crew: jess,
    items: [
      { id: "bigmac", mods: ["No onions", "No pickles", "Extra bacon", "No ice"] },
      { id: "fries-m", mods: [] },
      { id: "coke", mods: ["No ice"] },
    ],
    menu,
    settings,
    orders: [],
    no: 1,
    now: noon,
  });
  assert.deepEqual(order.items[0].mods, ["No pickles", "No onions"]);
  assert.equal("mods" in order.items[1], false);
  assert.deepEqual(order.items[2].mods, ["No ice"]);
  // Lines and plain ids are checked the same way.
  assert.equal(ev([{ id: "cb" }, { id: "hb", mods: ["No onions"] }]).ok, false);
  assert.deepEqual(B.normalizeLines(["cb", { id: "coke", mods: [" No  ice ", "no ice", 5] }, { mods: [] }, null]), [
    { id: "cb", mods: [] },
    { id: "coke", mods: ["No ice", "5"] },
  ]);
});

test("managers change an item's customisations and add their own items", () => {
  const big = { id: "x-big-tasty-a1b2", custom: true, name: "  Big   Tasty ", cat: "mains", type: "main", pts: 3, icon: "double", options: ["No sauce", "No tomato", "no sauce", ""], on: true };
  const edited = B.normalizeMenu([{ id: "coke", type: "drink", pts: 0, on: true, options: ["No ice"] }, big]);
  assert.deepEqual(edited.find((i) => i.id === "coke").options, ["No ice"]);
  const added = edited.find((i) => i.id === big.id);
  assert.equal(added.name, "Big Tasty");
  assert.deepEqual(added.options, ["No sauce", "No tomato"]);
  assert.equal(edited.length, B.DEFAULT_MENU.length + 1);
  // Saved: standard items only keep customisations that differ from the defaults.
  const saved = B.menuForSave(edited);
  assert.deepEqual(saved.find((i) => i.id === "coke"), { id: "coke", type: "drink", pts: 0, on: true, options: ["No ice"] });
  assert.deepEqual(saved.find((i) => i.id === "fanta"), { id: "fanta", type: "drink", pts: 0, on: true });
  assert.deepEqual(saved.find((i) => i.id === big.id), { id: big.id, name: "Big Tasty", cat: "mains", type: "main", pts: 3, icon: "double", breakfast: false, on: true, options: ["No sauce", "No tomato"], custom: true });
  // It can be ordered like any other item.
  const order = B.createOrder({ crew: jess, items: [{ id: big.id, mods: ["No tomato"] }], menu: edited, settings, orders: [], no: 1, now: noon });
  assert.equal(order.items[0].name, "Big Tasty");
  assert.deepEqual(order.items[0].mods, ["No tomato"]);
  // Copies: editing one menu never changes another.
  edited.find((i) => i.id === "bigmac").options.push("Changed");
  assert.equal(B.normalizeMenu().find((i) => i.id === "bigmac").options.includes("Changed"), false);
});

test("added items are checked: bad ids, names, categories and pictures", () => {
  const menuOf = (raw) => B.normalizeMenu([raw]).filter((i) => i.custom);
  assert.equal(menuOf({ id: "bigmac", custom: true, name: "Fake", cat: "mains" }).length, 0);
  assert.equal(menuOf({ id: "x-ok-1", name: "Not flagged", cat: "mains" }).length, 0);
  assert.equal(menuOf({ id: "x-Bad Id", custom: true, name: "Bad", cat: "mains" }).length, 0);
  assert.equal(menuOf({ id: "x-no-name", custom: true, name: "   ", cat: "mains" }).length, 0);
  assert.equal(menuOf({ id: "x-no-cat", custom: true, name: "Lost", cat: "pizza" }).length, 0);
  const [odd] = menuOf({ id: "x-odd", custom: true, name: "<b>Odd</b>\u0000 item", cat: "drinks", icon: "rocket", tint: "red", pts: 99, type: "nope" });
  assert.equal(odd.name, "<b>Odd</b> item");
  assert.equal(odd.icon, "cup");
  assert.equal(odd.tint, undefined);
  assert.equal(odd.pts, 10);
  assert.equal(odd.type, "drink");
  const many = Array.from({ length: 60 }, (_, i) => ({ id: `x-item-${i}`, custom: true, name: `Item ${i}`, cat: "treats" }));
  assert.equal(B.normalizeMenu(many).filter((i) => i.custom).length, B.MAX_CUSTOM_ITEMS);
  const options = Array.from({ length: 20 }, (_, i) => `Option ${i} ${"x".repeat(40)}`);
  const [long] = menuOf({ id: "x-long", custom: true, name: "y".repeat(90), cat: "sides", options });
  assert.equal(long.name.length, B.NAME_MAX);
  assert.equal(long.options.length, B.MAX_OPTIONS);
  assert.ok(long.options.every((o) => o.length <= B.OPTION_MAX));
});

test("new item ids are short, readable and unique", () => {
  let n = 0;
  const random = () => [0.1, 0.1, 0.5][n++ % 3];
  const first = B.newItemId("Big Tasty®!", [], random);
  assert.match(first, /^x-big-tasty-[a-z0-9]{4}$/);
  const second = B.newItemId("Big Tasty", [first], random);
  assert.notEqual(second, first);
  assert.match(B.newItemId("£££", []), /^x-item-[a-z0-9]{4}$/);
});
