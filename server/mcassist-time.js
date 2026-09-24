// Date and time helpers for McAssist. The restaurant runs on UK time, so every
// "today", "this week" and "next week" is worked out in Europe/London, whatever
// time zone the server happens to run in. Calendar dates are handled as plain
// YYYY-MM-DD strings and shift times as wall-clock HH:MM strings.

export const TIME_ZONE = "Europe/London";
export const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
export const WEEK_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export const DAY_SHORT = { sun: "Sun", mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat" };
export const DAY_LONG = {
  sun: "Sunday",
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const londonParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const pad = (n) => String(n).padStart(2, "0");

// Current London calendar date, clock time and minutes since midnight.
export function londonNow(ms = Date.now()) {
  const parts = londonParts.formatToParts(new Date(ms));
  const get = (type) => parts.find((p) => p.type === type)?.value || "00";
  let hour = Number(get("hour"));
  if (hour === 24) hour = 0;
  const minute = Number(get("minute"));
  return {
    date: get("year") + "-" + get("month") + "-" + get("day"),
    time: pad(hour) + ":" + pad(minute),
    minutes: hour * 60 + minute,
  };
}

export function londonDate(ms = Date.now()) {
  return londonNow(ms).date;
}

export function isIsoDate(value) {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const d = new Date(text + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text;
}

export function addDays(iso, days) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

// Whole days since 1970-01-01 for a calendar date (used for shift arithmetic).
export function dayNumber(iso) {
  return Math.round(Date.parse(iso + "T00:00:00Z") / 86400000);
}

export function daysBetween(from, to) {
  return dayNumber(to) - dayNumber(from);
}

export function weekdayKey(iso) {
  return DAY_KEYS[new Date(iso + "T12:00:00Z").getUTCDay()];
}

export function weekStart(iso) {
  const key = weekdayKey(iso);
  return addDays(iso, -WEEK_ORDER.indexOf(key));
}

// Weeks run Monday to Sunday. offset 0 = the week containing `iso`.
export function weekRange(iso, offset = 0) {
  const from = addDays(weekStart(iso), offset * 7);
  return { from, to: addDays(from, 6) };
}

export function dateLabel(iso) {
  if (!isIsoDate(iso)) return String(iso || "");
  const d = new Date(iso + "T12:00:00Z");
  return DAY_SHORT[weekdayKey(iso)] + " " + d.getUTCDate() + " " + MONTHS[d.getUTCMonth()];
}

const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// "Friday 25 September 2026"
export function longDate(iso) {
  if (!isIsoDate(iso)) return String(iso || "");
  const d = new Date(iso + "T12:00:00Z");
  return DAY_LONG[weekdayKey(iso)] + " " + d.getUTCDate() + " " + MONTHS_LONG[d.getUTCMonth()] + " " + d.getUTCFullYear();
}

export function shortDate(iso) {
  if (!isIsoDate(iso)) return String(iso || "");
  const d = new Date(iso + "T12:00:00Z");
  return d.getUTCDate() + " " + MONTHS[d.getUTCMonth()];
}

export function rangeLabel(from, to) {
  if (!to || from === to) return dateLabel(from);
  return shortDate(from) + " – " + shortDate(to);
}

export function datesInRange(from, to, max = 62) {
  const out = [];
  if (!isIsoDate(from) || !isIsoDate(to) || to < from) return out;
  for (let d = from; d <= to && out.length < max; d = addDays(d, 1)) out.push(d);
  return out;
}

// A compact calendar the model can use to turn weekdays into dates.
export function calendar(today, days = 28) {
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(today, i);
    return date + " " + DAY_SHORT[weekdayKey(date)];
  });
}

export function timeOk(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ""));
}

export function toMinutes(time) {
  return Number(String(time).slice(0, 2)) * 60 + Number(String(time).slice(3, 5));
}

export function fromMinutes(total) {
  const m = ((Math.round(total) % 1440) + 1440) % 1440;
  return pad(Math.floor(m / 60)) + ":" + pad(m % 60);
}

