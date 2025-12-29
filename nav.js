// nav.js — shared sidebar/nav logic for ALL pages (bulletproof + clean routes support)
// ✅ Shows Shift Creator only for role === "shiftCreator"
// ✅ Sidebar mobile toggle
// ✅ Highlights active nav item (supports /main AND main.html)
// ✅ Sets sidebar user name/role if elements exist
// ✅ Overrides inline onclick routing so mobile clean routes work

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
  // returns "main", "main.html", "training", etc (no query)
  const leaf = (window.location.pathname.split("/").filter(Boolean).pop() || "");
  return leaf.split("?")[0];
}

function isUsingCleanRoutes() {
  // If you're on /main or /training (no .html), treat as clean routes
  const leaf = currentPathLeaf();
  if (!leaf) return true; // root -> treat as clean
  return !leaf.includes(".html");
}

function toRoute(fileOrPath) {
  // fileOrPath might be "main.html" or "/main" etc
  const raw = String(fileOrPath || "").trim();

  // If already absolute (/main) just use it
  if (raw.startsWith("/")) return raw;

  // Convert "main.html" -> "/main" on clean routes, otherwise keep "main.html"
  const clean = raw.replace(".html", "");
  return isUsingCleanRoutes() ? `/${clean}` : raw;
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
   Routing: override inline onclick links
========================= */

function bindNavRoutingOnce() {
  // Convert <li onclick="window.location.href='main.html'"> into real click handlers
  document.querySelectorAll(".sidebar .nav-item").forEach((li) => {
    if (li.dataset.navBound === "1") return;

    const onClick = li.getAttribute("onclick") || "";
    const match = onClick.match(/window\.location\.href\s*=\s*['"]([^'"]+)['"]/);

    if (!match) {
      li.dataset.navBound = "1";
      return;
    }

    const target = match[1]; // e.g. main.html
    li.removeAttribute("onclick");

    li.addEventListener("click", () => {
      window.location.href = toRoute(target);
    });

    li.dataset.navBound = "1";
  });
}

/* =========================
   Active nav highlighting
========================= */

function setActiveNav() {
  const leaf = currentPathLeaf();     // "main" or "main.html"
  const cleanLeaf = leaf.replace(".html", "");

  const targets = {
    main: ["main", "main.html"],
    training: ["training", "training.html"],
    schedule: ["schedule", "schedule.html"],
    "break-rewards": ["break-rewards", "break-rewards.html"],
    wrapped: ["wrapped", "wrapped.html"],
    "shifts-admin": ["shifts-admin", "shifts-admin.html"],
    // add more pages here if needed
  };

  // Find which key matches current leaf
  const pageKey = Object.keys(targets).find((k) => targets[k].includes(cleanLeaf) || targets[k].includes(leaf));
  if (!pageKey) return;

  const possibles = targets[pageKey]; // array of matching forms

  document.querySelectorAll(".sidebar .nav-item").forEach((li) => {
    // We bound click handlers, but some pages might still have inline onclick (older)
    const onClick = li.getAttribute("onclick") || "";
    const isMatch =
      possibles.some((p) => onClick.includes(`'${p}'`) || onClick.includes(`"${p}"`)) ||
      // also match our bound handler via dataset target (fallback)
      possibles.some((p) => (li.dataset.navTarget || "").includes(p));

    // If we removed onclick, detect using inner navigation target from our regex
    // (We can store it once if we want)
    li.classList.toggle("active", isMatch);
  });

  // Better: since onclick can be removed, do a smarter "active" set based on actual route mapping:
  // We'll attempt to match by comparing the intended route of the onclick target if present.
  document.querySelectorAll(".sidebar .nav-item").forEach((li) => {
    const onClick2 = li.getAttribute("onclick") || "";
    const match2 = onClick2.match(/window\.location\.href\s*=\s*['"]([^'"]+)['"]/);
    const rawTarget = match2 ? match2[1] : null;
    if (!rawTarget) return;

    const rawLeaf = String(rawTarget).split("/").pop().replace(".html", "");
    const shouldBeActive = rawLeaf === cleanLeaf;
    li.classList.toggle("active", shouldBeActive);
  });
}

/* =========================
   Role UI
========================= */

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

    // Re-bind after role might reveal shift creator nav item
    bindNavRoutingOnce();
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
      window.location.href = toRoute("index.html");
    });
    logoutBtn.dataset.bound = "1";
  }
}

/* =========================
   Init
========================= */

function initNav() {
  bindEventsOnce();

  // ✅ critical: make sidebar items work on clean routes
  bindNavRoutingOnce();

  setActiveNav();

  // fast path: cached session
  const cached = loadSessionUser();
  if (cached?.name) applyNameUI(cached.name);
  applyRoleUI(cached?.role || "crew");

  // accurate path: auth + firestore
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.href = toRoute("index.html");
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
