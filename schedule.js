// schedule.js – Option 2: AI-ish shift generator (Forecast + Availability + Skills + Max Hours)
// Uses Firestore: stores/{storeId}/Shifts (capital S) like your existing project.

import { auth, db } from "./firebase-init.js";
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  collection,
  getDocs,
  doc,
  getDoc,
  addDoc,
  query,
  where,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* ========= DOM ========= */

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

/* ========= SESSION ========= */

let sessionUser = null;
let currentStoreId = "store001";

function loadSessionUser() {
  try {
    return JSON.parse(localStorage.getItem("mc_session_user"));
  } catch {
    return null;
  }
}

/* ========= DATA ========= */

let allShifts = [];
let storeCrew = []; // {id,name,role,skills,availability,maxHoursPerWeek}
let currentWeekOffset = 0;

/* ========= DATE HELPERS ========= */

function toISODateString(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
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

function formatDayLabel(d) {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${days[d.getDay()]} ${d.getDate()}`;
}

function formatWeekLabel(start, end) {
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const s = `${start.getDate()} ${months[start.getMonth()]}`;
  const e = `${end.getDate()} ${months[end.getMonth()]}`;
  return `${s} – ${e}`;
}

function dayKeyFromDate(dateObj) {
  const map = ["sun","mon","tue","wed","thu","fri","sat"];
  return map[dateObj.getDay()];
}

function hhmmToMinutes(h) {
  const [hh, mm] = (h || "00:00").split(":").map(Number);
  return hh * 60 + mm;
}

function minutesToHHMM(m) {
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
}

function shiftHours(startHHMM, endHHMM) {
  let s = hhmmToMinutes(startHHMM);
  let e = hhmmToMinutes(endHHMM);
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

/* ========= FIRESTORE LOAD ========= */

async function loadStoreName(storeId) {
  try {
    const ref = doc(db, "stores", storeId);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const d = snap.data();
      return d.storeName || d.name || "Your restaurant";
    }
  } catch (err) {
    console.error("[Schedule] loadStoreName error:", err);
  }
  return "Your restaurant";
}

async function loadShiftsFromFirestore(storeId) {
  allShifts = [];
  try {
    const col = collection(db, "stores", storeId, "Shifts"); // keep your existing
    const snap = await getDocs(col);
    snap.forEach((docSnap) => {
      const d = docSnap.data();
      if (!d.date || !d.start || !d.end || !d.userId) return;
      allShifts.push({
        id: docSnap.id,
        date: d.date,
        start: d.start,
        end: d.end,
        userId: d.userId,
        userName: d.userName || "Unknown",
        role: d.role || "crew",
        station: d.station || "",
        isShiftManager: !!d.isShiftManager,
        generatedByAI: !!d.generatedByAI
      });
    });
  } catch (err) {
    console.error("[Schedule] Error loading shifts:", err);
  }
}

function normalizeUser(d, id) {
  const name = d.name || d.email || "Crew member";
  const role = d.role || "crew";

  const skills = typeof d.skills === "object" && d.skills ? d.skills : {};
  const availability = typeof d.availability === "object" && d.availability ? d.availability : {};
  const maxHoursPerWeek = typeof d.maxHoursPerWeek === "number" ? d.maxHoursPerWeek : 40;

  return { id, name, role, skills, availability, maxHoursPerWeek };
}

async function loadCrewForStore(storeId) {
  storeCrew = [];
  try {
    const qCrew = query(collection(db, "users"), where("storeId", "==", storeId));
    const snap = await getDocs(qCrew);
    snap.forEach((docSnap) => {
      storeCrew.push(normalizeUser(docSnap.data(), docSnap.id));
    });
  } catch (err) {
    console.error("[Schedule] Error loading crew list:", err);
  }
}

/* ========= AUTH ========= */

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  sessionUser =
    loadSessionUser() || {
      id: user.uid,
      role: "crew",
      name: user.displayName || user.email || "User",
      storeId: "store001"
    };

  currentStoreId = sessionUser.storeId || "store001";

  const role = sessionUser.role;
  const isManagerLike = role === "manager" || role === "shiftCreator";
  const canManageShifts = role === "shiftCreator";

  // Sidebar labels
  if (sidebarUserName) sidebarUserName.textContent = sessionUser.name;
  if (sidebarUserRole) {
    sidebarUserRole.textContent =
      role === "shiftCreator" ? "Shift Creator" :
      role === "manager" ? "Restaurant Manager" :
      "Crew Member";
  }
  if (roleBadge) {
    roleBadge.textContent =
      role === "shiftCreator" ? "Shift Creator" :
      role === "manager" ? "Manager" :
      "Crew";
  }
  if (avatarCircle) avatarCircle.textContent = sessionUser.name.charAt(0).toUpperCase();

  // Titles
  if (scheduleTitle) scheduleTitle.textContent = isManagerLike ? "Store shifts" : "Your shifts";

  if (scheduleSubtitle) {
    const storeName = await loadStoreName(currentStoreId);
    scheduleSubtitle.textContent = isManagerLike
      ? `View shifts at ${storeName}. Shift Creators can generate schedules.`
      : "See your shifts for this week and upcoming weeks.";
  }

  await loadShiftsFromFirestore(currentStoreId);
  await loadCrewForStore(currentStoreId);

  renderSchedule(isManagerLike, canManageShifts);
  setupWeekTabs(isManagerLike, canManageShifts);
  renderShiftManageTools(canManageShifts, currentStoreId);
});

/* Logout */

if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    await signOut(auth);
    localStorage.removeItem("mc_session_user");
    window.location.href = "index.html";
  });
}

/* ========= RENDER SCHEDULE ========= */

function renderSchedule(isManagerLike, canManageShifts) {
  if (!scheduleCard || !sessionUser) return;

  const { start, end } = getWeekRange(currentWeekOffset, new Date());
  const weekStartStr = toISODateString(start);
  const weekEndStr = toISODateString(end);

  const shiftsInWeek = allShifts.filter((s) => s.date >= weekStartStr && s.date <= weekEndStr);
  const myShiftsInWeek = shiftsInWeek.filter((s) => s.userId === sessionUser.id);

  let scheduleMsg = "";
  if (shiftsInWeek.length === 0) {
    scheduleMsg = "Schedule not posted yet for this week.";
  } else if (!isManagerLike && myShiftsInWeek.length === 0) {
    scheduleMsg = "You have no shifts this week.";
  }

  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(d);
  }

  let html = `
    <div class="subsection-title">${currentWeekOffset === 0 ? "This week" : "Next week"}</div>
    <div class="subsection-sub">${formatWeekLabel(start, end)}</div>
  `;

  if (scheduleMsg) {
    html += `<p style="margin-top:6px;font-size:0.8rem;color:#b91c1c;">${scheduleMsg}</p>`;
  }

  html += `<div style="margin-top:8px; display:flex; flex-wrap:wrap; gap:10px;">`;

  days.forEach((d) => {
    const dayISO = toISODateString(d);
    const label = formatDayLabel(d);

    const dayShifts = shiftsInWeek.filter((s) => s.date === dayISO);
    const myShifts = dayShifts.filter((s) => s.userId === sessionUser.id);

    let isShiftManagerToday = false;
    if (isManagerLike) {
      isShiftManagerToday = dayShifts.some((s) => s.userId === sessionUser.id && s.isShiftManager);
    }

    let dayContent = "";

    if (!dayShifts.length) {
      dayContent = `<li><span>No shifts posted.</span></li>`;
    } else if (!isManagerLike) {
      if (!myShifts.length) {
        dayContent = `<li><span>No shift for you.</span></li>`;
      } else {
        dayContent = myShifts
          .map((s) => `
            <li style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
              <span>${s.start}–${s.end}</span>
              <span class="badge-soft">${s.station || "Shift"}</span>
            </li>
          `)
          .join("");
      }
    } else {
      // Manager-like view
      const myMain = myShifts
        .map((s) => `
          <li style="display:flex;align-items:center;justify-content:space-between;gap:6px;" data-shift-id="${s.id}">
            <div>
              <span>${s.start}–${s.end}</span>
              <span class="badge-soft-warn" style="margin-left:6px;">
                ${s.isShiftManager ? "Shift manager" : "Manager"}
              </span>
              ${s.generatedByAI ? `<span class="badge-soft" style="margin-left:6px;">AI</span>` : ``}
            </div>
            ${
              canManageShifts
                ? `<button class="shift-delete-btn" data-id="${s.id}" title="Delete shift"
                    style="border:none;background:transparent;font-size:0.8rem;cursor:pointer;color:#9ca3af;">✕</button>`
                : ""
            }
          </li>
        `)
        .join("");

      let othersBlock = "";

      // If shift manager today, show crew
      if (isShiftManagerToday || canManageShifts) {
        const others = dayShifts.filter((s) => s.userId !== sessionUser.id);
        if (others.length) {
          const crewLines = others
            .map((s) => `
              <li style="display:flex;align-items:center;justify-content:space-between;gap:6px;" data-shift-id="${s.id}">
                <div style="display:flex;flex-direction:column;">
                  <span style="font-weight:600;">${s.userName}</span>
                  <span style="font-size:0.75rem;color:#4b5563;">
                    ${s.start}–${s.end}${s.station ? " · " + s.station : ""}${s.generatedByAI ? " · AI" : ""}
                  </span>
                </div>
                ${
                  canManageShifts
                    ? `<button class="shift-delete-btn" data-id="${s.id}" title="Delete shift"
                        style="border:none;background:transparent;font-size:0.8rem;cursor:pointer;color:#9ca3af;">✕</button>`
                    : ""
                }
              </li>
            `)
            .join("");

          othersBlock = `
            <li style="margin-top:4px;border-top:1px dashed #e5e7eb;padding-top:4px;">
              <span style="font-size:0.75rem;color:#6b7280;">Crew assigned:</span>
            </li>
            ${crewLines}
          `;
        }
      }

      dayContent = (myMain || "") + (othersBlock || "");
      if (!dayContent.trim()) dayContent = `<li><span>No shifts.</span></li>`;
    }

    html += `
      <div class="card" style="flex:1 1 180px; min-width:180px;">
        <div class="card-header">
          <div class="card-title">${label}</div>
          <div class="card-icon">📅</div>
        </div>
        <ul class="list">${dayContent}</ul>
      </div>
    `;
  });

  html += `</div>`;
  scheduleCard.innerHTML = html;

  attachDeleteHandlers(canManageShifts);
}

/* ========= DELETE ========= */

function attachDeleteHandlers(canManageShifts) {
  if (!canManageShifts || !currentStoreId || !scheduleCard) return;

  const buttons = scheduleCard.querySelectorAll(".shift-delete-btn");
  buttons.forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      if (!id) return;
      if (!confirm("Delete this shift?")) return;

      try {
        await deleteDoc(doc(db, "stores", currentStoreId, "Shifts", id));
        await loadShiftsFromFirestore(currentStoreId);
        renderSchedule(true, true);
        renderShiftManageTools(true, currentStoreId);
      } catch (err) {
        console.error("[Schedule] delete shift error:", err);
        alert("Failed to delete shift.");
      }
    });
  });
}

/* ============================================================
   AI SHIFT GENERATION (Option 2)
   - Uses forecast + availability + maxHours + skills
============================================================ */

function getStationPlanForDemand(demand, dayPart) {
  // You can tweak this to match your store perfectly.
  // dayPart: "core" or "close"
  const low = {
    core:   ["front","fries","line","grill"],
    close:  ["front","line","grill"]
  };
  const normal = {
    core:   ["front","drive","fries","line","line","grill","chicken"],
    close:  ["front","drive","line","grill","chicken"]
  };
  const high = {
    core:   ["front","front","drive","fries","line","line","grill","chicken","floater"],
    close:  ["front","drive","fries","line","grill","chicken"]
  };

  const map = demand === "high" ? high : demand === "low" ? low : normal;
  return map[dayPart] || map.core;
}

function canUserWorkBlock(userObj, dayKey, start, end) {
  const windows = Array.isArray(userObj.availability?.[dayKey]) ? userObj.availability[dayKey] : [];
  if (windows.length === 0) return false;

  const s = hhmmToMinutes(start);
  let e = hhmmToMinutes(end);
  if (e < s) e += 24 * 60;

  return windows.some((w) => {
    const ws = hhmmToMinutes(w.start);
    let we = hhmmToMinutes(w.end);
    if (we < ws) we += 24 * 60;
    return ws <= s && we >= e;
  });
}

function userHasSkill(userObj, station) {
  if (station === "floater") return true;
  return !!userObj.skills?.[station];
}

function userHasClash(userId, dateISO, start, end) {
  const sameDay = allShifts.filter((s) => s.userId === userId && s.date === dateISO);
  return sameDay.some((s) => overlaps(s.start, s.end, start, end));
}

function computeAssignedHoursThisWeek(userId, weekStartISO, weekEndISO, extraPlanned = []) {
  let hrs = 0;

  // existing shifts
  allShifts.forEach((s) => {
    if (s.userId !== userId) return;
    if (s.date < weekStartISO || s.date > weekEndISO) return;
    hrs += shiftHours(s.start, s.end);
  });

  // planned new shifts (not yet saved)
  extraPlanned.forEach((p) => {
    if (p.userId !== userId) return;
    if (p.date < weekStartISO || p.date > weekEndISO) return;
    hrs += shiftHours(p.start, p.end);
  });

  return hrs;
}

/* ========= MANAGER TOOLS (Shift Creator only) ========= */

function renderShiftManageTools(canManageShifts, storeId) {
  if (!shiftManageCard) return;

  if (!canManageShifts) {
    shiftManageCard.style.display = "none";
    shiftManageCard.innerHTML = "";
    return;
  }

  shiftManageCard.style.display = "block";

  shiftManageCard.innerHTML = `
    <div class="subsection-title">Manage shifts</div>
    <div class="subsection-sub">
      Create a one-off shift OR generate a full week using forecast + availability + skills.
    </div>

    <div style="display:flex; flex-wrap:wrap; gap:12px; margin-top:8px;">

      <!-- Manual creation -->
      <div style="flex:1 1 260px; min-width:260px;">
        <h4 style="font-size:0.8rem; font-weight:700; margin-bottom:4px;">Create shift</h4>
        <div style="display:flex; flex-direction:column; gap:6px; font-size:0.8rem;">
          <label>Date
            <input type="date" id="shiftDateInput" style="width:100%; padding:6px 8px; border-radius:10px; border:1px solid #e5e7eb;" />
          </label>
          <label>Crew / manager
            <select id="shiftUserSelect" style="width:100%; padding:6px 8px; border-radius:10px; border:1px solid #e5e7eb;"></select>
          </label>
          <div style="display:flex; gap:6px;">
            <label style="flex:1;">Start
              <input type="time" id="shiftStartInput" style="width:100%; padding:6px 8px; border-radius:10px; border:1px solid #e5e7eb;" />
            </label>
            <label style="flex:1;">End
              <input type="time" id="shiftEndInput" style="width:100%; padding:6px 8px; border-radius:10px; border:1px solid #e5e7eb;" />
            </label>
          </div>
          <label>Station (optional)
            <input type="text" id="shiftStationInput" placeholder="Grill, Chicken, Front…" style="width:100%; padding:6px 8px; border-radius:10px; border:1px solid #e5e7eb;" />
          </label>
          <label style="display:flex; align-items:center; gap:6px; margin-top:2px;">
            <input type="checkbox" id="shiftIsManagerCheckbox" />
            <span>Shift manager for this day</span>
          </label>
          <button id="createShiftBtn" class="btn" type="button" style="margin-top:4px; width:100%; justify-content:center;">
            ➕ Create shift
          </button>
          <div id="shiftManageMessage" style="font-size:0.75rem; margin-top:4px;"></div>
        </div>
      </div>

      <!-- AI generator -->
      <div style="flex:1 1 320px; min-width:320px;">
        <h4 style="font-size:0.8rem; font-weight:700; margin-bottom:4px;">AI generate week</h4>
        <div style="display:flex; flex-direction:column; gap:8px; font-size:0.8rem;">

          <label>Week
            <select id="aiWeekSelect" style="width:100%; padding:6px 8px; border-radius:10px; border:1px solid #e5e7eb;">
              <option value="0">This week</option>
              <option value="1">Next week</option>
            </select>
          </label>

          <div style="display:flex; gap:6px;">
            <label style="flex:1;">Core block start
              <input type="time" id="aiCoreStart" value="16:00" style="width:100%; padding:6px 8px; border-radius:10px; border:1px solid #e5e7eb;" />
            </label>
            <label style="flex:1;">Core block end
              <input type="time" id="aiCoreEnd" value="20:00" style="width:100%; padding:6px 8px; border-radius:10px; border:1px solid #e5e7eb;" />
            </label>
          </div>

          <div style="display:flex; gap:6px;">
            <label style="flex:1;">Close block start
              <input type="time" id="aiCloseStart" value="20:00" style="width:100%; padding:6px 8px; border-radius:10px; border:1px solid #e5e7eb;" />
            </label>
            <label style="flex:1;">Close block end
              <input type="time" id="aiCloseEnd" value="23:00" style="width:100%; padding:6px 8px; border-radius:10px; border:1px solid #e5e7eb;" />
            </label>
          </div>

          <div style="border:1px solid #e5e7eb; border-radius:12px; padding:8px; background:#f9fafb;">
            <div style="font-size:0.75rem; color:#6b7280; margin-bottom:6px;">
              Forecast per day (controls staffing plan)
            </div>
            <div id="aiDemandGrid" style="display:grid; grid-template-columns:repeat(2,1fr); gap:6px;"></div>
          </div>

          <label style="display:flex; align-items:center; gap:8px;">
            <input type="checkbox" id="aiOverwriteExisting" />
            <span>Overwrite existing shifts in that week (delete + regenerate)</span>
          </label>

          <button id="aiGenerateBtn" class="btn" type="button" style="width:100%; justify-content:center;">
            ⚙️ Generate shifts (skills + availability)
          </button>

          <div id="aiGenMsg" style="font-size:0.75rem;"></div>
        </div>
      </div>

    </div>
  `;

  // populate crew select
  const userSelect = document.getElementById("shiftUserSelect");
  if (userSelect) {
    userSelect.innerHTML = "";
    storeCrew.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = `${c.name} (${c.role})`;
      userSelect.appendChild(opt);
    });
  }

  // Build forecast grid
  const aiDemandGrid = document.getElementById("aiDemandGrid");
  const demandDays = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
  const demandKeys = ["mon","tue","wed","thu","fri","sat","sun"];

  if (aiDemandGrid) {
    aiDemandGrid.innerHTML = demandDays
      .map((d, idx) => `
        <label style="display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:0.75rem;">
          <span>${d}</span>
          <select data-daykey="${demandKeys[idx]}" style="flex:1; padding:6px 8px; border-radius:10px; border:1px solid #e5e7eb;">
            <option value="low">Low</option>
            <option value="normal" selected>Normal</option>
            <option value="high">High</option>
          </select>
        </label>
      `)
      .join("");
  }

  // Manual create wiring
  const createShiftBtn = document.getElementById("createShiftBtn");
  const shiftDateInput = document.getElementById("shiftDateInput");
  const shiftStartInput = document.getElementById("shiftStartInput");
  const shiftEndInput = document.getElementById("shiftEndInput");
  const shiftStationInput = document.getElementById("shiftStationInput");
  const shiftIsManagerCheckbox = document.getElementById("shiftIsManagerCheckbox");
  const shiftManageMessage = document.getElementById("shiftManageMessage");

  if (createShiftBtn) {
    createShiftBtn.addEventListener("click", async () => {
      const date = shiftDateInput.value;
      const start = shiftStartInput.value;
      const end = shiftEndInput.value;
      const userId = userSelect.value;
      const station = (shiftStationInput.value || "").trim();
      const isShiftManager = shiftIsManagerCheckbox.checked;

      const crewObj = storeCrew.find((c) => c.id === userId);
      if (!date || !start || !end || !crewObj) {
        shiftManageMessage.style.color = "#b91c1c";
        shiftManageMessage.textContent = "Fill date, times and crew.";
        return;
      }

      const clash = allShifts.some((s) => s.userId === userId && s.date === date && overlaps(s.start, s.end, start, end));
      if (clash) {
        shiftManageMessage.style.color = "#b91c1c";
        shiftManageMessage.textContent = "This person already has a shift that overlaps.";
        return;
      }

      try {
        await addDoc(collection(db, "stores", storeId, "Shifts"), {
          date,
          start,
          end,
          userId,
          userName: crewObj.name,
          role: crewObj.role,
          station,
          isShiftManager
        });

        shiftManageMessage.style.color = "#15803d";
        shiftManageMessage.textContent = "Shift created.";

        await loadShiftsFromFirestore(storeId);
        renderSchedule(true, true);
      } catch (err) {
        console.error("[Schedule] create shift error:", err);
        shiftManageMessage.style.color = "#b91c1c";
        shiftManageMessage.textContent = "Failed to create shift.";
      }
    });
  }

  // AI generate wiring
  const aiGenerateBtn = document.getElementById("aiGenerateBtn");
  const aiGenMsg = document.getElementById("aiGenMsg");

  if (aiGenerateBtn) {
    aiGenerateBtn.addEventListener("click", async () => {
      const aiWeekSelect = document.getElementById("aiWeekSelect");
      const aiCoreStart = document.getElementById("aiCoreStart");
      const aiCoreEnd = document.getElementById("aiCoreEnd");
      const aiCloseStart = document.getElementById("aiCloseStart");
      const aiCloseEnd = document.getElementById("aiCloseEnd");
      const aiOverwriteExisting = document.getElementById("aiOverwriteExisting");

      const weekOffset = parseInt(aiWeekSelect.value, 10) || 0;
      const coreStart = aiCoreStart.value;
      const coreEnd = aiCoreEnd.value;
      const closeStart = aiCloseStart.value;
      const closeEnd = aiCloseEnd.value;
      const overwrite = !!aiOverwriteExisting.checked;

      if (!coreStart || !coreEnd || !closeStart || !closeEnd) {
        aiGenMsg.style.color = "#b91c1c";
        aiGenMsg.textContent = "Set both blocks (start/end).";
        return;
      }

      // demand map
      const demandMap = {};
      aiDemandGrid.querySelectorAll("select[data-daykey]").forEach((sel) => {
        demandMap[sel.dataset.daykey] = sel.value || "normal";
      });

      try {
        aiGenMsg.style.color = "#6b7280";
        aiGenMsg.textContent = "Generating…";

        const { start, end } = getWeekRange(weekOffset, new Date());
        const weekStartISO = toISODateString(start);
        const weekEndISO = toISODateString(end);

        // Optional overwrite: delete shifts in that week
        if (overwrite) {
          const inWeek = allShifts.filter((s) => s.date >= weekStartISO && s.date <= weekEndISO);
          for (const s of inWeek) {
            await deleteDoc(doc(db, "stores", storeId, "Shifts", s.id));
          }
          await loadShiftsFromFirestore(storeId);
        }

        const planned = [];
        const days = [];
        for (let i = 0; i < 7; i++) {
          const d = new Date(start);
          d.setDate(start.getDate() + i);
          days.push(d);
        }

        // We only assign CREW users (you can include managers too if you want)
        const eligibleCrew = storeCrew.filter((c) => c.role === "crew");

        // A little fairness: track planned hours
        const plannedHours = new Map();

        function getPlannedHours(uid) {
          return plannedHours.get(uid) || 0;
        }
        function addPlannedHours(uid, hrs) {
          plannedHours.set(uid, getPlannedHours(uid) + hrs);
        }

        // Assign by day, by block, by required station
        for (const dayDate of days) {
          const dateISO = toISODateString(dayDate);
          const dk = dayKeyFromDate(dayDate);
          const demand = demandMap[dk] || "normal";

          for (const part of ["core", "close"]) {
            const blockStart = part === "core" ? coreStart : closeStart;
            const blockEnd = part === "core" ? coreEnd : closeEnd;

            const requiredStations = getStationPlanForDemand(demand, part);

            for (const station of requiredStations) {
              // pick best candidate
              const candidates = eligibleCrew
                .filter((c) => userHasSkill(c, station))
                .filter((c) => canUserWorkBlock(c, dk, blockStart, blockEnd))
                .filter((c) => !userHasClash(c.id, dateISO, blockStart, blockEnd))
                .sort((a, b) => {
                  // fewer planned hours first, then name
                  const ah = getPlannedHours(a.id);
                  const bh = getPlannedHours(b.id);
                  if (ah !== bh) return ah - bh;
                  return a.name.localeCompare(b.name);
                });

              let chosen = null;

              for (const c of candidates) {
                const { start: wS, end: wE } = getWeekRange(weekOffset, new Date());
                const wsISO = toISODateString(wS);
                const weISO = toISODateString(wE);

                const already = computeAssignedHoursThisWeek(c.id, wsISO, weISO, planned);
                const maxH = typeof c.maxHoursPerWeek === "number" ? c.maxHoursPerWeek : 40;
                const addH = shiftHours(blockStart, blockEnd);

                if (already + addH <= maxH + 0.01) {
                  chosen = c;
                  break;
                }
              }

              if (!chosen) {
                // Couldn't fill this station; skip but keep going
                planned.push({
                  _unfilled: true,
                  date: dateISO,
                  start: blockStart,
                  end: blockEnd,
                  station
                });
                continue;
              }

              // Create planned shift
              planned.push({
                date: dateISO,
                start: blockStart,
                end: blockEnd,
                userId: chosen.id,
                userName: chosen.name,
                role: chosen.role,
                station: station === "floater" ? "Floater" : station[0].toUpperCase() + station.slice(1),
                isShiftManager: false,
                generatedByAI: true,
                demandLevel: demand
              });

              addPlannedHours(chosen.id, shiftHours(blockStart, blockEnd));
            }
          }
        }

        // Write planned shifts to Firestore (skip unfilled)
        let created = 0;
        let unfilled = 0;

        for (const p of planned) {
          if (p._unfilled) { unfilled++; continue; }

          // Final clash check against fresh allShifts + planned (safe)
          const clashExisting = allShifts.some((s) =>
            s.userId === p.userId && s.date === p.date && overlaps(s.start, s.end, p.start, p.end)
          );
          if (clashExisting) continue;

          await addDoc(collection(db, "stores", storeId, "Shifts"), {
            date: p.date,
            start: p.start,
            end: p.end,
            userId: p.userId,
            userName: p.userName,
            role: p.role,
            station: p.station,
            isShiftManager: !!p.isShiftManager,
            generatedByAI: true,
            demandLevel: p.demandLevel || "normal",
            createdBy: sessionUser.id,
            createdAt: Date.now()
          });

          created++;
        }

        await loadShiftsFromFirestore(storeId);
        renderSchedule(true, true);

        aiGenMsg.style.color = "#15803d";
        aiGenMsg.textContent = `Generated ${created} shifts. Unfilled slots: ${unfilled}. (Add more availability/skills to fill everything.)`;
      } catch (err) {
        console.error("[AI Gen] error:", err);
        aiGenMsg.style.color = "#b91c1c";
        aiGenMsg.textContent = "Failed to generate shifts. Check console logs.";
      }
    });
  }
}

/* ========= WEEK TABS ========= */

function setupWeekTabs(isManagerLike, canManageShifts) {
  if (!weekTabs) return;

  weekTabs.addEventListener("click", (e) => {
    const btn = e.target.closest(".pill-filter");
    if (!btn) return;

    const offset = parseInt(btn.dataset.weekOffset, 10);
    if (isNaN(offset)) return;

    currentWeekOffset = offset;

    weekTabs.querySelectorAll(".pill-filter").forEach((b) => {
      b.classList.toggle("active", b === btn);
    });

    renderSchedule(isManagerLike, canManageShifts);
  });
}

/* ========= SIDEBAR MOBILE ========= */

if (sidebar && sidebarToggle) {
  sidebarToggle.addEventListener("click", () => {
    sidebar.classList.toggle("sidebar-open");
  });
}
