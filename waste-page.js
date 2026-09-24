// Waste counter page (waste.html) — the Hayle Waste Counter inside the hub.
// Rendered into #content by portal-enhancements.js, which passes a shared
// "kit" of helpers (see createKit in portal-enhancements.js). Data lives in
// this device's storage first (mc_waste_*) and syncs through /api/waste to
// the same shared record the standalone app and Android APK use.
import {
  ADD_ITEM_CATEGORIES,
  CATEGORY_ORDER,
  CLOUD_LABELS,
  MENU_PERIODS,
  createWasteStore,
  defaultItems,
  escapeHTML as esc,
  safeStorage,
  sheetTotalsFromEntries,
  shiftLabel,
  storageKeys,
} from "./waste-core.js";
import { dayKey, renderInsights, sheetTotals, shiftDay } from "./waste-insights.js";
import { createPaperPdf, formatSheetDate, paperData } from "./waste-pdf.js";

const PREVIEW_PIN = "1234";
const ICONS = {
  search: "m21 21-4.35-4.35M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
  sliders: "M4 7h10M18 7h2M16 5v4M4 17h2M10 17h10M8 15v4",
  check: "m5 12.5 4.5 4.5L19 7.5",
  download: "M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 20h14",
  print: "M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7Z",
  clear: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5",
  lock: "M6 11h12v10H6ZM8.5 11V8a3.5 3.5 0 0 1 7 0v3",
  trash: "M4 7h16M9.5 7V4h5v3M6 7l1 13h10l1-13M10 11v5m4-5v5",
  pencil: "M4 20h4L19 9l-4-4L4 16v4ZM13 7l4 4",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  close: "m6 6 12 12M18 6 6 18",
  list: "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01",
  chart: "M4 20V10h4v10M10 20V4h4v16M16 20v-7h4v7",
  history: "M3 12a9 9 0 1 0 3-6.7L3 8m0-5v5h5M12 7v5l3 2",
  shield: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z",
  undo: "M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-4",
  cloud: "M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.1 9.6 4.2 4.2 0 0 0 7 18Z",
  chevron: "m6 9 6 6 6-6",
};
const ico = (name, cls = "waste-ico") =>
  `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${ICONS[name]}"/></svg>`;

let kit = null;
let profile = {};
let store = null;
let root = null;
let started = false;
let globalsInstalled = false;
let pendingListRender = false;
let pendingAction = null;
let pinMode = "verify";
let confirmHandler = null;
let hold = null;
let savedFlashTimer = null;
const ui = {};
const view = {
  tab: "count",
  type: "raw",
  category: "All",
  filter: "all",
  period: "all",
  search: "",
  graphicsRange: 7,
  graphicsType: "all",
  historySearch: "",
  historyRange: "all",
  historyLimit: 12,
  manageSearch: "",
  renaming: null,
};

const TABS = ["count", "graphics", "history"];
const byId = (id) => document.getElementById(id);
const fmt = (n) => Number(n || 0).toLocaleString("en-GB");
const toast = (text) => kit?.toast?.(text);
// Feedback for actions taken inside the item manager shows in the dialog
// itself; a page toast would sit behind the dialog's backdrop.
let manageStatusTimer = null;
function notify(text) {
  const status = document.getElementById("wasteManageStatus");
  if (status && document.getElementById("wasteItemsDialog")?.open) {
    status.textContent = text;
    status.classList.add("is-visible");
    clearTimeout(manageStatusTimer);
    manageStatusTimer = setTimeout(() => status.classList.remove("is-visible"), 3200);
  }
  toast(text);
}
const reducedMotion = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

function normalisedRole() {
  const role = profile?.role;
  return kit?.normaliseRole ? kit.normaliseRole(role) : String(role || "");
}
function isManager() {
  return normalisedRole() === "manager";
}
function firstName() {
  return String(profile?.name || "").trim().split(/\s+/)[0] || "Hayle";
}
function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

