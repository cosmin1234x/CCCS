// schedule.js – Weekly shifts view (crew & manager)

import { auth, db } from "./firebase-init.js";
import {
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  collection,
  getDocs,
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* ========= DOM ELEMENTS ========= */

const sidebarUserName = document.getElementById("sidebarUserName");
const sidebarUserRole = document.getElementById("sidebarUserRole");
const avatarCircle = document.getElementById("avatarCircle");
const roleBadge = document.getElementById("roleBadge");
const logoutBtn = document.getElementById("logoutBtn");

const scheduleTitle = document.getElementById("scheduleTitle");
const scheduleSubtitle = document.getElementById("scheduleSubtitle");
const scheduleCard = document.getElementById("scheduleCard");
const weekTabs = document.getElementById("weekTabs");

// Sidebar toggle (mobile)
const sidebar = document.querySelector(".sidebar");
const sidebarToggle = document.getElementById("sidebarToggle");

/* ========= SESSION ========= */

let sessionUser = null;

function loadSessionUser() {
  try {
    return JSON.parse(localStorage.getItem("mc_session_user"));
  } catch {
    return null;
  }
}

/* ========= SHIFTS DATA ========= */

let allShifts = [];
let currentWeekOffset = 0; // 0 = this week, 1 = next week

/* ========= DATE HELPERS ========= */

function toISODateString(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0 (Sun) - 6 (Sat)
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

/* ========= FIRESTORE LOAD ========= */

async function loadStoreName(storeId) {
  try {
    const ref = doc(db, "stores", storeId);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const d = snap.data();
      return d.storeName || "Your restaurant";
    }
  } catch (err) {
    console.error("[Schedule] loadStoreName error:", err);
  }
  return "Your restaurant";
}

async function loadShiftsFromFirestore(storeId) {
  allShifts = [];
  try {
    const col = collection(db, "stores", storeId, "shifts");
    const snap = await getDocs(col);
    snap.forEach((docSnap) => {
      const d = docSnap.data();
      if (!d.date || !d.start || !d.end || !d.userId) return;
      allShifts.push({
        id: docSnap.id,
        date: d.date, // "YYYY-MM-DD"
        start: d.start,
        end: d.end,
        userId: d.userId,
        userName: d.userName || "Unknown",
        role: d.role || "crew",
        station: d.station || "",
        isShiftManager: !!d.isShiftManager
      });
    });
  } catch (err) {
    console.error("[Schedule] Error loading shifts:", err);
  }
}

/* ========= AUTH / INIT ========= */

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

  const isManager = sessionUser.role === "manager";
  const storeId = sessionUser.storeId || "store001";

  // Sidebar
  if (sidebarUserName) sidebarUserName.textContent = sessionUser.name;
  if (sidebarUserRole) {
    sidebarUserRole.textContent = isManager ? "Restaurant Manager" : "Crew Member";
  }
  if (roleBadge) roleBadge.textContent = isManager ? "Manager" : "Crew";
  if (avatarCircle) {
    avatarCircle.textContent = sessionUser.name.charAt(0).toUpperCase();
  }

  // Titles
  if (scheduleTitle) {
    scheduleTitle.textContent = isManager
      ? "Store shifts"
      : "Your shifts";
  }
  if (scheduleSubtitle) {
    const storeName = await loadStoreName(storeId);
    scheduleSubtitle.textContent = isManager
      ? `View your shifts and, when you're shift manager, see who is working at ${storeName}.`
      : "See your shifts for this week and upcoming weeks.";
  }

  // Load shifts for store
  await loadShiftsFromFirestore(storeId);

  // Render initial week (this week)
  renderSchedule(isManager);
  setupWeekTabs(isManager);
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

function renderSchedule(isManager) {
  if (!scheduleCard || !sessionUser) return;

  const { start, end } = getWeekRange(currentWeekOffset, new Date());
  const weekStartStr = toISODateString(start);
  const weekEndStr = toISODateString(end);

  const shiftsInWeek = allShifts.filter(
    (s) => s.date >= weekStartStr && s.date <= weekEndStr
  );

  const myShiftsInWeek = shiftsInWeek.filter(
    (s) => s.userId === sessionUser.id
  );

  // Determine message about schedule being posted or not
  let scheduleMsg = "";
  if (shiftsInWeek.length === 0) {
    scheduleMsg = "Schedule not posted yet for this week.";
  } else if (!isManager && myShiftsInWeek.length === 0) {
    scheduleMsg = "You have no shifts this week.";
  } else {
    scheduleMsg = "";
  }

  // Build days array
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(d);
  }

  // Build HTML
  let html = `
    <div class="subsection-title">
      ${currentWeekOffset === 0 ? "This week" : "Next week"}
    </div>
    <div class="subsection-sub">
      ${formatWeekLabel(start, end)}
    </div>
  `;

  if (scheduleMsg) {
    html += `
      <p style="margin-top:6px;font-size:0.8rem;color:#b91c1c;">
        ${scheduleMsg}
      </p>
    `;
  }

  html += `<div style="margin-top:8px; display:flex; flex-wrap:wrap; gap:10px;">`;

  days.forEach((d) => {
    const dayISO = toISODateString(d);
    const label = formatDayLabel(d);

    // All shifts for this day (store-level)
    const dayShifts = shiftsInWeek.filter((s) => s.date === dayISO);

    // My shifts this day
    const myShifts = dayShifts.filter((s) => s.userId === sessionUser.id);

    let isShiftManagerToday = false;
    if (isManager) {
      isShiftManagerToday = dayShifts.some(
        (s) => s.userId === sessionUser.id && s.isShiftManager
      );
    }

    // Decide what to show for this day
    let dayContent = "";

    if (!dayShifts.length) {
      dayContent = `<li><span>No shifts posted.</span></li>`;
    } else if (!isManager) {
      // Crew view: only show own shift(s)
      if (!myShifts.length) {
        dayContent = `<li><span>No shift for you.</span></li>`;
      } else {
        dayContent = myShifts
          .map(
            (s) => `
            <li>
              <span>${s.start}–${s.end}</span>
              <span class="badge-soft">${s.station || "Shift"}</span>
            </li>
          `
          )
          .join("");
      }
    } else {
      // Manager view
      const myMain = myShifts
        .map(
          (s) => `
          <li>
            <span>${s.start}–${s.end}</span>
            <span class="badge-soft-warn">
              ${s.isShiftManager ? "Shift manager" : "Manager"}
            </span>
          </li>
        `
        )
        .join("");

      let othersBlock = "";

      if (isShiftManagerToday) {
        const others = dayShifts.filter((s) => s.userId !== sessionUser.id);
        if (others.length) {
          const crewLines = others
            .map(
              (s) => `
              <li>
                <span>${s.userName}</span>
                <span class="badge-soft">
                  ${s.start}–${s.end} ${s.station ? "· " + s.station : ""}
                </span>
              </li>
            `
            )
            .join("");

          othersBlock = `
            <li style="margin-top:4px;border-top:1px dashed #e5e7eb;padding-top:4px;">
              <span style="font-size:0.75rem;color:#6b7280;">Crew on this shift:</span>
            </li>
            ${crewLines}
          `;
        }
      }

      if (!myMain && !othersBlock) {
        dayContent = `<li><span>No shift for you.</span></li>`;
      } else {
        dayContent = myMain + othersBlock;
      }
    }

    html += `
      <div class="card" style="flex:1 1 180px; min-width:180px;">
        <div class="card-header">
          <div class="card-title">${label}</div>
          <div class="card-icon">📅</div>
        </div>
        <ul class="list">
          ${dayContent}
        </ul>
      </div>
    `;
  });

  html += `</div>`;

  scheduleCard.innerHTML = html;
}

function formatWeekLabel(start, end) {
  const months = [
    "Jan","Feb","Mar","Apr","May","Jun",
    "Jul","Aug","Sep","Oct","Nov","Dec"
  ];
  const startLabel = `${start.getDate()} ${months[start.getMonth()]}`;
  const endLabel = `${end.getDate()} ${months[end.getMonth()]}`;
  return `${startLabel} – ${endLabel}`;
}

/* ========= WEEK TABS ========= */

function setupWeekTabs(isManager) {
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

    renderSchedule(isManager);
  });
}

/* ========= SIDEBAR MOBILE TOGGLE ========= */

if (sidebar && sidebarToggle) {
  sidebarToggle.addEventListener("click", () => {
    sidebar.classList.toggle("sidebar-open");
  });
}
