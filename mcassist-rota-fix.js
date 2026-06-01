import { auth, db } from "./firebase-init.js";
import { collection, addDoc, deleteDoc, doc, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const CORE_STATIONS = ["Grill", "Fries", "Front Counter", "Drive Thru", "Kitchen"];
const ALL_STATIONS = ["Grill", "Fries", "Front Counter", "Drive Thru", "Kitchen", "Lobby", "Drinks", "Runner", "Cleaning", "Stock"];
const MIN_SHIFT_MINS = 3 * 60;
const MAX_SHIFT_MINS = 8 * 60;

function norm(v) {
  return String(v || "").toLowerCase().replace(/[^a-z0-9:\s-]/g, " ").replace(/\s+/g, " ").trim();
}

function safeText(v) {
  return String(v || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\n", "<br>");
}

function addMsg(text, from = "bot") {
  const chat = $("aiChat");
  if (!chat) return;
  const msg = document.createElement("div");
  msg.className = `message ${from === "user" ? "msg-user" : "msg-bot"}`;
  msg.innerHTML = `<div class="bubble">${safeText(text)}</div><div class="msg-meta">${from === "user" ? "You" : "McAssist"}</div>`;
  chat.appendChild(msg);
  chat.scrollTop = chat.scrollHeight;
}

function getUser() {
  try {
    const cached = JSON.parse(localStorage.getItem("mc_session_user") || "null");
    if (cached) return cached;
  } catch {}
  return { id: auth.currentUser?.uid || "", name: auth.currentUser?.email || "User", role: "crew", storeId: "store001" };
}

function canManage(user) {
  const role = String(user?.role || "").toLowerCase().replace(/\s+/g, "");
  return role === "manager" || role === "shiftcreator" || role === "admin";
}

function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toMinutes(hhmm) {
  const [h, m] = String(hhmm || "00:00").split(":").map((n) => Number(n) || 0);
  return h * 60 + m;
}

function toHHMM(mins) {
  mins = ((Math.round(mins) % 1440) + 1440) % 1440;
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  let aS = toMinutes(aStart), aE = toMinutes(aEnd), bS = toMinutes(bStart), bE = toMinutes(bEnd);
  if (aE <= aS) aE += 1440;
  if (bE <= bS) bE += 1440;
  return aS < bE && bS < aE;
}

function hoursBetween(start, end) {
  let s = toMinutes(start);
  let e = toMinutes(end);
  if (e <= s) e += 1440;
  return Math.max(0, (e - s) / 60);
}

function parseTime(v) {
  if (!v) return null;
  let raw = String(v).toLowerCase().trim().replace(/\./g, ":");
  const ampm = raw.match(/(am|pm)$/)?.[1] || "";
  raw = raw.replace(/(am|pm)$/g, "").trim();
  let h = 0, m = 0;
  if (raw.includes(":")) {
    const p = raw.split(":");
    h = Number(p[0]);
    m = Number(p[1] || 0);
  } else {
    h = Number(raw);
  }
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  if (ampm === "pm" && h < 12) h += 12;
  if (ampm === "am" && h === 12) h = 0;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function parseTimeRange(text) {
  const m = String(text || "").toLowerCase().match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:-|–|to|until|till)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
  if (!m) return { start: "06:00", end: "23:00" };
  let left = m[1].trim();
  const right = m[2].trim();
  if (!/[ap]m/i.test(left) && /pm/i.test(right)) left += "am";
  let start = parseTime(left);
  let end = parseTime(right);
  if (!start || !end) return { start: "06:00", end: "23:00" };
  if (!/[ap]m/i.test(m[1]) && !/[ap]m/i.test(m[2])) {
    const sh = Number(start.split(":")[0]);
    const eh = Number(end.split(":")[0]);
    if (sh >= 4 && sh <= 11 && eh >= 8 && eh <= 11) end = `${String(eh + 12).padStart(2, "0")}:00`;
  }
  return { start, end };
}

function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() + ((day === 0 ? -6 : 1) - day));
  d.setHours(0, 0, 0, 0);
  return d;
}

