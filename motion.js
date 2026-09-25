// McTraining motion + UI helpers (design system runtime).
//
// Imported by portal.js. Feature modules may import the exported helpers too:
//   import { setButtonState, showToast, shake, closeDialog } from "./motion.js";
//
// Rules this file follows (tests depend on them):
// - Motion is CSS/attribute based. Nothing here rewrites innerHTML under #app,
//   and nothing loops DOM writes. Count-ups only change text node data
//   (characterData), indicators only change CSS custom properties.
// - Everything is skipped under prefers-reduced-motion: reduce.

const reducedQuery =
  typeof matchMedia === "function"
    ? matchMedia("(prefers-reduced-motion: reduce)")
    : { matches: false };
export const prefersReducedMotion = () => Boolean(reducedQuery.matches);

const root = document.documentElement;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nextFrame = () =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()));

/* ------------------------------------------------------------------ */
/* Buttons: loading → success, ripple, shake                           */
/* ------------------------------------------------------------------ */

// state: "loading" | "success" | "error" | "idle" (or null)
export function setButtonState(button, state) {
  if (!button) return;
  if (!state || state === "idle") {
    button.removeAttribute("data-state");
    button.removeAttribute("aria-busy");
    if (button.dataset.stateDisabled === "1") {
      button.disabled = false;
      delete button.dataset.stateDisabled;
    }
    return;
  }
  button.setAttribute("data-state", state);
  if (state === "loading") button.setAttribute("aria-busy", "true");
  else button.removeAttribute("aria-busy");
  if (state === "loading" || state === "success") {
    if (!button.disabled) {
      button.disabled = true;
      button.dataset.stateDisabled = "1";
    }
  }
  if (state === "error") {
    shake(button);
    setTimeout(() => {
      if (button.getAttribute("data-state") === "error")
        setButtonState(button, "idle");
    }, 700);
  }
}

export function shake(element) {
  if (!element || prefersReducedMotion()) return;
  element.removeAttribute("data-shake");
  void element.offsetWidth;
  element.setAttribute("data-shake", "");
  const done = (event) => {
    if (event.target !== element) return;
    element.removeEventListener("animationend", done);
    element.removeAttribute("data-shake");
  };
  element.addEventListener("animationend", done);
}

// Fades the given element out, then navigates. Instant under reduced motion.
export async function leaveTo(url, element = document.querySelector("#app > *")) {
  if (element && !prefersReducedMotion()) {
    element.setAttribute("data-leaving", "");
    await wait(260);
  }
  location.href = url;
}

function installRipple() {
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (event.button !== 0 || prefersReducedMotion()) return;
      const button = event.target.closest?.(".btn, .icon-btn");
      if (!button || button.disabled || button.hasAttribute("data-no-ripple"))
        return;
      const rect = button.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height) * 2.2;
      button.style.setProperty("--rx", event.clientX - rect.left + "px");
      button.style.setProperty("--ry", event.clientY - rect.top + "px");
      button.style.setProperty("--rs", size + "px");
      button.removeAttribute("data-ripple");
      void button.offsetWidth;
      button.setAttribute("data-ripple", "");
    },
    { passive: true, capture: true },
  );
}

/* ------------------------------------------------------------------ */
/* Toasts: stacked, slide-in, success / error / info                   */
/* ------------------------------------------------------------------ */

const toastIcons = {
  success: "m5 12 4 4L19 6",
  error: "M12 8v5m0 3.5v.5M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  info: "M12 11v5m0-8.5v.5M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
};

function guessToastType(text) {
  const value = String(text || "");
  if (
    /could not|couldn[’']t|failed|error|unable|not allowed|try again|denied|missing/i.test(
      value,
    )
  )
    return "error";
  if (
    /saved|added|removed|deleted|published|updated|created|done|sent|complete|signed|approved|nicely|copied|cleared/i.test(
      value,
    )
  )
    return "success";
  return "info";
}

function toastStack() {
  let stack = document.getElementById("toast");
  if (!stack) {
    stack = document.createElement("div");
    stack.id = "toast";
    document.body.appendChild(stack);
  }
  stack.classList.add("toast-stack");
  stack.setAttribute("role", "status");
  stack.setAttribute("aria-live", "polite");
  // Legacy code wrote plain text straight into #toast. Clear it.
  [...stack.childNodes].forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) node.remove();
  });
  stack.classList.remove("show");
  return stack;
}