// ------------------------------------------------------------- data wiring
function browserStorage(name) {
  try {
    const s = window[name];
    const probe = "__mc_waste_probe__";
    s.setItem(probe, "1");
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

function liveTransport() {
  return {
    load: () => kit.api("/api/waste", { cache: "no-store" }),
    save: (state) => kit.api("/api/waste", { method: "POST", body: JSON.stringify({ state }) }),
    pin: (action, payload) => kit.api("/api/waste", { method: "POST", body: JSON.stringify({ action, ...payload }) }),
  };
}

// Preview mode never touches the network: the manager PIN is simulated here.
function previewTransport(storage) {
  const key = "mc_waste_preview_pin";
  const current = () => storage.getItem(key) || PREVIEW_PIN;
  const valid = (pin) => /^\d{4}$/.test(String(pin || ""));
  return {
    local: true,
    async pin(action, payload = {}) {
      if (action === "pin-status") return { ok: true, configured: true };
      if (action === "pin-setup")
        return { ok: false, code: "PIN_ALREADY_CONFIGURED", error: "A manager PIN is already configured." };
      if (action === "pin-verify") {
        if (!valid(payload.pin)) return { ok: false, code: "PIN_INVALID", error: "PIN must be exactly 4 digits." };
        return payload.pin === current()
          ? { ok: true }
          : { ok: false, code: "PIN_INCORRECT", error: "Incorrect manager PIN." };
      }
      if (action === "pin-change") {
        if (!valid(payload.currentPin) || !valid(payload.newPin))
          return { ok: false, code: "PIN_INVALID", error: "PIN must be exactly 4 digits." };
        if (payload.currentPin !== current())
          return { ok: false, code: "PIN_INCORRECT", error: "Incorrect manager PIN." };
        storage.setItem(key, payload.newPin);
        return { ok: true, configured: true };
      }
      return { ok: false, error: "Unknown action." };
    },
  };
}

// Sample data for ?preview=… so the tab looks alive without an account.
function seedPreview(storage, keys) {
  const seededKey = "mc_waste_preview_seeded_v1";
  if (storage.getItem(seededKey) === "1" && storage.getItem(keys.ITEMS)) return;
  const items = defaultItems();
  const byNumber = (n) => items[n - 1];
  const today = dayKey(new Date());
  const split = (total, picks, weights) => {
    let left = total;
    return picks.map((n, i) => {
      const count = i === picks.length - 1 ? left : Math.max(0, Math.round(total * weights[i]));
      left -= count;
      return { ...byNumber(n), count: Math.max(0, count) };
    });
  };
  const labels = ["Close · Cosmin", "Lunch · Amelia", "Dinner · Ryan", "Close · Maya", "Late · Cosmin", "Lunch · Ryan"];
  const totals = [64, 71, null, 88, 59, 77, 93, 70, 66, null, 81, 95, 62, 58, 74, 90, null, 69, 85, 101, 63, 57, 72, 86, 72, 105, 67, 93, 40, 41];
  const history = [];
  totals.forEach((total, index) => {
    if (total === null) return;
    const offset = index - (totals.length - 1);
    const date = shiftDay(today, offset);
    const raw = Math.round(total * 0.62);
    const full = total - raw;
    const entries = [
      ...split(raw, [1, 3, 8, 10, 24], [0.3, 0.22, 0.18, 0.15]).filter((e) => e.count > 0),
      ...split(full, [26, 30, 36, 41, 53], [0.28, 0.2, 0.18, 0.14]).filter((e) => e.count > 0),
    ];
    history.push({
      id: `preview-${date}-main`,
      createdAt: `${date}T${offset === 0 ? "12" : "21"}:30:00.000Z`,
      updatedAt: `${date}T${offset === 0 ? "12" : "21"}:30:00.000Z`,
      label: offset === 0 ? "Lunch handover" : labels[index % labels.length],
      notes: offset === 0 ? "Checked at handover. Keep an eye on patties during quieter hours." : "",
      shift: "main",
      totals: sheetTotalsFromEntries(entries),
      entries,
    });
    if (offset === -1 || offset === -8 || offset === -15) {
      const b = [
        ...split(11, [19, 20, 22, 17], [0.35, 0.25, 0.2]).filter((e) => e.count > 0),
        ...split(7, [60, 61, 70], [0.45, 0.3]).filter((e) => e.count > 0),
      ];
      history.push({
        id: `preview-${date}-breakfast`,
        createdAt: `${date}T09:15:00.000Z`,
        updatedAt: `${date}T09:15:00.000Z`,
        label: "Breakfast handover",
        notes: "",
        shift: "breakfast",
        totals: sheetTotalsFromEntries(b),
        entries: b,
      });
    }
  });
  history.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  storage.setItem(keys.ITEMS, JSON.stringify(items));
  storage.setItem(keys.HISTORY, JSON.stringify(history));
  storage.setItem(
    keys.COUNTS,
    JSON.stringify({ "v2-default-1": 9, "v2-default-3": 7, "v2-default-24": 5, "v2-default-26": 3, "v2-default-40": 2, "v2-default-53": 4 }),
  );
  storage.setItem(
    keys.DRAFT,
    JSON.stringify({ sheetName: "Evening waste count", sheetNotes: "Check remaining stock before the next handover.", sheetId: null }),
  );
  storage.setItem(seededKey, "1");
}

function createStoreForMode() {
  const preview = kit?.preview || null;
  const keys = storageKeys(preview ? "mc_waste_preview_" : "mc_waste_");
  const storage = safeStorage(browserStorage(preview ? "sessionStorage" : "localStorage"));
  if (preview) seedPreview(storage, keys);
  return createWasteStore({
    storage,
    keys,
    transport: preview ? previewTransport(storage) : liveTransport(),
    cloud: !preview,
    initialStatus: preview
      ? { label: "Preview · not synced", state: "preview" }
      : { label: CLOUD_LABELS.syncing, state: "syncing" },
    onChange: handleStoreChange,
    onStatus: renderStatus,
    onNotice: toast,
  });
}

// --------------------------------------------------------------- templates
function totalsBlock() {
  return `<div class="waste-totals" role="group" aria-label="Current sheet totals">
    <div class="waste-total is-raw"><span>RAW</span><strong id="wasteRawTotal">0</strong><small>components</small></div>
    <div class="waste-total is-full"><span>FULL</span><strong id="wasteFullTotal">0</strong><small>products</small></div>
    <div class="waste-total is-grand"><span>TOTAL</span><strong id="wasteGrandTotal">0</strong><small>all waste</small></div>
    <div class="waste-total is-lines"><span>LINES</span><strong id="wasteLineCount">0</strong><small>items counted</small></div>
  </div>`;
}

function countPanel() {
  return `<section class="waste-panel" id="wastePanel-count" role="tabpanel" aria-labelledby="wasteTab-count" tabindex="-1">
    <div class="waste-card waste-setup">
      <div class="waste-type" role="group" aria-label="Waste type">
        <button type="button" class="waste-type-btn is-raw" data-type="raw" aria-pressed="true"><span class="waste-type-icon" aria-hidden="true">R</span><span class="waste-type-copy"><strong>RAW</strong><small>Buns · patties · Nugget · Select</small></span><span class="waste-type-count" id="wasteTypeCount-raw" aria-label="RAW units counted">0</span></button>
        <button type="button" class="waste-type-btn is-full" data-type="full" aria-pressed="false"><span class="waste-type-icon" aria-hidden="true">F</span><span class="waste-type-copy"><strong>FULL</strong><small>Burgers · wraps · finished products</small></span><span class="waste-type-count" id="wasteTypeCount-full" aria-label="FULL units counted">0</span></button>
      </div>
      <div class="waste-period">
        <span class="waste-field-label" id="wastePeriodLabel">Menu period</span>
        <div class="waste-seg" role="group" aria-labelledby="wastePeriodLabel">${MENU_PERIODS.map(
          ([value, label]) =>
            `<button type="button" data-period="${value}" aria-pressed="${value === "all"}">${esc(label)}</button>`,
        ).join("")}</div>
      </div>
    </div>

    <div class="waste-card waste-counter">
      <div class="waste-toolbar">
        <label class="waste-search">${ico("search")}<span class="waste-sr">Search waste items</span><input id="wasteSearch" type="search" placeholder="Search waste item…" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search"></label>
        <div class="waste-seg waste-filter" role="group" aria-label="Item filter"><button type="button" data-filter="all" aria-pressed="true">All items</button><button type="button" data-filter="counted" aria-pressed="false">Counted</button></div>
        <button type="button" class="waste-icon-btn" id="wasteManageBtn" aria-label="Manage items" title="Manage items">${ico("sliders")}</button>
      </div>
      <div class="waste-cats" id="wasteCats" role="group" aria-label="Waste categories"></div>
      <div class="waste-list-head" aria-hidden="true"><span><b id="wasteListLabel">RAW COMPONENT</b><small id="wasteVisible">0 shown</small></span><span>COUNT</span></div>
      <div class="waste-list" id="wasteList"></div>
      <div class="waste-empty" id="wasteEmpty" hidden><span class="waste-empty-icon" aria-hidden="true">${ico("search")}</span><h3 id="wasteEmptyTitle">No items found</h3><p id="wasteEmptyText">Try a different search, waste type or category.</p></div>
    </div>

    <div class="waste-card waste-notes">
      <div class="waste-field"><label for="wasteSheetName">Crew / shift note</label><input id="wasteSheetName" type="text" maxlength="80" placeholder="e.g. Close · Cosmin · 08/09" autocomplete="off"></div>
      <div class="waste-field"><label for="wasteSheetNotes">Notes</label><textarea id="wasteSheetNotes" rows="2" maxlength="300" placeholder="Optional notes about unusual waste…"></textarea></div>
    </div>

    <div class="waste-actions">
      <button type="button" class="waste-btn is-ghost waste-protected" id="wasteClearBtn">${ico("clear")}<span>Clear current</span>${ico("lock", "waste-ico waste-lock")}</button>
      <div class="waste-actions-end">
        <button type="button" class="waste-btn is-light" id="wastePrintBtn">${ico("print")}<span>Print</span></button>
        <button type="button" class="waste-btn is-yellow waste-download" id="wasteDownloadBtn">${ico("download")}<span class="waste-btn-stack"><strong>Download paper</strong><small>PDF waste sheet</small></span></button>
      </div>
    </div>

    <div class="waste-dock" id="wasteDock" data-state="new" data-tucked="start">
      <div class="waste-dock-bar">
        <div class="waste-dock-totals">
          <span class="is-raw">RAW <b id="wasteDockRaw">0</b></span>
          <span class="is-full">FULL <b id="wasteDockFull">0</b></span>
          <span class="is-grand">TOTAL <b id="wasteDockTotal">0</b></span>
        </div>
        <p class="waste-dock-state" id="wasteDockState" aria-live="polite"></p>
        <p class="waste-dock-short" aria-hidden="true"><span class="waste-dock-dot"></span><span id="wasteDockShort"></span></p>
        <button type="button" class="waste-btn is-dark waste-save" id="wasteSaveBtn">${ico("check")}<span>Save sheet</span></button>
      </div>
    </div>
  </section>`;
}

function graphicsPanel() {
  return `<section class="waste-panel" id="wastePanel-graphics" role="tabpanel" aria-labelledby="wasteTab-graphics" tabindex="-1" hidden>
    <header class="waste-page-head"><div><p class="waste-eyebrow">The bigger picture</p><h2 id="wasteGraphicsHeading" tabindex="-1">Waste, day by day.</h2><p>See the pattern. Make the next day a little better.</p></div><span class="waste-tag">From your saved sheets</span></header>
    <div class="waste-stat-grid" id="wasteGraphicsSummary"></div>
    <section class="waste-card waste-chart-card" aria-labelledby="wasteChartHeading">
      <div class="waste-card-head">
        <div><p class="waste-eyebrow">Daily comparison</p><h3 id="wasteChartHeading">Your waste trend</h3><p class="waste-muted" id="wasteChartRange"></p></div>
        <div class="waste-chart-controls">
          <div class="waste-control"><label for="wasteGraphicsType">Waste type</label><select id="wasteGraphicsType"><option value="all">RAW + FULL</option><option value="raw">RAW only</option><option value="full">FULL only</option></select></div>
          <div class="waste-control"><label for="wasteGraphicsRange">Period</label><select id="wasteGraphicsRange"><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select></div>
        </div>
      </div>
      <div id="wasteChart" class="waste-chart"></div>
      <div id="wasteGraphicsEmpty" class="waste-empty" hidden><span class="waste-empty-icon" aria-hidden="true">${ico("chart")}</span><h3>Your story starts with a saved sheet.</h3><p>Save a count, or choose a wider period to see earlier days.</p></div>
      <p class="waste-note">Daily totals add up saved sheets. Unsaved counts are not included. Days without a saved sheet are left blank.</p>
    </section>
    <div class="waste-graphics-grid">
      <section class="waste-card" aria-labelledby="wasteTopHeading">
        <div class="waste-card-head"><div><p class="waste-eyebrow">Where it goes</p><h3 id="wasteTopHeading">Most wasted items</h3><p class="waste-muted" id="wasteTopCaption"></p></div></div>
        <ol class="waste-top" id="wasteTopItems"></ol>
      </section>
      <section class="waste-card" aria-labelledby="wasteBreakdownHeading">
        <div class="waste-card-head"><div><p class="waste-eyebrow">A closer look</p><h3 id="wasteBreakdownHeading">The daily breakdown</h3><p class="waste-muted">Compared with the previous recorded day</p></div></div>
        <div id="wasteBreakdown"></div>
      </section>
    </div>
  </section>`;
}

function historyPanel() {
  return `<section class="waste-panel" id="wastePanel-history" role="tabpanel" aria-labelledby="wasteTab-history" tabindex="-1" hidden>
    <header class="waste-page-head"><div><p class="waste-eyebrow">Your waste record</p><h2 id="wasteHistoryHeading" tabindex="-1">Every shift, saved.</h2><p>Find a past sheet, revisit the counts, or download your paper.</p></div><span class="waste-tag">Shared across your team</span></header>
    <div class="waste-stat-grid is-compact">
      <article class="waste-stat"><span class="waste-stat-label">Saved sheets</span><strong class="waste-stat-value" id="wasteHistoryCount">0</strong><span class="waste-stat-caption">In your shared history</span></article>
      <article class="waste-stat"><span class="waste-stat-label">RAW recorded</span><strong class="waste-stat-value" id="wasteHistoryRaw">0</strong><span class="waste-stat-caption">Components across saved sheets</span></article>
      <article class="waste-stat"><span class="waste-stat-label">FULL recorded</span><strong class="waste-stat-value" id="wasteHistoryFull">0</strong><span class="waste-stat-caption">Products across saved sheets</span></article>
    </div>
    <div class="waste-card waste-history-toolbar">
      <label class="waste-search">${ico("search")}<span class="waste-sr">Search saved sheets</span><input id="wasteHistorySearch" type="search" placeholder="Search shift, notes or waste item…" autocomplete="off" enterkeyhint="search"></label>
      <div class="waste-select"><label for="wasteHistoryRange">Show</label><select id="wasteHistoryRange"><option value="all">All saved sheets</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select></div>
    </div>
    <p id="wasteHistoryResults" class="waste-results" role="status" aria-live="polite"></p>
    <div id="wasteHistoryList" class="waste-history-list"></div>
  </section>`;
}

function dialogs() {
  return `
  <dialog class="waste-dialog waste-items-dialog" id="wasteItemsDialog" aria-labelledby="wasteItemsTitle">
    <div class="waste-dialog-inner">
      <div class="waste-dialog-head"><div><p class="waste-eyebrow">Customise Hayle list</p><h2 id="wasteItemsTitle">Manage waste items</h2></div><button type="button" class="waste-close" data-close-dialog aria-label="Close">${ico("close")}</button></div>
      <form id="wasteAddItemForm" class="waste-add-form">
        <div class="waste-field waste-add-name"><label for="wasteNewItemName">Item name</label><input id="wasteNewItemName" type="text" required maxlength="60" placeholder="e.g. McSpicy" autocomplete="off"></div>
        <div class="waste-field"><label for="wasteNewItemType">Type</label><select id="wasteNewItemType"><option value="raw">RAW component</option><option value="full">FULL product</option></select></div>
        <div class="waste-field"><label for="wasteNewItemCategory">Category</label><select id="wasteNewItemCategory"></select></div>
        <div class="waste-field"><label for="wasteNewItemShift">Menu period</label><select id="wasteNewItemShift"><option value="main">Main menu</option><option value="breakfast">Breakfast</option><option value="all">All day</option></select></div>
        <button type="submit" class="waste-btn is-dark">${ico("plus")}<span>Add item</span></button>
      </form>
      <p class="waste-manage-status" id="wasteManageStatus" role="status" aria-live="polite"></p>
      <div class="waste-manage-tools">
        <label class="waste-search is-small">${ico("search")}<span class="waste-sr">Find an item to manage</span><input id="wasteManageSearch" type="search" placeholder="Find an item…" autocomplete="off"></label>
        <span class="waste-muted" id="wasteManageCount"></span>
      </div>
      <div class="waste-manage-list" id="wasteManageList"></div>
      <div class="waste-security">
        <div class="waste-security-copy"><span class="waste-security-chip">${ico("lock")} Manager</span><div><strong>Manager PIN</strong><small id="wasteSecurityNote">Protects delete and reset actions on every device.</small></div></div>
        <button type="button" class="waste-btn is-light" id="wasteManagePinBtn">Manage PIN</button>
      </div>
      <div class="waste-dialog-foot"><button type="button" class="waste-btn is-danger waste-protected" id="wasteRestoreItemsBtn">${ico("lock", "waste-ico waste-lock")}<span>Restore default lists</span></button></div>
    </div>
  </dialog>

  <dialog class="waste-dialog waste-pin-dialog" id="wastePinDialog" aria-labelledby="wastePinTitle" aria-describedby="wastePinDescription">
    <form class="waste-dialog-inner" id="wastePinForm" autocomplete="off" novalidate>
      <button type="button" class="waste-close" data-close-dialog aria-label="Close">${ico("close")}</button>
      <div class="waste-shield" aria-hidden="true">${ico("lock")}</div>
      <p class="waste-eyebrow" id="wastePinKicker">Manager approval</p>
      <h2 id="wastePinTitle">Enter manager PIN</h2>
      <p id="wastePinDescription" class="waste-muted">This action changes shared waste data and needs manager approval.</p>
      <div class="waste-action-card" id="wastePinActionCard"><span>Protected action</span><strong id="wastePinActionName">Reset waste sheet</strong></div>
      <label class="waste-pin-field" id="wastePinCurrentField"><span id="wastePinCurrentLabel">Manager PIN</span><input id="wastePinCurrent" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" placeholder="••••"></label>
      <label class="waste-pin-field" id="wastePinNewField" hidden><span>New 4-digit PIN</span><input id="wastePinNew" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="new-password" placeholder="••••"></label>
      <label class="waste-pin-field" id="wastePinConfirmField" hidden><span>Confirm PIN</span><input id="wastePinConfirm" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="new-password" placeholder="••••"></label>
      <p class="waste-pin-error" id="wastePinError" role="alert" hidden></p>
      <p class="waste-pin-hint" id="wastePinHint" hidden>Preview PIN: <b>${PREVIEW_PIN}</b></p>
      <div class="waste-dialog-actions"><button type="button" class="waste-btn is-light" data-close-dialog>Cancel</button><button type="submit" class="waste-btn is-dark" id="wastePinSubmit">Authorise</button></div>
      <small class="waste-dialog-foot-note" id="wastePinFoot">The PIN is checked on the server and is not stored in the app.</small>
    </form>
  </dialog>

  <dialog class="waste-dialog waste-confirm-dialog" id="wasteConfirmDialog" aria-labelledby="wasteConfirmTitle" aria-describedby="wasteConfirmMessage">
    <div class="waste-dialog-inner">
      <div class="waste-shield is-soft" aria-hidden="true" id="wasteConfirmIcon">${ico("shield")}</div>
      <p class="waste-eyebrow" id="wasteConfirmKicker">Please confirm</p>
      <h2 id="wasteConfirmTitle">Are you sure?</h2>
      <p class="waste-muted" id="wasteConfirmMessage"></p>
      <div class="waste-action-card" id="wasteConfirmCard"><span>Action</span><strong id="wasteConfirmAction"></strong></div>
      <p class="waste-manager-note" id="wasteConfirmManager" hidden>${ico("shield")} Manager access · no PIN needed</p>
      <div class="waste-dialog-actions"><button type="button" class="waste-btn is-light" data-close-dialog>Cancel</button><button type="button" class="waste-btn is-dark" id="wasteConfirmBtn">Confirm</button></div>
    </div>
  </dialog>

  <dialog class="waste-dialog waste-complete-dialog" id="wasteCompleteDialog" aria-labelledby="wasteCompleteTitle">
    <div class="waste-dialog-inner">
      <div class="waste-complete-check" aria-hidden="true">${ico("check")}</div>
      <p class="waste-eyebrow">Paper downloaded</p>
      <h2 id="wasteCompleteTitle">Sheet complete.</h2>
      <p class="waste-muted">Your PDF is safe. Start a fresh waste count when you're ready.</p>
      <div class="waste-complete-summary" aria-label="Downloaded sheet totals">
        <div><span>RAW</span><strong id="wasteCompleteRaw">0</strong></div>
        <div><span>FULL</span><strong id="wasteCompleteFull">0</strong></div>
        <div class="is-grand"><span>TOTAL</span><strong id="wasteCompleteTotal">0</strong></div>
      </div>
      <div class="waste-dialog-actions is-stacked">
        <button type="button" class="waste-btn is-yellow waste-protected" id="wasteStartNewBtn">${ico("lock", "waste-ico waste-lock")}<span>Start new sheet</span></button>
        <button type="button" class="waste-btn is-light" data-close-dialog>Keep current sheet</button>
      </div>
      <small class="waste-dialog-foot-note">Starting a new sheet clears the active counts and notes only. Saved history and your RAW/FULL item list stay untouched.</small>
    </div>
  </dialog>`;
}

function template() {
  return `<div class="waste-app" id="wasteApp" data-type="raw" data-tab="count">
    <section class="waste-hero">
      <div class="waste-hero-main">
        <div class="waste-hero-copy">
          <p class="waste-eyebrow">Hayle · Waste counter</p>
          <h1 id="wasteHeading" tabindex="-1">${esc(greeting())}, ${esc(firstName())}.</h1>
          <p class="waste-hero-lead">Count RAW and FULL waste, then save the sheet for the whole team.</p>
        </div>
        <div class="waste-hero-meta">
          <button type="button" class="waste-sync" id="wasteSync" data-state="syncing" aria-describedby="wasteSyncHint"><span class="waste-sync-dot" aria-hidden="true"></span><span id="wasteSyncLabel">${esc(CLOUD_LABELS.syncing)}</span></button>
          <span class="waste-sr" id="wasteSyncHint">Tap to sync now</span>
          <span class="waste-sr" id="wasteSyncLive" role="status" aria-live="polite"></span>
          <span class="waste-role" id="wasteRole"></span>
        </div>
      </div>
      ${totalsBlock()}
    </section>

    <div class="waste-tabs" role="tablist" aria-label="Waste sections">
      <span class="waste-tabs-glider" aria-hidden="true"></span>
      <button type="button" role="tab" id="wasteTab-count" data-tab="count" aria-controls="wastePanel-count" aria-selected="true">${ico("list")}<span>Count</span></button>
      <button type="button" role="tab" id="wasteTab-graphics" data-tab="graphics" aria-controls="wastePanel-graphics" aria-selected="false" tabindex="-1">${ico("chart")}<span>Graphics</span></button>
      <button type="button" role="tab" id="wasteTab-history" data-tab="history" aria-controls="wastePanel-history" aria-selected="false" tabindex="-1">${ico("history")}<span>History</span></button>
    </div>

    ${countPanel()}
    ${graphicsPanel()}
    ${historyPanel()}

    <p class="waste-foot">Hayle waste counter · Saved on this device first, then shared with your team.</p>
    ${dialogs()}
  </div>`;
}

// ------------------------------------------------------------------ mount
export async function renderWaste(data, k) {
  kit = k;
  profile = data?.profile || {};
  const content = byId("content");
  if (!content) return;
  document.body.classList.add("waste-route");
  // The floating McAssist launcher would sit on top of the Save dock.
  document.body.dataset.hideAssistantLauncher = "true";
  if (content.dataset.enhancedPage === "waste" && root && content.contains(root)) {
    renderRole();
    return;
  }
  content.dataset.enhancedPage = "waste";
  if (!store) store = createStoreForMode();
  mount(content);
  installGlobals();
  if (!started) {
    started = true;
    store.start();
  }
}

function mount(content) {
  content.innerHTML = template();
  root = byId("wasteApp");
  [
    "wasteList",
    "wasteCats",
    "wasteEmpty",
    "wasteVisible",
    "wasteListLabel",
    "wasteSearch",
    "wasteSheetName",
    "wasteSheetNotes",
    "wasteRawTotal",
    "wasteFullTotal",
    "wasteGrandTotal",
    "wasteLineCount",
    "wasteDockRaw",
    "wasteDockFull",
    "wasteDockTotal",
    "wasteDockState",
    "wasteSaveBtn",
    "wasteSync",
    "wasteSyncLabel",
    "wasteRole",
    "wasteItemsDialog",
    "wastePinDialog",
    "wasteConfirmDialog",
    "wasteCompleteDialog",
    "wasteManageList",
    "wasteHistoryList",
  ].forEach((id) => (ui[id] = byId(id)));
  ensurePrintRoot();
  trackChrome();
  bind();
  renderRole();
  renderStatus(store.status);
  renderAll();
  switchTab(tabFromHash(), { focus: false, replace: false });
  requestAnimationFrame(() => root?.classList.add("is-ready"));
}

// Keep the Save dock above the hub's fixed bottom navigation (whatever its
// height on this device) and keep scrolled-to headings clear of a sticky top bar.
let chromeObserver = null;
function measureChrome() {
  if (!root) return;
  let bottom = 0;
  const nav = document.querySelector(".mobile-nav");
  if (nav) {
    const style = getComputedStyle(nav);
    if (style.display !== "none" && style.visibility !== "hidden" && style.position === "fixed")
      bottom = nav.getBoundingClientRect().height;
  }
  root.style.setProperty("--w-dock-offset", bottom ? `${Math.round(bottom + 10)}px` : "");
  // Focused or scrolled-to controls must never hide under the sticky top bar,
  // the Save dock or the bottom navigation.
  const dock = byId("wasteDock");
  const dockSpace = view.tab === "count" && dock ? dock.getBoundingClientRect().height + 10 : 0;
  const html = document.documentElement.style;
  html.scrollPaddingTop = `${Math.round(stickyTopOffset() + 12)}px`;
  html.scrollPaddingBottom = `${Math.round((bottom ? bottom + 10 : 16) + dockSpace + 12)}px`;
  scheduleDockPosition();
}
function stickyTopOffset() {
  const bar = document.querySelector(".topbar");
  if (!bar) return 0;
  const style = getComputedStyle(bar);
  return style.position === "sticky" || style.position === "fixed" ? bar.getBoundingClientRect().height : 0;
}
function trackChrome() {
  measureChrome();
  requestAnimationFrame(measureChrome);
  setTimeout(measureChrome, 600);
  if (typeof ResizeObserver !== "function") return;
  // The shell can be re-rendered (new nav, top bar and #content), so observe
  // the current elements every time the page mounts.
  chromeObserver?.disconnect();
  chromeObserver = new ResizeObserver(() => measureChrome());
  [document.querySelector(".mobile-nav"), document.querySelector(".topbar"), root].forEach((el) => el && chromeObserver.observe(el));
}

function installGlobals() {
  if (globalsInstalled) return;
  globalsInstalled = true;
  window.addEventListener("online", () => store?.handleOnline());
  window.addEventListener("offline", () => store?.handleOffline());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") store?.handleVisible();
  });
  window.addEventListener("hashchange", () => {
    const tab = tabFromHash(true);
    if (tab && tab !== view.tab) switchTab(tab, { replace: false });
  });
  window.addEventListener("blur", clearHold);
  window.addEventListener("resize", measureChrome);
  window.addEventListener("scroll", scheduleDockPosition, { passive: true });
  window.visualViewport?.addEventListener("resize", scheduleDockPosition);
  document.fonts?.ready?.then(measureChrome).catch(() => {});
}

