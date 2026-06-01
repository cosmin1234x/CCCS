// Shared McTraining navbar helper
// Loads clean navbar CSS and makes the mobile menu button work on all pages.
// Desktop nav must always stay visible.

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

function isMobileNav() {
  return window.matchMedia("(max-width: 900px)").matches;
}

function getSidebarParts() {
  return {
    sidebar: document.getElementById("sidebar") || document.querySelector(".sidebar"),
    toggleBtn: document.getElementById("sidebarToggle"),
    nav: document.querySelector(".sidebar-nav")
  };
}

function clearDesktopNavStyles() {
  const { sidebar, toggleBtn, nav } = getSidebarParts();
  if (!sidebar || !nav) return;

  if (!isMobileNav()) {
    nav.style.maxHeight = "";
    nav.style.opacity = "";
    nav.style.overflow = "";
    sidebar.classList.remove("sidebar-open");
    document.body.classList.remove("sidebar-open");

    if (toggleBtn) {
      toggleBtn.textContent = "☰";
      toggleBtn.setAttribute("aria-expanded", "false");
    }
  }
}

function setSidebarOpen(forceOpen) {
  const { sidebar, toggleBtn, nav } = getSidebarParts();
  if (!sidebar || !toggleBtn) return;

  // On desktop, never hide the nav with inline styles.
  if (!isMobileNav()) {
    clearDesktopNavStyles();
    return;
  }

  const shouldOpen = typeof forceOpen === "boolean" ? forceOpen : !sidebar.classList.contains("sidebar-open");

  sidebar.classList.toggle("sidebar-open", shouldOpen);
  document.body.classList.toggle("sidebar-open", shouldOpen);
  toggleBtn.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
  toggleBtn.textContent = shouldOpen ? "✕" : "☰";

  if (nav) {
    if (shouldOpen) {
      nav.style.maxHeight = `${nav.scrollHeight + 64}px`;
      nav.style.opacity = "1";
      nav.style.overflow = "visible";
    } else {
      nav.style.maxHeight = "0px";
      nav.style.opacity = "0";
      nav.style.overflow = "hidden";
    }
  }
}

function setupSidebarToggle() {
  const { sidebar, toggleBtn, nav } = getSidebarParts();
  if (!sidebar || !toggleBtn) return;

  toggleBtn.type = "button";
  toggleBtn.setAttribute("aria-label", "Open menu");
  toggleBtn.setAttribute("aria-expanded", "false");

  // Initial state: only hide nav on mobile. Keep desktop visible.
  if (nav) {
    if (isMobileNav() && !sidebar.classList.contains("sidebar-open")) {
      nav.style.maxHeight = "0px";
      nav.style.opacity = "0";
      nav.style.overflow = "hidden";
    } else {
      nav.style.maxHeight = "";
      nav.style.opacity = "";
      nav.style.overflow = "";
    }
  }

  const handleToggle = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setSidebarOpen();
  };

  if (toggleBtn.dataset.navToggleAttached !== "1") {
    toggleBtn.dataset.navToggleAttached = "1";
    toggleBtn.addEventListener("click", handleToggle);
    toggleBtn.addEventListener("touchend", handleToggle, { passive: false });
  }

  if (document.body.dataset.navCloseAttached !== "1") {
    document.body.dataset.navCloseAttached = "1";
    document.addEventListener("click", (event) => {
      const clickedLink = event.target.closest(".sidebar .nav-link");
      if (clickedLink && isMobileNav()) setSidebarOpen(false);
    });
  }

  window.addEventListener("resize", () => {
    const { sidebar: s, toggleBtn: btn, nav: n } = getSidebarParts();
    if (!s || !n) return;

    if (!isMobileNav()) {
      n.style.maxHeight = "";
      n.style.opacity = "";
      n.style.overflow = "";
      s.classList.remove("sidebar-open");
      document.body.classList.remove("sidebar-open");
      if (btn) {
        btn.textContent = "☰";
        btn.setAttribute("aria-expanded", "false");
      }
    } else if (!s.classList.contains("sidebar-open")) {
      n.style.maxHeight = "0px";
      n.style.opacity = "0";
      n.style.overflow = "hidden";
    }
  });
}

function getStoredUser() {
  const keys = ["mcUser", "currentUser", "user", "mctrainingUser", "mc_session_user"];

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
      localStorage.removeItem("mc_session_user");
    } catch {
      // ignore
    }

    window.location.href = "index.html";
  });
}

function initNav() {
  loadCleanNavbarCss();
  setupSidebarToggle();
  clearDesktopNavStyles();
  setupUserUi();
  setupLogout();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initNav);
} else {
  initNav();
}