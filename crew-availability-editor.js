import { db } from "./firebase-init.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const STATIONS = ["Grill", "Fries", "Front Counter", "Drive Thru", "Kitchen", "Lobby", "Drinks", "Runner", "Cleaning", "Stock"];
const $ = (id) => document.getElementById(id);

let currentCrewId = "";
let renderedCrewId = "";
let editorDirty = false;
let refreshing = false;

function getSessionUser() {
  try {
    return JSON.parse(localStorage.getItem("mc_session_user") || "null") || {};
  } catch {
    return {};
  }
}

function canEditCrewAvailability() {
  const role = String(getSessionUser().role || "").toLowerCase().replace(/\s+/g, "");
  return role === "manager" || role === "shiftcreator" || role === "admin";
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function addAvailabilityStyles() {
  if ($("crewAvailabilityEditorStyles")) return;

  const style = document.createElement("style");
  style.id = "crewAvailabilityEditorStyles";
  style.textContent = `
    .crew-profile-card { max-height: 88vh; overflow-y: auto; }
    .crew-avail-editor { margin-top:14px; padding:14px; border-radius:20px; background:linear-gradient(135deg,#fff7ed,#fff1c2); border:1px solid #f59e0b; box-shadow:0 10px 24px rgba(120,53,15,.10); }
    .crew-avail-editor h4 { margin:0 0 6px; color:#991b1b; font-size:.95rem; font-weight:900; }
    .crew-avail-help { font-size:.75rem; color:#7c2d12; margin-bottom:10px; }
    .crew-avail-row { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-bottom:10px; }
    .crew-avail-input { border:1px solid #f59e0b; border-radius:12px; padding:7px 9px; background:white; font-size:.78rem; }
    .crew-avail-days { display:grid; grid-template-columns:repeat(auto-fit,minmax(125px,1fr)); gap:8px; margin-top:8px; }
    .crew-avail-day { background:white; border:1px solid #fed7aa; border-radius:14px; padding:8px; font-size:.72rem; }
    .crew-avail-day label { display:flex; align-items:center; gap:6px; font-weight:900; color:#7c2d12; margin-bottom:5px; }
    .crew-avail-day input[type="time"] { width:100%; margin-top:5px; border:1px solid #fcd34d; border-radius:10px; padding:6px; font-size:.72rem; }
    .crew-station-list { display:flex; flex-wrap:wrap; gap:6px; margin-top:10px; }
    .crew-station-pill { display:inline-flex; align-items:center; gap:5px; background:white; border:1px solid #f59e0b; border-radius:999px; padding:6px 9px; font-size:.72rem; font-weight:900; color:#7c2d12; cursor:pointer; }
    .crew-avail-actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }
    .crew-avail-btn { border:0; border-radius:999px; padding:9px 13px; background:#dc0019; color:white; font-weight:900; cursor:pointer; }
    .crew-avail-btn.secondary { background:#111827; }
    .crew-avail-status { margin-top:8px; font-size:.76rem; font-weight:900; color:#15803d; }
  `;

  document.head.appendChild(style);
}

function getProfileCrewIdFromPage() {
  const overlay = $("crewProfileOverlay");
  return overlay?.dataset?.crewId || overlay?.dataset?.userId || overlay?.dataset?.uid || window.__lastCrewProfileId || "";
}

async function findCrewByProfileName() {
  const profileName = $("crewProfileName")?.textContent?.trim();
  if (!profileName) return null;

  const storeId = getSessionUser().storeId || "store001";
  const q = query(collection(db, "users"), where("storeId", "==", storeId));
  const snap = await getDocs(q);
  let exact = null;

  snap.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const name = String(data.name || data.email || "").trim();
    if (name.toLowerCase() === profileName.toLowerCase()) {
      exact = { id: docSnap.id, ...data };
    }
  });

  return exact;
}

async function loadCrewData() {
  const pageId = getProfileCrewIdFromPage();
  if (pageId) {
    const snap = await getDoc(doc(db, "users", pageId));
    if (snap.exists()) return { id: pageId, ...snap.data() };
  }
  return await findCrewByProfileName();
}

