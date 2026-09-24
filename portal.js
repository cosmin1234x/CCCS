import {
  loadData as loadPortalData,
  api as portalApi,
} from "./portal-enhancements.js";
import {
  managerRole,
  isoDate,
  weekDates,
  escapeHTML as esc,
  weekOffsetOf,
} from "./portal-core.js";
import { renderPage } from "./portal-pages.js";
import { bindPage, updateBell, isPageBusy } from "./pages-ui.js";
import { clampOffset } from "./pages-views.js";
import {
  buildPreviewData,
  loadPreviewState,
  savePreviewState,
} from "./preview-data.js";
import {
  showToast,
  setButtonState,
  shake,
  leaveTo,
  openDialog,
  closeDialog,
  authErrorMessage,
} from "./motion.js";
const $ = (id) => document.getElementById(id);
const icons = {
  home: "M3 10 12 3l9 7v11h-6v-7H9v7H3Z",
  calendar:
    "M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2M7 14h2m4 0h2m-8 4h2",
  book: "M12 6C8 3 4 4 2 5v15c4-2 7-1 10 1m0-15c4-3 8-2 10-1v15c-4-2-7-1-10 1V6",
  star: "m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9Z",
  team: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.9M13 3a4 4 0 0 1 0 8M9 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8",
  arrow: "M5 12h14m-6-6 6 6-6 6",
  chevron: "m9 5 7 7-7 7",
  clock: "M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  spark: "m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5Z",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4",
  logout: "M9 3H4v18h5m0-9h12m-4-4 4 4-4 4",
  check: "m5 12 4 4L19 6",
  plus: "M12 5v14M5 12h14",
  close: "m6 6 12 12M6 18 18 6",
  send: "m3 3 18 9-18 9 4-9-4-9Zm4 9h14",
  shield: "m12 3 8 3v7c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-5",
  wallet: "M3 7h18v14H3V7Zm0 0V4h15v3m-2 6h5v4h-5Z",
  coffee:
    "M4 8h12v8a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8Zm12 1h2a3 3 0 0 1 0 6h-2M7 2v3m5-3v3M2 23h18",
  waste:
    "M4 7h16M9 7V4h6v3m-9 0 1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M10 11v6m4-6v6",
  grid: "M4 4h6.5v6.5H4ZM13.5 4H20v6.5h-6.5ZM4 13.5h6.5V20H4Zm9.5 0H20V20h-6.5Z",
  planner:
    "M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2m7 9v5m-2.5-2.5h5",
  user: "M19 21a7 7 0 0 0-14 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10",
  eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6",
  eyeOff:
    "m3 3 18 18M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17.7 17.7 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2",
  info: "M12 11v5m0-8.5v.5M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  mail: "M3 5h18v14H3V5Zm0 0 9 7 9-7",
  clipboard:
    "M9 4h6v3H9V4Zm6 1h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h3m0 8 2 2 4-4",
  offline:
    "M12 20h.01M8.5 16.43a5 5 0 0 1 7 0M5 12.86a10 10 0 0 1 5.17-2.69M19 12.86a10 10 0 0 0-2-1.52M2 8.82a15 15 0 0 1 4.18-2.64M22 8.82a15 15 0 0 0-11.29-3.76M2 2l20 20",
};
const icon = (name) =>
  `<svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path d="${icons[name] || icons.star}"/></svg>`;
const params = new URLSearchParams(location.search),
  preview = ["crew", "manager"].includes(params.get("preview"))
    ? params.get("preview")
    : null;
const path =
  location.pathname.split("/").pop()?.replace(".html", "") || "index";
const routes = {
  main: "home",
  schedule: "schedule",
  "shifts-admin": "manage",
  training: "training",
  module: "module",
  "break-rewards": "rewards",
  wrapped: "training",
  admin: "team",
  waste: "waste",
};
let page = params.get("view") || routes[path] || "home";
if (
  ![
    "home",
    "schedule",
    "manage",
    "training",
    "module",
    "rewards",
    "team",
    "availability",
    "assistant",
    "waste",
  ].includes(page)
)
  page = "home";
const state = {
  user: null,
  shifts: [],
  team: [],
  progress: {},
  offset: 0,
  selected: isoDate(),
  dataError: "",
  loaded: false,
  // Server-assembled extras: verifications, role requests, recognition and
  // team learning progress (from /api/portal-data or the preview sample).
  extras: {
    loaded: false,
    verifications: [],
    roleRequests: [],
    recognition: [],
    teamProgress: {},
  },
  // Per-page UI state kept across live re-renders.
  ui: { scheduleMode: "team", teamQuery: "", teamRole: "" },
};
// Deep links: ?week=<offset> and ?date=<YYYY-MM-DD> open that week/day.
if (/^\d{4}-\d{2}-\d{2}$/.test(params.get("date") || "")) {
  state.selected = params.get("date");
  state.offset = clampOffset(weekOffsetOf(state.selected));
} else if (params.has("week")) state.offset = clampOffset(params.get("week"));
try {
  state.ui.scheduleMode =
    sessionStorage.getItem("mc_schedule_mode") === "mine" ? "mine" : "team";
} catch {}
let fb,
  auth,
  db,
  unsubscribers = [];
