// shifts-admin.js – Shift Creator Console

import { auth, db } from "../../firebase-init.js";
import {
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  collection,
  getDocs,
  doc,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* ========= DOM ========= */

const sidebarUserName = document.getElementById("sidebarUserName");
const sidebarUserRole = document.getElementById("sidebarUserRole");
const avatarCircle = document.getElementById("avatarCircle");
const roleBadge = document.getElementById("roleBadge");
const logoutBtn = document.getElementById("logoutBtn");

const pageTitle = document.getElementById("pageTitle");
const pageSubtitle = document.getElementById("pageSubtitle");

const weekTabs = document.getElementById("weekTabs");
const adminScheduleGrid = document.getElementById("adminScheduleGrid");

const sidebar = document.querySelector(".sidebar");
const sidebarToggle = document.getElementById("sidebarToggle");

/* Shift editor overlay */
const shiftEditorOverlay = document.getElementById("shiftEditorOverlay");
const shiftEditorTitle = document.getElementById("shiftEditorTitle");
const shiftEditorClose = document.getElementById("shiftEditorClose");
const shiftEditorForm = document.getElementById("shiftEditorForm");

const shiftDateInput = document.getElementById("shiftDate");
const shiftPersonSelect = document.getElementById("shiftPerson");
const shiftStartInput = document.getElementById("shiftStart");
const shiftEndInput = document.getElementById("shiftEnd");
const shiftStationInput = document.getElementById("shiftStation");
const shiftIsManagerCheckbox = document.getElementById("shiftIsManager");
const shiftDeleteBtn = document.getElementById("shiftDeleteBtn");

/* ========= STATE ========= */

let sessionUser = null;
let storeId = "store001";

let allShifts = [];   // {id, date, start, end, userId, userName, role, station, isShiftManager}
let people = [];      // {id, name, role}
let currentWeekOffset = 0;

let editingShiftId = null; // null = new shift

/* ========= UTIL FUNCTIONS ========= */

function loadSessionUser() {
  try {
    return JSON.parse(localStorage.getItem("mc_session_user"));
  } catch {
    return null;
  }
}

function toISODateString(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sun
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
  const months = [
    "Jan","Feb","Mar","Apr","May","Jun",
    "Jul","Aug","Sep","Oct","Nov","Dec"
  ];
  return `${start.getDate()} ${months[start.getMonth()]} – ${end.getDate()} ${months[end.getMonth()]}`;
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
    console.error("[ShiftAdmin] loadStoreName error:", err);
  }
  return "Your restaurant";
}

async function loadPeople() {
  people = [];
  try {
    const col = collection(db, "users");
    const snap = await getDocs(col);
    snap.forEach((docSnap) => {
      const d = docSnap.data();
      if (d.storeId === storeId) {
        people.push({
          id: docSnap.id,
          name: d.name || d.email || "User",
          role: d.role || "crew"
        });
      }
    });
  } catch (err) {
    console.error("[ShiftAdmin] loadPeople error:", err);
  }
}

async function loadShifts() {
  allShifts = [];
  try {
    const col = collection(db, "stores", storeId, "shifts");
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
        isShiftManager: !!d.isShiftManager
      });
    });
  } catch (err) {
    console.error("[ShiftAdmin] loadShifts error:", err);
  }
}

/* ========= AUTH INIT ========= */

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  sessionUser = loadSessionUser() || {
    id: user.uid,
    role: "crew",
    name: user.displayName || user.email || "User",
    storeId: "store001"
  };

  storeId = sessionUser.storeId || "store001";

  // Only allow shiftCreator to stay here
  if (sessionUser.role !== "shiftCreator") {
    // normal managers/crew get bounced to read-only schedule page
    window.location.href = "schedule.html";
    return;
  }

  // Sidebar + header
  if (sidebarUserName) sidebarUserName.textContent = sessionUser.name;
  if (sidebarUserRole) sidebarUserRole.textContent = "Shift Creator";
  if (avatarCircle) {
    avatarCircle.textContent = sessionUser.name.charAt(0).toUpperCase();
  }
  if (roleBadge) roleBadge.textContent = "Shift Creator";

  const storeName = await loadStoreName(storeId);
  if (pageSubtitle) {
    pageSubtitle.textContent = `Planning shifts for ${storeName}.`;
  }

  await loadPeople();
  await loadShifts();
  populatePersonSelect();
  renderWeekGrid();
});

if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    await signOut(auth);
    localStorage.removeItem("mc_session_user");
    window.location.href = "index.html";
  });
}

/* ========= PEOPLE DROPDOWN ========= */

