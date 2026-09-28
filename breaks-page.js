// Break orders page (breaks.html) — crew put their own break food through.
// Rendered into #content by portal-enhancements.js with the shared "kit" (see
// createKit there). The signed-in account is the crew member: no extra PIN.
// Live data goes through /api/breaks (Firestore, rules checked on the server);
// preview mode keeps a sample day in this tab only.
import * as B from "./breaks-core.js";
import { food, installFoodSprite } from "./breaks-art.js";
import { closeDialog, openDialog, prefersReducedMotion, setButtonState, shake } from "./motion.js";

const ICONS = {
  tray: "M5 8h14l-1.2 11.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8ZM9 8V6.5a3 3 0 0 1 6 0V8",
  receipt: "M6 3h12v18l-3-2-3 2-3-2-3 2ZM9 8h6M9 12h6M9 16h3",
  book: "M12 6C8 3 4 4 2 5v15c4-2 7-1 10 1m0-15c4-3 8-2 10-1v15c-4-2-7-1-10 1V6",
  chart: "M4 20V10h4v10M10 20V4h4v16M16 20v-7h4v7",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  check: "m5 12.5 4.5 4.5L19 7.5",
  close: "m6 6 12 12M18 6 6 18",
  lock: "M6 11h12v10H6ZM8.5 11V8a3.5 3.5 0 0 1 7 0v3",
  arrow: "M5 12h14m-6-6 6 6-6 6",
  chevronLeft: "m15 6-6 6 6 6",
  chevronRight: "m9 6 6 6-6 6",
  chevronDown: "m6 9 6 6 6-6",
  note: "M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19Z",
  clock: "M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  download: "M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 20h14",
  shield: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-5",
  coin: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM8.5 15v-4c0-2 .8-3 1.8-3s1.4 1 1.7 3c.3-2 .7-3 1.7-3s1.8 1 1.8 3v4",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.9M13 3a4 4 0 0 1 0 8M9 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8",
  sliders: "M4 7h10M18 7h2M16 5v4M4 17h2M10 17h10M8 15v4",
  undo: "M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-4",
  refresh: "M20 11a8 8 0 0 0-14.3-4.7L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.7L20 16m0 4v-4h-4",
};
const ico = (name, cls = "bo-ico") =>
  `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${ICONS[name]}"/></svg>`;

const TRAY_KEY = "mc_breaks_tray_v1";
const POLL_MS = 30000;
const byId = (id) => document.getElementById(id);

let kit = null;
let profile = {};
let root = null;
let transport = null;
let data = null;
let loadError = "";
let loading = false;
let pollTimer = null;
let globalsInstalled = false;
let voidTarget = null;
const view = {
  tab: "order",
  cat: "mains",
  tray: [],
  note: "",
  mgr: "today",
  day: null,
  trayOpen: false,
  draftMenu: null,
  draftSettings: null,
  crewOpen: false,
};

const esc = (value) => (kit?.esc ? kit.esc(value) : String(value ?? ""));
const toast = (text, type) => kit?.toast?.(text, type);
const isManager = () => Boolean(data?.manager);
const tabs = () => ["order", "mine", "rules", ...(isManager() ? ["manage"] : [])];
const firstName = () => String(profile?.name || "").trim().split(/\s+/)[0] || "there";
const storeName = () => String(profile?.storeName || "").split("·").pop().trim() || profile?.storeId || "Your store";
const settings = () => data?.settings || B.normalizeSettings();
const menu = () => data?.menu || B.normalizeMenu();
const today = () => data?.today || B.dayKey();
const myDay = () => B.crewDay(data?.mine || [], profile.id, today());
const ptsLabel = (pts) => (pts === 0 ? "Free" : `${pts} pt${pts === 1 ? "" : "s"}`);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function fmtTime(iso) {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
  } catch {
    return String(iso).slice(11, 16);
  }
}
const fmtDay = (day, opts = { weekday: "short", day: "numeric", month: "short" }) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", ...opts });
const dayLabel = (day) => (day === today() ? "Today" : day === B.shiftDay(today(), -1) ? "Yesterday" : fmtDay(day));

function coins(total, used, pending = 0) {
  let out = "";
  for (let i = 0; i < total; i += 1) {
    const state = i < used ? "used" : i < used + pending ? "pending" : "free";
    out += `<span class="bo-coin is-${state}" style="--i:${i}" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6.5 17V11c0-3 1.2-4.5 2.6-4.5 1.5 0 2.3 1.7 2.9 4.7.6-3 1.4-4.7 2.9-4.7 1.4 0 2.6 1.5 2.6 4.5v6"/></svg></span>`;
  }
  return out;
}

// ------------------------------------------------------------- transport
function liveTransport() {
  const post = (body) => kit.api("/api/breaks", { method: "POST", body: JSON.stringify(body) });
  return {
    load: ({ day } = {}) => kit.api(`/api/breaks${day ? `?day=${encodeURIComponent(day)}` : ""}`, { cache: "no-store" }),
    place: ({ items, note }) => post({ action: "place", items, note }),
    void: ({ id }) => post({ action: "void", id }),
    config: ({ settings: s, menu: m }) => post({ action: "config", settings: s, menu: m }),
  };
}

// Preview mode: a sample day for this tab, run through the same rules.
function previewTransport(role) {
  const key = `mc_breaks_preview_v1_${role}`;
  const read = () => {
    try {
      return JSON.parse(sessionStorage.getItem(key) || "null");
    } catch {
      return null;
    }
  };
  const write = (s) => {
    try {
      sessionStorage.setItem(key, JSON.stringify(s));
    } catch {}
  };
  const manager = role === "manager";
  function seed() {
    const s = { settings: B.normalizeSettings(), menu: B.menuForSave(B.normalizeMenu()), orders: [], seq: {} };
    const m = B.normalizeMenu();
    const others = (kit.portalState?.()?.team || []).filter((p) => p.id && p.id !== profile.id && p.name);
    const people = others.length >= 4 ? others : [
      { id: "preview-amelia", name: "Amelia Wilson" },
      { id: "preview-ryan", name: "Ryan Davies" },
      { id: "preview-maya", name: "Maya Patel" },
      { id: "preview-tom", name: "Tom Evans" },
    ];
    const plan = [
      [people[0], ["mcchicken", "salad", "tea"], 150, "No mayo"],
      [people[1], ["nug6", "fries-m", "coke"], 95],
      [people[2], ["cb", "fries-s", "pie", "sprite"], 48],
      [people[3], ["qpc", "fries-m", "fanta"], 22, "No onions"],
      [{ id: profile.id, name: profile.name }, ["mccrispy", "fries-m", "cokezero"], 60 * 24 + 30],
    ];
    const now = Date.now();
    for (const [crew, items, minsAgo, note] of plan) {
      const at = new Date(now - minsAgo * 60000);
      const day = B.dayKey(at);
      const no = (s.seq[day] || 0) + 1;
      try {
        const order = B.createOrder({ crew, items, note, menu: m, settings: s.settings, orders: s.orders, no, now: at, id: `p${no}${day.replaceAll("-", "")}` });
        s.orders.push(order);
        s.seq[day] = no;
      } catch {}
    }
    const fourth = s.orders.find((o) => o.crewId === people[3].id);
    if (fourth) Object.assign(fourth, B.voidOrder(fourth, { id: "preview-manager", name: "Shift manager" }, new Date(now - 15 * 60000)));
    write(s);
    return s;
  }
  const load = () => read() || seed();
  const stateOf = (s, day = B.dayKey()) => {
    const t = B.dayKey();
    const days = Array.from({ length: 14 }, (_, i) => B.shiftDay(t, -i));
    const newest = (a, b) => String(b.createdAt).localeCompare(String(a.createdAt));
    return {
      ok: true,
      preview: true,
      manager,
      today: t,
      day,
      settings: B.normalizeSettings(s.settings),
      menu: B.normalizeMenu(s.menu),
      configUpdatedAt: s.updatedAt || null,
      configUpdatedBy: s.updatedByName || "",
      mine: s.orders.filter((o) => o.crewId === profile.id && days.includes(o.day)).sort(newest),
      ...(manager ? { log: s.orders.filter((o) => o.day === day).sort(newest) } : {}),
    };
  };
  const denied = () => Object.assign(new Error("Only managers can change break orders and rules."), { status: 403 });
  return {
    async load({ day } = {}) {
      const t = B.dayKey();
      return stateOf(load(), manager && day && day <= t ? day : t);
    },
    async place({ items, note }) {
      const s = load();
      const day = B.dayKey();
      const no = (s.seq[day] || 0) + 1;
      const order = B.createOrder({
        crew: { id: profile.id, name: profile.name },
        items,
        note,
        menu: B.normalizeMenu(s.menu),
        settings: s.settings,
        orders: s.orders,
        no,
        id: `p${Date.now().toString(36)}`,
      });
      s.orders.push(order);
      s.seq[day] = no;
      write(s);
      return { ...stateOf(s), order };
    },
    async void({ id, day }) {
      if (!manager) throw denied();
      const s = load();
      const index = s.orders.findIndex((o) => o.id === id);
      if (index < 0) throw new Error("That order was not found.");
      s.orders[index] = B.voidOrder(s.orders[index], { id: profile.id, name: profile.name });
      write(s);
      return stateOf(s, day);
    },
    async config({ settings: next, menu: nextMenu, day }) {
      if (!manager) throw denied();
      const s = load();
      if (next) s.settings = B.normalizeSettings({ ...s.settings, ...next });
      if (nextMenu) s.menu = B.menuForSave(nextMenu);
      s.updatedAt = new Date().toISOString();
      s.updatedByName = profile.name;
      write(s);
      return stateOf(s, day);
    },
  };
}

