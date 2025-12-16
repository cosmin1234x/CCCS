// shifts-admin.js – Shift Creator Console (FIXED + REALTIME)
// ✅ Uses /stores/{storeId}/Shifts (capital S) to match the rest of the app
// ✅ Uses realtime onSnapshot so it syncs immediately across pages

import { auth, db } from "./firebase-init.js";
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* ========= DOM ========= */

const sidebarUserName = document.getElementById("sidebarUserName");
const sidebarUserRole = document.getElementById("sidebarUserRole");
const avatarCircle = document.getElementById("avatarCircle");
const roleBadge = document.getElementById("roleBadge");
const logoutBtn = document.getElementById("logoutBtn");

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

let unsubPeople = null;
let unsubShifts = null;

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
  return `${start.getDate()} ${months[start.getMonth()]} – ${end.getDate()} ${months[end.getMonth()]}`;
}

/* ========= FIRESTORE ========= */

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

function stopRealtime() {
  try { unsubPeople?.(); } catch {}
  try { unsubShifts?.(); } catch {}
  unsubPeople = null;
  unsubShifts = null;
}

function startRealtime() {
  stopRealtime();

  // ✅ People: only users in this store
  const peopleQ = query(collection(db, "users"), where("storeId", "==", storeId));
  unsubPeople = onSnapshot(
    peopleQ,
    (snap) => {
      const next = [];
      snap.forEach((docSnap) => {
        const d = docSnap.data() || {};
        next.push({
          id: docSnap.id,
          name: d.name || d.email || "User",
          role: d.role || "crew"
        });
      });
      people = next.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
      populatePersonSelect();

      // if editor is open, keep selection valid
      if (editingShiftId && shiftPersonSelect) {
        const shift = allShifts.find((s) => s.id === editingShiftId);
        if (shift) shiftPersonSelect.value = shift.userId;
      }
    },
    (err) => console.error("[ShiftAdmin] people snapshot error:", err)
  );

  // ✅ Shifts: IMPORTANT — capital "Shifts"
  unsubShifts = onSnapshot(
    collection(db, "stores", storeId, "Shifts"),
    (snap) => {
      const next = [];
      snap.forEach((docSnap) => {
        const d = docSnap.data() || {};
        if (!d.date || !d.start || !d.end || !d.userId) return;
        next.push({
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
      allShifts = next;
      renderWeekGrid();
    },
    (err) => console.error("[ShiftAdmin] shifts snapshot error:", err)
  );
}

/* ========= AUTH INIT ========= */

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    stopRealtime();
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

  // Only allow shiftCreator
  if (sessionUser.role !== "shiftCreator") {
    window.location.href = "schedule.html";
    return;
  }

  // Sidebar + header
  if (sidebarUserName) sidebarUserName.textContent = sessionUser.name;
  if (sidebarUserRole) sidebarUserRole.textContent = "Shift Creator";
  if (avatarCircle) avatarCircle.textContent = sessionUser.name.charAt(0).toUpperCase();
  if (roleBadge) roleBadge.textContent = "Shift Creator";

  const storeName = await loadStoreName(storeId);
  if (pageSubtitle) pageSubtitle.textContent = `Planning shifts for ${storeName}.`;

  startRealtime();
});

if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    stopRealtime();
    await signOut(auth);
    localStorage.removeItem("mc_session_user");
    window.location.href = "index.html";
  });
}

/* ========= PEOPLE DROPDOWN ========= */

function populatePersonSelect() {
  if (!shiftPersonSelect) return;
  const current = shiftPersonSelect.value;

  shiftPersonSelect.innerHTML = "";
  people.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.id;
    const roleLabel =
      p.role === "manager" ? "Manager" :
      p.role === "shiftCreator" ? "Shift creator" :
      "Crew";
    opt.textContent = `${p.name} – ${roleLabel}`;
    shiftPersonSelect.appendChild(opt);
  });

  // preserve selection where possible
  if (current) shiftPersonSelect.value = current;
}

/* ========= RENDER WEEK GRID ========= */

