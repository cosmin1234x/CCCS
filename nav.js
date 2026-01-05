// nav.js — shared sidebar/nav logic for ALL pages (routes + role UI)
// ✅ Shows Shift Creator only for role === "shiftCreator"
// ✅ Sidebar mobile toggle
// ✅ Highlights active nav item
// ✅ Fixes navigation on hosted clean routes (/main) even if HTML uses main.html
// ✅ Works with BOTH <a href="..."> links AND onclick="location.href='...'"
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
  const leaf = currentPathLeaf();
  if (!leaf) return true;
  return !leaf.includes(".html");
}

function htmlToCleanRoute(file) {
  const map = {
    "main.html": "/main",
    "training.html": "/train",        // <-- change if your real route is different
    "schedule.html": "/schedule",     // <-- change if your real route is /shifts
    "break-rewards.html": "/break-rewards",
    "shifts-admin.html": "/shifts-admin",
    "wrapped.html": "/wrapped",
    "index.html": "/",
  };
  return map[file] || (file.startsWith("/") ? file : `/${file.replace(".html", "")}`);
}

function filenameForActive() {
  const leaf = currentPathLeaf();

  if (!leaf) return "main.html";
  if (leaf.includes(".html")) return leaf.split("?")[0];

  const map = {
    "main": "main.html",
    "train": "training.html",
    "training": "training.html",
    "schedule": "schedule.html",
    "shifts": "schedule.html",
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
  // ✅ FIXED: use filenameForActive() (not filename())
  const file = filenameForActive() || "main.html";

  document.querySelectorAll(".sidebar .nav-item").forEach((li) => {
    const a = li.querySelector("a[href]");
    const href = a ? (a.getAttribute("href") || "") : "";
    // match by ending filename
    li.classList.toggle("active", href.endsWith(file));
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
   Routing fix (clean routes + mobile)
========================= */

function extractHrefFromOnclick(onclickStr) {
  const s = String(onclickStr || "");

  const m1 = s.match(/location\.href\s*=\s*['"]([^'"]+)['"]/i);
  if (m1?.[1]) return m1[1];

  const m2 = s.match(/window\.location\.href\s*=\s*['"]([^'"]+)['"]/i);
  if (m2?.[1]) return m2[1];

  const m3 = s.match(/window\.location\s*=\s*['"]([^'"]+)['"]/i);
  if (m3?.[1]) return m3[1];

  return null;
}

function getNavDestination(item) {
  // Prefer <a href>
  const a = item.querySelector("a[href]");
  const href = a ? a.getAttribute("href") : null;
  if (href) return href;

  // fallback: onclick
  const onclick = item.getAttribute("onclick") || "";
  return extractHrefFromOnclick(onclick);
}

function bindNavRoutingOnce() {
  const { navList, sidebar } = dom();
  if (!navList || navList.dataset.boundRouting) return;

  navList.addEventListener("click", (e) => {
    const item = e.target.closest(".nav-item");
    if (!item) return;

    // let logout work
    if (item.id === "logoutBtn") return;

    const destRaw = getNavDestination(item);
    if (!destRaw) return;

    // Only intercept in clean-route hosting mode
    if (isCleanRouteMode()) {
      const dest = destRaw.includes(".html") ? htmlToCleanRoute(destRaw) : destRaw;
      e.preventDefault();
      e.stopPropagation();
      window.location.href = dest;
      sidebar?.classList.remove("sidebar-open");
      return;
    }

    // in .html mode, let <a> work naturally
    sidebar?.classList.remove("sidebar-open");
  }, true);

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
