// ================================
// schedule.js – Shifts page
// Uses the SAME Firestore shifts as main.js
// ================================

import { auth, db } from "./firebase-init.js";
import {
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  collection,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* ============================================================
   SESSION
============================================================ */

let sessionUser = null;

function loadSessionUser() {
  try {
    return JSON.parse(localStorage.getItem("mc_session_user"));
  } catch {
    return null;
  }
}

/* ============================================================
   DOM
============================================================ */

const sidebarUserName = document.getElementById("sidebarUserName");
const sidebarUserRole = document.getElementById("sidebarUserRole");
const logoutBtn = document.getElementById("logoutBtn");

const weekThisBtn = document.getElementById("weekThisBtn");
const weekNextBtn = document.getElementById("weekNextBtn");
const weekTitle = document.getElementById("weekTitle");
const weekRangeLabel = document.getElementById("weekRangeLabel");
const weekStatusText = document.getElementById("weekStatusText");
const weekDaysContainer = document.getElementById("weekDaysContainer");

let currentWeekOffset = 0; // 0 = this week, 1 = next week

/* ============================================================
   DATE HELPERS (same as main.js)
============================================================ */

function toISODateString(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0–6
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getWeekRange(offset = 0, base = new Date()) {
  const monday = getMonday(base);
  const start = new Date(monday);
  start.setDate(start.getDate() + offset * 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start, end };
}

function parseShiftHours(startHHMM, endHHMM) {
  if (!startHHMM || !endHHMM) return 0;
  const [sh, sm] = startHHMM.split(":").map(Number);
  const [eh, em] = endHHMM.split(":").map(Number);

  let start = sh + sm / 60;
  let end = eh + em / 60;
  if (end < start) end += 24; // crossing midnight
  return end - start;
}

/* ============================================================
   UK BREAK RULES – same as dashboard
============================================================ */

function calculateBreakMinutes(hours) {
  if (hours <= 0) return 0;
  if (hours < 5) return 15;
  if (hours < 8) return 30;
  return 45;
}

/* ============================================================
   RENDER HELPERS
============================================================ */

function formatWeekRangeLabel(start, end) {
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const sDay = start.getDate();
  const eDay = end.getDate();
  const sMonth = months[start.getMonth()];
  const eMonth = months[end.getMonth()];
  if (start.getMonth() === end.getMonth()) {
    return `${sDay}–${eDay} ${sMonth}`;
  }
  return `${sDay} ${sMonth} – ${eDay} ${eMonth}`;
}

function buildWeekDays(start) {
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push({
      iso: toISODateString(d),
      weekday: weekdays[i],
      dateLabel: String(d.getDate()),
    });
  }
  return days;
}

/* ============================================================
   LOAD SHIFTS FOR WEEK (uses stores/{storeId}/shifts)
============================================================ */

async function loadWeek(offset) {
  if (!sessionUser) return;

  currentWeekOffset = offset;

  const { start, end } = getWeekRange(offset, new Date());
  const weekStartISO = toISODateString(start);
  const weekEndISO = toISODateString(end);

  // Header text
  weekTitle.textContent = offset === 0 ? "This week" : "Next week";
  weekRangeLabel.textContent = formatWeekRangeLabel(start, end);

  // Highlight buttons
  if (weekThisBtn && weekNextBtn) {
    weekThisBtn.classList.toggle("active", offset === 0);
    weekNextBtn.classList.toggle("active", offset === 1);
  }

  // Get all shifts for this store
  const storeId = sessionUser.storeId || "store001";

  let myShifts = [];
  try {
    const snap = await getDocs(
      collection(db, "stores", storeId, "shifts")
    );

    snap.forEach((docSnap) => {
      const s = docSnap.data();
      if (
        s.userId === sessionUser.id &&
        s.date >= weekStartISO &&
        s.date <= weekEndISO
      ) {
        myShifts.push({
          id: docSnap.id,
          ...s,
        });
      }
    });
  } catch (err) {
    console.error("[Shifts] load error:", err);
  }

  // Group shifts by date
  const byDate = {};
  myShifts.forEach((s) => {
    if (!byDate[s.date]) byDate[s.date] = [];
    byDate[s.date].push(s);
  });

  const weekDays = buildWeekDays(start);

  // If there really are no shifts, show "not posted" message
  const totalShifts = myShifts.length;
  if (totalShifts === 0) {
    weekStatusText.textContent = "Schedule not posted yet for this week.";
  } else {
    weekStatusText.textContent = "";
  }

  // Render each day card
  if (!weekDaysContainer) return;

  weekDaysContainer.innerHTML = weekDays
    .map((day) => {
      const shifts = byDate[day.iso] || [];

      let bodyHTML = "";
      if (shifts.length === 0) {
        bodyHTML = `<div class="shift-empty">No shifts posted.</div>`;
      } else {
        bodyHTML = shifts
          .map((s) => {
            const rawHours = parseShiftHours(s.start, s.end);
            const breakMin = calculateBreakMinutes(rawHours);
            const paid = rawHours - breakMin / 60;

            return `
              <div class="shift-row">
                <div class="shift-time">
                  ${s.start || "--:--"}–${s.end || "--:--"}
                  <span class="shift-break">(Break ${breakMin}m)</span>
                </div>
                <div class="shift-meta">
                  ${s.station || "Station not set"}
                  ${
                    s.isShiftManager
                      ? '<span class="badge-soft">Shift manager</span>'
                      : ""
                  }
                  <span class="shift-hours">${paid.toFixed(2)} hrs paid</span>
                </div>
              </div>
            `;
          })
          .join("");
      }

      return `
        <div class="shift-day-card">
          <div class="shift-day-header">
            <div class="shift-day-name">${day.weekday}</div>
            <div class="shift-day-date">${day.dateLabel}</div>
          </div>
          <div class="shift-day-body">
            ${bodyHTML}
          </div>
        </div>
      `;
    })
    .join("");
}

/* ============================================================
   AUTH + INIT
============================================================ */

if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    try {
      await signOut(auth);
      localStorage.removeItem("mc_session_user");
      window.location.href = "index.html";
    } catch (err) {
      console.error("Logout error:", err);
    }
  });
}

if (weekThisBtn) {
  weekThisBtn.addEventListener("click", () => loadWeek(0));
}
if (weekNextBtn) {
  weekNextBtn.addEventListener("click", () => loadWeek(1));
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    localStorage.removeItem("mc_session_user");
    window.location.href = "index.html";
    return;
  }

  sessionUser = loadSessionUser();
  if (!sessionUser) {
    sessionUser = {
      id: user.uid,
      role: "crew",
      name: user.displayName || user.email || "User",
      storeId: "store001",
    };
    localStorage.setItem("mc_session_user", JSON.stringify(sessionUser));
  }

  // Sidebar info
  if (sidebarUserName) sidebarUserName.textContent = sessionUser.name || "User";
  if (sidebarUserRole)
    sidebarUserRole.textContent =
      sessionUser.role === "crew"
        ? "Crew Member"
        : sessionUser.role === "shiftCreator"
        ? "Shift Creator"
        : "Restaurant Manager";

  // Default to THIS week
  await loadWeek(0);
});