function getDates(text) {
  const t = norm(text);
  if (t.includes("today")) return [new Date()];
  if (t.includes("tomorrow")) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return [d];
  }
  const start = getMonday(new Date());
  if (t.includes("next week")) start.setDate(start.getDate() + 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

function rangeLabel(text, dates) {
  const t = norm(text);
  if (t.includes("today")) return "today";
  if (t.includes("tomorrow")) return "tomorrow";
  if (t.includes("next week")) return "next week";
  return dates.length === 1 ? toISO(dates[0]) : "this week";
}

function canonicalStation(station) {
  const s = norm(station).replace(/drive thru/g, "drive").replace(/front counter/g, "front");
  if (s.includes("grill")) return "Grill";
  if (s.includes("fries") || s.includes("chips")) return "Fries";
  if (s.includes("front") || s.includes("counter") || s.includes("till")) return "Front Counter";
  if (s.includes("drive")) return "Drive Thru";
  if (s.includes("kitchen") || s.includes("line") || s.includes("chicken")) return "Kitchen";
  if (s.includes("lobby")) return "Lobby";
  if (s.includes("drink")) return "Drinks";
  if (s.includes("runner")) return "Runner";
  if (s.includes("clean")) return "Cleaning";
  if (s.includes("stock")) return "Stock";
  return "";
}

function getPersonStations(person) {
  const raw = [];
  [person.stations, person.certifications, person.availableStations, person.trainedStations].forEach((v) => {
    if (Array.isArray(v)) raw.push(...v);
  });
  [person.skills, person.stationSkills, person.certifiedStations].forEach((obj) => {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return;
    Object.entries(obj).forEach(([key, value]) => {
      if (value === true || value === "yes" || value === "trained" || value === "master" || Number(value) > 0) raw.push(key);
    });
  });
  const cleaned = [...new Set(raw.map(canonicalStation).filter(Boolean))];
  return cleaned.length ? cleaned : CORE_STATIONS;
}

function knowsStation(person, station) {
  return getPersonStations(person).map(canonicalStation).includes(canonicalStation(station));
}

function getDayKey(dateISO) {
  const d = new Date(`${dateISO}T12:00:00`);
  const long = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][d.getDay()];
  return { long, short: long.slice(0, 3) };
}

function getAvailability(person, dateISO) {
  const { long, short } = getDayKey(dateISO);
  const sources = [person.availability, person.available, person.availableTimes, person.availabilityByDay].filter(Boolean);
  for (const source of sources) {
    if (typeof source === "boolean") return source;
    if (source[dateISO] !== undefined) return source[dateISO];
    if (source[long] !== undefined) return source[long];
    if (source[short] !== undefined) return source[short];
  }
  if (Array.isArray(person.availableDays) && person.availableDays.length) {
    const days = person.availableDays.map(norm);
    if (!days.includes(long) && !days.includes(short) && !days.includes(dateISO)) return false;
  }
  return true;
}

function normaliseRawAvailabilityWindows(raw) {
  if (raw === undefined || raw === null || raw === "") return [{ start: null, end: null }];
  if (raw === true || raw === "all" || raw === "any" || raw === "available" || raw === "yes") return [{ start: null, end: null }];
  if (raw === false || raw === "off" || raw === "no" || raw === "unavailable") return [];

  const list = Array.isArray(raw) ? raw : [raw];
  const windows = [];

  for (let item of list) {
    if (item === undefined || item === null || item === "") {
      windows.push({ start: null, end: null });
      continue;
    }
    if (item === true || item === "all" || item === "any" || item === "available" || item === "yes") {
      windows.push({ start: null, end: null });
      continue;
    }
    if (item === false || item === "off" || item === "no" || item === "unavailable") continue;

    if (typeof item === "string") {
      const m = item.match(/(\d{1,2}:?\d{0,2}\s*(?:am|pm)?)\s*(?:-|to)\s*(\d{1,2}:?\d{0,2}\s*(?:am|pm)?)/i);
      if (!m) {
        windows.push({ start: null, end: null });
        continue;
      }
      windows.push({ start: parseTime(m[1]), end: parseTime(m[2]) });
      continue;
    }

    if (typeof item === "object") {
      if (item.available === false || item.enabled === false || item.canWork === false || item.off === true) continue;
      const start = item.start || item.from || item.open || item.begin || null;
      const end = item.end || item.to || item.close || item.finish || null;
      windows.push({ start, end });
    }
  }

  return windows.length ? windows : [];
}

