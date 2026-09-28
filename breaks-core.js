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
  // McDonald's UK serves breakfast until 11:00.
  breakfastUntil: "11:00",
  minutesSavedPerOrder: 4,
  timeZone: "Europe/London",
};

// Food pictures (breaks-art.js draws one symbol for each). Cups, bottles and
// shakes take a colour.
export const ART = [
  "burger", "bigmac", "double", "chicken", "fish", "nuggets", "dippers", "wrap",
  "fries", "salad", "carrot", "fruit", "cup", "bottle", "coffee", "shake",
  "mcflurry", "sundae", "pie", "cookie", "muffin", "pancakes", "hashbrown", "bag",
];
export const TINTED_ART = ["cup", "bottle", "shake"];
export const CATEGORY_TYPE = { mains: "main", sides: "side", drinks: "drink", treats: "treat", breakfast: "main" };

export const NAME_MAX = 40;
export const OPTION_MAX = 30;
export const MAX_OPTIONS = 12;
export const MAX_CUSTOM_ITEMS = 40;

// Customisations: each item has its own list ("No pickles", "No ice"). Crew
// tick them per item in their tray and they print on the ticket.
const BURGER = ["No ketchup", "No mustard", "No pickles", "No onions", "No cheese"];
const DIPS = ["BBQ dip", "Sweet Curry dip", "Sweet Chilli dip", "Ketchup dip", "No dip"];
const ICE = ["No ice", "Light ice"];
const MILKY = ["Decaf", "Skimmed milk", "Extra hot"];

// Quick picks when a manager writes an item's customisations.
export const OPTION_SUGGESTIONS = {
  mains: ["No sauce", "No mayo", "No ketchup", "No mustard", "No pickles", "No onions", "No cheese", "No lettuce", "No tomato", "Plain"],
  sides: ["No salt", "No dip", "Extra salt"],
  drinks: ["No ice", "Light ice", "No milk", "Decaf", "Skimmed milk", "With sugar"],
  treats: ["No topping", "No sauce", "No cream"],
  breakfast: ["No cheese", "No egg", "No butter", "No sauce", "Brown sauce", "Ketchup"],
};

const m = (id, name, cat, type, pts, icon, options = [], extra = {}) => ({ id, name, cat, type, pts, icon, on: true, options, ...extra });

