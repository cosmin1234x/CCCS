// ==========================================================
// schedule.js — AI SHIFT GENERATOR (CLIENT-SIDE PREVIEW + PUBLISH)
// ==========================================================
// ✅ Generates shifts + forecast on the WEBSITE (in-memory preview)
// ✅ Nothing is written to Firestore until you click "Publish"
// ✅ Works with skills + availability + maxHoursPerWeek
// ✅ Keeps your week tabs + schedule rendering
// ✅ Optional overwrite (delete week shifts) ONLY when publishing

import {
  collection,
  getDocs,
  addDoc,
  deleteDoc,
  doc,
  query,
  where,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";


/* ===================== DOM ===================== */

const sidebarUserName = document.getElementById("sidebarUserName");
const sidebarUserRole = document.getElementById("sidebarUserRole");
const avatarCircle = document.getElementById("avatarCircle");
const roleBadge = document.getElementById("roleBadge");
const logoutBtn = document.getElementById("logoutBtn");

const scheduleTitle = document.getElementById("scheduleTitle");
const scheduleSubtitle = document.getElementById("scheduleSubtitle");
const scheduleCard = document.getElementById("scheduleCard");
const weekTabs = document.getElementById("weekTabs");
const shiftManageCard = document.getElementById("shiftManageCard");

const sidebar = document.querySelector(".sidebar");
const sidebarToggle = document.getElementById("sidebarToggle");

/* ===================== SESSION ===================== */

let sessionUser = null;
let storeId = "store001";

/* ===================== STATE ===================== */

let allShifts = [];             // from Firestore
let storeCrew = [];             // from Firestore users where storeId matches
let currentWeekOffset = 0;

// AI preview mode (generated on WEBSITE, not Firestore)
let aiPreviewActive = false;
let aiPreviewShifts = [];       // generated shifts for preview only

/* ===================== DATE HELPERS ===================== */

const dayKeys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function toISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

function getMonday(baseDate = new Date()) {
  const d = new Date(baseDate);
  const day = d.getDay(); // 0–6
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getWeekRange(offsetWeeks = 0, baseDate = new Date()) {
  const monday = getMonday(baseDate);
  const start = new Date(monday);
  start.setDate(start.getDate() + offsetWeeks * 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start, end };
}

function getWeekDays(offsetWeeks = 0, baseDate = new Date()) {
  const { start } = getWeekRange(offsetWeeks, baseDate);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(d);
  }
  return days;
}

function formatWeekLabel(start, end) {
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const s = `${start.getDate()} ${months[start.getMonth()]}`;
  const e = `${end.getDate()} ${months[end.getMonth()]}`;
  return `${s} – ${e}`;
}

/* ===================== TIME HELPERS ===================== */

function hhmmToMinutes(hhmm) {
  const [hh, mm] = (hhmm || "00:00").split(":").map((n) => parseInt(n, 10) || 0);
  return hh * 60 + mm;
}

function hoursBetween(start, end) {
  let s = hhmmToMinutes(start);
  let e = hhmmToMinutes(end);
  if (e < s) e += 24 * 60;
  return (e - s) / 60;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  let aS = hhmmToMinutes(aStart), aE = hhmmToMinutes(aEnd);
  let bS = hhmmToMinutes(bStart), bE = hhmmToMinutes(bEnd);
  if (aE < aS) aE += 24 * 60;
  if (bE < bS) bE += 24 * 60;
  return aS < bE && bS < aE;
}

/* ===================== FIRESTORE LOAD ===================== */

async function loadCrew() {
  storeCrew = [];
  const qCrew = query(collection(db, "users"), where("storeId", "==", storeId));
  const snap = await getDocs(qCrew);

  snap.forEach((docSnap) => {
    const u = docSnap.data() || {};
    storeCrew.push({
      id: docSnap.id,
      name: u.name || u.email || "Crew",
      role: u.role || "crew",
      skills: u.skills || {},
      availability: u.availability || {},
      maxHoursPerWeek: typeof u.maxHoursPerWeek === "number" ? u.maxHoursPerWeek : 40
    });
  });
}

async function loadShifts() {
  allShifts = [];
  const snap = await getDocs(collection(db, "stores", storeId, "Shifts"));
  snap.forEach((docSnap) => {
    const d = docSnap.data() || {};
    if (!d.date || !d.start || !d.end || !d.userId) return;
    allShifts.push({
      id: docSnap.id,
      date: d.date,
      start: d.start,
      end: d.end,
      userId: d.userId,
      userName: d.userName || "Unknown",
      station: d.station || "",
      role: d.role || "crew",
      isShiftManager: !!d.isShiftManager,
      generatedByAI: !!d.generatedByAI
    });
  });
}

/* ===================== AI ENGINE (WEBSITE ONLY) ===================== */

function stationPlan(demand, dayPart) {
  // Tune this to match your store staffing plan
  const low = {
    core:  ["front","line","grill"],
    close: ["front","line","grill"]
  };
  const normal = {
    core:  ["front","drive","fries","line","grill","chicken"],
    close: ["front","drive","line","grill","chicken"]
  };
  const high = {
    core:  ["front","front","drive","fries","line","line","grill","chicken","floater"],
    close: ["front","drive","fries","line","grill","chicken"]
  };

  const map = demand === "high" ? high : demand === "low" ? low : normal;
  return map[dayPart] || map.core;
}

function hasSkill(u, station) {
  if (station === "floater") return true;
  return !!u.skills?.[station];
}

function canWork(u, dayKey, start, end) {
  const win = Array.isArray(u.availability?.[dayKey]) ? u.availability[dayKey] : [];
  if (!win.length) return false;

  const s = hhmmToMinutes(start);
  let e = hhmmToMinutes(end);
  if (e < s) e += 24 * 60;

  return win.some((w) => {
    const ws = hhmmToMinutes(w.start);
    let we = hhmmToMinutes(w.end);
    if (we < ws) we += 24 * 60;
    return ws <= s && we >= e;
  });
}

function hasClashIn(list, userId, date, start, end) {
  const sameDay = list.filter((s) => s.userId === userId && s.date === date);
  return sameDay.some((s) => overlaps(s.start, s.end, start, end));
}

function computeWeekHoursFrom(list, userId, weekStartISO, weekEndISO) {
  let total = 0;
  list.forEach((s) => {
    if (s.userId !== userId) return;
    if (s.date < weekStartISO || s.date > weekEndISO) return;
    total += hoursBetween(s.start, s.end);
  });
  return total;
}

/**
 * Generates shifts in-memory (preview only).
 * Does NOT write to Firestore.
 */
function generateAIWeekPreview({ weekOffset, demandMap, coreStart, coreEnd, closeStart, closeEnd }) {
  aiPreviewShifts = [];
  aiPreviewActive = true;

  const { start, end } = getWeekRange(weekOffset, new Date());
  const weekStartISO = toISO(start);
  const weekEndISO = toISO(end);

  const days = getWeekDays(weekOffset, new Date());
  const eligibleCrew = storeCrew.filter((c) => c.role === "crew");

  // fairness hours tracker (planned only)
  const plannedHours = new Map();
  const getPlanned = (uid) => plannedHours.get(uid) || 0;
  const addPlanned = (uid, h) => plannedHours.set(uid, getPlanned(uid) + h);

  const unfilled = [];

  for (const dayDate of days) {
    const dateISO = toISO(dayDate);
    const dayKey = dayKeys[dayDate.getDay()];
    const demand = demandMap?.[dayKey] || "normal";

    for (const part of ["core", "close"]) {
      const startHHMM = part === "core" ? coreStart : closeStart;
      const endHHMM = part === "core" ? coreEnd : closeEnd;

      const stations = stationPlan(demand, part);

      for (const station of stations) {
        const candidates = eligibleCrew
          .filter((u) => hasSkill(u, station))
          .filter((u) => canWork(u, dayKey, startHHMM, endHHMM))
          // no overlaps against EXISTING shifts OR already planned preview shifts
          .filter((u) => !hasClashIn(allShifts, u.id, dateISO, startHHMM, endHHMM))
          .filter((u) => !hasClashIn(aiPreviewShifts, u.id, dateISO, startHHMM, endHHMM))
          // fairness: least planned hours first
          .sort((a, b) => {
            const ah = getPlanned(a.id);
            const bh = getPlanned(b.id);
            if (ah !== bh) return ah - bh;
            return a.name.localeCompare(b.name);
          });

        let chosen = null;

        for (const c of candidates) {
          const maxH = typeof c.maxHoursPerWeek === "number" ? c.maxHoursPerWeek : 40;

          const existingWeekHours = computeWeekHoursFrom(allShifts, c.id, weekStartISO, weekEndISO);
          const previewWeekHours = computeWeekHoursFrom(aiPreviewShifts, c.id, weekStartISO, weekEndISO);
          const addH = hoursBetween(startHHMM, endHHMM);

          if (existingWeekHours + previewWeekHours + addH <= maxH + 0.01) {
            chosen = c;
            break;
          }
        }

        if (!chosen) {
          unfilled.push({ date: dateISO, start: startHHMM, end: endHHMM, station });
          continue;
        }

        aiPreviewShifts.push({
          date: dateISO,
          start: startHHMM,
          end: endHHMM,
          userId: chosen.id,
          userName: chosen.name,
          role: chosen.role,
          station: station === "floater" ? "Floater" : station,
          generatedByAI: true,
          demandLevel: demand
        });

        addPlanned(chosen.id, hoursBetween(startHHMM, endHHMM));
      }
    }
  }

  return { created: aiPreviewShifts.length, unfilled };
}

/* ===================== RENDER ===================== */

function renderWeekTabs() {
  if (!weekTabs) return;

  weekTabs.innerHTML = `
    <button class="pill-filter ${currentWeekOffset === 0 ? "active" : ""}" data-week="0">This week</button>
    <button class="pill-filter ${currentWeekOffset === 1 ? "active" : ""}" data-week="1">Next week</button>
  `;

  weekTabs.onclick = (e) => {
    const btn = e.target.closest(".pill-filter");
    if (!btn) return;
    currentWeekOffset = Number(btn.dataset.week || 0);

    weekTabs.querySelectorAll(".pill-filter").forEach((b) => {
      b.classList.toggle("active", b === btn);
    });

    renderSchedule();
  };
}

function renderSchedule() {
  if (!scheduleCard || !sessionUser) return;

  const isManagerLike = sessionUser.role === "manager" || sessionUser.role === "shiftCreator";
  const canManageShifts = sessionUser.role === "shiftCreator";

  const { start, end } = getWeekRange(currentWeekOffset, new Date());
  const weekStartISO = toISO(start);
  const weekEndISO = toISO(end);

  const sourceShifts = aiPreviewActive ? aiPreviewShifts : allShifts;

  const shiftsInWeek = sourceShifts.filter(
    (s) => s.date >= weekStartISO && s.date <= weekEndISO
  );

  const days = getWeekDays(currentWeekOffset, new Date());

  let html = `
    <div class="subsection-title">
      ${currentWeekOffset === 0 ? "This week" : "Next week"}
      ${aiPreviewActive ? `<span class="badge-soft-warn" style="margin-left:10px;">PREVIEW</span>` : ``}
    </div>
    <div class="subsection-sub">${formatWeekLabel(start, end)}</div>
  `;

  if (aiPreviewActive) {
    html += `
      <div class="card" style="margin-top:10px;">
        <div class="subsection-title">AI Preview Controls</div>
        <div class="subsection-sub">Nothing is saved yet. Publish when you’re happy.</div>
        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:8px;">
          <button id="aiPublishBtn" class="btn" type="button">✅ Publish preview</button>
          <button id="aiDiscardBtn" class="btn" type="button" style="background:#111827;">🗑 Discard preview</button>
          <label style="display:flex; align-items:center; gap:8px; font-size:0.8rem; color:#4b5563;">
            <input id="aiOverwriteOnPublish" type="checkbox" />
            Overwrite that week in Firestore (delete + publish)
          </label>
        </div>
        <div id="aiPublishMsg" style="font-size:0.75rem; margin-top:8px;"></div>
      </div>
    `;
  }

  html += `<div style="margin-top:10px; display:flex; flex-wrap:wrap; gap:10px;">`;

  for (const d of days) {
    const dateISO = toISO(d);
    const label = `${dayLabels[d.getDay()]} ${d.getDate()}`;
    const dayShifts = shiftsInWeek.filter((s) => s.date === dateISO);

    let listHTML = "";

    if (!dayShifts.length) {
      listHTML = `<li><span>No shifts.</span></li>`;
    } else if (!isManagerLike) {
      const my = dayShifts.filter((s) => s.userId === sessionUser.id);
      if (!my.length) listHTML = `<li><span>No shift for you.</span></li>`;
      else {
        listHTML = my.map((s) => `
          <li style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
            <span>${s.start}–${s.end}</span>
            <span class="badge-soft">${s.station || "Shift"}${s.generatedByAI ? " 🤖" : ""}</span>
          </li>
        `).join("");
      }
    } else {
      // manager-like view shows all shifts
      listHTML = dayShifts.map((s) => `
        <li style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
          <div style="display:flex; flex-direction:column;">
            <span style="font-weight:700;">${s.userName}</span>
            <span style="font-size:0.75rem; color:#6b7280;">
              ${s.start}–${s.end}${s.station ? " · " + s.station : ""}${s.generatedByAI ? " · AI" : ""}
            </span>
          </div>
          ${canManageShifts && !aiPreviewActive ? `<button class="shift-del" data-id="${s.id}" style="border:none;background:transparent;cursor:pointer;color:#9ca3af;">✕</button>` : ""}
        </li>
      `).join("");
    }

    html += `
      <div class="card" style="flex:1 1 180px; min-width:180px;">
        <div class="card-header">
          <div class="card-title">${label}</div>
          <div class="card-icon">📅</div>
        </div>
        <ul class="list">${listHTML}</ul>
      </div>
    `;
  }

  html += `</div>`;
  scheduleCard.innerHTML = html;

  // delete handlers (only on real shifts)
  if (isManagerLike && canManageShifts && !aiPreviewActive) attachDeleteHandlers();

  // preview controls
  if (aiPreviewActive) {
    document.getElementById("aiDiscardBtn")?.addEventListener("click", () => {
      aiPreviewActive = false;
      aiPreviewShifts = [];
      renderSchedule();
    });

    document.getElementById("aiPublishBtn")?.addEventListener("click", async () => {
      const msg = document.getElementById("aiPublishMsg");
      const overwrite = !!document.getElementById("aiOverwriteOnPublish")?.checked;

      if (msg) {
        msg.style.color = "#6b7280";
        msg.textContent = "Publishing…";
      }

      try {
        await publishPreviewToFirestore(overwrite);

        if (msg) {
          msg.style.color = "#15803d";
          msg.textContent = "Published ✅";
        }
      } catch (e) {
        console.error(e);
        if (msg) {
          msg.style.color = "#b91c1c";
          msg.textContent = "Publish failed. Check console.";
        }
      }
    });
  }
}

async function attachDeleteHandlers() {
  const buttons = scheduleCard.querySelectorAll(".shift-del");
  buttons.forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      if (!id) return;
      if (!confirm("Delete this shift?")) return;

      try {
        await deleteDoc(doc(db, "stores", storeId, "Shifts", id));
        await loadShifts();
        renderSchedule();
      } catch (err) {
        console.error(err);
        alert("Failed to delete shift.");
      }
    });
  });
}

