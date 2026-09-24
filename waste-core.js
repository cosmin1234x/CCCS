// Hayle waste counter — data model and offline-first sync engine.
//
// Ported from the standalone Hayle Waste Counter (app.js v17). The default
// item list, labels, merge rules and sync behaviour are business data and are
// kept exactly as the standalone app has them, so the hub, the web app and the
// Android APK can all share one record safely. This module has no DOM access:
// the page (waste-page.js) renders it and the unit tests drive it directly.

export const CATEGORY_ORDER = [
  "Beef",
  "Chicken & Fish",
  "Bread",
  "Breakfast",
  "Sides",
  "Burgers",
  "Chicken",
  "Wraps & Salads",
  "Fries & Sides",
  "Desserts",
  "Seasonal",
];

export const ADD_ITEM_CATEGORIES = {
  raw: ["Beef", "Chicken & Fish", "Bread", "Breakfast", "Sides", "Seasonal"],
  full: ["Burgers", "Chicken", "Wraps & Salads", "Fries & Sides", "Breakfast", "Desserts", "Seasonal"],
};

export const MENU_PERIODS = [
  ["all", "All menu"],
  ["breakfast", "Breakfast"],
  ["main", "Main menu"],
];

// RAW = individual food/components. FULL = completed saleable products.
// The list is editable so it can be matched to Hayle's exact paper sheet.
export const DEFAULT_ITEM_DATA = [
  // RAW — BEEF
  ["10:1 Beef Patty", "Beef", "main", "raw"],
  ["4:1 Quarter Pounder Patty", "Beef", "main", "raw"],

  // RAW — CHICKEN / FISH / PLANT
  ["Saver / Mayo Chicken Patty", "Chicken & Fish", "main", "raw"],
  ["McChicken Patty", "Chicken & Fish", "main", "raw"],
  ["McCrispy Patty", "Chicken & Fish", "main", "raw"],
  ["Filet-O-Fish Patty", "Chicken & Fish", "main", "raw"],
  ["McPlant Patty", "Chicken & Fish", "main", "raw"],
  ["Nugget", "Chicken & Fish", "main", "raw"],
  ["Select", "Chicken & Fish", "main", "raw"],

  // RAW — BREAD
  ["Regular Bun", "Bread", "main", "raw"],
  ["Big Mac Bun", "Bread", "main", "raw"],
  ["Quarter Pounder Bun", "Bread", "main", "raw"],
  ["McCrispy Bun", "Bread", "main", "raw"],
  ["McChicken Bun", "Bread", "main", "raw"],
  ["Filet Bun", "Bread", "main", "raw"],
  ["Wrap Tortilla", "Bread", "main", "raw"],
  ["Breakfast Muffin", "Bread", "breakfast", "raw"],
  ["Breakfast Flatbread", "Bread", "breakfast", "raw"],

  // RAW — BREAKFAST
  ["Sausage Patty", "Breakfast", "breakfast", "raw"],
  ["Round Egg", "Breakfast", "breakfast", "raw"],
  ["Bacon", "Breakfast", "all", "raw"],
  ["Hash Brown", "Breakfast", "breakfast", "raw"],

  // RAW — SIDES / COMPONENTS
  ["Cheese Slice", "Sides", "all", "raw"],
  ["Fries", "Sides", "main", "raw"],
  ["Apple Pie", "Sides", "main", "raw"],

  // FULL — BURGERS
  ["Big Mac", "Burgers", "main", "full"],
  ["Double Quarter Pounder with Cheese", "Burgers", "main", "full"],
  ["Quarter Pounder with Cheese", "Burgers", "main", "full"],
  ["Double Cheeseburger", "Burgers", "main", "full"],
  ["Cheeseburger", "Burgers", "main", "full"],
  ["Hamburger", "Burgers", "main", "full"],
  ["McCrispy", "Burgers", "main", "full"],
  ["Cheese & Bacon McCrispy", "Burgers", "main", "full"],
  ["Spicy McCrispy", "Burgers", "main", "full"],
  ["McChicken Sandwich", "Burgers", "main", "full"],
  ["Mayo Chicken", "Burgers", "main", "full"],
  ["Double Filet-O-Fish", "Burgers", "main", "full"],
  ["Filet-O-Fish", "Burgers", "main", "full"],
  ["McPlant", "Burgers", "main", "full"],

  // FULL — CHICKEN
  ["4 Chicken McNuggets", "Chicken", "main", "full"],
  ["6 Chicken McNuggets", "Chicken", "main", "full"],
  ["9 Chicken McNuggets", "Chicken", "main", "full"],
  ["20 Chicken McNuggets Sharebox", "Chicken", "main", "full"],
  ["3 Chicken Selects", "Chicken", "main", "full"],
  ["5 Chicken Selects", "Chicken", "main", "full"],

  // FULL — WRAPS
  ["Crispy Sweet Chilli Chicken Wrap", "Wraps & Salads", "main", "full"],
  ["Crispy BBQ & Bacon Wrap", "Wraps & Salads", "main", "full"],
  ["Crispy Tikka Chicken Wrap", "Wraps & Salads", "main", "full"],
  ["Crispy Chicken Salad", "Wraps & Salads", "main", "full"],
  ["Crispy Chicken & Bacon Salad", "Wraps & Salads", "main", "full"],
  ["Side Salad", "Wraps & Salads", "main", "full"],

  // FULL — FRIES / SIDES
  ["Small Fries", "Fries & Sides", "main", "full"],
  ["Medium Fries", "Fries & Sides", "main", "full"],
  ["Large Fries", "Fries & Sides", "main", "full"],
  ["Apple Pie", "Fries & Sides", "main", "full"],

  // FULL — BREAKFAST
  ["Breakfast Wrap - Ketchup", "Breakfast", "breakfast", "full"],
  ["Breakfast Wrap - Brown Sauce", "Breakfast", "breakfast", "full"],
  ["Double Bacon & Egg McMuffin", "Breakfast", "breakfast", "full"],
  ["Double Sausage & Egg McMuffin", "Breakfast", "breakfast", "full"],
  ["Sausage & Egg McMuffin", "Breakfast", "breakfast", "full"],
  ["Bacon & Egg McMuffin", "Breakfast", "breakfast", "full"],
  ["Egg & Cheese McMuffin", "Breakfast", "breakfast", "full"],
  ["Muffin with Jam", "Breakfast", "breakfast", "full"],
  ["Sausage Sandwich - Ketchup", "Breakfast", "breakfast", "full"],
  ["Sausage Sandwich - Brown Sauce", "Breakfast", "breakfast", "full"],
  ["Cheesy Bacon Flatbread", "Breakfast", "breakfast", "full"],
  ["Pancakes & Syrup", "Breakfast", "breakfast", "full"],
  ["Pancakes & Sausage with Syrup", "Breakfast", "breakfast", "full"],
  ["Hash Brown", "Breakfast", "breakfast", "full"],
  ["Porridge", "Breakfast", "breakfast", "full"],

  // FULL — DESSERT / OTHER
  ["Oreo McFlurry", "Desserts", "main", "full"],
  ["Smarties McFlurry", "Desserts", "main", "full"],
  ["Sugar Donut", "Desserts", "all", "full"],
  ["Chocolate Brownie", "Desserts", "all", "full"],
  ["Mixed Berry Muffin", "Desserts", "all", "full"],

  // FULL — PROMO STARTERS
  ["Big Arch", "Seasonal", "main", "full"],
  ["Big Arch with Bacon", "Seasonal", "main", "full"],
  ["Cheesy Potato Bites", "Seasonal", "main", "full"],
];