function tabFromHash(strict = false) {
  const value = String(location.hash || "").slice(1).toLowerCase();
  if (TABS.includes(value)) return value;
  return strict ? null : "count";
}

// ----------------------------------------------------------------- events
function bind() {
  root.addEventListener("click", onRootClick);
  root.querySelector(".waste-tabs").addEventListener("keydown", onTabKeydown);
  const dock = byId("wasteDock");
  ["focusin", "focusout"].forEach((type) => dock?.addEventListener(type, scheduleDockPosition));

  ui.wasteSearch.addEventListener("input", (e) => {
    view.search = e.target.value;
    renderList();
  });
  ui.wasteSheetName.addEventListener("input", (e) => store.setDraft({ sheetName: e.target.value }));
  ui.wasteSheetNotes.addEventListener("input", (e) => store.setDraft({ sheetNotes: e.target.value }));

  // Counting: tap for one, press and hold to keep counting.
  const list = ui.wasteList;
  list.addEventListener("pointerdown", onStepPointerDown);
  ["pointerup", "pointercancel"].forEach((type) => list.addEventListener(type, releaseHold));
  list.addEventListener("pointerout", (e) => {
    if (hold && e.target.closest?.("[data-step]") === hold.button) releaseHold();
  });
  list.addEventListener("contextmenu", (e) => {
    if (e.target.closest("[data-step]")) e.preventDefault();
  });
  list.addEventListener("click", onStepClick);
  list.addEventListener("change", (e) => {
    const input = e.target.closest("input[data-count]");
    if (!input) return;
    const id = input.closest("[data-id]")?.dataset.id;
    if (id) store.setCount(id, input.value);
  });
  list.addEventListener("focusin", (e) => {
    if (e.target.matches("input[data-count]")) e.target.select();
  });
  list.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.matches("input[data-count]")) e.target.blur();
  });
  list.addEventListener("focusout", () => {
    if (!pendingListRender) return;
    setTimeout(() => {
      if (pendingListRender && !ui.wasteList.contains(document.activeElement)) renderList();
    }, 0);
  });

  byId("wasteGraphicsType").addEventListener("change", (e) => {
    view.graphicsType = e.target.value;
    renderGraphics();
  });
  byId("wasteGraphicsRange").addEventListener("change", (e) => {
    view.graphicsRange = Number(e.target.value) === 30 ? 30 : 7;
    renderGraphics();
  });
  byId("wasteHistorySearch").addEventListener("input", (e) => {
    view.historySearch = e.target.value;
    view.historyLimit = 12;
    renderHistory();
  });
  byId("wasteHistoryRange").addEventListener("change", (e) => {
    view.historyRange = e.target.value;
    view.historyLimit = 12;
    renderHistory();
  });

  byId("wasteAddItemForm").addEventListener("submit", onAddItem);
  byId("wasteNewItemType").addEventListener("change", buildCategorySelect);
  byId("wasteManageSearch").addEventListener("input", (e) => {
    view.manageSearch = e.target.value;
    renderManageList();
  });
  ui.wasteManageList.addEventListener("click", onManageClick);
  ui.wasteManageList.addEventListener("submit", onRenameSubmit);
  ui.wasteManageList.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && view.renaming) {
      e.preventDefault();
      e.stopPropagation();
      view.renaming = null;
      renderManageList();
    }
  });

  byId("wastePinForm").addEventListener("submit", submitPin);
  ["wastePinCurrent", "wastePinNew", "wastePinConfirm"].forEach((id) =>
    byId(id).addEventListener("input", (e) => {
      e.target.value = e.target.value.replace(/\D/g, "").slice(0, 4);
      hidePinError();
    }),
  );
  byId("wasteConfirmBtn").addEventListener("click", () => {
    const run = confirmHandler;
    confirmHandler = null;
    closeDialog(ui.wasteConfirmDialog);
    run?.();
  });

  root.querySelectorAll("dialog").forEach((dialog) => {
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) closeDialog(dialog);
    });
    dialog.addEventListener("close", () => onDialogClosed(dialog));
    dialog.addEventListener("cancel", () => onDialogClosed(dialog));
  });
}

