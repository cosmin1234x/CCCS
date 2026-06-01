import { auth, db } from "./firebase-init.js";
import { collection, addDoc, deleteDoc, doc, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const norm = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9:\s-]/g, " ").replace(/\s+/g, " ").trim();
const esc = (v) => String(v || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

const TRAINING_MODULES = { grill:"grill", kitchen:"grill", fries:"fries", counter:"counter", front:"counter", till:"counter", clean:"clean", cleanliness:"clean", lobby:"clean" };
const STATIONS = ["grill","fries","front","counter","drive","line","kitchen","chicken","lobby","clean"];
const ROTA_STATIONS = ["Grill","Fries","Front Counter","Drive Thru","Kitchen","Lobby","Drinks","Runner","Cleaning","Stock"];
const QUICK_CHIPS = ["What can you do?", "Open grill training", "Show shifts", "Open rewards"];

function loadCss() {
  const href = "ai-chat-fix.css";
  if ([...document.querySelectorAll('link[rel="stylesheet"]')].some(l => (l.getAttribute("href") || "").includes(href))) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href + "?v=smart-2";
  document.head.appendChild(link);
}

function getSessionUser() {
  try { return JSON.parse(localStorage.getItem("mc_session_user") || "null") || null; }
  catch { return null; }
}

function addChatMessage(text, from = "bot") {
  const chat = $("aiChat");
  if (!chat) return;
  const msg = document.createElement("div");
  msg.className = `message ${from === "user" ? "msg-user" : "msg-bot"}`;
  msg.innerHTML = `<div class="bubble">${esc(text).replaceAll("\n", "<br>")}</div><div class="msg-meta">${from === "user" ? "You" : "McAssist"}</div>`;
  chat.appendChild(msg);
  chat.scrollTop = chat.scrollHeight;
}

function openPage(url, reply) { setTimeout(() => { window.location.href = url; }, 550); return reply; }
function clickEl(el, ok, fail = "I couldn’t find that button on this page.") { if (!el) return fail; el.click(); return ok; }
function titleCase(s) { return String(s || "").replace(/\b\w/g, c => c.toUpperCase()); }
function toISO(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function toMinutes(hhmm) { const [h,m] = String(hhmm || "00:00").split(":").map(n => Number(n)||0); return h*60+m; }
function toHHMM(mins) { mins = ((Math.round(mins) % 1440) + 1440) % 1440; return `${String(Math.floor(mins/60)).padStart(2,"0")}:${String(mins%60).padStart(2,"0")}`; }
function overlaps(aStart,aEnd,bStart,bEnd) { let aS=toMinutes(aStart), aE=toMinutes(aEnd), bS=toMinutes(bStart), bE=toMinutes(bEnd); if(aE<=aS)aE+=1440; if(bE<=bS)bE+=1440; return aS < bE && bS < aE; }
function stationKey(s) { return norm(s).replace(/drive thru/g,"drive").replace(/front counter/g,"counter"); }

function parseDateFromText(text) {
  const t = norm(text), now = new Date();
  if (t.includes("today")) return toISO(now);
  if (t.includes("tomorrow")) { const d = new Date(now); d.setDate(d.getDate()+1); return toISO(d); }
  const iso = t.match(/\b(20\d{2}-\d{2}-\d{2})\b/); if (iso) return iso[1];
  const slash = t.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (slash) return `${slash[3] ? Number(String(slash[3]).padStart(4,"20")) : now.getFullYear()}-${String(Number(slash[2])).padStart(2,"0")}-${String(Number(slash[1])).padStart(2,"0")}`;
  const days = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
  for (const day of days) if (t.includes(day)) { const d = new Date(now); let diff = days.indexOf(day)-d.getDay(); if (diff <= 0) diff += 7; d.setDate(d.getDate()+diff); return toISO(d); }
  return toISO(now);
}

function parseTime(value) {
  if (!value) return null;
  let v = String(value).toLowerCase().trim().replace(/\./g, ":");
  const ampm = v.match(/(am|pm)$/)?.[1] || "";
  v = v.replace(/(am|pm)$/g, "").trim();
  let h = 0, m = 0;
  if (v.includes(":")) { const p = v.split(":"); h = Number(p[0]); m = Number(p[1] || 0); }
  else h = Number(v);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h > 23 || m > 59) return null;
  if (ampm === "pm" && h < 12) h += 12;
  if (ampm === "am" && h === 12) h = 0;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
}

function parseTimeRange(text) {
  const m = norm(text).match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:-|to|until|till)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
  if (!m) return null;
  const start = parseTime(m[1]); let end = parseTime(m[2]);
  if (!start || !end) return null;
  if (!/[ap]m/i.test(m[1]) && !/[ap]m/i.test(m[2])) {
    const sh = Number(start.split(":")[0]), eh = Number(end.split(":")[0]);
    if (sh >= 6 && sh <= 11 && eh >= 1 && eh <= 8) end = `${String(eh+12).padStart(2,"0")}:00`;
  }
  return { start, end };
}