/* ===================== SHIFT MANAGER TOOLS (UI) ===================== */

function renderShiftManageTools() {
  if (!shiftManageCard || !sessionUser) return;

  const canManageShifts = sessionUser.role === "shiftCreator";
  if (!canManageShifts) {
    shiftManageCard.style.display = "none";
    shiftManageCard.innerHTML = "";
    return;
  }

  shiftManageCard.style.display = "block";

  shiftManageCard.innerHTML = `
    <div class="subsection-title">Manage shifts</div>
    <div class="subsection-sub">
      Create a shift manually OR generate a full week on the website (preview), then publish.
    </div>

    <div style="display:flex; flex-wrap:wrap; gap:12px; margin-top:10px;">

      <!-- Manual create -->
      <div style="flex:1 1 260px; min-width:260px;">
        <h4 style="font-size:0.8rem; font-weight:800; margin-bottom:6px;">Create shift</h4>

        <label style="display:block; font-size:0.78rem; margin-bottom:6px;">
          Date
          <input type="date" id="shiftDate" style="width:100%; padding:8px 10px; border-radius:12px; border:1px solid #e5e7eb;" />
        </label>

        <label style="display:block; font-size:0.78rem; margin-bottom:6px;">
          Crew
          <select id="shiftCrew" style="width:100%; padding:8px 10px; border-radius:12px; border:1px solid #e5e7eb;"></select>
        </label>

        <div style="display:flex; gap:8px; margin-bottom:6px;">
          <label style="flex:1; font-size:0.78rem;">
            Start
            <input type="time" id="shiftStart" style="width:100%; padding:8px 10px; border-radius:12px; border:1px solid #e5e7eb;" />
          </label>
          <label style="flex:1; font-size:0.78rem;">
            End
            <input type="time" id="shiftEnd" style="width:100%; padding:8px 10px; border-radius:12px; border:1px solid #e5e7eb;" />
          </label>
        </div>

        <label style="display:block; font-size:0.78rem; margin-bottom:6px;">
          Station (optional)
          <input type="text" id="shiftStation" placeholder="grill / line / front…" style="width:100%; padding:8px 10px; border-radius:12px; border:1px solid #e5e7eb;" />
        </label>

        <button id="createShiftBtn" class="btn" type="button" style="width:100%; justify-content:center; margin-top:6px;">
          ➕ Create shift
        </button>

        <div id="manualMsg" style="font-size:0.75rem; margin-top:8px;"></div>
      </div>

      <!-- AI generate -->
      <div style="flex:1 1 340px; min-width:340px;">
        <h4 style="font-size:0.8rem; font-weight:800; margin-bottom:6px;">AI generate week (PREVIEW)</h4>

        <label style="display:block; font-size:0.78rem; margin-bottom:6px;">
          Week
          <select id="aiWeek" style="width:100%; padding:8px 10px; border-radius:12px; border:1px solid #e5e7eb;">
            <option value="0">This week</option>
            <option value="1">Next week</option>
          </select>
        </label>

        <div style="display:flex; gap:8px; margin-bottom:8px;">
          <label style="flex:1; font-size:0.78rem;">
            Core start
            <input type="time" id="aiCoreStart" value="16:00" style="width:100%; padding:8px 10px; border-radius:12px; border:1px solid #e5e7eb;" />
          </label>
          <label style="flex:1; font-size:0.78rem;">
            Core end
            <input type="time" id="aiCoreEnd" value="20:00" style="width:100%; padding:8px 10px; border-radius:12px; border:1px solid #e5e7eb;" />
          </label>
        </div>

        <div style="display:flex; gap:8px; margin-bottom:8px;">
          <label style="flex:1; font-size:0.78rem;">
            Close start
            <input type="time" id="aiCloseStart" value="20:00" style="width:100%; padding:8px 10px; border-radius:12px; border:1px solid #e5e7eb;" />
          </label>
          <label style="flex:1; font-size:0.78rem;">
            Close end
            <input type="time" id="aiCloseEnd" value="23:00" style="width:100%; padding:8px 10px; border-radius:12px; border:1px solid #e5e7eb;" />
          </label>
        </div>

        <div style="border:1px solid #e5e7eb; border-radius:14px; padding:10px; background:#f9fafb;">
          <div style="font-size:0.75rem; color:#6b7280; margin-bottom:8px;">
            Forecast per day (controls staffing plan)
          </div>
          <div id="forecastGrid" style="display:grid; grid-template-columns:repeat(2,1fr); gap:8px;"></div>
        </div>

        <button id="aiGenerateBtn" class="btn" type="button" style="width:100%; justify-content:center; margin-top:10px;">
          🤖 Generate preview schedule
        </button>

        <div id="aiMsg" style="font-size:0.75rem; margin-top:8px;"></div>
      </div>

    </div>
  `;

  // fill crew select
  const shiftCrew = document.getElementById("shiftCrew");
  if (shiftCrew) {
    shiftCrew.innerHTML = "";
    storeCrew.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = `${c.name} (${c.role})`;
      shiftCrew.appendChild(opt);
    });
  }

  // build forecast grid
  const forecastGrid = document.getElementById("forecastGrid");
  if (forecastGrid) {
    forecastGrid.innerHTML = `
      ${["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((label, i) => {
        const key = ["mon","tue","wed","thu","fri","sat","sun"][i];
        return `
          <label style="display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:0.75rem;">
            <span style="min-width:36px;">${label}</span>
            <select data-forecast="${key}" style="flex:1; padding:8px 10px; border-radius:12px; border:1px solid #e5e7eb;">
              <option value="low">Low</option>
              <option value="normal" selected>Normal</option>
              <option value="high">High</option>
            </select>
          </label>
        `;
      }).join("")}
    `;
  }

  // manual create handler
  document.getElementById("createShiftBtn")?.addEventListener("click", async () => {
    const msg = document.getElementById("manualMsg");
    const date = document.getElementById("shiftDate")?.value;
    const userId = document.getElementById("shiftCrew")?.value;
    const start = document.getElementById("shiftStart")?.value;
    const end = document.getElementById("shiftEnd")?.value;
    const station = (document.getElementById("shiftStation")?.value || "").trim();

    const crewObj = storeCrew.find((c) => c.id === userId);

    if (!date || !userId || !start || !end || !crewObj) {
      if (msg) { msg.style.color = "#b91c1c"; msg.textContent = "Fill date, crew, start and end."; }
      return;
    }

    const clash = allShifts.some(
      (s) => s.userId === userId && s.date === date && overlaps(s.start, s.end, start, end)
    );

    if (clash) {
      if (msg) { msg.style.color = "#b91c1c"; msg.textContent = "This person already has an overlapping shift."; }
      return;
    }

    try {
      await addDoc(collection(db, "stores", storeId, "Shifts"), {
        date,
        userId,
        userName: crewObj.name,
        role: crewObj.role,
        start,
        end,
        station,
        createdBy: sessionUser.id,
        createdAt: Date.now()
      });

      if (msg) { msg.style.color = "#15803d"; msg.textContent = "Shift created ✅"; }

      await loadShifts();
      renderSchedule();
    } catch (e) {
      console.error(e);
      if (msg) { msg.style.color = "#b91c1c"; msg.textContent = "Failed to create shift."; }
    }
  });

  // AI generate preview handler
  document.getElementById("aiGenerateBtn")?.addEventListener("click", () => {
    const msg = document.getElementById("aiMsg");

    const weekOffset = Number(document.getElementById("aiWeek")?.value || 0);
    const coreStart = document.getElementById("aiCoreStart")?.value;
    const coreEnd = document.getElementById("aiCoreEnd")?.value;
    const closeStart = document.getElementById("aiCloseStart")?.value;
    const closeEnd = document.getElementById("aiCloseEnd")?.value;

    if (!coreStart || !coreEnd || !closeStart || !closeEnd) {
      if (msg) { msg.style.color = "#b91c1c"; msg.textContent = "Set all start/end times."; }
      return;
    }

    const demandMap = {};
    document.querySelectorAll("select[data-forecast]").forEach((sel) => {
      demandMap[sel.dataset.forecast] = sel.value || "normal";
    });

    if (msg) { msg.style.color = "#6b7280"; msg.textContent = "Generating preview…"; }

    const result = generateAIWeekPreview({
      weekOffset,
      demandMap,
      coreStart,
      coreEnd,
      closeStart,
      closeEnd
    });

    if (msg) {
      msg.style.color = "#15803d";
      msg.textContent = `Preview created: ${result.created} shifts. Unfilled slots: ${result.unfilled.length}.`;
    }

    // switch the calendar to the same week we generated
    currentWeekOffset = weekOffset;
    renderWeekTabs();
    renderSchedule();
  });
}

