// nav.js — shared sidebar/nav logic for ALL pages (routes + role UI)
// ✅ Shows Shift Creator only for role === "shiftCreator"
// ✅ Sidebar mobile toggle
// ✅ Highlights active nav item
// ✅ Fixes navigation on hosted clean routes (/main) even if HTML uses main.html
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

function currentPathLeaf() {
  const p = window.location.pathname.split("/").filter(Boolean);
  return p[p.length - 1] || "";
}

function isCleanRouteMode() {
  // If you're on /main or /training etc, you're in clean route mode
  const leaf = currentPathLeaf();
  if (!leaf) return true;
  return !leaf.includes(".html");
}

function htmlToCleanRoute(file) {
  const map = {
    "main.html": "/main",
    "training.html": "/training",
    "schedule.html": "/schedule",
    "break-rewards.html": "/break-rewards",
    "shifts-admin.html": "/shifts-admin",
    "wrapped.html": "/wrapped",
    "index.html": "/",
  };
  return map[file] || (file.startsWith("/") ? file : `/${file.replace(".html", "")}`);
}

function filenameForActive() {
  // Normalize active nav even on clean routes
  const leaf = currentPathLeaf();

  if (!leaf) return "main.html"; // root -> treat as dashboard
  if (leaf.includes(".html")) return leaf.split("?")[0];

  // clean route mode
  const map = {
    "main": "main.html",
    "training": "training.html",
    "schedule": "schedule.html",
    "break-rewards": "break-rewards.html",
    "shifts-admin": "shifts-admin.html",
    "wrapped": "wrapped.html",
  };
  return map[leaf.split("?")[0]] || "main.html";
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
    navList: document.querySelector(".sidebar .nav-list"),
  };
}

/* =========================
   UI
========================= */

function setActiveNav() {
  const file = filenameForActive();

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
    const isMatch =
      onClick.includes(`'${want}'`) ||
      onClick.includes(`"${want}"`);
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
   Routing fix (THIS fixes mobile)
========================= */

function extractHrefFromOnclick(onclickStr) {
  // supports: window.location.href='x' OR location.href="x" OR window.location='x'
  const s = String(onclickStr || "");

  const m1 = s.match(/location\.href\s*=\s*['"]([^'"]+)['"]/i);
  if (m1?.[1]) return m1[1];

  const m2 = s.match(/window\.location\.href\s*=\s*['"]([^'"]+)['"]/i);
  if (m2?.[1]) return m2[1];

  const m3 = s.match(/window\.location\s*=\s*['"]([^'"]+)['"]/i);
  if (m3?.[1]) return m3[1];

  return null;
}

function bindNavRoutingOnce() {
  const { navList, sidebar } = dom();
  if (!navList || navList.dataset.boundRouting) return;

  navList.addEventListener("click", (e) => {
    const item = e.target.closest(".nav-item");
    if (!item) return;

    // let logout button work normally
    if (item.id === "logoutBtn") return;

    const onclick = item.getAttribute("onclick") || "";
    const href = extractHrefFromOnclick(onclick);
    if (!href) return; // fallback to original behavior

    // If hosted clean routes, convert main.html -> /main
    if (isCleanRouteMode()) {
      const dest = href.includes(".html") ? htmlToCleanRoute(href) : href;
      e.preventDefault();
      e.stopPropagation();
      window.location.href = dest;
      return;
    }

    // Local .html mode – allow default onclick navigation
  }, true);

  // also close sidebar after clicking (nice on mobile)
  navList.addEventListener("click", (e) => {
    const item = e.target.closest(".nav-item");
    if (!item) return;
    sidebar?.classList.remove("sidebar-open");
  });

  navList.dataset.boundRouting = "1";
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
    setActiveNav();
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
      window.location.href = isCleanRouteMode() ? "/" : "index.html";
    });
    logoutBtn.dataset.bound = "1";
  }
}

/* =========================
   Init
========================= */

function initNav() {
  bindEventsOnce();
  bindNavRoutingOnce();
  setActiveNav();

  const cached = loadSessionUser();
  if (cached?.name) applyNameUI(cached.name);
  applyRoleUI(cached?.role || "crew");

  onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.href = isCleanRouteMode() ? "/" : "index.html";
      return;
    }
    hydrateFromFirestore(user);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initNav);
} else {
  initNav();
}