// ------------------------------------------------------------------ tray
function loadTray() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(TRAY_KEY) || "null");
    if (saved?.uid === profile.id && saved.day === B.dayKey()) {
      view.tray = Array.isArray(saved.items) ? saved.items : [];
      view.note = String(saved.note || "");
    }
  } catch {}
}
function saveTray() {
  try {
    sessionStorage.setItem(TRAY_KEY, JSON.stringify({ uid: profile.id, day: B.dayKey(), items: view.tray, note: view.note }));
  } catch {}
}
function trayContext() {
  const d = myDay();
  return { settings: settings(), menu: menu(), used: d.pointsUsed, ordersToday: d.count, items: view.tray, now: new Date() };
}
const evaluation = () => B.evaluate(trayContext());

// -------------------------------------------------------------- template
function template() {
  return `<div class="bo-app" id="breaksApp" data-active-tab="order">
    <section class="bo-hero" aria-labelledby="boHeading">
      <div class="bo-hero-main">
        <div class="bo-hero-copy">
          <p class="bo-eyebrow">${esc(storeName())} · Crew meals</p>
          <h1 id="boHeading" tabindex="-1">Hi ${esc(firstName())}, what's for break?</h1>
          <p class="bo-hero-lead" id="boLead">Pick your break food. The points and main + side rules are checked as you go, so nobody has to put it through for you.</p>
        </div>
        <div class="bo-hero-meta"><span class="bo-chip" id="boChip"><span class="bo-chip-dot" aria-hidden="true"></span><span>Loading…</span></span></div>
      </div>
      <div class="bo-stats" id="boStats" aria-live="polite">${statsMarkup()}</div>
    </section>

    <div class="bo-tabs" role="tablist" aria-label="Break order sections" id="boTabs"></div>

    <section class="bo-panel" id="boPanel-order" role="tabpanel" aria-labelledby="boTab-order" tabindex="-1"></section>
    <section class="bo-panel" id="boPanel-mine" role="tabpanel" aria-labelledby="boTab-mine" tabindex="-1" hidden></section>
    <section class="bo-panel" id="boPanel-rules" role="tabpanel" aria-labelledby="boTab-rules" tabindex="-1" hidden></section>
    <section class="bo-panel" id="boPanel-manage" role="tabpanel" aria-labelledby="boTab-manage" tabindex="-1" hidden></section>

    <p class="bo-foot">Crew meals · rules set by your managers · points reset at midnight.</p>

    <dialog class="bo-ticket-dialog" id="boTicketDialog" aria-labelledby="boTicketTitle"></dialog>
    <dialog class="bo-confirm" id="boConfirmDialog" aria-labelledby="boConfirmTitle">
      <div class="sheet-handle" data-sheet-drag aria-hidden="true"></div>
      <h2 id="boConfirmTitle">Void this order?</h2>
      <p class="form-note" id="boConfirmText"></p>
      <div class="dialog-actions"><button type="button" class="btn light" data-close-dialog>Keep it</button><button type="button" class="btn danger solid" id="boConfirmVoid">Void order</button></div>
    </dialog>
  </div>`;
}

function statsMarkup() {
  const s = settings();
  const d = data ? myDay() : { pointsUsed: 0, count: 0, orders: [] };
  const ev = data ? evaluation() : { points: 0 };
  const left = Math.max(0, s.dailyPoints - d.pointsUsed);
  const breaksLeft = Math.max(0, s.maxOrdersPerDay - d.count);
  const last = d.orders[0];
  const store = isManager() ? B.summary(data?.day === today() ? data.log : [], s) : null;
  return `<div class="bo-stat is-points">
      <span class="bo-stat-label">Points left</span>
      <strong class="bo-num">${data ? left : "–"}</strong><small>of ${s.dailyPoints} today</small>
      <span class="bo-coins" data-meter>${coins(s.dailyPoints, d.pointsUsed, Math.min(ev.points, left))}</span>
    </div>
    <div class="bo-stat"><span class="bo-stat-label">Breaks left</span><strong class="bo-num">${data ? breaksLeft : "–"}</strong><small>of ${plural(s.maxOrdersPerDay, "break order")}</small></div>
    <div class="bo-stat"><span class="bo-stat-label">In your tray</span><strong class="bo-num">${ev.points}</strong><small>${view.tray.length ? `pts · ${plural(view.tray.length, "item")}` : "points"}</small></div>
    ${
      store
        ? `<div class="bo-stat is-store"><span class="bo-stat-label">Store today</span><strong class="bo-num">${store.count}</strong><small>${plural(store.count, "break")} · ${store.points} pts</small></div>`
        : `<div class="bo-stat"><span class="bo-stat-label">Last break</span><strong class="bo-num">${last ? esc(last.code) : "–"}</strong><small>${last ? `${fmtTime(last.createdAt)} · ${ptsLabel(last.points)}` : "None today yet"}</small></div>`
    }`;
}

// ------------------------------------------------------------------ paint
function paintHero() {
  const s = settings();
  const d = myDay();
  const done = data && (d.pointsUsed >= s.dailyPoints || d.count >= s.maxOrdersPerDay);
  const heading = byId("boHeading");
  const text = done ? `You're all set for today, ${firstName()}.` : `Hi ${firstName()}, what's for break?`;
  if (heading.textContent !== text) heading.textContent = text;
  byId("boLead").textContent = done
    ? "You've used your crew meal allowance today. Your points reset at midnight."
    : `Pick ${[s.maxMains ? plural(s.maxMains, "main") : "", s.maxSides ? plural(s.maxSides, "side") : "", s.maxDrinks ? "a drink" : ""].filter(Boolean).join(", ").replace(/, ([^,]*)$/, " and $1")}. The points and main + side rules are checked as you go, so nobody has to put it through for you.`;
  byId("boStats").innerHTML = statsMarkup();
  const chip = byId("boChip");
  const state = loadError ? "error" : !data ? "loading" : data.preview ? "preview" : "live";
  chip.dataset.state = state;
  chip.lastElementChild.textContent = {
    loading: "Loading…",
    error: "Couldn't load",
    preview: "Preview · sample day",
    live: isManager() ? "Manager · live" : "Live for your store",
  }[state];
}

function paintTabs() {
  const list = tabs();
  // Before the first load nobody is a manager yet: keep a #manage deep link.
  if (!list.includes(view.tab) && data) view.tab = "order";
  const active = list.includes(view.tab) ? view.tab : "order";
  const labels = { order: ["tray", "Order", "Order"], mine: ["receipt", "My breaks", "Breaks"], rules: ["book", "Rules & points", "Rules"], manage: ["chart", "Manager", "Manager"] };
  const box = byId("boTabs");
  const key = list.join(",");
  if (box.dataset.key !== key) {
    box.dataset.key = key;
    box.style.setProperty("--bo-tabs", list.length);
    box.innerHTML =
      '<span class="bo-tabs-glider" aria-hidden="true"></span>' +
      list
        .map(
          (id) =>
            `<button type="button" role="tab" id="boTab-${id}" data-tab="${id}" aria-controls="boPanel-${id}">${ico(labels[id][0])}<span class="bo-tab-long">${labels[id][1]}</span><span class="bo-tab-short" aria-hidden="true">${labels[id][2]}</span>${id === "mine" ? '<span class="bo-tab-badge" data-mine-badge hidden></span>' : ""}</button>`,
        )
        .join("");
  }
  box.style.setProperty("--bo-tab-index", list.indexOf(active));
  box.querySelectorAll("[role=tab]").forEach((tab) => {
    const on = tab.dataset.tab === active;
    tab.setAttribute("aria-selected", String(on));
    tab.tabIndex = on ? 0 : -1;
  });
  const badge = box.querySelector("[data-mine-badge]");
  if (badge) {
    const n = myDay().count;
    badge.hidden = !n;
    badge.textContent = n;
  }
  root.dataset.activeTab = active;
  for (const id of ["order", "mine", "rules", "manage"]) byId(`boPanel-${id}`).hidden = id !== active;
}