/* ===================== PUBLISH PREVIEW ===================== */

async function publishPreviewToFirestore(overwriteWeek = false) {
  if (!aiPreviewActive || !aiPreviewShifts.length) return;

  const { start, end } = getWeekRange(currentWeekOffset, new Date());
  const weekStartISO = toISO(start);
  const weekEndISO = toISO(end);

  if (overwriteWeek) {
    // delete existing shifts in that week ONLY
    const toDelete = allShifts.filter((s) => s.date >= weekStartISO && s.date <= weekEndISO);
    for (const s of toDelete) {
      await deleteDoc(doc(db, "stores", storeId, "Shifts", s.id));
    }
  }

  for (const s of aiPreviewShifts) {
    await addDoc(collection(db, "stores", storeId, "Shifts"), {
      date: s.date,
      start: s.start,
      end: s.end,
      userId: s.userId,
      userName: s.userName,
      role: s.role || "crew",
      station: s.station || "",
      generatedByAI: true,
      demandLevel: s.demandLevel || "normal",
      createdBy: sessionUser.id,
      createdAt: Date.now()
    });
  }

  // clear preview + reload
  aiPreviewActive = false;
  aiPreviewShifts = [];
  await loadShifts();
  renderSchedule();
}

/* ===================== AUTH INIT ===================== */