export function defaultItems() {
  return DEFAULT_ITEM_DATA.map((x, i) => ({
    id: `v2-default-${i + 1}`,
    name: x[0],
    category: x[1],
    shift: x[2],
    type: x[3],
    custom: false,
  }));
}

export const CLOUD_LABELS = {
  unavailable: "Cloud unavailable · local safe",
  syncing: "Syncing…",
  pending: "Changes saved locally",
  synced: "Cloud synced",
};

export function storageKeys(prefix = "mc_waste_") {
  return {
    COUNTS: prefix + "counts_v2",
    ITEMS: prefix + "items_v2",
    HISTORY: prefix + "history_v2",
    DRAFT: prefix + "draft_v2",
    CLOUD_META: prefix + "cloud_meta_v1",
  };
}

export function shiftLabel(value) {
  return value === "breakfast" ? "Breakfast" : value === "main" ? "Main menu" : "All day";
}

export function escapeHTML(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

export function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// Storage that never throws (private browsing, quota, blocked site data) and
// keeps an in-memory mirror so the page keeps working for this visit.
export function safeStorage(backend) {
  const memory = new Map();
  return {
    getItem(key) {
      if (memory.has(key)) return memory.get(key);
      try {
        return backend ? backend.getItem(key) : null;
      } catch {
        return null;
      }
    },
    setItem(key, value) {
      memory.set(key, String(value));
      try {
        backend?.setItem(key, String(value));
      } catch {
        /* The in-memory copy keeps this visit working. */
      }
    },
    removeItem(key) {
      memory.delete(key);
      try {
        backend?.removeItem(key);
      } catch {
        /* ignore */
      }
    },
  };
}

// V6/V10 migrations from the standalone app: the Hayle RAW sheet calls the
// individual Chicken Select simply "Select" and the McNugget "Nugget".
export function migrateItems(saved, now = Date.now()) {
  if (!Array.isArray(saved) || !saved.length) return { items: defaultItems(), changed: true, fresh: true };
  let changed = false;
  const migrated = saved
    .filter((item) => isPlainObject(item))
    .map((item) => {
      if (item?.type === "raw" && item?.name === "Chicken Select") {
        changed = true;
        return { ...item, name: "Select" };
      }
      if (item?.type === "raw" && item?.name === "Chicken McNugget") {
        changed = true;
        return { ...item, name: "Nugget" };
      }
      return item;
    });
  if (migrated.length !== saved.length) changed = true;
  if (!migrated.some((item) => item?.type === "raw" && String(item?.name || "").toLowerCase() === "select")) {
    migrated.push({ id: `v6-select-${now}`, name: "Select", category: "Chicken & Fish", shift: "main", type: "raw", custom: false });
    changed = true;
  }
  if (!migrated.some((item) => item?.type === "raw" && String(item?.name || "").toLowerCase() === "nugget")) {
    migrated.push({ id: `v10-nugget-${now}`, name: "Nugget", category: "Chicken & Fish", shift: "main", type: "raw", custom: false });
    changed = true;
  }
  return { items: migrated, changed, fresh: false };
}

export function itemMergeKey(item) {
  return `${item.type}|${String(item.name).trim().toLowerCase()}`;
}

export function mergeHistory(a = [], b = []) {
  const map = new Map();
  [...a, ...b].forEach((sheet) => {
    if (!sheet?.id) return;
    const existing = map.get(sheet.id);
    if (!existing || new Date(sheet.createdAt || 0) >= new Date(existing.createdAt || 0)) {
      map.set(sheet.id, sheet);
    }
  });
  return [...map.values()]
    .sort((x, y) => new Date(y.createdAt || 0) - new Date(x.createdAt || 0))
    .slice(0, 100);
}

export function mergeItems(a = [], b = []) {
  const map = new Map();
  [...a, ...b].forEach((item) => {
    if (!item?.name || !item?.type) return;
    const key = itemMergeKey(item);
    const existing = map.get(key);
    if (!existing || item.custom || !existing.custom) {
      map.set(key, { ...item, id: existing?.id || item.id });
    }
  });
  return [...map.values()];
}

export function isValidCloudRecord(remote) {
  const state = remote?.state;
  return Boolean(
    state &&
      typeof state === "object" &&
      Array.isArray(state.items) &&
      Array.isArray(state.history) &&
      isPlainObject(state.counts) &&
      isPlainObject(state.draft) &&
      Number.isFinite(remote.updatedAt),
  );
}

export function sheetTotalsFromEntries(entries) {
  const list = Array.isArray(entries) ? entries.filter(Boolean) : [];
  const raw = list.filter((e) => e.type === "raw").reduce((n, e) => n + Math.max(0, Number(e.count) || 0), 0);
  const full = list.filter((e) => e.type === "full").reduce((n, e) => n + Math.max(0, Number(e.count) || 0), 0);
  return { raw, full, total: raw + full };
}

const MAX_COUNT = 99999;
const clampCount = (value) => Math.min(MAX_COUNT, Math.max(0, Math.floor(Number(value) || 0)));

function defaultClock() {
  return {
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (id) => clearInterval(id),
  };
}

/**
 * The waste data store: RAW/FULL counts, items, saved history, the active
 * sheet draft and (optionally) the shared cloud sync. Local storage is always
 * written first; the cloud is a best-effort copy that never overwrites
 * unsynced local taps.
 *
 * transport (optional): { load({signal}), save(state, {signal}), pin(action, payload, {signal}) }
 * each resolving to the JSON reply of /api/waste.
 */
export function createWasteStore({
  storage,
  keys = storageKeys(),
  transport = null,
  cloud = Boolean(transport && transport.load && transport.save),
  clock = defaultClock(),
  isOnline = () => typeof navigator === "undefined" || navigator.onLine !== false,
  isVisible = () => typeof document === "undefined" || document.visibilityState !== "hidden",
  timeoutMs = 10000,
  pollMs = 15000,
  random = Math.random,
  initialStatus = null,
  onChange = () => {},
  onStatus = () => {},
  onNotice = () => {},
  warn = (...args) => console.warn(...args),
} = {}) {
  if (!storage) throw new Error("createWasteStore needs a storage backend.");
  const CLOUD_SYNC_KEYS = new Set([keys.COUNTS, keys.ITEMS, keys.HISTORY, keys.DRAFT]);

  let cloudInitialized = false;
  let cloudApplying = false;
  let cloudPushTimer = null;
  let cloudBusy = false;
  let cloudSyncPromise = null;
  let cloudLocalRevision = 0;
  let cloudRetryTimer = null;
  let cloudRetryDelay = 15000;
  let cloudWakeTimer = null;
  let cloudLastAttemptAt = 0;
  let pollTimer = null;
  let status = initialStatus || { label: CLOUD_LABELS.unavailable, state: "offline" };

  function loadJSON(k, fallback) {
    try {
      const v = storage.getItem(k);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  }
  function writeRaw(k, v) {
    try {
      storage.setItem(k, JSON.stringify(v));
    } catch {
      /* storage wrapper keeps an in-memory copy */
    }
  }
  function emit(reason, detail) {
    try {
      onChange(reason, detail);
    } catch (error) {
      warn("[waste] render failed", error);
    }
  }

  // loadItems can save the default/migrated list; the sync guards above are
  // initialised first so a fresh install never marks itself dirty.
  function loadItems() {
    const saved = loadJSON(keys.ITEMS, null);
    const { items: loaded, changed } = migrateItems(saved, clock.now());
    if (changed) saveJSON(keys.ITEMS, loaded);
    return loaded;
  }

  let items = loadItems();
  let counts = (() => {
    const saved = loadJSON(keys.COUNTS, {});
    return isPlainObject(saved) ? saved : {};
  })();
  const initialDraft = (() => {
    const saved = loadJSON(keys.DRAFT, {});
    return isPlainObject(saved) ? saved : {};
  })();
  let activeSheetId = typeof initialDraft.sheetId === "string" ? initialDraft.sheetId : null;
  let sheetName = typeof initialDraft.sheetName === "string" ? initialDraft.sheetName : "";
  let sheetNotes = typeof initialDraft.sheetNotes === "string" ? initialDraft.sheetNotes : "";

  function saveJSON(k, v) {
    writeRaw(k, v);
    if (cloudInitialized && !cloudApplying && CLOUD_SYNC_KEYS.has(k)) {
      const meta = loadJSON(keys.CLOUD_META, {});
      meta.localModifiedAt = Math.max(clock.now(), Number(meta.localModifiedAt || 0) + 1);
      meta.localModifiedKeys = [...new Set([...(meta.localModifiedKeys || []), k])];
      cloudLocalRevision += 1;
      writeRaw(keys.CLOUD_META, meta);
      scheduleCloudPush();
    }
  }

  // Parsed once per stored version: the counter reads history on every tap.
  let historyCache = { raw: undefined, list: [] };
  function readHistory() {
    let raw = null;
    try {
      raw = storage.getItem(keys.HISTORY);
    } catch {
      raw = null;
    }
    if (raw !== historyCache.raw) {
      let parsed = [];
      try {
        parsed = raw ? JSON.parse(raw) : [];
      } catch {
        parsed = [];
      }
      historyCache = { raw, list: Array.isArray(parsed) ? parsed : [] };
    }
    return [...historyCache.list];
  }

  // ---------------------------------------------------------------- counting
  function countNow(id) {
    return Math.max(0, Number(counts[id]) || 0);
  }

  function setCount(id, value) {
    counts[id] = clampCount(value);
    if (counts[id] === 0) delete counts[id];
    saveJSON(keys.COUNTS, counts);
    emit("counts", { id, count: countNow(id) });
    return countNow(id);
  }

  function step(id, delta) {
    return setCount(id, countNow(id) + delta);
  }

  function getCountedEntries() {
    return items.map((item) => ({ ...item, count: countNow(item.id) })).filter((e) => e.count > 0);
  }

  function totals() {
    const entries = getCountedEntries();
    const raw = entries.filter((e) => e.type === "raw").reduce((n, e) => n + e.count, 0);
    const full = entries.filter((e) => e.type === "full").reduce((n, e) => n + e.count, 0);
    return { raw, full, total: raw + full, lines: entries.length };
  }

  function saveDraftText() {
    saveJSON(keys.DRAFT, { sheetName, sheetNotes, sheetId: activeSheetId });
  }

  function setDraft(next = {}) {
    if (typeof next.sheetName === "string") sheetName = next.sheetName.slice(0, 80);
    if (typeof next.sheetNotes === "string") sheetNotes = next.sheetNotes.slice(0, 300);
    saveDraftText();
    emit("draft");
  }

  // Repeated saves update the active sheet instead of adding a duplicate that
  // would inflate the daily totals.
  function saveSheet({ shift = "all" } = {}) {
    const entries = getCountedEntries();
    if (!entries.length) return { ok: false, reason: "empty" };
    const raw = entries.filter((e) => e.type === "raw").reduce((n, e) => n + e.count, 0);
    const full = entries.filter((e) => e.type === "full").reduce((n, e) => n + e.count, 0);
    const history = readHistory();
    const existingIndex = activeSheetId ? history.findIndex((sheet) => sheet.id === activeSheetId) : -1;
    const existing = history[existingIndex];
    if (!activeSheetId || existingIndex < 0)
      activeSheetId = `sheet-${clock.now()}-${random().toString(36).slice(2, 8)}`;
    const nowIso = new Date(clock.now()).toISOString();
    const sheet = {
      id: activeSheetId,
      createdAt: existing?.createdAt || nowIso,
      updatedAt: nowIso,
      label: sheetName.trim(),
      notes: sheetNotes.trim(),
      shift,
      totals: { raw, full, total: raw + full },
      entries,
    };
    if (existingIndex >= 0) history[existingIndex] = sheet;
    else history.unshift(sheet);
    saveDraftText();
    saveJSON(keys.HISTORY, history.slice(0, 100));
    emit("history", { saved: sheet.id });
    return { ok: true, updated: Boolean(existing), sheet };
  }

  // Clearing detaches the active saved record so the next Save starts a
  // distinct sheet. Notes stay (the standalone app behaves the same).
  function clearCurrent() {
    counts = {};
    activeSheetId = null;
    saveJSON(keys.COUNTS, counts);
    saveDraftText();
    emit("clear");
  }

  function restartSheet() {
    activeSheetId = null;
    counts = {};
    saveJSON(keys.COUNTS, counts);
    sheetName = "";
    sheetNotes = "";
    saveDraftText();
    emit("restart");
  }

  function findSheet(id) {
    return readHistory().find((sheet) => sheet?.id === id) || null;
  }

  // Restoring historical counts starts a new sheet and keeps the original.
  function restoreHistory(id) {
    const sheet = findSheet(id);
    if (!sheet) return false;
    activeSheetId = null;
    counts = {};
    (Array.isArray(sheet.entries) ? sheet.entries : []).forEach((e) => {
      const value = clampCount(e?.count);
      if (e?.id && value > 0) counts[e.id] = value;
    });
    saveJSON(keys.COUNTS, counts);
    sheetName = String(sheet.label || "").slice(0, 80);
    sheetNotes = String(sheet.notes || "").slice(0, 300);
    saveDraftText();
    emit("restore", { id });
    return true;
  }

  function deleteHistory(id) {
    const history = readHistory();
    const next = history.filter((sheet) => sheet?.id !== id);
    if (next.length === history.length) return false;
    if (activeSheetId === id) {
      activeSheetId = null;
      saveDraftText();
    }
    saveJSON(keys.HISTORY, next);
    emit("history", { deleted: id });
    return true;
  }

  // ------------------------------------------------------------ item list
  function cleanName(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  }

  function addItem({ name, type, category, shift } = {}) {
    const clean = cleanName(name);
    if (!clean) return { ok: false, reason: "name" };
    if (type !== "raw" && type !== "full") return { ok: false, reason: "type" };
    const cat = ADD_ITEM_CATEGORIES[type].includes(category) ? category : ADD_ITEM_CATEGORIES[type][0];
    const period = ["main", "breakfast", "all"].includes(shift) ? shift : "main";
    if (items.some((i) => i.type === type && String(i.name).toLowerCase() === clean.toLowerCase()))
      return { ok: false, reason: "duplicate" };
    const item = {
      id: `custom-${clock.now()}-${random().toString(36).slice(2, 6)}`,
      name: clean,
      type,
      category: cat,
      shift: period,
      custom: true,
    };
    items.push(item);
    saveJSON(keys.ITEMS, items);
    emit("items", { added: item.id });
    return { ok: true, item };
  }

  function renameItem(id, name) {
    const item = items.find((i) => i.id === id);
    if (!item) return { ok: false, reason: "missing" };
    const clean = cleanName(name);
    if (!clean) return { ok: false, reason: "name" };
    if (clean === item.name) return { ok: true, item, unchanged: true };
    if (items.some((i) => i.id !== id && i.type === item.type && String(i.name).toLowerCase() === clean.toLowerCase()))
      return { ok: false, reason: "duplicate" };
    items = items.map((i) => (i.id === id ? { ...i, name: clean } : i));
    saveJSON(keys.ITEMS, items);
    emit("items", { renamed: id });
    return { ok: true, item: items.find((i) => i.id === id) };
  }

  function removeItem(id) {
    const item = items.find((i) => i.id === id);
    if (!item) return false;
    items = items.filter((i) => i.id !== id);
    delete counts[id];
    saveJSON(keys.ITEMS, items);
    saveJSON(keys.COUNTS, counts);
    emit("items", { removed: id });
    return true;
  }

  function restoreDefaults() {
    items = defaultItems();
    counts = {};
    saveJSON(keys.ITEMS, items);
    saveJSON(keys.COUNTS, counts);
    emit("items", { restored: true });
  }

  // ------------------------------------------------------------ cloud sync
  function setCloudStatus(label, state = "idle") {
    status = { label, state };
    try {
      onStatus(status);
    } catch {
      /* ignore */
    }
  }

  function currentCloudState() {
    return {
      version: 1,
      items,
      counts,
      history: readHistory(),
      draft: { sheetName, sheetNotes, sheetId: activeSheetId },
    };
  }

  function hasMeaningfulLocalData() {
    return (
      Object.keys(counts || {}).length > 0 ||
      readHistory().length > 0 ||
      (items || []).some((i) => i.custom) ||
      Boolean(sheetName.trim() || sheetNotes.trim())
    );
  }

  function applyCloudState(state, { firstSync = false, keepLocalCounts = false, keepLocalDraft = false } = {}) {
    if (!state || typeof state !== "object") return false;

    const localHistory = readHistory();
    const localDraft = loadJSON(keys.DRAFT, {});
    const remoteHistory = Array.isArray(state.history) ? state.history : [];
    const remoteItems = Array.isArray(state.items) ? state.items : [];
    const remoteCounts = isPlainObject(state.counts) ? state.counts : {};
    const remoteDraft = isPlainObject(state.draft) ? state.draft : {};

    let nextHistory = firstSync ? mergeHistory(remoteHistory, localHistory) : remoteHistory;
    const nextItems = firstSync ? mergeItems(remoteItems, items) : remoteItems.length ? remoteItems : items;

    let nextCounts = remoteCounts;
    let nextDraft = remoteDraft;
    if (firstSync) {
      const targetIds = new Map(nextItems.map((item) => [itemMergeKey(item), item.id]));
      const sourceItems = keepLocalCounts ? items : remoteItems;
      const idMap = new Map(sourceItems.map((item) => [item.id, targetIds.get(itemMergeKey(item)) || item.id]));
      nextCounts = {};
      for (const [id, count] of Object.entries(keepLocalCounts ? counts : remoteCounts)) {
        const target = idMap.get(id) || id;
        nextCounts[target] = (nextCounts[target] || 0) + (Number(count) || 0);
      }
      if (keepLocalDraft) nextDraft = localDraft;
      // Sheet identity follows the source of the counts, independently of
      // note text. Offline work from a new device must not overwrite a
      // different saved sheet.
      const sourceDraft = keepLocalCounts ? localDraft : remoteDraft;
      if (sourceDraft.sheetId || Object.prototype.hasOwnProperty.call(nextDraft, "sheetId")) {
        nextDraft = { ...nextDraft, sheetId: typeof sourceDraft.sheetId === "string" ? sourceDraft.sheetId : null };
      }
      // Keep saved sheets restorable if equivalent items had different IDs.
      nextHistory = nextHistory.map((sheet) => ({
        ...sheet,
        ...(Array.isArray(sheet.entries)
          ? {
              entries: sheet.entries.map((entry) => ({
                ...entry,
                id: targetIds.get(itemMergeKey(entry)) || entry.id,
              })),
            }
          : {}),
      }));
    }

    cloudApplying = true;
    try {
      items = nextItems.length ? nextItems : defaultItems();
      counts = nextCounts || {};
      writeRaw(keys.ITEMS, items);
      writeRaw(keys.COUNTS, counts);
      writeRaw(keys.HISTORY, nextHistory);
      writeRaw(keys.DRAFT, nextDraft || {});
      sheetName = typeof nextDraft?.sheetName === "string" ? nextDraft.sheetName : "";
      sheetNotes = typeof nextDraft?.sheetNotes === "string" ? nextDraft.sheetNotes : "";
      activeSheetId = typeof nextDraft?.sheetId === "string" ? nextDraft.sheetId : null;
      emit("cloud");
    } finally {
      cloudApplying = false;
    }
    return true;
  }

  function scheduleCloudPush(delay = 650) {
    if (!cloudInitialized) return;
    clock.clearTimeout(cloudPushTimer);
    if (cloudRetryTimer) return;
    cloudPushTimer = clock.setTimeout(() => {
      cloudPushTimer = null;
      pushCloudState();
    }, delay);
  }

  // One deadline covers the request and its response body, and settles even
  // if a WebView fetch ignores abort.
  async function withDeadline(run, deadline, { requireOnline = true } = {}) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = clock.setTimeout(
        () => {
          reject(new Error("Cloud request timed out."));
          controller?.abort();
        },
        Math.max(0, deadline - clock.now()),
      );
    });
    try {
      if (requireOnline && isOnline() === false) throw new Error("Cloud is offline.");
      if (clock.now() >= deadline) throw new Error("Cloud request timed out.");
      return await Promise.race([
        timeout,
        (async () => {
          const data = await run({ signal: controller?.signal });
          if (!isPlainObject(data)) throw new Error("Invalid cloud response.");
          return data;
        })(),
      ]);
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("Cloud request timed out.");
      throw error;
    } finally {
      clock.clearTimeout(timer);
    }
  }

  function showCloudUnavailable() {
    if (!cloud) return;
    setCloudStatus(CLOUD_LABELS.unavailable, isOnline() === false ? "offline" : "error");
  }

  function scheduleCloudRetry() {
    if (cloudRetryTimer || isOnline() === false) return;
    cloudRetryTimer = clock.setTimeout(() => {
      cloudRetryTimer = null;
      pullCloudState();
    }, cloudRetryDelay);
    cloudRetryDelay = Math.min(cloudRetryDelay * 2, 60000);
  }

  function pushCloudState() {
    return syncCloudState({ push: true });
  }

  function pullCloudState() {
    return syncCloudState();
  }

  function syncCloudState({ push = false } = {}) {
    if (!cloudInitialized || cloudApplying) return Promise.resolve();
    if (cloudBusy) return cloudSyncPromise;
    if (isOnline() === false) {
      showCloudUnavailable();
      return Promise.resolve();
    }
    if (cloudRetryTimer) return Promise.resolve();
    cloudBusy = true;
    cloudLastAttemptAt = clock.now();
    clock.clearTimeout(cloudPushTimer);
    cloudPushTimer = null;
    setCloudStatus(CLOUD_LABELS.syncing, "syncing");
    cloudSyncPromise = performCloudSync(push);
    return cloudSyncPromise;
  }

  async function performCloudSync(push) {
    const deadline = clock.now() + timeoutMs;
    let succeeded = false;
    try {
      let meta = loadJSON(keys.CLOUD_META, {});
      // Read before the first upload so an empty/new device never overwrites the store.
      if (!push || !meta.everSynced) {
        const data = await withDeadline((options) => transport.load(options), deadline);
        if (data.ok !== true) throw new Error(data.error || "Cloud load failed.");
        if (!Object.prototype.hasOwnProperty.call(data, "record")) throw new Error("Missing cloud record.");

        meta = loadJSON(keys.CLOUD_META, {});
        const remote = data.record;
        if (remote === null) {
          push = true;
        } else {
          if (!isValidCloudRecord(remote)) throw new Error("Invalid cloud record.");
          const state = remote.state;
          const firstSync = !meta.everSynced;
          const hasLocalChanges = Number(meta.localModifiedAt || 0) > 0;
          if (firstSync) {
            const hasLocalWork = hasLocalChanges || hasMeaningfulLocalData();
            // Old clients recorded one dirty flag; new clients distinguish counts/notes.
            const locallyChanged = (key) =>
              hasLocalChanges && (!Array.isArray(meta.localModifiedKeys) || meta.localModifiedKeys.includes(key));
            applyCloudState(state, {
              firstSync: hasLocalWork,
              keepLocalCounts: locallyChanged(keys.COUNTS) || Object.keys(counts || {}).length > 0,
              keepLocalDraft: locallyChanged(keys.DRAFT) || Boolean(sheetName || sheetNotes),
            });
            meta.everSynced = true;
            meta.lastServerUpdatedAt = remote.updatedAt;
            meta.localModifiedAt = hasLocalWork ? clock.now() : 0;
            writeRaw(keys.CLOUD_META, meta);
            push = hasLocalWork;
          } else if (hasLocalChanges) {
            // Unsaved local taps always take priority over a background pull.
            push = true;
          } else if (remote.updatedAt > Number(meta.lastServerUpdatedAt || 0)) {
            applyCloudState(state);
            meta.lastServerUpdatedAt = remote.updatedAt;
            writeRaw(keys.CLOUD_META, meta);
            onNotice("Cloud data updated");
          }
        }
      }

      if (push) {
        const sentRevision = cloudLocalRevision;
        const data = await withDeadline((options) => transport.save(currentCloudState(), options), deadline);
        if (data.ok !== true || !Number.isFinite(data.updatedAt)) throw new Error(data.error || "Cloud save failed.");
        meta = loadJSON(keys.CLOUD_META, {});
        meta.everSynced = true;
        meta.lastServerUpdatedAt = data.updatedAt;
        // Acknowledging an older snapshot must not clear newer unsaved edits.
        if (sentRevision === cloudLocalRevision) {
          meta.localModifiedAt = 0;
          meta.localModifiedKeys = [];
        }
        writeRaw(keys.CLOUD_META, meta);
      }
      succeeded = true;
      cloudRetryDelay = 15000;
      if (isOnline() === false) showCloudUnavailable();
      else if (loadJSON(keys.CLOUD_META, {}).localModifiedAt) setCloudStatus(CLOUD_LABELS.pending, "idle");
      else setCloudStatus(CLOUD_LABELS.synced, "synced");
    } catch (error) {
      warn("[waste] cloud sync failed", error?.message || error);
      showCloudUnavailable();
    } finally {
      cloudBusy = false;
      cloudSyncPromise = null;
      if (!succeeded) scheduleCloudRetry();
      else if (loadJSON(keys.CLOUD_META, {}).localModifiedAt) scheduleCloudPush();
    }
  }

  function wakeCloudSync() {
    if (!cloudInitialized) return;
    clock.clearTimeout(cloudWakeTimer);
    cloudWakeTimer = clock.setTimeout(
      () => {
        cloudWakeTimer = null;
        clock.clearTimeout(cloudRetryTimer);
        cloudRetryTimer = null;
        pullCloudState();
      },
      Math.max(300, 1500 - (clock.now() - cloudLastAttemptAt)),
    );
  }

  function start() {
    if (!cloud || cloudInitialized) return;
    cloudInitialized = true;
    // Light polling so another tablet/phone's saved data appears without a reload.
    pollTimer = clock.setInterval(() => {
      if (isVisible() && clock.now() - cloudLastAttemptAt >= pollMs) pullCloudState();
    }, pollMs);
    pullCloudState();
  }

  function stop() {
    cloudInitialized = false;
    [cloudPushTimer, cloudRetryTimer, cloudWakeTimer].forEach((id) => clock.clearTimeout(id));
    clock.clearInterval(pollTimer);
    cloudPushTimer = cloudRetryTimer = cloudWakeTimer = pollTimer = null;
  }

  async function pinRequest(action, payload = {}) {
    if (!transport?.pin) throw new Error("Manager approval is unavailable.");
    if (!transport.local && isOnline() === false) throw new Error("Manager approval needs an internet connection.");
    const data = await withDeadline(
      (options) => transport.pin(action, payload, options),
      clock.now() + timeoutMs,
      { requireOnline: !transport.local },
    );
    if (data.ok !== true) {
      const error = new Error(data.error || "Manager PIN request failed.");
      error.code = data.code || "";
      throw error;
    }
    return data;
  }

  return {
    keys,
    get items() {
      return items;
    },
    get counts() {
      return counts;
    },
    get draft() {
      return { sheetName, sheetNotes, sheetId: activeSheetId };
    },
    get activeSheetId() {
      return activeSheetId;
    },
    get status() {
      return status;
    },
    get busy() {
      return cloudBusy;
    },
    get cloud() {
      return cloud;
    },
    history: readHistory,
    findSheet,
    countOf: countNow,
    setCount,
    step,
    countedEntries: getCountedEntries,
    totals,
    setDraft,
    saveSheet,
    clearCurrent,
    restartSheet,
    restoreHistory,
    deleteHistory,
    addItem,
    renameItem,
    removeItem,
    restoreDefaults,
    currentCloudState,
    start,
    stop,
    pull: pullCloudState,
    push: pushCloudState,
    wake: wakeCloudSync,
    handleOnline: wakeCloudSync,
    handleOffline: showCloudUnavailable,
    handleVisible() {
      if (isVisible()) wakeCloudSync();
    },
    pinRequest,
    readMeta: () => loadJSON(keys.CLOUD_META, {}),
  };
}
