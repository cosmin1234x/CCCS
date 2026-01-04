// nav.js — shared sidebar/nav logic for ALL pages (routes + role UI)
// ✅ Works with BOTH <li onclick="..."> AND <a href="...">
// ✅ Converts .html links to clean routes when hosted (/main, /train, etc.)
// ✅ Sidebar mobile toggle
// ✅ Highlights active nav item
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
  // clean route mode: /main, /train, /schedule ...
  const leaf = currentPathLeaf();
  if (!leaf) return true;                 // root
  return !leaf.includes(".html");         // not an html file
}

function htmlToCleanRoute(file) {
  const map = {
    "main.html": "/main",
    "training.html": "/train",            // IMPORTANT: your hosted route is /train (from your screenshot)
    "schedule.html": "/schedule",
    "break-rewards.html": "/break-rewards",
    "shifts-admin.html": "/shifts-admin",
    "wrapped.html": "/wrapped",
    "index.html": "/",
  };
  if (!file) return "/main";

  // normalize
  const f = String(file).split("?")[0].replace(/^\.\//, "");
  return map[f] || `/${f.replace(".html", "")}`;
}

function cleanRouteToHtml(leaf) {
  const map = {
    "main": "main.html",
    "train": "training.html",
    "training": "training.html",
    "schedule": "schedule.html",
    "break-rewards": "break-rewards.html",
    "shifts-admin": "shifts-admin.html",
    "wrapped": "wrapped.html",
  };
  const l = String(leaf || "").split("?")[0];
  return map[l] || "main.html";
}

function filenameForActive() {
  const leaf = currentPathLeaf();

  // root => treat as dashboard
  if (!leaf) return "main.html";

  // html mode
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
  const file = filenameForActive() || "main.html";

  document.querySelectorAll(".sidebar .nav-item").forEach((li) => {
    // support either <a href> OR li onclick
    const a = li.querySelector("a[href]");
    const href = a ? (a.getAttribute("href") || "") : "";
    const onclick = li.getAttribute("onclick") || "";

    let target = href || extractHrefFromOnclick(onclick) || "";
    target = String(target).split("?")[0].replace(/^\.\//, "");

    li.classList.toggle("active", target.endsWith(file));
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
  const s = String(onclickStr || "");

  const m1 = s.match(/location\.href\s*=\s*['"]([^'"]+)['"]/i);
  if (m1?.[1]) return m1[1];

  const m2 = s.match(/window\.location\.href\s*=\s*['"]([^'"]+)['"]/i);
  if (m2?.[1]) return m2[1];

  const m3 = s.match(/window\.location\s*=\s*['"]([^'"]+)['"]/i);
  if (m3?.[1]) return m3[1];

  return null;
}

function getNavDestinationFromItem(navItem) {
  // Priority: <a href> then onclick
  const a = navItem.querySelector("a[href]");
  const href = a ? a.getAttribute("href") : null;
  if (href) return href;

  const onclick = navItem.getAttribute("onclick") || "";
  return extractHrefFromOnclick(onclick);
}

function rewriteAnchorHrefsForCleanRoutes() {
  // Important for hosted mode so links behave normally (open in new tab, etc.)
  if (!isCleanRouteMode()) return;

  document.querySelectorAll(".sidebar .nav-item a[href]").forEach((a) => {
    const raw = a.getAttribute("href") || "";
    if (raw.includes(".html")) {
      a.setAttribute("href", htmlToCleanRoute(raw));
    }
  });
}

/* =========================
   Bind nav routing
========================= */

function bindNavRoutingOnce() {
  const { navList, sidebar } = dom();
  if (!navList || navList.dataset.boundRouting) return;

  // Capture click so we can override both <a> and onclick li
  navList.addEventListener("click", (e) => {
    const item = e.target.closest(".nav-item");
    if (!item) return;

    // logout button is separate element, but just in case:
    if (item.id === "logoutBtn") return;

    const destRaw = getNavDestinationFromItem(item);
    if (!destRaw) return;

    // Hosted clean routes: convert .html -> /route
    if (isCleanRouteMode()) {
      const dest = destRaw.includes(".html") ? htmlToCleanRoute(destRaw) : destRaw;
      e.preventDefault();
      e.stopPropagation();
      window.location.href = dest;
    }
    // html mode: allow default navigation
  }, true);

  // close sidebar after clicking on mobile
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

    // after role changes, re-run active marking
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

  // IMPORTANT: rewrite links so they work in clean routes AND allow open-in-new-tab
  rewriteAnchorHrefsForCleanRoutes();

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
