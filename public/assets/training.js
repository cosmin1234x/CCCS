// training.js – Training Progress Dashboard (with Firestore stats)

import { auth, db } from "../../firebase-init.js";
import {
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* ========= DOM ELEMENTS ========= */

const sidebarUserName = document.getElementById("sidebarUserName");
const sidebarUserRole = document.getElementById("sidebarUserRole");
const avatarCircle = document.getElementById("avatarCircle");
const roleBadge = document.getElementById("roleBadge");
const logoutBtn = document.getElementById("logoutBtn");
const trainingMetrics = document.getElementById("trainingMetrics");
const stationVersatilityCard = document.getElementById("stationVersatilityCard");
const trainingProgressBar = document.getElementById("trainingProgress");
const modulesBody = document.getElementById("modulesBody");
const filterRow = document.getElementById("filterRow");
const trainingTitle = document.getElementById("trainingTitle");
const trainingSubtitle = document.getElementById("trainingSubtitle");
const modulesTitle = document.getElementById("modulesTitle");
const modulesSubtitle = document.getElementById("modulesSubtitle");
const filtersDescription = document.getElementById("filtersDescription");

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

/* ========= DEFAULT DEMO DATA (fallback if Firestore empty) ========= */

let storeTrainingStats = {
  completionPercent: 76,
  overdueCount: 5,
  recertCount: 3,
  highVersatilityCrew: 4 // crew who can run 3+ stations
};

let stationVersatility = [
  { station: "Front counter", crewCount: 7, completionPercent: 82 },
  { station: "Kitchen", crewCount: 6, completionPercent: 73 },
  { station: "Drive-thru", crewCount: 4, completionPercent: 65 },
  { station: "Drinks / McCafé", crewCount: 3, completionPercent: 71 }
];

/* Training modules table (demo, still local for now) */

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

/* ========= FIRESTORE LOAD FOR TRAINING STATS ========= */

async function loadTrainingStatsFromFirestore(storeId) {
  try {
    const ref = doc(db, "stores", storeId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      console.log("[Training] No store doc, using defaults");
      return;
    }

    const d = snap.data();

    // Store-level training numbers
    if (typeof d.trainingCompletionPercent === "number") {
      storeTrainingStats.completionPercent = d.trainingCompletionPercent;
    }
    if (typeof d.trainingOverdueCount === "number") {
      storeTrainingStats.overdueCount = d.trainingOverdueCount;
    }
    if (typeof d.trainingRecertCount === "number") {
      storeTrainingStats.recertCount = d.trainingRecertCount;
    }
    if (typeof d.trainingHighVersatilityCrew === "number") {
      storeTrainingStats.highVersatilityCrew = d.trainingHighVersatilityCrew;
    }

    // Station versatility array
    if (Array.isArray(d.stationVersatility)) {
      stationVersatility = d.stationVersatility
        .map((item) => ({
          station: item.station || "Station",
          crewCount: typeof item.crewCount === "number" ? item.crewCount : 0,
          completionPercent:
            typeof item.completionPercent === "number"
              ? item.completionPercent
              : 0
        }));
    }

    console.log("[Training] Loaded stats from Firestore:", {
      storeTrainingStats,
      stationVersatility
    });
  } catch (err) {
    console.error("[Training] Failed to load stats from Firestore:", err);
  }
}

/* ========= AUTH / INIT ========= */

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

  const isManager = sessionUser.role === "manager";
  const storeId = sessionUser.storeId || "store001";

  // If manager, pull store training stats from Firestore
  if (isManager) {
    await loadTrainingStatsFromFirestore(storeId);
  }

  // Sidebar
  if (sidebarUserName) sidebarUserName.textContent = sessionUser.name;
  if (sidebarUserRole) {
    sidebarUserRole.textContent = isManager ? "Restaurant Manager" : "Crew Member";
  }
  if (roleBadge) roleBadge.textContent = isManager ? "Manager" : "Crew";
  if (avatarCircle) {
    avatarCircle.textContent = sessionUser.name.charAt(0).toUpperCase();
  }

  // Titles text depending on role
  if (trainingTitle) {
    trainingTitle.textContent = isManager
      ? "Store training dashboard"
      : "Your training progress";
  }
  if (trainingSubtitle) {
    trainingSubtitle.textContent = isManager
      ? "See store-wide completion, overdue training and station coverage."
      : "See where you’re up to date and what’s next.";
  }
  if (modulesTitle) {
    modulesTitle.textContent = isManager ? "Store training modules" : "Your modules";
  }
  if (modulesSubtitle) {
    modulesSubtitle.textContent = isManager
      ? "Click status to update for your team."
      : "These are modules assigned to you.";
  }
  if (filtersDescription) {
    filtersDescription.textContent = isManager
      ? "Filter modules by area to see where your store needs focus."
      : "Filter your modules by area to plan your training.";
  }

  // Render training dashboard
  renderTrainingMetrics(isManager);
  renderStationVersatility(isManager);
  renderModulesTable(isManager);

  // Initialise filter handlers
  setupFilters(isManager);
});

/* Logout */

if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    await signOut(auth);
    localStorage.removeItem("mc_session_user");
    window.location.href = "index.html";
  });
}

/* ========= RENDER: METRICS CARDS ========= */