function onRootClick(event) {
  const target = event.target.closest("button, [data-cat]");
  if (!target || !root.contains(target)) return;
  if (target.hasAttribute("data-close-dialog")) {
    closeDialog(target.closest("dialog"));
    return;
  }
  if (target.dataset.tab) return switchTab(target.dataset.tab);
  if (target.dataset.type && target.closest(".waste-type")) return setType(target.dataset.type);
  if (target.dataset.period) return setPeriod(target.dataset.period);
  if (target.dataset.filter) return setFilter(target.dataset.filter);
  if (target.dataset.cat !== undefined && target.closest("#wasteCats")) return setCategory(target.dataset.cat);
  if (target.dataset.historyAction) return onHistoryAction(target);
  switch (target.id) {
    case "wasteSaveBtn":
      return saveSheet();
    case "wasteClearBtn":
      return clearCurrent();
    case "wasteDownloadBtn":
      return downloadCurrentPaper();
    case "wastePrintBtn":
      return printCurrent();
    case "wasteManageBtn":
      return openItemsManager();
    case "wasteRestoreItemsBtn":
      return restoreDefaultItems();
    case "wasteManagePinBtn":
      return openPinSettings();
    case "wasteHistoryMore":
      view.historyLimit += 12;
      return renderHistory();
    case "wasteStartNewBtn":
      return startNewSheet();
    case "wasteSync":
      if (kit?.preview) return toast("Preview mode · nothing leaves this tab.");
      toast(navigator.onLine === false ? "You're offline · counts are safe on this device" : "Checking the shared sheet…");
      return store.wake();
    default:
  }
}

function onTabKeydown(event) {
  const keys = { ArrowRight: 1, ArrowLeft: -1, Home: "first", End: "last" };
  if (!(event.key in keys)) return;
  event.preventDefault();
  const index = TABS.indexOf(view.tab);
  const move = keys[event.key];
  const next =
    move === "first" ? 0 : move === "last" ? TABS.length - 1 : (index + move + TABS.length) % TABS.length;
  switchTab(TABS[next], { focusTab: true });
}

function switchTab(tab, { focus = true, focusTab = false, replace = true } = {}) {
  if (!TABS.includes(tab) || !root) return;
  const changed = tab !== view.tab;
  view.tab = tab;
  root.dataset.tab = tab;
  TABS.forEach((name) => {
    const button = byId("wasteTab-" + name);
    const panel = byId("wastePanel-" + name);
    const active = name === tab;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
    panel.hidden = !active;
    if (active && changed && !reducedMotion()) {
      panel.classList.remove("is-entering");
      void panel.offsetWidth;
      panel.classList.add("is-entering");
    }
  });
  if (replace) {
    try {
      history.replaceState(history.state, "", `${location.pathname}${location.search}${tab === "count" ? "" : "#" + tab}`);
    } catch {
      /* ignore */
    }
  }
  if (tab === "graphics") renderGraphics();
  if (tab === "history") renderHistory();
  measureChrome();
  if (focusTab) byId("wasteTab-" + tab)?.focus();
  else if (focus && changed) {
    const heading = { count: null, graphics: "wasteGraphicsHeading", history: "wasteHistoryHeading" }[tab];
    if (heading) byId(heading)?.focus({ preventScroll: true });
    const tabs = root.querySelector(".waste-tabs");
    const clear = stickyTopOffset();
    if (tabs && tabs.getBoundingClientRect().top < clear)
      window.scrollTo({
        top: Math.max(0, window.scrollY + tabs.getBoundingClientRect().top - clear - 12),
        behavior: reducedMotion() ? "auto" : "smooth",
      });
  }
}

function setType(type) {
  if (type !== "raw" && type !== "full") return;
  view.type = type;
  view.category = "All";
  renderControls();
  renderCats();
  renderList();
}
function setPeriod(period) {
  view.period = ["all", "breakfast", "main"].includes(period) ? period : "all";
  view.category = "All";
  renderControls();
  renderCats();
  renderList();
}
function setFilter(filter) {
  view.filter = filter === "counted" ? "counted" : "all";
  renderControls();
  renderList();
}
function setCategory(category) {
  view.category = category || "All";
  renderCats();
  renderList();
}

// ------------------------------------------------------------ counting
function doStep(id, delta) {
  const before = store.countOf(id);
  if (delta < 0 && before === 0) {
    bump(rowFor(id)?.querySelector("input"), "is-denied");
    return;
  }
  store.step(id, delta);
  try {
    navigator.vibrate?.(8);
  } catch {
    /* ignore */
  }
}

function onStepPointerDown(event) {
  const button = event.target.closest("[data-step]");
  if (!button || (event.pointerType === "mouse" && event.button !== 0)) return;
  const id = button.closest("[data-id]")?.dataset.id;
  if (!id) return;
  clearHold();
  const delta = Number(button.dataset.step) || 0;
  hold = { button, id, delta, fired: false, releasedAt: 0 };
  hold.timer = setTimeout(() => {
    if (!hold) return;
    hold.fired = true;
    doStep(id, delta);
    hold.interval = setInterval(() => doStep(id, delta), 110);
  }, 430);
}

function releaseHold() {
  if (!hold) return;
  clearTimeout(hold.timer);
  clearInterval(hold.interval);
  hold.releasedAt = performance.now();
  if (!hold.fired) hold = null;
}

function clearHold() {
  if (!hold) return;
  clearTimeout(hold.timer);
  clearInterval(hold.interval);
  hold = null;
}

function onStepClick(event) {
  const button = event.target.closest("[data-step]");
  if (!button) return;
  const id = button.closest("[data-id]")?.dataset.id;
  if (hold?.fired) {
    // The press-and-hold already counted; ignore the click that ends it.
    const recent = performance.now() - hold.releasedAt < 600;
    clearHold();
    if (recent) return;
  }
  clearHold();
  if (id) doStep(id, Number(button.dataset.step) || 0);
}

