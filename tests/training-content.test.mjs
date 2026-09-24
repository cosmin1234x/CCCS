import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

// module-data.js is a classic browser script that sets window.McModules.
const source = await readFile(new URL("../module-data.js", import.meta.url), "utf8");
const sandbox = { window: {} };
vm.runInNewContext(source, sandbox);
// JSON round-trip so arrays compare cleanly across the VM realm.
const { modules, passMark } = JSON.parse(JSON.stringify(sandbox.window.McModules));

// Progress is keyed by module id, so these ids must never disappear.
const LEGACY_IDS = [
  "first-shift", "food-safety", "allergens", "fries-station", "grill-station",
  "chicken-fryer", "kitchen-assembly", "breakfast", "front-counter", "drive-thru",
  "drinks-mccafe", "order-presenting", "dining-cleaning", "stock-waste",
  "customer-recovery", "delivery-orders", "trainer-coaching", "trainer-verification",
  "manager-rush", "manager-shift-planning",
];
const ROLES = ["crew", "crewTrainer", "manager"];

test("every existing module id is kept and ids are unique", () => {
  const ids = modules.map((m) => m.id);
  for (const id of LEGACY_IDS) assert.ok(ids.includes(id), id + " is missing");
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[a-z0-9-]+$/);
});

test("every module is complete and well formed", () => {
  assert.ok(passMark > 0 && passMark <= 100);
  for (const m of modules) {
    const where = m.id + ": ";
    for (const key of ["icon", "title", "tagline", "category", "station", "level", "time"])
      assert.ok(String(m[key] || "").trim(), where + key);
    assert.ok(Number.isInteger(m.xp) && m.xp > 0, where + "xp");
    assert.ok(Array.isArray(m.roles) && m.roles.length && m.roles.every((r) => ROLES.includes(r)), where + "roles");
    assert.ok(m.sections.length >= 4 && m.sections.length <= 6, where + "4–6 sections");
    for (const s of m.sections) {
      assert.ok(s.title && s.text && s.takeaway, where + "section " + s.title);
      if (s.points) assert.ok(s.points.every((p) => typeof p === "string" && p));
    }
    assert.ok(m.practice.length >= 2, where + "practice");
    assert.ok(m.checklist.length >= 3, where + "checklist");
    assert.ok(m.quiz.length >= 3 && m.quiz.length <= 5, where + "3–5 questions");
    for (const q of m.quiz) {
      assert.ok(q.q && q.explain, where + "question text and explanation");
      assert.ok(q.a.length >= 2 && new Set(q.a).size === q.a.length, where + "answers");
      assert.ok(Number.isInteger(q.correct) && q.correct >= 0 && q.correct < q.a.length, where + "correct index");
    }
  }
});

test("priority safety modules are flagged and visible to everyone", () => {
  const priority = modules.filter((m) => m.priority).map((m) => m.id).sort();
  assert.deepEqual(priority, ["allergens", "food-safety"]);
  for (const m of modules.filter((m) => m.priority)) assert.deepEqual([...m.roles].sort(), [...ROLES].sort());
});

test("role visibility keeps trainer and manager modules separate", () => {
  for (const m of modules.filter((m) => m.category === "Crew Trainer")) assert.deepEqual(m.roles, ["crewTrainer"]);
  for (const m of modules.filter((m) => m.category === "Manager")) assert.deepEqual(m.roles, ["manager"]);
  assert.ok(modules.filter((m) => m.roles.includes("crew")).length >= 20);
});

test("content never invents temperatures, cook times or allergen guarantees", () => {
  const text = JSON.stringify(
    modules.map((m) => [m.tagline, m.sections, m.practice, m.checklist, m.quiz]),
  );
  assert.doesNotMatch(text, /°|degrees|celsius|fahrenheit/i);
  assert.doesNotMatch(text, /\b\d+\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)\b(?! ago)/i, "no numeric times in lesson content");
  assert.doesNotMatch(text, /is allergen[- ]free|guaranteed? (safe|free)/i);
});
