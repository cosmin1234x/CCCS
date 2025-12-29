// nav.js — shared sidebar/nav logic for ALL pages
// ✅ Shows Shift Creator only for role === "shiftCreator"
// ✅ Sidebar mobile toggle
// ✅ Highlights active nav item (by current filename)
// ✅ (Optional) sets sidebar user name/role if elements exist

import { auth, db } from "./firebase-init.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const sidebar = document.querySelector(".sidebar");
const sidebarToggle = document.getElementById("sidebarToggle");

const navShiftCreator = document.getElementById("navShiftCreator");
const sidebarUserName = document.getElementById("sidebarUserName");
const sidebarUserRole = document.getElementById("sidebarUserRole");
const logoutBtn = document.getElementById("logoutBtn");

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

function setActiveNav() {
  const file = filename();

  // Map filenames to nav hrefs used in onclick handlers
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
  // Shift Creator visibility
  if (navShiftCreator) {
    navShiftCreator.style.display = (role === "shiftCreator") ? "" : "none";
  }

  // Sidebar role label
  if (sidebarUserRole) {
    if (role === "crew") sidebarUserRole.textContent = "Crew Member";
    else if (role === "shiftCreator") sidebarUserRole.textContent = "Shift Creator";
    else sidebarUserRole.textContent = "Restaurant Manager";
  }
}

async function hydrateFromFirestore(firebaseUser) {
  // Try to keep sidebar name/role accurate on ALL pages
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

    if (sidebarUserName) sidebarUserName.textContent = merged.name;
    applyRoleUI(merged.role);
  } catch (e) {
    console.warn("nav.js hydrateFromFirestore error:", e);
  }
}

/* =========================
   Bind events
========================= */

sidebarToggle?.addEventListener("click", () => {
  sidebar?.classList.toggle("sidebar-open");
});

logoutBtn?.addEventListener("click", async () => {
  try { await signOut(auth); } catch {}
  localStorage.removeItem("mc_session_user");
  window.location.href = "index.html";
});

/* =========================
   Init
========================= */

// set active nav immediately
setActiveNav();

// apply role from cached session immediately (fast)
const cached = loadSessionUser();
if (cached?.name && sidebarUserName) sidebarUserName.textContent = cached.name;
applyRoleUI(cached?.role || "crew");

// confirm with Firebase auth + Firestore (accurate)
onAuthStateChanged(auth, (user) => {
  if (!user) {
    // if not logged in, bounce
    window.location.href = "index.html";
    return;
  }
  hydrateFromFirestore(user);
});