// The McDonald's UK menu (Hayle, Carwin Rise). Points follow the usual crew
// meal points: 4 a day, wraps and the bigger sandwiches 2 or more, drinks free.
export const DEFAULT_MENU = [
  // Mains
  m("bigmac", "Big Mac", "mains", "main", 3, "bigmac", ["No Big Mac sauce", "No lettuce", "No cheese", "No pickles", "No onions"]),
  m("qpc", "Quarter Pounder with Cheese", "mains", "main", 3, "burger", BURGER),
  m("dqpc", "Double Quarter Pounder with Cheese", "mains", "main", 4, "double", BURGER),
  m("mccrispy", "McCrispy", "mains", "main", 3, "chicken", ["No sauce", "No lettuce"]),
  m("mcchicken", "McChicken Sandwich", "mains", "main", 2, "chicken", ["No mayo", "No lettuce"]),
  m("fof", "Filet-O-Fish", "mains", "main", 2, "fish", ["No tartare sauce", "No cheese"]),
  m("mcplant", "McPlant", "mains", "main", 2, "burger", ["No vegan cheese", "No sauce", "No ketchup", "No mustard", "No pickles", "No onions", "No lettuce", "No tomato"], { veg: true }),
  m("tcb", "Triple Cheeseburger", "mains", "main", 3, "double", BURGER),
  m("dcb", "Double Cheeseburger", "mains", "main", 2, "double", BURGER),
  m("nug6", "6 Chicken McNuggets", "mains", "main", 2, "nuggets", DIPS),
  m("nug9", "9 Chicken McNuggets", "mains", "main", 3, "nuggets", DIPS),
  m("selects", "3 Chicken Selects", "mains", "main", 2, "nuggets", DIPS),
  m("veggie", "Veggie Dippers", "mains", "main", 2, "dippers", DIPS, { veg: true }),
  m("wrap", "Wrap of the Day", "mains", "main", 2, "wrap", ["No sauce", "No lettuce", "No cheese"]),
  m("nug4", "4 Chicken McNuggets", "mains", "main", 1, "nuggets", DIPS),
  m("cb", "Cheeseburger", "mains", "main", 1, "burger", BURGER),
  m("hb", "Hamburger", "mains", "main", 1, "burger", ["No ketchup", "No mustard", "No pickles", "No onions"]),
  m("mayo", "Mayo Chicken", "mains", "main", 1, "chicken", ["No mayo", "No lettuce"]),
  // Sides
  m("fries-s", "Small Fries", "sides", "side", 1, "fries", ["No salt"]),
  m("fries-m", "Medium Fries", "sides", "side", 1, "fries", ["No salt"]),
  m("fries-l", "Large Fries", "sides", "side", 2, "fries", ["No salt"]),
  m("mozz", "Mozzarella Dippers", "sides", "side", 1, "dippers", ["No dip"]),
  m("fruit", "Fruit Bag", "sides", "side", 0, "fruit"),
  m("carrots", "Carrot Sticks", "sides", "side", 0, "carrot"),
  // Drinks
  m("coke", "Coca-Cola Original Taste", "drinks", "drink", 0, "cup", ICE, { tint: "#d8231f" }),
  m("cokezero", "Coca-Cola Zero Sugar", "drinks", "drink", 0, "cup", ICE, { tint: "#2b2b2b" }),
  m("diet", "Diet Coke", "drinks", "drink", 0, "cup", ICE, { tint: "#9aa0a6" }),
  m("fanta", "Fanta Orange", "drinks", "drink", 0, "cup", ICE, { tint: "#f28a00" }),
  m("sprite", "Sprite Zero", "drinks", "drink", 0, "cup", ICE, { tint: "#2f9e4f" }),
  m("water", "Still Water", "drinks", "drink", 0, "bottle", [], { tint: "#4a90d9" }),
  m("oj", "Tropicana Orange Juice", "drinks", "drink", 0, "bottle", [], { tint: "#f5a300" }),
  m("tea", "Tea", "drinks", "drink", 0, "coffee", ["No milk", "Extra milk", "With sugar"]),
  m("latte", "Latte", "drinks", "drink", 0, "coffee", MILKY),
  m("cappuccino", "Cappuccino", "drinks", "drink", 0, "coffee", MILKY),
  m("flatwhite", "Flat White", "drinks", "drink", 0, "coffee", MILKY),
  m("americano", "Americano", "drinks", "drink", 0, "coffee", ["With milk", "Decaf", "With sugar"]),
  m("hotchoc", "Hot Chocolate", "drinks", "drink", 0, "coffee", ["Extra hot"]),
  m("icedlatte", "Iced Latte", "drinks", "drink", 1, "cup", ["No ice", "Light ice", "Decaf"], { tint: "#b08968" }),
  m("smoothie", "Mango & Pineapple Smoothie", "drinks", "drink", 1, "cup", [], { tint: "#f6b93b" }),
  m("frappe", "Caramel Iced Frappé", "drinks", "drink", 2, "cup", ["No cream"], { tint: "#c68b59" }),
  // Treats
  m("mcflurry", "Oreo McFlurry", "treats", "treat", 2, "mcflurry", ["No topping"]),
  m("mcflurry-dm", "Dairy Milk McFlurry", "treats", "treat", 2, "mcflurry", ["No topping"]),
  m("shake-choc", "Chocolate Milkshake", "treats", "treat", 2, "shake", [], { tint: "#7b4a2d" }),
  m("shake", "Strawberry Milkshake", "treats", "treat", 2, "shake", [], { tint: "#f07a9a" }),
  m("shake-banana", "Banana Milkshake", "treats", "treat", 2, "shake", [], { tint: "#f3d34a" }),
  m("pie", "Apple Pie", "treats", "treat", 1, "pie"),
  m("cookie", "Triple Chocolate Cookie", "treats", "treat", 1, "cookie"),
  // Breakfast (until breakfastUntil)
  m("smuffin", "Sausage & Egg McMuffin", "breakfast", "main", 2, "muffin", ["No cheese", "No egg", "No butter"], { breakfast: true }),
  m("bemuffin", "Bacon & Egg McMuffin", "breakfast", "main", 2, "muffin", ["No cheese", "No egg", "No butter"], { breakfast: true }),
  m("dsmuffin", "Double Sausage & Egg McMuffin", "breakfast", "main", 3, "muffin", ["No cheese", "No egg", "No butter"], { breakfast: true }),
  m("emuffin", "Egg & Cheese McMuffin", "breakfast", "main", 1, "muffin", ["No cheese", "No butter"], { breakfast: true }),
  m("bwrap", "Breakfast Wrap", "breakfast", "main", 2, "wrap", ["Brown sauce", "Ketchup", "No cheese", "No hash brown"], { breakfast: true }),
  m("baconroll", "Bacon Roll", "breakfast", "main", 2, "muffin", ["Brown sauce", "Ketchup", "No sauce"], { breakfast: true }),
  m("pancakes", "Pancakes & Syrup", "breakfast", "main", 2, "pancakes", ["No syrup", "No butter"], { breakfast: true }),
  m("hashbrown", "Hash Brown", "breakfast", "side", 1, "hashbrown", [], { breakfast: true }),
];
const DEFAULTS_BY_ID = Object.fromEntries(DEFAULT_MENU.map((item) => [item.id, item]));

// ---------- Settings and menu ----------

const clampInt = (value, min, max, fallback) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

// One line of text a person typed: no control characters, single spaces.
export function cleanText(value, max) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}

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

// An item's customisations: short, unique (ignoring case), at most 12.
export function normalizeOptions(list) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const label = cleanText(raw, OPTION_MAX);
    if (!label || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    out.push(label);
    if (out.length >= MAX_OPTIONS) break;
  }
  return out;
}

