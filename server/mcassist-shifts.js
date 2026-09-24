// Shift arithmetic shared by the McAssist read and write tools: durations,
// availability windows, overlaps, rest between shifts, weekly hours, slot
// suggestions and coverage. Pure functions only, so they are easy to test.
import {
  DAY_LONG,
  DAY_SHORT,
  WEEK_ORDER,
  addDays,
  dateLabel,
  datesInRange,
  dayNumber,
  fromMinutes,
  isIsoDate,
  timeOk,
  toMinutes,
  weekRange,
  weekdayKey,
} from "./mcassist-time.js";

export const MAX_SHIFT_MINUTES = 12 * 60;
export const MIN_REST_MINUTES = 11 * 60;
export const MAX_WEEK_MINUTES = 48 * 60;
export const CORE_HOURS = { from: 6, to: 23 };

export const SHIFT_STATIONS = [
  "Front Counter",
  "Kitchen",
  "Drive-thru",
  "Fries",
  "Grill",
  "Lobby",
  "Shift Lead",
  "Training",
];

const SHIFT_STATION_ALIASES = {
  fries: "Fries",
  fry: "Fries",
  chips: "Fries",
  "fry station": "Fries",
  grill: "Grill",
  beef: "Grill",
  "grill and beef": "Grill",
  kitchen: "Kitchen",
  assembly: "Kitchen",
  "kitchen assembly": "Kitchen",
  initiator: "Kitchen",
  assembler: "Kitchen",
  "back of house": "Kitchen",
  boh: "Kitchen",
  "front counter": "Front Counter",
  front: "Front Counter",
  counter: "Front Counter",
  till: "Front Counter",
  tills: "Front Counter",
  fc: "Front Counter",
  "front of house": "Front Counter",
  foh: "Front Counter",
  "drive thru": "Drive-thru",
  "drive-thru": "Drive-thru",
  "drive through": "Drive-thru",
  drive: "Drive-thru",
  dt: "Drive-thru",
  headset: "Drive-thru",
  "pay window": "Drive-thru",
  "present window": "Drive-thru",
  lobby: "Lobby",
  "dining area": "Lobby",
  dining: "Lobby",
  "lobby host": "Lobby",
  cleaning: "Lobby",
  "shift lead": "Shift Lead",
  "shift leader": "Shift Lead",
  "shift manager": "Shift Lead",
  "shift running": "Shift Lead",
  floor: "Shift Lead",
  "floor manager": "Shift Lead",
  training: "Training",
  induction: "Training",
  chicken: "Chicken & Fryer",
  fryer: "Chicken & Fryer",
  "chicken and fryer": "Chicken & Fryer",
  "chicken & fryer": "Chicken & Fryer",
  drinks: "Drinks & McCafé",
  mccafe: "Drinks & McCafé",
  "mc cafe": "Drinks & McCafé",
  "mccafé": "Drinks & McCafé",
  cafe: "Drinks & McCafé",
  breakfast: "Breakfast",
  delivery: "Delivery",
  deliveries: "Delivery",
  tbc: "TBC",
  any: "TBC",
  anywhere: "TBC",
  "any station": "TBC",
};

export function normaliseShiftStation(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "TBC";
  const key = text.toLowerCase().replace(/\s*station$/, "").trim();
  if (SHIFT_STATION_ALIASES[key]) return SHIFT_STATION_ALIASES[key];
  const exact = SHIFT_STATIONS.find((s) => s.toLowerCase() === key);
  if (exact) return exact;
  return text
    .slice(0, 40)
    .replace(/\b([a-z])/g, (c) => c.toUpperCase());
}

export function durationMinutes(start, end) {
  if (!timeOk(start) || !timeOk(end)) return 0;
  let d = toMinutes(end) - toMinutes(start);
  if (d <= 0) d += 1440;
  return d;
}

export function defaultBreak(duration) {
  return duration > 360 ? 30 : 0;
}

export function paidMinutes(shift) {
  const d = durationMinutes(shift.start, shift.end);
  return Math.max(0, d - Math.max(0, Number(shift.breakMinutes) || 0));
}

export function hoursLabel(minutes) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m ? h + "h " + m + "m" : h + "h";
}

// Absolute wall-clock span in minutes (overnight shifts end the next day).
export function span(shift) {
  if (!isIsoDate(shift?.date) || !timeOk(shift?.start) || !timeOk(shift?.end)) return null;
  const start = dayNumber(shift.date) * 1440 + toMinutes(shift.start);
  return { start, end: start + durationMinutes(shift.start, shift.end) };
}

export function overlaps(a, b) {
  const x = span(a);
  const y = span(b);
  if (!x || !y) return false;
  return x.start < y.end && y.start < x.end;
}

export function timeRange(shift) {
  return shift.start + "–" + shift.end;
}

