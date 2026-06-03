// live-shifts.js — rota tools + real AI McAssist frontend
(function () {
  const STORE_KEY = "mc_live_shifts";
  const WEEK_KEY = "mc_week_offset";
  const CHAT_MEMORY_KEY = "mc_chat_memory";

  const crew = [
    { id: "amelia", name: "Amelia", role: "crew", stations: ["Front Counter", "Drive-thru", "Lobby"], stars: 4 },
    { id: "ryan", name: "Ryan", role: "crew", stations: ["Kitchen", "Fries", "Line"], stars: 7 },
    { id: "maya", name: "Maya", role: "crew", stations: ["Lobby", "Front Counter"], stars: 1 },
    { id: "leo", name: "Leo", role: "manager", stations: ["Shift Lead", "Kitchen", "Front Counter"], stars: 9 },
    { id: "sophia", name: "Sophia", role: "crew", stations: ["Drive-thru", "Drinks", "Runner"], stars: 5 },
    { id: "adam", name: "Adam", role: "crew", stations: ["Grill", "Chicken", "Stock"], stars: 3 }
  ];

  const stationPlan = ["Shift Lead", "Front Counter", "Drive-thru", "Fries", "Kitchen", "Line", "Lobby", "Runner", "Drinks", "Stock"];
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const longDays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  let currentWeekOffset = Number(localStorage.getItem(WEEK_KEY) || 0);

  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const norm = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9:\s-]/g, " ").replace(/\s+/g, " ").trim();

  function getUser() { try { return JSON.parse(localStorage.getItem("mc_session_user") || "null"); } catch { return null; } }
  function cleanRole(role) { const r = String(role || "crew").toLowerCase().replace(/\s+/g, ""); return r === "manager" ? "manager" : r === "shiftcreator" ? "shiftCreator" : "crew"; }
  function canManage() { const role = cleanRole(getUser()?.role); return role === "manager" || role === "shiftCreator"; }
  function deny() { return "Only managers and shift creators can generate, create, delete or clear shifts. Crew members can view their rota only."; }
  function toISO(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
  function getMonday(base = new Date()) { const d = new Date(base); const day = d.getDay(); d.setDate(d.getDate() + ((day === 0 ? -6 : 1) - day)); d.setHours(0,0,0,0); return d; }
  function getWeekDays(offset = currentWeekOffset) { const start = getMonday(); start.setDate(start.getDate() + offset * 7); return Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; }); }
  function weekLabel(offset = currentWeekOffset) { const days = getWeekDays(offset); return `${days[0].toLocaleDateString("en-GB", { day: "numeric", month: "short" })} - ${days[6].toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`; }

  function parseTime(value) {
    if (!value) return null;
    let v = String(value).toLowerCase().trim().replace(/\./g, ":");
    const ampm = v.match(/(am|pm)$/)?.[1] || "";
    v = v.replace(/(am|pm)$/g, "").trim();
    let h = 0, m = 0;
    if (v.includes(":")) { const p = v.split(":"); h = Number(p[0]); m = Number(p[1] || 0); } else h = Number(v);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    if (ampm === "pm" && h < 12) h += 12;
    if (ampm === "am" && h === 12) h = 0;
    if (h > 23 || m > 59) return null;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  function parseTimeRange(text) { const m = norm(text).match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:-|to|until|till)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i); if (!m) return null; let start = parseTime(m[1]), end = parseTime(m[2]); if (!start || !end) return null; const sh = Number(start.split(":")[0]); const eh = Number(end.split(":")[0]); if (!/[ap]m/i.test(m[2]) && sh >= 7 && sh <= 11 && eh >= 1 && eh <= 8) end = `${String(eh + 12).padStart(2, "0")}:00`; return { start, end }; }
  function parseDate(text) { const t = norm(text); const now = new Date(); if (t.includes("tomorrow")) { const d = new Date(now); d.setDate(d.getDate() + 1); return toISO(d); } if (t.includes("today")) return toISO(now); for (let i = 0; i < longDays.length; i++) if (t.includes(longDays[i])) { const d = new Date(now); let diff = i - d.getDay(); if (diff <= 0) diff += 7; d.setDate(d.getDate() + diff); return toISO(d); } const iso = t.match(/\b(20\d{2}-\d{2}-\d{2})\b/); return iso ? iso[1] : toISO(now); }
  function parseName(text) { const m = String(text || "").match(/(?:for|to|with)\s+([a-zA-Z][a-zA-Z '-]{1,30})/i); if (!m) return ""; return m[1].replace(/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|from|at|on|\d{1,2}(:\d{2})?(am|pm)?|to|until|till|fries|kitchen|front|counter|drive|lobby|line|grill|stock).*$/i, "").trim(); }
  function parseStation(text) { const t = norm(text); const map = { fries: "Fries", kitchen: "Kitchen", front: "Front Counter", counter: "Front Counter", drive: "Drive-thru", lobby: "Lobby", line: "Line", grill: "Grill", stock: "Stock", drinks: "Drinks", runner: "Runner", chicken: "Chicken" }; for (const k of Object.keys(map)) if (t.includes(k)) return map[k]; return "Front Counter"; }

  function saveShifts(list) { localStorage.setItem(STORE_KEY, JSON.stringify(list)); }
  function loadShifts() { try { const raw = localStorage.getItem(STORE_KEY); if (raw) return JSON.parse(raw); } catch {} const seeded = []; seedWeek(0, seeded); seedWeek(1, seeded); saveShifts(seeded); return seeded; }
  function seedWeek(offset, target) {
    let idx = offset * 2;
    getWeekDays(offset).forEach((d) => {
      const date = toISO(d), dow = d.getDay();
      const demand = dow === 5 || dow === 6 ? "high" : dow === 0 ? "low" : "normal";
      const blocks = demand === "high" ? [{ start:"09:00", end:"17:00" }, { start:"12:00", end:"20:00" }, { start:"16:00", end:"23:00" }] : demand === "low" ? [{ start:"10:00", end:"18:00" }, { start:"15:00", end:"22:00" }] : [{ start:"09:00", end:"17:00" }, { start:"14:00", end:"22:00" }];
      blocks.forEach((block, b) => { const needed = demand === "high" ? 5 : demand === "low" ? 3 : 4; for (let slot = 0; slot < needed; slot++) { const person = crew[(idx + slot + b) % crew.length]; const station = slot === 0 ? "Shift Lead" : person.stations[(slot + b) % person.stations.length]; target.push({ id:`shift_${date}_${block.start}_${person.id}_${slot}`, date, start:block.start, end:block.end, userId:person.id, userName:person.name, role:person.role, station, risk: slot === 0 ? "Covered" : demand === "high" ? "Peak" : "Normal", generatedByAI:true }); } idx += 1; });
    });
  }
  function shiftsForWeek(offset = currentWeekOffset) { const set = new Set(getWeekDays(offset).map(toISO)); return loadShifts().filter((s) => set.has(s.date)).sort((a,b) => `${a.date}${a.start}${a.userName}`.localeCompare(`${b.date}${b.start}${b.userName}`)); }
  function generateWeek(offset = currentWeekOffset, silent = false) { if (!canManage()) { if (!silent) toast(deny()); return false; } const dates = getWeekDays(offset).map(toISO); const existing = loadShifts().filter((s) => !dates.includes(s.date)); seedWeek(offset, existing); saveShifts(existing); if (!silent) toast(`Generated shifts for ${weekLabel(offset)}`); return true; }
  function addManualShift({ name, date, start, end, station }) { if (!canManage()) return deny(); const person = crew.find((c) => norm(c.name).startsWith(norm(name))) || crew[0]; const list = loadShifts(); if (list.some((s) => s.userId === person.id && s.date === date && s.start === start)) return `${person.name} already has a shift starting ${start} on ${date}.`; list.push({ id:`manual_${Date.now()}`, date, start, end, userId:person.id, userName:person.name, role:person.role, station:station || "Front Counter", risk:"Manual", generatedByAI:false }); saveShifts(list); renderAllSchedules(); return `Created shift for ${person.name}: ${date}, ${start}-${end} on ${station || "Front Counter"}.`; }
  function deleteShiftFromText(text) { if (!canManage()) return deny(); const name = parseName(text), date = parseDate(text), target = norm(name); let list = loadShifts(); const before = list.length; list = list.filter((s) => !(s.date === date && (!target || norm(s.userName).includes(target)))); saveShifts(list); renderAllSchedules(); return before === list.length ? `I could not find a matching shift on ${date}.` : `Deleted ${before - list.length} matching shift(s) on ${date}.`; }

  function renderWeekTabs() { const tabs = $("weekTabs"); if (!tabs) return; tabs.innerHTML = ["This week", "Next week", "Week after"].map((label,i) => `<button class="btn ${i === currentWeekOffset ? "" : "alt"}" type="button" data-week="${i}">${label}<br><small>${weekLabel(i)}</small></button>`).join(""); tabs.querySelectorAll("button").forEach((btn) => btn.addEventListener("click", () => { currentWeekOffset = Number(btn.dataset.week || 0); localStorage.setItem(WEEK_KEY, String(currentWeekOffset)); renderAllSchedules(); })); }
  function renderScheduleCards() { const box = $("scheduleCard"); if (!box) return; const user = getUser() || {}; const isCrew = cleanRole(user.role) === "crew"; const week = shiftsForWeek(currentWeekOffset); box.innerHTML = `<div class="between wrap"><div><h3>${currentWeekOffset === 0 ? "This week" : currentWeekOffset === 1 ? "Next week" : "Week after"}</h3><p class="muted">${weekLabel(currentWeekOffset)} • ${week.length} shifts scheduled</p></div><span class="pill ok">${isCrew ? "Your view" : "Manager view"}</span></div><div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(210px,1fr));margin-top:14px;">${getWeekDays(currentWeekOffset).map((d) => { const iso = toISO(d); let list = week.filter((s) => s.date === iso); if (isCrew) list = list.filter((s) => s.userId === user.id || s.userName.toLowerCase().startsWith(String(user.name || "").toLowerCase()[0] || "")); return `<article class="mini shift-pop"><h3>${dayNames[d.getDay()]} ${d.getDate()}</h3>${list.length ? list.map((s) => `<div class="between" style="border-top:2px dashed rgba(35,18,10,.15);padding-top:8px;margin-top:8px;"><span><b>${esc(s.userName)}</b><br><small class="muted">${s.start}-${s.end} • ${esc(s.station)}</small></span><span class="pill ${s.risk === "Peak" ? "warn" : "ok"}">${s.risk}</span></div>`).join("") : `<p class="muted" style="margin-top:8px;">No shifts.</p>`}</article>`; }).join("")}</div>`; }
  function renderShiftTable() { const table = $("shiftTable"); if (!table) return; const week = shiftsForWeek(currentWeekOffset); table.innerHTML = `<table class="table"><thead><tr><th>Date</th><th>Time</th><th>Crew</th><th>Station</th><th>Type</th></tr></thead><tbody>${week.map((s) => `<tr><td>${s.date}</td><td>${s.start}-${s.end}</td><td>${esc(s.userName)}</td><td>${esc(s.station)}</td><td><span class="pill ${s.generatedByAI ? "ok" : "warn"}">${s.generatedByAI ? "AI" : "Manual"}</span></td></tr>`).join("")}</tbody></table>`; }
  function renderManagerTools() { const box = $("shiftManageCard"); if (!box) return; if (!canManage()) { box.innerHTML = `<div class="between wrap"><div><h3>Manager tools locked</h3><p class="muted">Crew members can view shifts, but cannot generate, clear, create or delete rotas.</p></div><span class="pill bad">Crew access</span></div><div class="hero-actions"><a class="btn alt" href="schedule.html">View my shifts</a><a class="btn" href="main.html">Back to dashboard</a></div>`; return; } const today = toISO(new Date()); box.innerHTML = `<div class="between wrap"><div><h3>Working shift tools</h3><p class="muted">Generate a week, create a manual shift, then view it on the rota.</p></div><span class="pill ok">Manager access</span></div><div class="grid two" style="margin-top:14px;"><div class="mini"><h3>Generate week</h3><div class="field"><label>Week</label><select id="liveGenWeek"><option value="0">This week</option><option value="1">Next week</option><option value="2">Week after</option></select></div><button id="liveGenerateBtn" class="btn" type="button">🤖 Generate fair week</button><button id="liveClearWeekBtn" class="btn alt" type="button" style="margin-top:8px;">Clear this week</button></div><div class="mini"><h3>Create manual shift</h3><div class="field"><label>Crew</label><select id="liveCrew">${crew.map((c) => `<option value="${c.name}">${c.name} - ${c.role}</option>`).join("")}</select></div><div class="grid two"><div class="field"><label>Date</label><input id="liveDate" type="date" value="${today}"></div><div class="field"><label>Station</label><select id="liveStation">${stationPlan.map((s) => `<option>${s}</option>`).join("")}</select></div></div><div class="grid two"><div class="field"><label>Start</label><input id="liveStart" type="time" value="14:00"></div><div class="field"><label>End</label><input id="liveEnd" type="time" value="22:00"></div></div><button id="liveCreateBtn" class="btn" type="button">➕ Create shift</button></div></div>`; $("liveGenerateBtn")?.addEventListener("click", () => { const offset = Number($("liveGenWeek")?.value || 0); currentWeekOffset = offset; localStorage.setItem(WEEK_KEY, String(offset)); generateWeek(offset, false); renderAllSchedules(); }); $("liveClearWeekBtn")?.addEventListener("click", () => { if (!canManage()) return toast(deny()); const offset = Number($("liveGenWeek")?.value || currentWeekOffset); const dates = new Set(getWeekDays(offset).map(toISO)); saveShifts(loadShifts().filter((s) => !dates.has(s.date))); currentWeekOffset = offset; localStorage.setItem(WEEK_KEY, String(offset)); renderAllSchedules(); toast("Week cleared"); }); $("liveCreateBtn")?.addEventListener("click", () => { toast(addManualShift({ name: $("liveCrew").value, date: $("liveDate").value, start: $("liveStart").value, end: $("liveEnd").value, station: $("liveStation").value })); }); }
  function renderAllSchedules() { renderWeekTabs(); renderScheduleCards(); renderShiftTable(); renderManagerTools(); }

  function addMsg(who, text, options = null) { const chat = $("aiChat"); if (!chat) return null; const div = document.createElement("div"); div.className = `msg ${who}`; div.innerHTML = `<div class="bubble">${esc(text).replaceAll("\n", "<br>")}${options ? `<div class="ai-actions">${options.map((o) => `<button type="button" data-ai-action="${esc(o)}">${esc(o)}</button>`).join("")}</div>` : ""}</div>`; chat.appendChild(div); chat.scrollTop = chat.scrollHeight; div.querySelectorAll("[data-ai-action]").forEach((btn) => btn.addEventListener("click", () => { const input = $("aiInput"), form = $("aiForm"); if (input && form) { input.value = btn.dataset.aiAction; form.requestSubmit(); } })); return div; }
  function saveMemory(role, content) { const memory = loadMemory(); memory.push({ role, content, at: Date.now() }); localStorage.setItem(CHAT_MEMORY_KEY, JSON.stringify(memory.slice(-12))); }
  function loadMemory() { try { return JSON.parse(localStorage.getItem(CHAT_MEMORY_KEY) || "[]"); } catch { return []; } }

  function weekSummary(offset = currentWeekOffset) { const week = shiftsForWeek(offset); if (!week.length) return `No shifts for ${weekLabel(offset)}.`; const byDay = {}; week.forEach((s) => { (byDay[s.date] ||= []).push(s); }); return `Shifts for ${weekLabel(offset)}:\n` + Object.entries(byDay).map(([date, list]) => `${date}: ${list.slice(0, 5).map((s) => `${s.userName} ${s.start}-${s.end} ${s.station}`).join("; ")}${list.length > 5 ? `; +${list.length - 5} more` : ""}`).join("\n"); }

  function runLocalCommand(text) {
    const q = norm(text);
    if (q.includes("open training")) { location.href = "training.html"; return "Opening training."; }
    if (q.includes("open reward")) { location.href = "break-rewards.html"; return "Opening rewards."; }
    if (q.includes("open shift") || q.includes("open rota")) { location.href = "schedule.html"; return "Opening shifts."; }
    if (q.includes("generate") && (q.includes("shift") || q.includes("rota") || q.includes("schedule"))) { if (!canManage()) return deny(); const offset = q.includes("next week") ? 1 : q.includes("week after") ? 2 : currentWeekOffset; currentWeekOffset = offset; localStorage.setItem(WEEK_KEY, String(offset)); generateWeek(offset, true); renderAllSchedules(); return `Done ✅ I generated a fair rota for ${weekLabel(offset)}.`; }
    if ((q.includes("show") || q.includes("see") || q.includes("what")) && (q.includes("shift") || q.includes("rota") || q.includes("schedule"))) { const offset = q.includes("next week") ? 1 : q.includes("week after") ? 2 : currentWeekOffset; return weekSummary(offset); }
    if ((q.includes("create") || q.includes("add") || q.includes("make")) && q.includes("shift")) { if (!canManage()) return deny(); const name = parseName(text); const time = parseTimeRange(text); if (!name || !time) return "Try: create shift for Amelia tomorrow 9-5 fries."; return addManualShift({ name, date: parseDate(text), start: time.start, end: time.end, station: parseStation(text) }); }
    if ((q.includes("delete") || q.includes("remove") || q.includes("cancel") || q.includes("clear")) && q.includes("shift")) return deleteShiftFromText(text);
    return null;
  }

  async function askRealAI(message) {
    const user = getUser() || {};
    const localContext = { page: document.title || location.pathname, canManage: canManage(), week: weekLabel(currentWeekOffset), shifts: weekSummary(currentWeekOffset).slice(0, 1600) };
    const history = loadMemory().filter((m) => m.role === "user" || m.role === "assistant").slice(-8);
    const response = await fetch("/api/ai-chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, session: user, appContext: localContext, history }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.reply || data.error || "AI backend failed");
    return data.reply || "I’m not sure yet.";
  }

  function handleAi(text) { return runLocalCommand(text) || "AI is thinking..."; }

  function patchChat() {
    const form = $("aiForm"), input = $("aiInput"), chips = $("aiSuggestions"), chat = $("aiChat");
    if (!form || !input) return;
    const managerChips = canManage() ? ["Generate next week shifts", "Create shift for Amelia tomorrow 9-5 fries"] : [];
    if (chips) { chips.innerHTML = ["Hi McAssist", "What can you do?", "Show this week shifts", ...managerChips, "Help me with training"].map((c) => `<button type="button">${c}</button>`).join(""); chips.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { input.value = b.textContent; form.requestSubmit(); })); }
    if (chat && !chat.dataset.liveGreeting) { chat.dataset.liveGreeting = "1"; addMsg("bot", "Hey 👋 I’m McAssist. I can chat like a real AI now, plus I can still run shift commands when allowed.", ["What can you do?", "Show this week shifts"]); }
    if (form.dataset.livePatched) return;
    form.dataset.livePatched = "1";
    form.addEventListener("submit", async (e) => {
      e.preventDefault(); e.stopImmediatePropagation();
      const text = input.value.trim(); if (!text) return;
      addMsg("user", text); input.value = ""; saveMemory("user", text);
      const commandReply = runLocalCommand(text);
      if (commandReply) { addMsg("bot", commandReply); saveMemory("assistant", commandReply); return; }
      const thinking = addMsg("bot", "Thinking...");
      try {
        const reply = await askRealAI(text);
        if (thinking) thinking.querySelector(".bubble").innerHTML = esc(reply).replaceAll("\n", "<br>");
        saveMemory("assistant", reply);
      } catch (err) {
        const fallback = err.message || "AI is not connected yet. Add OPENAI_API_KEY in Vercel Environment Variables, then redeploy.";
        if (thinking) thinking.querySelector(".bubble").innerHTML = esc(fallback).replaceAll("\n", "<br>");
        saveMemory("assistant", fallback);
      }
    }, true);
  }

  function toast(msg) { if (window.McPitch?.toast) return window.McPitch.toast(msg); alert(msg); }
  function init(page) { if (!localStorage.getItem(STORE_KEY)) loadShifts(); if (page === "schedule" || page === "shifts") renderAllSchedules(); if (page === "shifts" && !canManage()) { const content = document.querySelector(".content"); if (content) content.innerHTML = `<section class="hero"><div class="tag">🔒 Crew access</div><h2 style="margin-top:14px;">Shift Creator is for managers only.</h2><p>Crew members can view their shifts, training, rewards and profile, but cannot generate or edit rotas.</p><div class="hero-actions"><a class="btn" href="schedule.html">View my shifts</a><a class="btn alt" href="main.html">Back to dashboard</a></div></section>`; } patchChat(); }
  window.McLive = { init, generateWeek, renderAllSchedules, weekSummary, handleAi, canManage };
})();
