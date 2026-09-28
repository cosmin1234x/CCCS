// Break orders (breaks.html) — crew meal rules.
// Shared by the page (breaks-page.js) and the server (api/breaks.js), so the
// points and main/side rules are checked on the phone and again when saved.
// Managers change the rules and the points menu from the page; these are the
// defaults for a store that has not set its own yet.

export const CATEGORIES = [
  { id: "mains", label: "Mains", icon: "burger" },
  { id: "sides", label: "Sides", icon: "fries" },
  { id: "drinks", label: "Drinks", icon: "cup" },
  { id: "treats", label: "Treats", icon: "mcflurry" },
  { id: "breakfast", label: "Breakfast", icon: "muffin" },
];

export const TYPES = {
  main: { label: "Main", plural: "mains", limit: "maxMains" },
  side: { label: "Side", plural: "sides", limit: "maxSides" },
  drink: { label: "Drink", plural: "drinks", limit: "maxDrinks" },
  treat: { label: "Treat", plural: "treats", limit: "maxTreats" },
};

export const DEFAULT_SETTINGS = {
  dailyPoints: 4,
  maxOrdersPerDay: 2,
  maxMains: 1,
  maxSides: 1,
  maxDrinks: 1,
  maxTreats: 1,
  sideNeedsMain: true,
  enforceBreakfastHours: true,
  breakfastUntil: "10:30",
  minutesSavedPerOrder: 4,
  timeZone: "Europe/London",
};

const m = (id, name, cat, type, pts, icon, extra = {}) => ({ id, name, cat, type, pts, icon, on: true, ...extra });

export const DEFAULT_MENU = [
  // Mains
  m("bigmac", "Big Mac", "mains", "main", 3, "bigmac"),
  m("qpc", "Quarter Pounder with Cheese", "mains", "main", 3, "burger"),
  m("dqpc", "Double Quarter Pounder", "mains", "main", 4, "double"),
  m("mccrispy", "McCrispy", "mains", "main", 3, "chicken"),
  m("mcchicken", "McChicken Sandwich", "mains", "main", 2, "chicken"),
  m("fof", "Filet-O-Fish", "mains", "main", 2, "fish"),
  m("mcplant", "McPlant", "mains", "main", 2, "burger", { veg: true }),
  m("dcb", "Double Cheeseburger", "mains", "main", 2, "double"),
  m("nug6", "6 Chicken McNuggets", "mains", "main", 2, "nuggets"),
  m("nug9", "9 Chicken McNuggets", "mains", "main", 3, "nuggets"),
  m("selects", "3 Chicken Selects", "mains", "main", 2, "nuggets"),
  m("veggie", "Veggie Dippers", "mains", "main", 2, "dippers", { veg: true }),
  m("wrap", "Wrap of the Day", "mains", "main", 2, "wrap"),
  m("cb", "Cheeseburger", "mains", "main", 1, "burger"),
  m("hb", "Hamburger", "mains", "main", 1, "burger"),
  m("mayo", "Mayo Chicken", "mains", "main", 1, "chicken"),
  // Sides
  m("fries-s", "Small Fries", "sides", "side", 1, "fries"),
  m("fries-m", "Medium Fries", "sides", "side", 1, "fries"),
  m("fries-l", "Large Fries", "sides", "side", 2, "fries"),
  m("mozz", "Mozzarella Dippers", "sides", "side", 1, "dippers"),
  m("salad", "Side Salad", "sides", "side", 1, "salad"),
  m("carrots", "Carrot Sticks", "sides", "side", 0, "carrot"),
  m("fruit", "Fruit Bag", "sides", "side", 0, "fruit"),
  // Drinks
  m("coke", "Coca-Cola", "drinks", "drink", 0, "cup", { tint: "#d8231f" }),
  m("cokezero", "Coke Zero Sugar", "drinks", "drink", 0, "cup", { tint: "#2b2b2b" }),
  m("fanta", "Fanta Orange", "drinks", "drink", 0, "cup", { tint: "#f28a00" }),
  m("sprite", "Sprite Zero", "drinks", "drink", 0, "cup", { tint: "#2f9e4f" }),
  m("water", "Still Water", "drinks", "drink", 0, "bottle", { tint: "#4a90d9" }),
  m("oj", "Orange Juice", "drinks", "drink", 0, "bottle", { tint: "#f5a300" }),
  m("tea", "Tea", "drinks", "drink", 0, "coffee"),
  m("latte", "Latte", "drinks", "drink", 0, "coffee"),
  m("cappuccino", "Cappuccino", "drinks", "drink", 0, "coffee"),
  // Treats
  m("mcflurry", "McFlurry Oreo", "treats", "treat", 2, "mcflurry"),
  m("shake", "Strawberry Milkshake", "treats", "treat", 2, "shake", { tint: "#f07a9a" }),
  m("sundae", "Sundae", "treats", "treat", 1, "sundae"),
  m("pie", "Apple Pie", "treats", "treat", 1, "pie"),
  m("cookie", "Cookie", "treats", "treat", 1, "cookie"),
  // Breakfast
  m("smuffin", "Sausage & Egg McMuffin", "breakfast", "main", 2, "muffin", { breakfast: true }),
  m("bemuffin", "Bacon & Egg McMuffin", "breakfast", "main", 2, "muffin", { breakfast: true }),
  m("emuffin", "Egg McMuffin", "breakfast", "main", 1, "muffin", { breakfast: true }),
  m("bwrap", "Breakfast Wrap", "breakfast", "main", 3, "wrap", { breakfast: true }),
  m("pancakes", "Pancakes & Syrup", "breakfast", "main", 2, "pancakes", { breakfast: true }),
  m("hashbrown", "Hash Brown", "breakfast", "side", 1, "hashbrown", { breakfast: true }),
];

