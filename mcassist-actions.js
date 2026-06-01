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
const TRAINING_MODULES = {
  grill: "grill",
  kitchen: "grill",
  fries: "fries",
  counter: "counter",
  front: "counter",
  till: "counter",
  clean: "clean",
  cleanliness: "clean",
  lobby: "clean"
};

const STATIONS = ["grill", "fries", "front", "counter", "drive", "line", "kitchen", "chicken", "lobby", "clean"];

function getSessionUser() {
  try {
    return JSON.parse(localStorage.getItem("mc_session_user") || "null") || null;
  } catch {
    return null;
  }
}

function addChatMessage(text, from = "bot") {
  const aiChat = $("aiChat");
  if (!aiChat) return;

  const msg = document.createElement("div");
  msg.className = `message ${from === "user" ? "msg-user" : "msg-bot"}`;
  msg.innerHTML = `
    <div class="bubble">${escapeHTML(text).replaceAll("\n", "<br>")}</div>
    <div class="msg-meta">${from === "user" ? "You" : "McAssist"}</div>
  `;
  aiChat.appendChild(msg);
  aiChat.scrollTop = aiChat.scrollHeight;
}

function escapeHTML(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalise(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9:\s-]/g, " ").replace(/\s+/g, " ").trim();
}

function toISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseDateFromText(text) {
  const t = normalise(text);
  const now = new Date();
  const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

  if (t.includes("today")) return toISO(now);
  if (t.includes("tomorrow")) {
    const d = new Date(now);
    d.setDate(now.getDate() + 1);
    return toISO(d);
  }

  const iso = t.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];

  const slash = t.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (slash) {
    const day = Number(slash[1]);
    const month = Number(slash[2]);
    const year = slash[3] ? Number(String(slash[3]).padStart(4, "20")) : now.getFullYear();
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  for (const dayName of dayNames) {
    if (t.includes(dayName)) {
      const target = dayNames.indexOf(dayName);
      const d = new Date(now);
      let diff = target - d.getDay();
      if (diff <= 0) diff += 7;
      d.setDate(d.getDate() + diff);
      return toISO(d);
    }
  }

  return toISO(now);
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
  if (h > 23 || m > 59) return null;

  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function parseTimeRange(text) {
  const t = normalise(text);
  const range = t.match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:-|to|until|till)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
  if (!range) return null;

  const start = parseTime(range[1]);
  let end = parseTime(range[2]);

  if (!start || !end) return null;

  // If user says 9-5 without am/pm, assume normal daytime 09:00-17:00.
  if (!/[ap]m/i.test(range[1]) && !/[ap]m/i.test(range[2])) {
    const sHour = Number(start.split(":")[0]);
    const eHour = Number(end.split(":")[0]);
    if (sHour >= 6 && sHour <= 11 && eHour >= 1 && eHour <= 8) {
      end = `${String(eHour + 12).padStart(2, "0")}:00`;
    }
  }

  return { start, end };
}

function parseNameAfter(text, words) {
  const t = String(text || "").trim();
  for (const word of words) {
    const re = new RegExp(`${word}\\s+(?:shift\\s+for\\s+|for\\s+|shift\\s+)?([a-zA-Z][a-zA-Z '-]{1,35})`, "i");
    const m = t.match(re);
    if (m) {
      return m[1]
        .replace(/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|from|at|on|\d{1,2}(:\d{2})?(am|pm)?|to|until|till)\b.*$/i, "")
        .trim();
    }
  }
  return "";
}

function parseStation(text) {
  const t = normalise(text);
  const stationMatch = t.match(/(?:station|on|for)\s+(grill|fries|front|counter|drive|line|kitchen|chicken|lobby|clean)/i);
  if (stationMatch) return titleCase(stationMatch[1]);
  const found = STATIONS.find((s) => t.includes(s));
  return found ? titleCase(found) : "";
}

function titleCase(s) {
  return String(s || "").replace(/\b\w/g, (c) => c.toUpperCase());
}

function canManageShifts(user) {
  const role = String(user?.role || "").toLowerCase();
  return role === "manager" || role === "shiftcreator" || role === "shift creator";
}

