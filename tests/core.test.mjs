import test from "node:test";
import assert from "node:assert/strict";
import {
  weekDates,
  shiftMinutes,
  overlap,
  managerRole,
  availabilityAllows,
} from "../portal-core.js";
test("legacy and overnight availability are honoured", () => {
  const s = { date: "2026-09-21", start: "22:00", end: "02:00" };
  assert.equal(
    availabilityAllows(
      { monday: { available: true, start: "20:00", end: "04:00" } },
      s,
    ),
    true,
  );
  assert.equal(
    availabilityAllows({ mon: [{ start: "09:00", end: "17:00" }] }, s),
    false,
  );
  assert.equal(availabilityAllows({ mon: { available: false } }, s), false);
  assert.equal(availabilityAllows({}, s), true);
});
test("overnight paid hours subtract the unpaid break", () =>
  assert.equal(
    shiftMinutes({ start: "16:30", end: "01:00", breakMinutes: 30 }),
    480,
  ));
test("Sunday belongs to the week beginning Monday", () =>
  assert.deepEqual(weekDates(0, new Date("2026-09-27T12:00")), [
    "2026-09-21",
    "2026-09-22",
    "2026-09-23",
    "2026-09-24",
    "2026-09-25",
    "2026-09-26",
    "2026-09-27",
  ]));
test("overnight shifts conflict with next-day early shifts", () =>
  assert.equal(
    overlap(
      { date: "2026-09-21", start: "16:30", end: "01:00" },
      { date: "2026-09-22", start: "00:30", end: "08:00" },
    ),
    true,
  ));
test("back-to-back shifts do not overlap", () =>
  assert.equal(
    overlap(
      { date: "2026-09-21", start: "09:00", end: "17:00" },
      { date: "2026-09-21", start: "17:00", end: "22:00" },
    ),
    false,
  ));
test("crew and unknown roles cannot manage", () => {
  assert.equal(managerRole("crew"), false);
  assert.equal(managerRole(""), false);
  assert.equal(managerRole("shiftCreator"), true);
});
