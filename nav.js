// Shared McTraining navbar helper
// Loads clean navbar CSS and makes the mobile menu button work on all pages.

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

function getSidebarParts() {
  return {
    sidebar: document.getElementById("sidebar") || document.querySelector(".sidebar"),
    toggleBtn: document.getElementById("sidebarToggle"),
    nav: document.querySelector(".sidebar-nav")
  };
}

function setSidebarOpen(forceOpen) {
  const { sidebar, toggleBtn, nav } = getSidebarParts();
  if (!sidebar || !toggleBtn) return;

  const shouldOpen = typeof forceOpen === "boolean" ? forceOpen : !sidebar.classList.contains("sidebar-open");

  sidebar.classList.toggle("sidebar-open", shouldOpen);
  document.body.classList.toggle("sidebar-open", shouldOpen);
  toggleBtn.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
  toggleBtn.textContent = shouldOpen ? "✕" : "☰";

  // Extra inline fallback for mobile browsers if CSS max-height does not update fast enough.
  if (nav) {
    if (shouldOpen) {
      nav.style.maxHeight = `${nav.scrollHeight + 48}px`;
      nav.style.opacity = "1";
    } else {
      nav.style.maxHeight = "0px";
      nav.style.opacity = "0";
    }
  }
}

function setupSidebarToggle() {
  const { sidebar, toggleBtn, nav } = getSidebarParts();
  if (!sidebar || !toggleBtn) return;

  toggleBtn.type = "button";
  toggleBtn.setAttribute("aria-label", "Open menu");
  toggleBtn.setAttribute("aria-expanded", sidebar.classList.contains("sidebar-open") ? "true" : "false");

  if (nav && !sidebar.classList.contains("sidebar-open")) {
    nav.style.maxHeight = "0px";
    nav.style.opacity = "0";
  }

  const handleToggle = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setSidebarOpen();
  };

  toggleBtn.addEventListener("click", handleToggle);
  toggleBtn.addEventListener("touchend", handleToggle, { passive: false });

  document.addEventListener("click", (event) => {
    const clickedLink = event.target.closest(".sidebar .nav-link");
    if (clickedLink && window.matchMedia("(max-width: 900px)").matches) {
      setSidebarOpen(false);
    }
  });

  window.addEventListener("resize", () => {
    const parts = getSidebarParts();
    if (!parts.sidebar || !parts.nav) return;

    if (window.matchMedia("(min-width: 901px)").matches) {
      parts.nav.style.maxHeight = "";
      parts.nav.style.opacity = "";
      parts.sidebar.classList.remove("sidebar-open");
      document.body.classList.remove("sidebar-open");
      if (parts.toggleBtn) {
        parts.toggleBtn.textContent = "☰";
        parts.toggleBtn.setAttribute("aria-expanded", "false");
      }
    }
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
  if (!logoutBtn || logoutBtn.dataset.navLogoutAttached === "1") return;

  logoutBtn.dataset.navLogoutAttached = "1";

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

function initNav() {
  loadCleanNavbarCss();
  setupSidebarToggle();
  setupUserUi();
  setupLogout();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initNav);
} else {
  initNav();
}