function parseNameAfter(text, words) {
  for (const word of words) {
    const m = String(text || "").match(new RegExp(`${word}\\s+(?:shift\\s+for\\s+|for\\s+|shift\\s+)?([a-zA-Z][a-zA-Z '-]{1,35})`, "i"));
    if (m) return m[1].replace(/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|from|at|on|\d{1,2}(:\d{2})?(am|pm)?|to|until|till)\b.*$/i, "").trim();
  }
  return "";
}

function parseStation(text) {
  const t = norm(text);
  const m = t.match(/(?:station|on|for)\s+(grill|fries|front|counter|drive|line|kitchen|chicken|lobby|clean)/i);
  if (m) return titleCase(m[1]);
  const found = STATIONS.find(s => t.includes(s));
  return found ? titleCase(found) : "";
}

function canManageShifts(user) {
  const role = String(user?.role || "").toLowerCase();
  return role === "manager" || role === "shiftcreator" || role === "shift creator";
}

async function findCrewByName(storeId, name) {
  const clean = norm(name); if (!clean) return null;
  const snap = await getDocs(query(collection(db, "users"), where("storeId", "==", storeId)));
  const crew = [];
  snap.forEach(s => { const d = s.data() || {}; crew.push({ id:s.id, name:d.name || d.email || "Crew", role:d.role || "crew" }); });
  return crew.find(c => norm(c.name) === clean) || crew.find(c => norm(c.name).startsWith(clean)) || crew.find(c => norm(c.name).includes(clean)) || null;
}

async function createShiftFromCommand(text, user) {
  if (!canManageShifts(user)) return "Only a manager or shift creator can create shifts.";
  const storeId = user.storeId || "store001";
  const name = parseNameAfter(text, ["create","add","make","book","put"]);
  const crew = await findCrewByName(storeId, name);
  const date = parseDateFromText(text), time = parseTimeRange(text), station = parseStation(text);
  if (!crew) return `I couldn’t find “${name || "that name"}”. Try: create shift for Alex tomorrow 9-5 grill.`;
  if (!time) return "I need a start and end time. Try: create shift for Alex tomorrow 9-5 grill.";
  const existing = await getDocs(collection(db, "stores", storeId, "Shifts"));
  let clash = false;
  existing.forEach(snap => { const s = snap.data() || {}; if (s.userId === crew.id && s.date === date && overlaps(s.start,s.end,time.start,time.end)) clash = true; });
  if (clash) return `${crew.name} already has an overlapping shift on ${date}.`;
  await addDoc(collection(db, "stores", storeId, "Shifts"), { date, start:time.start, end:time.end, userId:crew.id, userName:crew.name, role:crew.role || "crew", station, isShiftManager:false, createdBy:user.id || auth.currentUser?.uid || "mcassist", createdAt:Date.now(), createdByAI:true });
  return `Done ✅ Created shift for ${crew.name}: ${date}, ${time.start}–${time.end}${station ? ` on ${station}` : ""}.`;
}

async function deleteShiftFromCommand(text, user) {
  if (!canManageShifts(user)) return "Only a manager or shift creator can delete shifts.";
  const storeId = user.storeId || "store001";
  const name = parseNameAfter(text, ["delete","remove","cancel"]);
  const crew = await findCrewByName(storeId, name);
  const date = parseDateFromText(text), time = parseTimeRange(text);
  if (!crew) return `I couldn’t find “${name || "that name"}”. Try: delete shift for Alex tomorrow.`;
  const snap = await getDocs(collection(db, "stores", storeId, "Shifts"));
  const matches = [];
  snap.forEach(docSnap => { const s = docSnap.data() || {}; if (s.userId !== crew.id) return; if (date && s.date !== date) return; if (time && !(s.start === time.start && s.end === time.end)) return; matches.push({ id:docSnap.id, ...s }); });
  if (!matches.length) return `I couldn’t find a matching shift for ${crew.name}${date ? ` on ${date}` : ""}.`;
  if (matches.length > 1 && !time) return `I found ${matches.length} shifts for ${crew.name}. Add a time so I know which one to delete.`;
  await deleteDoc(doc(db, "stores", storeId, "Shifts", matches[0].id));
  return `Deleted ✅ ${crew.name}’s shift on ${matches[0].date} ${matches[0].start}–${matches[0].end}.`;
}