onAuthStateChanged(auth, async (user) => {
  if (!user) return (location.href = "index.html");

  sessionUser = JSON.parse(localStorage.getItem("mc_session_user")) || {
    id: user.uid,
    name: user.displayName || user.email || "User",
    role: "shiftCreator",
    storeId: "store001"
  };

  storeId = sessionUser.storeId || "store001";

  // Sidebar labels
  if (sidebarUserName) sidebarUserName.textContent = sessionUser.name;
  if (sidebarUserRole) {
    sidebarUserRole.textContent =
      sessionUser.role === "shiftCreator" ? "Shift Creator" :
      sessionUser.role === "manager" ? "Restaurant Manager" :
      "Crew Member";
  }
  if (roleBadge) {
    roleBadge.textContent =
      sessionUser.role === "shiftCreator" ? "Shift Creator" :
      sessionUser.role === "manager" ? "Manager" :
      "Crew";
  }
  if (avatarCircle) avatarCircle.textContent = sessionUser.name.charAt(0).toUpperCase();

  if (scheduleTitle) {
    const isManagerLike = sessionUser.role === "manager" || sessionUser.role === "shiftCreator";
    scheduleTitle.textContent = isManagerLike ? "Store shifts" : "Your shifts";
  }
  if (scheduleSubtitle) {
    scheduleSubtitle.textContent =
      sessionUser.role === "shiftCreator"
        ? "Generate a schedule on the website (preview), then publish."
        : "View your shifts.";
  }

  await loadCrew();
  await loadShifts();

  renderWeekTabs();
  renderShiftManageTools();
  renderSchedule();
});

/* ===================== LOGOUT ===================== */

logoutBtn?.addEventListener("click", async () => {
  await signOut(auth);
  localStorage.clear();
  location.href = "index.html";
});

/* ===================== SIDEBAR TOGGLE (MOBILE) ===================== */

if (sidebar && sidebarToggle) {
  sidebarToggle.addEventListener("click", () => {
    sidebar.classList.toggle("sidebar-open");
  });
}