// ---- Availability -------------------------------------------------------

function windowsFromEntry(entry) {
  if (entry == null) return null;
  if (Array.isArray(entry)) return entry.filter((w) => w && timeOk(w.start) && timeOk(w.end));
  if (typeof entry === "object") {
    if (entry.available === false) return [];
    if (timeOk(entry.start) && timeOk(entry.end)) return [{ start: entry.start, end: entry.end }];
    return entry.available === true ? [{ start: "00:00", end: "00:00" }] : [];
  }
  return null;
}

export function hasAvailability(availability) {
  return Boolean(
    availability &&
      typeof availability === "object" &&
      WEEK_ORDER.some((k) => availability[k] !== undefined || availability[DAY_LONG[k].toLowerCase()] !== undefined),
  );
}

// { recorded, off, windows } for the weekday of `iso`.
export function availabilityForDate(availability, iso) {
  const key = weekdayKey(iso);
  return availabilityForDay(availability, key);
}

export function availabilityForDay(availability, key) {
  if (!availability || typeof availability !== "object") return { recorded: false, off: false, windows: [] };
  const entry = availability[key] ?? availability[DAY_LONG[key].toLowerCase()];
  const windows = windowsFromEntry(entry);
  if (windows === null) return { recorded: false, off: false, windows: [] };
  return { recorded: true, off: windows.length === 0, windows };
}

export function windowLabel(w) {
  if (w.start === "00:00" && w.end === "00:00") return "any time";
  return w.start + "–" + w.end;
}

export function fitsWindow(window, start, end) {
  const from = toMinutes(window.start);
  let until = toMinutes(window.end);
  if (until <= from) until += 1440;
  const s = toMinutes(start);
  const e = s + durationMinutes(start, end);
  // Allow a window such as 06:00–02:00 to contain a shift starting after midnight.
  return (s >= from && e <= until) || (s + 1440 >= from && e + 1440 <= until);
}

export function fitsAvailability(availability, shift) {
  const info = availabilityForDate(availability, shift.date);
  if (!info.recorded) return { status: "unknown", info };
  if (info.off) return { status: "off", info };
  return { status: info.windows.some((w) => fitsWindow(w, shift.start, shift.end)) ? "fits" : "outside", info };
}

// "Mon, Tue, Thu–Sat 09:00–23:00 · off Wed · Sun not set"
export function describeAvailability(availability) {
  if (!hasAvailability(availability)) return "No availability recorded";
  const groups = [];
  const off = [];
  const unknown = [];
  for (const key of WEEK_ORDER) {
    const info = availabilityForDay(availability, key);
    if (!info.recorded) unknown.push(key);
    else if (info.off) off.push(key);
    else {
      const label = info.windows.map(windowLabel).join(", ");
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.days.push(key);
      else groups.push({ label, days: [key] });
    }
  }
  const dayList = (days) => {
    const runs = [];
    for (const d of days) {
      const idx = WEEK_ORDER.indexOf(d);
      const run = runs[runs.length - 1];
      if (run && WEEK_ORDER.indexOf(run[run.length - 1]) === idx - 1) run.push(d);
      else runs.push([d]);
    }
    return runs
      .map((r) => (r.length >= 3 ? DAY_SHORT[r[0]] + "–" + DAY_SHORT[r[r.length - 1]] : r.map((d) => DAY_SHORT[d]).join(", ")))
      .join(", ");
  };
  // Merge groups with the same hours even when not adjacent.
  const byLabel = new Map();
  for (const g of groups) byLabel.set(g.label, [...(byLabel.get(g.label) || []), ...g.days]);
  const parts = [...byLabel.entries()].map(([label, days]) =>
    dayList(WEEK_ORDER.filter((d) => days.includes(d))) + " " + label,
  );
  if (off.length) parts.push("off " + dayList(off));
  if (unknown.length) parts.push(dayList(unknown) + " not set");
  return parts.join(" · ");
}

export function availabilityMap(availability) {
  const out = {};
  for (const key of WEEK_ORDER) {
    const info = availabilityForDay(availability, key);
    out[key] = !info.recorded ? "not set" : info.off ? "off" : info.windows.map(windowLabel).join(", ");
  }
  return out;
}

// ---- Validation ----------------------------------------------------------

export function weekMinutes(shifts, iso) {
  const { from, to } = weekRange(iso);
  return shifts
    .filter((s) => s.date >= from && s.date <= to)
    .reduce((sum, s) => sum + paidMinutes(s), 0);
}

function describeShort(shift) {
  return dateLabel(shift.date) + " " + timeRange(shift);
}