function dismissToast(item) {
  if (!item || item.dataset.leaving) return;
  item.dataset.leaving = "1";
  if (prefersReducedMotion()) {
    item.remove();
    return;
  }
  item.addEventListener("animationend", () => item.remove(), { once: true });
  setTimeout(() => item.remove(), 400);
}

export function showToast(text, type, options = {}) {
  if (!text) return;
  const kind = ["success", "error", "info"].includes(type)
    ? type
    : guessToastType(text);
  const stack = toastStack();
  const item = document.createElement("div");
  item.className = "toast toast-" + kind;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", toastIcons[kind]);
  svg.appendChild(path);
  const label = document.createElement("span");
  label.textContent = String(text);
  item.append(svg, label);
  stack.appendChild(item);
  const items = stack.querySelectorAll(".toast:not([data-leaving])");
  if (items.length > 3) dismissToast(items[0]);
  const duration =
    options.duration || (kind === "error" ? 5200 : Math.min(6000, 2800 + String(text).length * 25));
  setTimeout(() => dismissToast(item), duration);
  item.addEventListener("click", () => dismissToast(item));
  return item;
}

/* ------------------------------------------------------------------ */
/* Dialogs + bottom sheets                                             */
/* ------------------------------------------------------------------ */

export async function closeDialog(dialog, returnValue) {
  if (!dialog?.open) return;
  if (prefersReducedMotion() || dialog.hasAttribute("data-closing")) {
    dialog.removeAttribute("data-closing");
    dialog.close(returnValue);
    return;
  }
  dialog.setAttribute("data-closing", "");
  await Promise.race([
    new Promise((resolve) => {
      const done = (event) => {
        if (event.target !== dialog) return;
        dialog.removeEventListener("animationend", done);
        resolve();
      };
      dialog.addEventListener("animationend", done);
    }),
    wait(320),
  ]);
  // Another caller may have reopened or already closed it meanwhile.
  if (!dialog.hasAttribute("data-closing")) return;
  dialog.removeAttribute("data-closing");
  if (dialog.open) dialog.close(returnValue);
}

export function openDialog(dialog) {
  if (!dialog) return;
  dialog.removeAttribute("data-closing");
  dialog.style.removeProperty("--drag");
  if (!dialog.open) dialog.showModal();
}

// When a dialog is opened with a tap or click, browsers focus its first
// button (usually "Close") and WebKit draws the focus ring on it. Move focus
// to the dialog itself instead; keyboard users keep the default behaviour.
let lastPointerAt = 0;
const CLOSE_LIKE =
  '.dialog-close, [data-close-dialog], [data-sheet-close], [aria-label^="Close"]';
function watchDialogFocus() {
  document.addEventListener(
    "pointerdown",
    () => (lastPointerAt = Date.now()),
    { capture: true, passive: true },
  );
  new MutationObserver((records) => {
    for (const record of records) {
      const dialog = record.target;
      if (dialog.tagName !== "DIALOG" || !dialog.open) continue;
      if (Date.now() - lastPointerAt > 1500) continue;
      const active = document.activeElement;
      if (!active || !dialog.contains(active) || !active.matches(CLOSE_LIKE))
        continue;
      if (!dialog.hasAttribute("tabindex")) dialog.setAttribute("tabindex", "-1");
      dialog.focus({ preventScroll: true });
    }
  }).observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ["open"],
  });
}

