// nav.js — shared sidebar/nav logic for ALL pages (bulletproof)
// ✅ Shows Shift Creator only for role === "shiftCreator"
// ✅ Sidebar mobile toggle
// ✅ Highlights active nav item (by current filename)
// ✅ Sets sidebar user name/role if elements exist
// ✅ Runs safely even if DOM isn't ready yet

import { auth, db } from "./firebase-init.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* =========================
   Helpers
========================= */

function loadSessionUser() {
  try { return JSON.parse(localStorage.getItem("mc_session_user")); }
  catch { return null; }
}

function saveSessionUser(u) {
  localStorage.setItem("mc_session_user", JSON.stringify(u));
}

function filename() {
  const p = window.location.pathname.split("/").pop() || "";
  return p.split("?")[0];
}

/* =========================
   DOM getters (safe)
========================= */

function dom() {
  return {
    sidebar: document.querySelector(".sidebar"),
    sidebarToggle: document.getElementById("sidebarToggle"),
    navShiftCreator: document.getElementById("navShiftCreator"),
    sidebarUserName: document.getElementById("sidebarUserName"),
    sidebarUserRole: document.getElementById("sidebarUserRole"),
    logoutBtn: document.getElementById("logoutBtn"),
  };
}

/* =========================
   UI
========================= */

function setActiveNav() {
  const file = filename();

  const targets = {
    "main.html": "main.html",
    "training.html": "training.html",
    "schedule.html": "schedule.html",
    "break-rewards.html": "break-rewards.html",
    "wrapped.html": "wrapped.html",
    "shifts-admin.html": "shifts-admin.html",
  };

  const want = targets[file];
  if (!want) return;

  document.querySelectorAll(".sidebar .nav-item").forEach((li) => {
    const onClick = li.getAttribute("onclick") || "";
    const isMatch = onClick.includes(`'${want}'`) || onClick.includes(`"${want}"`);
    li.classList.toggle("active", isMatch);
  });
}

function applyRoleUI(role) {
  const { navShiftCreator, sidebarUserRole } = dom();
  const r = String(role || "crew");

  if (navShiftCreator) {
    navShiftCreator.style.display = (r === "shiftCreator") ? "" : "none";
  }

  if (sidebarUserRole) {
    if (r === "crew") sidebarUserRole.textContent = "Crew Member";
    else if (r === "shiftCreator") sidebarUserRole.textContent = "Shift Creator";
    else sidebarUserRole.textContent = "Restaurant Manager";
  }
}

function applyNameUI(name) {
  const { sidebarUserName } = dom();
  if (sidebarUserName && name) sidebarUserName.textContent = name;
}

/* =========================
   Firestore hydrate
========================= */

async function hydrateFromFirestore(firebaseUser) {
  try {
    const snap = await getDoc(doc(db, "users", firebaseUser.uid));
    if (!snap.exists()) return;

    const d = snap.data() || {};
    const session = loadSessionUser() || {};

    const merged = {
      id: firebaseUser.uid,
      name: d.name || session.name || firebaseUser.displayName || firebaseUser.email || "User",
      role: d.role || session.role || "crew",
      storeId: d.storeId || session.storeId || "store001"
    };

    saveSessionUser(merged);

    applyNameUI(merged.name);
    applyRoleUI(merged.role);
    setActiveNav(); // re-run after UI is sure
  } catch (e) {
    console.warn("nav.js hydrateFromFirestore error:", e);
  }
}

/* =========================
   Bind events (safe)
========================= */

function bindEventsOnce() {
  const { sidebar, sidebarToggle, logoutBtn } = dom();

  if (sidebarToggle && !sidebarToggle.dataset.bound) {
    sidebarToggle.addEventListener("click", () => sidebar?.classList.toggle("sidebar-open"));
    sidebarToggle.dataset.bound = "1";
  }

  if (logoutBtn && !logoutBtn.dataset.bound) {
    logoutBtn.addEventListener("click", async () => {
      try { await signOut(auth); } catch {}
      localStorage.removeItem("mc_session_user");
      window.location.href = "index.html";
    });
    logoutBtn.dataset.bound = "1";
  }
}

/* =========================
   Init (runs even if DOM not ready)
========================= */

function initNav() {
  bindEventsOnce();
  setActiveNav();

  // fast path: cached session
  const cached = loadSessionUser();
  if (cached?.name) applyNameUI(cached.name);
  applyRoleUI(cached?.role || "crew");

  // accurate path: auth + firestore
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.href = "index.html";
      return;
    }
    hydrateFromFirestore(user);
  });
}

// If nav.js is loaded before DOM exists, wait.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initNav);
} else {
  initNav();
}