// Small feedback animations use the Web Animations API, so a tap never forces
// a synchronous layout of the whole page.
const BUMPS = {
  "is-bumped": [[{ transform: "scale(1)" }, { transform: "scale(1.22)" }, { transform: "scale(1)" }], 260],
  "is-denied": [
    [
      { transform: "translateX(0)" },
      { transform: "translateX(-4px)" },
      { transform: "translateX(4px)" },
      { transform: "translateX(-3px)" },
      { transform: "translateX(0)" },
    ],
    300,
  ],
  "is-new": [[{ backgroundColor: "#fff4cf" }, { backgroundColor: "#fff4cf", offset: 0.4 }, { backgroundColor: "#ffffff" }], 1200],
};
BUMPS["is-shake"] = BUMPS["is-denied"];
function bump(el, cls = "is-bumped") {
  if (!el || reducedMotion()) return;
  const [frames, duration] = BUMPS[cls] || BUMPS["is-bumped"];
  if (typeof el.animate === "function") {
    try {
      el.animate(frames, { duration, easing: "cubic-bezier(.2,.8,.2,1)" });
      return;
    } catch {
      /* fall through to the class toggle */
    }
  }
  el.classList.remove(cls);
  requestAnimationFrame(() => el.classList.add(cls));
}

// ---------------------------------------------------------------- render
function handleStoreChange(reason, detail = {}) {
  if (!root) return;
  if (reason === "counts") {
    if (view.filter === "counted" && !detail.count) renderList();
    else updateRow(detail.id, true);
    renderTotals(true);
    updateCatBadges();
    renderDock();
    return;
  }
  if (reason === "draft") return renderDock();
  if (reason === "history") {
    renderDock();
    if (view.tab === "history") renderHistory();
    if (view.tab === "graphics") renderGraphics();
    return;
  }
  if (reason === "restart") {
    Object.assign(view, { type: "raw", category: "All", filter: "all", period: "all", search: "" });
    ui.wasteSearch.value = "";
  }
  if (reason === "items" && byId("wasteItemsDialog")?.open) renderManageList();
  renderAll();
}

function renderAll() {
  renderControls();
  renderCats();
  renderList();
  renderTotals(false);
  renderDraftInputs();
  renderDock();
  if (view.tab === "graphics") renderGraphics();
  if (view.tab === "history") renderHistory();
  if (ui.wasteItemsDialog?.open) renderManageList();
}

function renderRole() {
  if (!root) return;
  const manager = isManager();
  root.classList.toggle("is-manager", manager);
  if (ui.wasteRole)
    ui.wasteRole.innerHTML = manager
      ? `${ico("shield")}<span>Manager access · resets without PIN</span>`
      : `${ico("lock")}<span>Resets need a manager PIN</span>`;
  const note = byId("wasteSecurityNote");
  if (note)
    note.textContent = manager
      ? "You're signed in as a manager, so resets here skip the PIN. Crew and the standalone app still use it."
      : "Protects delete and reset actions on every device.";
}

let announcedStatus = "";
function renderStatus(status) {
  if (!ui.wasteSync || !status) return;
  ui.wasteSync.dataset.state = status.state;
  ui.wasteSyncLabel.textContent = status.label;
  const hint = byId("wasteSyncHint");
  if (hint)
    hint.textContent = kit?.preview
      ? "Preview data stays in this tab"
      : status.state === "synced"
        ? "This device matches the shared waste record. Tap to check again."
        : "Tap to sync now";
  // Announce real changes only: the 15-second background check must not make
  // a screen reader say "Syncing" over and over.
  if (status.state !== "syncing" && status.label !== announcedStatus) {
    announcedStatus = status.label;
    const live = byId("wasteSyncLive");
    if (live) live.textContent = status.label;
  }
}