// Checks one proposed shift for a member against their other shifts.
// Returns { status: ok|warning|blocked, notes: [] }.
export function evaluateShift({ member, shift, others = [], today, nowMinutes = 0, allowPast = false }) {
  const blocked = [];
  const warnings = [];
  const pastNotes = [];
  const name = firstName(member?.name);

  if (!isIsoDate(shift.date)) blocked.push("The date isn't valid.");
  if (!timeOk(shift.start) || !timeOk(shift.end)) blocked.push("Start and end must be 24-hour HH:MM times.");
  if (blocked.length) return { status: "blocked", notes: blocked };

  const duration = durationMinutes(shift.start, shift.end);
  if (shift.start === shift.end) blocked.push("The shift has no length.");
  else if (duration > MAX_SHIFT_MINUTES) blocked.push("Shifts can be at most 12 hours (this is " + hoursLabel(duration) + ").");
  if ((Number(shift.breakMinutes) || 0) >= duration) blocked.push("The break must be shorter than the shift.");
  if (today) {
    const past = allowPast ? pastNotes : blocked;
    if (shift.date < today) past.push(dateLabel(shift.date) + " is in the past.");
    else if (shift.date === today && toMinutes(shift.start) <= nowMinutes)
      past.push("That start time has already passed today.");
    if (shift.date > addDays(today, 366)) blocked.push("That date is more than a year away.");
  }
  if (member && String(member.status || "").toLowerCase() === "inactive")
    blocked.push((member.name || "This person") + "'s account is deactivated.");

  const clash = others.find((o) => overlaps(o, shift));
  if (clash) blocked.push("Clashes with " + name + "'s " + describeShort(clash) + " shift.");
  if (blocked.length) return { status: "blocked", notes: blocked };

  warnings.push(...pastNotes);
  const fit = fitsAvailability(member?.availability, shift);
  if (fit.status === "off") warnings.push(name + " is marked unavailable on " + DAY_LONG[weekdayKey(shift.date)] + "s.");
  else if (fit.status === "outside")
    warnings.push(
      "Outside " + name + "'s availability (" + DAY_SHORT[weekdayKey(shift.date)] + " " + fit.info.windows.map(windowLabel).join(", ") + ").",
    );
  else if (fit.status === "unknown")
    warnings.push(
      hasAvailability(member?.availability)
        ? name + " hasn't set availability for " + DAY_LONG[weekdayKey(shift.date)] + "s."
        : name + " hasn't recorded any availability yet.",
    );

  const me = span(shift);
  for (const other of others) {
    const o = span(other);
    if (!o) continue;
    const gap = o.start >= me.end ? o.start - me.end : me.start >= o.end ? me.start - o.end : null;
    if (gap != null && gap < MIN_REST_MINUTES) {
      warnings.push("Only " + hoursLabel(gap) + " rest next to the " + describeShort(other) + " shift (11h recommended).");
      break;
    }
  }

  const weekTotal = weekMinutes([...others, shift], shift.date);
  if (weekTotal > MAX_WEEK_MINUTES)
    warnings.push("Takes " + name + " to " + hoursLabel(weekTotal) + " that week (over 48h).");

  return { status: warnings.length ? "warning" : "ok", notes: warnings };
}

export function firstName(name) {
  return String(name || "They").trim().split(/\s+/)[0] || "They";
}

// ---- Slot suggestions ----------------------------------------------------

// Finds candidate shift dates for one member inside their availability,
// without overlaps, keeping 11 hours' rest, and flagging 48-hour weeks.
export function suggestSlots({
  member,
  existing = [],
  from,
  to,
  count = 0,
  start = null,
  end = null,
  lengthMinutes = 0,
  station = "TBC",
  breakMinutes = null,
  daysOfWeek = [],
  today,
  nowMinutes = 0,
}) {
  const dates = datesInRange(from, to, 62);
  const chosen = [];
  const excluded = [];
  const availableDays = [];
  const needsTimes = !start && !lengthMinutes;
  for (const date of dates) {
    const key = weekdayKey(date);
    if (daysOfWeek.length && !daysOfWeek.includes(key)) continue;
    const info = availabilityForDate(member.availability, date);
    if (info.recorded && info.off) {
      excluded.push({ date, reason: "unavailable (" + DAY_SHORT[key] + " off)" });
      continue;
    }
    const clashDay = existing.find((s) => s.date === date);
    if (needsTimes) {
      if (clashDay) excluded.push({ date, reason: "already working " + timeRange(clashDay) });
      else
        availableDays.push({
          date,
          day: dateLabel(date),
          window: info.recorded ? info.windows.map(windowLabel).join(", ") : "not set",
        });
      continue;
    }
    if (clashDay) {
      excluded.push({ date, reason: "already working " + timeRange(clashDay) });
      continue;
    }
    let slotStart = start;
    let slotEnd = end;
    if (!slotStart) {
      if (!info.recorded || !info.windows.length) {
        excluded.push({ date, reason: "no availability recorded to place the shift" });
        continue;
      }
      slotStart = info.windows[0].start === "00:00" && info.windows[0].end === "00:00" ? "09:00" : info.windows[0].start;
    }
    if (!slotEnd) slotEnd = fromMinutes(toMinutes(slotStart) + (lengthMinutes || 480));
    const duration = durationMinutes(slotStart, slotEnd);
    const shift = {
      date,
      start: slotStart,
      end: slotEnd,
      station,
      breakMinutes: breakMinutes == null ? defaultBreak(duration) : breakMinutes,
    };
    const verdict = evaluateShift({
      member,
      shift,
      others: [...existing, ...chosen],
      today,
      nowMinutes,
    });
    if (verdict.status === "blocked") {
      excluded.push({ date, reason: verdict.notes[0] });
      continue;
    }
    const fit = fitsAvailability(member.availability, shift);
    if (fit.status === "outside" || fit.status === "off") {
      excluded.push({ date, reason: verdict.notes[0] || "outside availability" });
      continue;
    }
    chosen.push({ ...shift, day: dateLabel(date), status: verdict.status, notes: verdict.notes });
  }
  const wanted = Math.max(0, Math.floor(Number(count) || 0));
  return {
    needsTimes,
    availableDays,
    candidates: chosen,
    recommended: wanted ? chosen.slice(0, wanted) : chosen,
    enough: wanted ? chosen.length >= wanted : true,
    excluded: excluded.slice(0, 40),
  };
}

