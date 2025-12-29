// nav.js — shared sidebar/nav logic for ALL pages (routes + role UI)
// ✅ Works with BOTH <a href="x.html"> and old onclick="window.location.href='x.html'"
// ✅ Clean-route hosted mode: /main, /training, /schedule, /break-rewards, /shifts-admin
// ✅ HTML mode: main.html, training.html, schedule.html, break-rewards.html, shifts-admin.html
// ✅ Shows Shift Creator only for role === "shiftCreator"
// ✅ Sidebar mobile toggle + closes after click
// ✅ Highlights active nav item
// ✅ Safe if DOM not ready

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
  if (!leaf) return true; // root
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
  const f = (file || "").split("?")[0];
  return map[f] || (f.startsWith("/") ? f : `/${f.replace(".html", "")}`);
}

function cleanRouteToHtml(leaf) {
  const map = {
    "main": "main.html",
    "training": "training.html",
    "schedule": "schedule.html",
    "break-rewards": "break-rewards.html",
    "shifts-admin": "shifts-admin.html",
    "wrapped": "wrapped.html",
    "": "main.html",
  };
  return map[(leaf || "").split("?")[0]] || "main.html";
}

function filenameForActive() {
  // Normalize active nav even on clean routes
  const leaf = currentPathLeaf();

  if (!leaf) return "main.html"; // root -> dashboard
  if (leaf.includes(".html")) return leaf.split("?")[0];

  // clean route mode
  return cleanRouteToHtml(leaf);
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

  document.querySelectorAll(".sidebar .nav-item").forEach((li) => {
    // support both <a href> and onclick
    const a = li.querySelector("a[href]");
    const href = a ? (a.getAttribute("href") || "") : "";

    let liFile = "";
    if (href) liFile = href.split("?")[0];
    else {
      const onclick = li.getAttribute("onclick") || "";
      const extracted = extractHrefFromOnclick(onclick);
      liFile = extracted ? extracted.split("?")[0] : "";
    }

    li.classList.toggle("active", liFile.endsWith(file));
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
   Routing helpers
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

function resolveNavDestination(rawHref) {
  if (!rawHref) return null;

  // if hosted clean routes, convert *.html -> /route
  if (isCleanRouteMode()) {
    if (rawHref.includes(".html")) return htmlToCleanRoute(rawHref);
    if (rawHref.startsWith("/")) return rawHref;
    return `/${rawHref}`;
  }

  // if local html mode, keep *.html
  return rawHref;
}

function bindNavRoutingOnce() {
  const { navList, sidebar } = dom();
  if (!navList || navList.dataset.boundRouting) return;

  navList.addEventListener("click", (e) => {
    const item = e.target.closest(".nav-item");
    if (!item) return;

    // let logout button work normally
    if (item.id === "logoutBtn") return;

    // 1) prefer <a href> if present
    const a = item.querySelector("a[href]");
    const hrefFromA = a ? (a.getAttribute("href") || "") : "";

    // 2) fallback to onclick
    const onclick = item.getAttribute("onclick") || "";
    const hrefFromOnclick = extractHrefFromOnclick(onclick);

    const rawHref = hrefFromA || hrefFromOnclick;
    const dest = resolveNavDestination(rawHref);

    if (!dest) return;

    // if clicking an <a>, prevent browser going to /training.html on hosted mode
    e.preventDefault();
    e.stopPropagation();

    window.location.href = dest;
  }, true);

  // close sidebar after clicking (mobile)
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
