// training.js
import { auth, db } from "./firebase-init.js";
import {
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  collection,
  getDocs,
  doc,
  getDoc,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* ---------- SESSION HELPERS ---------- */

let sessionUser = null;

function loadSessionUser() {
  try {
    const raw = localStorage.getItem("mc_session_user");
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

/* ---------- DOM REFS ---------- */

const sidebarUserName = document.getElementById("sidebarUserName");
const sidebarUserRole = document.getElementById("sidebarUserRole");
const logoutBtn = document.getElementById("logoutBtn");

const roleBadge = document.getElementById("roleBadge");
const avatarCircle = document.getElementById("avatarCircle");
const pageTitle = document.getElementById("pageTitle");
const pageSubtitle = document.getElementById("pageSubtitle");
const progressText = document.getElementById("progressText");
const progressBarInner = document.getElementById("progressBarInner");
const modulesTableBody = document.querySelector("#modulesTable tbody");
const filterButtons = document.querySelectorAll(".pill-filter");
const recommendedList = document.getElementById("recommendedList");

/* ---------- TRAINING DATA STATE ---------- */

let modules = []; // from trainingModules
let completedIds = new Set(); // from userTraining

/* ---------- AUTH GUARD ---------- */

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
      storeId: "store001"
    };
    localStorage.setItem("mc_session_user", JSON.stringify(sessionUser));
  }

  await loadTrainingModules();
  await loadUserTrainingStatus();
  initPage();
});

if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    try {
      await signOut(auth);
    } catch (e) {
      console.error(e);
    } finally {
      localStorage.removeItem("mc_session_user");
      window.location.href = "index.html";
    }
  });
}

/* ---------- FIRESTORE: MODULES ---------- */

async function loadTrainingModules() {
  try {
    const col = collection(db, "trainingModules");
    const snap = await getDocs(col);
    const list = [];
    snap.forEach((docSnap) => {
      const d = docSnap.data();
      list.push({
        id: docSnap.id,
        title: d.title || "Untitled module",
        station: d.station || "General",
        type: d.type === "optional" ? "optional" : "required"
      });
    });

    if (list.length) {
      modules = list;
      return;
    }
  } catch (e) {
    console.error("Failed to load trainingModules from Firestore", e);
  }

  // Fallback demo data if nothing in Firestore yet
  modules = [
    {
      id: "frontCounterBasics",
      title: "Front Counter Basics",
      station: "Front Counter",
      type: "required"
    },
    {
      id: "friesStationSetup",
      title: "Fries Station Setup",
      station: "Fries",
      type: "required"
    },
    {
      id: "driveThruOrderTaking",
      title: "Drive-Thru Order Taking",
      station: "Drive-Thru",
      type: "required"
    },
    {
      id: "foodSafetyLevel2",
      title: "Food Safety Level 2",
      station: "All",
      type: "required"
    },
    {
      id: "customerServiceExcellence",
      title: "Customer Service Excellence",
      station: "Front Counter",
      type: "optional"
    }
  ];
}

/* ---------- FIRESTORE: USER PROGRESS ---------- */

async function loadUserTrainingStatus() {
  try {
    const ref = doc(db, "userTraining", sessionUser.id);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      completedIds = new Set();
      return;
    }
    const data = snap.data();
    const arr = Array.isArray(data.completed) ? data.completed : [];
    completedIds = new Set(arr);
  } catch (e) {
    console.error("Failed to load userTraining doc", e);
    completedIds = new Set();
  }
}

async function saveUserTrainingStatus() {
  try {
    const ref = doc(db, "userTraining", sessionUser.id);
    await setDoc(
      ref,
      { completed: Array.from(completedIds) },
      { merge: true }
    );
  } catch (e) {
    console.error("Failed to save userTraining doc", e);
  }
}

/* ---------- UI INITIALISATION ---------- */

function initPage() {
  const isCrew = sessionUser.role === "crew";

  sidebarUserName.textContent = sessionUser.name || "User";
  sidebarUserRole.textContent = isCrew ? "Crew Member" : "Restaurant Manager";
  roleBadge.textContent = isCrew ? "Crew" : "Manager";
  avatarCircle.textContent = (sessionUser.name || "U").charAt(0).toUpperCase();

  pageTitle.textContent = isCrew ? "Your training" : "Crew training overview";
  pageSubtitle.textContent = isCrew
    ? "See what you've completed and what's next."
    : "View key modules your crew are working through.";

  renderProgress();
  renderModules("all");
  renderRecommended();
  setupFilters();
}

