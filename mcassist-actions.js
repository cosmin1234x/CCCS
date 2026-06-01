import { auth, db } from "./firebase-init.js";
import { collection, addDoc, deleteDoc, doc, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const norm = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9:\s-]/g, " ").replace(/\s+/g, " ").trim();
const esc = (v) => String(v || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

const TRAINING_MODULES = { grill:"grill", kitchen:"grill", fries:"fries", counter:"counter", front:"counter", till:"counter", clean:"clean", cleanliness:"clean", lobby:"clean" };
const STATIONS = ["grill","fries","front","counter","drive","line","kitchen","chicken","lobby","clean"];
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

function openPage(url, reply) {
  setTimeout(() => { window.location.href = url; }, 550);
  return reply;
}

function clickEl(el, ok, fail = "I couldn’t find that button on this page.") {
  if (!el) return fail;
  el.click();
  return ok;
}

function titleCase(s) { return String(s || "").replace(/\b\w/g, c => c.toUpperCase()); }
function toISO(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }

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

function toMinutes(hhmm) { const [h,m] = String(hhmm || "00:00").split(":").map(n => Number(n)||0); return h*60+m; }
function overlaps(aStart,aEnd,bStart,bEnd) { let aS=toMinutes(aStart), aE=toMinutes(aEnd), bS=toMinutes(bStart), bE=toMinutes(bEnd); if(aE<aS)aE+=1440; if(bE<bS)bE+=1440; return aS < bE && bS < aE; }

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
  await addDoc(collection(db, "stores", storeId, "Shifts"), { date, start:time.start, end:time.end, userId:crew.id, userName:crew.name, role:crew.role || "crew", station, createdBy:user.id || auth.currentUser?.uid || "mcassist", createdAt:Date.now(), createdByAI:true });
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

async function handleSmartCommand(text) {
  const user = getSessionUser() || { id:auth.currentUser?.uid, role:"crew", storeId:"store001", name:auth.currentUser?.email || "User" };
  const t = norm(text);
  const local = controlCurrentPage(text); if (local) return local;
  const rewards = controlBreakRewards(text); if (rewards) return rewards;

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
  if (t.includes("what can you do") || t.includes("commands") || t.includes("help")) return "I can control the site now ✅\n\nTry:\n• open grill training\n• open rewards\n• search fries in rewards\n• clear cart\n• checkout\n• show shifts\n• open shift creator\n• create shift for Alex tomorrow 9-5 grill\n• delete shift for Alex tomorrow\n• open profile\n• collapse AI";
  return null;
}

function hookChatForm() {
  const form = $("aiForm"), input = $("aiInput"), sendBtn = $("aiSendBtn");
  if (!form || !input || form.dataset.mcassistActionsHooked === "1") return;
  form.dataset.mcassistActionsHooked = "1";
  form.addEventListener("submit", async (event) => {
    const text = input.value.trim(); if (!text) return;
    const maybeAction = /\b(create|add|make|book|put|delete|remove|cancel|open|go to|show|commands|help|allergen|late|break|reward|food|menu|profile|logout|collapse|hide ai|checkout|cart|bonus|dashboard|admin)\b/i.test(text);
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