export const managerRole = (role) =>
  ["manager", "shiftcreator", "admin"].includes(
    String(role || "")
      .toLowerCase()
      .replace(/\s/g, ""),
  );
export const isoDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export function weekDates(offset = 0, now = new Date()) {
  const start = new Date(now);
  start.setHours(12, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7) + offset * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return isoDate(d);
  });
}
export function shiftMinutes(shift) {
  if (!/^\d{2}:\d{2}$/.test(shift.start) || !/^\d{2}:\d{2}$/.test(shift.end))
    return 0;
  const minutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  let duration = minutes(shift.end) - minutes(shift.start);
  if (duration < 0) duration += 1440;
  return Math.max(0, duration - Math.max(0, Number(shift.breakMinutes) || 0));
}
export function shiftEnd(shift) {
  const start = new Date(`${shift.date}T${shift.start}`);
  const end = new Date(`${shift.date}T${shift.end}`);
  if (end < start) end.setDate(end.getDate() + 1);
  return end;
}
export function overlap(a, b) {
  const as = new Date(`${a.date}T${a.start}`),
    bs = new Date(`${b.date}T${b.start}`);
  return as < shiftEnd(b) && bs < shiftEnd(a);
}
export const durationLabel = (minutes) =>
  `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`;
export const escapeHTML = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

export function availabilityAllows(availability, shift) {
  if (!availability) return true;
  const days = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];
  const day = days[new Date(`${shift.date}T12:00`).getDay()];
  const entry = availability[day.slice(0, 3)] ?? availability[day];
  if (entry === undefined) return true; // Missing availability must be checked with the crew member.
  const windows = Array.isArray(entry) ? entry : entry.available ? [entry] : [];
  const toMins = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const start = toMins(shift.start);
  let end = toMins(shift.end);
  if (end < start) end += 1440;
  return windows.some((w) => {
    if (!w.start || !w.end) return false;
    const from = toMins(w.start);
    let until = toMins(w.end);
    if (until < from) until += 1440;
    return start >= from && end <= until;
  });
}

// ---------------------------------------------------------------------------
// Shared rota helpers (pages feature). Pure functions so they can be unit
// tested and reused by the schedule, planner, team and McStars pages.
// ---------------------------------------------------------------------------
export const STATIONS = [
  "Fries",
  "Grill",
  "Chicken & Fryer",
  "Front Counter",
  "Drive-thru",
  "Drinks & McCafé",
  "Kitchen Assembly",
  "Breakfast",
  "Dining Area",
  "Shift Lead",
  "Training",
];
// Stations that have a two-signature verification (Shift Lead and Training do not).
export const VERIFY_STATIONS = STATIONS.slice(0, 9);
export const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const LONG_DAY = {
  mon: "monday",
  tue: "tuesday",
  wed: "wednesday",
  thu: "thursday",
  fri: "friday",
  sat: "saturday",
  sun: "sunday",
};
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const validTime = (value) => TIME_RE.test(String(value || ""));
export const toMinutes = (value) =>
  validTime(value)
    ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3))
    : NaN;