function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0,0,0,0);
  return d;
}

function getWeekDates(text) {
  const t = norm(text);
  const start = getMonday(new Date());
  if (t.includes("next week")) start.setDate(start.getDate() + 7);
  if (t.includes("last week")) start.setDate(start.getDate() - 7);
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
}

function makeBlocks(open, close) {
  let s = toMinutes(open), e = toMinutes(close);
  if (e <= s) e += 1440;
  const duration = e - s;
  const parts = duration <= 390 ? 1 : duration <= 720 ? 2 : 3;
  const points = [s];
  for (let i = 1; i < parts; i++) points.push(Math.round((s + duration * i / parts) / 15) * 15);
  points.push(e);
  return points.slice(0, -1).map((p, i) => ({ start: toHHMM(p), end: toHHMM(points[i+1]) }));
}

function parseStoreHours(text) {
  const t = norm(text);
  if (t.includes("24 hour") || t.includes("24h")) return { start:"00:00", end:"23:59" };
  return parseTimeRange(text) || { start:"06:00", end:"23:00" };
}

function getPersonStations(person) {
  const raw = [];
  [person.stations, person.certifications, person.availableStations, person.stationSkills].forEach(v => { if (Array.isArray(v)) raw.push(...v); });
  const cleaned = raw.map(x => titleCase(String(x).replace(/-/g," ").trim())).filter(Boolean);
  return cleaned.length ? cleaned : ROTA_STATIONS;
}

function getAvailabilityValue(person, dateISO) {
  const d = new Date(`${dateISO}T12:00:00`);
  const long = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"][d.getDay()];
  const short = long.slice(0,3);
  const sources = [person.availability, person.available, person.availableTimes, person.availabilityByDay].filter(Boolean);
  for (const source of sources) {
    if (typeof source === "boolean") return source;
    if (source[dateISO] !== undefined) return source[dateISO];
    if (source[long] !== undefined) return source[long];
    if (source[short] !== undefined) return source[short];
  }
  if (Array.isArray(person.availableDays) && person.availableDays.length) {
    const days = person.availableDays.map(x => norm(x));
    if (!days.includes(long) && !days.includes(short) && !days.includes(dateISO)) return false;
  }
  return true;
}

function rangeCovers(range, start, end) {
  if (range === true || range === "all" || range === "any") return true;
  if (range === false || range === "off" || range === "no") return false;
  const ranges = Array.isArray(range) ? range : [range];
  return ranges.some(r => {
    if (typeof r === "string") {
      const m = r.match(/(\d{1,2}:?\d{0,2}\s*(?:am|pm)?)\s*(?:-|to)\s*(\d{1,2}:?\d{0,2}\s*(?:am|pm)?)/i);
      if (!m) return false;
      r = { start: parseTime(m[1]), end: parseTime(m[2]) };
    }
    const rs = r?.start || r?.from || r?.open;
    const re = r?.end || r?.to || r?.close;
    if (!rs || !re) return false;
    let a = toMinutes(rs), b = toMinutes(re), s = toMinutes(start), e = toMinutes(end);
    if (b <= a) b += 1440;
    if (e <= s) e += 1440;
    return a <= s && e <= b;
  });
}

function isPersonAvailable(person, dateISO, start, end) {
  if (person.active === false || person.disabled === true) return false;
  if (Array.isArray(person.unavailableDates) && person.unavailableDates.includes(dateISO)) return false;
  const av = getAvailabilityValue(person, dateISO);
  return rangeCovers(av, start, end);
}

function chooseStation(person, usedStations) {
  const options = [...getPersonStations(person), ...ROTA_STATIONS];
  for (const st of options) {
    const key = stationKey(st);
    if (!usedStations.has(key)) return titleCase(st);
  }
  return null;
}

