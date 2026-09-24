import test from "node:test";
import assert from "node:assert/strict";
import {
  validateShift,
  planCopy,
  availabilityFor,
  normaliseAvailability,
  grossMinutes,
  weekOffsetOf,
  addDays,
  STATIONS,
  VERIFY_STATIONS,
} from "../portal-core.js";
import { rotaWindowStart } from "../api/portal-data.js";
import { normaliseStation } from "../api/verification.js";

const cosmin = {
  id: "c",
  name: "Cosmin Blidaru",
  availability: {
    mon: { available: true, start: "16:00", end: "02:00" },
    tue: { available: true, start: "09:00", end: "17:00" },
    wed: { available: false, start: "", end: "" },
  },
  verifiedStations: ["Fries"],
};
const base = { userId: "c", date: "2026-09-28", station: "Fries", breakMinutes: 30 };
const today = "2026-09-24";

test("valid overnight shift inside an overnight availability window", () => {
  const r = validateShift({ ...base, start: "16:30", end: "01:00" }, { member: cosmin, today });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.grossMinutes, 510);
  assert.equal(r.paidMinutes, 480);
});

test("blocking errors: same times, over 12 hours, break too long", () => {
  assert.match(validateShift({ ...base, start: "09:00", end: "09:00" }, { today }).errors[0], /must be different/);
  assert.match(validateShift({ ...base, start: "08:00", end: "21:00" }, { today }).errors[0], /12 hours at most/);
  assert.match(
    validateShift({ ...base, start: "09:00", end: "09:30", breakMinutes: 30 }, { today }).errors[0],
    /shorter than the shift/,
  );
  assert.match(validateShift({ ...base, userId: "" }, { today }).errors[0], /team member/);
});

test("overlap includes overnight shifts running into the next day", () => {
  const shifts = [{ id: "x", userId: "c", date: "2026-09-28", start: "16:30", end: "01:00" }];
  const r = validateShift({ ...base, date: "2026-09-29", start: "00:30", end: "06:00" }, { shifts, member: cosmin, today });
  assert.match(r.errors[0], /already works/);
  // Editing the same shift never clashes with itself.
  const self = validateShift({ ...shifts[0], id: "x", breakMinutes: 30 }, { shifts, member: cosmin, today });
  assert.deepEqual(self.errors, []);
});