// ---------- Settings and menu ----------

const clampInt = (value, min, max, fallback) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

export const SETTING_LIMITS = {
  dailyPoints: [0, 20],
  maxOrdersPerDay: [1, 6],
  maxMains: [0, 4],
  maxSides: [0, 4],
  maxDrinks: [0, 4],
  maxTreats: [0, 4],
  minutesSavedPerOrder: [0, 30],
};

export function normalizeSettings(input = {}) {
  const s = { ...DEFAULT_SETTINGS, ...(input && typeof input === "object" ? input : {}) };
  const out = {};
  for (const [key, [min, max]] of Object.entries(SETTING_LIMITS))
    out[key] = clampInt(s[key], min, max, DEFAULT_SETTINGS[key]);
  out.sideNeedsMain = s.sideNeedsMain !== false;
  out.enforceBreakfastHours = s.enforceBreakfastHours !== false;
  out.breakfastUntil = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s.breakfastUntil))
    ? s.breakfastUntil
    : DEFAULT_SETTINGS.breakfastUntil;
  out.timeZone = DEFAULT_SETTINGS.timeZone;
  return out;
}

// Keeps every default item (new ones show up for existing stores), applies a
// store's points / type / on-off changes and drops anything unknown.
export function normalizeMenu(input) {
  const saved = new Map();
  if (Array.isArray(input))
    for (const raw of input) if (raw && typeof raw.id === "string" && !saved.has(raw.id)) saved.set(raw.id, raw);
  return DEFAULT_MENU.map((base) => {
    const raw = saved.get(base.id);
    if (!raw) return { ...base };
    return {
      ...base,
      type: TYPES[raw.type] ? raw.type : base.type,
      pts: clampInt(raw.pts, 0, 10, base.pts),
      on: raw.on !== false,
    };
  });
}

// What a store saves: only what differs is meaningful, but the full list is
// small, so the manager's whole menu is stored.
export const menuForSave = (menu) =>
  normalizeMenu(menu).map(({ id, type, pts, on }) => ({ id, type, pts, on }));