function getDayAvailability(data, day) {
  const availability = data?.availability || {};
  const value = availability[day] || availability[day.slice(0, 3)];

  if (value === false || value === "off" || value === "unavailable") {
    return { available: false, start: "09:00", end: "17:00" };
  }

  if (typeof value === "string") {
    const match = value.match(/(\d{1,2}:?\d{0,2}\s*(?:am|pm)?)\s*(?:-|to)\s*(\d{1,2}:?\d{0,2}\s*(?:am|pm)?)/i);
    return { available: true, start: match?.[1] || "09:00", end: match?.[2] || "17:00" };
  }

  if (value && typeof value === "object") {
    return {
      available: value.available !== false,
      start: value.start || value.from || "09:00",
      end: value.end || value.to || "17:00"
    };
  }

  return { available: true, start: "09:00", end: "17:00" };
}

function getTrainedStations(data) {
  const set = new Set();

  [data?.stations, data?.certifications, data?.trainedStations, data?.availableStations].forEach((arr) => {
    if (Array.isArray(arr)) arr.forEach((station) => set.add(String(station)));
  });

  [data?.skills, data?.stationSkills, data?.certifiedStations].forEach((obj) => {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return;
    Object.entries(obj).forEach(([station, value]) => {
      if (value === true || value === "yes" || value === "trained" || Number(value) > 0) set.add(station);
    });
  });

  return set;
}

function markDirty() {
  editorDirty = true;
  const status = $("crewAvailStatus");
  if (status && !status.textContent.includes("Saving")) {
    status.textContent = "Unsaved changes…";
    status.style.color = "#b45309";
  }
}

function renderAvailabilityEditor(data) {
  if (!canEditCrewAvailability()) return;
  if (!data?.id) return;

  const existingBox = $("crewAvailabilityEditor");
  const activeInsideEditor = existingBox && existingBox.contains(document.activeElement);

  // Do NOT rebuild the editor while the manager is ticking boxes or changing times.
  if (existingBox && renderedCrewId === data.id && (editorDirty || activeInsideEditor)) {
    return;
  }

  addAvailabilityStyles();

  const body = document.querySelector(".crew-profile-body");
  if (!body) return;

  let box = existingBox;
  if (!box) {
    box = document.createElement("div");
    box.id = "crewAvailabilityEditor";
    box.className = "crew-avail-editor";
    body.appendChild(box);
  }

  currentCrewId = data.id;
  renderedCrewId = data.id;
  editorDirty = false;

  const maxWeeklyHours = Number(data.maxWeeklyHours || data.maxHours || data.contractHours || data.hoursPerWeek || 30);
  const trainedStations = getTrainedStations(data);

  const daysHTML = DAYS.map((day) => {
    const availability = getDayAvailability(data, day);
    return `
      <div class="crew-avail-day">
        <label><input data-avail-day="${day}" type="checkbox" ${availability.available ? "checked" : ""}> ${day.slice(0, 3).toUpperCase()}</label>
        <input data-start-day="${day}" type="time" value="${escapeHtml(availability.start)}">
        <input data-end-day="${day}" type="time" value="${escapeHtml(availability.end)}">
      </div>
    `;
  }).join("");

  const stationHTML = STATIONS.map((station) => {
    const checked = trainedStations.has(station) || trainedStations.has(station.toLowerCase());
    return `<label class="crew-station-pill"><input data-station="${escapeHtml(station)}" type="checkbox" ${checked ? "checked" : ""}> ${escapeHtml(station)}</label>`;
  }).join("");

  box.innerHTML = `
    <h4>🗓 Availability & station skills</h4>
    <div class="crew-avail-help">Used by <strong>generate shifts</strong> so the AI can pick the right people.</div>
    <div class="crew-avail-row">
      <label style="font-size:0.78rem;font-weight:900;color:#7c2d12;">Max weekly hours
        <input id="crewMaxHoursInput" class="crew-avail-input" type="number" min="1" max="60" value="${escapeHtml(maxWeeklyHours)}">
      </label>
    </div>
    <div class="crew-avail-days">${daysHTML}</div>
    <div class="crew-station-list">${stationHTML}</div>
    <div class="crew-avail-actions">
      <button id="saveCrewAvailabilityBtn" class="crew-avail-btn" type="button">Save availability</button>
      <button id="quickWeekdaysBtn" class="crew-avail-btn secondary" type="button">Weekdays 9–5</button>
    </div>
    <div id="crewAvailStatus" class="crew-avail-status"></div>
  `;

  box.querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", markDirty);
    input.addEventListener("change", markDirty);
  });

  $("saveCrewAvailabilityBtn")?.addEventListener("click", saveAvailabilityEditor);
  $("quickWeekdaysBtn")?.addEventListener("click", setWeekdaysPreset);
}