async function fetchCrewForStore(storeId) {
  const snap = await getDocs(query(collection(db, "users"), where("storeId", "==", storeId)));
  const people = [];
  snap.forEach(s => {
    const d = s.data() || {};
    const role = String(d.role || "crew").toLowerCase();
    if (/admin|manager/.test(role) && !/shiftcreator/.test(role)) return;
    people.push({ id:s.id, name:d.name || d.email || "Crew", role:d.role || "crew", ...d, maxWeeklyHours:Number(d.maxHours || d.contractHours || d.preferredHours || d.hoursPerWeek || 30) || 30 });
  });
  return people.sort((a,b) => String(a.name).localeCompare(String(b.name)));
}

async function fetchShiftsForWeek(storeId, dates) {
  const wanted = new Set(dates.map(toISO));
  const snap = await getDocs(collection(db, "stores", storeId, "Shifts"));
  const shifts = [];
  snap.forEach(s => { const d = s.data() || {}; if (wanted.has(d.date)) shifts.push({ id:s.id, ...d }); });
  return shifts;
}

function personBusy(shifts, personId, date, start, end) {
  return shifts.some(s => s.userId === personId && s.date === date && overlaps(s.start, s.end, start, end));
}

async function deleteGeneratedRota(text, user) {
  if (!canManageShifts(user)) return "Only a manager or shift creator can delete generated rotas.";
  const storeId = user.storeId || "store001";
  const dates = getWeekDates(text);
  const shifts = await fetchShiftsForWeek(storeId, dates);
  const generated = shifts.filter(s => s.autoRota === true || s.createdByAI === true || s.generatedByAI === true);
  for (const s of generated) await deleteDoc(doc(db, "stores", storeId, "Shifts", s.id));
  return `Deleted ${generated.length} AI-generated shifts for that week ✅`;
}

async function createTeamRotaFromCommand(text, user) {
  if (!canManageShifts(user)) return "Only a manager or shift creator can create the team rota.";

  const storeId = user.storeId || "store001";
  const dates = getWeekDates(text);
  const hours = parseStoreHours(text);
  const blocks = makeBlocks(hours.start, hours.end);
  const replace = /\b(replace|redo|regenerate|rebuild)\b/i.test(text);

  if (replace) await deleteGeneratedRota(text, user);

  const people = await fetchCrewForStore(storeId);
  if (!people.length) return "I couldn’t find any crew for this store.";

  const existing = await fetchShiftsForWeek(storeId, dates);
  const assignedHours = Object.fromEntries(people.map(p => [p.id, 0]));
  existing.forEach(s => { if (assignedHours[s.userId] !== undefined) assignedHours[s.userId] += Math.max(0, (toMinutes(s.end) - toMinutes(s.start) + 1440) % 1440) / 60; });

  let created = 0;
  let gaps = 0;
  const skipped = new Set();

  for (const day of dates) {
    const dateISO = toISO(day);
    const dayAssigned = new Set();

    for (const block of blocks) {
      const usedStations = new Set(
        existing
          .filter(s => s.date === dateISO && overlaps(s.start, s.end, block.start, block.end) && s.station)
          .map(s => stationKey(s.station))
      );

      const available = people
        .filter(p => isPersonAvailable(p, dateISO, block.start, block.end))
        .filter(p => !personBusy(existing, p.id, dateISO, block.start, block.end))
        .sort((a,b) => {
          const aFresh = dayAssigned.has(a.id) ? 1 : 0;
          const bFresh = dayAssigned.has(b.id) ? 1 : 0;
          if (aFresh !== bFresh) return aFresh - bFresh;
          return (assignedHours[a.id] || 0) - (assignedHours[b.id] || 0);
        });

      const target = Math.min(ROTA_STATIONS.length - usedStations.size, available.length, Math.max(2, Math.ceil(available.length / blocks.length)));
      let madeThisBlock = 0;

      for (const person of available) {
        if (madeThisBlock >= target) break;
        const overMax = (assignedHours[person.id] || 0) >= person.maxWeeklyHours;
        if (overMax && available.some(p => (assignedHours[p.id] || 0) < p.maxWeeklyHours)) continue;
        const station = chooseStation(person, usedStations);
        if (!station) { skipped.add(person.name); continue; }

        await addDoc(collection(db, "stores", storeId, "Shifts"), {
          date: dateISO,
          start: block.start,
          end: block.end,
          userId: person.id,
          userName: person.name,
          role: person.role || "crew",
          station,
          isShiftManager: false,
          autoRota: true,
          createdByAI: true,
          generatedByAI: true,
          createdBy: user.id || auth.currentUser?.uid || "mcassist",
          createdAt: Date.now()
        });

        existing.push({ date: dateISO, start:block.start, end:block.end, userId:person.id, userName:person.name, station });
        usedStations.add(stationKey(station));
        assignedHours[person.id] = (assignedHours[person.id] || 0) + ((toMinutes(block.end) - toMinutes(block.start) + 1440) % 1440) / 60;
        dayAssigned.add(person.id);
        created++;
        madeThisBlock++;
      }

      if (madeThisBlock === 0) gaps++;
    }
  }

  const weekStart = toISO(dates[0]);
  const weekEnd = toISO(dates[6]);
  let reply = `Team rota created ✅\n\nWeek: ${weekStart} to ${weekEnd}\nHours covered: ${hours.start}–${hours.end}\nBlocks per day: ${blocks.map(b => `${b.start}-${b.end}`).join(", ")}\nShifts created: ${created}\nCrew used: ${people.length}`;
  if (gaps) reply += `\nCoverage gaps: ${gaps} blocks had no available crew.`;
  if (skipped.size) reply += `\nSkipped station clashes: ${[...skipped].slice(0,4).join(", ")}${skipped.size > 4 ? "..." : ""}`;
  reply += "\n\nTip: say `replace team rota for this week` if you want me to delete old AI shifts and rebuild it.";
  return reply;
}