const CUSTOM_ID = /^x-[a-z0-9-]{1,48}$/;
const TINT = /^#[0-9a-f]{6}$/i;

// An item a store added itself (Manager → Points menu → Add item).
function customItem(raw) {
  if (raw.custom !== true || !CUSTOM_ID.test(raw.id)) return null;
  const name = cleanText(raw.name, NAME_MAX);
  const cat = CATEGORIES.find((c) => c.id === raw.cat);
  if (!name || !cat) return null;
  const icon = ART.includes(raw.icon) ? raw.icon : cat.icon;
  const tint = TINTED_ART.includes(icon) && TINT.test(String(raw.tint || "")) ? raw.tint.toLowerCase() : "";
  return {
    id: raw.id,
    name,
    cat: cat.id,
    type: TYPES[raw.type] ? raw.type : CATEGORY_TYPE[cat.id],
    pts: clampInt(raw.pts, 0, 10, 1),
    icon,
    on: raw.on !== false,
    options: normalizeOptions(raw.options),
    ...(tint ? { tint } : {}),
    ...(raw.breakfast === true ? { breakfast: true } : {}),
    custom: true,
  };
}

const copyItem = (item) => ({ ...item, options: [...(item.options || [])] });

// Every standard item (new ones show up for existing stores) with the store's
// points / type / on-off / customisation changes, then the items the store
// added. Anything else is dropped.
export function normalizeMenu(input) {
  const saved = new Map();
  const custom = [];
  if (Array.isArray(input))
    for (const raw of input) {
      if (!raw || typeof raw.id !== "string" || saved.has(raw.id)) continue;
      saved.set(raw.id, raw);
      const item = custom.length < MAX_CUSTOM_ITEMS && !DEFAULTS_BY_ID[raw.id] ? customItem(raw) : null;
      if (item) custom.push(item);
    }
  const standard = DEFAULT_MENU.map((base) => {
    const raw = saved.get(base.id);
    if (!raw) return copyItem(base);
    return {
      ...copyItem(base),
      type: TYPES[raw.type] ? raw.type : base.type,
      pts: clampInt(raw.pts, 0, 10, base.pts),
      on: raw.on !== false,
      options: Array.isArray(raw.options) ? normalizeOptions(raw.options) : [...base.options],
    };
  });
  return [...standard, ...custom];
}

const sameList = (a = [], b = []) => a.length === b.length && a.every((x, i) => x === b[i]);

// What a store saves: its changes to standard items (customisations only when
// they differ, so new defaults still reach the store) and its own items.
export const menuForSave = (menu) =>
  normalizeMenu(menu).map((item) => {
    const { id, name, cat, type, pts, icon, tint, breakfast, on, options } = item;
    if (item.custom) return { id, name, cat, type, pts, icon, ...(tint ? { tint } : {}), breakfast: Boolean(breakfast), on, options, custom: true };
    return { id, type, pts, on, ...(sameList(options, DEFAULTS_BY_ID[id].options) ? {} : { options }) };
  });

// A short, unique id for an item a store adds ("x-big-tasty-4k2p").
export function newItemId(name, taken = [], random = Math.random) {
  const slug =
    cleanText(name, NAME_MAX)
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 28) || "item";
  const used = new Set(taken);
  for (;;) {
    const id = `x-${slug}-${Math.floor(random() * 36 ** 4).toString(36).padStart(4, "0")}`;
    if (!used.has(id)) return id;
  }
}

// Tray lines: an item and the customisations ticked for it. Plain ids still
// work (older trays and callers).
export function normalizeLines(items) {
  const out = [];
  for (const raw of Array.isArray(items) ? items : []) {
    const id = typeof raw === "string" ? raw : typeof raw?.id === "string" ? raw.id : "";
    if (!id) continue;
    out.push({ id: id.slice(0, 60), mods: typeof raw === "string" ? [] : normalizeOptions(raw.mods) });
    if (out.length >= 12) break;
  }
  return out;
}
export const lineIds = (items) => normalizeLines(items).map((line) => line.id);

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
export function evaluate({ items: tray = [], menu, settings, used = 0, ordersToday = 0, now = new Date() }) {
  const s = normalizeSettings(settings);
  const byId = indexMenu(menu);
  const items = lineIds(tray);
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
  const current = counts(lineIds(ctx.items), ctx.menu);
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
  const lines = normalizeLines(items);
  const mine = crewDay(orders, crew.id, day);
  const result = evaluate({ items: lines, menu, settings: s, used: mine.pointsUsed, ordersToday: mine.count, now });
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
    items: lines.map((line) => {
      const item = byId[line.id];
      // Only this item's own customisations, in the menu's order.
      const mods = (item.options || []).filter((option) => line.mods.includes(option));
      return { id: item.id, name: item.name, type: item.type, pts: item.pts, icon: item.icon, ...(item.tint ? { tint: item.tint } : {}), ...(mods.length ? { mods } : {}) };
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