function setWeekdaysPreset() {
  DAYS.forEach((day) => {
    const isWeekday = !["saturday", "sunday"].includes(day);
    const available = document.querySelector(`[data-avail-day="${day}"]`);
    const start = document.querySelector(`[data-start-day="${day}"]`);
    const end = document.querySelector(`[data-end-day="${day}"]`);
    if (available) available.checked = isWeekday;
    if (start) start.value = "09:00";
    if (end) end.value = "17:00";
  });
  markDirty();
}

async function saveAvailabilityEditor() {
  if (!currentCrewId) {
    const status = $("crewAvailStatus");
    if (status) status.textContent = "Open a crew profile first.";
    return;
  }

  const availability = {};

  DAYS.forEach((day) => {
    availability[day] = {
      available: document.querySelector(`[data-avail-day="${day}"]`)?.checked || false,
      start: document.querySelector(`[data-start-day="${day}"]`)?.value || "09:00",
      end: document.querySelector(`[data-end-day="${day}"]`)?.value || "17:00"
    };
  });

  const stations = [...document.querySelectorAll("[data-station]:checked")]
    .map((input) => input.dataset.station)
    .filter(Boolean);

  const skills = Object.fromEntries(stations.map((station) => [station, true]));
  const maxWeeklyHours = Number($("crewMaxHoursInput")?.value || 30);
  const status = $("crewAvailStatus");
  if (status) {
    status.textContent = "Saving…";
    status.style.color = "#15803d";
  }

  await updateDoc(doc(db, "users", currentCrewId), {
    availability,
    stations,
    skills,
    maxWeeklyHours,
    updatedAt: Date.now()
  });

  editorDirty = false;

  if (status) {
    status.textContent = "Saved ✅ Generate shifts will use this now.";
    status.style.color = "#15803d";
  }
}

async function refreshAvailabilityEditor() {
  if (!canEditCrewAvailability()) return;
  if (refreshing) return;

  const overlay = $("crewProfileOverlay");
  if (!overlay || !(overlay.classList.contains("show") || overlay.classList.contains("active"))) return;

  const box = $("crewAvailabilityEditor");
  if (box && (editorDirty || box.contains(document.activeElement))) return;

  refreshing = true;
  try {
    const data = await loadCrewData();
    if (data) renderAvailabilityEditor(data);
  } finally {
    refreshing = false;
  }
}

function startAvailabilityEditor() {
  const overlay = $("crewProfileOverlay");
  if (!overlay) return;
  if (overlay.dataset.availabilityEditorReady === "1") return;
  overlay.dataset.availabilityEditorReady = "1";

  new MutationObserver(() => setTimeout(refreshAvailabilityEditor, 150)).observe(overlay, {
    attributes: true,
    childList: true,
    subtree: false
  });

  document.addEventListener("click", (event) => {
    if (event.target.closest("#crewAvailabilityEditor")) return;
    setTimeout(refreshAvailabilityEditor, 250);
  }, true);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startAvailabilityEditor);
} else {
  startAvailabilityEditor();
}