function renderWeekGrid() {
  if (!adminScheduleGrid) return;

  const { start, end } = getWeekRange(currentWeekOffset, new Date());
  const weekStartStr = toISODateString(start);
  const weekEndStr = toISODateString(end);

  const shiftsInWeek = allShifts
    .filter((s) => s.date >= weekStartStr && s.date <= weekEndStr);

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
      content = `<li><span class="shift-meta">No shifts yet.</span></li>`;
    } else {
      content = dayShifts.map((s) => {
        const stationText = s.station ? ` · ${s.station}` : "";
        const roleLabel =
          s.role === "manager" ? "Manager" :
          s.role === "shiftCreator" ? "Shift creator" :
          "Crew";

        return `
          <li>
            <div>
              <strong>${s.userName}</strong>
              <div class="shift-meta">
                ${s.start}–${s.end} · ${roleLabel}${stationText}
              </div>
            </div>
            <div class="shift-actions">
              <span class="shift-pill ${s.isShiftManager ? "shift-pill-manager" : ""}">
                ${s.isShiftManager ? "Shift manager" : "Shift"}
              </span>
              <button class="shift-btn" data-id="${s.id}">
                Edit
              </button>
            </div>
          </li>
        `;
      }).join("");
    }

    html += `
      <div class="card" style="flex:1 1 200px; min-width:200px;">
        <div class="card-header">
          <div class="card-title">${label}</div>
          <div class="card-icon">📆</div>
        </div>
        <ul class="list">${content}</ul>
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

  adminScheduleGrid.querySelectorAll(".shift-add-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      openShiftEditor({ date: btn.dataset.date });
    });
  });

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
  if (shiftEditorTitle) shiftEditorTitle.textContent = isNew ? "Add shift" : "Edit shift";

  if (isNew) {
    const date = shiftOrOpts.date || toISODateString(new Date());
    shiftDateInput.value = date;
    shiftStartInput.value = "";
    shiftEndInput.value = "";
    shiftStationInput.value = "";
    shiftIsManagerCheckbox.checked = false;
    if (shiftPersonSelect && shiftPersonSelect.options.length > 0) shiftPersonSelect.selectedIndex = 0;
    if (shiftDeleteBtn) shiftDeleteBtn.disabled = true;
  } else {
    shiftDateInput.value = shiftOrOpts.date;
    shiftStartInput.value = shiftOrOpts.start;
    shiftEndInput.value = shiftOrOpts.end;
    shiftStationInput.value = shiftOrOpts.station || "";
    shiftIsManagerCheckbox.checked = !!shiftOrOpts.isShiftManager;
    if (shiftPersonSelect) shiftPersonSelect.value = shiftOrOpts.userId;
    if (shiftDeleteBtn) shiftDeleteBtn.disabled = false;
  }

  shiftEditorOverlay.classList.add("show");
}

function closeShiftEditor() {
  shiftEditorOverlay.classList.remove("show");
  editingShiftId = null;
}

shiftEditorClose?.addEventListener("click", closeShiftEditor);
shiftEditorOverlay?.addEventListener("click", (e) => {
  if (e.target === shiftEditorOverlay) closeShiftEditor();
});

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

  const conflict = allShifts.find(
    (s) => s.userId === userId && s.date === date && s.id !== editingShiftId
  );

  if (conflict) {
    alert("This person already has a shift on that day. Edit that shift instead.");
    return null;
  }

  return { date, userId, start, end };
}

/* ========= SAVE / DELETE ========= */

shiftEditorForm?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const basic = validateShiftInput();
  if (!basic) return;

  const { date, userId, start, end } = basic;
  const station = (shiftStationInput.value || "").trim();
  const isShiftManager = !!shiftIsManagerCheckbox.checked;

  const person = people.find((p) => p.id === userId);
  const userName = person ? person.name : "Unknown";
  const role = person ? (person.role || "crew") : "crew";

  // If marking as shift manager, clear existing manager for that date
  if (isShiftManager) {
    const currentMgrs = allShifts.filter(
      (s) => s.date === date && s.isShiftManager && s.id !== editingShiftId
    );

    for (const m of currentMgrs) {
      try {
        await updateDoc(doc(db, "stores", storeId, "Shifts", m.id), { isShiftManager: false });
      } catch (err) {
        console.error("[ShiftAdmin] clear manager error:", err);
      }
    }
  }

  try {
    if (!editingShiftId) {
      await addDoc(collection(db, "stores", storeId, "Shifts"), {
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
      await updateDoc(doc(db, "stores", storeId, "Shifts", editingShiftId), {
        date,
        start,
        end,
        userId,
        userName,
        role,
        station,
        isShiftManager
      });
    }

    closeShiftEditor();
    // no manual push needed — realtime listener updates the grid
  } catch (err) {
    console.error("[ShiftAdmin] save error:", err);
    alert("Could not save shift (check permissions/rules).");
  }
});

shiftDeleteBtn?.addEventListener("click", async () => {
  if (!editingShiftId) return;
  if (!confirm("Delete this shift?")) return;

  try {
    await deleteDoc(doc(db, "stores", storeId, "Shifts", editingShiftId));
    closeShiftEditor();
  } catch (err) {
    console.error("[ShiftAdmin] delete error:", err);
    alert("Could not delete shift.");
  }
});

/* ========= WEEK TABS ========= */

weekTabs?.addEventListener("click", (e) => {
  const btn = e.target.closest(".pill-filter");
  if (!btn) return;

  const offset = parseInt(btn.dataset.weekOffset, 10);
  if (isNaN(offset)) return;

  currentWeekOffset = offset;
  weekTabs.querySelectorAll(".pill-filter").forEach((b) => b.classList.toggle("active", b === btn));
  renderWeekGrid();
});

/* ========= SIDEBAR MOBILE TOGGLE ========= */

if (sidebar && sidebarToggle) {
  sidebarToggle.addEventListener("click", () => {
    sidebar.classList.toggle("sidebar-open");
  });
}