function populatePersonSelect() {
  if (!shiftPersonSelect) return;
  shiftPersonSelect.innerHTML = "";

  const sorted = [...people].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );

  sorted.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.id;
    const roleLabel =
      p.role === "manager"
        ? "Manager"
        : p.role === "shiftCreator"
        ? "Shift creator"
        : "Crew";
    opt.textContent = `${p.name} – ${roleLabel}`;
    shiftPersonSelect.appendChild(opt);
  });
}

/* ========= RENDER WEEK GRID ========= */

function renderWeekGrid() {
  if (!adminScheduleGrid) return;

  const { start, end } = getWeekRange(currentWeekOffset, new Date());
  const weekStartStr = toISODateString(start);
  const weekEndStr = toISODateString(end);

  const shiftsInWeek = allShifts.filter(
    (s) => s.date >= weekStartStr && s.date <= weekEndStr
  );

  // Build days array
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(d);
  }

  let html = `
    <div class="subsection-title">
      ${currentWeekOffset === 0 ? "This week" : "Next week"}
    </div>
    <div class="subsection-sub">
      ${formatWeekLabel(start, end)}
    </div>
    <div style="margin-top:8px; display:flex; flex-wrap:wrap; gap:10px;">
  `;

  days.forEach((d) => {
    const dayISO = toISODateString(d);
    const label = formatDayLabel(d);
    const dayShifts = shiftsInWeek
      .filter((s) => s.date === dayISO)
      .sort((a, b) => a.start.localeCompare(b.start));

    let content = "";

    if (!dayShifts.length) {
      content = `
        <li>
          <span class="shift-meta">No shifts yet.</span>
        </li>
      `;
    } else {
      content = dayShifts
        .map((s) => {
          const isMgr = s.isShiftManager;
          const stationText = s.station ? ` · ${s.station}` : "";
          const roleLabel =
            s.role === "manager"
              ? "Manager"
              : s.role === "shiftCreator"
              ? "Shift creator"
              : "Crew";

          return `
            <li>
              <div>
                <strong>${s.userName}</strong>
                <div class="shift-meta">
                  ${s.start}–${s.end} · ${roleLabel}${stationText}
                </div>
              </div>
              <div class="shift-actions">
                <span class="shift-pill ${
                  isMgr ? "shift-pill-manager" : ""
                }">${isMgr ? "Shift manager" : "Shift"}</span>
                <button class="shift-btn" data-id="${s.id}" data-date="${dayISO}">
                  Edit
                </button>
              </div>
            </li>
          `;
        })
        .join("");
    }

    html += `
      <div class="card" style="flex:1 1 200px; min-width:200px;">
        <div class="card-header">
          <div class="card-title">${label}</div>
          <div class="card-icon">📆</div>
        </div>
        <ul class="list">
          ${content}
        </ul>
        <div style="margin-top:6px; display:flex; justify-content:flex-end;">
          <button class="crew-edit-btn shift-add-btn" data-date="${dayISO}">
            + Add shift
          </button>
        </div>
      </div>
    `;
  });

  html += `</div>`;
  adminScheduleGrid.innerHTML = html;

  attachDayButtons();
}

function attachDayButtons() {
  if (!adminScheduleGrid) return;

  // Add shift buttons
  adminScheduleGrid.querySelectorAll(".shift-add-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const date = btn.dataset.date;
      openShiftEditor({ date });
    });
  });

  // Edit existing
  adminScheduleGrid.querySelectorAll(".shift-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const shift = allShifts.find((s) => s.id === id);
      if (!shift) return;
      openShiftEditor(shift);
    });
  });
}

/* ========= SHIFT EDITOR ========= */

function openShiftEditor(shiftOrOpts) {
  editingShiftId = shiftOrOpts.id || null;

  const isNew = !editingShiftId;
  if (shiftEditorTitle) {
    shiftEditorTitle.textContent = isNew ? "Add shift" : "Edit shift";
  }

  if (isNew) {
    const date = shiftOrOpts.date || toISODateString(new Date());
    shiftDateInput.value = date;
    if (shiftStartInput) shiftStartInput.value = "";
    if (shiftEndInput) shiftEndInput.value = "";
    if (shiftStationInput) shiftStationInput.value = "";
    if (shiftIsManagerCheckbox) shiftIsManagerCheckbox.checked = false;
    if (shiftPersonSelect && shiftPersonSelect.options.length > 0) {
      shiftPersonSelect.selectedIndex = 0;
    }
    if (shiftDeleteBtn) shiftDeleteBtn.disabled = true;
  } else {
    shiftDateInput.value = shiftOrOpts.date;
    shiftStartInput.value = shiftOrOpts.start;
    shiftEndInput.value = shiftOrOpts.end;
    shiftStationInput.value = shiftOrOpts.station || "";
    shiftIsManagerCheckbox.checked = !!shiftOrOpts.isShiftManager;
    if (shiftPersonSelect) {
      shiftPersonSelect.value = shiftOrOpts.userId;
    }
    if (shiftDeleteBtn) shiftDeleteBtn.disabled = false;
  }

  shiftEditorOverlay.classList.add("show");
}