function installDialogBehaviour() {
  watchDialogFocus();
  // Esc: play the exit animation instead of disappearing instantly.
  document.addEventListener(
    "cancel",
    (event) => {
      const dialog = event.target;
      if (!(dialog instanceof HTMLDialogElement)) return;
      if (prefersReducedMotion()) return;
      event.preventDefault();
      closeDialog(dialog);
    },
    true,
  );
  // Tap on the backdrop closes (light dismiss).
  document.addEventListener("click", (event) => {
    const dialog = event.target;
    if (!(dialog instanceof HTMLDialogElement) || !dialog.open) return;
    if (dialog.hasAttribute("data-no-dismiss")) return;
    const rect = dialog.getBoundingClientRect();
    const inside =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;
    // Keyboard "clicks" report 0,0 coordinates; never treat them as outside.
    if (!inside && (event.clientX || event.clientY)) closeDialog(dialog);
  });
  // Any element with [data-close-dialog] closes its dialog with animation.
  document.addEventListener("click", (event) => {
    const trigger = event.target.closest?.("[data-close-dialog]");
    if (!trigger) return;
    const dialog = trigger.closest("dialog");
    if (dialog) {
      event.preventDefault();
      closeDialog(dialog);
    }
  });
  // Swipe down on a sheet's grab area to close it.
  let drag = null;
  document.addEventListener(
    "pointerdown",
    (event) => {
      const handle = event.target.closest?.("[data-sheet-drag]");
      const dialog = handle?.closest("dialog");
      if (!dialog || event.pointerType === "mouse") return;
      drag = { dialog, startY: event.clientY, dy: 0, id: event.pointerId };
    },
    { passive: true },
  );
  document.addEventListener(
    "pointermove",
    (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      drag.dy = Math.max(0, event.clientY - drag.startY);
      drag.dialog.setAttribute("data-dragging", "");
      drag.dialog.style.setProperty("--drag", drag.dy + "px");
    },
    { passive: true },
  );
  const endDrag = () => {
    if (!drag) return;
    const { dialog, dy } = drag;
    drag = null;
    dialog.removeAttribute("data-dragging");
    if (dy > 90) {
      dialog.style.removeProperty("--drag");
      closeDialog(dialog);
    } else dialog.style.removeProperty("--drag");
  };
  document.addEventListener("pointerup", endDrag, { passive: true });
  document.addEventListener("pointercancel", endDrag, { passive: true });
}

/* ------------------------------------------------------------------ */
/* Navigation indicator (slides between items, even across pages)      */
/* ------------------------------------------------------------------ */

const IND_KEY = "mc_nav_indicator";

function readStoredIndicator() {
  try {
    const value = JSON.parse(sessionStorage.getItem(IND_KEY) || "null");
    sessionStorage.removeItem(IND_KEY);
    return value;
  } catch {
    return null;
  }
}

function storeIndicator(kind, box) {
  try {
    sessionStorage.setItem(
      IND_KEY,
      JSON.stringify({ kind, box, vw: innerWidth, at: Date.now() }),
    );
  } catch {
    /* Storage may be blocked. The indicator simply won't slide. */
  }
}

function indicatorBox(nav, item) {
  const target = item.querySelector("[data-ind-target]") || item;
  const navRect = nav.getBoundingClientRect();
  const rect = target.getBoundingClientRect();
  return {
    x: Math.round(rect.left - navRect.left),
    y: Math.round(rect.top - navRect.top),
    w: Math.round(rect.width),
    h: Math.round(rect.height),
  };
}

function applyBox(nav, box) {
  nav.style.setProperty("--ind-x", box.x + "px");
  nav.style.setProperty("--ind-y", box.y + "px");
  nav.style.setProperty("--ind-w", box.w + "px");
  nav.style.setProperty("--ind-h", box.h + "px");
}

