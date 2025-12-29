// nav.js — shared sidebar/nav logic for ALL pages (CLEAN ROUTES + HTML)
// ✅ Shift Creator only for role === "shiftCreator"
// ✅ Sidebar mobile toggle
// ✅ Works on Vercel clean routes (/main) AND local html (main.html)
// ✅ Active nav highlight
// ✅ No reliance on <a> tags; works with your <li onclick="...">

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

function currentLeaf() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  return (parts[parts.length - 1] || "").split("?")[0];
}

function isCleanRouteMode() {
  const leaf = currentLeaf();
  if (!leaf) return true;             // "/" (root)
  return !leaf.includes(".html");     // "/main" style
}

function htmlToCleanRoute(file) {
  const map = {
    "main.html": "/main",
    "training.html": "/training",
    "schedule.html": "/schedule",
    "break-rewards.html": "/break-rewards",
    "shifts-admin.html": "/shifts-admin",
    "wrapped.html": "/wrapped",
    "index.html": "/"
  };
  return map[file] || `/${String(file).replace(".html", "")}`;
}

function routeToHtml(routeLeaf) {
  const map = {
    "": "main.html",
    "main": "main.html",
    "training": "training.html",
    "schedule": "schedule.html",
    "break-rewards": "break-rewards.html",
    "shifts-admin": "shifts-admin.html",
    "wrapped": "wrapped.html"
  };
  return map[routeLeaf] || "main.html";
}

function activeKey() {
  // returns "main.html" etc so we can highlight consistently
  const leaf = currentLeaf();

  if (!leaf) return "main.html"; // root
  if (leaf.includes(".html")) return leaf.split("?")[0];
  return routeToHtml(leaf.split("?")[0]);
}

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

/* =========================
   DOM
========================= */

function dom() {
  return {
    sidebar: document.querySelector(".sidebar"),
    sidebarToggle: document.getElementById("sidebarToggle"),
    navList: document.querySelector(".sidebar .nav-list"),
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
  const want = activeKey();

  document.querySelectorAll(".sidebar .nav-item").forEach((li) => {
    const onclick = li.getAttribute("onclick") || "";
    const href = extractHrefFromOnclick(onclick);
    li.classList.toggle("active", href === want);
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
   Click routing (fixes /break-rewards -> main)
========================= */

function bindNavRoutingOnce() {
  const { navList, sidebar } = dom();
  if (!navList || navList.dataset.boundRouting) return;

  navList.addEventListener("click", (e) => {
    const item = e.target.closest(".nav-item");
    if (!item) return;

    const onclick = item.getAttribute("onclick") || "";
    const href = extractHrefFromOnclick(onclick);
    if (!href) return;

    // ALWAYS handle navigation ourselves (consistent everywhere)
    e.preventDefault();
    e.stopPropagation();

    const dest = isCleanRouteMode()
      ? (href.includes(".html") ? htmlToCleanRoute(href) : href)
      : href;

    // close sidebar on mobile
    sidebar?.classList.remove("sidebar-open");

    window.location.href = dest;
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
   Bind events
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