async function findCrewByName(storeId, name) {
  const clean = normalise(name);
  if (!clean) return null;

  const snap = await getDocs(query(collection(db, "users"), where("storeId", "==", storeId)));
  const crew = [];
  snap.forEach((docSnap) => {
    const d = docSnap.data() || {};
    crew.push({ id: docSnap.id, name: d.name || d.email || "Crew", role: d.role || "crew" });
  });

  return crew.find((c) => normalise(c.name) === clean)
    || crew.find((c) => normalise(c.name).startsWith(clean))
    || crew.find((c) => normalise(c.name).includes(clean))
    || null;
}

async function createShiftFromCommand(text, user) {
  if (!canManageShifts(user)) {
    return "Only a manager or shift creator can create shifts.";
  }

  const storeId = user.storeId || "store001";
  const name = parseNameAfter(text, ["create", "add", "make", "book", "put"]);
  const crew = await findCrewByName(storeId, name);
  const date = parseDateFromText(text);
  const time = parseTimeRange(text);
  const station = parseStation(text);

  if (!crew) return `I couldn’t find a crew member called “${name || "that name"}”. Try: create shift for Alex tomorrow 9-5 grill.`;
  if (!time) return "I need a start and end time. Try: create shift for Alex tomorrow 9-5 grill.";

  const existing = await getDocs(collection(db, "stores", storeId, "Shifts"));
  let clash = false;
  existing.forEach((snap) => {
    const s = snap.data() || {};
    if (s.userId === crew.id && s.date === date && overlaps(s.start, s.end, time.start, time.end)) clash = true;
  });

  if (clash) {
    return `${crew.name} already has an overlapping shift on ${date}. I didn’t create it.`;
  }

  await addDoc(collection(db, "stores", storeId, "Shifts"), {
    date,
    start: time.start,
    end: time.end,
    userId: crew.id,
    userName: crew.name,
    role: crew.role || "crew",
    station,
    createdBy: user.id || auth.currentUser?.uid || "mcassist",
    createdAt: Date.now(),
    createdByAI: true
  });

  return `Done ✅ Created shift for ${crew.name}: ${date}, ${time.start}–${time.end}${station ? ` on ${station}` : ""}.`;
}

function toMinutes(hhmm) {
  const [h, m] = String(hhmm || "00:00").split(":").map((n) => Number(n) || 0);
  return h * 60 + m;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  let aS = toMinutes(aStart), aE = toMinutes(aEnd);
  let bS = toMinutes(bStart), bE = toMinutes(bEnd);
  if (aE < aS) aE += 1440;
  if (bE < bS) bE += 1440;
  return aS < bE && bS < aE;
}

async function deleteShiftFromCommand(text, user) {
  if (!canManageShifts(user)) {
    return "Only a manager or shift creator can delete shifts.";
  }

  const storeId = user.storeId || "store001";
  const name = parseNameAfter(text, ["delete", "remove", "cancel"]);
  const crew = await findCrewByName(storeId, name);
  const date = parseDateFromText(text);
  const time = parseTimeRange(text);

  if (!crew) return `I couldn’t find a crew member called “${name || "that name"}”. Try: delete shift for Alex tomorrow.`;

  const snap = await getDocs(collection(db, "stores", storeId, "Shifts"));
  const matches = [];
  snap.forEach((docSnap) => {
    const s = docSnap.data() || {};
    if (s.userId !== crew.id) return;
    if (date && s.date !== date) return;
    if (time && !(s.start === time.start && s.end === time.end)) return;
    matches.push({ id: docSnap.id, ...s });
  });

  if (!matches.length) return `I couldn’t find a matching shift for ${crew.name}${date ? ` on ${date}` : ""}.`;

  if (matches.length > 1 && !time) {
    const list = matches.slice(0, 4).map((s) => `• ${s.date} ${s.start}–${s.end}${s.station ? ` ${s.station}` : ""}`).join("\n");
    return `I found ${matches.length} shifts for ${crew.name}. Please be more specific with the date/time:\n${list}`;
  }

  await deleteDoc(doc(db, "stores", storeId, "Shifts", matches[0].id));
  return `Deleted ✅ ${crew.name}’s shift on ${matches[0].date} ${matches[0].start}–${matches[0].end}.`;
}

function openPage(url, reply) {
  setTimeout(() => { window.location.href = url; }, 700);
  return reply;
}

function openTrainingModule(text) {
  const t = normalise(text);
  const key = Object.keys(TRAINING_MODULES).find((k) => t.includes(k));
  const moduleId = key ? TRAINING_MODULES[key] : "grill";
  return openPage(`training.html?module=${encodeURIComponent(moduleId)}`, `Opening ${titleCase(moduleId)} training module ✅`);
}