function skeleton(text) {
  return `<div class="bo-card bo-loading" role="status"><span class="spinner" aria-hidden="true"></span><p>${esc(text)}</p></div>`;
}
function errorCard() {
  return `<div class="bo-card bo-empty" role="alert"><span class="bo-empty-art">${food("bag")}</span><h3>We couldn't load break orders</h3><p>${esc(loadError)}</p><button type="button" class="btn" data-retry>${ico("refresh")}Try again</button></div>`;
}

// ---------------------------------------------------------------- order
function orderMarkup() {
  return `<div class="bo-order">
    <div class="bo-order-main">
      <div class="bo-cats" role="tablist" aria-label="Menu" id="boCats"></div>
      <div class="bo-grid" id="boGrid"></div>
    </div>
    <aside class="bo-tray" id="boTray" aria-label="Your tray">
      <div class="bo-tray-card">
        <div class="sheet-handle bo-tray-handle" aria-hidden="true"></div>
        <div class="bo-tray-head">
          <h2>Your tray</h2>
          <span class="bo-tray-count" id="boTrayCount">0 items</span>
          <button type="button" class="icon-btn ghost bo-tray-close" data-close-tray aria-label="Close tray">${ico("chevronDown")}</button>
        </div>
        <div id="boLines"></div>
        <label class="bo-note"><span>${ico("note")} Note for the kitchen <small>(optional)</small></span>
          <input id="boNote" maxlength="80" placeholder="e.g. No pickles, no ice" autocomplete="off" value="${esc(view.note)}"></label>
        <ul class="bo-checks" id="boChecks"></ul>
        <div class="bo-totals" id="boTotals"></div>
        <button type="button" class="btn bo-submit" id="boSubmit" data-submit><span>Put it through</span>${ico("arrow")}</button>
        <p class="bo-hint" id="boHint"></p>
      </div>
    </aside>
    <div class="bo-traybar" id="boTrayBar">
      <button type="button" class="bo-traybar-btn" data-open-tray>
        <span class="bo-traybar-icon" id="boBarTarget">${ico("tray")}<span class="bo-traybar-count" id="boBarCount">0</span></span>
        <span class="bo-traybar-text"><b id="boBarTitle">Your tray is empty</b><small id="boBarSub"></small></span>
        <span class="bo-traybar-cta">View ${ico("chevronRight")}</span>
      </button>
    </div>
    <div class="bo-tray-backdrop" data-close-tray></div>
  </div>`;
}

function paintCats() {
  const box = byId("boCats");
  if (!box) return;
  const m = menu();
  const open = B.breakfastOpen(settings());
  box.innerHTML = B.CATEGORIES.map((c) => {
    const n = view.tray.filter((id) => m.find((i) => i.id === id)?.cat === c.id).length;
    return `<button type="button" role="tab" data-cat="${c.id}" aria-selected="${c.id === view.cat}">${food(c.icon, c.icon === "cup" ? "#d8231f" : "")}<span>${c.label}</span>${c.id === "breakfast" && !open ? `<small>until ${esc(settings().breakfastUntil)}</small>` : ""}${n ? `<span class="bo-cat-count">${n}</span>` : ""}</button>`;
  }).join("");
}

function itemMarkup(item, i) {
  const check = B.canAdd(item, trayContext());
  const inTray = view.tray.filter((id) => id === item.id).length;
  return `<button type="button" class="bo-item${check.ok ? "" : " is-blocked"}${inTray ? " is-in" : ""}" data-item="${esc(item.id)}" style="--i:${i}" aria-label="${esc(item.name)}, ${ptsLabel(item.pts)}${check.ok ? "" : `, ${esc(check.reason)}`}">
    <span class="bo-pts${item.pts === 0 ? " is-free" : ""}">${ptsLabel(item.pts)}</span>
    <span class="bo-item-art">${food(item.icon, item.tint)}</span>
    <span class="bo-item-name">${esc(item.name)}</span>
    <span class="bo-item-meta"><span class="bo-type is-${item.type}">${B.TYPES[item.type].label}</span><span class="bo-reason" data-reason>${check.ok ? "" : esc(check.reason)}</span></span>
    <span class="bo-add" aria-hidden="true">${ico(check.ok ? "plus" : "lock")}</span>
    <span class="bo-in" aria-hidden="true">${ico("check")}${inTray > 1 ? `×${inTray}` : ""}</span>
  </button>`;
}

function paintGrid({ animate = false } = {}) {
  const grid = byId("boGrid");
  if (!grid) return;
  const items = menu().filter((i) => i.cat === view.cat && i.on !== false);
  const off = menu().filter((i) => i.cat === view.cat && i.on === false).length;
  grid.innerHTML = items.length
    ? items.map(itemMarkup).join("") + (off ? `<p class="bo-grid-note">${plural(off, "item")} switched off by a manager today.</p>` : "")
    : `<div class="bo-empty bo-grid-empty"><span class="bo-empty-art">${food("bag")}</span><h3>Nothing here today</h3><p>Your managers have switched these items off.</p></div>`;
  grid.classList.toggle("is-swapping", animate && !prefersReducedMotion());
}

function paintTray() {
  if (!byId("boLines")) return;
  const m = B.indexMenu(menu());
  const ev = evaluation();
  const s = settings();
  byId("boLines").innerHTML = view.tray.length
    ? `<ul class="bo-lines">${view.tray
        .map((id, index) => {
          const item = m[id];
          if (!item) return "";
          return `<li class="bo-line"><span class="bo-line-art">${food(item.icon, item.tint)}</span><span class="bo-line-text"><b>${esc(item.name)}</b><small>${B.TYPES[item.type].label}</small></span><span class="bo-line-pts">${ptsLabel(item.pts)}</span><button type="button" class="icon-btn ghost bo-line-remove" data-remove="${index}" aria-label="Remove ${esc(item.name)}">${ico("close")}</button></li>`;
        })
        .join("")}</ul>`
    : `<div class="bo-tray-empty">${food("bag")}<p><b>Your tray is empty</b><br>Start with a main, then add a side and a drink.</p></div>`;
  const shown = ev.checks.filter((c) => c.id !== "available" && !(c.id === "treat" && ev.counts.treat === 0));
  byId("boChecks").innerHTML = shown
    .map((c) => {
      const st = c.ok ? "ok" : c.id === "sideNeedsMain" || (ev.empty && c.id !== "orders") ? "todo" : "fail";
      return `<li class="is-${st}" data-check="${c.id}"><span class="bo-check-icon">${ico(st === "ok" ? "check" : st === "fail" ? "close" : "minus")}</span><span class="bo-check-label">${esc(c.label)}</span><small>${esc(c.detail)}</small></li>`;
    })
    .join("");
  byId("boTotals").innerHTML = `<div><span>This break</span><b class="bo-num">${ptsLabel(ev.points).replace("Free", "0 pts")}</b></div><div class="is-sub"><span>Left today after this</span><b class="bo-num">${Math.max(0, ev.after)} of ${s.dailyPoints}</b></div>`;
  const hint = ev.ok ? "Goes straight through. No manager needed." : ev.errors[0] || "";
  byId("boHint").textContent = hint;
  byId("boHint").classList.toggle("is-bad", !ev.ok && view.tray.length > 0);
  const submit = byId("boSubmit");
  if (!submit.hasAttribute("data-state")) submit.disabled = !ev.ok;
  byId("boTrayCount").textContent = plural(view.tray.length, "item");
  byId("boBarCount").textContent = view.tray.length;
  byId("boBarTitle").textContent = view.tray.length ? `${plural(view.tray.length, "item")} · ${ptsLabel(ev.points).replace("Free", "0 pts")}` : "Your tray is empty";
  byId("boBarSub").textContent = ev.ok ? "Ready to put through" : view.tray.length ? hint : `${Math.max(0, ev.left)} of ${s.dailyPoints} points left today`;
  const bar = byId("boTrayBar");
  bar.classList.toggle("is-ready", ev.ok);
  bar.classList.toggle("has-items", view.tray.length > 0);
}