function getAvailabilityWindows(person, dateISO, storeHours) {
  if (person.active === false || person.disabled === true) return [];
  if (Array.isArray(person.unavailableDates) && person.unavailableDates.includes(dateISO)) return [];

  const open = toMinutes(storeHours.start);
  let close = toMinutes(storeHours.end);
  if (close <= open) close += 1440;

  const rawWindows = normaliseRawAvailabilityWindows(getAvailability(person, dateISO));
  const windows = [];

  for (const raw of rawWindows) {
    const rawStart = raw.start ? (parseTime(raw.start) || raw.start) : storeHours.start;
    const rawEnd = raw.end ? (parseTime(raw.end) || raw.end) : storeHours.end;

    let a = toMinutes(rawStart);
    let b = toMinutes(rawEnd);
    if (b <= a) b += 1440;

    const start = Math.max(open, a);
    const end = Math.min(close, b);
    if (end - start >= MIN_SHIFT_MINS) windows.push({ start, end });
  }

  return windows;
}

function rangeCovers(range, start, end) {
  if (range === undefined || range === null || range === "") return true;
  if (Array.isArray(range) && range.length === 0) return true;
  if (range === true || range === "all" || range === "any" || range === "available" || range === "yes") return true;
  if (range === false || range === "off" || range === "no" || range === "unavailable") return false;
  const ranges = Array.isArray(range) ? range : [range];
  return ranges.some((r) => {
    if (r === undefined || r === null || r === "") return true;
    if (r === true || r === "all" || r === "any" || r === "available" || r === "yes") return true;
    if (r === false || r === "off" || r === "no" || r === "unavailable") return false;
    if (typeof r === "string") {
      const m = r.match(/(\d{1,2}:?\d{0,2}\s*(?:am|pm)?)\s*(?:-|to)\s*(\d{1,2}:?\d{0,2}\s*(?:am|pm)?)/i);
      if (!m) return true;
      r = { start: parseTime(m[1]), end: parseTime(m[2]) };
    }
    if (typeof r === "object") {
      if (r.available === false || r.enabled === false || r.canWork === false || r.off === true) return false;
      if (r.available === true && !r.start && !r.end && !r.from && !r.to) return true;
      const rs = r.start || r.from || r.open || r.begin;
      const re = r.end || r.to || r.close || r.finish;
      if (!rs || !re) return true;
      let a = toMinutes(parseTime(rs) || rs), b = toMinutes(parseTime(re) || re), s = toMinutes(start), e = toMinutes(end);
      if (b <= a) b += 1440;
      if (e <= s) e += 1440;
      return a <= s && e <= b;
    }
    return true;
  });
}

function isAvailable(person, dateISO, start, end) {
  return rangeCovers(getAvailability(person, dateISO), start, end);
}