function persistPreview() {
  if (preview) savePreviewState(preview, state);
}
const modules = window.McModules.modules;
const currency = (value) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(
    value,
  );
const dateLabel = (
  date,
  options = { weekday: "short", day: "numeric", month: "short" },
) => new Date(`${date}T12:00`).toLocaleDateString("en-GB", options);
const isManager = () => managerRole(state.user?.role);
const url = (target = "home", extra = {}) => {
  const paths = {
    home: "main",
    schedule: "schedule",
    manage: "shifts-admin",
    training: "training",
    module: "module",
    rewards: "break-rewards",
    team: "admin",
    waste: "waste",
  };
  const p = new URLSearchParams(extra);
  if (!paths[target]) p.set("view", target);
  if (preview) p.set("preview", preview);
  // URLSearchParams.size is unavailable on older iPads. Serialise instead,
  // otherwise view=assistant (and module IDs/preview mode) silently disappear.
  const query = p.toString();
  return `/${paths[target] || "main"}.html${query ? "?" + query : ""}`;
};
// Stacked, animated toasts (motion.js). type: "success" | "error" | "info";
// left out, it is guessed from the wording.
function toast(text, type) {
  showToast(text, type);
}
const pill = (text, type = "") =>
  `<span class="pill ${type}">${esc(text)}</span>`;
const heading = (title, sub) =>
  `<div class="page-heading"><div class="eyebrow muted" style="margin-bottom:9px">YOUR EVERYDAY, A LITTLE EASIER</div><h1>${title}</h1><p>${sub}</p></div>`;
const empty = (text) => `<div class="empty">${text}</div>`;
// ---- Navigation model (design area) --------------------------------------
// One list drives the sidebar (full + tablet rail), the phone tab bar and the
// phone "More" sheet, so every device reaches every destination.
const roleKey = (role = state.user?.role) => {
  if (managerRole(role)) return "manager";
  const r = String(role || "")
    .toLowerCase()
    .replace(/[\s_-]/g, "");
  return r === "crewtrainer" || r === "trainer" ? "crewTrainer" : "crew";
};
const roleName = (role = roleKey()) =>
  ({ manager: "Manager", crewTrainer: "Crew Trainer", crew: "Crew Member" })[
    role
  ];
const verifyLabel = (role = roleKey()) =>
  role === "crewTrainer"
    ? "Verify crew"
    : role === "manager"
      ? "Verifications"
      : "My verifications";
// verification.html has no portal page of its own, so work it out from the path.
const currentNav = () =>
  path === "verification"
    ? "verification"
    : page === "module"
      ? "training"
      : page;
const navHref = (target) =>
  target === "verification"
    ? "/verification.html" + (preview ? "?preview=" + preview : "")
    : url(target);
function navItems() {
  const manager = roleKey() === "manager";
  return [
    { target: "home", label: "Home", short: "Home", icon: "home", tab: true },
    { target: "schedule", label: "My shifts", short: "Shifts", icon: "calendar", tab: true },
    { target: "training", label: "My learning", short: "Learn", icon: "book", tab: true },
    { target: "rewards", label: "My McStars", short: "McStars", icon: "star", note: "Recognition" },
    ...(manager
      ? [
          { target: "team", label: "My team", short: "Team", icon: "team", note: "People and roles" },
          { target: "manage", label: "Shift planner", short: "Planner", icon: "planner", note: "Publish shifts" },
        ]
      : []),
    { target: "verification", label: verifyLabel(), short: "Verify", icon: "shield", note: "Station sign-offs" },
    { target: "waste", label: "Waste", short: "Waste", icon: "waste", note: "Daily waste sheet" },
    { target: "assistant", label: "McAssist", short: "McAssist", icon: "spark", tab: true },
  ];
}
const sheetExtras = [
  { target: "availability", label: "My availability", short: "Availability", icon: "clock", note: "When you can work" },
];
// variant: "side" (sidebar / tablet rail), "tab" (phone bar), "sheet" (More).
const navLink = (item, variant = "side", index = 0) => {
  const active = currentNav() === item.target;
  const attrs = `href="${navHref(item.target)}" data-nav="${item.target}" class="${active ? "active" : ""}"${active ? ' aria-current="page"' : ""}`;
  if (variant === "tab")
    return `<a ${attrs}><span class="tab-icon" data-ind-target>${icon(item.icon)}</span><span>${esc(item.short)}</span></a>`;
  if (variant === "sheet")
    return `<a ${attrs} style="--i:${index}"><span class="tile-icon">${icon(item.icon)}</span><span class="grow"><span class="nav-text">${esc(item.label)}</span><small>${esc(item.note || "")}</small></span></a>`;
  return `<a ${attrs}>${icon(item.icon)}<span class="nav-text">${esc(item.label)}</span><span class="nav-short" aria-hidden="true">${esc(item.short)}</span></a>`;
};
const brand = () =>
  `<a class="brand" href="${url()}" aria-label="McTraining home"><img src="/favicon.svg" alt="" width="42" height="42"><div><div class="wordmark">McTraining<span>.</span></div><small>THE CREW HUB</small></div></a>`;
