// shifts-admin.js – Shift Creator Console (FINAL + REALTIME)

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

/* =========================
   DOM
========================= */

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

/* Shift editor */
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

/* =========================
   STATE
========================= */

let sessionUser = null;
let storeId = "store001";

let allShifts = [];
let people = [];
let currentWeekOffset = 0;
let editingShiftId = null;

let unsubPeople = null;
let unsubShifts = null;

/* =========================
   HELPERS
========================= */

function loadSessionUser() {
  try {
    return JSON.parse(localStorage.getItem("mc_session_user"));
  } catch {
    return null;
  }
}

function toISODateString(d) {
  return d.toISOString().split("T")[0];
}

function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getWeekRange(offset = 0) {
  const start = getMonday(new Date());
  start.setDate(start.getDate() + offset * 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start, end };
}

function formatDayLabel(d) {
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric" });
}

function formatWeekLabel(start, end) {
  return `${start.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${end.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
}

/* =========================
   FIRESTORE
========================= */

async function loadStoreName(id) {
  try {
    const snap = await getDoc(doc(db, "stores", id));
    if (snap.exists()) return snap.data().storeName || "Your restaurant";
  } catch {}
  return "Your restaurant";
}

function stopRealtime() {
  unsubPeople?.();
  unsubShifts?.();
}

function startRealtime() {
  stopRealtime();

  unsubPeople = onSnapshot(
    query(collection(db, "users"), where("storeId", "==", storeId)),
    (snap) => {
      people = snap.docs.map(d => ({
        id: d.id,
        name: d.data().name || d.data().email || "User",
        role: d.data().role || "crew"
      })).sort((a,b)=>a.name.localeCompare(b.name));
      populatePersonSelect();
    }
  );

  unsubShifts = onSnapshot(
    collection(db, "stores", storeId, "Shifts"),
    (snap) => {
      allShifts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderWeekGrid();
    }
  );
}

/* =========================
   AUTH
========================= */

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    stopRealtime();
    window.location.href = "index.html";
    return;
  }

  sessionUser = loadSessionUser();
  if (!sessionUser || sessionUser.role !== "shiftCreator") {
    window.location.href = "schedule.html";
    return;
  }

  storeId = sessionUser.storeId || "store001";

  sidebarUserName.textContent = sessionUser.name;
  sidebarUserRole.textContent = "Shift Creator";
  avatarCircle.textContent = sessionUser.name[0].toUpperCase();
  roleBadge.textContent = "Shift Creator";

  pageSubtitle.textContent = `Planning shifts for ${await loadStoreName(storeId)}.`;

  startRealtime();
});

logoutBtn?.addEventListener("click", async () => {
  stopRealtime();
  await signOut(auth);
  localStorage.clear();
  window.location.href = "index.html";
});

/* =========================
   PEOPLE SELECT
========================= */

function populatePersonSelect() {
  if (!shiftPersonSelect) return;
  const cur = shiftPersonSelect.value;
  shiftPersonSelect.innerHTML = "";

  people.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = `${p.name} – ${p.role}`;
    shiftPersonSelect.appendChild(opt);
  });

  if (cur) shiftPersonSelect.value = cur;
}

/* =========================
   GRID RENDER
========================= */

function renderWeekGrid() {
  const { start, end } = getWeekRange(currentWeekOffset);
  const startISO = toISODateString(start);
  const endISO = toISODateString(end);

  const days = [...Array(7)].map((_,i)=>{
    const d = new Date(start);
    d.setDate(start.getDate()+i);
    return d;
  });

  let html = `
    <div class="subsection-title">${currentWeekOffset === 0 ? "This week" : "Next week"}</div>
    <div class="subsection-sub">${formatWeekLabel(start,end)}</div>
    <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:8px;">
  `;

  days.forEach(d=>{
    const iso = toISODateString(d);
    const shifts = allShifts.filter(s=>s.date===iso).sort((a,b)=>a.start.localeCompare(b.start));

    html += `
      <div class="card" style="flex:1 1 200px">
        <div class="card-header">
          <div class="card-title">${formatDayLabel(d)}</div>
          <div class="card-icon">📆</div>
        </div>
        <ul class="list">
          ${shifts.length ? shifts.map(s=>`
            <li>
              <div>
                <strong>${s.userName}</strong>
                <div class="shift-meta">${s.start}–${s.end}${s.station ? " · "+s.station : ""}</div>
              </div>
              <button class="shift-btn" data-id="${s.id}">Edit</button>
            </li>
          `).join("") : `<li><span class="shift-meta">No shifts.</span></li>`}
        </ul>
        <button class="crew-edit-btn shift-add-btn" data-date="${iso}">+ Add shift</button>
      </div>
    `;
  });

  adminScheduleGrid.innerHTML = html + "</div>";
  attachButtons();
}

/* =========================
   BUTTONS
========================= */

function attachButtons() {
  adminScheduleGrid.querySelectorAll(".shift-add-btn").forEach(b=>{
    b.onclick=()=>openEditor({date:b.dataset.date});
  });
  adminScheduleGrid.querySelectorAll(".shift-btn").forEach(b=>{
    const s = allShifts.find(x=>x.id===b.dataset.id);
    if (s) b.onclick=()=>openEditor(s);
  });
}

/* =========================
   EDITOR
========================= */

function openEditor(s) {
  editingShiftId = s.id || null;
  shiftEditorTitle.textContent = editingShiftId ? "Edit shift" : "Add shift";
  shiftDateInput.value = s.date;
  shiftStartInput.value = s.start || "";
  shiftEndInput.value = s.end || "";
  shiftStationInput.value = s.station || "";
  shiftIsManagerCheckbox.checked = !!s.isShiftManager;
  shiftPersonSelect.value = s.userId || shiftPersonSelect.options[0]?.value;
  shiftDeleteBtn.disabled = !editingShiftId;
  shiftEditorOverlay.classList.add("show");
}

shiftEditorClose.onclick = ()=>shiftEditorOverlay.classList.remove("show");

shiftEditorForm.onsubmit = async (e)=>{
  e.preventDefault();

  const person = people.find(p=>p.id===shiftPersonSelect.value);
  if (!person) return alert("Invalid person");

  const data = {
    date: shiftDateInput.value,
    start: shiftStartInput.value,
    end: shiftEndInput.value,
    station: shiftStationInput.value.trim(),
    userId: person.id,
    userName: person.name,
    role: person.role,
    isShiftManager: shiftIsManagerCheckbox.checked
  };

  try {
    if (editingShiftId) {
      await updateDoc(doc(db,"stores",storeId,"Shifts",editingShiftId), data);
    } else {
      await addDoc(collection(db,"stores",storeId,"Shifts"), data);
    }
    shiftEditorOverlay.classList.remove("show");
  } catch {
    alert("Failed to save shift");
  }
};

shiftDeleteBtn.onclick = async ()=>{
  if (!editingShiftId || !confirm("Delete this shift?")) return;
  await deleteDoc(doc(db,"stores",storeId,"Shifts",editingShiftId));
  shiftEditorOverlay.classList.remove("show");
};

weekTabs.onclick = e=>{
  const btn = e.target.closest(".pill-filter");
  if (!btn) return;
  currentWeekOffset = Number(btn.dataset.weekOffset);
  weekTabs.querySelectorAll(".pill-filter").forEach(b=>b.classList.toggle("active",b===btn));
  renderWeekGrid();
};

sidebarToggle?.addEventListener("click",()=>sidebar.classList.toggle("sidebar-open"));
