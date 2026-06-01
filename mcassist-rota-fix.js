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

const STATIONS = [
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
    return JSON.parse(localStorage.getItem("mc_session_user") || "null") || {
      id: auth.currentUser?.uid,
      role: "crew",
      storeId: "store001"
    };
  } catch {
    return {
      id: auth.currentUser?.uid,
      role: "crew",
      storeId: "store001"
    };
  }
}

function canManage(user) {
  const role = String(user?.role || "").toLowerCase();
  return role === "manager" || role === "shiftcreator" || role === "shift creator";
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

function stationKey(station) {
  return norm(station)
    .replace(/drive thru/g, "drive")
    .replace(/front counter/g, "counter");
}

function parseTime(value) {
  if (!value) return null;

  let v = String(value).toLowerCase().trim().replace(/\./g, ":");
  const ampm = v.match(/(am|pm)$/)?.[1] || "";

  v = v.replace(/(am|pm)$/g, "").trim();

  let h = 0;
  let m = 0;

  if (v.includes(":")) {
    const parts = v.split(":");
    h = Number(parts[0]);
    m = Number(parts[1] || 0);
  } else {
    h = Number(v);
  }

  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;

  if (ampm === "pm" && h < 12) h += 12;
  if (ampm === "am" && h === 12) h = 0;

  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function parseTimeRange(text) {
  const match = norm(text).match(
    /(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:-|to|until|till)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i
  );

  if (!match) return null;

  let start = parseTime(match[1]);
  let end = parseTime(match[2]);

  if (!start || !end) return null;

  if (!/[ap]m/i.test(match[1]) && !/[ap]m/i.test(match[2])) {
    const sHour = Number(start.split(":")[0]);
    const eHour = Number(end.split(":")[0]);

    if (sHour >= 6 && sHour <= 11 && eHour >= 1 && eHour <= 8) {
      end = `${String(eHour + 12).padStart(2, "0")}:00`;
    }
  }

  return { start, end };
}

function parseStoreHours(text) {
  const t = norm(text);

  if (t.includes("24h") || t.includes("24 hour")) {
    return { start: "00:00", end: "23:59" };
  }

  return parseTimeRange(text) || { start: "06:00", end: "23:00" };
}

function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;

  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);

  return d;
}