function paintOrder({ animate = false } = {}) {
  const panel = byId("boPanel-order");
  if (!data) {
    panel.innerHTML = loadError ? errorCard() : skeleton("Opening the points menu…");
    return;
  }
  if (!byId("boGrid")) panel.innerHTML = orderMarkup();
  paintCats();
  paintGrid({ animate });
  paintTray();
}

// ------------------------------------------------------------- my breaks
function orderRow(o) {
  return `<button type="button" class="bo-row${o.status === "void" ? " is-void" : ""}" data-ticket="${esc(o.id)}">
    <span class="bo-row-code"><small>Order</small><b>${esc(o.code)}</b></span>
    <span class="bo-row-art">${o.items.slice(0, 3).map((i) => food(i.icon, i.tint)).join("")}</span>
    <span class="bo-row-text"><b>${esc(o.items.map((i) => i.name).join(" + "))}</b><small>${fmtTime(o.createdAt)} · ${ptsLabel(o.points)}${o.status === "void" ? " · points returned" : ""}</small></span>
    ${o.status === "void" ? '<span class="pill red">Voided</span>' : '<span class="pill green">Put through</span>'}
    ${ico("chevronRight", "bo-ico bo-row-go")}
  </button>`;
}

function paintMine() {
  const panel = byId("boPanel-mine");
  if (!data) {
    panel.innerHTML = loadError ? errorCard() : skeleton("Loading your breaks…");
    return;
  }
  const s = settings();
  const d = myDay();
  const todays = (data.mine || []).filter((o) => o.day === today());
  const earlier = (data.mine || []).filter((o) => o.day !== today());
  const groups = new Map();
  for (const o of earlier) groups.set(o.day, [...(groups.get(o.day) || []), o]);
  const left = Math.max(0, s.dailyPoints - d.pointsUsed);
  panel.innerHTML = `<div class="bo-mine-summary">
      <div class="bo-card bo-mini"><span class="bo-stat-label">Points left today</span><div class="bo-big"><b class="bo-num">${left}</b><span>of ${s.dailyPoints}</span></div><span class="bo-coins">${coins(s.dailyPoints, d.pointsUsed)}</span></div>
      <div class="bo-card bo-mini"><span class="bo-stat-label">Break orders left</span><div class="bo-big"><b class="bo-num">${Math.max(0, s.maxOrdersPerDay - d.count)}</b><span>of ${s.maxOrdersPerDay}</span></div><div class="progress"><span style="width:${Math.min(100, (d.count / s.maxOrdersPerDay) * 100)}%"></span></div></div>
    </div>
    <section class="bo-card">
      <header class="bo-card-head"><div><h2>Today</h2><p>Tap a break to see its ticket.</p></div>${left > 0 && d.count < s.maxOrdersPerDay ? `<button type="button" class="btn sm" data-tab="order">${ico("plus")}New break order</button>` : ""}</header>
      ${todays.length ? `<div class="bo-rows">${todays.map(orderRow).join("")}</div>` : `<div class="bo-empty"><span class="bo-empty-art">${food("fries")}</span><h3>No breaks yet today</h3><p>When you put a break through, its ticket shows up here.</p><button type="button" class="btn" data-tab="order">${ico("tray")}Order my break</button></div>`}
    </section>
    ${
      groups.size
        ? `<section class="bo-card"><header class="bo-card-head"><div><h2>Last two weeks</h2><p>Your earlier crew meals.</p></div></header>${[...groups.entries()]
            .map(([day, list]) => `<h3 class="bo-day-label">${esc(dayLabel(day))}</h3><div class="bo-rows">${list.map(orderRow).join("")}</div>`)
            .join("")}</section>`
        : ""
    }`;
}

// ---------------------------------------------------------------- rules
const EXAMPLES = [
  ["bigmac", "fries-m", "coke"],
  ["cb", "fries-s", "pie", "water"],
  ["mcchicken", "mozz", "latte"],
  ["cb", "hb"],
  ["fries-m", "sprite"],
  ["dqpc", "fries-s"],
];

function paintRules() {
  const panel = byId("boPanel-rules");
  if (!data) {
    panel.innerHTML = loadError ? errorCard() : skeleton("Loading the rules…");
    return;
  }
  const s = settings();
  const m = menu();
  const byIdMenu = B.indexMenu(m);
  const noon = new Date(`${today()}T11:00:00Z`);
  const tiles = [
    [s.dailyPoints, `point${s.dailyPoints === 1 ? "" : "s"} a day`, "Every item has a points value. Your points reset at midnight.", "bag"],
    [s.maxMains, `main${s.maxMains === 1 ? "" : "s"} per break`, "Burgers, chicken, wraps, nuggets or a breakfast main.", "burger"],
    [s.maxSides, `side${s.maxSides === 1 ? "" : "s"} per break`, s.sideNeedsMain ? "Sides come with a main, so no side-only breaks." : "Fries, dippers, salad and more.", "fries"],
    [s.maxDrinks, `drink${s.maxDrinks === 1 ? "" : "s"} per break`, "Soft drinks, water, tea and coffee are free.", "cup", "#d8231f"],
    [s.maxTreats, `treat${s.maxTreats === 1 ? "" : "s"} per break`, "McFlurry, pie or a cookie, if your points cover it.", "mcflurry"],
    [s.maxOrdersPerDay, `break order${s.maxOrdersPerDay === 1 ? "" : "s"} a day`, "Split your points over two breaks on a long shift.", "coffee"],
  ];
  panel.innerHTML = `<div class="bo-rule-tiles">${tiles
    .map(([n, t, d, art, tint], i) => `<div class="bo-card bo-rule" style="--i:${i}"><span class="bo-rule-art">${food(art, tint)}</span><div><b class="bo-rule-num">${n}</b><h3>${t}</h3><p>${d}</p></div></div>`)
    .join("")}</div>
    ${s.enforceBreakfastHours ? `<div class="bo-note-bar">${ico("clock")}<span>Breakfast items can be ordered until <b>${esc(s.breakfastUntil)}</b>.</span></div>` : ""}
    <section class="bo-card">
      <header class="bo-card-head"><div><h2>Examples</h2><p>Checked live against your store's rules.</p></div></header>
      <ul class="bo-examples">${EXAMPLES.map((items) => {
        const list = items.filter((id) => byIdMenu[id]);
        const ev = B.evaluate({ items: list, menu: m, settings: s, now: noon });
        return `<li class="${ev.ok ? "is-ok" : "is-bad"}"><span class="bo-example-art">${list.map((id) => food(byIdMenu[id].icon, byIdMenu[id].tint)).join("")}</span><span class="bo-example-text"><b>${list.map((id) => esc(byIdMenu[id].name)).join(" + ")}</b><small>${ev.points} pt${ev.points === 1 ? "" : "s"} · ${ev.ok ? "allowed" : esc(ev.errors[0])}</small></span><span class="bo-verdict">${ico(ev.ok ? "check" : "close")}</span></li>`;
      }).join("")}</ul>
    </section>
    <section class="bo-card">
      <header class="bo-card-head"><div><h2>Points menu</h2><p>${data.configUpdatedBy ? `Last changed by ${esc(data.configUpdatedBy)}${data.configUpdatedAt ? ` · ${esc(dayLabel(B.dayKey(new Date(data.configUpdatedAt))))}` : ""}.` : "Set by your managers."} Free items still count toward the item limits.</p></div></header>
      <div class="bo-points-menu">${B.CATEGORIES.map(
        (c) => `<div class="bo-points-cat"><h3>${food(c.icon, c.icon === "cup" ? "#d8231f" : "")}${c.label}</h3><ul>${m
          .filter((i) => i.cat === c.id)
          .map((i) => `<li class="${i.on === false ? "is-off" : ""}"><span>${esc(i.name)}${i.on === false ? " <small>(off today)</small>" : ""}</span><span class="bo-type is-${i.type}">${B.TYPES[i.type].label}</span><b class="bo-pts-chip${i.pts === 0 ? " is-free" : ""}">${ptsLabel(i.pts)}</b></li>`)
          .join("")}</ul></div>`,
      ).join("")}</div>
    </section>`;
}

