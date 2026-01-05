// nav.js — shared sidebar/nav logic for ALL pages
// ✅ Works from subfolders (fixes Dashboard link)
// ✅ Works with clean routes (/main) AND .html files (/main.html)
// ✅ Shows Shift Creator only for role === "shiftCreator"
// ✅ Sidebar mobile toggle
// ✅ Highlights active nav item

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
  if (!leaf) return true;             // "/" or "/something/" treated as clean
  return !leaf.includes(".html");     // "/training" etc
}

/**
 * IMPORTANT:
 * If your site is hosted under a subpath (like GitHub Pages project site),
 * set <meta name="app-base" content="/REPO_NAME"> in every page <head>.
 * Example: <meta name="app-base" content="/mctraining">
 */
function getBasePath() {
  const meta = document.querySelector('meta[name="app-base"]');
  const base = (meta?.content || "").trim();
  if (!base) return "";
  return base.endsWith("/") ? base.slice(0, -1) : base;
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
  const leaf = currentPathLeaf();

  if (!leaf) return "main.html";
  if (leaf.includes(".html")) return leaf.split("?")[0];

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
   Fix links (THIS fixes Dashboard on other pages)
========================= */

function fixSidebarHrefs() {
  const { navList } = dom();
  if (!navList) return;

  const base = getBasePath(); // "" or "/repo"
  const clean = isCleanRouteMode();

  navList.querySelectorAll("a[href]").forEach((a) => {
    const raw = (a.getAttribute("href") || "").trim();
    if (!raw) return;

    // ignore external links
    if (/^(https?:|mailto:|tel:)/i.test(raw)) return;

    // normalize like "main.html" -> "main.html" (no query/hash handling needed here)
    const href = raw.split("#")[0].split("?")[0];

    // convert to final destination
    let dest;
    if (clean) {
      dest = htmlToCleanRoute(href);
    } else {
      // make .html links root-based so they work from ANY folder
      // "main.html" -> "/main.html"
      dest = href.startsWith("/") ? href : `/${href}`;
    }

    // apply base path if any
    const finalHref = base ? `${base}${dest === "/" ? "/" : dest}` : dest;

    a.setAttribute("href", finalHref);
  });
}

/* =========================
   UI
========================= */

function setActiveNav() {
  const file = filenameForActive() || "main.html";

  document.querySelectorAll(".sidebar .nav-item").forEach((li) => {
    const a = li.querySelector("a[href]");
    const href = a ? (a.getAttribute("href") || "") : "";
    // match using the known file name
    li.classList.toggle("active", href.includes(file) || href.endsWith("/" + file.replace(".html", "")));
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
    setActiveNav();
  } catch (e) {
    console.warn("nav.js hydrateFromFirestore error:", e);
  }
}

/* =========================
   Bind events (safe)
========================= */

function bindEventsOnce() {
  const { sidebar, sidebarToggle, logoutBtn, navList } = dom();

  if (sidebarToggle && !sidebarToggle.dataset.bound) {
    sidebarToggle.addEventListener("click", () => sidebar?.classList.toggle("sidebar-open"));
    sidebarToggle.dataset.bound = "1";
  }

  // close sidebar after a click (mobile)
  if (navList && !navList.dataset.boundClose) {
    navList.addEventListener("click", (e) => {
      if (e.target.closest("a, .nav-item")) {
        sidebar?.classList.remove("sidebar-open");
      }
    });
    navList.dataset.boundClose = "1";
  }

  if (logoutBtn && !logoutBtn.dataset.bound) {
    logoutBtn.addEventListener("click", async () => {
      try { await signOut(auth); } catch {}
      localStorage.removeItem("mc_session_user");

      const base = getBasePath();
      const dest = isCleanRouteMode() ? "/" : "/index.html";
      window.location.href = base ? `${base}${dest}` : dest;
    });
    logoutBtn.dataset.bound = "1";
  }
}

/* =========================
   Init
========================= */

function initNav() {
  fixSidebarHrefs();     // ✅ IMPORTANT
  bindEventsOnce();
  setActiveNav();

  const cached = loadSessionUser();
  if (cached?.name) applyNameUI(cached.name);
  applyRoleUI(cached?.role || "crew");

  onAuthStateChanged(auth, (user) => {
    if (!user) {
      const base = getBasePath();
      const dest = isCleanRouteMode() ? "/" : "/index.html";
      window.location.href = base ? `${base}${dest}` : dest;
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
