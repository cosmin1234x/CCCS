// nav.js — shared sidebar/nav logic (mobile-safe + clean routes + role UI)
// ✅ Works with <li onclick="window.location.href='main.html'"> style nav
// ✅ Also supports clean routes (/main) on Vercel
// ✅ Shows Shift Creator only for role === "shiftCreator"
// ✅ Mobile sidebar toggle + closes after nav tap
// ✅ Active highlight works even without <a> tags

import { auth, db } from "./firebase-init.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* -------------------------
   Helpers
------------------------- */

function loadSessionUser() {
  try { return JSON.parse(localStorage.getItem("mc_session_user")); }
  catch { return null; }
}

function saveSessionUser(u) {
  localStorage.setItem("mc_session_user", JSON.stringify(u));
}

function currentPathLeaf() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] || "";
}

function isCleanRouteMode() {
  const leaf = currentPathLeaf();
  // "/" or "/main" etc => clean route
  return !leaf || !leaf.includes(".html");
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
  return map[file] || `/${String(file).replace(".html", "")}`;
}

function filenameForActive() {
  const leaf = currentPathLeaf();
  if (!leaf) return "main.html";

  // if we are on .html pages
  if (leaf.includes(".html")) return leaf.split("?")[0];

  // clean route -> map to matching html name
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

function extractHrefFromOnclick(onclickStr) {
  const s = String(onclickStr || "");

  // supports: window.location.href='x' OR location.href="x" OR window.location='x'
  let m = s.match(/window\.location\.href\s*=\s*['"]([^'"]+)['"]/i);
  if (m?.[1]) return m[1];

  m = s.match(/location\.href\s*=\s*['"]([^'"]+)['"]/i);
  if (m?.[1]) return m[1];

  m = s.match(/window\.location\s*=\s*['"]([^'"]+)['"]/i);
  if (m?.[1]) return m[1];

  return null;
}

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

/* -------------------------
   UI
------------------------- */

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

function setActiveNav() {
  const wantFile = filenameForActive();

  document.querySelectorAll(".sidebar .nav-item").forEach((li) => {
    const onclick = li.getAttribute("onclick") || "";
    const href = extractHrefFromOnclick(onclick) || "";
    li.classList.toggle("active", href.endsWith(wantFile));
  });
}

/* -------------------------
   Mobile-safe routing (ignore inline onclick)
------------------------- */

function bindNavRoutingOnce() {
  const { navList, sidebar } = dom();
  if (!navList || navList.dataset.boundRouting) return;

  navList.addEventListener("click", (e) => {
    const item = e.target.closest(".nav-item");
    if (!item) return;

    const onclick = item.getAttribute("onclick") || "";
    const href = extractHrefFromOnclick(onclick);

    // always close sidebar on tap (mobile)
    sidebar?.classList.remove("sidebar-open");

    if (!href) return; // let it behave normally if no target

    // we handle navigation ourselves (more reliable than inline onclick)
    e.preventDefault();
    e.stopPropagation();

    if (isCleanRouteMode()) {
      const dest = href.includes(".html") ? htmlToCleanRoute(href) : href;
      window.location.href = dest;
    } else {
      window.location.href = href; // .html mode
    }
  }, true);

  navList.dataset.boundRouting = "1";
}

/* -------------------------
   Firestore hydrate
------------------------- */

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

/* -------------------------
   Bind events
------------------------- */

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

/* -------------------------
   Init
------------------------- */

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