// Accepts "16:00", "4pm", "4:30 pm", "1600", "16.30", "9", "noon", "midnight".
export function parseTime(value) {
  if (value == null) return null;
  const raw = String(value).trim().toLowerCase().replace(/\s+/g, "");
  if (!raw) return null;
  if (raw === "noon" || raw === "midday") return "12:00";
  if (raw === "midnight") return "00:00";
  let m = raw.match(/^(\d{1,2})(?:[:.h](\d{2}))?(am|pm)?$/);
  if (!m) {
    const compact = raw.match(/^(\d{2})(\d{2})$/);
    if (compact) m = [raw, compact[1], compact[2], undefined];
  }
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2] || 0);
  const suffix = m[3];
  if (suffix === "pm" && hour < 12) hour += 12;
  if (suffix === "am" && hour === 12) hour = 0;
  if (hour === 24 && minute === 0) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return pad(hour) + ":" + pad(minute);
}

const DAY_WORDS = {
  sun: "sun",
  sunday: "sun",
  mon: "mon",
  monday: "mon",
  tue: "tue",
  tues: "tue",
  tuesday: "tue",
  wed: "wed",
  weds: "wed",
  wednesday: "wed",
  thu: "thu",
  thur: "thu",
  thurs: "thu",
  thursday: "thu",
  fri: "fri",
  friday: "fri",
  sat: "sat",
  saturday: "sat",
};

export function parseDayKey(value) {
  const key = String(value || "").trim().toLowerCase().replace(/[^a-z]/g, "");
  return DAY_WORDS[key] || null;
}

// Expands "weekdays", "weekend", "every day" etc. into day keys.
export function expandDays(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return [];
  if (/^(every ?day|all|daily|all days|all week|everyday)$/.test(text)) return [...WEEK_ORDER];
  if (/^(weekdays?|mon(day)?\s*(-|–|to)\s*fri(day)?)$/.test(text)) return ["mon", "tue", "wed", "thu", "fri"];
  if (/^(weekends?|sat(urday)?\s*(-|–|and|&)\s*sun(day)?)$/.test(text)) return ["sat", "sun"];
  const single = parseDayKey(text);
  return single ? [single] : [];
}

// Lenient date parsing for tool arguments. The model normally sends ISO dates,
// but "today", "tomorrow", weekday names and DD/MM are accepted too.
export function parseDateInput(value, today) {
  if (value == null) return null;
  const text = String(value).trim().toLowerCase();
  if (!text) return null;
  if (isIsoDate(text)) return text;
  if (text === "today") return today;
  if (text === "tomorrow" || text === "tmrw" || text === "tmr") return addDays(today, 1);
  const next = text.match(/^(next|this)\s+(\w+)$/);
  const dayKey = parseDayKey(next ? next[2] : text);
  if (dayKey) {
    let offset = (WEEK_ORDER.indexOf(dayKey) - WEEK_ORDER.indexOf(weekdayKey(today)) + 7) % 7;
    if (next && next[1] === "next") {
      // "next Monday" means the Monday of next week.
      const nextWeek = weekRange(today, 1).from;
      return addDays(nextWeek, WEEK_ORDER.indexOf(dayKey));
    }
    return addDays(today, offset);
  }
  const dm = text.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/);
  if (dm) {
    const year = dm[3] ? (dm[3].length === 2 ? "20" + dm[3] : dm[3]) : today.slice(0, 4);
    let iso = year + "-" + pad(dm[2]) + "-" + pad(dm[1]);
    if (!isIsoDate(iso)) return null;
    if (!dm[3] && iso < addDays(today, -60)) iso = String(Number(year) + 1) + iso.slice(4);
    return isIsoDate(iso) ? iso : null;
  }
  return null;
}

export function formatDateTime(ms) {
  if (!Number.isFinite(Number(ms))) return "";
  const now = londonNow(Number(ms));
  return dateLabel(now.date) + " " + now.time;
}