export const fromMinutes = (total) => {
  const m = ((Math.round(total) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
/** Minutes between start and end, treating an earlier end as the next day. */
export function grossMinutes(start, end) {
  const a = toMinutes(start),
    b = toMinutes(end);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return (b - a + 1440) % 1440;
}
export const addDays = (date, days) => {
  const d = new Date(`${date}T12:00`);
  d.setDate(d.getDate() + days);
  return isoDate(d);
};
export const dayKey = (date) =>
  ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][
    new Date(`${date}T12:00`).getDay()
  ];
export const shiftStart = (shift) => new Date(`${shift.date}T${shift.start}`);
/** Monday-based week offset of a date relative to the week containing `now`. */
export function weekOffsetOf(date, now = new Date()) {
  const monday = (d) => {
    const x = new Date(d);
    x.setHours(12, 0, 0, 0);
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x;
  };
  return Math.round(
    (monday(new Date(`${date}T12:00`)) - monday(now)) / (7 * 864e5),
  );
}

/**
 * One availability entry per day in the portal's canonical shape
 * ({available, start, end}) from current, legacy long-day or array formats.
 * Unset days are null so callers can tell "not recorded" from "day off".
 */
export function normaliseAvailability(availability) {
  const out = {};
  for (const key of DAY_KEYS) {
    const entry = availability?.[key] ?? availability?.[LONG_DAY[key]];
    if (entry === undefined || entry === null) {
      out[key] = null;
      continue;
    }
    if (Array.isArray(entry)) {
      const first = entry.find(
        (w) => validTime(w?.start) && validTime(w?.end),
      );
      out[key] = first
        ? { available: true, start: first.start, end: first.end }
        : { available: false, start: "", end: "" };
      continue;
    }
    out[key] = {
      available:
        Boolean(entry.available) &&
        validTime(entry.start) &&
        validTime(entry.end),
      start: validTime(entry.start) ? entry.start : "",
      end: validTime(entry.end) ? entry.end : "",
    };
  }
  return out;
}

/** Availability for one date: status "unset" | "off" | "on" plus its windows. */
export function availabilityFor(availability, date) {
  const key = dayKey(date);
  const entry = availability?.[key] ?? availability?.[LONG_DAY[key]];
  if (entry === undefined || entry === null)
    return { key, status: "unset", windows: [] };
  const windows = (
    Array.isArray(entry) ? entry : entry.available ? [entry] : []
  ).filter((w) => validTime(w?.start) && validTime(w?.end));
  return windows.length
    ? {
        key,
        status: "on",
        windows: windows.map(({ start, end }) => ({ start, end })),
      }
    : { key, status: "off", windows: [] };
}

const weekdayName = (date) =>
  new Date(`${date}T12:00`).toLocaleDateString("en-GB", { weekday: "long" });
const shortDate = (date) =>
  new Date(`${date}T12:00`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
const firstName = (name) =>
  String(name || "This team member")
    .trim()
    .split(/\s+/)[0];

/**
 * Checks a planned shift before it is published. Errors block publishing;
 * warnings need a manager's judgement (availability, rest, breaks, hours).
 */
export function validateShift(
  shift,
  { shifts = [], member = null, today = isoDate() } = {},
) {
  const errors = [],
    warnings = [],
    notes = [];
  if (!shift?.userId) errors.push("Choose a team member.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(shift?.date || "")))
    errors.push("Choose a date.");
  if (!validTime(shift?.start) || !validTime(shift?.end))
    errors.push("Choose a start and finish time.");
  if (errors.length)
    return {
      errors,
      warnings,
      notes,
      grossMinutes: 0,
      paidMinutes: 0,
      weekMinutes: 0,
    };
  const gross = grossMinutes(shift.start, shift.end);
  const breakMinutes = Number(shift.breakMinutes);
  const breakOk =
    Number.isInteger(breakMinutes) && breakMinutes >= 0 && breakMinutes <= 120;
  if (gross === 0) errors.push("Start and finish times must be different.");
  else if (gross > 720)
    errors.push(
      `Shifts can be 12 hours at most. This one is ${durationLabel(gross)}.`,
    );
  if (!breakOk) errors.push("Breaks can be between 0 and 120 minutes.");
  else if (gross && breakMinutes >= gross)
    errors.push("The break must be shorter than the shift.");
  const name = firstName(member?.name || shift.userName);
  const others = shifts.filter(
    (s) =>
      s.userId === shift.userId &&
      s.id !== shift.id &&
      s.date &&
      validTime(s.start) &&
      validTime(s.end),
  );
  const clash = gross ? others.find((s) => overlap(s, shift)) : null;
  if (clash)
    errors.push(
      `${name} already works ${shortDate(clash.date)} ${clash.start}–${clash.end}${clash.station ? ` (${clash.station})` : ""}.`,
    );
  if (shift.date < today) warnings.push("This date has already passed.");
  if (member) {
    const a = availabilityFor(member.availability, shift.date);
    if (a.status === "unset")
      warnings.push(
        `${name} has no availability saved for ${weekdayName(shift.date)}. Check with them first.`,
      );
    else if (a.status === "off")
      warnings.push(
        `${name} is marked as unavailable on ${weekdayName(shift.date)}s.`,
      );
    else if (!availabilityAllows(member.availability, shift))
      warnings.push(
        `Outside ${name}'s availability (${a.windows.map((w) => `${w.start}–${w.end}`).join(", ")}).`,
      );
    if (
      shift.station &&
      VERIFY_STATIONS.includes(shift.station) &&
      !(member.verifiedStations || []).includes(shift.station)
    )
      notes.push(
        `${name} is not verified on ${shift.station} yet. Pair them with a Crew Trainer.`,
      );
  }
  if (gross > 360 && breakOk && breakMinutes < 20)
    warnings.push("Shifts over 6 hours need at least a 20-minute break.");
  if (gross && !clash) {
    const start = shiftStart(shift),
      end = shiftEnd(shift);
    let gap = Infinity,
      near = null;
    for (const s of others) {
      const sStart = shiftStart(s),
        sEnd = shiftEnd(s);
      const g =
        sEnd <= start
          ? (start - sEnd) / 60000
          : sStart >= end
            ? (sStart - end) / 60000
            : 0;
      if (g < gap) {
        gap = g;
        near = s;
      }
    }
    if (near && gap < 660)
      warnings.push(
        `Only ${durationLabel(Math.round(gap))} rest ${shiftEnd(near) <= start ? "after" : "before"} the ${shortDate(near.date)} shift. Aim for 11 hours.`,
      );
  }
  const paid = Math.max(0, gross - (breakOk ? breakMinutes : 0));
  const week = weekDates(0, new Date(`${shift.date}T12:00`));
  const weekMinutes =
    others
      .filter((s) => week.includes(s.date))
      .reduce((n, s) => n + shiftMinutes(s), 0) + (clash ? 0 : paid);
  if (weekMinutes > 48 * 60)
    warnings.push(
      `${name} would have ${durationLabel(weekMinutes)} this week, over 48 hours.`,
    );
  return {
    errors,
    warnings,
    notes,
    grossMinutes: gross,
    paidMinutes: paid,
    weekMinutes,
  };
}

/**
 * Plans "copy last week": each source shift moves forward by `days` unless it
 * would clash, fall in the past, fall outside availability or belongs to
 * someone no longer on the team. Returns what to create and what was skipped.
 */
export function planCopy({
  source = [],
  existing = [],
  team = [],
  days = 7,
  today = isoDate(),
}) {
  const create = [],
    skipped = [];
  const planned = [...existing];
  const sorted = [...source].sort((a, b) =>
    (a.date + a.start).localeCompare(b.date + b.start),
  );
  for (const s of sorted) {
    const member = team.find((m) => m.id === s.userId);
    const next = {
      userId: s.userId,
      userName: member?.name || s.userName || "Team member",
      role: member?.role || s.role || "crew",
      date: addDays(s.date, days),
      start: s.start,
      end: s.end,
      station: s.station || "",
      breakMinutes: Number.isInteger(Number(s.breakMinutes))
        ? Number(s.breakMinutes)
        : 0,
    };
    let reason = "";
    if (!member) reason = "no longer on the team";
    else if (next.date < today) reason = "date has passed";
    else {
      const check = validateShift(next, { shifts: planned, member, today });
      if (check.errors.length)
        reason = check.errors.some((e) => e.includes("already works"))
          ? "already has a shift then"
          : check.errors[0];
      else {
        const a = availabilityFor(member.availability, next.date);
        if (a.status === "off") reason = "marked unavailable that day";
        else if (
          a.status === "on" &&
          !availabilityAllows(member.availability, next)
        )
          reason = "outside availability";
      }
    }
    if (reason) skipped.push({ shift: next, reason });
    else {
      create.push(next);
      planned.push({ ...next, id: `planned-${create.length}` });
    }
  }
  return { create, skipped };
}