// -------------------------------------------------------------- manager
function teamMembers() {
  const team = (kit.portalState?.()?.team || []).filter((p) => p.id && p.name && String(p.status || "").toLowerCase() !== "inactive");
  const map = new Map(team.map((p) => [p.id, p.name]));
  for (const o of data?.log || []) if (!map.has(o.crewId)) map.set(o.crewId, o.crewName);
  if (!map.has(profile.id)) map.set(profile.id, profile.name);
  return [...map.entries()].map(([id, name]) => ({ id, name }));
}

function stepper(key, value, [min, max], label) {
  return `<span class="bo-stepper" data-stepper="${esc(key)}" data-min="${min}" data-max="${max}">
    <button type="button" data-step="-1" aria-label="Less ${esc(label)}" ${value <= min ? "disabled" : ""}>${ico("minus")}</button>
    <output class="bo-num" aria-live="polite">${value}</output>
    <button type="button" data-step="1" aria-label="More ${esc(label)}" ${value >= max ? "disabled" : ""}>${ico("plus")}</button>
  </span>`;
}

function draftChanges() {
  let n = 0;
  if (view.draftSettings) {
    const s = settings();
    for (const k of Object.keys(view.draftSettings)) if (view.draftSettings[k] !== s[k]) n += 1;
  }
  if (view.draftMenu) {
    const current = B.indexMenu(menu());
    for (const i of view.draftMenu) {
      const c = current[i.id];
      if (c && (c.pts !== i.pts || c.type !== i.type || (c.on !== false) !== (i.on !== false))) n += 1;
    }
  }
  return n;
}

function managerToday() {
  const s = settings();
  const log = data.log || [];
  const report = B.summary(log, s);
  const members = teamMembers()
    .map((p) => ({ ...p, day: B.crewDay(log, p.id, data.day) }))
    .sort((a, b) => b.day.pointsUsed - a.day.pointsUsed || a.name.localeCompare(b.name));
  const shownMembers = view.crewOpen ? members : members.slice(0, 8);
  const isToday = data.day === today();
  return `<div class="bo-daybar">
      <button type="button" class="icon-btn" data-day-step="-1" aria-label="Previous day">${ico("chevronLeft")}</button>
      <div class="bo-daybar-label"><b>${esc(isToday ? "Today" : fmtDay(data.day, { weekday: "long", day: "numeric", month: "long" }))}</b><small>${esc(isToday ? fmtDay(data.day, { weekday: "long", day: "numeric", month: "long" }) : "Break log")}</small></div>
      <button type="button" class="icon-btn" data-day-step="1" aria-label="Next day" ${isToday ? "disabled" : ""}>${ico("chevronRight")}</button>
      ${isToday ? "" : `<button type="button" class="btn sm light" data-day-today>Today</button>`}
      <button type="button" class="btn sm light bo-export" data-export>${ico("download")}<span>Export CSV</span></button>
    </div>
    <div class="bo-kpis">
      <div class="bo-card bo-kpi"><span class="bo-kpi-icon">${ico("receipt")}</span><span class="bo-stat-label">Breaks put through</span><b class="bo-num">${report.count}</b><small>${plural(report.crew, "crew member")}${report.voided ? ` · ${report.voided} voided` : ""}</small></div>
      <div class="bo-card bo-kpi"><span class="bo-kpi-icon is-red">${ico("coin")}</span><span class="bo-stat-label">Points used</span><b class="bo-num">${report.points}</b><small>${report.count ? `avg ${(report.points / report.count).toFixed(1)} per break` : "No breaks yet"}</small></div>
      <div class="bo-card bo-kpi is-dark"><span class="bo-kpi-icon">${ico("clock")}</span><span class="bo-stat-label">Manager time saved</span><b class="bo-num">${report.minutesSaved}<small> min</small></b><small>No manager needed to put breaks through</small></div>
      <div class="bo-card bo-kpi"><span class="bo-kpi-icon is-green">${ico("users")}</span><span class="bo-stat-label">Still to use points</span><b class="bo-num">${members.filter((p) => p.day.pointsUsed === 0).length}</b><small>of ${plural(members.length, "team member")}</small></div>
    </div>
    <div class="bo-mgr-grid">
      <section class="bo-card">
        <header class="bo-card-head"><div><h2>Points by crew</h2><p>${s.dailyPoints} points a day each.</p></div></header>
        <ul class="bo-crew">${shownMembers
          .map(
            (p) => `<li><span class="avatar sm">${esc(kit.initials ? kit.initials(p.name) : p.name.slice(0, 2))}</span><span class="bo-crew-text"><b>${esc(p.name)}</b><small>${plural(p.day.count, "break")}</small></span>
              <span class="bo-crew-bar"><span class="progress${p.day.pointsUsed >= s.dailyPoints ? " is-full" : ""}"><span style="width:${Math.min(100, (p.day.pointsUsed / Math.max(1, s.dailyPoints)) * 100)}%"></span></span><b class="bo-num">${p.day.pointsUsed}/${s.dailyPoints}</b></span></li>`,
          )
          .join("")}</ul>
        ${members.length > 8 ? `<button type="button" class="text-btn bo-more" data-crew-toggle>${view.crewOpen ? "Show fewer" : `Show all ${members.length}`} ${ico(view.crewOpen ? "chevronDown" : "chevronRight")}</button>` : ""}
      </section>
      <section class="bo-card">
        <header class="bo-card-head"><div><h2>Break log</h2><p>Every break put through${isToday ? " today" : ""}. Void a mistake to give the points back.</p></div></header>
        ${
          log.length
            ? `<div class="bo-log">${log
                .map(
                  (o) => `<div class="bo-log-row${o.status === "void" ? " is-void" : ""}">
              <span class="bo-log-time bo-num">${fmtTime(o.createdAt)}</span>
              <span class="bo-log-code">${esc(o.code)}</span>
              <span class="bo-log-main"><b>${esc(o.crewName)}</b><small>${esc(o.items.map((i) => i.name).join(" + "))}${o.note ? ` · “${esc(o.note)}”` : ""}</small></span>
              <span class="bo-log-pts bo-num">${ptsLabel(o.points)}</span>
              ${o.status === "void" ? `<span class="pill red" title="${esc(o.voidedByName ? `Voided by ${o.voidedByName}` : "Voided")}">Voided</span>` : `<button type="button" class="btn sm danger" data-void="${esc(o.id)}">${ico("close")}Void</button>`}
            </div>`,
                )
                .join("")}</div>`
            : `<div class="bo-empty"><span class="bo-empty-art">${food("bag")}</span><h3>No breaks ${isToday ? "yet today" : "on this day"}</h3><p>Every break put through shows up here: who, what, when and how many points.</p></div>`
        }
      </section>
    </div>`;
}

function managerMenu() {
  const draft = view.draftMenu || menu();
  return `<p class="bo-note-bar">${ico("shield")}<span>Changes apply to the next break order. Orders already put through keep their points.</span></p>
    <div class="bo-menu-admin">${B.CATEGORIES.map(
      (c) => `<section class="bo-card"><h2 class="bo-menu-cat">${food(c.icon, c.icon === "cup" ? "#d8231f" : "")}${c.label}</h2><ul>${draft
        .filter((i) => i.cat === c.id)
        .map(
          (i) => `<li class="bo-menu-row${i.on === false ? " is-off" : ""}" data-menu="${esc(i.id)}">
            ${food(i.icon, i.tint)}
            <span class="bo-menu-text"><b>${esc(i.name)}</b>
              <select class="bo-select" data-menu-type aria-label="${esc(i.name)} type">${Object.entries(B.TYPES)
                .map(([id, t]) => `<option value="${id}" ${i.type === id ? "selected" : ""}>${t.label}</option>`)
                .join("")}</select></span>
            ${stepper(`pts:${i.id}`, i.pts, [0, 10], `points for ${i.name}`)}
            <input type="checkbox" class="switch" data-menu-on ${i.on === false ? "" : "checked"} aria-label="${esc(i.name)} available today">
          </li>`,
        )
        .join("")}</ul></section>`,
    ).join("")}</div>
    <div class="bo-reset-row"><button type="button" class="btn light" data-reset-menu>${ico("undo")}Reset points to the defaults</button></div>`;
}

