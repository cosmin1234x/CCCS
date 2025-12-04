// training.js

import { auth } from "./firebase-init.js";
import {
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

/* ------- Load session user from localStorage ------- */
function loadSessionUser() {
  try {
    return JSON.parse(localStorage.getItem("mc_session_user"));
  } catch {
    return null;
  }
}

const sidebarUserName = document.getElementById("sidebarUserName");
const sidebarUserRole = document.getElementById("sidebarUserRole");
const avatarCircle = document.getElementById("avatarCircle");
const roleBadge = document.getElementById("roleBadge");
const logoutBtn = document.getElementById("logoutBtn");
const modulesBody = document.getElementById("modulesBody");
const progressBarInner = document.getElementById("trainingProgress");

/* ------- Auth check ------- */
onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  const sessionUser = loadSessionUser() || {
    id: user.uid,
    role: "crew",
    name: user.displayName || user.email || "User"
  };

  // Fill sidebar
  sidebarUserName.textContent = sessionUser.name;
  sidebarUserRole.textContent =
    sessionUser.role === "manager" ? "Restaurant Manager" : "Crew Member";
  roleBadge.textContent =
    sessionUser.role === "manager" ? "Manager" : "Crew";
  avatarCircle.textContent = sessionUser.name.charAt(0).toUpperCase();

  // Populate modules
  renderModules(sessionUser.role);
});

/* ------- Logout ------- */
if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    await signOut(auth);
    localStorage.removeItem("mc_session_user");
    window.location.href = "index.html";
  });
}

/* ------- Sample modules data (static for now) ------- */

const allModules = [
  {
    id: "m1",
    name: "Crew Basics",
    category: "crew",
    status: "Completed",
    crew: "Alex J"
  },
  {
    id: "m2",
    name: "Front Counter Service",
    category: "crew",
    status: "In progress",
    crew: "Alex J"
  },
  {
    id: "m3",
    name: "Kitchen Food Safety",
    category: "kitchen",
    status: "Not started",
    crew: "Maria L"
  },
  {
    id: "m4",
    name: "Drive-thru Speed & Accuracy",
    category: "drive",
    status: "In progress",
    crew: "James L"
  },
  {
    id: "m5",
    name: "Shift Leader Basics",
    category: "manager",
    status: "Not started",
    crew: "Sam K"
  }
];

let currentFilter = "all";
let currentModules = [...allModules];

/* ------- Render modules ------- */

function renderModules(userRole) {
  modulesBody.innerHTML = "";

  const filtered = currentModules.filter((m) => {
    if (currentFilter === "all") return true;
    return m.category === currentFilter;
  });

  filtered.forEach((m) => {
    const tr = document.createElement("tr");

    const statusClass =
      m.status === "Completed"
        ? "badge-soft-success"
        : m.status === "In progress"
        ? "badge-soft-warn"
        : "badge-soft-danger";

    tr.innerHTML = `
      <td>${m.name}</td>
      <td>${prettyCategory(m.category)}</td>
      <td>
        <button class="status-btn ${statusClass}" data-id="${m.id}">
          ${m.status}
        </button>
      </td>
      <td>${m.crew}</td>
    `;

    modulesBody.appendChild(tr);
  });

  updateProgressBar();
  attachStatusHandlers(userRole);
}

/* ------- Category label ------- */

function prettyCategory(cat) {
  switch (cat) {
    case "crew":
      return "Crew basics";
    case "kitchen":
      return "Kitchen";
    case "drive":
      return "Drive-thru";
    case "manager":
      return "Manager";
    default:
      return cat;
  }
}

/* ------- Progress bar ------- */

function updateProgressBar() {
  if (!progressBarInner) return;
  const total = currentModules.length;
  const done = currentModules.filter((m) => m.status === "Completed").length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  progressBarInner.style.width = pct + "%";
}

/* ------- Status click (only for managers) ------- */

function attachStatusHandlers(userRole) {
  const buttons = modulesBody.querySelectorAll(".status-btn");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (userRole !== "manager") {
        alert("Only managers can update training status.");
        return;
      }
      const id = btn.dataset.id;
      const module = currentModules.find((m) => m.id === id);
      if (!module) return;

      const nextStatus = nextStatusValue(module.status);
      module.status = nextStatus;
      renderModules(userRole);
    });
  });
}

function nextStatusValue(current) {
  if (current === "Not started") return "In progress";
  if (current === "In progress") return "Completed";
  return "Not started";
}

/* ------- Filter pills ------- */

const filterRow = document.getElementById("filterRow");
if (filterRow) {
  filterRow.addEventListener("click", (e) => {
    const btn = e.target.closest(".pill-filter");
    if (!btn) return;
    currentFilter = btn.dataset.filter || "all";

    filterRow.querySelectorAll(".pill-filter").forEach((b) => {
      b.classList.toggle("active", b === btn);
    });

    const sessionUser = loadSessionUser();
    const role = sessionUser?.role || "crew";
    renderModules(role);
  });
}

/* ------- Mobile sidebar toggle (if needed) ------- */

const sidebar = document.querySelector(".sidebar");
const sidebarToggle = document.getElementById("sidebarToggle");

if (sidebarToggle && sidebar) {
  sidebarToggle.addEventListener("click", () => {
    sidebar.classList.toggle("sidebar-open");
  });
}