export function indexMenu(menu) {
  const map = Object.create(null);
  for (const item of menu || []) map[item.id] = item;
  return map;
}

// ---------- Time (store time zone) ----------

export function dayKey(now = new Date(), timeZone = DEFAULT_SETTINGS.timeZone) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return new Date(now).toISOString().slice(0, 10);
  }
}

export function clockKey(now = new Date(), timeZone = DEFAULT_SETTINGS.timeZone) {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
    const get = (type) => parts.find((p) => p.type === type)?.value || "00";
    return `${get("hour")}:${get("minute")}`;
  } catch {
    return new Date(now).toTimeString().slice(0, 5);
  }
}

export function shiftDay(day, days) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function breakfastOpen(settings, now = new Date()) {
  const s = normalizeSettings(settings);
  if (!s.enforceBreakfastHours) return true;
  return clockKey(now, s.timeZone) < s.breakfastUntil;
}

// ---------- Orders ----------

export const formatCode = (no) => `B-${String(no).padStart(3, "0")}`;

export function counts(itemIds, menu) {
  const byId = indexMenu(menu);
  const out = { main: 0, side: 0, drink: 0, treat: 0 };
  let points = 0;
  for (const id of itemIds || []) {
    const item = byId[id];
    if (!item) continue;
    out[item.type] += 1;
    points += item.pts;
  }
  return { counts: out, points };
}