function managerRules() {
  const s = { ...settings(), ...(view.draftSettings || {}) };
  const row = (key, label, hint) => `<li><span class="bo-rule-row-text"><b>${label}</b><small>${hint}</small></span>${stepper(key, s[key], B.SETTING_LIMITS[key], label)}</li>`;
  return `<div class="bo-mgr-grid is-rules">
    <section class="bo-card">
      <header class="bo-card-head"><div><h2>Crew meal rules</h2><p>Checked on every phone and again on the server when a break is put through.</p></div></header>
      <ul class="bo-rule-rows">
        ${row("dailyPoints", "Points a day", "Per crew member, resets at midnight")}
        ${row("maxOrdersPerDay", "Break orders a day", "How many times they can put a break through")}
        ${row("maxMains", "Mains per break", "Burgers, chicken, wraps, nuggets")}
        ${row("maxSides", "Sides per break", "Fries, dippers, salad…")}
        ${row("maxDrinks", "Drinks per break", "Soft drinks, water, hot drinks")}
        ${row("maxTreats", "Treats per break", "McFlurry, pie, cookie…")}
        <li><span class="bo-rule-row-text"><b>Sides come with a main</b><small>No side-only break orders</small></span><input type="checkbox" class="switch" data-setting-toggle="sideNeedsMain" ${s.sideNeedsMain ? "checked" : ""} aria-label="Sides come with a main"></li>
        <li><span class="bo-rule-row-text"><b>Breakfast only until</b><small>Breakfast items lock after this time</small></span><span class="bo-inline"><input type="time" class="bo-time" data-setting-time="breakfastUntil" value="${esc(s.breakfastUntil)}" aria-label="Breakfast until"><input type="checkbox" class="switch" data-setting-toggle="enforceBreakfastHours" ${s.enforceBreakfastHours ? "checked" : ""} aria-label="Lock breakfast items after this time"></span></li>
      </ul>
    </section>
    <section class="bo-card">
      <header class="bo-card-head"><div><h2>Manager report</h2><p>Used for "Manager time saved" on the Today view.</p></div></header>
      <ul class="bo-rule-rows">${row("minutesSavedPerOrder", "Minutes saved per break", "Time it used to take a manager to put one through")}</ul>
      <p class="form-note">${data.configUpdatedBy ? `Rules last changed by <b>${esc(data.configUpdatedBy)}</b>${data.configUpdatedAt ? `, ${esc(dayLabel(B.dayKey(new Date(data.configUpdatedAt))))} at ${esc(fmtTime(data.configUpdatedAt))}` : ""}.` : "Your store is using the default rules."}</p>
    </section>
  </div>`;
}

function paintManage() {
  const panel = byId("boPanel-manage");
  if (!isManager()) {
    panel.innerHTML = "";
    return;
  }
  const changes = draftChanges();
  const sub = [
    ["today", "Today", "chart"],
    ["menu", "Points menu", "coin"],
    ["rules", "Rules", "sliders"],
  ];
  const body = view.mgr === "menu" ? managerMenu() : view.mgr === "rules" ? managerRules() : managerToday();
  panel.innerHTML = `<div class="segmented bo-mgr-tabs" role="tablist" aria-label="Manager sections">${sub
    .map(([id, label, icon]) => `<button type="button" role="tab" data-mgr="${id}" aria-selected="${view.mgr === id}">${ico(icon)}<span>${label}</span>${id !== "today" && changes && (id === "menu" ? view.draftMenu : view.draftSettings) ? '<span class="bo-dot" aria-label="unsaved"></span>' : ""}</button>`)
    .join("")}</div>
    <div class="bo-mgr-body">${body}</div>
    <div class="bo-savebar${changes ? " is-on" : ""}" role="region" aria-label="Unsaved changes" ${changes ? "" : "hidden"}>
      <span><b>${plural(changes, "unsaved change")}</b><small>Applies to the next break order</small></span>
      <button type="button" class="btn light sm" data-discard>Discard</button>
      <button type="button" class="btn sm" data-save-config>${ico("check")}<span>Save changes</span></button>
    </div>`;
}

function paintAll({ animate = false } = {}) {
  if (!root) return;
  paintHero();
  paintTabs();
  paintOrder({ animate });
  paintMine();
  paintRules();
  paintManage();
  placeTrayBar();
}

// Only what changes when the tray changes (keeps focus in the note field).
function paintTrayChange() {
  byId("boStats").innerHTML = statsMarkup();
  paintCats();
  paintGrid();
  paintTray();
}

// ------------------------------------------------------------- loading
let reloadQueued = false;
async function load({ quiet = false } = {}) {
  // A tap (day change, retry) during a background refresh runs right after it.
  if (loading) {
    reloadQueued = true;
    return;
  }
  loading = true;
  try {
    data = await transport.load({ day: isManager() ? view.day : null });
    loadError = "";
    view.tray = view.tray.filter((id) => menu().some((i) => i.id === id && i.on !== false));
    saveTray();
  } catch (error) {
    if (!quiet || !data) loadError = error?.message || "Check your connection and try again.";
  } finally {
    loading = false;
  }
  paintAll();
  if (reloadQueued) {
    reloadQueued = false;
    load({ quiet: true });
  }
}

function applyState(next) {
  if (!next) return;
  data = next;
  loadError = "";
}