function getWeekDates(text) {
  const t = norm(text);
  const start = getMonday(new Date());

  if (t.includes("next week")) start.setDate(start.getDate() + 7);
  if (t.includes("last week")) start.setDate(start.getDate() - 7);

  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

function buildDayShiftTemplates(open, close) {
  let openM = toMinutes(open);
  let closeM = toMinutes(close);

  if (closeM <= openM) closeM += 1440;

  const templates = [];

  const add = (name, start, end) => {
    if (end - start >= 4 * 60) {
      templates.push({
        name,
        start: toHHMM(start),
        end: toHHMM(end)
      });
    }
  };

  add("early", openM, Math.min(openM + 8 * 60, closeM));

  const midStart = Math.min(openM + 4 * 60, closeM - 4 * 60);
  add("mid", midStart, Math.min(midStart + 8 * 60, closeM));

  add("late", Math.max(closeM - 8 * 60, openM), closeM);

  const seen = new Set();

  return templates.filter((template) => {
    const key = `${template.start}-${template.end}`;

    if (seen.has(key)) return false;

    seen.add(key);
    return true;
  });
}

function getWeekOffDayMap(people, dates) {
  const map = {};

  people.forEach((person, index) => {
    map[person.id] = toISO(dates[index % 7]);
  });

  return map;
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

  if (Array.isArray(person.unavailableDates) && person.unavailableDates.includes(dateISO)) {
    return false;
  }

  return rangeCovers(getAvailabilityValue(person, dateISO), start, end);
}

function getPersonStations(person) {
  const raw = [];

  [
    person.stations,
    person.certifications,
    person.availableStations,
    person.stationSkills
  ].forEach((value) => {
    if (Array.isArray(value)) raw.push(...value);
  });

  const cleaned = raw
    .map((item) => String(item).replace(/-/g, " ").trim())
    .filter(Boolean);

  return cleaned.length ? cleaned : STATIONS;
}

function hasStationClash(shifts, dateISO, start, end, station) {
  return shifts.some((shift) => {
    return (
      shift.date === dateISO &&
      stationKey(shift.station) === stationKey(station) &&
      overlaps(shift.start, shift.end, start, end)
    );
  });
}

function hasShiftSameDay(shifts, personId, dateISO) {
  return shifts.some((shift) => shift.userId === personId && shift.date === dateISO);
}

function chooseStation(person, shifts, dateISO, start, end) {
  const options = [...getPersonStations(person), ...STATIONS];

  for (const station of options) {
    if (!hasStationClash(shifts, dateISO, start, end, station)) {
      return station.replace(/\b\w/g, (c) => c.toUpperCase());
    }
  }

  return null;
}

async function getCrew(storeId) {
  const snap = await getDocs(
    query(collection(db, "users"), where("storeId", "==", storeId))
  );

  const people = [];

  snap.forEach((item) => {
    const data = item.data() || {};
    const role = String(data.role || "crew").toLowerCase();

    if (/admin|manager/.test(role) && !/shiftcreator/.test(role)) return;

    people.push({
      id: item.id,
      name: data.name || data.email || "Crew",
      role: data.role || "crew",
      ...data,
      maxWeeklyHours:
        Number(data.maxHours || data.contractHours || data.preferredHours || data.hoursPerWeek || 30) || 30
    });
  });

  return people.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

async function getWeekShifts(storeId, dates) {
  const wanted = new Set(dates.map(toISO));
  const snap = await getDocs(collection(db, "stores", storeId, "Shifts"));
  const shifts = [];

  snap.forEach((item) => {
    const data = item.data() || {};

    if (wanted.has(data.date)) {
      shifts.push({
        id: item.id,
        ...data
      });
    }
  });

  return shifts;
}

async function deleteGeneratedRota(text, user) {
  if (!canManage(user)) {
    return "Only a manager or shift creator can delete generated rotas.";
  }

  const storeId = user.storeId || "store001";
  const dates = getWeekDates(text);
  const shifts = await getWeekShifts(storeId, dates);

  const generated = shifts.filter((shift) => {
    return shift.autoRota === true || shift.createdByAI === true || shift.generatedByAI === true;
  });

  for (const shift of generated) {
    await deleteDoc(doc(db, "stores", storeId, "Shifts", shift.id));
  }

  return `Deleted ${generated.length} AI-generated shifts for that week ✅`;
}

async function createTeamRota(text, user) {
  if (!canManage(user)) {
    return "Only a manager or shift creator can create the team rota.";
  }

  const storeId = user.storeId || "store001";
  const dates = getWeekDates(text);
  const hours = parseStoreHours(text);

  if (/\b(replace|redo|regenerate|rebuild)\b/i.test(text)) {
    await deleteGeneratedRota(text, user);
  }

  const people = await getCrew(storeId);

  if (!people.length) {
    return "I couldn’t find any crew for this store.";
  }

  const shifts = await getWeekShifts(storeId, dates);

  const assignedHours = Object.fromEntries(people.map((person) => [person.id, 0]));

  shifts.forEach((shift) => {
    if (assignedHours[shift.userId] !== undefined) {
      assignedHours[shift.userId] += hoursBetween(shift.start, shift.end);
    }
  });

  const offDays = getWeekOffDayMap(people, dates);

  let created = 0;
  let gaps = 0;
  const notes = [];

  for (const day of dates) {
    const dateISO = toISO(day);
    const dailyUsed = new Set();
    const templates = buildDayShiftTemplates(hours.start, hours.end);

    for (const template of templates) {
      const available = people
        .filter((person) => offDays[person.id] !== dateISO)
        .filter((person) => isAvailable(person, dateISO, template.start, template.end))
        .filter((person) => !hasShiftSameDay(shifts, person.id, dateISO))
        .filter((person) => !dailyUsed.has(person.id))
        .filter((person) => {
          const hours = assignedHours[person.id] || 0;
          const underMax = hours < person.maxWeeklyHours;
          const everyoneOver = people.every((p) => (assignedHours[p.id] || 0) >= p.maxWeeklyHours);
          return underMax || everyoneOver;
        })
        .sort((a, b) => {
          return (assignedHours[a.id] || 0) - (assignedHours[b.id] || 0);
        });

      if (!available.length) {
        gaps++;
        continue;
      }

      let chosen = null;
      let station = null;

      for (const person of available) {
        const freeStation = chooseStation(person, shifts, dateISO, template.start, template.end);

        if (freeStation) {
          chosen = person;
          station = freeStation;
          break;
        }
      }

      if (!chosen || !station) {
        gaps++;
        notes.push(`No free station on ${dateISO} ${template.start}-${template.end}`);
        continue;
      }

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
        createdBy: user.id || auth.currentUser?.uid || "mcassist",
        createdAt: Date.now()
      });

      shifts.push({
        date: dateISO,
        start: template.start,
        end: template.end,
        userId: chosen.id,
        userName: chosen.name,
        station,
        autoRota: true,
        createdByAI: true,
        generatedByAI: true
      });

      dailyUsed.add(chosen.id);
      assignedHours[chosen.id] = (assignedHours[chosen.id] || 0) + hoursBetween(template.start, template.end);
      created++;
    }
  }

  const pattern = buildDayShiftTemplates(hours.start, hours.end)
    .map((item) => `${item.name} ${item.start}-${item.end}`)
    .join(", ");

  let reply = `Team rota created better ✅

Week: ${toISO(dates[0])} to ${toISO(dates[6])}
Hours: ${hours.start}–${hours.end}
Shift pattern: ${pattern}

Rules used:
• max 1 shift per person per day
• 1 day off per crew member
• 1 station per shift
• no same-station overlap

Shifts created: ${created}`;

  if (gaps) reply += `\nCoverage gaps: ${gaps}`;
  if (notes.length) reply += `\nNotes: ${notes.slice(0, 4).join(" | ")}`;

  reply += `\n\nTry: replace team rota for this week 6am-11pm`;

  return reply;
}

