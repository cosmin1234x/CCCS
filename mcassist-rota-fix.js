import { auth, db } from "./firebase-init.js";
import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

const ROTA_STATIONS = [
  "Grill",
  "Fries",
  "Front Counter",
  "Drive Thru",
  "Kitchen",
  "Lobby",
  "Drinks",
  "Runner",
  "Cleaning",
  "Stock"
];

const CORE_STATIONS = [
  "Grill",
  "Fries",
  "Front Counter",
  "Drive Thru",
  "Kitchen"
];

function norm(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/[^a-z0-9:\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function safeText(v) {
  return String(v || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\n", "<br>");
}

function addMsg(text, from = "bot") {
  const chat = $("aiChat");
  if (!chat) return;

  const msg = document.createElement("div");
  msg.className = `message ${from === "user" ? "msg-user" : "msg-bot"}`;
  msg.innerHTML = `
    <div class="bubble">${safeText(text)}</div>
    <div class="msg-meta">${from === "user" ? "You" : "McAssist"}</div>
  `;

  chat.appendChild(msg);
  chat.scrollTop = chat.scrollHeight;
}

function getUser() {
  try {
    const cached = JSON.parse(localStorage.getItem("mc_session_user") || "null");
    if (cached) return cached;
  } catch {}

  return {
    id: auth.currentUser?.uid || "",
    name: auth.currentUser?.displayName || auth.currentUser?.email || "User",
    role: "crew",
    storeId: "store001"
  };
}

function canManage(user) {
  const role = String(user?.role || "").toLowerCase().replace(/\s+/g, "");
  return role === "manager" || role === "shiftcreator" || role === "admin";
}

function toISO(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function toMinutes(hhmm) {
  const [h, m] = String(hhmm || "00:00").split(":").map((n) => Number(n) || 0);
  return h * 60 + m;
}

function toHHMM(mins) {
  mins = ((Math.round(mins) % 1440) + 1440) % 1440;
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

function hoursBetween(start, end) {
  let s = toMinutes(start);
  let e = toMinutes(end);
  if (e <= s) e += 1440;
  return (e - s) / 60;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  let aS = toMinutes(aStart);
  let aE = toMinutes(aEnd);
  let bS = toMinutes(bStart);
  let bE = toMinutes(bEnd);

  if (aE <= aS) aE += 1440;
  if (bE <= bS) bE += 1440;

  return aS < bE && bS < aE;
}

function parseTime(value) {
  if (!value) return null;

  let raw = String(value).toLowerCase().trim().replace(/\./g, ":");
  const ampm = raw.match(/(am|pm)$/)?.[1] || "";
  raw = raw.replace(/(am|pm)$/g, "").trim();

  let h = 0;
  let m = 0;

  if (raw.includes(":")) {
    const parts = raw.split(":");
    h = Number(parts[0]);
    m = Number(parts[1] || 0);
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
  const match = String(text || "").toLowerCase().match(
    /(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:-|–|to|until|till)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i
  );

  if (!match) return { start: "06:00", end: "23:00" };

  let left = match[1].trim();
  const right = match[2].trim();

  if (!/[ap]m/i.test(left) && /pm/i.test(right)) {
    left += "am";
  }

  let start = parseTime(left);
  let end = parseTime(right);

  if (!start || !end) return { start: "06:00", end: "23:00" };

  if (!/[ap]m/i.test(match[1]) && !/[ap]m/i.test(match[2])) {
    const sh = Number(start.split(":")[0]);
    const eh = Number(end.split(":")[0]);
    if (sh >= 4 && sh <= 11 && eh >= 8 && eh <= 11) {
      end = `${String(eh + 12).padStart(2, "0")}:00`;
    }
  }

  return { start, end };
}

function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getDatesFromText(text) {
  const t = norm(text);

  if (t.includes("today")) return [new Date()];

  if (t.includes("tomorrow")) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return [d];
  }

  const start = getMonday(new Date());
  if (t.includes("next week")) start.setDate(start.getDate() + 7);
  if (t.includes("last week")) start.setDate(start.getDate() - 7);

  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

function rangeName(text, dates) {
  const t = norm(text);
  if (t.includes("today")) return "today";
  if (t.includes("tomorrow")) return "tomorrow";
  if (t.includes("next week")) return "next week";
  if (t.includes("last week")) return "last week";
  return dates.length === 1 ? toISO(dates[0]) : "this week";
}

function parsePeopleCount(text, peopleLength) {
  const t = norm(text);
  const match = t.match(/(?:with|use|need|for|staff)\s*(\d{1,2})\s*(?:people|person|crew|staff|workers|members)?/i);

  if (match) {
    return Math.max(1, Math.min(peopleLength, Number(match[1]) || 1));
  }

  return Math.min(peopleLength, 5);
}

function shouldReplace(text) {
  const t = norm(text);
  if (/\b(add|extra|additional|more)\b/.test(t)) return false;
  return true;
}

function buildTemplates(open, close, peoplePerDay) {
  let openM = toMinutes(open);
  let closeM = toMinutes(close);
  if (closeM <= openM) closeM += 1440;

  const window = closeM - openM;
  const count = Math.max(1, peoplePerDay);
  const shiftLength = Math.min(8 * 60, Math.max(4 * 60, Math.ceil(window / Math.min(2, count))));
  const latestStart = Math.max(openM, closeM - shiftLength);
  const step = count === 1 ? 0 : (latestStart - openM) / (count - 1);

  const templates = [];

  for (let i = 0; i < count; i++) {
    const start = Math.round((openM + step * i) / 15) * 15;
    const end = Math.min(start + shiftLength, closeM);

    templates.push({
      start: toHHMM(start),
      end: toHHMM(end)
    });
  }

  return templates;
}

function canonicalStation(station) {
  const s = norm(station).replace(/drive thru/g, "drive").replace(/front counter/g, "front");

  if (s.includes("grill")) return "Grill";
  if (s.includes("fries") || s.includes("chips")) return "Fries";
  if (s.includes("front") || s.includes("counter") || s.includes("till")) return "Front Counter";
  if (s.includes("drive")) return "Drive Thru";
  if (s.includes("kitchen") || s.includes("line") || s.includes("chicken")) return "Kitchen";
  if (s.includes("lobby") || s.includes("dining")) return "Lobby";
  if (s.includes("drink") || s.includes("beverage")) return "Drinks";
  if (s.includes("runner") || s.includes("present")) return "Runner";
  if (s.includes("clean")) return "Cleaning";
  if (s.includes("stock")) return "Stock";

  return "";
}

function getPersonStations(person) {
  const raw = [];
  const skillsObj = person.skills || person.stationSkills || person.certifiedStations || {};

  [
    person.stations,
    person.certifications,
    person.availableStations,
    person.stationSkills,
    person.trainedStations
  ].forEach((value) => {
    if (Array.isArray(value)) raw.push(...value);
  });

  if (skillsObj && typeof skillsObj === "object" && !Array.isArray(skillsObj)) {
    Object.entries(skillsObj).forEach(([key, value]) => {
      if (value === true || value === "yes" || value === "trained" || Number(value) > 0) raw.push(key);
    });
  }

  const cleaned = [...new Set(raw.map(canonicalStation).filter(Boolean))];

  // If no stations are set in Firestore, assume they can work core stations so the rota can still generate.
  return cleaned.length ? cleaned : CORE_STATIONS;
}

function knowsStation(person, station) {
  const known = getPersonStations(person).map(canonicalStation);
  const target = canonicalStation(station);
  return known.includes(target);
}

function getAvailabilityValue(person, dateISO) {
  const d = new Date(`${dateISO}T12:00:00`);
  const long = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][d.getDay()];
  const short = long.slice(0, 3);

  const sources = [
    person.availability,
    person.available,
    person.availableTimes,
    person.availabilityByDay
  ].filter(Boolean);

  for (const source of sources) {
    if (typeof source === "boolean") return source;
    if (source[dateISO] !== undefined) return source[dateISO];
    if (source[long] !== undefined) return source[long];
    if (source[short] !== undefined) return source[short];
  }

  if (Array.isArray(person.availableDays) && person.availableDays.length) {
    const days = person.availableDays.map(norm);
    if (!days.includes(long) && !days.includes(short) && !days.includes(dateISO)) {
      return false;
    }
  }

  return true;
}

function rangeCovers(range, start, end) {
  if (range === true || range === "all" || range === "any") return true;
  if (range === false || range === "off" || range === "no") return false;

  const ranges = Array.isArray(range) ? range : [range];

  return ranges.some((r) => {
    if (typeof r === "string") {
      const match = r.match(
        /(\d{1,2}:?\d{0,2}\s*(?:am|pm)?)\s*(?:-|to)\s*(\d{1,2}:?\d{0,2}\s*(?:am|pm)?)/i
      );

      if (!match) return false;

      r = {
        start: parseTime(match[1]),
        end: parseTime(match[2])
      };
    }

    const rs = r?.start || r?.from || r?.open;
    const re = r?.end || r?.to || r?.close;

    if (!rs || !re) return false;

    let a = toMinutes(rs);
    let b = toMinutes(re);
    let s = toMinutes(start);
    let e = toMinutes(end);

    if (b <= a) b += 1440;
    if (e <= s) e += 1440;

    return a <= s && e <= b;
  });
}

function isAvailable(person, dateISO, start, end) {
  if (person.active === false || person.disabled === true) return false;
  if (Array.isArray(person.unavailableDates) && person.unavailableDates.includes(dateISO)) return false;
  return rangeCovers(getAvailabilityValue(person, dateISO), start, end);
}

async function getCrew(storeId, currentUser) {
  const snap = await getDocs(query(collection(db, "users"), where("storeId", "==", storeId)));
  const all = [];

  snap.forEach((item) => {
    const data = item.data() || {};
    const role = String(data.role || "crew").toLowerCase().replace(/\s+/g, "");

    all.push({
      id: item.id,
      name: data.name || data.email || "Crew",
      role: data.role || "crew",
      roleKey: role,
      ...data
    });
  });

  let crew = all.filter((p) => !/manager|admin|shiftcreator/.test(p.roleKey));

  if (!crew.length) {
    crew = all.filter((p) => !/manager|admin/.test(p.roleKey));
  }

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

async function deleteShifts(text, user, onlyGenerated = false) {
  if (!canManage(user)) return "Only a manager or shift creator can delete shifts.";

  const storeId = user.storeId || "store001";
  const dates = getDatesFromText(text);
  const label = rangeName(text, dates);
  const shifts = await getShifts(storeId, dates);

  const targets = onlyGenerated
    ? shifts.filter((s) => s.autoRota === true || s.createdByAI === true || s.generatedByAI === true)
    : shifts;

  for (const shift of targets) {
    await deleteDoc(doc(db, "stores", storeId, "Shifts", shift.id));
  }

  return `Deleted ${targets.length} ${onlyGenerated ? "AI-generated " : ""}shift(s) for ${label} ✅`;
}

async function createTeamRota(text, user) {
  if (!canManage(user)) return "Only a manager or shift creator can create the team rota.";

  const storeId = user.storeId || "store001";
  const dates = getDatesFromText(text);
  const label = rangeName(text, dates);
  const hours = parseTimeRange(text);
  const people = await getCrew(storeId, user);

  if (people.length < 2) {
    return people.length === 1
      ? "I only found 1 crew member, so I can’t make a team rota yet. Add more crew users first."
      : "I couldn’t find any crew users for this store.";
  }

  let deleted = 0;
  const replace = shouldReplace(text);

  if (replace) {
    const before = await getShifts(storeId, dates);
    for (const shift of before) {
      await deleteDoc(doc(db, "stores", storeId, "Shifts", shift.id));
      deleted++;
    }
  }

  const peoplePerDay = parsePeopleCount(text, people.length);
  const templates = buildTemplates(hours.start, hours.end, peoplePerDay);
  const assignedCount = Object.fromEntries(people.map((p) => [p.id, 0]));

  let created = 0;
  const used = new Set();

  for (let dayIndex = 0; dayIndex < dates.length; dayIndex++) {
    const dateISO = toISO(dates[dayIndex]);
    const dailyUsed = new Set();

    for (let slotIndex = 0; slotIndex < templates.length; slotIndex++) {
      const sorted = [...people].sort((a, b) => {
        const aUsedToday = dailyUsed.has(a.id) ? 1 : 0;
        const bUsedToday = dailyUsed.has(b.id) ? 1 : 0;
        if (aUsedToday !== bUsedToday) return aUsedToday - bUsedToday;
        if ((assignedCount[a.id] || 0) !== (assignedCount[b.id] || 0)) return (assignedCount[a.id] || 0) - (assignedCount[b.id] || 0);
        return a.name.localeCompare(b.name);
      });

      const chosen = sorted.find((p) => !dailyUsed.has(p.id)) || sorted[0];
      const template = templates[slotIndex];
      const station = ROTA_STATIONS[slotIndex % ROTA_STATIONS.length];

      await addDoc(collection(db, "stores", storeId, "Shifts"), {
        date: dateISO,
        start: template.start,
        end: template.end,
        userId: chosen.id,
        userName: chosen.name,
        role: chosen.role || "crew",
        station,
        isShiftManager: false,
        autoRota: true,
        createdByAI: true,
        generatedByAI: true,
        source: "mcassist-rota-fix-v2",
        createdBy: user.id || auth.currentUser?.uid || "mcassist",
        createdAt: Date.now()
      });

      dailyUsed.add(chosen.id);
      used.add(chosen.id);
      assignedCount[chosen.id] = (assignedCount[chosen.id] || 0) + 1;
      created++;
    }
  }

  const namesUsed = people.filter((p) => used.has(p.id)).map((p) => p.name).slice(0, 8).join(", ");

  return `${replace ? "Team rota replaced" : "Team rota added"} ✅

Range: ${label}
Dates: ${toISO(dates[0])}${dates.length > 1 ? ` to ${toISO(dates[dates.length - 1])}` : ""}
Hours: ${hours.start}–${hours.end}
Daily shift slots: ${templates.map((t) => `${t.start}-${t.end}`).join(", ")}

Old shifts deleted: ${deleted}
New shifts created: ${created}
Crew used: ${used.size}/${people.length}${namesUsed ? ` (${namesUsed}${used.size > 8 ? ", …" : ""})` : ""}

Useful commands:
• generate shifts
• delete all shifts for this week
• replace team rota for next week 6am-11pm with 5 people`;
}

function getTargetStations(text, people) {
  const t = norm(text);

  if (t.includes("all station") || t.includes("every station")) return ROTA_STATIONS;
  if (t.includes("core station") || t.includes("main station")) return CORE_STATIONS;

  const learnedStations = new Set();
  people.forEach((p) => getPersonStations(p).forEach((s) => learnedStations.add(canonicalStation(s))));

  const stations = ROTA_STATIONS.filter((s) => learnedStations.has(canonicalStation(s)));
  return stations.length ? stations : CORE_STATIONS;
}

function shiftForStation(station, hours) {
  // Simple realistic station timings. Everything stays one station per person.
  const open = toMinutes(hours.start);
  let close = toMinutes(hours.end);
  if (close <= open) close += 1440;
  const window = close - open;

  const clamp = (startOffset, length) => {
    const start = Math.min(open + startOffset, Math.max(open, close - length));
    const end = Math.min(start + length, close);
    return { start: toHHMM(start), end: toHHMM(end) };
  };

  const key = canonicalStation(station);

  if (key === "Grill" || key === "Kitchen") return clamp(0, Math.min(8 * 60, window));
  if (key === "Fries" || key === "Front Counter") return clamp(Math.floor(window * 0.25), Math.min(8 * 60, window));
  if (key === "Drive Thru" || key === "Runner" || key === "Drinks") return clamp(Math.floor(window * 0.35), Math.min(8 * 60, window));
  if (key === "Lobby" || key === "Cleaning" || key === "Stock") return clamp(Math.floor(window * 0.5), Math.min(6 * 60, window));

  return clamp(0, Math.min(8 * 60, window));
}

function canStillWorkThisWeek(workDays, personId) {
  // At least 2 days off every 7-day week = max 5 work days.
  return (workDays[personId]?.size || 0) < 5;
}

function personHasShiftOnDay(shifts, personId, dateISO) {
  return shifts.some((s) => s.userId === personId && s.date === dateISO);
}

function personHasOverlap(shifts, personId, dateISO, start, end) {
  return shifts.some((s) => s.userId === personId && s.date === dateISO && overlaps(s.start, s.end, start, end));
}

function chooseBestPersonForStation({ people, station, dateISO, start, end, shifts, workDays, shiftCount }) {
  const target = canonicalStation(station);

  const strict = people.filter((p) => {
    if (!knowsStation(p, target)) return false;
    if (!isAvailable(p, dateISO, start, end)) return false;
    if (!canStillWorkThisWeek(workDays, p.id)) return false;
    if (personHasShiftOnDay(shifts, p.id, dateISO)) return false;
    if (personHasOverlap(shifts, p.id, dateISO, start, end)) return false;
    return true;
  });

  // If nobody has that exact station saved, relax station knowledge but keep safety rules.
  const relaxedStation = people.filter((p) => {
    if (!isAvailable(p, dateISO, start, end)) return false;
    if (!canStillWorkThisWeek(workDays, p.id)) return false;
    if (personHasShiftOnDay(shifts, p.id, dateISO)) return false;
    if (personHasOverlap(shifts, p.id, dateISO, start, end)) return false;
    return true;
  });

  const candidates = strict.length ? strict : relaxedStation;

  return candidates.sort((a, b) => {
    const aSkill = knowsStation(a, target) ? 0 : 1;
    const bSkill = knowsStation(b, target) ? 0 : 1;
    if (aSkill !== bSkill) return aSkill - bSkill;

    const aDays = workDays[a.id]?.size || 0;
    const bDays = workDays[b.id]?.size || 0;
    if (aDays !== bDays) return aDays - bDays;

    if ((shiftCount[a.id] || 0) !== (shiftCount[b.id] || 0)) return (shiftCount[a.id] || 0) - (shiftCount[b.id] || 0);

    return a.name.localeCompare(b.name);
  })[0] || null;
}

async function generateSmartShifts(text, user) {
  if (!canManage(user)) return "Only a manager or shift creator can generate smart shifts.";

  const storeId = user.storeId || "store001";
  const dates = getDatesFromText(text);
  const label = rangeName(text, dates);
  const hours = parseTimeRange(text);
  const people = await getCrew(storeId, user);

  if (people.length < 2) {
    return people.length === 1
      ? "I only found 1 crew member. Smart shift generation needs at least 2 crew users."
      : "I couldn’t find any crew users for this store.";
  }

  // Smart generate replaces the week by default so it can obey the rules cleanly.
  const oldShifts = await getShifts(storeId, dates);
  for (const shift of oldShifts) {
    await deleteDoc(doc(db, "stores", storeId, "Shifts", shift.id));
  }

  const targetStations = getTargetStations(text, people);
  const shifts = [];
  const workDays = Object.fromEntries(people.map((p) => [p.id, new Set()]));
  const shiftCount = Object.fromEntries(people.map((p) => [p.id, 0]));
  const stationCovered = Object.fromEntries(targetStations.map((s) => [s, 0]));
  const gaps = [];
  let created = 0;

  // Rotate station order daily so one station doesn't always get first pick.
  for (let dayIndex = 0; dayIndex < dates.length; dayIndex++) {
    const dateISO = toISO(dates[dayIndex]);
    const rotatedStations = [...targetStations.slice(dayIndex % targetStations.length), ...targetStations.slice(0, dayIndex % targetStations.length)];

    for (const station of rotatedStations) {
      const time = shiftForStation(station, hours);
      const chosen = chooseBestPersonForStation({
        people,
        station,
        dateISO,
        start: time.start,
        end: time.end,
        shifts,
        workDays,
        shiftCount
      });

      if (!chosen) {
        gaps.push(`${dateISO} ${station}`);
        continue;
      }

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
        source: "mcassist-generate-shifts-v1",
        ruleMaxOneShiftPerDay: true,
        ruleTwoDaysOff: true,
        ruleOneStationPerShift: true,
        createdBy: user.id || auth.currentUser?.uid || "mcassist",
        createdAt: Date.now()
      });

      shifts.push({
        date: dateISO,
        start: time.start,
        end: time.end,
        userId: chosen.id,
        userName: chosen.name,
        station
      });

      workDays[chosen.id].add(dateISO);
      shiftCount[chosen.id] = (shiftCount[chosen.id] || 0) + 1;
      stationCovered[station] = (stationCovered[station] || 0) + 1;
      created++;
    }
  }

  const peopleSummary = people
    .map((p) => `${p.name}: ${shiftCount[p.id] || 0} shift(s), ${7 - (workDays[p.id]?.size || 0)} day(s) off`)
    .join("\n");

  const stationSummary = targetStations
    .map((s) => `${s}: ${stationCovered[s] || 0}`)
    .join(", ");

  let reply = `Smart shifts generated ✅

Range: ${label}
Dates: ${toISO(dates[0])}${dates.length > 1 ? ` to ${toISO(dates[dates.length - 1])}` : ""}
Hours window: ${hours.start}–${hours.end}
Old shifts deleted: ${oldShifts.length}
New shifts created: ${created}
Stations attempted: ${targetStations.join(", ")}

Rules used:
• at least 2 days off per person where possible
• max 1 shift per person per day
• 1 station per shift
• chooses people who know the station first
• uses availability if saved in crew profile

Station coverage count:
${stationSummary}

Crew balance:
${peopleSummary}`;

  if (gaps.length) {
    reply += `

Coverage gaps: ${gaps.length}
Could not cover: ${gaps.slice(0, 12).join(" | ")}${gaps.length > 12 ? " | …" : ""}

Reason: not enough available/trained crew while keeping 2 days off and 1 shift per day.`;
  }

  reply += `

Tip: say “generate shifts next week 6am-11pm core stations” for a smaller station list.`;

  return reply;
}

function wantsDelete(text) {
  const t = norm(text);
  return /\b(delete|remove|clear|wipe)\b/.test(t) && (t.includes("shift") || t.includes("shifts") || t.includes("rota") || t.includes("schedule"));
}

function wantsGeneratedOnlyDelete(text) {
  const t = norm(text);
  return wantsDelete(text) && (t.includes("generated") || t.includes("auto rota") || t.includes("ai shifts"));
}

function wantsSmartGenerate(text) {
  const t = norm(text);
  return (
    (t === "generate shifts" || t.startsWith("generate shifts ") || t.includes("smart generate shifts") || t.includes("generate smart shifts")) ||
    (/\bgenerate\b/.test(t) && /\b(shifts|rota|schedule)\b/.test(t) && (t.includes("2 days off") || t.includes("available") || t.includes("station")))
  );
}

function wantsTeamRota(text) {
  const t = norm(text);
  if (wantsSmartGenerate(text)) return false;

  const action = /\b(create|make|generate|build|plan|auto|replace|redo|regenerate|rebuild|add|fill)\b/.test(t);
  const rota = t.includes("rota") || t.includes("schedule") || t.includes("shifts") || t.includes("shift");
  const team = t.includes("team") || t.includes("everyone") || t.includes("crew") || t.includes("staff") || t.includes("this week") || t.includes("next week") || t.includes("today");
  const hasTime = /\d{1,2}\s*(?::\d{2})?\s*(?:am|pm)?\s*(?:-|to|until|till)\s*\d{1,2}/i.test(t);

  return rota && team && (action || hasTime);
}

function wantsHelp(text) {
  const t = norm(text);
  return (t.includes("help") || t.includes("commands") || t.includes("what can you do")) && (t.includes("shift") || t.includes("rota") || t.includes("manager"));
}

function helpReply() {
  return `Rota commands I can run ✅

• generate shifts
• generate shifts next week 6am-11pm
• generate shifts this week 6am-11pm core stations
• generate shifts this week 6am-11pm every station
• replace team rota for this week 6am-11pm
• replace team rota for next week 6am-11pm with 5 people
• add extra shifts today 12pm-8pm
• delete all shifts for this week
• delete all shifts for next week
• delete today’s shifts
• delete generated shifts for this week

“generate shifts” is the smart one: availability, stations, 2 days off, max 1 shift/day.`;
}

document.addEventListener(
  "submit",
  async (event) => {
    const form = event.target.closest("#aiForm");
    if (!form) return;

    const input = $("aiInput");
    const send = $("aiSendBtn");
    const text = input?.value?.trim() || "";

    if (!text) return;

    const isCommand = wantsHelp(text) || wantsDelete(text) || wantsSmartGenerate(text) || wantsTeamRota(text);
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

      if (wantsHelp(text)) {
        reply = helpReply();
      } else if (wantsDelete(text)) {
        reply = await deleteShifts(text, user, wantsGeneratedOnlyDelete(text));
      } else if (wantsSmartGenerate(text)) {
        reply = await generateSmartShifts(text, user);
      } else {
        reply = await createTeamRota(text, user);
      }

      addMsg(reply, "bot");
    } catch (error) {
      console.error("Rota command error:", error);
      addMsg("I tried to update the rota, but something went wrong. Check Firebase permissions, then try again.", "bot");
    }

    if (send) send.disabled = false;
  },
  true
);