// ------------------------------------------------------------- actions
function flyTo(fromEl, toEl, markup) {
  if (!fromEl || !toEl || prefersReducedMotion()) return Promise.resolve();
  const a = fromEl.getBoundingClientRect();
  const b = toEl.getBoundingClientRect();
  if (!b.width) return Promise.resolve();
  const ghost = document.createElement("div");
  ghost.className = "bo-fly";
  ghost.innerHTML = markup;
  const size = Math.min(a.width, 72);
  Object.assign(ghost.style, { left: `${a.left + a.width / 2 - size / 2}px`, top: `${a.top + a.height / 2 - size / 2}px`, width: `${size}px`, height: `${size}px` });
  document.body.append(ghost);
  const dx = b.left + b.width / 2 - (a.left + a.width / 2);
  const dy = b.top + b.height / 2 - (a.top + a.height / 2);
  const anim = ghost.animate(
    [
      { transform: "translate(0,0) scale(1) rotate(0deg)", opacity: 1 },
      { transform: `translate(${dx * 0.45}px, ${Math.min(-60, dy * 0.3 - 80)}px) scale(1.12) rotate(-12deg)`, opacity: 1, offset: 0.45 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.28) rotate(8deg)`, opacity: 0.2 },
    ],
    { duration: 700, easing: "cubic-bezier(0.45, 0, 0.25, 1)" },
  );
  return anim.finished.then(() => ghost.remove(), () => ghost.remove());
}

function bump(el) {
  if (!el || prefersReducedMotion()) return;
  el.animate([{ transform: "scale(1)" }, { transform: "scale(1.2)" }, { transform: "scale(1)" }], { duration: 380, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" });
}

function confetti(x, y, count = 80) {
  if (prefersReducedMotion()) return;
  const canvas = document.createElement("canvas");
  canvas.className = "bo-confetti";
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  document.body.append(canvas);
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  const colors = ["#ffbc0d", "#ffc72c", "#ffd964", "#da291c", "#ef4a3c", "#ffffff", "#2f7447"];
  const parts = Array.from({ length: count }, (_, i) => {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
    const speed = 5 + Math.random() * 7;
    const fry = Math.random() < 0.35;
    return { x, y, vx: Math.cos(angle) * speed * (0.6 + Math.random() * 0.6), vy: Math.sin(angle) * speed - 5, w: fry ? 4 : 6 + Math.random() * 4, h: fry ? 16 + Math.random() * 6 : 8 + Math.random() * 4, r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3, color: fry ? "#ffc72c" : colors[i % colors.length] };
  });
  const start = performance.now();
  const frame = (now) => {
    const t = now - start;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of parts) {
      p.vy += 0.28;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - t / 2100);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (t < 2200) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}

function addItem(card) {
  const item = menu().find((i) => i.id === card.dataset.item);
  const check = B.canAdd(item, trayContext());
  if (!check.ok) {
    shake(card);
    toast(check.reason, "error");
    const rule = check.rule && root.querySelector(`[data-check="${check.rule}"]`);
    if (rule) {
      rule.classList.remove("is-flash");
      void rule.offsetWidth;
      rule.classList.add("is-flash");
    }
    return;
  }
  view.tray.push(item.id);
  saveTray();
  const target = matchMedia("(max-width: 999px)").matches ? byId("boBarTarget") : byId("boTrayCount");
  flyTo(card.querySelector(".bo-item-art"), target, food(item.icon, item.tint)).then(() => bump(target));
  paintTrayChange();
  root.querySelector(".bo-line:last-child")?.classList.add("is-new");
}

async function submit() {
  const button = byId("boSubmit");
  const ev = evaluation();
  if (!ev.ok) {
    shake(button);
    if (ev.errors[0]) toast(ev.errors[0], "error");
    return;
  }
  setButtonState(button, "loading");
  try {
    const result = await transport.place({ items: [...view.tray], note: byId("boNote")?.value || "" });
    setButtonState(button, "success");
    applyState(result);
    view.tray = [];
    view.note = "";
    saveTray();
    await new Promise((r) => setTimeout(r, 480));
    setButtonState(button, "idle");
    setTrayOpen(false);
    const note = byId("boNote");
    if (note) note.value = "";
    paintAll();
    openTicket(result.order, { fresh: true });
  } catch (error) {
    setButtonState(button, "error");
    toast(error?.message || "Could not put it through. Try again.", "error");
    if (error?.status !== 401) load({ quiet: true });
  }
}

function setTrayOpen(open) {
  view.trayOpen = open;
  root?.classList.toggle("is-tray-open", open);
  document.documentElement.classList.toggle("bo-lock", open && matchMedia("(max-width: 999px)").matches);
}

// ---------------------------------------------------------------- ticket
function findOrder(id) {
  return [...(data?.mine || []), ...(data?.log || [])].find((o) => o.id === id);
}

function openTicket(order, { fresh = false } = {}) {
  if (!order) return;
  const dialog = byId("boTicketDialog");
  const s = settings();
  const own = order.crewId === profile.id;
  const d = myDay();
  const isVoid = order.status === "void";
  dialog.innerHTML = `<div class="sheet-handle" data-sheet-drag aria-hidden="true"></div>
    <button type="button" class="icon-btn ghost dialog-close" data-close-dialog aria-label="Close ticket">${ico("close")}</button>
    ${fresh ? `<div class="bo-success"><span class="bo-success-check"><svg viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24"/><path d="M15 27l7 7 15-16"/></svg></span><h2 id="boTicketTitle">Put through!</h2><p>No kiosk, no waiting for a manager.</p></div>` : `<h2 class="sr-only" id="boTicketTitle">Break order ${esc(order.code)}</h2>`}
    <article class="bo-ticket${isVoid ? " is-void" : ""}${fresh ? " is-fresh" : ""}">
      <header class="bo-ticket-top"><span class="bo-eyebrow">Break order · ${esc(storeName())}</span><b class="bo-ticket-code">${esc(order.code)}</b><span class="bo-ticket-who">${esc(order.crewName)} · ${esc(dayLabel(order.day))} · ${fmtTime(order.createdAt)}</span></header>
      <div class="bo-ticket-body">
        <div class="bo-ticket-status${isVoid ? " is-void" : ""}"><span class="bo-ticket-status-icon">${ico(isVoid ? "close" : "check")}</span><div><h3>${isVoid ? "Voided" : "Put through"}</h3><p>${isVoid ? `${order.voidedByName ? `Voided by ${esc(order.voidedByName)}. ` : ""}The points went back.` : "Show this ticket when you collect your food."}</p></div></div>
        <div class="bo-perf" aria-hidden="true"></div>
        <ul class="bo-ticket-lines">${order.items.map((i) => `<li>${food(i.icon, i.tint)}<span><b>${esc(i.name)}</b><small>${esc(B.TYPES[i.type]?.label || i.type)}</small></span><em>${ptsLabel(i.pts)}</em></li>`).join("")}</ul>
        ${order.note ? `<p class="bo-ticket-note">${ico("note")}<span>${esc(order.note)}</span></p>` : ""}
        <div class="bo-ticket-sum"><span>Points used</span><b class="bo-num">${order.points} pt${order.points === 1 ? "" : "s"}</b></div>
        ${own && order.day === today() ? `<div class="bo-ticket-left"><span class="bo-coins is-sm">${coins(s.dailyPoints, d.pointsUsed)}</span><span>${Math.max(0, s.dailyPoints - d.pointsUsed)} of ${s.dailyPoints} points left today</span></div>` : ""}
      </div>
    </article>
    <div class="dialog-actions">${fresh ? `<button type="button" class="btn light" data-close-dialog data-goto="mine">${ico("receipt")}My breaks</button>` : ""}<button type="button" class="btn dark" data-close-dialog>Done</button></div>`;
  openDialog(dialog);
  if (fresh)
    setTimeout(() => {
      const check = dialog.querySelector(".bo-success-check");
      const r = check?.getBoundingClientRect();
      if (r) confetti(r.left + r.width / 2, r.top + r.height / 2);
    }, 260);
}

// ------------------------------------------------------------- manager
async function managerAction(run, { button, success } = {}) {
  if (button) setButtonState(button, "loading");
  try {
    applyState(await run());
    if (button) setButtonState(button, "success");
    if (success) toast(success, "success");
    setTimeout(() => {
      if (button?.isConnected) setButtonState(button, "idle");
      paintAll();
    }, button ? 420 : 0);
    return true;
  } catch (error) {
    if (button) setButtonState(button, "error");
    toast(error?.message || "Could not save that. Try again.", "error");
    return false;
  }
}

function ensureDrafts() {
  if (view.mgr === "menu" && !view.draftMenu) view.draftMenu = menu().map((i) => ({ ...i }));
  if (view.mgr === "rules" && !view.draftSettings) view.draftSettings = { ...settings() };
}

function repaintManageKeepScroll() {
  const y = scrollY;
  paintManage();
  scrollTo(0, y);
}

function updateSaveBar() {
  const changes = draftChanges();
  const bar = root.querySelector(".bo-savebar");
  if (!bar) return;
  bar.hidden = !changes;
  bar.classList.toggle("is-on", Boolean(changes));
  bar.querySelector("b").textContent = plural(changes, "unsaved change");
  root.querySelectorAll(".bo-mgr-tabs [data-mgr]").forEach((tab) => {
    const id = tab.dataset.mgr;
    const dirty = changes && ((id === "menu" && view.draftMenu) || (id === "rules" && view.draftSettings));
    let dot = tab.querySelector(".bo-dot");
    if (dirty && !dot) tab.insertAdjacentHTML("beforeend", '<span class="bo-dot" aria-label="unsaved"></span>');
    if (!dirty && dot) dot.remove();
  });
}

function stepValue(stepBtn) {
  const box = stepBtn.closest("[data-stepper]");
  const out = box.querySelector("output");
  const min = Number(box.dataset.min);
  const max = Number(box.dataset.max);
  const value = Math.min(max, Math.max(min, Number(out.textContent) + Number(stepBtn.dataset.step)));
  out.textContent = value;
  if (!prefersReducedMotion()) out.animate([{ transform: "scale(1.3)" }, { transform: "scale(1)" }], { duration: 260, easing: "cubic-bezier(0.34,1.56,0.64,1)" });
  box.querySelector('[data-step="-1"]').disabled = value <= min;
  box.querySelector('[data-step="1"]').disabled = value >= max;
  const key = box.dataset.stepper;
  if (key.startsWith("pts:")) {
    ensureDrafts();
    const item = view.draftMenu.find((i) => i.id === key.slice(4));
    if (item) item.pts = value;
  } else {
    ensureDrafts();
    view.draftSettings[key] = value;
  }
  updateSaveBar();
}

function exportCsv() {
  const rows = [["Date", "Time", "Order", "Crew", "Items", "Points", "Status", "Note", "Voided by"]];
  for (const o of [...(data.log || [])].reverse())
    rows.push([o.day, fmtTime(o.createdAt), o.code, o.crewName, o.items.map((i) => i.name).join(" + "), o.points, o.status === "void" ? "Voided" : "Put through", o.note || "", o.voidedByName || ""]);
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `break-orders-${data.day}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("Break log downloaded", "success");
}

// ----------------------------------------------------------------- tabs
function switchTab(tab, { focus = true } = {}) {
  if (!tabs().includes(tab)) tab = "order";
  const changed = tab !== view.tab;
  view.tab = tab;
  if (location.hash !== `#${tab}`) history.replaceState(null, "", `${location.pathname}${location.search}#${tab}`);
  paintTabs();
  setTrayOpen(false);
  placeTrayBar();
  const panel = byId(`boPanel-${tab}`);
  if (changed && !prefersReducedMotion()) {
    panel.classList.remove("is-entering");
    void panel.offsetWidth;
    panel.classList.add("is-entering");
  }
  if (focus && changed) byId(`boTab-${tab}`)?.focus({ preventScroll: true });
  if (tab === "manage" && isManager()) load({ quiet: true });
}

const tabFromHash = () => {
  const tab = location.hash.replace("#", "");
  return ["order", "mine", "rules", "manage"].includes(tab) ? tab : "order";
};

// ---------------------------------------------------------------- events
function bind() {
  root.addEventListener("click", async (event) => {
    const t = event.target;
    const tab = t.closest("[data-tab]");
    if (tab) return switchTab(tab.dataset.tab);
    const cat = t.closest("[data-cat]");
    if (cat) {
      view.cat = cat.dataset.cat;
      paintCats();
      paintGrid({ animate: true });
      const box = byId("boCats");
      const btn = box.querySelector(`[data-cat="${view.cat}"]`);
      if (btn && box.scrollWidth > box.clientWidth) box.scrollTo({ left: btn.offsetLeft - (box.clientWidth - btn.offsetWidth) / 2, behavior: "smooth" });
      return;
    }
    const item = t.closest("[data-item]");
    if (item) return addItem(item);
    const remove = t.closest("[data-remove]");
    if (remove) {
      const line = remove.closest(".bo-line");
      line?.classList.add("is-leaving");
      setTimeout(() => {
        view.tray.splice(Number(remove.dataset.remove), 1);
        saveTray();
        paintTrayChange();
      }, prefersReducedMotion() ? 0 : 180);
      return;
    }
    if (t.closest("[data-submit]")) return submit();
    if (t.closest("[data-open-tray]")) return setTrayOpen(true);
    if (t.closest("[data-close-tray]")) return setTrayOpen(false);
    const ticket = t.closest("[data-ticket]");
    if (ticket) return openTicket(findOrder(ticket.dataset.ticket));
    if (t.closest("[data-retry]")) {
      loadError = "";
      paintAll();
      return load();
    }
    // Manager
    const mgr = t.closest("[data-mgr]");
    if (mgr) {
      view.mgr = mgr.dataset.mgr;
      ensureDrafts();
      paintManage();
      return;
    }
    const step = t.closest("[data-step]");
    if (step) return stepValue(step);
    const dayStep = t.closest("[data-day-step]");
    if (dayStep) {
      view.day = B.shiftDay(data.day, Number(dayStep.dataset.dayStep));
      if (view.day >= today()) view.day = null;
      return load();
    }
    if (t.closest("[data-day-today]")) {
      view.day = null;
      return load();
    }
    if (t.closest("[data-export]")) return exportCsv();
    if (t.closest("[data-crew-toggle]")) {
      view.crewOpen = !view.crewOpen;
      return repaintManageKeepScroll();
    }
    const voidBtn = t.closest("[data-void]");
    if (voidBtn) {
      const order = findOrder(voidBtn.dataset.void);
      if (!order) return;
      voidTarget = order;
      byId("boConfirmTitle").textContent = `Void ${order.code}?`;
      byId("boConfirmText").textContent = `${order.crewName} gets their ${plural(order.points, "point")} back and can order again.`;
      return openDialog(byId("boConfirmDialog"));
    }
    if (t.closest("#boConfirmVoid")) {
      const order = voidTarget;
      voidTarget = null;
      await closeDialog(byId("boConfirmDialog"));
      if (order) await managerAction(() => transport.void({ id: order.id, day: data.day }), { success: `${order.code} voided, points returned` });
      return;
    }
    if (t.closest("[data-discard]")) {
      view.draftMenu = null;
      view.draftSettings = null;
      ensureDrafts();
      paintManage();
      return;
    }
    const save = t.closest("[data-save-config]");
    if (save) {
      const payload = { day: data.day };
      if (view.draftSettings) payload.settings = view.draftSettings;
      if (view.draftMenu) payload.menu = B.menuForSave(view.draftMenu);
      const ok = await managerAction(() => transport.config(payload), { button: save, success: "Saved. It applies to the next break order." });
      if (ok) {
        view.draftMenu = null;
        view.draftSettings = null;
      }
      return;
    }
    if (t.closest("[data-reset-menu]")) {
      view.draftMenu = B.normalizeMenu().map((i) => ({ ...i }));
      paintManage();
      toast("Default points loaded. Save to use them.", "info");
    }
  });

  root.addEventListener("change", (event) => {
    const t = event.target;
    const row = t.closest("[data-menu]");
    if (row) {
      ensureDrafts();
      const item = view.draftMenu.find((i) => i.id === row.dataset.menu);
      if (!item) return;
      if (t.matches("[data-menu-type]")) item.type = t.value;
      if (t.matches("[data-menu-on]")) {
        item.on = t.checked;
        row.classList.toggle("is-off", !t.checked);
      }
      updateSaveBar();
      return;
    }
    if (t.matches("[data-setting-toggle]")) {
      ensureDrafts();
      view.draftSettings[t.dataset.settingToggle] = t.checked;
      updateSaveBar();
    }
    if (t.matches("[data-setting-time]") && /^\d{2}:\d{2}$/.test(t.value)) {
      ensureDrafts();
      view.draftSettings[t.dataset.settingTime] = t.value;
      updateSaveBar();
    }
  });

  root.addEventListener("input", (event) => {
    if (event.target.id !== "boNote") return;
    view.note = event.target.value;
    saveTray();
  });

  byId("boTabs").addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const list = tabs();
    let i = list.indexOf(view.tab);
    if (event.key === "ArrowLeft") i = (i - 1 + list.length) % list.length;
    if (event.key === "ArrowRight") i = (i + 1) % list.length;
    if (event.key === "Home") i = 0;
    if (event.key === "End") i = list.length - 1;
    event.preventDefault();
    switchTab(list[i]);
  });

  byId("boTicketDialog").addEventListener("click", (event) => {
    const go = event.target.closest("[data-goto]");
    if (go) setTimeout(() => switchTab(go.dataset.goto, { focus: false }), 260);
  });
}

