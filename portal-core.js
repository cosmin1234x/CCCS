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