function closeShiftEditor() {
  shiftEditorOverlay.classList.remove("show");
  editingShiftId = null;
}

if (shiftEditorClose) {
  shiftEditorClose.addEventListener("click", closeShiftEditor);
}
if (shiftEditorOverlay) {
  shiftEditorOverlay.addEventListener("click", (e) => {
    if (e.target === shiftEditorOverlay) {
      closeShiftEditor();
    }
  });
}

/* ========= VALIDATION ========= */

function validateShiftInput() {
  const date = shiftDateInput.value;
  const userId = shiftPersonSelect.value;
  const start = shiftStartInput.value;
  const end = shiftEndInput.value;

  if (!date || !userId || !start || !end) {
    alert("Please fill all required fields.");
    return null;
  }

  if (end <= start) {
    alert("End time must be after start time.");
    return null;
  }

  // Prevent multiple shifts per day per person
  const conflict = allShifts.find(
    (s) =>
      s.userId === userId &&
      s.date === date &&
      s.id !== editingShiftId
  );

  if (conflict) {
    alert(
      "This person already has a shift on that day. Edit that shift instead of adding another."
    );
    return null;
  }

  return { date, userId, start, end };
}

/* ========= SAVE / DELETE ========= */

if (shiftEditorForm) {
  shiftEditorForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const basic = validateShiftInput();
    if (!basic) return;

    const { date, userId, start, end } = basic;
    const station = shiftStationInput.value.trim();
    const isShiftManager = shiftIsManagerCheckbox.checked;

    const person = people.find((p) => p.id === userId);
    const userName = person ? person.name : "Unknown";
    const role = person ? person.role || "crew" : "crew";

    // If marking as shift manager, clear existing manager for that date
    if (isShiftManager) {
      const currentMgrs = allShifts.filter(
        (s) => s.date === date && s.isShiftManager && s.id !== editingShiftId
      );
      for (const m of currentMgrs) {
        try {
          const ref = doc(db, "stores", storeId, "shifts", m.id);
          await updateDoc(ref, { isShiftManager: false });
          m.isShiftManager = false;
        } catch (err) {
          console.error("[ShiftAdmin] clear manager error:", err);
        }
      }
    }

    try {
      if (!editingShiftId) {
        // new shift
        const colRef = collection(db, "stores", storeId, "shifts");
        const newDoc = await addDoc(colRef, {
          date,
          start,
          end,
          userId,
          userName,
          role,
          station,
          isShiftManager
        });
        allShifts.push({
          id: newDoc.id,
          date,
          start,
          end,
          userId,
          userName,
          role,
          station,
          isShiftManager
        });
      } else {
        // update
        const ref = doc(db, "stores", storeId, "shifts", editingShiftId);
        await updateDoc(ref, {
          date,
          start,
          end,
          userId,
          userName,
          role,
          station,
          isShiftManager
        });

        const idx = allShifts.findIndex((s) => s.id === editingShiftId);
        if (idx !== -1) {
          allShifts[idx] = {
            id: editingShiftId,
            date,
            start,
            end,
            userId,
            userName,
            role,
            station,
            isShiftManager
          };
        }
      }

      closeShiftEditor();
      renderWeekGrid();
    } catch (err) {
      console.error("[ShiftAdmin] save error:", err);
      alert("Could not save shift.");
    }
  });
}

if (shiftDeleteBtn) {
  shiftDeleteBtn.addEventListener("click", async () => {
    if (!editingShiftId) return;
    if (!confirm("Delete this shift?")) return;

    try {
      const ref = doc(db, "stores", storeId, "shifts", editingShiftId);
      await deleteDoc(ref);
      allShifts = allShifts.filter((s) => s.id !== editingShiftId);
      closeShiftEditor();
      renderWeekGrid();
    } catch (err) {
      console.error("[ShiftAdmin] delete error:", err);
      alert("Could not delete shift.");
    }
  });
}

/* ========= WEEK TABS ========= */

if (weekTabs) {
  weekTabs.addEventListener("click", (e) => {
    const btn = e.target.closest(".pill-filter");
    if (!btn) return;
    const offset = parseInt(btn.dataset.weekOffset, 10);
    if (isNaN(offset)) return;

    currentWeekOffset = offset;
    weekTabs.querySelectorAll(".pill-filter").forEach((b) => {
      b.classList.toggle("active", b === btn);
    });
    renderWeekGrid();
  });
}

/* ========= SIDEBAR MOBILE TOGGLE ========= */

if (sidebar && sidebarToggle) {
  sidebarToggle.addEventListener("click", () => {
    sidebar.classList.toggle("sidebar-open");
  });
}