function sameBox(a, b) {
  return a && b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

function placeIndicator(nav, { animateFrom } = {}) {
  const active = nav.querySelector("[data-nav].active");
  if (!active || !nav.offsetParent) {
    nav.removeAttribute("data-ind");
    return;
  }
  const box = indicatorBox(nav, active);
  if (sameBox(nav._indBox, box) && nav.getAttribute("data-ind") === "ready")
    return;
  if (animateFrom && !prefersReducedMotion()) {
    nav.setAttribute("data-ind", "placing");
    applyBox(nav, animateFrom);
    void nav.offsetWidth;
    requestAnimationFrame(() => {
      nav.setAttribute("data-ind", "ready");
      applyBox(nav, box);
    });
  } else {
    nav.setAttribute("data-ind", "placing");
    applyBox(nav, box);
    void nav.offsetWidth;
    nav.setAttribute("data-ind", "ready");
  }
  nav._indBox = box;
}

function setupNav(nav, kind, stored) {
  if (!nav || nav.dataset.indSetup === "1") return;
  nav.dataset.indSetup = "1";
  const from =
    stored && stored.kind === kind && stored.vw === innerWidth &&
    Date.now() - stored.at < 8000
      ? stored.box
      : null;
  placeIndicator(nav, { animateFrom: from });
  // Slide immediately when a destination is chosen, before the next page loads.
  nav.addEventListener("click", (event) => {
    const item = event.target.closest("[data-nav]");
    if (!item || !nav.contains(item) || item.tagName !== "A") return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button)
      return;
    storeIndicator(kind, nav._indBox || indicatorBox(nav, item));
    const box = indicatorBox(nav, item);
    nav.setAttribute("data-ind", "ready");
    applyBox(nav, box);
    nav._indBox = box;
    nav.querySelectorAll("[data-nav].active").forEach((a) =>
      a.classList.remove("active"),
    );
    item.classList.add("active");
  });
  if (typeof ResizeObserver === "function") {
    let frame = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        nav._indBox = null;
        placeIndicator(nav);
      });
    });
    ro.observe(nav);
  }
}

// The More tab lives in the mobile bar but is a <button>. Chosen destinations
// inside the sheet store the More tab position so the next page starts there.
function rememberMoreTab(event) {
  const link = event.target.closest?.(".sheet-nav a");
  if (!link) return;
  const nav = document.querySelector(".mobile-nav");
  const more = nav?.querySelector(".mobile-more");
  if (nav && more) storeIndicator("mobile", indicatorBox(nav, more));
}

/* ------------------------------------------------------------------ */
/* Count-up for metric numbers (text node data only)                   */
/* ------------------------------------------------------------------ */

const lastValues = new Map();
const COUNT_SELECTOR = ".pg-kpi strong, [data-count-up]";

function parseCount(text) {
  const match = /^(\D*?)(\d[\d,]*(?:\.\d+)?)([\s\S]*)$/.exec(text);
  if (!match) return null;
  const raw = match[2];
  const value = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(value)) return null;
  return {
    prefix: match[1],
    value,
    suffix: match[3],
    decimals: (raw.split(".")[1] || "").length,
    grouped: raw.includes(","),
  };
}

function formatCount(parsed, value) {
  const n = value.toLocaleString("en-GB", {
    minimumFractionDigits: parsed.decimals,
    maximumFractionDigits: parsed.decimals,
    useGrouping: parsed.grouped,
  });
  return parsed.prefix + n + parsed.suffix;
}

function firstTextNode(element) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.data.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP,
  });
  return walker.nextNode();
}

function runCountUps(entering) {
  const elements = [...document.querySelectorAll(COUNT_SELECTOR)];
  elements.forEach((element, index) => {
    if (element.dataset.counted === "1") return;
    element.dataset.counted = "1";
    const node = firstTextNode(element);
    if (!node) return;
    const parsed = parseCount(node.data);
    const key =
      (element.dataset.countUp || element.className || element.tagName) +
      ":" +
      index;
    const previous = lastValues.get(key);
    if (parsed) lastValues.set(key, parsed.value);
    if (!parsed || prefersReducedMotion()) return;
    const from = previous ?? (entering ? 0 : parsed.value);
    if (from === parsed.value) return;
    const target = parsed.value;
    const start = performance.now();
    const duration = 700;
    const final = node.data;
    const tick = (now) => {
      if (!node.isConnected) return;
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      if (t >= 1) {
        node.data = final;
        return;
      }
      node.data = formatCount(parsed, from + (target - from) * eased);
      requestAnimationFrame(tick);
    };
    node.data = formatCount(parsed, from);
    requestAnimationFrame(tick);
  });
}

/* ------------------------------------------------------------------ */
/* Page entrance (fade-up + stagger, progress fills)                   */
/* ------------------------------------------------------------------ */