function isTeamRotaCommand(text) {
  const t = norm(text);

  return (
    /\b(create|make|generate|build|plan|auto|replace|redo|regenerate|rebuild)\b/.test(t) &&
    (t.includes("rota") || t.includes("schedule") || t.includes("shifts")) &&
    (t.includes("team") ||
      t.includes("entire") ||
      t.includes("everyone") ||
      t.includes("all") ||
      t.includes("this week") ||
      t.includes("next week"))
  );
}

function wantsDeleteGenerated(text) {
  const t = norm(text);

  return (
    /\b(delete|remove|clear)\b/.test(t) &&
    (t.includes("generated rota") || t.includes("auto rota") || t.includes("generated shifts"))
  );
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

    const lower = norm(text);

    if (!isTeamRotaCommand(lower) && !wantsDeleteGenerated(lower)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    addMsg(text, "user");
    input.value = "";

    if (send) send.disabled = true;

    try {
      const user = getUser();

      const reply = wantsDeleteGenerated(lower)
        ? await deleteGeneratedRota(text, user)
        : await createTeamRota(text, user);

      addMsg(reply, "bot");
    } catch (error) {
      console.error("Rota fix error:", error);
      addMsg("I tried to make the rota, but something went wrong. Check Firebase permissions or crew data.", "bot");
    }

    if (send) send.disabled = false;
  },
  true
);