async function handleSmartCommand(text) {
  const user = getSessionUser() || { id: auth.currentUser?.uid, role: "crew", storeId: "store001", name: auth.currentUser?.email || "User" };
  const t = normalise(text);

  if (/\b(create|add|make|book|put)\b/.test(t) && t.includes("shift")) {
    return await createShiftFromCommand(text, user);
  }

  if (/\b(delete|remove|cancel)\b/.test(t) && t.includes("shift")) {
    return await deleteShiftFromCommand(text, user);
  }

  if ((t.includes("open") || t.includes("go to") || t.includes("show")) && t.includes("training")) {
    if (t.includes("module") || Object.keys(TRAINING_MODULES).some((k) => t.includes(k))) return openTrainingModule(text);
    return openPage("training.html", "Opening Training ✅");
  }

  if ((t.includes("open") || t.includes("go to") || t.includes("show")) && (t.includes("shift") || t.includes("rota") || t.includes("schedule"))) {
    return openPage("schedule.html", "Opening Shifts ✅");
  }

  if ((t.includes("open") || t.includes("go to") || t.includes("show")) && (t.includes("break") || t.includes("reward") || t.includes("points") || t.includes("food"))) {
    return openPage("break-rewards.html", "Opening Break Rewards ✅");
  }

  if (t.includes("how") && t.includes("break") && t.includes("point")) {
    return "Break Rewards gives crew daily points to spend on food in the demo shop. You normally get 4 daily points, and a manager can award +1 bonus for teamwork or a strong shift.";
  }

  if (t.includes("allergen")) {
    return "For allergen questions: don’t guess. Ask a manager or trained person and follow the official allergen process. Safety beats speed.";
  }

  if (t.includes("late") || t.includes("running late")) {
    return "If someone is running late, contact the store/manager as early as possible, explain clearly, and follow what they say. Don’t just turn up late with no message.";
  }

  if (t.includes("what can you do") || t.includes("commands") || t.includes("help")) {
    return "I can do actions now ✅\n\nTry:\n• create shift for Alex tomorrow 9-5 grill\n• delete shift for Alex tomorrow\n• open grill training module\n• open break rewards\n• show shifts\n• open training\n\nI can also answer trainee basics like allergens, being late, break points, and station rules.";
  }

  return null;
}

function hookChatForm() {
  const form = $("aiForm");
  const input = $("aiInput");
  const sendBtn = $("aiSendBtn");
  if (!form || !input || form.dataset.mcassistActionsHooked === "1") return;

  form.dataset.mcassistActionsHooked = "1";

  form.addEventListener("submit", async (event) => {
    const text = input.value.trim();
    if (!text) return;

    const maybeAction = /\b(create|add|make|book|put|delete|remove|cancel|open|go to|show|commands|help|allergen|late|break points?)\b/i.test(text);
    if (!maybeAction) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    addChatMessage(text, "user");
    input.value = "";
    if (sendBtn) sendBtn.disabled = true;

    try {
      const reply = await handleSmartCommand(text);
      if (reply) addChatMessage(reply, "bot");
      else addChatMessage("I can help with that, but I need a bit more detail.", "bot");
    } catch (error) {
      console.error("McAssist action error:", error);
      addChatMessage("I tried to do that, but something went wrong. Check permissions or try again.", "bot");
    }

    if (sendBtn) sendBtn.disabled = false;
  }, true);
}

function enhanceSuggestionChips() {
  const box = $("aiSuggestions");
  if (!box || box.dataset.smartChips === "1") return;
  box.dataset.smartChips = "1";

  const extra = [
    "What can you do?",
    "Open grill training module",
    "Open Break Rewards",
    "Show shifts"
  ];

  for (const text of extra) {
    const chip = document.createElement("button");
    chip.className = "suggestion-chip";
    chip.textContent = text;
    chip.onclick = () => {
      const input = $("aiInput");
      const form = $("aiForm");
      if (input && form) {
        input.value = text;
        form.requestSubmit();
      }
    };
    box.appendChild(chip);
  }
}

function init() {
  hookChatForm();
  setTimeout(enhanceSuggestionChips, 700);
  setTimeout(enhanceSuggestionChips, 1800);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