// A crew member's break orders on one day (voided ones give their points back).
export function crewDay(orders, crewId, day) {
  const mine = (orders || []).filter((o) => o.crewId === crewId && o.day === day && o.status !== "void");
  return {
    orders: mine,
    count: mine.length,
    pointsUsed: mine.reduce((sum, o) => sum + (Number(o.points) || 0), 0),
  };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function limitLabel(type, max) {
  const t = TYPES[type];
  if (max === 0) return `No ${t.plural}`;
  return `${max} ${max === 1 ? t.label.toLowerCase() : t.plural} per break`;
}

// Checks a tray against every rule. `used` = points already used today,
// `ordersToday` = break orders already put through today.
export function evaluate({ items = [], menu, settings, used = 0, ordersToday = 0, now = new Date() }) {
  const s = normalizeSettings(settings);
  const byId = indexMenu(menu);
  const { counts: c, points } = counts(items, menu);
  const left = Math.max(0, s.dailyPoints - used);
  const checks = [
    {
      id: "points",
      ok: points <= left,
      label: `Up to ${plural(s.dailyPoints, "point")} a day`,
      detail: `${Math.min(used + points, 99)} of ${s.dailyPoints} used`,
      error: left === 0 ? "You have no points left today" : `That's ${points} pts, you have ${left} left today`,
    },
  ];
  for (const type of ["main", "side", "drink", "treat"]) {
    const max = s[TYPES[type].limit];
    const t = TYPES[type];
    checks.push({
      id: type,
      ok: c[type] <= max,
      label: limitLabel(type, max),
      detail: `${c[type]} in tray`,
      error: max === 0 ? `${t.plural[0].toUpperCase()}${t.plural.slice(1)} aren't included` : `Only ${limitLabel(type, max)}`,
    });
  }
  if (s.sideNeedsMain)
    checks.push({
      id: "sideNeedsMain",
      ok: c.side === 0 || c.main > 0,
      label: "Sides come with a main",
      detail: c.side === 0 ? "No side yet" : c.main > 0 ? "Main + side" : "Add a main",
      error: "Add a main to go with your side",
    });
  checks.push({
    id: "orders",
    ok: ordersToday < s.maxOrdersPerDay,
    label: `${plural(s.maxOrdersPerDay, "break order")} a day`,
    detail: `${ordersToday} put through today`,
    error: `You've had ${plural(s.maxOrdersPerDay, "break order")} today`,
  });
  if (items.some((id) => !byId[id] || byId[id].on === false))
    checks.push({ id: "available", ok: false, label: "Items available", detail: "", error: "Something in your tray is not available today" });
  if (!breakfastOpen(s, now) && items.some((id) => byId[id]?.breakfast))
    checks.push({ id: "breakfast", ok: false, label: `Breakfast until ${s.breakfastUntil}`, detail: "", error: `Breakfast finished at ${s.breakfastUntil}` });

  const failing = checks.filter((check) => !check.ok);
  const empty = items.length === 0;
  return {
    ok: !empty && failing.length === 0,
    empty,
    points,
    used,
    left,
    after: left - points,
    counts: c,
    checks,
    errors: [...(empty ? ["Your tray is empty"] : []), ...failing.map((check) => check.error)],
  };
}

// Why an item can't go in the tray right now (or ok).
export function canAdd(item, ctx) {
  if (!item) return { ok: false, reason: "Unknown item" };
  const s = normalizeSettings(ctx.settings);
  if (item.on === false) return { ok: false, reason: "Not available today" };
  if (item.breakfast && !breakfastOpen(s, ctx.now)) return { ok: false, reason: `Breakfast ends ${s.breakfastUntil}`, rule: "breakfast" };
  if ((ctx.ordersToday || 0) >= s.maxOrdersPerDay) return { ok: false, reason: "No breaks left today", rule: "orders" };
  const current = counts(ctx.items || [], ctx.menu);
  const max = s[TYPES[item.type].limit];
  if (current.counts[item.type] + 1 > max)
    return { ok: false, reason: max === 0 ? `${TYPES[item.type].plural} not included` : `Only ${limitLabel(item.type, max)}`, rule: item.type };
  const left = Math.max(0, s.dailyPoints - (ctx.used || 0)) - current.points;
  if (item.pts > left) return { ok: false, reason: left <= 0 ? "No points left" : `Needs ${item.pts} pts · ${left} left`, rule: "points" };
  return { ok: true };
}

// Builds a checked order. Throws an Error with code "RULES" when a rule fails.
export function createOrder({ crew, items, note = "", menu, settings, orders, no, now = new Date(), id }) {
  const s = normalizeSettings(settings);
  const day = dayKey(now, s.timeZone);
  const list = Array.isArray(items) ? items.filter((x) => typeof x === "string").slice(0, 12) : [];
  const mine = crewDay(orders, crew.id, day);
  const result = evaluate({ items: list, menu, settings: s, used: mine.pointsUsed, ordersToday: mine.count, now });
  if (!result.ok) {
    const error = new Error(result.errors[0] || "That order breaks the crew meal rules");
    error.code = "RULES";
    error.errors = result.errors;
    throw error;
  }
  const byId = indexMenu(menu);
  const at = new Date(now).toISOString();
  return {
    ...(id ? { id } : {}),
    no,
    code: formatCode(no),
    day,
    crewId: crew.id,
    crewName: String(crew.name || "Crew member").slice(0, 80),
    items: list.map((itemId) => {
      const item = byId[itemId];
      return { id: item.id, name: item.name, type: item.type, pts: item.pts, icon: item.icon, ...(item.tint ? { tint: item.tint } : {}) };
    }),
    points: result.points,
    note: String(note || "").trim().slice(0, 80),
    status: "placed",
    createdAt: at,
  };
}

export function voidOrder(order, by = {}, now = new Date()) {
  if (order.status === "void") return order;
  return { ...order, status: "void", voidedAt: new Date(now).toISOString(), voidedBy: by.id || "", voidedByName: String(by.name || "").slice(0, 80) };
}

// Today's report for managers.
export function summary(orders, settings) {
  const s = normalizeSettings(settings);
  const live = (orders || []).filter((o) => o.status !== "void");
  return {
    count: live.length,
    voided: (orders || []).length - live.length,
    points: live.reduce((sum, o) => sum + (Number(o.points) || 0), 0),
    crew: new Set(live.map((o) => o.crewId)).size,
    minutesSaved: live.length * s.minutesSavedPerOrder,
  };
}

export function shortName(name = "") {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] || "";
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}