// Keep the tray bar above the hub's phone navigation, whatever its height.
function placeTrayBar() {
  if (!root) return;
  const nav = document.querySelector(".mobile-nav");
  let bottom = 0;
  if (nav) {
    const style = getComputedStyle(nav);
    if (style.display !== "none" && style.position === "fixed") bottom = nav.getBoundingClientRect().height;
  }
  root.style.setProperty("--bo-dock", `${Math.round(bottom)}px`);
}

function installGlobals() {
  if (globalsInstalled) return;
  globalsInstalled = true;
  addEventListener("resize", placeTrayBar);
  addEventListener("hashchange", () => {
    if (root?.isConnected && tabFromHash() !== view.tab) switchTab(tabFromHash(), { focus: false });
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && root?.isConnected) load({ quiet: true });
  });
  addEventListener("keydown", (event) => {
    if (event.key === "Escape" && view.trayOpen) setTrayOpen(false);
  });
}

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    if (document.visibilityState === "visible" && root?.isConnected && isManager() && view.tab === "manage" && view.mgr === "today") load({ quiet: true });
  }, POLL_MS);
}

// ------------------------------------------------------------------ mount
export async function renderBreaks(portalData, k) {
  kit = k;
  const nextProfile = portalData?.profile || {};
  const content = byId("content");
  if (!content) return;
  document.body.classList.add("breaks-route");
  // The floating McAssist launcher would sit on top of the tray bar.
  document.body.dataset.hideAssistantLauncher = "true";
  if (content.dataset.enhancedPage === "breaks" && root && content.contains(root)) {
    // Live portal update: keep the page; only the name/role may have changed.
    const roleChanged = kit.normaliseRole?.(nextProfile.role) !== kit.normaliseRole?.(profile.role);
    profile = { ...profile, ...nextProfile };
    if (roleChanged) load({ quiet: true });
    else paintHero();
    return;
  }
  profile = nextProfile;
  content.dataset.enhancedPage = "breaks";
  installFoodSprite();
  transport = kit.preview ? previewTransport(kit.normaliseRole?.(profile.role) === "manager" ? "manager" : "crew") : liveTransport();
  loadTray();
  const wanted = tabFromHash();
  view.tab = wanted;
  content.innerHTML = template();
  root = byId("breaksApp");
  bind();
  installGlobals();
  paintAll();
  requestAnimationFrame(() => root?.classList.add("is-ready"));
  await load();
  if (view.tab !== (tabs().includes(wanted) ? wanted : "order")) switchTab(tabs().includes(wanted) ? wanted : "order", { focus: false });
  startPolling();
}