function controlCurrentPage(text) {
  const t = norm(text);
  if (t.includes("collapse ai") || t.includes("hide ai") || t.includes("close ai")) return clickEl(document.querySelector(".ai-collapse-btn"), "McAssist collapsed ✅");
  if (t.includes("open ai") || t.includes("show ai")) return clickEl(document.querySelector(".ai-open-bubble"), "McAssist opened ✅");
  if (t.includes("profile") || t.includes("my profile")) return clickEl($("myProfileBtn"), "Opening profile ✅", "I can only open your profile when the profile button exists on this page.");
  if (t.includes("logout") || t.includes("log out")) return clickEl($("logoutBtn"), "Logging you out ✅");
  return null;
}

function controlBreakRewards(text) {
  const t = norm(text);
  const onRewards = location.pathname.includes("break-rewards");
  const foodMatch = t.match(/(?:search|find|show)\s+(?:for\s+)?([a-z0-9 ]{2,30})(?:\s+in rewards|\s+in menu|$)/i);
  if (!onRewards && (t.includes("reward") || t.includes("food") || t.includes("menu"))) return openPage("break-rewards.html", "Opening Break Rewards ✅");
  if (!onRewards) return null;
  if (t.includes("clear cart")) return clickEl($("clearCartBtn"), "Cart cleared ✅");
  if (t.includes("checkout") || t.includes("place order")) return clickEl($("checkoutBtn"), "Trying checkout ✅");
  if (t.includes("claim bonus") || t.includes("bonus point")) return clickEl($("claimBonusBtn"), "Trying to claim bonus point ✅");
  if (foodMatch && $("menuSearch")) { $("menuSearch").value = foodMatch[1].trim(); $("menuSearch").dispatchEvent(new Event("input", { bubbles:true })); return `Searching rewards for “${foodMatch[1].trim()}” ✅`; }
  return null;
}

function openTrainingModule(text) {
  const t = norm(text);
  const key = Object.keys(TRAINING_MODULES).find(k => t.includes(k));
  const id = key ? TRAINING_MODULES[key] : "grill";
  return openPage(`training.html?module=${encodeURIComponent(id)}`, `Opening ${titleCase(id)} training ✅`);
}

function isTeamRotaCommand(t) {
  return /\b(create|make|generate|build|plan|auto|replace|redo|regenerate|rebuild)\b/.test(t)
    && (t.includes("rota") || t.includes("schedule") || t.includes("shifts"))
    && (t.includes("team") || t.includes("entire") || t.includes("everyone") || t.includes("all") || t.includes("this week") || t.includes("next week"));
}