test("warnings: availability, rest under 11 hours, short break, past date, 48 hours", () => {
  const shifts = [{ id: "x", userId: "c", date: "2026-09-28", start: "16:30", end: "01:00", breakMinutes: 30 }];
  const rest = validateShift({ ...base, date: "2026-09-29", start: "09:00", end: "15:00" }, { shifts, member: cosmin, today });
  assert.ok(rest.warnings.some((w) => /8h rest after/.test(w)));
  const off = validateShift({ ...base, date: "2026-09-30", start: "09:00", end: "15:00" }, { member: cosmin, today });
  assert.ok(off.warnings.some((w) => /unavailable on Wednesdays/.test(w)));
  const unset = validateShift({ ...base, date: "2026-10-01", start: "09:00", end: "15:00" }, { member: cosmin, today });
  assert.ok(unset.warnings.some((w) => /no availability saved for Thursday/.test(w)));
  const outside = validateShift({ ...base, date: "2026-09-29", start: "12:00", end: "20:00" }, { member: cosmin, today });
  assert.ok(outside.warnings.some((w) => /Outside Cosmin's availability/.test(w)));
  const noBreak = validateShift({ ...base, start: "16:00", end: "23:00", breakMinutes: 0 }, { member: cosmin, today });
  assert.ok(noBreak.warnings.some((w) => /20-minute break/.test(w)));
  const past = validateShift({ ...base, date: "2026-09-21", start: "16:00", end: "22:00" }, { member: cosmin, today });
  assert.ok(past.warnings.includes("This date has already passed."));
  const long = Array.from({ length: 4 }, (_, i) => ({
    id: "l" + i,
    userId: "c",
    date: addDays("2026-09-28", i + 1),
    start: "10:00",
    end: "22:00",
    breakMinutes: 0,
  }));
  const heavy = validateShift({ ...base, start: "10:00", end: "22:00", breakMinutes: 0 }, { shifts: long, today });
  assert.ok(heavy.warnings.some((w) => /over 48 hours/.test(w)));
  const note = validateShift({ ...base, station: "Grill", start: "16:30", end: "23:00" }, { member: cosmin, today });
  assert.ok(note.notes.some((n) => /not verified on Grill/.test(n)));
});

test("copy last week skips clashes, past dates, unavailable days and leavers", () => {
  const team = [cosmin, { id: "r", name: "Ryan", availability: {} }];
  const source = [
    { userId: "c", date: "2026-09-21", start: "16:30", end: "01:00", station: "Fries", breakMinutes: 30 },
    { userId: "c", date: "2026-09-23", start: "09:00", end: "15:00", station: "Fries", breakMinutes: 30 },
    { userId: "r", date: "2026-09-22", start: "17:00", end: "23:00", station: "Grill", breakMinutes: 20 },
    { userId: "gone", userName: "Old", date: "2026-09-22", start: "09:00", end: "12:00" },
    { userId: "r", date: "2026-09-15", start: "09:00", end: "12:00" },
  ];
  const existing = [{ id: "e", userId: "r", date: "2026-09-29", start: "18:00", end: "20:00" }];
  const plan = planCopy({ source, existing, team, days: 7, today });
  assert.deepEqual(
    plan.create.map((s) => [s.userId, s.date, s.start, s.breakMinutes]),
    [["c", "2026-09-28", "16:30", 30]],
  );
  const reasons = Object.fromEntries(plan.skipped.map((s) => [s.shift.userId + s.shift.date, s.reason]));
  assert.equal(reasons["c2026-09-30"], "marked unavailable that day");
  assert.equal(reasons["r2026-09-29"], "already has a shift then");
  assert.equal(reasons["gone2026-09-29"], "no longer on the team");
  assert.equal(reasons["r2026-09-22"], "date has passed");
});

test("availability helpers understand current, legacy and array formats", () => {
  assert.equal(availabilityFor(cosmin.availability, "2026-09-28").status, "on");
  assert.equal(availabilityFor(cosmin.availability, "2026-09-30").status, "off");
  assert.equal(availabilityFor(cosmin.availability, "2026-10-01").status, "unset");
  assert.equal(availabilityFor({ thursday: [{ start: "07:00", end: "15:00" }] }, "2026-10-01").windows[0].end, "15:00");
  const n = normaliseAvailability({ monday: { available: true, start: "09:00", end: "17:00" }, tue: [] });
  assert.deepEqual(n.mon, { available: true, start: "09:00", end: "17:00" });
  assert.deepEqual(n.tue, { available: false, start: "", end: "" });
  assert.equal(n.sun, null);
  assert.equal(grossMinutes("22:00", "02:00"), 240);
});

test("week offsets, the manager rota window and station names", () => {
  assert.equal(weekOffsetOf("2026-09-27", new Date("2026-09-24T12:00")), 0);
  assert.equal(weekOffsetOf("2026-09-28", new Date("2026-09-24T12:00")), 1);
  assert.equal(weekOffsetOf("2026-09-20", new Date("2026-09-24T12:00")), -1);
  // London date: 23:30 UTC on Sunday is already Monday in BST.
  assert.equal(rotaWindowStart(new Date("2026-09-27T23:30:00Z")), "2026-09-21");
  assert.equal(rotaWindowStart(new Date("2026-09-24T12:00:00Z")), "2026-09-14");
  assert.equal(STATIONS.length, 11);
  for (const station of VERIFY_STATIONS) assert.equal(normaliseStation(station), station);
  assert.equal(normaliseStation("chicken"), "Chicken & Fryer");
  assert.equal(normaliseStation("Shift Lead"), null);
});