let enterTimer = 0;
let entering = false;
// When the entrance ends, [data-entered] takes over from [data-entering]:
// dropping the entrance animation would otherwise hand the element back to
// its own animation (.pg-page's pg-rise, the bar fills), which restarts and
// fades the page in a second time (portal.css "Motion").
// The entrance plays for the first page of a visit only. Every destination
// is a page load, so replaying it on each tap read as a flicker; later pages
// start settled ([data-entered]).
const ENTERED_KEY = "mc_entered_v1";
function entranceAllowed() {
  try {
    return !sessionStorage.getItem(ENTERED_KEY);
  } catch {
    return true;
  }
}
function settlePage() {
  entering = false;
  clearTimeout(enterTimer);
  root.removeAttribute("data-entering");
  root.setAttribute("data-entered", "");
}
function enterPage() {
  if (prefersReducedMotion()) return;
  if (!entranceAllowed()) return settlePage();
  entering = true;
  root.removeAttribute("data-entered");
  root.setAttribute("data-entering", "");
  clearTimeout(enterTimer);
  enterTimer = setTimeout(() => {
    settlePage();
    try {
      sessionStorage.setItem(ENTERED_KEY, "1");
    } catch {}
  }, 1300);
}

let contentObserver = null;
function watchContent() {
  const content = document.getElementById("content");
  if (!content || content._motionWatched) return;
  content._motionWatched = true;
  contentObserver?.disconnect();
  // A feature module taking over #content counts as a fresh page entrance.
  contentObserver = new MutationObserver(() => enterPage());
  contentObserver.observe(content, {
    attributes: true,
    attributeFilter: ["data-enhanced-page"],
  });
}

/* ------------------------------------------------------------------ */
/* Wiring                                                              */
/* ------------------------------------------------------------------ */

let shellSeen = null;
const storedIndicator = readStoredIndicator();

function onRender() {
  const shell = document.querySelector(".app-shell");
  if (shell && shell !== shellSeen) {
    shellSeen = shell;
    enterPage();
    watchContent();
  }
  if (shell) {
    setupNav(shell.querySelector(".side-nav"), "side", storedIndicator);
    setupNav(shell.querySelector(".mobile-nav"), "mobile", storedIndicator);
  }
  runCountUps(entering);
}

// Ambient decoration (the sign-in drift) pauses while the tab is hidden.
function trackVisibility() {
  const sync = () => root.toggleAttribute("data-page-hidden", document.hidden);
  document.addEventListener("visibilitychange", sync);
  sync();
}

function init() {
  root.classList.add("js");
  trackVisibility();
  installRipple();
  installDialogBehaviour();
  document.addEventListener("click", rememberMoreTab, true);
  window.addEventListener("portal:render", onRender);
  // Fonts change text metrics, so re-measure the nav indicators once.
  document.fonts?.ready?.then(() => {
    document.querySelectorAll("[data-ind-setup]").forEach((nav) => {
      nav._indBox = null;
      placeIndicator(nav);
    });
  });
  window.McMotion = {
    toast: showToast,
    setButtonState,
    shake,
    closeDialog,
    openDialog,
    leaveTo,
    prefersReducedMotion,
  };
}

init();

/* ------------------------------------------------------------------ */
/* Friendly Firebase Auth messages (used by the sign-in / sign-up UI)  */
/* ------------------------------------------------------------------ */

export function authErrorMessage(error) {
  const code = String(error?.code || "");
  const map = {
    "auth/invalid-credential":
      "That email and password don’t match. Check them and try again.",
    "auth/wrong-password":
      "That email and password don’t match. Check them and try again.",
    "auth/user-not-found":
      "That email and password don’t match. Check them and try again.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/missing-password": "Enter your password.",
    "auth/too-many-requests":
      "Too many attempts. Wait a minute, or reset your password.",
    "auth/network-request-failed":
      "You seem to be offline. Check your connection and try again.",
    "auth/email-already-in-use":
      "There’s already an account with this email. Sign in instead.",
    "auth/weak-password": "Choose a stronger password of at least 8 characters.",
    "auth/user-disabled":
      "This account has been switched off. Speak to your manager.",
    "permission-denied":
      "Your account could not save this change. Ask your manager to check access.",
  };
  if (map[code]) return map[code];
  const message = String(error?.message || "");
  if (!message || /^Firebase:/i.test(message))
    return "Something went wrong. Please try again.";
  return message;
}

export { nextFrame };