function renderTrainingMetrics(isManager) {
  if (!trainingMetrics) return;
  trainingMetrics.innerHTML = "";

  if (!isManager) {
    // Crew view: personal-style metrics (still local demo)
    const completed = allModules.filter((m) => m.status === "Completed").length;
    const total = allModules.length;
    const pct = total === 0 ? 0 : Math.round((completed / total) * 100);

    const cards = [
      {
        title: "Your completion",
        icon: "🎓",
        main: `${pct}%`,
        sub: `${completed} of ${total} modules done`
      },
      {
        title: "In progress",
        icon: "📚",
        main: `${allModules.filter((m) => m.status === "In progress").length}`,
        sub: "Modules you’re working on"
      },
      {
        title: "Not started",
        icon: "⏳",
        main: `${allModules.filter((m) => m.status === "Not started").length}`,
        sub: "Modules still to begin"
      }
    ];

    cards.forEach((c) => {
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <div class="card-header">
          <div class="card-title">${c.title}</div>
          <div class="card-icon">${c.icon}</div>
        </div>
        <div class="card-main-value">${c.main}</div>
        <div class="card-subtext">${c.sub}</div>
      `;
      trainingMetrics.appendChild(card);
    });

    updateProgressBarCrew();
    return;
  }

  // Manager view – store-wide stats (from Firestore or defaults)
  const s = storeTrainingStats;

  const cards = [
    {
      title: "Store completion",
      icon: "🎓",
      main: `${s.completionPercent}%`,
      sub: "Of core training completed"
    },
    {
      title: "Overdue trainings",
      icon: "⚠️",
      main: `${s.overdueCount}`,
      sub: "Modules past their due date"
    },
    {
      title: "Recertifications due",
      icon: "⏰",
      main: `${s.recertCount}`,
      sub: "Crew needing re-cert this month"
    },
    {
      title: "High versatility crew",
      icon: "⭐",
      main: `${s.highVersatilityCrew}`,
      sub: "Crew certified in 3+ stations"
    }
  ];

  cards.forEach((c) => {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="card-header">
        <div class="card-title">${c.title}</div>
        <div class="card-icon">${c.icon}</div>
      </div>
      <div class="card-main-value">${c.main}</div>
      <div class="card-subtext">${c.sub}</div>
    `;
    trainingMetrics.appendChild(card);
  });

  updateProgressBarManager();
}

/* ========= RENDER: STATION VERSATILITY ========= */

function renderStationVersatility(isManager) {
  if (!stationVersatilityCard) return;

  if (!isManager) {
    // For crew, show explanation instead
    stationVersatilityCard.innerHTML = `
      <div class="subsection-title">Why stations matter</div>
      <div class="subsection-sub">
        Getting certified on more stations (front counter, kitchen, drive-thru)
        helps the restaurant cover busy times and can support your progression.
      </div>
      <p style="font-size:0.8rem;color:#4b5563;margin-top:4px;">
        Talk to your manager about which station you could train on next.
      </p>
    `;
    return;
  }

  stationVersatilityCard.innerHTML = `
    <div class="subsection-title">Station versatility</div>
    <div class="subsection-sub">
      How many crew can confidently run each station, and how complete their training is.
    </div>
    <ul class="list" id="stationVersatilityList"></ul>
  `;

  const listEl = document.getElementById("stationVersatilityList");
  stationVersatility.forEach((s) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <span>
        <strong>${s.station}</strong><br>
        <small>${s.crewCount} crew trained</small>
      </span>
      <span class="badge-soft-success">${s.completionPercent}% complete</span>
    `;
    listEl.appendChild(li);
  });
}

/* ========= RENDER: MODULES TABLE ========= */

function renderModulesTable(isManager) {
  if (!modulesBody) return;
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

  if (isManager) {
    attachStatusHandlersManager();
  }

  updateProgressGeneric();
}

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

/* ========= PROGRESS BAR UPDATES ========= */

function updateProgressBarManager() {
  if (!trainingProgressBar) return;
  trainingProgressBar.style.width = storeTrainingStats.completionPercent + "%";
}

function updateProgressBarCrew() {
  if (!trainingProgressBar) return;
  const completed = allModules.filter((m) => m.status === "Completed").length;
  const total = allModules.length;
  const pct = total === 0 ? 0 : Math.round((completed / total) * 100);
  trainingProgressBar.style.width = pct + "%";
}

function updateProgressGeneric() {
  if (!sessionUser) {
    updateProgressBarCrew();
    return;
  }
  if (sessionUser.role === "manager") {
    updateProgressBarManager();
  } else {
    updateProgressBarCrew();
  }
}

/* ========= MANAGER: UPDATE STATUS HANDLERS ========= */

function attachStatusHandlersManager() {
  if (!modulesBody) return;

  modulesBody.querySelectorAll(".status-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const module = currentModules.find((m) => m.id === id);
      if (!module) return;

      const next = nextStatusValue(module.status);
      module.status = next;
      renderModulesTable(true);
    });
  });
}

function nextStatusValue(current) {
  if (current === "Not started") return "In progress";
  if (current === "In progress") return "Completed";
  return "Not started";
}

/* ========= FILTERS ========= */

function setupFilters(isManager) {
  if (!filterRow) return;

  filterRow.addEventListener("click", (e) => {
    const btn = e.target.closest(".pill-filter");
    if (!btn) return;

    currentFilter = btn.dataset.filter || "all";
    filterRow.querySelectorAll(".pill-filter").forEach((b) => {
      b.classList.toggle("active", b === btn);
    });

    renderModulesTable(isManager);
  });
}

/* ========= SIDEBAR MOBILE TOGGLE ========= */

if (sidebar && sidebarToggle) {
  sidebarToggle.addEventListener("click", () => {
    sidebar.classList.toggle("sidebar-open");
  });
}
