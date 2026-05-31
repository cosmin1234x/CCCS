// Shared McTraining navbar helper
// Loads the clean navbar CSS on pages that use nav.js.

function loadCleanNavbarCss() {
  const href = "nav-clean.css";
  const alreadyLoaded = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
    .some((link) => (link.getAttribute("href") || "").includes(href));

  if (alreadyLoaded) return;

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

function setupSidebarToggle() {
  const sidebar = document.getElementById("sidebar") || document.querySelector(".sidebar");
  const toggleBtn = document.getElementById("sidebarToggle");

  if (!sidebar || !toggleBtn) return;

  toggleBtn.addEventListener("click", () => {
    sidebar.classList.toggle("sidebar-open");
  });
}

function getStoredUser() {
  const keys = ["mcUser", "currentUser", "user", "mctrainingUser"];

  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // ignore bad localStorage data
    }
  }

  return {};
}

function setupUserUi() {
  const user = getStoredUser();
  const name = user.name || user.displayName || user.username || localStorage.getItem("userName") || "User Name";
  const role = user.role || localStorage.getItem("userRole") || "Crew Member";

  const nameEl = document.getElementById("sidebarUserName");
  const roleEl = document.getElementById("sidebarUserRole");
  const roleBadge = document.getElementById("roleBadge");
  const avatar = document.getElementById("avatarCircle");

  if (nameEl) nameEl.textContent = name;
  if (roleEl) roleEl.textContent = role;
  if (roleBadge) roleBadge.textContent = role.toUpperCase().includes("CREATOR") ? "CREATOR" : role.toUpperCase().includes("MANAGER") ? "MANAGER" : "CREW";
  if (avatar) avatar.textContent = String(name).trim().charAt(0).toUpperCase() || "U";

  const navShiftCreator = document.getElementById("navShiftCreator");
  if (navShiftCreator) {
    const canSeeShiftCreator = /creator|manager|admin/i.test(role);
    navShiftCreator.style.display = canSeeShiftCreator ? "" : "none";
  }
}

function setupLogout() {
  const logoutBtn = document.getElementById("logoutBtn");
  if (!logoutBtn) return;

  logoutBtn.addEventListener("click", () => {
    try {
      localStorage.removeItem("mcUser");
      localStorage.removeItem("currentUser");
      localStorage.removeItem("mctrainingUser");
    } catch {
      // ignore
    }

    window.location.href = "index.html";
  });
}

loadCleanNavbarCss();

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    setupSidebarToggle();
    setupUserUi();
    setupLogout();
  });
} else {
  setupSidebarToggle();
  setupUserUi();
  setupLogout();
}