function renderControls() {
  root.dataset.type = view.type;
  root.querySelectorAll(".waste-type [data-type]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.type === view.type)));
  root.querySelectorAll("[data-period]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.period === view.period)));
  root.querySelectorAll("[data-filter]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.filter === view.filter)));
  ui.wasteListLabel.textContent = view.type === "raw" ? "RAW COMPONENT" : "FULL PRODUCT";
  if (ui.wasteSearch.value !== view.search) ui.wasteSearch.value = view.search;
}

function categoriesForType(type) {
  const present = new Set(store.items.filter((i) => i.type === type).map((i) => i.category));
  return CATEGORY_ORDER.filter((c) => present.has(c));
}

function unitsByCategory() {
  const unitsByCat = new Map();
  store.items.forEach((item) => {
    if (item.type !== view.type) return;
    const count = store.countOf(item.id);
    if (!count) return;
    unitsByCat.set(item.category, (unitsByCat.get(item.category) || 0) + count);
    unitsByCat.set("All", (unitsByCat.get("All") || 0) + count);
  });
  return unitsByCat;
}

function badgeHTML(units) {
  return units ? `<span class="waste-cat-count" aria-label="${units} counted">${fmt(units)}</span>` : "";
}

function renderCats() {
  const available = ["All", ...categoriesForType(view.type)];
  if (!available.includes(view.category)) view.category = "All";
  const unitsByCat = unitsByCategory();
  const scroller = ui.wasteCats;
  const scrollLeft = scroller.scrollLeft;
  scroller.innerHTML = available
    .map(
      (cat) =>
        `<button type="button" class="waste-cat" data-cat="${esc(cat)}" aria-pressed="${cat === view.category}">${esc(cat)}${badgeHTML(unitsByCat.get(cat) || 0)}</button>`,
    )
    .join("");
  scroller.scrollLeft = scrollLeft;
}

// Counting only changes the badges: update them in place.
function updateCatBadges() {
  const unitsByCat = unitsByCategory();
  ui.wasteCats.querySelectorAll(".waste-cat").forEach((button) => {
    const units = unitsByCat.get(button.dataset.cat) || 0;
    const badge = button.querySelector(".waste-cat-count");
    if (!units) return badge?.remove();
    if (badge) {
      const text = fmt(units);
      if (badge.textContent !== text) {
        badge.textContent = text;
        badge.setAttribute("aria-label", `${units} counted`);
      }
    } else button.insertAdjacentHTML("beforeend", badgeHTML(units));
  });
}

function filteredItems() {
  const term = view.search.trim().toLowerCase();
  return store.items.filter((item) => {
    if (item.type !== view.type) return false;
    if (view.category !== "All" && item.category !== view.category) return false;
    if (view.period !== "all" && item.shift !== "all" && item.shift !== view.period) return false;
    if (term && !`${item.name} ${item.category}`.toLowerCase().includes(term)) return false;
    if (view.filter === "counted" && store.countOf(item.id) === 0) return false;
    return true;
  });
}

function rowHTML(item) {
  const count = store.countOf(item.id);
  const name = esc(item.name);
  return `<article class="waste-row${count > 0 ? " is-counted" : ""}" data-id="${esc(item.id)}">
    <div class="waste-row-info"><p class="waste-row-name">${name}</p><p class="waste-row-meta"><span class="waste-chip">${esc(item.category)}</span><span>${esc(shiftLabel(item.shift))}</span>${item.custom ? '<span class="waste-chip is-custom">Custom</span>' : ""}</p></div>
    <div class="waste-stepper" role="group" aria-label="${name}">
      <button type="button" class="waste-step is-minus" data-step="-1" aria-label="Subtract one ${name}">${ico("minus")}</button>
      <input type="number" data-count min="0" max="99999" step="1" inputmode="numeric" pattern="[0-9]*" value="${count}" aria-label="${name} count">
      <button type="button" class="waste-step is-plus" data-step="1" aria-label="Add one ${name}">${ico("plus")}</button>
    </div>
  </article>`;
}

function renderList() {
  if (!ui.wasteList) return;
  const active = document.activeElement;
  if (active && ui.wasteList.contains(active) && active.matches("input[data-count]")) {
    // Never wipe a number someone is typing; render once they leave the field.
    pendingListRender = true;
    return;
  }
  pendingListRender = false;
  const items = filteredItems();
  ui.wasteList.innerHTML = items.map(rowHTML).join("");
  ui.wasteVisible.textContent = `${items.length} shown`;
  ui.wasteEmpty.hidden = items.length > 0;
  if (!items.length) {
    const nothingCounted = view.filter === "counted" && !view.search.trim();
    byId("wasteEmptyTitle").textContent = nothingCounted ? "Nothing counted here yet" : "No items found";
    byId("wasteEmptyText").textContent = nothingCounted
      ? `Switch to All items and tap + to add ${view.type === "raw" ? "RAW" : "FULL"} waste to this sheet.`
      : "Try a different search, waste type or category.";
  }
}

function rowFor(id) {
  if (!id) return null;
  return ui.wasteList.querySelector(`[data-id="${CSS.escape(id)}"]`);
}

function updateRow(id, animate) {
  const row = rowFor(id);
  if (!row) return;
  const count = store.countOf(id);
  const input = row.querySelector("input[data-count]");
  if (input && document.activeElement !== input) input.value = String(count);
  row.classList.toggle("is-counted", count > 0);
  if (animate) bump(input);
}

function renderTotals(animate) {
  const t = store.totals();
  const set = (id, value) => {
    const el = ui[id];
    if (!el) return;
    const text = fmt(value);
    if (el.textContent !== text) {
      el.textContent = text;
      if (animate) bump(el);
    }
  };
  set("wasteRawTotal", t.raw);
  set("wasteFullTotal", t.full);
  set("wasteGrandTotal", t.total);
  set("wasteLineCount", t.lines);
  set("wasteDockRaw", t.raw);
  set("wasteDockFull", t.full);
  set("wasteDockTotal", t.total);
  const typeUnits = { raw: t.raw, full: t.full };
  ["raw", "full"].forEach((type) => {
    const el = byId("wasteTypeCount-" + type);
    if (el) {
      el.textContent = fmt(typeUnits[type]);
      el.hidden = !typeUnits[type];
    }
  });
}

function renderDraftInputs() {
  const draft = store.draft;
  if (document.activeElement !== ui.wasteSheetName && ui.wasteSheetName.value !== draft.sheetName)
    ui.wasteSheetName.value = draft.sheetName;
  if (document.activeElement !== ui.wasteSheetNotes && ui.wasteSheetNotes.value !== draft.sheetNotes)
    ui.wasteSheetNotes.value = draft.sheetNotes;
}

function sheetSignature(entries, label, notes) {
  return JSON.stringify([
    (entries || [])
      .filter((e) => Number(e.count) > 0)
      .map((e) => `${e.id}:${Number(e.count)}`)
      .sort(),
    String(label || "").trim(),
    String(notes || "").trim(),
  ]);
}

function renderDock() {
  const el = ui.wasteDockState;
  if (!el) return;
  const t = store.totals();
  const draft = store.draft;
  const saved = draft.sheetId ? store.findSheet(draft.sheetId) : null;
  let state = "new";
  let text = t.lines ? "New sheet · not saved yet" : "Tap + to start counting";
  // Phones show a one-line dock, so they get a shorter visible label; the
  // full sentence stays available to screen readers.
  let short = t.lines ? "Not saved yet" : "Nothing counted";
  if (saved) {
    const same =
      sheetSignature(saved.entries, saved.label, saved.notes) ===
      sheetSignature(store.countedEntries(), draft.sheetName, draft.sheetNotes);
    const time = new Date(saved.updatedAt || saved.createdAt);
    const at = Number.isFinite(time.getTime())
      ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(time)
      : "";
    state = same ? "saved" : "changed";
    text = same ? `Saved${at ? " at " + at : ""} · in History` : "Unsaved changes · Save to update";
    short = same ? `Saved${at ? " " + at : ""}` : "Unsaved edits";
  }
  if (el.textContent !== text) el.textContent = text;
  el.dataset.state = state;
  const shortEl = byId("wasteDockShort");
  if (shortEl && shortEl.textContent !== short) shortEl.textContent = short;
  byId("wasteDock")?.setAttribute("data-state", state);
  scheduleDockPosition();
}

// ------------------------------------------------------------ dock position
// The Save dock floats at the bottom of the screen while the list scrolls,
// then rests in place at the end of the Count panel. It steps aside (slides
// down out of the way) whenever floating would hide the controls above the
// item rows (RAW/FULL, menu period, search, filters, categories), while the
// hero's totals are still on screen (it shows up once you scroll into the
// list) and while nothing is counted yet (there is nothing to save).
// Keyboard focus always brings it back (see :focus-within in waste.css).
let dockFrame = 0;
function scheduleDockPosition() {
  if (dockFrame || typeof requestAnimationFrame !== "function") return;
  dockFrame = requestAnimationFrame(() => {
    dockFrame = 0;
    positionDock();
  });
}
function positionDock() {
  const dock = byId("wasteDock");
  const rect = dock && root && root.contains(dock) && view.tab === "count" ? dock.getBoundingClientRect() : null;
  if (!rect || !rect.height) return liftToasts(null);
  // A sticky element that is floating sits above its place in the flow,
  // i.e. over the end of whatever comes before it.
  const before = dock.previousElementSibling;
  const panel = dock.parentElement;
  const gap = panel ? parseFloat(getComputedStyle(panel).rowGap) || 0 : 0;
  const floating = before ? rect.top < before.getBoundingClientRect().bottom + gap - 1 : false;
  let tucked = "";
  if (floating) {
    // Everything above the item rows (RAW/FULL, menu period, search, filters,
    // categories) must stay tappable, so the dock only floats over the rows.
    const controls = root.querySelector(".waste-list-head") || root.querySelector(".waste-setup");
    const controlsBottom = controls ? controls.getBoundingClientRect().bottom : -Infinity;
    // While the hero's own totals are on screen the dock would only repeat
    // them (and sit on the first rows), so it appears once they scroll away.
    const totals = root.querySelector(".waste-hero .waste-totals")?.getBoundingClientRect();
    const totalsOnScreen = totals && totals.height > 0 && totals.bottom > stickyTopOffset() + totals.height / 2;
    if (controlsBottom > rect.top + 1) tucked = "controls";
    else if (totalsOnScreen) tucked = "totals";
    else if (!store.totals().lines) tucked = "empty";
  }
  if (dock.dataset.floating !== String(floating)) dock.dataset.floating = String(floating);
  if (tucked) {
    if (dock.dataset.tucked !== tucked) dock.dataset.tucked = tucked;
  } else if (dock.hasAttribute("data-tucked")) dock.removeAttribute("data-tucked");
  // Keyboard focus shows a tucked dock (see :focus-within in waste.css).
  liftToasts(!tucked || dock.contains(document.activeElement) ? rect : null);
}
// Toasts normally sit just above the bottom navigation, exactly where the
// dock floats: lift them above a visible dock so Save is never covered.
function liftToasts(dockRect) {
  const body = document.body;
  const lift = dockRect && dockRect.top > window.innerHeight * 0.45 ? Math.round(window.innerHeight - dockRect.top + 10) : 0;
  if (lift) {
    // Runs on scroll frames: write only what changed.
    if (body.dataset.wasteDock !== "up") body.dataset.wasteDock = "up";
    if (body.style.getPropertyValue("--waste-toast-bottom") !== `${lift}px`)
      body.style.setProperty("--waste-toast-bottom", `${lift}px`);
  } else if (body.dataset.wasteDock) {
    delete body.dataset.wasteDock;
    body.style.removeProperty("--waste-toast-bottom");
  }
}

// ----------------------------------------------------------- sheet actions
function saveSheet() {
  const result = store.saveSheet({ shift: view.period });
  if (!result.ok) {
    toast("Count some waste first");
    bump(ui.wasteSaveBtn, "is-denied");
    return;
  }
  toast(result.updated ? "Saved sheet updated" : "Waste sheet saved");
  const button = ui.wasteSaveBtn;
  button.classList.add("is-done");
  button.querySelector("span").textContent = "Saved";
  clearTimeout(savedFlashTimer);
  savedFlashTimer = setTimeout(() => {
    button.classList.remove("is-done");
    button.querySelector("span").textContent = "Save sheet";
  }, 1600);
}

function clearCurrent() {
  if (!store.countedEntries().length) return toast("Nothing to clear");
  requireApproval(
    "Clear current waste",
    () => {
      store.clearCurrent();
      toast("Current counts cleared");
    },
    { message: "All current counts go back to zero on every synced device. Saved history stays.", confirmLabel: "Clear counts" },
  );
}

function currentSheetForPaper() {
  const draft = store.draft;
  return {
    entries: store.countedEntries(),
    label: draft.sheetName.trim(),
    notes: draft.sheetNotes.trim(),
    createdAt: new Date().toISOString(),
  };
}

function downloadBytes(bytes, filename, type = "application/pdf") {
  const blob = new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function downloadPaper(sheet, { showRestart = false } = {}) {
  const pdf = createPaperPdf(sheet);
  if (!pdf) return toast("Nothing counted yet");
  downloadBytes(pdf.bytes, pdf.filename);
  toast("Paper PDF downloaded");
  if (showRestart) setTimeout(() => showSheetComplete(pdf.data), 450);
}

function downloadCurrentPaper() {
  if (!store.countedEntries().length) return toast("Nothing counted yet");
  downloadPaper(currentSheetForPaper(), { showRestart: true });
}

function showSheetComplete(data) {
  byId("wasteCompleteRaw").textContent = fmt(data.rawTotal);
  byId("wasteCompleteFull").textContent = fmt(data.fullTotal);
  byId("wasteCompleteTotal").textContent = fmt(data.total);
  openDialog(ui.wasteCompleteDialog, byId("wasteStartNewBtn"));
}

function startNewSheet() {
  requireApproval(
    "Start a new waste sheet",
    () => {
      store.restartSheet();
      closeDialog(ui.wasteCompleteDialog);
      window.scrollTo({ top: 0, behavior: reducedMotion() ? "auto" : "smooth" });
      toast("New waste sheet ready");
    },
    { skipManagerConfirm: true },
  );
}

// Printing uses a clean A4 sheet outside the hub layout.
function ensurePrintRoot() {
  if (byId("wastePrintRoot")) return;
  const el = document.createElement("div");
  el.id = "wastePrintRoot";
  el.className = "waste-print";
  el.setAttribute("aria-hidden", "true");
  document.body.appendChild(el);
}

function paperList(entries) {
  if (!entries.length) return '<div class="waste-print-empty">No waste recorded</div>';
  return entries
    .map((e) => `<div class="waste-print-line"><span>${esc(e.name)}</span><strong>${fmt(e.count)}</strong></div>`)
    .join("");
}

function printSheet(sheet) {
  const data = paperData(sheet);
  if (!data.entries.length) return toast("Nothing counted yet");
  ensurePrintRoot();
  byId("wastePrintRoot").innerHTML = `<section class="waste-print-sheet">
    <header class="waste-print-head"><div><p class="waste-print-kicker">HAYLE · WASTE RECORD</p><h1>Waste Sheet</h1><p class="waste-print-meta">${esc(data.label)} · ${esc(formatSheetDate(data.date))}</p></div><div class="waste-print-total"><span>TOTAL WASTE</span><strong>${fmt(data.total)}</strong></div></header>
    <div class="waste-print-columns">
      <section><div class="waste-print-cat"><h2>RAW</h2><span>${fmt(data.rawTotal)}</span></div>${paperList(data.raw)}</section>
      <section><div class="waste-print-cat"><h2>FULL</h2><span>${fmt(data.fullTotal)}</span></div>${paperList(data.full)}</section>
    </div>
    ${data.notes ? `<section class="waste-print-notes"><strong>Notes</strong><p>${esc(data.notes)}</p></section>` : ""}
  </section>`;
  document.body.classList.add("waste-printing");
  const done = () => document.body.classList.remove("waste-printing");
  window.addEventListener("afterprint", done, { once: true });
  try {
    window.print();
  } finally {
    setTimeout(done, 1500);
  }
}

function printCurrent() {
  if (!store.countedEntries().length) return toast("Nothing counted yet");
  printSheet(currentSheetForPaper());
}

// ---------------------------------------------------------------- history
function historyDateLabel(date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function totalsOf(sheet) {
  return sheetTotals(sheet) || { raw: 0, full: 0, total: 0 };
}

function renderHistory() {
  const list = ui.wasteHistoryList;
  if (!list) return;
  const history = store.history().filter((sheet) => sheet && typeof sheet === "object");
  const all = history.reduce(
    (sum, sheet) => {
      const t = totalsOf(sheet);
      return { raw: sum.raw + t.raw, full: sum.full + t.full };
    },
    { raw: 0, full: 0 },
  );
  byId("wasteHistoryCount").textContent = fmt(history.length);
  byId("wasteHistoryRaw").textContent = fmt(all.raw);
  byId("wasteHistoryFull").textContent = fmt(all.full);
  const search = view.historySearch.trim().toLowerCase();
  const range = view.historyRange;
  const today = dayKey(new Date());
  const firstDay = range === "all" ? null : shiftDay(today, Number(range) === 30 ? -29 : -6);
  const visible = history
    .filter((sheet) => {
      const key = dayKey(sheet.createdAt);
      if (firstDay && (!key || key < firstDay || key > today)) return false;
      const text = [sheet.label, sheet.notes, ...(Array.isArray(sheet.entries) ? sheet.entries : []).map((e) => e?.name)]
        .join(" ")
        .toLowerCase();
      return !search || text.includes(search);
    })
    .sort((a, b) => (new Date(b.createdAt).getTime() || 0) - (new Date(a.createdAt).getTime() || 0));
  byId("wasteHistoryResults").textContent = `${visible.length} ${visible.length === 1 ? "sheet" : "sheets"}${search || range !== "all" ? ` of ${history.length}` : ""}`;
  if (!history.length) {
    list.innerHTML = `<div class="waste-empty is-card"><span class="waste-empty-icon" aria-hidden="true">${ico("history")}</span><h3>A fresh start.</h3><p>Save a count to begin your history and daily graphics.</p><button type="button" class="waste-btn is-yellow" data-tab="count">Start counting</button></div>`;
    return;
  }
  if (!visible.length) {
    list.innerHTML = `<div class="waste-empty is-card"><h3>No matching sheets.</h3><p>Try another search or a wider date range.</p></div>`;
    return;
  }
  const activeId = store.draft.sheetId;
  const manager = isManager();
  // Background refreshes must not collapse a sheet someone is reading.
  const openIds = new Set(
    [...list.querySelectorAll(".waste-history-details[open]")].map((d) => d.closest("[data-sheet]")?.dataset.sheet),
  );
  const shown = visible.slice(0, view.historyLimit);
  const more = visible.length - shown.length;
  list.innerHTML =
    shown
    .map((s) => {
      const t = totalsOf(s);
      const date = new Date(s.createdAt);
      const entries = Array.isArray(s.entries) ? s.entries.filter(Boolean) : [];
      const raw = entries.filter((e) => e.type === "raw" && Number(e.count) > 0);
      const full = entries.filter((e) => e.type === "full" && Number(e.count) > 0);
      const li = (e) => `<li><span>${esc(e.name)}</span><strong>${fmt(Math.max(0, Number(e.count) || 0))}</strong></li>`;
      const id = esc(s.id);
      const title = esc(s.label || "Waste sheet");
      return `<article class="waste-history-card${s.id === activeId ? " is-active" : ""}" data-sheet="${id}">
        <div class="waste-history-top">
          <div class="waste-history-title">
            <span class="waste-history-date">${Number.isFinite(date.getTime()) ? esc(historyDateLabel(date)) : "Saved sheet"}${s.shift && s.shift !== "all" ? ` · ${esc(shiftLabel(s.shift))}` : ""}</span>
            <h3>${title}${s.id === activeId ? ' <span class="waste-chip is-live">Current sheet</span>' : ""}</h3>
            ${s.notes ? `<p class="waste-history-note">${esc(s.notes)}</p>` : ""}
          </div>
          <div class="waste-history-total"><span>Total units</span><strong>${fmt(t.total)}</strong></div>
        </div>
        <div class="waste-history-stats"><span class="is-raw">RAW <strong>${fmt(t.raw)}</strong></span><span class="is-full">FULL <strong>${fmt(t.full)}</strong></span><span>ITEMS <strong>${entries.length}</strong></span></div>
        <details class="waste-history-details"${openIds.has(s.id) ? " open" : ""}>
          <summary>View counted items ${ico("chevron", "waste-ico waste-chev")}</summary>
          <div class="waste-history-breakdown">
            <section><div class="waste-history-sec is-raw"><span>RAW</span><small>${raw.length} item${raw.length === 1 ? "" : "s"}</small></div><ul>${raw.length ? raw.map(li).join("") : '<li class="is-none">No RAW waste</li>'}</ul></section>
            <section><div class="waste-history-sec is-full"><span>FULL</span><small>${full.length} item${full.length === 1 ? "" : "s"}</small></div><ul>${full.length ? full.map(li).join("") : '<li class="is-none">No FULL waste</li>'}</ul></section>
          </div>
        </details>
        <div class="waste-history-actions">
          <button type="button" class="waste-btn is-yellow is-compact" data-history-action="download" data-id="${id}" aria-label="Download paper for ${title}">${ico("download")}<span>Download</span></button>
          <button type="button" class="waste-btn is-light is-compact" data-history-action="print" data-id="${id}" aria-label="Print ${title}">${ico("print")}<span>Print</span></button>
          <button type="button" class="waste-btn is-light is-compact" data-history-action="restore" data-id="${id}" aria-label="Restore ${title} to the counter">${ico("undo")}<span>Restore</span></button>
          <button type="button" class="waste-btn is-danger is-compact waste-protected" data-history-action="delete" data-id="${id}" aria-label="Delete ${title}">${manager ? ico("trash") : ico("lock", "waste-ico waste-lock")}<span>Delete</span></button>
        </div>
      </article>`;
    })
    .join("") +
    (more > 0
      ? `<div class="waste-history-more"><button type="button" class="waste-btn is-light" id="wasteHistoryMore">Show ${Math.min(more, 12)} more of ${more}</button></div>`
      : "");
}

function onHistoryAction(button) {
  const id = button.dataset.id;
  const sheet = store.findSheet(id);
  if (!sheet) {
    toast("That sheet is no longer in History");
    renderHistory();
    return;
  }
  const action = button.dataset.historyAction;
  if (action === "download") return downloadPaper(sheet);
  if (action === "print") return printSheet(sheet);
  if (action === "restore") {
    const run = () => {
      store.restoreHistory(id);
      switchTab("count");
      window.scrollTo({ top: 0, behavior: reducedMotion() ? "auto" : "smooth" });
      toast("Sheet restored");
    };
    if (store.countedEntries().length) {
      openConfirm({
        kicker: "Restore sheet",
        title: "Replace current counts?",
        message: "Your current counts will be replaced with this saved sheet. The saved sheet itself stays in History.",
        action: sheet.label || "Saved sheet",
        confirmLabel: "Replace counts",
        onConfirm: run,
      });
    } else run();
    return;
  }
  if (action === "delete") {
    requireApproval(
      `Delete ${sheet.label || "saved sheet"}`,
      () => {
        store.deleteHistory(id);
        toast("Sheet deleted");
      },
      { message: "This saved sheet is removed from History on every synced device.", confirmLabel: "Delete sheet", danger: true },
    );
  }
}

// --------------------------------------------------------------- graphics
function renderGraphics() {
  const summary = byId("wasteGraphicsSummary");
  if (!summary) return;
  const history = store.history();
  byId("wasteGraphicsType").value = view.graphicsType;
  byId("wasteGraphicsRange").value = String(view.graphicsRange);
  const period = renderInsights(
    {
      summary,
      chart: byId("wasteChart"),
      breakdown: byId("wasteBreakdown"),
      rangeLabel: byId("wasteChartRange"),
      empty: byId("wasteGraphicsEmpty"),
    },
    history,
    { range: view.graphicsRange, type: view.graphicsType },
  );
  renderTopItems(history, period);
}

function renderTopItems(history, period) {
  const list = byId("wasteTopItems");
  if (!list || !period) return;
  const totals = new Map();
  const seen = new Set();
  history.forEach((sheet) => {
    if (!sheet?.id || seen.has(sheet.id)) return;
    const key = dayKey(sheet.createdAt);
    if (!key || key < period.start || key > period.end) return;
    seen.add(sheet.id);
    (Array.isArray(sheet.entries) ? sheet.entries : []).forEach((e) => {
      if (!e || (e.type !== "raw" && e.type !== "full")) return;
      if (period.type !== "all" && e.type !== period.type) return;
      const count = Math.max(0, Math.floor(Number(e.count) || 0));
      if (!count) return;
      const k = `${e.type}|${String(e.name || "").trim().toLowerCase()}`;
      const row = totals.get(k) || { name: String(e.name || "Item"), type: e.type, count: 0 };
      row.count += count;
      totals.set(k, row);
    });
  });
  const top = [...totals.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 6);
  byId("wasteTopCaption").textContent = `Last ${period.range} days · ${period.type === "all" ? "RAW + FULL" : period.type.toUpperCase()}`;
  if (!top.length) {
    list.innerHTML = '<li class="waste-top-empty">No saved waste in this period yet.</li>';
    return;
  }
  const max = top[0].count || 1;
  list.innerHTML = top
    .map(
      (row, index) =>
        `<li class="waste-top-row is-${row.type}" style="--rank:${index}"><div class="waste-top-copy"><span class="waste-top-name">${esc(row.name)}</span><span class="waste-top-type">${row.type.toUpperCase()}</span><strong>${fmt(row.count)}</strong></div><span class="waste-top-bar" aria-hidden="true"><i style="width:${Math.max(4, Math.round((row.count / max) * 100))}%"></i></span></li>`,
    )
    .join("");
}

// ------------------------------------------------------------ item manager
function buildCategorySelect() {
  const type = byId("wasteNewItemType").value === "full" ? "full" : "raw";
  byId("wasteNewItemCategory").innerHTML = ADD_ITEM_CATEGORIES[type]
    .map((c) => `<option value="${esc(c)}">${esc(c)}</option>`)
    .join("");
}

function openItemsManager() {
  view.renaming = null;
  view.manageSearch = "";
  byId("wasteManageSearch").value = "";
  byId("wasteNewItemType").value = view.type;
  buildCategorySelect();
  renderManageList();
  // On touch screens, opening the manager must not pop the keyboard up.
  const coarse = window.matchMedia?.("(pointer: coarse)").matches;
  openDialog(ui.wasteItemsDialog, coarse ? null : byId("wasteNewItemName"), { focusFirst: coarse });
}

function renderManageList() {
  const list = ui.wasteManageList;
  if (!list) return;
  const term = view.manageSearch.trim().toLowerCase();
  const sorted = [...store.items].sort(
    (a, b) =>
      a.type.localeCompare(b.type) ||
      CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
      String(a.name).localeCompare(String(b.name)),
  );
  const visible = sorted.filter((item) => !term || `${item.name} ${item.category}`.toLowerCase().includes(term));
  byId("wasteManageCount").textContent = `${visible.length} of ${sorted.length} items`;
  const lock = isManager() ? ico("trash") : ico("lock", "waste-ico waste-lock");
  list.innerHTML = visible.length
    ? visible
        .map((item) => {
          const id = esc(item.id);
          const name = esc(item.name);
          if (view.renaming === item.id)
            return `<form class="waste-manage-row is-renaming" data-id="${id}"><label class="waste-field"><span>Rename ${esc(item.type.toUpperCase())} item</span><input name="name" value="${name}" maxlength="60" required autocomplete="off" aria-label="New name for ${name}"></label><div class="waste-manage-actions"><button type="button" class="waste-btn is-light is-compact" data-manage="cancel">Cancel</button><button type="submit" class="waste-btn is-dark is-compact">Save name</button></div></form>`;
          return `<div class="waste-manage-row" data-id="${id}"><div class="waste-manage-copy"><strong><span class="waste-type-tag is-${item.type}">${item.type.toUpperCase()}</span>${name}</strong><small>${esc(item.category)} · ${esc(shiftLabel(item.shift))}${item.custom ? " · CUSTOM" : ""}</small></div><div class="waste-manage-actions"><button type="button" class="waste-btn is-light is-compact" data-manage="rename" aria-label="Rename ${name}">${ico("pencil")}<span>Rename</span></button><button type="button" class="waste-btn is-danger is-compact waste-protected" data-manage="remove" aria-label="Remove ${name}">${lock}<span>Remove</span></button></div></div>`;
        })
        .join("")
    : '<p class="waste-muted waste-manage-empty">No items match that search.</p>';
  if (view.renaming) {
    const input = list.querySelector(".is-renaming input");
    input?.focus();
    input?.select();
  }
}

function onManageClick(event) {
  const button = event.target.closest("[data-manage]");
  if (!button) return;
  const id = button.closest("[data-id]")?.dataset.id;
  const item = store.items.find((i) => i.id === id);
  const action = button.dataset.manage;
  if (action === "cancel") {
    view.renaming = null;
    return renderManageList();
  }
  if (!item) return;
  if (action === "rename") {
    view.renaming = id;
    return renderManageList();
  }
  if (action === "remove") {
    requireApproval(
      `Remove ${item.name}`,
      () => {
        store.removeItem(id);
        notify(`${item.name} removed`);
      },
      { message: "The item and its current count are removed from the shared list. Saved history keeps it.", confirmLabel: "Remove item", danger: true },
    );
  }
}

function onRenameSubmit(event) {
  const form = event.target.closest(".is-renaming");
  if (!form) return;
  event.preventDefault();
  const id = form.dataset.id;
  const value = form.querySelector("input")?.value || "";
  const result = store.renameItem(id, value);
  if (!result.ok) {
    notify(result.reason === "duplicate" ? "That item already exists" : "Give the item a name");
    form.querySelector("input")?.focus();
    return;
  }
  view.renaming = null;
  renderManageList();
  if (!result.unchanged) notify(`Renamed to ${result.item.name}`);
}

function onAddItem(event) {
  event.preventDefault();
  const nameInput = byId("wasteNewItemName");
  const result = store.addItem({
    name: nameInput.value,
    type: byId("wasteNewItemType").value,
    category: byId("wasteNewItemCategory").value,
    shift: byId("wasteNewItemShift").value,
  });
  if (!result.ok) {
    notify(result.reason === "duplicate" ? "That item already exists" : "Give the item a name");
    nameInput.focus();
    return;
  }
  nameInput.value = "";
  notify(`${result.item.name} added`);
  renderManageList();
  const row = ui.wasteManageList.querySelector(`[data-id="${CSS.escape(result.item.id)}"]`);
  row?.scrollIntoView({ block: "nearest" });
  bump(row, "is-new");
}

function restoreDefaultItems() {
  requireApproval(
    "Restore default item lists",
    () => {
      store.restoreDefaults();
      view.category = "All";
      notify("Default lists restored");
    },
    {
      message: "The RAW/FULL lists go back to the Hayle defaults and current counts are cleared. Saved history stays.",
      confirmLabel: "Restore defaults",
      danger: true,
    },
  );
}

// ---------------------------------------------------------------- dialogs
function openDialog(dialog, focusTarget, { focusFirst = true } = {}) {
  if (!dialog) return;
  if (!dialog.open) {
    if (typeof dialog.showModal === "function") {
      try {
        dialog.showModal();
      } catch {
        dialog.setAttribute("open", "");
      }
    } else dialog.setAttribute("open", "");
  }
  document.documentElement.classList.add("waste-dialog-open");
  if (focusTarget) setTimeout(() => focusTarget.focus({ preventScroll: true }), 40);
  else if (focusFirst) dialog.querySelector("button, input, select")?.focus({ preventScroll: true });
}

function closeDialog(dialog) {
  if (!dialog) return;
  if (dialog.open) {
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  }
  onDialogClosed(dialog);
}

function onDialogClosed(dialog) {
  // The native "close" event arrives a moment later; ignore it if the same
  // dialog has been reopened for a follow-up action in the meantime.
  if (dialog?.open) return;
  if (dialog === ui.wastePinDialog) {
    pendingAction = null;
    hidePinError();
  }
  if (dialog === ui.wasteConfirmDialog) confirmHandler = null;
  if (dialog === ui.wasteItemsDialog) view.renaming = null;
  if (!root?.querySelector("dialog[open]")) document.documentElement.classList.remove("waste-dialog-open");
}

function openConfirm({ kicker = "Please confirm", title, message, action, confirmLabel = "Confirm", onConfirm, manager = false, danger = false }) {
  byId("wasteConfirmKicker").textContent = kicker;
  byId("wasteConfirmTitle").textContent = title;
  byId("wasteConfirmMessage").textContent = message || "";
  byId("wasteConfirmAction").textContent = action || "";
  byId("wasteConfirmCard").hidden = !action;
  byId("wasteConfirmManager").hidden = !manager;
  const button = byId("wasteConfirmBtn");
  button.textContent = confirmLabel;
  button.classList.toggle("is-dark", !danger);
  button.classList.toggle("is-danger-solid", danger);
  confirmHandler = onConfirm;
  openDialog(ui.wasteConfirmDialog, button);
}

function pinApi(action, payload) {
  return store.pinRequest(action, payload);
}

// Destructive actions: managers confirm with one tap, everyone else needs the
// shared manager PIN (checked server-side through /api/waste).
async function requireApproval(actionName, onApproved, options = {}) {
  if (isManager()) {
    if (options.skipManagerConfirm) return onApproved();
    openConfirm({
      kicker: "Manager action",
      title: `${actionName}?`,
      message: options.message || "This changes shared waste data on every synced device.",
      action: actionName,
      confirmLabel: options.confirmLabel || "Confirm",
      danger: options.danger,
      manager: true,
      onConfirm: onApproved,
    });
    return;
  }
  pendingAction = onApproved;
  try {
    const status = await pinApi("pin-status");
    openPin(status.configured ? "verify" : "setup", actionName, onApproved);
  } catch (error) {
    pendingAction = null;
    toast(error.message || "Manager PIN unavailable");
  }
}

async function openPinSettings() {
  pendingAction = null;
  try {
    const status = await pinApi("pin-status");
    openPin(status.configured ? "change" : "setup", "Manager security", null);
  } catch (error) {
    toast(error.message || "Manager PIN unavailable");
  }
}

function hidePinError() {
  const el = byId("wastePinError");
  if (!el) return;
  el.hidden = true;
  el.textContent = "";
}
function showPinError(message) {
  const el = byId("wastePinError");
  el.textContent = message;
  el.hidden = false;
  bump(byId("wastePinDialog")?.querySelector(".waste-dialog-inner"), "is-shake");
}

function openPin(mode, actionName = "", action = pendingAction) {
  pinMode = mode;
  const isVerify = mode === "verify";
  const isSetup = mode === "setup";
  const isChange = mode === "change";
  ["wastePinCurrent", "wastePinNew", "wastePinConfirm"].forEach((id) => (byId(id).value = ""));
  hidePinError();
  byId("wastePinKicker").textContent = isSetup ? "Set up security" : isChange ? "Manager security" : "Manager approval";
  byId("wastePinTitle").textContent = isSetup ? "Create manager PIN" : isChange ? "Change manager PIN" : "Enter manager PIN";
  byId("wastePinDescription").textContent = isSetup
    ? "Create one 4-digit PIN for Hayle. It will protect delete and reset actions on every synced device."
    : isChange
      ? "Enter the current PIN, then choose a new 4-digit manager PIN."
      : "This action changes shared waste data and needs manager approval.";
  byId("wastePinActionCard").hidden = isChange || (isSetup && !action);
  byId("wastePinActionName").textContent = actionName || "Protected action";
  byId("wastePinCurrentField").hidden = isSetup;
  byId("wastePinNewField").hidden = isVerify;
  byId("wastePinConfirmField").hidden = isVerify;
  byId("wastePinCurrentLabel").textContent = isChange ? "Current PIN" : "Manager PIN";
  byId("wastePinCurrent").setAttribute("aria-label", isChange ? "Current PIN" : "Manager PIN");
  byId("wastePinNew").setAttribute("aria-label", "New manager PIN");
  byId("wastePinConfirm").setAttribute("aria-label", "Confirm manager PIN");
  byId("wastePinHint").hidden = !kit?.preview;
  byId("wastePinFoot").textContent = kit?.preview
    ? "Preview only: the PIN is checked in this tab and nothing is shared."
    : "The PIN is checked on the server and is not stored in the app.";
  const submit = byId("wastePinSubmit");
  submit.disabled = false;
  submit.textContent = isSetup ? "Set PIN" : isChange ? "Change PIN" : "Authorise";
  const dialog = ui.wastePinDialog;
  const wasOpen = dialog.open;
  openDialog(dialog, isSetup ? byId("wastePinNew") : byId("wastePinCurrent"));
  // Re-opening in another mode must keep the pending action.
  if (wasOpen || action) pendingAction = action;
}

const validPin = (pin) => /^\d{4}$/.test(String(pin || ""));

async function submitPin(event) {
  event.preventDefault();
  hidePinError();
  const currentPin = byId("wastePinCurrent").value.trim();
  const newPin = byId("wastePinNew").value.trim();
  const confirmPin = byId("wastePinConfirm").value.trim();
  const button = byId("wastePinSubmit");
  if (pinMode === "verify" && !validPin(currentPin)) return showPinError("Enter the 4-digit manager PIN.");
  if (pinMode === "setup") {
    if (!validPin(newPin)) return showPinError("Choose a 4-digit PIN.");
    if (newPin !== confirmPin) return showPinError("The two PINs do not match.");
  }
  if (pinMode === "change") {
    if (!validPin(currentPin)) return showPinError("Enter the current 4-digit PIN.");
    if (!validPin(newPin)) return showPinError("Choose a new 4-digit PIN.");
    if (newPin !== confirmPin) return showPinError("The two new PINs do not match.");
    if (currentPin === newPin) return showPinError("Choose a different new PIN.");
  }
  button.disabled = true;
  button.textContent = pinMode === "verify" ? "Checking…" : "Saving…";
  const dialog = ui.wastePinDialog;
  try {
    if (pinMode === "verify" || pinMode === "setup") {
      if (pinMode === "verify") await pinApi("pin-verify", { pin: currentPin });
      else await pinApi("pin-setup", { pin: newPin });
      const action = pendingAction;
      pendingAction = null;
      closeDialog(dialog);
      toast(pinMode === "verify" ? "Manager approved" : "Manager PIN set");
      action?.();
      return;
    }
    await pinApi("pin-change", { currentPin, newPin });
    closeDialog(dialog);
    notify("Manager PIN changed");
  } catch (error) {
    if (error.code === "PIN_INCORRECT") {
      byId("wastePinCurrent").value = "";
      byId("wastePinCurrent").focus();
      showPinError("Incorrect manager PIN. Try again.");
    } else if (error.code === "PIN_ALREADY_CONFIGURED") {
      openPin("verify", byId("wastePinActionName").textContent || "Protected action", pendingAction);
      showPinError("A manager PIN was already set on another device.");
    } else {
      showPinError(error.message || "Could not check manager PIN.");
    }
  } finally {
    if (dialog.open) {
      button.disabled = false;
      button.textContent = pinMode === "setup" ? "Set PIN" : pinMode === "change" ? "Change PIN" : "Authorise";
    }
  }
}