async function getCrew(storeId, currentUser) {
  const snap = await getDocs(query(collection(db, "users"), where("storeId", "==", storeId)));
  const all = [];
  snap.forEach((item) => {
    const data = item.data() || {};
    const roleKey = String(data.role || "crew").toLowerCase().replace(/\s+/g, "");
    all.push({ id: item.id, name: data.name || data.email || "Crew", role: data.role || "crew", roleKey, ...data });
  });
  let crew = all.filter((p) => !/manager|admin|shiftcreator/.test(p.roleKey));
  if (!crew.length) crew = all.filter((p) => !/manager|admin/.test(p.roleKey));
  if (crew.length > 1 && currentUser?.id) {
    const withoutSelf = crew.filter((p) => p.id !== currentUser.id);
    if (withoutSelf.length) crew = withoutSelf;
  }
  return crew.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

async function getShifts(storeId, dates) {
  const wanted = new Set(dates.map(toISO));
  const snap = await getDocs(collection(db, "stores", storeId, "Shifts"));
  const shifts = [];
  snap.forEach((item) => {
    const data = item.data() || {};
    if (wanted.has(data.date)) shifts.push({ id: item.id, ...data });
  });
  return shifts;
}

async function removeShifts(text, user, onlyGenerated = false) {
  if (!canManage(user)) return "Only a manager or shift creator can remove shifts.";
  const storeId = user.storeId || "store001";
  const dates = getDates(text);
  const shifts = await getShifts(storeId, dates);
  const targets = onlyGenerated ? shifts.filter((s) => s.autoRota || s.createdByAI || s.generatedByAI) : shifts;
  for (const shift of targets) await deleteDoc(doc(db, "stores", storeId, "Shifts", shift.id));
  return `Removed ${targets.length} ${onlyGenerated ? "AI-generated " : ""}shift(s) for ${rangeLabel(text, dates)} ✅`;
}

function chooseStations(text, people) {
  const t = norm(text);
  if (t.includes("every station") || t.includes("all station")) return ALL_STATIONS;
  if (t.includes("core station") || t.includes("main station")) return CORE_STATIONS;
  const learned = new Set();
  people.forEach((p) => getPersonStations(p).forEach((s) => learned.add(canonicalStation(s))));
  const knownCore = CORE_STATIONS.filter((s) => learned.has(canonicalStation(s)));
  return knownCore.length ? knownCore : CORE_STATIONS;
}

function shiftTimeForStation(station, hours) {
  const open = toMinutes(hours.start);
  let close = toMinutes(hours.end);
  if (close <= open) close += 1440;
  const window = close - open;
  const make = (percent, lengthHours) => {
    const length = Math.min(lengthHours * 60, window, MAX_SHIFT_MINS);
    const start = Math.min(open + Math.floor(window * percent), Math.max(open, close - length));
    return { start: toHHMM(start), end: toHHMM(Math.min(start + length, close)) };
  };
  const key = canonicalStation(station);
  if (key === "Grill" || key === "Kitchen") return make(0, 8);
  if (key === "Fries" || key === "Front Counter") return make(0.25, 8);
  if (key === "Drive Thru" || key === "Runner" || key === "Drinks") return make(0.35, 8);
  return make(0.5, 6);
}

function fitShiftIntoWindow(ideal, window) {
  let idealStart = toMinutes(ideal.start);
  let idealEnd = toMinutes(ideal.end);
  if (idealEnd <= idealStart) idealEnd += 1440;

  const preferredLength = Math.min(MAX_SHIFT_MINS, idealEnd - idealStart);
  const windowLength = window.end - window.start;
  const length = Math.min(preferredLength, windowLength);
  if (length < MIN_SHIFT_MINS) return null;

  let start = idealStart;
  if (start < window.start) start = window.start;
  if (start + length > window.end) start = window.end - length;
  if (start < window.start) start = window.start;

  const end = start + length;
  return {
    start: toHHMM(start),
    end: toHHMM(end),
    adjusted: toHHMM(start) !== ideal.start || toHHMM(end) !== ideal.end
  };
}

function bestTimeForPerson(person, dateISO, station, ideal, hours) {
  const windows = getAvailabilityWindows(person, dateISO, hours);
  const options = windows.map((window) => fitShiftIntoWindow(ideal, window)).filter(Boolean);
  if (!options.length) return null;

  // Prefer the time closest to the station's ideal time, but allow adjusted availability-fitting shifts.
  const idealStart = toMinutes(ideal.start);
  return options.sort((a, b) => Math.abs(toMinutes(a.start) - idealStart) - Math.abs(toMinutes(b.start) - idealStart))[0];
}

function choosePersonAndTime({ people, station, dateISO, ideal, hours, shifts, workDays, shiftCount, weeklyHours }) {
  const candidates = [];

  for (const p of people) {
    if ((workDays[p.id]?.size || 0) >= 5) continue; // at least 2 days off
    if (shifts.some((s) => s.userId === p.id && s.date === dateISO)) continue; // one shift per day

    const fitted = bestTimeForPerson(p, dateISO, station, ideal, hours);
    if (!fitted) continue;
    if (shifts.some((s) => s.userId === p.id && s.date === dateISO && overlaps(s.start, s.end, fitted.start, fitted.end))) continue;

    const maxH = Number(p.maxWeeklyHours || p.maxHours || p.contractHours || p.hoursPerWeek || 40);
    const addH = hoursBetween(fitted.start, fitted.end);
    if ((weeklyHours[p.id] || 0) + addH > maxH + 0.01) continue;

    candidates.push({ person: p, time: fitted });
  }

  candidates.sort((a, b) => {
    const aSkill = knowsStation(a.person, station) ? 0 : 1;
    const bSkill = knowsStation(b.person, station) ? 0 : 1;
    if (aSkill !== bSkill) return aSkill - bSkill;

    const aAdjusted = a.time.adjusted ? 1 : 0;
    const bAdjusted = b.time.adjusted ? 1 : 0;
    if (aAdjusted !== bAdjusted) return aAdjusted - bAdjusted;

    const aDays = workDays[a.person.id]?.size || 0;
    const bDays = workDays[b.person.id]?.size || 0;
    if (aDays !== bDays) return aDays - bDays;

    if ((shiftCount[a.person.id] || 0) !== (shiftCount[b.person.id] || 0)) {
      return (shiftCount[a.person.id] || 0) - (shiftCount[b.person.id] || 0);
    }

    if ((weeklyHours[a.person.id] || 0) !== (weeklyHours[b.person.id] || 0)) {
      return (weeklyHours[a.person.id] || 0) - (weeklyHours[b.person.id] || 0);
    }

    return String(a.person.name).localeCompare(String(b.person.name));
  });

  return candidates[0] || null;
}

async function generateSmartShifts(text, user) {
  if (!canManage(user)) return "Only a manager or shift creator can generate smart shifts.";
  const storeId = user.storeId || "store001";
  const dates = getDates(text);
  const hours = parseTimeRange(text);
  const people = await getCrew(storeId, user);
  if (people.length < 2) return "Smart shift generation needs at least 2 crew users.";

  const oldShifts = await getShifts(storeId, dates);
  for (const shift of oldShifts) await deleteDoc(doc(db, "stores", storeId, "Shifts", shift.id));

  const stations = chooseStations(text, people);
  const maxPossible = people.length * Math.min(5, dates.length);
  const requested = dates.length * stations.length;
  const shifts = [];
  const workDays = Object.fromEntries(people.map((p) => [p.id, new Set()]));
  const shiftCount = Object.fromEntries(people.map((p) => [p.id, 0]));
  const weeklyHours = Object.fromEntries(people.map((p) => [p.id, 0]));
  const coverage = Object.fromEntries(stations.map((s) => [s, 0]));
  const gaps = [];
  let created = 0;
  let adjustedCount = 0;

  for (let dayIndex = 0; dayIndex < dates.length; dayIndex++) {
    const dateISO = toISO(dates[dayIndex]);
    const offset = stations.length ? dayIndex % stations.length : 0;
    const todayStations = [...stations.slice(offset), ...stations.slice(0, offset)];

    for (const station of todayStations) {
      const ideal = shiftTimeForStation(station, hours);
      const pick = choosePersonAndTime({ people, station, dateISO, ideal, hours, shifts, workDays, shiftCount, weeklyHours });

      if (!pick) {
        gaps.push(`${dateISO} ${station}`);
        continue;
      }

      const chosen = pick.person;
      const time = pick.time;
      if (time.adjusted) adjustedCount++;

      await addDoc(collection(db, "stores", storeId, "Shifts"), {
        date: dateISO,
        start: time.start,
        end: time.end,
        userId: chosen.id,
        userName: chosen.name,
        role: chosen.role || "crew",
        station,
        isShiftManager: false,
        autoRota: true,
        createdByAI: true,
        generatedByAI: true,
        smartGenerated: true,
        adjustedToAvailability: !!time.adjusted,
        source: "mcassist-generate-shifts-v4-fit-availability",
        createdBy: user.id || auth.currentUser?.uid || "mcassist",
        createdAt: Date.now()
      });

      shifts.push({ date: dateISO, start: time.start, end: time.end, userId: chosen.id, userName: chosen.name, station });
      workDays[chosen.id].add(dateISO);
      shiftCount[chosen.id] = (shiftCount[chosen.id] || 0) + 1;
      weeklyHours[chosen.id] = (weeklyHours[chosen.id] || 0) + hoursBetween(time.start, time.end);
      coverage[station] = (coverage[station] || 0) + 1;
      created++;
    }
  }

  const crewBalance = people.map((p) => `${p.name}: ${shiftCount[p.id] || 0} shift(s), ${(weeklyHours[p.id] || 0).toFixed(1)}h, ${7 - (workDays[p.id]?.size || 0)} day(s) off`).join("\n");
  const stationSummary = stations.map((s) => `${s}: ${coverage[s] || 0}`).join(", ");

  let reply = `Smart shifts generated ✅\n\nRange: ${rangeLabel(text, dates)}\nDates: ${toISO(dates[0])}${dates.length > 1 ? ` to ${toISO(dates[dates.length - 1])}` : ""}\nHours window: ${hours.start}–${hours.end}\nOld shifts removed: ${oldShifts.length}\nNew shifts created: ${created}\nShifts fitted to availability: ${adjustedCount}\nStations attempted: ${stations.join(", ")}\n\nRules used:\n• fits shift times inside saved availability\n• at least 2 days off per person\n• max 1 shift per person per day\n• respects max weekly hours\n• 1 station per shift\n• chooses people who know the station first\n\nStation coverage count:\n${stationSummary}\n\nCrew balance:\n${crewBalance}`;

  if (requested > maxPossible) reply += `\n\nHeads up: full coverage is impossible with these rules. Needed ${requested} station shifts, but max possible is ${maxPossible} with ${people.length} crew.`;
  if (gaps.length) reply += `\n\nCoverage gaps: ${gaps.length}\nCould not cover: ${gaps.slice(0, 12).join(" | ")}${gaps.length > 12 ? " | …" : ""}`;
  return reply;
}

async function createSimpleRota(text, user) {
  return generateSmartShifts(text, user);
}

function wantsSmartGenerate(text) {
  const t = norm(text);
  return t === "generate shifts" || t.startsWith("generate shifts ") || t.includes("smart generate shifts") || t.includes("generate smart shifts");
}

function wantsRemove(text) {
  const t = norm(text);
  return /\b(delete|remove|clear)\b/.test(t) && (t.includes("shift") || t.includes("shifts") || t.includes("rota") || t.includes("schedule"));
}

function wantsGeneratedOnlyRemove(text) {
  const t = norm(text);
  return wantsRemove(text) && (t.includes("generated") || t.includes("auto rota") || t.includes("ai shifts"));
}

function wantsTeamRota(text) {
  const t = norm(text);
  if (wantsSmartGenerate(text)) return false;
  const action = /\b(create|make|build|plan|auto|replace|redo|regenerate|rebuild|add|fill)\b/.test(t);
  const rota = t.includes("rota") || t.includes("schedule") || t.includes("shifts") || t.includes("shift");
  const team = t.includes("team") || t.includes("everyone") || t.includes("crew") || t.includes("staff") || t.includes("this week") || t.includes("next week") || t.includes("today");
  return rota && team && action;
}

function wantsHelp(text) {
  const t = norm(text);
  return (t.includes("help") || t.includes("commands") || t.includes("what can you do")) && (t.includes("shift") || t.includes("rota") || t.includes("manager"));
}

function helpReply() {
  return `Rota commands I can run ✅\n\n• generate shifts\n• generate shifts next week 6am-11pm\n• generate shifts this week 6am-11pm core stations\n• generate shifts this week 6am-11pm every station\n• replace team rota for this week 6am-11pm\n• add extra shifts today 12pm-8pm\n• remove all shifts for this week\n• remove today’s shifts\n\n“generate shifts” is the smart one: availability, stations, 2 days off, max 1 shift/day, and it now fits shift times into availability.`;
}

document.addEventListener("submit", async (event) => {
  const form = event.target.closest("#aiForm");
  if (!form) return;
  const input = $("aiInput");
  const send = $("aiSendBtn");
  const text = input?.value?.trim() || "";
  if (!text) return;
  const isCommand = wantsHelp(text) || wantsRemove(text) || wantsSmartGenerate(text) || wantsTeamRota(text);
  if (!isCommand) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  addMsg(text, "user");
  input.value = "";
  if (send) send.disabled = true;
  try {
    const user = getUser();
    let reply = "";
    if (wantsHelp(text)) reply = helpReply();
    else if (wantsRemove(text)) reply = await removeShifts(text, user, wantsGeneratedOnlyRemove(text));
    else if (wantsSmartGenerate(text)) reply = await generateSmartShifts(text, user);
    else reply = await createSimpleRota(text, user);
    addMsg(reply, "bot");
  } catch (err) {
    console.error("Rota command error:", err);
    addMsg("I tried to update the rota, but something went wrong. Check Firebase permissions, then try again.", "bot");
  }
  if (send) send.disabled = false;
}, true);