// ---- Coverage -------------------------------------------------------------

// Headcount by hour for each date, including overnight spill from the day before.
export function coverage(shifts, dates) {
  return dates.map((date) => {
    const counts = Array(24).fill(0);
    const dayStart = dayNumber(date) * 1440;
    const people = [];
    for (const s of shifts) {
      const sp = span(s);
      if (!sp || sp.end <= dayStart || sp.start >= dayStart + 1440) continue;
      if (s.date === date) people.push(s);
      for (let h = 0; h < 24; h++) {
        const hs = dayStart + h * 60;
        if (sp.start < hs + 60 && sp.end > hs) counts[h]++;
      }
    }
    const coreHours = [];
    for (let h = CORE_HOURS.from; h < CORE_HOURS.to; h++) coreHours.push(h);
    const gaps = runs(coreHours.filter((h) => counts[h] === 0));
    const thin = runs(coreHours.filter((h) => counts[h] === 1));
    const peak = counts.reduce((best, c, h) => (c > best.count ? { hour: h, count: c } : best), { hour: 0, count: 0 });
    const byStation = {};
    for (const s of people) byStation[s.station || "TBC"] = (byStation[s.station || "TBC"] || 0) + 1;
    const headcount = {};
    counts.forEach((c, h) => {
      if (c) headcount[String(h).padStart(2, "0") + ":00"] = c;
    });
    return {
      date,
      day: dateLabel(date),
      people: people
        .sort((a, b) => String(a.start).localeCompare(String(b.start)))
        .map((s) => ({
          shiftId: s.id,
          name: s.userName || "Crew member",
          time: timeRange(s),
          station: s.station || "TBC",
        })),
      headcountByHour: headcount,
      peak: peak.count
        ? String(peak.hour).padStart(2, "0") + ":00 (" + peak.count + (peak.count === 1 ? " person)" : " people)")
        : "nobody scheduled",
      noCover: gaps,
      onlyOnePerson: thin,
      byStation,
    };
  });
}

function runs(hours) {
  const out = [];
  let startH = null;
  let prev = null;
  for (const h of hours) {
    if (startH === null) startH = h;
    else if (h !== prev + 1) {
      out.push(label(startH, prev + 1));
      startH = h;
    }
    prev = h;
  }
  if (startH !== null) out.push(label(startH, prev + 1));
  return out;
  function label(a, b) {
    return String(a).padStart(2, "0") + ":00–" + String(b).padStart(2, "0") + ":00";
  }
}

export function compactShift(s) {
  return {
    id: s.id,
    userId: s.userId,
    userName: s.userName || "Crew member",
    date: s.date,
    day: dateLabel(s.date),
    start: s.start,
    end: s.end,
    station: s.station || "TBC",
    breakMinutes: Number(s.breakMinutes) || 0,
    paidHours: Math.round((paidMinutes(s) / 60) * 100) / 100,
  };
}

// Normalised { mon: { available, start, end } } map (legacy formats included).
export function availabilityObject(availability) {
  const out = {};
  for (const key of WEEK_ORDER) {
    const info = availabilityForDay(availability, key);
    if (!info.recorded) continue;
    out[key] = info.off
      ? { available: false }
      : { available: true, start: info.windows[0].start, end: info.windows[0].end };
  }
  return out;
}

export function sortShifts(list) {
  return [...list].sort((a, b) => String(a.date + a.start).localeCompare(String(b.date + b.start)));
}