/* ---------- PROGRESS + MODULES RENDER ---------- */

function renderProgress() {
  const total = modules.length;
  const completed = modules.filter((m) => completedIds.has(m.id)).length;
  const percent = total ? Math.round((completed / total) * 100) : 0;

  progressText.textContent = `${completed} of ${total} modules complete (${percent}%)`;
  progressBarInner.style.width = percent + "%";
}

function renderModules(filter) {
  modulesTableBody.innerHTML = "";

  modules
    .filter((m) => (filter === "all" ? true : m.type === filter))
    .forEach((module) => {
      const tr = document.createElement("tr");
      const isComplete = completedIds.has(module.id);

      const statusBadgeClass = isComplete
        ? "badge-soft-success"
        : "badge-soft-warn";
      const statusText = isComplete ? "Complete" : "Not started";

      tr.innerHTML = `
        <td>${module.title}</td>
        <td>${module.station}</td>
        <td>
          <span class="badge-soft${
            module.type === "required" ? "" : "-warn"
          }">
            ${module.type === "required" ? "Required" : "Optional"}
          </span>
        </td>
        <td>
          <span class="${statusBadgeClass}">${statusText}</span>
        </td>
        <td>
          <button class="status-btn" data-id="${module.id}">
            ${isComplete ? "Mark not done" : "Mark complete"}
          </button>
        </td>
      `;
      modulesTableBody.appendChild(tr);
    });

  attachStatusButtons();
}

function attachStatusButtons() {
  const buttons = modulesTableBody.querySelectorAll(".status-btn");
  buttons.forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      if (!id) return;

      if (completedIds.has(id)) {
        completedIds.delete(id);
      } else {
        completedIds.add(id);
      }

      await saveUserTrainingStatus();
      renderProgress();
      const activeBtn = document.querySelector(".pill-filter.active");
      const filter = activeBtn ? activeBtn.getAttribute("data-filter") : "all";
      renderModules(filter || "all");
      renderRecommended();
    });
  });
}

function setupFilters() {
  filterButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      filterButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const filter = btn.getAttribute("data-filter");
      renderModules(filter);
    });
  });
}

/* ---------- RECOMMENDED LIST ---------- */

function renderRecommended() {
  const important = modules.filter(
    (m) => m.type === "required" && !completedIds.has(m.id)
  );
  const extra = modules.filter(
    (m) => m.type === "optional" && !completedIds.has(m.id)
  );

  recommendedList.innerHTML = "";

  important.forEach((m) => {
    const li = document.createElement("li");
    li.style.marginBottom = "6px";
    li.innerHTML = `<span><strong>${m.title}</strong><br /><span style="color:#6b7280;font-size:0.75rem;">Station: ${m.station} • Required</span></span>`;
    recommendedList.appendChild(li);
  });

  if (extra.length) {
    const divider = document.createElement("li");
    divider.style.margin = "6px 0";
    divider.style.fontSize = "0.75rem";
    divider.style.color = "#9ca3af";
    divider.textContent = "Optional extras:";
    recommendedList.appendChild(divider);

    extra.forEach((m) => {
      const li = document.createElement("li");
      li.style.marginBottom = "4px";
      li.innerHTML = `<span>${m.title}</span><span style="color:#6b7280;font-size:0.75rem;"> (${m.station})</span>`;
      recommendedList.appendChild(li);
    });
  }

  if (!important.length && !extra.length) {
    const li = document.createElement("li");
    li.style.fontSize = "0.8rem";
    li.style.color = "#16a34a";
    li.textContent = "Nice work – all modules completed!";
    recommendedList.appendChild(li);
  }
}
// Sidebar mobile toggle
const sidebar = document.querySelector(".sidebar");
const sidebarToggle = document.getElementById("sidebarToggle");

if (sidebar && sidebarToggle) {
  sidebarToggle.addEventListener("click", () => {
    sidebar.classList.toggle("sidebar-open");
  });
}