const initialsOf = (name) =>
  String(name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .map((n) => n[0].toUpperCase())
    .slice(0, 2)
    .join("") || "?";
function shellMarkup() {
  const u = state.user;
  const items = navItems();
  const current = currentNav();
  const sheetItems = [...items.filter((i) => !i.tab), ...sheetExtras];
  const moreActive = sheetItems.some((i) => i.target === current);
  const store = u.storeName || u.storeId || "";
  const roleLine = `${roleName()}${store ? " · " + esc(store) : ""}`;
  const title =
    {
      home: "Home",
      schedule: "My shifts",
      training: "My learning",
      manage: "Shift planner",
      team: "My team",
      rewards: "My McStars",
      availability: "My availability",
      assistant: "McAssist",
      waste: "Waste",
      verification: verifyLabel(),
    }[current] || "Home";
  const other = preview === "crew" ? "manager" : "crew";
  // The tips rail only has room next to Home on wide screens (portal.css
  // shows it from 1360px). McAssist lives in its own drawer and page.
  const rail =
    current === "home"
      ? `<aside class="rail" aria-label="Tips"><section class="card notice-card">${icon("shield")}<h3>Small things. Big difference.</h3><p>Before your shift, check your station, find your shift lead and take a moment to get ready.</p><a class="text-btn" href="${url("training")}">Your first-shift essentials ${icon("arrow")}</a></section><section class="card rail-tip"><div class="row">${icon("star")}<div><h4>Better, together.</h4><p class="muted">Every great shift is a team effort.</p></div></div></section></aside>`
      : "";
  const banner = preview
    ? `<div class="preview-banner" role="region" aria-label="Sample preview"><span class="preview-dot" aria-hidden="true"></span><span class="preview-text"><b>Sample ${preview} preview</b><span class="preview-extra"> · Changes stay in this tab</span></span><button id="switchPreview" type="button">Try ${other} view</button><a href="/">Sign in<span class="preview-extra"> to your account</span></a></div>`
    : "";
  return `<div class="app-shell" data-page="${current}"><aside class="sidebar" aria-label="Workspace sidebar">${brand()}<nav class="side-nav" aria-label="Main navigation"><p class="nav-label">YOUR WORKSPACE</p>${items.map((i) => navLink(i, "side")).join("")}</nav><div class="side-help">${icon("coffee")}<h4 style="margin-top:10px">Good shifts start here.</h4><p>A little preparation. A great team. You've got this.</p><a class="text-btn" href="${url("training")}">Learn something new ${icon("arrow")}</a></div><div class="side-profile between"><div class="row"><span class="avatar">${esc(initialsOf(u.name))}</span><div class="grow"><b>${esc(u.name)}</b><small class="js-role-line">${roleLine}</small></div></div><button class="icon-btn ghost" id="logout" type="button" aria-label="Sign out">${icon("logout")}</button></div></aside><main class="workspace">${banner}<header class="topbar"><div class="mobile-brand">${brand()}</div><div class="breadcrumb"><span>My workspace</span><span class="crumb-sep" aria-hidden="true">/</span><b>${esc(title)}</b></div><div class="topbar-actions"><span class="top-date">${new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</span><span class="pill store-pill">${esc(store)}</span><button class="icon-btn" id="notifications" type="button" aria-label="Notifications" aria-haspopup="dialog">${icon("bell")}</button><button class="avatar" id="profileButton" type="button" aria-label="My profile">${esc(initialsOf(u.name).slice(0, 1))}</button></div></header>${state.dataError ? `<div class="data-warning" role="alert">${esc(state.dataError)} <button class="text-btn" id="retryData">Try again</button></div>` : ""}<div class="layout"><section class="content" id="content"></section>${rail}</div><footer class="footer"><span>Made for your everyday. McTraining crew hub.</span><span>Independent team tool · Not an official McDonald's product</span></footer></main><nav class="mobile-nav" aria-label="Mobile navigation">${items
    .filter((i) => i.tab)
    .map((i) => navLink(i, "tab"))
    .join(
      "",
    )}<button class="mobile-more${moreActive ? " active" : ""}" id="moreButton" type="button" data-nav="more" aria-haspopup="dialog" aria-controls="moreSheet" aria-expanded="false"><span class="tab-icon" data-ind-target>${icon("grid")}</span><span>More</span>${moreActive ? '<span class="more-dot" aria-hidden="true"></span>' : ""}</button></nav><dialog class="sheet" id="moreSheet" aria-labelledby="moreSheetTitle"><div class="sheet-handle" data-sheet-drag aria-hidden="true"></div><div class="sheet-head" data-sheet-drag><h2 id="moreSheetTitle">More</h2><button class="icon-btn ghost" type="button" data-close-dialog aria-label="Close menu">${icon("close")}</button></div><div class="sheet-profile"><span class="avatar">${esc(initialsOf(u.name))}</span><div class="grow"><b>${esc(u.name)}</b><small class="js-role-line">${roleLine}</small></div></div><nav class="sheet-nav" aria-label="More destinations">${sheetItems.map((i, n) => navLink(i, "sheet", n)).join("")}</nav><div class="sheet-actions"><button class="btn light" type="button" id="sheetProfile">${icon("user")} My profile</button><button class="btn dark" type="button" id="sheetLogout">${icon("logout")} Sign out</button></div></dialog></div>`;
}
// Phone "More" sheet: every destination that is not a bottom tab.
function bindShellChrome() {
  const sheet = $("moreSheet"),
    more = $("moreButton");
  if (!sheet || !more) return;
  more.addEventListener("click", () => {
    openDialog(sheet);
    more.setAttribute("aria-expanded", "true");
  });
  sheet.addEventListener("close", () =>
    more.setAttribute("aria-expanded", "false"),
  );
  $("sheetProfile")?.addEventListener("click", async () => {
    await closeDialog(sheet);
    $("profileButton")?.click();
  });
  $("sheetLogout")?.addEventListener("click", () => $("logout")?.click());
}
const myShifts = () =>
  state.shifts
    .filter((s) => s.userId === state.user.id)
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
function shell() {
  const u = state.user;
  $("app").innerHTML = shellMarkup();
  bindShellChrome();
  $("switchPreview")?.addEventListener("click", () => {
    const p = new URL(location.href);
    p.searchParams.set("preview", preview === "crew" ? "manager" : "crew");
    location.href = p;
  });
  $("logout")?.addEventListener("click", async () => {
    if (!preview) await fb.signOut(auth);
    localStorage.removeItem("mc_session_user");
    location.href = "/";
  });
  $("profileButton").onclick = () => {
    showModal(
      "Your profile",
      "<p>" +
        esc(u.name) +
        " · " +
        (isManager() ? "Manager" : "Crew member") +
        '</p><p class="form-note">Store ' +
        esc(u.storeId) +
        '</p><div class="stack"><a class="btn light" href="' +
        url("availability") +
        '">My availability</a><a class="btn light" href="' +
        url("rewards") +
        '">My McStars</a><button class="btn dark" id="profileLogout">Sign out</button></div>',
    );
    $("profileLogout").onclick = () => $("logout").click();
  };
  // The bell (#notifications) opens the notifications panel from pages-ui.js
  // (updateBell), which renderContent() wires up.
  $("retryData")?.addEventListener("click", () => location.reload());
  renderContent();
}
function pageContext() {
  return {
    state,
    page,
    params,
    preview,
    modules,
    icon,
    pill,
    heading,
    empty,
    url,
    currency,
    dateLabel,
    isManager,
    myShifts,
    toast: (text) => toast(text),
    render: requestRender,
    persist: persistPreview,
    firebase: () => ({ fb, db }),
    api: portalApi,
    refreshExtras,
  };
}
// Several live snapshots can land together: coalesce them into one render.
let renderQueued = false;
function requestRender() {
  if (renderQueued) return;
  renderQueued = true;
  const run = () => {
    renderQueued = false;
    renderContent();
  };
  if (typeof requestAnimationFrame === "function" && !document.hidden)
    requestAnimationFrame(run);
  else setTimeout(run, 0);
}
// Keep focus, caret and horizontal scroll positions across re-renders so a
// live update never interrupts someone typing or scrolling the rota.
function captureView(content) {
  const active = document.activeElement;
  const view = { scroll: {} };
  if (active && active.id && content.contains(active)) {
    view.focus = active.id;
    try {
      view.selection = [active.selectionStart, active.selectionEnd];
    } catch {}
  }
  content.querySelectorAll("[data-keep-scroll]").forEach((el) => {
    view.scroll[el.dataset.keepScroll] = el.scrollLeft;
  });
  return view;
}
function restoreView(content, view) {
  content.querySelectorAll("[data-keep-scroll]").forEach((el) => {
    const left = view.scroll[el.dataset.keepScroll];
    if (left) el.scrollLeft = left;
  });
  if (!view.focus) return;
  const el = document.getElementById(view.focus);
  if (!el || !content.contains(el)) return;
  el.focus({ preventScroll: true });
  if (view.selection?.[0] != null) {
    try {
      el.setSelectionRange(view.selection[0], view.selection[1]);
    } catch {}
  }
}
function renderContent() {
  const content = $("content");
  if (!content || !state.user) return;
  // Enhanced pages own their DOM. Live snapshots must not destroy chat or forms.
  if (content.dataset.enhancedPage) {
    updateBell(pageContext());
    window.dispatchEvent(new CustomEvent("portal:render", { detail: state }));
    return;
  }
  // Unsaved edits (e.g. availability) are never replaced by a live update.
  if (isPageBusy(page, state) && content.childElementCount) {
    updateBell(pageContext());
    return;
  }
  const view = captureView(content);
  const ctx = pageContext();
  content.innerHTML = renderPage(page, ctx);
  bindPage(page, ctx);
  restoreView(content, view);
  updateBell(ctx);
  window.dispatchEvent(new CustomEvent("portal:render", { detail: state }));
}
// Centred card on tablet/desktop, bottom sheet on phones (see portal.css).
function showModal(title, html) {
  const modal = $("modal");
  modal.removeAttribute("data-closing");
  modal.setAttribute("aria-labelledby", "modalTitle");
  modal.addEventListener(
    "close",
    () => modal.removeAttribute("aria-labelledby"),
    { once: true },
  );
  modal.innerHTML = `<div class="sheet-handle" data-sheet-drag aria-hidden="true"></div><button class="icon-btn ghost dialog-close" id="closeModal" type="button" aria-label="Close dialog">${icon("close")}</button><h2 id="modalTitle" style="padding-right:48px">${title}</h2>${html}`;
  $("closeModal").onclick = () => closeDialog(modal);
  openDialog(modal);
}
async function firebase() {
  const [base, a, f] = await Promise.all([
    import("./firebase-init.js"),
    import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js"),
    import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js"),
  ]);
  auth = base.auth;
  db = base.db;
  fb = { ...a, ...f };
}
// Sign in / sign up (design area). Field ids and names are stable: name,
// email, password, storeId, authForm, authResult, resetPassword.
function authPage(signup = false) {
  const tomorrow = new Date(Date.now() + 86400000);
  const day = (options) => tomorrow.toLocaleDateString("en-GB", options);
  $("app").innerHTML = `<main class="auth-layout"><section class="auth-art" aria-label="About McTraining"><div class="auth-shapes" aria-hidden="true"><span></span><span></span><span></span></div><div style="--d:0">${brand()}</div><div class="auth-hero" style="--d:1"><div class="eyebrow">Your team. Your day. Your way.</div><h1>A good shift<br>starts here.</h1><p class="auth-lead">Your schedule, your learning, and a helping hand. Everything you need to feel ready for your day.</p></div><div class="auth-stage" style="--d:3" aria-hidden="true"><div class="auth-shift"><div class="auth-shift-top"><span>Your next shift</span><span class="pill green">Scheduled</span></div><div class="auth-shift-main"><div class="date-tile"><span>${day({ weekday: "short" })}</span><b>${day({ day: "numeric" })}</b><span>${day({ month: "short" })}</span></div><div><h3>16:30 – 23:00</h3><p>Front Counter · 6h 00m paid time</p></div></div></div><div class="auth-chip"><span class="chip-icon">${icon("check")}</span><span>Food Safety<small>Module completed</small></span></div></div><div class="auth-bottom" style="--d:4">Made for managers. Made for crew. Made for you.</div></section><section class="auth-form-wrap"><div class="auth-form"><span class="pill yellow" style="--d:0">${icon("home")} Your everyday crew hub</span><h2 style="--d:1">${signup ? "Join your crew hub." : "Hey, welcome back."}</h2><p style="--d:2">${signup ? "A fresh start to better working days." : "Ready for your next good shift? Let’s get you in."}</p><form id="authForm">${signup ? '<div class="field" style="--d:3"><label for="name">Your name</label><input id="name" name="name" autocomplete="name" required maxlength="80" placeholder="First and last name"></div>' : ""}<div class="field" style="--d:${signup ? 4 : 3}"><label for="email">Email address</label><input type="email" id="email" name="email" autocomplete="email" inputmode="email" autocapitalize="off" spellcheck="false" placeholder="you@example.com" required></div><div class="field" style="--d:${signup ? 5 : 4}"><label for="password">Password</label><div class="input-affix"><input type="password" id="password" name="password" autocomplete="${signup ? "new-password" : "current-password"}" placeholder="${signup ? "At least 8 characters" : "Enter your password"}" minlength="${signup ? 8 : 1}" required aria-describedby="capsHint"><button class="affix-btn" type="button" id="togglePassword" aria-label="Show password" aria-pressed="false" aria-controls="password">${icon("eye")}</button></div><p class="caps-hint" id="capsHint" hidden>${icon("info")} Caps Lock is on</p></div>${signup ? '<div class="field" style="--d:6"><label for="storeId">Store ID</label><input id="storeId" name="storeId" placeholder="Ask your manager for your store ID" required pattern="[A-Za-z0-9_\\-]+" maxlength="80" autocapitalize="off" spellcheck="false"></div><p class="form-note" style="--d:7">New accounts join as crew members. Manager access is assigned by your administrator.</p>' : '<div class="forgot-row" style="--d:5"><button class="text-btn" type="button" id="resetPassword">Forgot password?</button></div>'}<div id="authResult" role="status" aria-live="polite"></div><button class="btn dark full" type="submit" style="--d:${signup ? 8 : 6}">${signup ? "Create my account" : "Sign in"} ${icon("arrow")}</button></form><div class="auth-divider" style="--d:7">${signup ? "ALREADY PART OF THE TEAM?" : "NEW AROUND HERE?"}</div><div class="auth-alt" style="--d:8">${signup ? '<a class="btn light" href="/">Sign in to your account</a>' : '<a class="btn light" href="/signup.html">Create your crew account</a>'}<a class="btn soft preview-link" href="/main.html?preview=crew">${icon("spark")}Take a look around</a></div><p class="auth-foot" style="--d:9">No account needed · <a href="/main.html?preview=manager">Preview the manager view</a></p><p class="auth-legal" style="--d:10">Independent team tool. Not an official McDonald’s product.</p></div></section></main>`;
  const layout = document.querySelector(".auth-layout");
  setTimeout(() => layout.setAttribute("data-settled", ""), 2200);
  const password = $("password"),
    toggle = $("togglePassword"),
    capsHint = $("capsHint");
  toggle.onclick = () => {
    const show = password.type === "password";
    password.type = show ? "text" : "password";
    toggle.setAttribute("aria-pressed", String(show));
    toggle.setAttribute("aria-label", show ? "Hide password" : "Show password");
    toggle.innerHTML = icon(show ? "eyeOff" : "eye");
    password.focus({ preventScroll: true });
  };
  const caps = (event) => {
    if (typeof event.getModifierState === "function")
      capsHint.hidden = !event.getModifierState("CapsLock");
  };
  password.addEventListener("keydown", caps);
  password.addEventListener("keyup", caps);
  password.addEventListener("blur", () => (capsHint.hidden = true));
  // Sign-up submits are replaced by enhanceSignup (role picker) in
  // portal-enhancements.js, which uses the same button states.
  $("authForm").onsubmit = async (e) => {
    e.preventDefault();
    const form = e.currentTarget,
      data = new FormData(form),
      button = form.querySelector("[type=submit]"),
      result = $("authResult");
    result.innerHTML = "";
    setButtonState(button, "loading");
    try {
      if (!fb) await firebase();
      if (signup) {
        const c = await fb.createUserWithEmailAndPassword(
          auth,
          data.get("email"),
          data.get("password"),
        );
        await fb.updateProfile(c.user, { displayName: data.get("name") });
        await fb.setDoc(fb.doc(db, "users", c.user.uid), {
          name: data.get("name"),
          email: c.user.email,
          role: "crew",
          storeId: data.get("storeId"),
          stars: 0,
          createdAt: fb.serverTimestamp(),
        });
      } else
        await fb.signInWithEmailAndPassword(
          auth,
          data.get("email"),
          data.get("password"),
        );
      try {
        localStorage.removeItem("mc_force_logout");
      } catch {}
      setButtonState(button, "success");
      result.innerHTML = `<div class="success">${signup ? "Account created." : "Signed in."} Opening your crew hub…</div>`;
      setTimeout(
        () => leaveTo("/main.html", document.querySelector(".auth-layout")),
        520,
      );
    } catch (error) {
      setButtonState(button, "idle");
      result.innerHTML = `<div class="error">${esc(authErrorMessage(error))}</div>`;
      shake(form);
    }
  };
  $("resetPassword")?.addEventListener("click", async (event) => {
    const email = $("email").value.trim();
    if (!email || !$("email").checkValidity()) {
      $("authResult").innerHTML =
        '<div class="error">Enter your email address first, then tap “Forgot password?”.</div>';
      shake($("email").closest(".field"));
      $("email").focus();
      return;
    }
    const button = event.currentTarget;
    button.disabled = true;
    try {
      if (!fb) await firebase();
      await fb.sendPasswordResetEmail(auth, email);
      $("authResult").innerHTML =
        '<div class="success">If this address has an account, a password reset email is on its way.</div>';
    } catch (error) {
      const known = ["auth/invalid-email", "auth/network-request-failed"];
      $("authResult").innerHTML = `<div class="error">${esc(known.includes(error?.code) ? authErrorMessage(error) : "Could not send the reset email. Please try again.")}</div>`;
    } finally {
      button.disabled = false;
    }
  });
  window.dispatchEvent(new CustomEvent("portal:render", { detail: state }));
}
// Puts a saved or freshly built sample restaurant into portal state. The
// state object itself is kept (feature modules hold on to it).
function adoptPreview(sample) {
  state.user = sample.user;
  state.team = Array.isArray(sample.team) ? sample.team : [];
  // Keep the team entry and the signed-in profile as the same object so edits
  // (availability, McStars) show up everywhere at once.
  const selfIndex = state.team.findIndex((m) => m.id === state.user.id);
  if (selfIndex >= 0) state.team[selfIndex] = state.user;
  state.shifts = Array.isArray(sample.shifts) ? sample.shifts : [];
  state.progress = sample.progress || {};
  state.extras = { ...state.extras, ...(sample.extras || {}), loaded: true };
  state.loaded = true;
  state.progressLoaded = true;
  state.teamLoaded = true;
}
function setupPreview() {
  // A rich sample restaurant that lives only in this tab (sessionStorage).
  adoptPreview(loadPreviewState(preview) || buildPreviewData(preview));
  persistPreview();
  shell();
}
// McAssist (preview demo) saves its changes to this tab's sample restaurant.
// Reload them and repaint so the change shows behind the McAssist drawer.
function reloadPreview() {
  const saved = loadPreviewState(preview);
  if (!saved?.user) return requestRender();
  const before = navSignature();
  adoptPreview(saved);
  if (navSignature() !== before) shell();
  else requestRender();
}
// Name, role and store feed the navigation, so a change rebuilds the shell.
const navSignature = () =>
  [state.user?.name, roleKey(), state.user?.storeName, state.user?.storeId].join("|");
// Live accounts: McAssist wrote to Firestore. The live listeners bring in
// shifts, team and profile changes; a fresh server load brings everything
// else (verifications, recognition, team learning) and feature pages repaint
// from it on the next render. McAssist may already have done that fresh load
// just before telling us; then the page only needs to repaint.
let assistantRefresh = null;
function refreshAfterAssistant() {
  if (assistantRefresh) return assistantRefresh;
  if (performance.now() - portalDataAt < 1500) {
    requestRender();
    return Promise.resolve();
  }
  assistantRefresh = (async () => {
    try {
      applyExtras(await loadPortalData(true));
    } catch (error) {
      console.warn("Could not refresh after McAssist", error);
    } finally {
      assistantRefresh = null;
    }
    requestRender();
  })();
  return assistantRefresh;
}
window.addEventListener("mcassist:data-changed", () => {
  if (!state.user) return;
  if (preview) reloadPreview();
  else refreshAfterAssistant();
});
function showDataWarning(message) {
  state.dataError = message;
  let warning = document.querySelector(".data-warning");
  if (!warning) {
    warning = document.createElement("div");
    warning.className = "data-warning";
    warning.setAttribute("role", "alert");
    document.querySelector(".topbar")?.after(warning);
  }
  warning.textContent = message + " ";
  const retry = document.createElement("button");
  retry.className = "text-btn";
  retry.type = "button";
  retry.textContent = "Try again";
  retry.onclick = () => location.reload();
  warning.appendChild(retry);
}
function subscribe() {
  unsubscribers.forEach((fn) => fn());
  unsubscribers = [];
  const uid = state.user.id,
    store = state.user.storeId;
  const fail = (error) => {
    state.loaded = true;
    console.warn("Live data listener failed", error?.code || error);
    showDataWarning(
      error?.code === "permission-denied"
        ? "Some restaurant data could not be loaded because this account does not have permission. Ask your manager to check your access."
        : "Your restaurant data could not be loaded. Check your connection and try again.",
    );
    requestRender();
  };
  const shifts = fb.collection(db, "stores", store, "Shifts");
  // Managers see the store rota from five weeks back (enough for "Copy last
  // week" and history) instead of every shift ever published. Crew see only
  // their own shifts, which the security rules require.
  const shiftQuery = isManager()
    ? fb.query(shifts, fb.where("date", ">=", weekDates(-5)[0]))
    : fb.query(shifts, fb.where("userId", "==", uid));
  unsubscribers.push(
    fb.onSnapshot(
      shiftQuery,
      (s) => {
        state.shifts = s.docs
          .map((d) => ({ ...d.data(), id: d.id }))
          .filter((x) => x.date && x.start && x.end);
        state.loaded = true;
        requestRender();
      },
      fail,
    ),
  );
  unsubscribers.push(
    fb.onSnapshot(
      fb.collection(db, "users", uid, "portalTraining"),
      (s) => {
        state.progress = Object.fromEntries(
          s.docs.map((d) => [d.id, d.data()]),
        );
        state.progressLoaded = true;
        if (page === "module" && $("moduleStatus"))
          $("moduleStatus").textContent = state.progress[params.get("id")]
            ?.completed
            ? "Completed"
            : "In progress";
        if (page !== "module") requestRender();
      },
      fail,
    ),
  );
  // Your own profile stays live: McStars, badge, pay rate and availability
  // changes (from a manager or McAssist) appear without a reload.
  unsubscribers.push(
    fb.onSnapshot(
      fb.doc(db, "users", uid),
      (snap) => {
        // Our own writes (e.g. availability) echo back first as a local
        // snapshot with pending writes. The confirmed snapshot follows; never
        // reload or repaint on the echo.
        if (snap?.metadata?.hasPendingWrites) return;
        if (typeof snap?.exists !== "function" || !snap.exists()) return;
        const next = { ...snap.data(), id: uid };
        next.name = next.name || state.user.name;
        // Roles are compared normalised: a profile read through the server
        // fallback is normalised ("shiftCreator" → "manager") already.
        if (
          roleKey(next.role) !== roleKey(state.user.role) ||
          next.storeId !== store ||
          String(next.status || "").toLowerCase() === "inactive"
        ) {
          // Role or store changed: rebuild navigation and listeners.
          location.reload();
          return;
        }
        state.user = Object.assign(state.user, next);
        requestRender();
      },
      () => {},
    ),
  );
  if (isManager())
    unsubscribers.push(
      fb.onSnapshot(
        fb.query(fb.collection(db, "users"), fb.where("storeId", "==", store)),
        (s) => {
          state.team = s.docs.map((d) => ({ ...d.data(), id: d.id }));
          state.teamLoaded = true;
          requestRender();
        },
        fail,
      ),
    );
}
// Verifications, role requests, recognition and team learning come from the
// server (/api/portal-data, with a browser fallback). Refreshed on load, when
// the tab becomes visible again and after actions that change them.
let extrasAt = 0,
  extrasKey = "";
function applyExtras(data) {
  if (preview || !state.user || !data) return;
  extrasAt = Date.now();
  const next = {
    loaded: true,
    verifications: data.verifications || [],
    roleRequests: data.roleRequests || [],
    recognition: data.recognition || [],
    teamProgress: data.teamProgress || {},
    // Crew Trainers: upcoming store rota (names, times and stations only).
    ...(Array.isArray(data.storeShifts) ? { storeShifts: data.storeShifts } : {}),
  };
  const key = JSON.stringify(next);
  if (key === extrasKey) return;
  extrasKey = key;
  state.extras = next;
  requestRender();
}
async function refreshExtras(force = false) {
  if (preview || !state.user) return;
  try {
    applyExtras(await loadPortalData(force));
  } catch (error) {
    console.warn("Could not refresh portal extras", error);
  }
}
// Any fresh load (for example after McAssist changed something) updates the
// pages too; cached reads do not fire this event, so there is no render loop.
// Monotonic clock: only the gap between two moments matters here.
let portalDataAt = -Infinity;
window.addEventListener("portal:data", (event) => {
  portalDataAt = performance.now();
  applyExtras(event.detail);
});
document.addEventListener("visibilitychange", () => {
  if (
    document.visibilityState === "visible" &&
    state.user &&
    !preview &&
    Date.now() - extrasAt > 60000
  )
    refreshExtras(true);
});
// ---- Start-up -------------------------------------------------------------
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// A dropped or not-yet-open Firestore connection reports "unavailable" /
// "client is offline"; failed fetches surface as TypeError. These are worth
// retrying and never mean the account itself is wrong.
function isTransient(error) {
  const code = String(error?.code || "").replace(/^firestore\//, "");
  if (
    [
      "unavailable",
      "deadline-exceeded",
      "cancelled",
      "aborted",
      "internal",
      "resource-exhausted",
      "unknown",
    ].includes(code)
  )
    return true;
  if (error?.name === "TypeError" || error?.name === "AbortError") return true;
  return /offline|network|timed? ?out|took too long|failed to fetch|load failed|unavailable/i.test(
    String(error?.message || ""),
  );
}
// The signed-in person's profile: Firestore first (three tries with
// backoff), then the server (/api/portal-data) as a second route.
async function readProfile(user) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await wait(600 * 2 ** (attempt - 1));
    try {
      const snap = await fb.getDoc(fb.doc(db, "users", user.uid));
      if (!snap.exists()) return { missing: "profile" };
      return { profile: snap.data() };
    } catch (error) {
      lastError = error;
      if (!isTransient(error)) break;
    }
  }
  try {
    const data = await portalApi("/api/portal-data");
    if (data?.profile) return { profile: data.profile };
  } catch (error) {
    if (error?.code === "profile-missing") return { missing: "profile" };
    if (error?.code === "store-missing") return { missing: "store" };
    if (error?.code === "deactivated") return { deactivated: true };
    lastError = error;
  }
  throw Object.assign(new Error("Could not load your profile."), {
    cause: lastError,
  });
}
function bootCard({ icon: name, title, text, action, id }) {
  $("app").innerHTML = `<main class="boot"><section class="card boot-card" role="alert" aria-labelledby="bootTitle"><span class="boot-card-icon" aria-hidden="true">${icon(name)}</span><h2 id="bootTitle">${title}</h2><p class="form-note">${text}</p><button class="btn" id="${id}" type="button">${action}</button></section></main>`;
  return $(id);
}
// Only a missing profile or store lands here: this is an account problem.
function accountCard(message) {
  const button = bootCard({
    icon: "user",
    title: "Let’s get your account ready.",
    text: esc(message),
    action: "Back to sign in",
    id: "accountLogout",
  });
  button.onclick = async () => {
    setButtonState(button, "loading");
    try {
      await fb.signOut(auth);
    } finally {
      location.href = "/";
    }
  };
}
function deactivatedCard() {
  const button = bootCard({
    icon: "shield",
    title: "This account is switched off.",
    text: "Your manager has deactivated this account. Speak to them if you think this is a mistake.",
    action: "Back to sign in",
    id: "accountLogout",
  });
  button.onclick = async () => {
    setButtonState(button, "loading");
    try {
      await fb.signOut(auth);
    } finally {
      location.href = "/";
    }
  };
}
// A connection problem: nothing is wrong with the account, so offer a retry
// (and retry by itself when the device comes back online). Never sign out.
function connectionCard(retry) {
  const button = bootCard({
    icon: "offline",
    title: "We can’t reach your crew hub right now.",
    text: "Your account is fine. Check your Wi-Fi or mobile data, then try again.",
    action: `Try again ${icon("arrow")}`,
    id: "bootRetry",
  });
  const run = () => {
    window.removeEventListener("online", run);
    if (!button.isConnected || button.disabled) return;
    setButtonState(button, "loading");
    retry();
  };
  button.onclick = run;
  window.addEventListener("online", run);
}
async function startSession(user) {
  let result;
  try {
    result = await readProfile(user);
  } catch (error) {
    console.warn("Could not load the profile", error?.cause || error);
    connectionCard(() => startSession(user));
    return;
  }
  if (result.missing === "profile")
    return accountCard(
      "Your account profile is missing. Contact your manager to restore your store access.",
    );
  if (result.deactivated) return deactivatedCard();
  const profile = { ...result.profile, id: user.uid };
  profile.name = profile.name || user.displayName || "Crew member";
  if (result.missing === "store" || !profile.storeId)
    return accountCard(
      "Your profile needs a store ID. Please ask your manager to update it.",
    );
  if (String(profile.status || "").toLowerCase() === "inactive")
    return deactivatedCard();
  state.user = profile;
  shell();
  subscribe();
  refreshExtras();
}
async function boot() {
  if (preview) {
    setupPreview();
    return;
  }
  if (["index", "signup", ""].includes(path)) {
    authPage(path === "signup");
    return;
  }
  try {
    await firebase();
  } catch (error) {
    console.warn("Could not load Firebase", error);
    connectionCard(() => location.reload());
    return;
  }
  let started = "";
  fb.onAuthStateChanged(auth, (user) => {
    if (!user) {
      location.replace("/");
      return;
    }
    if (started === user.uid) return;
    started = user.uid;
    startSession(user);
  });
}
boot();