async function handleSmartCommand(text) {
  const user = getSessionUser() || { id:auth.currentUser?.uid, role:"crew", storeId:"store001", name:auth.currentUser?.email || "User" };
  const t = norm(text);
  const local = controlCurrentPage(text); if (local) return local;
  const rewards = controlBreakRewards(text); if (rewards) return rewards;

  if (/\b(delete|remove|clear)\b/.test(t) && (t.includes("auto rota") || t.includes("generated shifts") || t.includes("generated rota"))) return await deleteGeneratedRota(text, user);
  if (isTeamRotaCommand(t)) return await createTeamRotaFromCommand(text, user);
  if (/\b(create|add|make|book|put)\b/.test(t) && t.includes("shift")) return await createShiftFromCommand(text, user);
  if (/\b(delete|remove|cancel)\b/.test(t) && t.includes("shift")) return await deleteShiftFromCommand(text, user);
  if ((t.includes("open") || t.includes("go to") || t.includes("show")) && t.includes("dashboard")) return openPage("main.html", "Opening Dashboard ✅");
  if ((t.includes("open") || t.includes("go to") || t.includes("show")) && (t.includes("shift creator") || t.includes("admin"))) return openPage("shifts-admin.html", "Opening Shift Creator ✅");
  if ((t.includes("open") || t.includes("go to") || t.includes("show")) && (t.includes("shift") || t.includes("rota") || t.includes("schedule"))) return openPage("schedule.html", "Opening Shifts ✅");
  if ((t.includes("open") || t.includes("go to") || t.includes("show")) && t.includes("training")) return t.includes("module") || Object.keys(TRAINING_MODULES).some(k => t.includes(k)) ? openTrainingModule(text) : openPage("training.html", "Opening Training ✅");
  if (Object.keys(TRAINING_MODULES).some(k => t.includes(k)) && (t.includes("open") || t.includes("training") || t.includes("module"))) return openTrainingModule(text);
  if ((t.includes("open") || t.includes("go to") || t.includes("show")) && (t.includes("break") || t.includes("reward") || t.includes("points") || t.includes("food"))) return openPage("break-rewards.html", "Opening Break Rewards ✅");

  if (t.includes("how") && t.includes("break") && t.includes("point")) return "Break Rewards gives crew daily food points in the demo shop. You normally get 4 daily points, and managers can award +1 bonus for strong shift habits.";
  if (t.includes("allergen")) return "Allergen rule: don’t guess. Ask a manager or trained person and follow the official allergen process.";
  if (t.includes("late") || t.includes("running late")) return "If someone is late, contact the store/manager as early as possible. Clear message first, excuses later 🍟";
  if (t.includes("what can you do") || t.includes("commands") || t.includes("help")) return "I can control the site now ✅\n\nTry:\n• create shifts for this week\n• replace team rota for this week 6am-11pm\n• delete generated rota this week\n• create shift for Alex tomorrow 9-5 grill\n• delete shift for Alex tomorrow\n• open grill training\n• open rewards\n• search fries in rewards\n• show shifts\n• open profile\n• collapse AI";
  return null;
}

function hookChatForm() {
  const form = $("aiForm"), input = $("aiInput"), sendBtn = $("aiSendBtn");
  if (!form || !input || form.dataset.mcassistActionsHooked === "1") return;
  form.dataset.mcassistActionsHooked = "1";
  form.addEventListener("submit", async (event) => {
    const text = input.value.trim(); if (!text) return;
    const maybeAction = /\b(create|add|make|book|put|delete|remove|cancel|open|go to|show|commands|help|allergen|late|break|reward|food|menu|profile|logout|collapse|hide ai|checkout|cart|bonus|dashboard|admin|rota|schedule|team|everyone|generated)\b/i.test(text);
    if (!maybeAction) return;
    event.preventDefault(); event.stopImmediatePropagation();
    addChatMessage(text, "user"); input.value = ""; if (sendBtn) sendBtn.disabled = true;
    try { addChatMessage((await handleSmartCommand(text)) || "I can help, but I need a bit more detail.", "bot"); }
    catch (error) { console.error("McAssist action error:", error); addChatMessage("I tried to do that, but something went wrong. Check permissions or try again.", "bot"); }
    if (sendBtn) sendBtn.disabled = false;
  }, true);
}

function setFourQuickChips() {
  const box = $("aiSuggestions"); if (!box) return;
  box.innerHTML = "";
  QUICK_CHIPS.forEach(text => {
    const chip = document.createElement("button");
    chip.className = "suggestion-chip";
    chip.type = "button";
    chip.textContent = text;
    chip.onclick = () => { const input = $("aiInput"), form = $("aiForm"); if (input && form) { input.value = text; form.requestSubmit(); } };
    box.appendChild(chip);
  });
}

function init() {
  loadCss();
  hookChatForm();
  setTimeout(setFourQuickChips, 300);
  setTimeout(setFourQuickChips, 900);
  setTimeout(setFourQuickChips, 1800);
  const box = $("aiSuggestions");
  if (box && !box.dataset.fourObserver) {
    box.dataset.fourObserver = "1";
    new MutationObserver(() => { if (box.children.length !== 4) setFourQuickChips(); }).observe(box, { childList:true });
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();