// Learning hub (training.html) and lesson player (module.html?id=…).
// Owned module: rendered into #content by portal-enhancements.js, which passes
// a shared "kit" of helpers (see createKit in portal-enhancements.js). Both
// pages set content.dataset.enhancedPage so portal.js stops re-rendering them;
// later portal:render events update the page in place (filters, search,
// lesson position and quiz answers are never reset).
let kit;
const $ = (id) => document.getElementById(id);
const esc = (value) => kit.esc(value);

const DAY = 864e5;
const PASS_MARK = () => Number(window.McModules?.passMark) || 75;
const PAGE_SIZE = 6;

// Category look, badge names and tones (tones are styled in training.css).
const CATEGORY_META = {
  Essentials: { icon: "🧭", badge: "Ready for Anything", tone: "yellow" },
  Safety: { icon: "🛟", badge: "Safety Champion", tone: "red" },
  Kitchen: { icon: "🍳", badge: "Kitchen Pro", tone: "orange" },
  Service: { icon: "😊", badge: "Service Star", tone: "blue" },
  Cleanliness: { icon: "✨", badge: "Spotless", tone: "teal" },
  Operations: { icon: "📦", badge: "Smooth Operator", tone: "purple" },
  "Crew Trainer": { icon: "🛡️", badge: "Coach", tone: "green" },
  Manager: { icon: "🎯", badge: "Shift Leader", tone: "brown" },
};
const metaFor = (category) =>
  CATEGORY_META[category] || { icon: "✦", badge: category + " badge", tone: "yellow" };
const categoryOf = (m) => m.category || "Essentials";

// Levels are earned with XP from completed modules. Completing every crew
// module reaches the top level; managers and trainers get there a little
// sooner thanks to their extra modules.
const LEVELS = [0, 120, 300, 520, 780, 1080, 1400, 1700, 1950];
const LEVEL_NAMES = [
  "New starter",
  "Finding my feet",
  "Getting confident",
  "Reliable crew",
  "Station all-rounder",
  "Rush ready",
  "Team anchor",
  "Crew expert",
  "Crew legend",
];

// Rota stations → the modules that prepare someone for them (first match wins).
const STATION_MODULES = [
  [/fries|fry/i, ["fries-station", "workplace-safety"]],
  [/grill|beef/i, ["grill-station", "workplace-safety"]],
  [/chicken/i, ["chicken-fryer", "workplace-safety"]],
  [/breakfast/i, ["breakfast", "kitchen-assembly"]],
  [/drink|mcca|coffee|beverage/i, ["drinks-mccafe", "order-presenting"]],
  [/drive/i, ["drive-thru", "order-presenting", "till-cash"]],
  [/front|counter|till/i, ["front-counter", "greeting-hospitality", "till-cash", "customer-recovery"]],
  [/present|runner/i, ["order-presenting", "drive-thru"]],
  [/deliver/i, ["delivery-orders", "order-presenting"]],
  [/lobby|dining|clean/i, ["dining-cleaning", "greeting-hospitality"]],
  [/kitchen|assembly|line/i, ["kitchen-assembly", "grill-station", "fries-station", "chicken-fryer"]],
  [/stock|store ?room/i, ["stock-waste"]],
  [/shift lead|lead|manager/i, ["manager-rush", "rush-crew", "teamwork-communication"]],
  [/train/i, ["trainer-coaching", "trainer-new-starter"]],
];

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
export function moduleVisibleForRole(module, role) {
  if (!Array.isArray(module.roles) || !module.roles.length) return true;
  return module.roles.includes(kit.normaliseRole(role));
}
const allModules = () => window.McModules?.modules || [];
const visibleModules = (role) => allModules().filter((m) => moduleVisibleForRole(m, role));
const isDone = (progress, m) => Boolean(progress?.[m.id]?.completed);
const reducedMotion = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};
const minutesOf = (m) => Number.parseInt(m.time, 10) || 0;
const firstName = (name) => String(name || "there").trim().split(/\s+/)[0];
const pad = (n) => String(n).padStart(2, "0");
const dayKey = (ms) => {
  const d = new Date(ms);
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
};
const isoToday = () => dayKey(Date.now());

function toMillis(value) {
  if (value == null || value === "") return null;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "object" && Number.isFinite(value.seconds)) return value.seconds * 1000;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

// Modules completed before quizzes were scored (or marked complete by a
// manager) have no score: show none rather than 0%.
function scoreOf(entry) {
  if (entry?.score == null || entry.score === "") return null;
  const n = Number(entry.score);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function relTime(ms) {
  const start = (t) => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const days = Math.round((start(Date.now()) - start(ms)) / DAY);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return days + " days ago";
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// Mid-sentence form: "today", "yesterday", "3 days ago" or "15 Sept".
const relTimeLower = (ms) => relTime(ms).replace(/^(Today|Yesterday)$/, (w) => w.toLowerCase());

function levelFor(xp) {
  let i = 0;
  while (i + 1 < LEVELS.length && xp >= LEVELS[i + 1]) i++;
  const next = LEVELS[i + 1];
  return {
    level: i + 1,
    name: LEVEL_NAMES[i],
    next: next ?? null,
    toNext: next != null ? next - xp : 0,
    pct: next != null ? Math.round(((xp - LEVELS[i]) / (next - LEVELS[i])) * 100) : 100,
  };
}

function xpFor(progress) {
  return allModules().reduce((sum, m) => sum + (isDone(progress, m) ? Number(m.xp) || 0 : 0), 0);
}

// Completions, day streak and this week's activity from completedAt.
function activityFor(progress, modules) {
  const items = modules
    .filter((m) => isDone(progress, m))
    .map((m) => ({ m, at: toMillis(progress[m.id].completedAt), score: scoreOf(progress[m.id]) }))
    .filter((x) => x.at)
    .sort((a, b) => b.at - a.at);
  const days = new Set(items.map((x) => dayKey(x.at)));
  const cursor = new Date();
  if (!days.has(dayKey(cursor.getTime()))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (days.has(dayKey(cursor.getTime()))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  const monday = new Date();
  monday.setHours(12, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    const key = dayKey(d.getTime());
    return {
      key,
      label: d.toLocaleDateString("en-GB", { weekday: "narrow" }),
      name: d.toLocaleDateString("en-GB", { weekday: "long" }),
      active: days.has(key),
      today: key === isoToday(),
    };
  });
  const weekCount = items.filter((x) => week.some((d) => d.key === dayKey(x.at))).length;
  return { items, streak, week, weekCount };
}

function badgesFor(modules, progress) {
  const cats = [...new Set(modules.map(categoryOf))];
  return cats.map((category) => {
    const list = modules.filter((m) => categoryOf(m) === category);
    const done = list.filter((m) => isDone(progress, m)).length;
    return { category, meta: metaFor(category), done, total: list.length, earned: list.length > 0 && done === list.length };
  });
}

function stationModuleIds(station) {
  const hit = STATION_MODULES.find(([re]) => re.test(String(station || "")));
  return hit ? hit[1] : [];
}

function shiftEndMs(s) {
  const start = new Date(s.date + "T" + s.start).getTime();
  let end = new Date(s.date + "T" + s.end).getTime();
  if (!Number.isFinite(start)) return NaN;
  if (!Number.isFinite(end) || end <= start) end = (Number.isFinite(end) ? end : start) + DAY;
  return end;
}

function nextShiftFor(userId, shifts) {
  const now = Date.now();
  return (shifts || [])
    .filter((s) => s && s.userId === userId && s.date && /^\d\d:\d\d$/.test(s.start || "") && shiftEndMs(s) > now)
    .sort((a, b) => String(a.date + a.start).localeCompare(String(b.date + b.start)))[0] || null;
}

function shiftLabel(s) {
  if (!s) return "";
  const today = isoToday();
  const tomorrow = dayKey(Date.now() + DAY);
  const when = s.date === today ? "Today" : s.date === tomorrow ? "Tomorrow" : kit.formatDate(s.date);
  return when + " at " + s.start;
}

// "today at 16:30", "tomorrow at 09:00" or "on Fri 26 Sep at 14:00".
function shiftPhrase(s) {
  const label = shiftLabel(s);
  if (/^Today|^Tomorrow/.test(label)) return label.charAt(0).toLowerCase() + label.slice(1);
  return "on " + label;
}
// "today", "tomorrow" or "Fri 26 Sep".
function shiftDay(s) {
  if (!s) return "";
  if (s.date === isoToday()) return "today";
  if (s.date === dayKey(Date.now() + DAY)) return "tomorrow";
  return kit.formatDate(s.date);
}
const shortTitle = (m) => String(m.title).split(/ & | and |: /)[0];

// Stations with a two-signature station check (see api/verification.js).
const VERIFIABLE = ["fries", "grill", "chicken & fryer", "front counter", "drive-thru", "drinks & mccafé", "kitchen assembly", "breakfast", "dining area"];

function stationMatches(verified, station) {
  const want = String(station || "").toLowerCase();
  return (verified || []).some((v) => {
    const have = String(v || "").toLowerCase();
    return have && want && (have === want || have.includes(want) || want.includes(have));
  });
}

function moduleUrl(m) {
  return "/module.html?id=" + encodeURIComponent(m.id) + (kit.preview ? "&preview=" + encodeURIComponent(kit.preview) : "");
}

function assistantUrl(prompt) {
  const base = kit.pageFor("assistant");
  return base + (base.includes("?") ? "&" : "?") + "prompt=" + encodeURIComponent(prompt);
}

function listText(items) {
  if (items.length <= 1) return items.join("");
  return items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
}

function ring(pct, { size = 132, stroke = 12, cls = "" } = {}) {
  const r = (size - stroke) / 2;
  const c = +(2 * Math.PI * r).toFixed(2);
  const off = +(c * (1 - Math.max(0, Math.min(100, pct)) / 100)).toFixed(2);
  const mid = size / 2;
  return (
    '<svg class="tr-ring ' + cls + '" viewBox="0 0 ' + size + " " + size + '" aria-hidden="true" focusable="false">' +
    '<circle class="tr-ring-track" cx="' + mid + '" cy="' + mid + '" r="' + r + '" stroke-width="' + stroke + '"/>' +
    '<circle class="tr-ring-value" cx="' + mid + '" cy="' + mid + '" r="' + r + '" stroke-width="' + stroke +
    '" stroke-dasharray="' + c + '" stroke-dashoffset="' + off + '" style="--c:' + c + '" transform="rotate(-90 ' + mid + " " + mid + ')"/></svg>'
  );
}

// Lesson position per module ({step, steps, at}). Preview keeps it in this tab;
// signed-in users keep it on this device. An in-memory copy keeps everything
// working when browser storage is blocked.
const lessonMemory = new Map();
function lessonKey(uid) {
  return "mc_lessons_" + (kit.preview ? "preview_" + kit.preview : uid || "me");
}
function lessonStorage() {
  try {
    return kit.preview ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}
function readLessons(uid) {
  const key = lessonKey(uid);
  if (lessonMemory.has(key)) return lessonMemory.get(key);
  let value = {};
  try {
    value = JSON.parse(lessonStorage()?.getItem(key) || "{}") || {};
  } catch {
    value = {};
  }
  lessonMemory.set(key, value);
  return value;
}
function writeLesson(uid, moduleId, value) {
  const key = lessonKey(uid);
  const all = { ...readLessons(uid) };
  if (value) all[moduleId] = value;
  else delete all[moduleId];
  lessonMemory.set(key, all);
  try {
    lessonStorage()?.setItem(key, JSON.stringify(all));
  } catch {
    /* Storage can be unavailable in private browsing. */
  }
}

function progressOf(data) {
  const state = kit.portalState?.();
  if (state?.progressLoaded && state.progress) return state.progress;
  return data.progress || {};
}
function shiftsOf(data) {
  const live = kit.portalState?.()?.shifts;
  return Array.isArray(live) && live.length ? live : data.shifts || [];
}

// What should this person learn next, and why? Order: a lesson already in
// progress, unfinished priority modules, modules for the next rota station,
// then the learning path in order.
function planFor({ modules, progress, lessons, nextShift, exclude = [] }) {
  const open = modules.filter((m) => !isDone(progress, m) && !exclude.includes(m.id));
  const inProgress = open
    .filter((m) => lessons[m.id]?.step > 0)
    .sort((a, b) => (lessons[b.id].at || 0) - (lessons[a.id].at || 0))[0];
  if (inProgress)
    return { module: inProgress, mode: "continue", why: "You’re part-way through. Pick up at step " + (lessons[inProgress.id].step + 1) + "." };
  const priority = open.find((m) => m.priority);
  if (priority) return { module: priority, mode: "start", why: "Priority safety module. Everyone completes this one first." };
  if (nextShift) {
    const ids = stationModuleIds(nextShift.station);
    const station = ids.map((id) => open.find((m) => m.id === id)).find(Boolean);
    if (station)
      return { module: station, mode: "start", why: "Gets you ready for " + (nextShift.station || "your next shift") + " · " + shiftLabel(nextShift) + "." };
  }
  if (open[0]) return { module: open[0], mode: "start", why: "Next on your learning path." };
  return null;
}

// ---------------------------------------------------------------------------
// Learning hub
// ---------------------------------------------------------------------------
let hub = null;

export function renderTraining(data, k) {
  kit = k;
  const content = $("content");
  if (!content) return;
  if (content.dataset.enhancedPage === "training" && hub) {
    hub.data = data;
    drawHub();
    return;
  }
  content.dataset.enhancedPage = "training";
  const role = kit.normaliseRole(data.profile.role);
  const isLead = role === "manager" || role === "crewTrainer";
  const modules = visibleModules(role);
  hub = {
    data,
    role,
    isLead,
    modules,
    categories: [...new Set(modules.map(categoryOf))],
    filters: { q: "", category: "", status: "all", limit: PAGE_SIZE },
    tab: isLead && location.hash === "#team" ? "team" : "mine",
    signatures: {},
    animate: !reducedMotion(),
    team: { status: "idle", data: null, error: "", view: "people", q: "", attention: false },
  };
  content.innerHTML = hubMarkup();
  bindHub(content);
  drawHub();
  if (hub.tab === "team") showTab("team", false);
  // The sample team is free to build; the live one reads every team member's
  // progress, so it only loads when someone opens the Team progress tab.
  else if (isLead && kit.preview) loadTeam();
  // Let the entrance animations play once, then stop re-animating redraws.
  setTimeout(() => {
    if (!hub) return;
    hub.animate = false;
    content.querySelector(".tr-hub")?.classList.remove("tr-animate");
  }, 1200);
}

function hubMarkup() {
  const { isLead, categories } = hub;
  const tabs = isLead
    ? '<div class="tr-tabs" role="tablist" aria-label="Learning views">' +
      '<button type="button" role="tab" id="trTabMine" aria-controls="trPanelMine" aria-selected="true" data-tab="mine">My learning</button>' +
      '<button type="button" role="tab" id="trTabTeam" aria-controls="trPanelTeam" aria-selected="false" tabindex="-1" data-tab="team">Team progress <span class="tr-tab-count" id="trTeamCount" hidden></span></button>' +
      "</div>"
    : "";
  return (
    '<div class="tr-hub' + (hub.animate ? " tr-animate" : "") + '">' +
    '<section class="tr-hero" id="trHero" aria-labelledby="trHeroTitle"></section>' +
    tabs +
    '<div class="tr-panel" id="trPanelMine"' + (isLead ? ' role="tabpanel" aria-labelledby="trTabMine"' : "") + ">" +
    '<div class="tr-top-grid"><section class="tr-next" id="learningNext" aria-label="Your next step"></section>' +
    '<section class="tr-recs" id="trRecs" aria-labelledby="trRecsTitle"></section></div>' +
    '<div class="tr-mid-grid"><section class="tr-card-block tr-badges" id="trBadges" aria-labelledby="trBadgesTitle"></section>' +
    '<section class="tr-card-block tr-activity" id="trActivity" aria-labelledby="trActivityTitle"></section></div>' +
    '<section class="tr-library" id="trLibrary" aria-labelledby="trLibraryTitle">' +
    '<div class="tr-library-head"><div><h2 id="trLibraryTitle">Your modules</h2><p>Bite-sized lessons with a quick quiz at the end.</p></div><span class="tr-count" id="learningCount" role="status"></span></div>' +
    '<div class="tr-toolbar">' +
    '<label class="tr-search"><span class="sr-only">Search modules</span><svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path d="m20 20-4.2-4.2M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z"/></svg><input id="trSearch" type="search" placeholder="Search a skill or station…" autocomplete="off" enterkeyhint="search"></label>' +
    '<label class="tr-select"><span class="sr-only">Category</span><select id="trCategory"><option value="">All categories</option>' +
    categories.map((c) => '<option value="' + esc(c) + '">' + esc(c) + "</option>").join("") +
    "</select></label></div>" +
    '<div class="tr-chips" id="trChips" role="group" aria-label="Browse by category"></div>' +
    '<div class="tr-status" role="group" aria-label="Filter by progress">' +
    '<button type="button" data-status="all" aria-pressed="true">All modules</button>' +
    '<button type="button" data-status="todo" aria-pressed="false">To do</button>' +
    '<button type="button" data-status="done" aria-pressed="false">Completed</button></div>' +
    '<div class="tr-grid" id="trGrid"></div>' +
    '<div class="tr-more"><button id="learningMore" class="btn light" type="button">Show more modules</button></div>' +
    "</section>" +
    '<p class="tr-footnote">Learning is a starting point. Practise with your Crew Trainer and always follow your restaurant’s current official guidance.</p>' +
    "</div>" +
    (isLead ? '<div class="tr-panel" id="trPanelTeam" role="tabpanel" aria-labelledby="trTabTeam" hidden></div><dialog class="tr-dialog" id="trNudge" aria-labelledby="trNudgeTitle"></dialog>' : "") +
    "</div>"
  );
}

function bindHub(root) {
  const search = $("trSearch");
  const category = $("trCategory");
  search.addEventListener("input", () => {
    hub.filters.q = search.value;
    hub.filters.limit = PAGE_SIZE;
    drawLibrary();
  });
  category.addEventListener("change", () => {
    hub.filters.category = category.value;
    hub.filters.limit = PAGE_SIZE;
    drawChips();
    drawLibrary();
  });
  root.addEventListener("click", (event) => {
    const target = event.target.closest("button");
    if (!target || !root.contains(target)) return;
    if (target.dataset.status) {
      hub.filters.status = target.dataset.status;
      hub.filters.limit = PAGE_SIZE;
      syncStatusButtons();
      drawLibrary();
    } else if (target.dataset.cat !== undefined) {
      setCategory(target.dataset.cat);
    } else if (target.dataset.badge !== undefined) {
      setCategory(target.dataset.badge);
      $("trLibrary")?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
    } else if (target.id === "learningMore") {
      const previous = hub.filters.limit;
      hub.filters.limit += PAGE_SIZE;
      hub.appendFrom = previous;
      drawLibrary();
      hub.appendFrom = null;
      $("trGrid").children[previous]?.focus();
    } else if (target.id === "learningReset") {
      resetFilters();
      search.focus();
    } else if (target.dataset.tab) {
      showTab(target.dataset.tab, true);
    } else if (target.dataset.teamView) {
      hub.team.view = target.dataset.teamView;
      drawTeam();
    } else if (target.id === "trTeamAttention") {
      hub.team.attention = !hub.team.attention;
      drawTeam();
    } else if (target.id === "trTeamRetry" || target.id === "trTeamRefresh") {
      loadTeam(true);
    } else if (target.dataset.nudge) {
      openNudge(target.dataset.nudge);
    }
  });
  root.addEventListener("keydown", (event) => {
    const tab = event.target.closest?.('[role="tab"]');
    if (!tab || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = tab.dataset.tab === "mine" ? "team" : "mine";
    showTab(event.key === "Home" ? "mine" : event.key === "End" ? "team" : next, true);
    $(hub.tab === "team" ? "trTabTeam" : "trTabMine")?.focus();
  });
  root.addEventListener("input", (event) => {
    if (event.target.id === "trTeamSearch") {
      hub.team.q = event.target.value;
      drawTeamList();
    }
  });
}

function setCategory(value) {
  hub.filters.category = value;
  hub.filters.limit = PAGE_SIZE;
  $("trCategory").value = value;
  drawChips();
  drawLibrary();
}

function resetFilters() {
  hub.filters = { q: "", category: "", status: "all", limit: PAGE_SIZE };
  $("trSearch").value = "";
  $("trCategory").value = "";
  syncStatusButtons();
  drawChips();
  drawLibrary();
}

function syncStatusButtons() {
  document.querySelectorAll(".tr-status [data-status]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.status === hub.filters.status)));
}

function showTab(tab, updateHash) {
  if (!hub.isLead) return;
  hub.tab = tab;
  const mine = tab === "mine";
  $("trPanelMine").hidden = !mine;
  $("trPanelTeam").hidden = mine;
  for (const [id, on] of [["trTabMine", mine], ["trTabTeam", !mine]]) {
    const el = $(id);
    el.setAttribute("aria-selected", String(on));
    el.tabIndex = on ? 0 : -1;
  }
  if (updateHash) {
    try {
      history.replaceState(null, "", location.pathname + location.search + (mine ? "" : "#team"));
    } catch {
      /* History can be unavailable in sandboxed previews. */
    }
  }
  if (!mine) {
    if (hub.team.status === "idle") loadTeam();
    else drawTeam();
  }
}

// Redraws a region only when its content actually changed, so live updates
// never cause needless DOM churn (or lose focus inside untouched regions).
// The signature ignores entrance-animation classes, so a live update after
// the entrance has finished doesn't rebuild an unchanged grid.
function paint(id, html) {
  const el = $(id);
  const signature = html.replace(/ tr-in"/g, '"');
  if (!el || hub.signatures[id] === signature) return false;
  hub.signatures[id] = signature;
  el.innerHTML = html;
  return true;
}

function hubContext() {
  const { data, modules } = hub;
  const progress = progressOf(data);
  const lessons = readLessons(data.profile.id);
  const nextShift = nextShiftFor(data.profile.id, shiftsOf(data));
  return { progress, lessons, nextShift, modules };
}

function drawHub() {
  if (!hub || !$("trHero")) return;
  const ctx = hubContext();
  drawHero(ctx);
  const plan = planFor(ctx);
  drawNext(ctx, plan);
  drawRecs(ctx, plan);
  drawBadges(ctx);
  drawActivity(ctx);
  drawChips();
  drawLibrary();
  if (hub.isLead && hub.tab === "team") drawTeam();
}

function drawHero({ progress, modules }) {
  const { data } = hub;
  const done = modules.filter((m) => isDone(progress, m)).length;
  const total = modules.length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const xp = xpFor(progress);
  const level = levelFor(xp);
  const activity = activityFor(progress, modules);
  const earned = badgesFor(modules, progress).filter((b) => b.earned).length;
  const streak = activity.streak
    ? activity.streak + "-day streak"
    : "Start a streak today";
  paint(
    "trHero",
    '<div class="tr-hero-copy">' +
      '<div class="eyebrow">A little learning. Every shift.</div>' +
      '<h1 id="trHeroTitle">Your learning</h1>' +
      "<p>Good to see you, " + esc(firstName(data.profile.name)) + ". Build confidence one skill at a time.</p></div>" +
      '<div class="tr-stats">' +
      '<div class="tr-stat"><span class="tr-stat-icon" aria-hidden="true">⭐</span><span><b>Level ' + level.level + "</b><small>" + esc(level.name) + "</small></span></div>" +
      '<div class="tr-stat tr-stat-xp"><span class="tr-stat-icon" aria-hidden="true">⚡</span><span><b id="trXp">' + xp + " XP</b><small>" +
      (level.next != null ? level.toNext + " XP to Level " + (level.level + 1) : "Top level reached") +
      '</small><span class="tr-xpbar" role="progressbar" aria-label="Progress to next level" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + level.pct + '"><span style="width:' + level.pct + '%"></span></span></span></div>' +
      '<div class="tr-stat"><span class="tr-stat-icon" aria-hidden="true">' + (activity.streak ? "🔥" : "🌱") + "</span><span><b>" + esc(streak) + "</b><small>" +
      (activity.weekCount ? activity.weekCount + " completed this week" : "Complete a module to begin") + "</small></span></div>" +
      '<div class="tr-stat"><span class="tr-stat-icon" aria-hidden="true">🏅</span><span><b>' + earned + " badge" + (earned === 1 ? "" : "s") + "</b><small>" + (earned ? "Keep collecting" : "Complete a category") + "</small></span></div>" +
      "</div>" +
      '<div class="tr-hero-side">' +
      '<div class="tr-hero-ring" role="img" aria-label="' + pct + "% of your modules completed\">" + ring(pct, { size: 140, stroke: 13 }) +
      '<span class="tr-ring-label"><b>' + pct + "%</b><small>complete</small></span></div>" +
      '<p class="tr-ring-count" id="trCompletedCount">' + done + " of " + total + " modules</p>" +
      '<p class="tr-ring-sub">' + (total - done ? total - done + " to go. You’ve got this." : "Every module done!") + "</p>" +
      '<a class="tr-signoffs" href="' + esc(kit.pageFor("verification")) + '">Station sign-offs <span aria-hidden="true">↗</span></a>' +
      "</div>",
  );
}

function drawNext(ctx, plan) {
  const { progress, lessons, modules } = ctx;
  let html;
  if (!plan) {
    const review = modules
      .filter((m) => isDone(progress, m))
      .sort((a, b) => (scoreOf(progress[a.id]) ?? 100) - (scoreOf(progress[b.id]) ?? 100))[0];
    html =
      '<div class="tr-next-icon" aria-hidden="true">🏆</div><div class="tr-next-copy"><div class="eyebrow">All caught up</div>' +
      "<h2>You’ve completed every module.</h2><p>Brilliant work. Keep your skills fresh with a quick review.</p>" +
      (review ? '<a class="btn tr-next-cta" href="' + esc(moduleUrl(review)) + '">Review ' + esc(review.title) + ' <span aria-hidden="true">→</span></a>' : "") +
      "</div>";
  } else {
    const m = plan.module;
    const lesson = lessons[m.id];
    const steps = (m.sections?.length || 0) + 2;
    const lessonPct = lesson ? Math.round((Math.min(lesson.step, steps) / steps) * 100) : 0;
    html =
      '<div class="tr-next-icon tone-' + metaFor(categoryOf(m)).tone + '" aria-hidden="true">' + esc(m.icon || "✦") + "</div>" +
      '<div class="tr-next-copy"><div class="eyebrow">' + (plan.mode === "continue" ? "Continue learning" : "Up next") + (m.priority ? ' · <span class="tr-priority">Priority</span>' : "") + "</div>" +
      "<h2>" + esc(m.title) + "</h2><p>" + esc(m.tagline) + "</p>" +
      '<p class="tr-why"><span aria-hidden="true">💡</span> ' + esc(plan.why) + "</p>" +
      '<div class="tr-meta"><span>' + esc(m.time) + "</span><span>" + (m.sections?.length || 0) + " lessons</span><span>+" + esc(m.xp) + " XP</span></div>" +
      (plan.mode === "continue"
        ? '<div class="tr-bar tr-bar-light" role="progressbar" aria-label="Lesson progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + lessonPct + '"><span style="width:' + lessonPct + '%"></span></div>'
        : "") +
      '<a class="btn tr-next-cta" href="' + esc(moduleUrl(m)) + '">' + (plan.mode === "continue" ? "Continue learning" : "Start learning") + ' <span aria-hidden="true">→</span></a>' +
      "</div>";
  }
  paint("learningNext", html);
}

function drawRecs(ctx, plan) {
  const { progress, nextShift, modules } = ctx;
  const exclude = plan ? [plan.module.id] : [];
  const byId = (id) => modules.find((m) => m.id === id);
  const picks = [];
  const add = (m) => {
    if (m && !exclude.includes(m.id) && !picks.includes(m)) picks.push(m);
  };
  let title = "Recommended for you";
  let sub = "Picked for your role and your learning so far.";
  if (nextShift) {
    title = "Ready for your next shift";
    sub = (nextShift.station || "Shift") + " · " + shiftLabel(nextShift);
    const ids = stationModuleIds(nextShift.station).map(byId).filter(Boolean);
    ids.filter((m) => !isDone(progress, m)).forEach(add);
    if (!picks.length) ids.forEach(add);
  }
  if (hub.role === "crewTrainer") modules.filter((m) => categoryOf(m) === "Crew Trainer" && !isDone(progress, m)).forEach(add);
  if (hub.role === "manager") modules.filter((m) => categoryOf(m) === "Manager" && !isDone(progress, m)).forEach(add);
  modules.filter((m) => !isDone(progress, m)).forEach(add);
  if (picks.length < 3) modules.forEach(add);
  const list = picks.slice(0, 3);
  const verified = hub.data.profile.verifiedStations || [];
  const ready = nextShift && stationMatches(verified, nextShift.station);
  paint(
    "trRecs",
    '<div class="tr-block-head"><div><h2 id="trRecsTitle">' + esc(title) + "</h2><p>" + esc(sub) + "</p></div>" +
      (nextShift ? '<span class="tr-shift-chip' + (ready ? " ok" : "") + '">' + (ready ? "✓ Signed off" : "📅 " + esc(nextShift.station || "Shift")) + "</span>" : "") +
      "</div>" +
      '<div class="tr-rec-list">' +
      list
        .map((m) => {
          const done = isDone(progress, m);
          return (
            '<a class="tr-rec" href="' + esc(moduleUrl(m)) + '" aria-label="' + esc(m.title + (done ? ", completed, review" : ", " + m.time)) + '">' +
            '<span class="tr-rec-icon tone-' + metaFor(categoryOf(m)).tone + '" aria-hidden="true">' + esc(m.icon || "✦") + "</span>" +
            '<span class="tr-rec-copy"><b>' + esc(m.title) + "</b><small>" + (done ? "Completed · Review" : esc(m.time) + " · +" + esc(m.xp) + " XP") + "</small></span>" +
            '<span class="tr-rec-arrow" aria-hidden="true">' + (done ? "✓" : "→") + "</span></a>"
          );
        })
        .join("") +
      "</div>",
  );
}

function drawBadges({ progress, modules }) {
  const badges = badgesFor(modules, progress);
  const earned = badges.filter((b) => b.earned).length;
  paint(
    "trBadges",
    '<div class="tr-block-head"><div><h2 id="trBadgesTitle">Badge shelf</h2><p>' + earned + " of " + badges.length + " earned · finish a category to unlock its badge</p></div></div>" +
      '<div class="tr-badge-list">' +
      badges
        .map((b) => {
          const pct = b.total ? Math.round((b.done / b.total) * 100) : 0;
          return (
            '<button type="button" class="tr-badge' + (b.earned ? " earned" : "") + " tone-" + b.meta.tone + '" data-badge="' + esc(b.category) + '" aria-label="' +
            esc(b.meta.badge + " badge, " + (b.earned ? "earned" : b.done + " of " + b.total + " " + b.category + " modules complete") + ". Show " + b.category + " modules") + '">' +
            '<span class="tr-medal">' + ring(pct, { size: 58, stroke: 5, cls: "tr-medal-ring" }) + '<span class="tr-medal-icon" aria-hidden="true">' + esc(b.meta.icon) + "</span></span>" +
            "<b>" + esc(b.meta.badge) + "</b><small>" + (b.earned ? "Earned" : b.done + "/" + b.total) + "</small></button>"
          );
        })
        .join("") +
      "</div>",
  );
}

function milestoneFor(progress, modules) {
  const open = badgesFor(modules, progress)
    .filter((b) => !b.earned && b.total)
    .sort((a, b) => a.total - a.done - (b.total - b.done) || b.done - a.done)[0];
  if (open) {
    const left = open.total - open.done;
    return { icon: open.meta.icon, text: left + " more " + open.category + " module" + (left === 1 ? "" : "s") + " to earn " + open.meta.badge + "." };
  }
  const level = levelFor(xpFor(progress));
  if (level.next != null) return { icon: "⭐", text: level.toNext + " XP to reach Level " + (level.level + 1) + "." };
  return { icon: "🏆", text: "Every badge earned. You’re a crew legend!" };
}

function drawActivity({ progress, modules }) {
  const activity = activityFor(progress, modules);
  const recent = activity.items.slice(0, 3);
  const milestone = milestoneFor(progress, modules);
  paint(
    "trActivity",
    '<div class="tr-block-head"><div><h2 id="trActivityTitle">This week</h2><p>' +
      (activity.weekCount ? activity.weekCount + " module" + (activity.weekCount === 1 ? "" : "s") + " completed" : "No modules completed yet this week") +
      "</p></div></div>" +
      '<ol class="tr-week" aria-label="Learning days this week">' +
      activity.week
        .map((d) => '<li class="' + (d.active ? "on" : "") + (d.today ? " today" : "") + '"><span aria-hidden="true">' + esc(d.label) + '</span><i aria-hidden="true">' + (d.active ? "✓" : "") + '</i><span class="sr-only">' + esc(d.name) + (d.active ? ": learned" : ": no learning") + "</span></li>")
        .join("") +
      "</ol>" +
      (recent.length
        ? '<ul class="tr-recent">' +
          recent
            .map((x) => '<li><span aria-hidden="true">' + esc(x.m.icon || "✦") + "</span><b>" + esc(x.m.title) + "</b><small>" + esc(relTime(x.at)) + (x.score != null ? " · " + x.score + "%" : "") + "</small></li>")
            .join("") +
          "</ul>"
        : '<p class="tr-empty-note">Your completed modules will appear here.</p>') +
      '<p class="tr-milestone"><span aria-hidden="true">' + esc(milestone.icon) + "</span><span><b>Next milestone</b> " + esc(milestone.text) + "</span></p>",
  );
}

function drawChips() {
  const { modules, categories, filters } = hub;
  const progress = progressOf(hub.data);
  paint(
    "trChips",
    '<button type="button" data-cat="" aria-pressed="' + String(!filters.category) + '">All</button>' +
      categories
        .map((c) => {
          const list = modules.filter((m) => categoryOf(m) === c);
          const done = list.filter((m) => isDone(progress, m)).length;
          return (
            '<button type="button" data-cat="' + esc(c) + '" aria-pressed="' + String(filters.category === c) + '" aria-label="' + esc(c + ", " + done + " of " + list.length + " complete") + '">' +
            '<span aria-hidden="true">' + esc(metaFor(c).icon) + "</span>" + esc(c) + ' <small aria-hidden="true">' + done + "/" + list.length + "</small></button>"
          );
        })
        .join(""),
  );
}

function statusFor(m, progress, lessons) {
  const entry = progress[m.id];
  if (entry?.completed) {
    const s = scoreOf(entry);
    return { key: "done", label: "Completed ✓" + (s != null ? " · " + s + "%" : ""), pct: 100 };
  }
  const lesson = lessons[m.id];
  if (lesson?.step > 0) {
    const steps = (m.sections?.length || 0) + 2;
    return { key: "progress", label: "In progress", pct: Math.round((Math.min(lesson.step, steps) / steps) * 100) };
  }
  if (m.priority) return { key: "priority", label: "Priority", pct: 0 };
  return { key: "new", label: m.level || "Ready to start", pct: 0 };
}

function drawLibrary() {
  const { modules, filters } = hub;
  const progress = progressOf(hub.data);
  const lessons = readLessons(hub.data.profile.id);
  const q = filters.q.trim().toLowerCase();
  const filtered = modules.filter(
    (m) =>
      (!filters.category || categoryOf(m) === filters.category) &&
      (filters.status === "all" || isDone(progress, m) === (filters.status === "done")) &&
      [m.title, m.tagline, m.category, m.station, ...(m.keywords || [])].join(" ").toLowerCase().includes(q),
  );
  $("learningCount").textContent = filtered.length + (filtered.length === 1 ? " module" : " modules");
  const shown = filtered.slice(0, filters.limit);
  const html = filtered.length
    ? shown
        .map((m, i) => {
          const st = statusFor(m, progress, lessons);
          const tone = metaFor(categoryOf(m)).tone;
          const anim = hub.animate || (hub.appendFrom != null && i >= hub.appendFrom);
          return (
            '<a class="tr-module tone-' + tone + (anim ? " tr-in" : "") + '" style="--i:' + (i % PAGE_SIZE) + '" href="' + esc(moduleUrl(m)) + '" aria-label="' + esc(m.title + ". " + st.label.replace(" ✓", "") + ". " + m.time) + '">' +
            '<span class="tr-module-top"><span class="tr-module-icon" aria-hidden="true">' + esc(m.icon || "✦") + '</span><span class="tr-pill ' + st.key + '">' + esc(st.label) + "</span></span>" +
            '<small class="tr-module-cat">' + esc(categoryOf(m)) + " · " + esc(m.station || "All stations") + "</small>" +
            "<h3>" + esc(m.title) + "</h3><p>" + esc(m.tagline) + "</p>" +
            '<span class="tr-module-meta"><span>⏱ ' + esc(m.time) + "</span><span>" + (m.sections?.length || 0) + " lessons</span><span>+" + esc(m.xp) + " XP</span></span>" +
            '<span class="tr-bar" aria-hidden="true"><span style="width:' + st.pct + '%"></span></span></a>'
          );
        })
        .join("")
    : '<div class="tr-empty"><span aria-hidden="true">🔍</span><h3>No modules found</h3><p>Try another keyword or reset your filters.</p><button class="btn light" id="learningReset" type="button">Reset filters</button></div>';
  paint("trGrid", html);
  $("learningMore").hidden = filtered.length <= filters.limit;
}

// ---------------------------------------------------------------------------
// Team progress (Managers and Crew Trainers)
// ---------------------------------------------------------------------------
async function loadTeam(force = false) {
  const team = hub.team;
  if (team.status === "loading" || (team.status === "ready" && !force)) return;
  if (kit.preview) {
    team.status = "ready";
    team.data = null; // Preview members are rebuilt from the live preview state.
    drawTeam();
    return;
  }
  team.status = "loading";
  team.error = "";
  drawTeam();
  try {
    team.data = await kit.api("/api/training-progress");
    team.status = "ready";
  } catch (error) {
    team.status = "error";
    team.error = error.message || "Could not load team progress.";
  }
  drawTeam();
}

// Preview mode: a believable sample team built from the preview restaurant.
function previewMembers() {
  const state = kit.portalState?.() || {};
  const people = (state.team?.length ? state.team : hub.data.team || []).filter((p) => p?.id);
  const selfId = hub.data.profile.id;
  const extra = state.extras?.teamProgress || {};
  const crewOrder = allModules().filter((m) => m.roles?.includes("crew")).map((m) => m.id);
  const fallback = {
    "preview-amelia": crewOrder.slice(0, 16),
    "preview-a": crewOrder.slice(0, 12),
    "preview-maya": crewOrder.slice(0, 9),
    "preview-ryan": ["first-shift", "teamwork-communication", "front-counter"],
    "preview-b": ["first-shift", "food-safety"],
  };
  const ids = (person) =>
    Array.isArray(extra[person.id]) ? extra[person.id] : fallback[person.id] || ["first-shift"];
  const scores = [100, 80, 100, 75, 100, 80, 100, 100, 75];
  const list = people.some((p) => p.id === selfId) ? people : [{ ...hub.data.profile }, ...people];
  return list.map((person, index) => {
    const you = person.id === selfId;
    const progress = you
      ? progressOf(hub.data)
      : Object.fromEntries(
          ids(person).map((id, i) => [
            id,
            { completed: true, completedAt: Date.now() - ((index * 3 + i * 4) % 26) * DAY - index * 3600e3, score: scores[(index + i) % scores.length] },
          ]),
        );
    return {
      id: person.id,
      name: person.name || "Crew member",
      role: kit.normaliseRole(person.role),
      roleLabel: kit.roleLabel(person.role),
      verifiedStations: person.verifiedStations || [],
      progress,
      you,
    };
  });
}

function teamMembers() {
  if (kit.preview) return previewMembers();
  return (hub.team.data?.members || []).map((m) => (m.you ? { ...m, progress: progressOf(hub.data) } : m));
}

function memberInfo(member, shifts) {
  const modules = visibleModules(member.role);
  const done = modules.filter((m) => isDone(member.progress, m));
  const pct = modules.length ? Math.round((done.length / modules.length) * 100) : 0;
  const priorityMissing = modules.filter((m) => m.priority && !isDone(member.progress, m));
  const lastActive = done.map((m) => toMillis(member.progress[m.id]?.completedAt)).filter(Boolean).sort((a, b) => b - a)[0] || null;
  const nextShift = nextShiftFor(member.id, shifts);
  // A station gap is the station's main module still to do before the next
  // shift, unless a Crew Trainer has already signed them off on that station.
  const primary = nextShift ? modules.find((m) => m.id === stationModuleIds(nextShift.station)[0]) : null;
  const stationGap =
    primary && !isDone(member.progress, primary) && !stationMatches(member.verifiedStations, nextShift.station) ? primary : null;
  const nextOpen = modules.find((m) => !isDone(member.progress, m)) || null;
  const state =
    member.progressAvailable === false
      ? "unknown"
      : priorityMissing.length
        ? "priority"
        : stationGap
          ? "gap"
          : pct === 100
            ? "complete"
            : "ontrack";
  return { modules, done, pct, priorityMissing, lastActive, nextShift, stationGap, nextOpen, state };
}

function drawTeam() {
  const panel = $("trPanelTeam");
  if (!panel) return;
  const team = hub.team;
  if (team.status !== "ready") {
    team.built = false;
    delete hub.signatures.trTeamSummary;
    delete hub.signatures.trTeamList;
    paint(
      "trPanelTeam",
      team.status === "error"
        ? '<div class="tr-card-block tr-team-error" role="alert"><span aria-hidden="true">📡</span><h2>Team progress didn’t load</h2><p>' + esc(team.error) + '</p><button type="button" class="btn" id="trTeamRetry">Try again</button></div>'
        : '<div class="tr-team-loading" role="status"><span class="tr-skel tr-skel-line"></span><span class="tr-skel tr-skel-tiles"></span><span class="tr-skel tr-skel-block"></span><span class="sr-only">Loading team progress…</span></div>',
    );
    return;
  }
  if (!team.built) {
    team.built = true;
    delete hub.signatures.trTeamSummary;
    delete hub.signatures.trTeamList;
    paint(
      "trPanelTeam",
      '<div class="tr-team-head"><div><div class="eyebrow">' + esc(hub.data.profile.storeName || "Your restaurant") + "</div><h2>Team progress</h2><p>Who’s learning, who needs a nudge and what matters before their next shift.</p></div>" +
        (kit.preview ? '<span class="tr-pill new">Sample team</span>' : '<button type="button" class="btn light" id="trTeamRefresh">Refresh</button>') +
        "</div>" +
        '<div id="trTeamSummary"></div>' +
        '<div class="tr-team-toolbar">' +
        '<label class="tr-search"><span class="sr-only">Search team</span><svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path d="m20 20-4.2-4.2M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z"/></svg><input id="trTeamSearch" type="search" placeholder="Find a team member…" autocomplete="off"></label>' +
        '<div class="tr-status tr-team-views" role="group" aria-label="Team view">' +
        '<button type="button" data-team-view="people" aria-pressed="true">People</button><button type="button" data-team-view="matrix" aria-pressed="false">Matrix</button></div>' +
        '<button type="button" class="tr-toggle" id="trTeamAttention" aria-pressed="false"><span aria-hidden="true">🔔</span> Needs attention</button>' +
        "</div>" +
        '<div id="trTeamList" class="tr-team-list"></div>',
    );
    $("trTeamSearch").value = team.q;
  }
  const shifts = shiftsOf(hub.data);
  const infos = teamMembers().map((m) => ({ member: m, info: memberInfo(m, shifts) }));
  team.infos = infos;
  // People whose progress couldn't be read are listed but left out of totals.
  const known = infos.filter((x) => x.info.state !== "unknown");
  const total = known.length;
  const avg = total ? Math.round(known.reduce((n, x) => n + x.info.pct, 0) / total) : 0;
  const priorityDone = known.filter((x) => !x.info.priorityMissing.length).length;
  const attention = infos.filter((x) => x.info.state === "priority" || x.info.state === "gap").length;
  const weekAgo = Date.now() - 7 * DAY;
  const active = infos.filter((x) => x.info.lastActive && x.info.lastActive >= weekAgo).length;
  const count = $("trTeamCount");
  if (count) {
    count.hidden = !attention;
    count.textContent = attention ? String(attention) : "";
    count.setAttribute("aria-label", attention + " need attention");
  }
  const priorityModules = allModules().filter((m) => m.priority);
  paint(
    "trTeamSummary",
    '<div class="tr-kpis">' +
      '<div class="tr-kpi"><div class="tr-kpi-ring" aria-hidden="true">' + ring(avg, { size: 56, stroke: 7 }) + "</div><div><b>" + avg + "%</b><small>Average completion</small></div></div>" +
      '<div class="tr-kpi"><span class="tr-kpi-icon" aria-hidden="true">🛟</span><div><b>' + priorityDone + " / " + total + "</b><small>Priority modules done</small></div></div>" +
      '<div class="tr-kpi' + (attention ? " warn" : "") + '"><span class="tr-kpi-icon" aria-hidden="true">🔔</span><div><b>' + attention + "</b><small>Need a nudge</small></div></div>" +
      '<div class="tr-kpi"><span class="tr-kpi-icon" aria-hidden="true">📈</span><div><b>' + active + "</b><small>Learned this week</small></div></div>" +
      "</div>" +
      '<section class="tr-card-block tr-priority-block" aria-labelledby="trPriorityTitle"><div class="tr-block-head"><div><h3 id="trPriorityTitle">Priority modules</h3><p>Everyone completes these before anything else.</p></div></div>' +
      priorityModules
        .map((m) => {
          const missing = known.filter((x) => !isDone(x.member.progress, m));
          const donePct = total ? Math.round(((total - missing.length) / total) * 100) : 0;
          return (
            '<div class="tr-priority-row"><div class="tr-priority-title"><span aria-hidden="true">' + esc(m.icon) + "</span><b>" + esc(m.title) + "</b><small>" + (total - missing.length) + " of " + total + " done</small></div>" +
            '<span class="tr-bar" role="progressbar" aria-label="' + esc(m.title) + ' team completion" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + donePct + '"><span style="width:' + donePct + '%"></span></span>' +
            (missing.length
              ? '<p class="tr-missing">Still to do: ' + esc(listText(missing.slice(0, 4).map((x) => (x.member.you ? "you" : x.member.name)))) + (missing.length > 4 ? " and " + (missing.length - 4) + " more" : "") + "</p>"
              : '<p class="tr-missing ok">Everyone’s done ✓</p>') +
            "</div>"
          );
        })
        .join("") +
      "</section>",
  );
  document.querySelectorAll("[data-team-view]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.teamView === team.view)));
  $("trTeamAttention")?.setAttribute("aria-pressed", String(team.attention));
  drawTeamList();
}

function flagsFor(info) {
  if (info.state === "unknown") return '<span class="tr-flag">Progress couldn’t load. Try Refresh.</span>';
  const flags = info.priorityMissing.map((m) => '<span class="tr-flag bad">' + esc(shortTitle(m)) + " to do</span>");
  if (info.stationGap)
    flags.push('<span class="tr-flag warn">' + esc(shortTitle(info.stationGap)) + " before " + esc(shiftDay(info.nextShift)) + "’s shift</span>");
  if (!flags.length && info.pct === 100) flags.push('<span class="tr-flag ok">All modules complete</span>');
  else if (!flags.length) flags.push('<span class="tr-flag ok">On track</span>');
  return flags.join("");
}

function drawTeamList() {
  const list = $("trTeamList");
  if (!list || !hub.team.infos) return;
  const q = hub.team.q.trim().toLowerCase();
  const rank = { priority: 0, gap: 1, ontrack: 2, complete: 3, unknown: 4 };
  const rows = hub.team.infos
    .filter((x) => !q || x.member.name.toLowerCase().includes(q))
    .filter((x) => !hub.team.attention || x.info.state === "priority" || x.info.state === "gap")
    .sort((a, b) => rank[a.info.state] - rank[b.info.state] || a.info.pct - b.info.pct || a.member.name.localeCompare(b.member.name));
  if (!rows.length) {
    paint("trTeamList", '<div class="tr-empty"><span aria-hidden="true">🙌</span><h3>' + (hub.team.attention ? "Nobody needs a nudge" : "No team members found") + "</h3><p>" + (hub.team.attention ? "Everyone is on track right now." : "Try another name.") + "</p></div>");
    return;
  }
  if (hub.team.view === "matrix") {
    paint("trTeamList", matrixMarkup(rows));
    return;
  }
  paint(
    "trTeamList",
    rows
      .map(({ member, info }) => {
        const action = member.you
          ? '<span class="tr-you">You</span>'
          : info.state === "unknown"
            ? ""
            : info.state === "complete"
            ? '<button type="button" class="btn light tr-nudge-btn" data-nudge="' + esc(member.id) + '">Recognise</button>'
            : '<button type="button" class="btn light tr-nudge-btn" data-nudge="' + esc(member.id) + '" aria-label="Nudge ' + esc(member.name) + '">Nudge</button>';
        return (
          '<article class="tr-person ' + info.state + '">' +
          '<span class="tr-avatar" aria-hidden="true">' + esc(kit.initials(member.name)) + "</span>" +
          '<div class="tr-person-main"><div class="tr-person-name"><h3>' + esc(member.name) + "</h3><small>" + esc(member.roleLabel || kit.roleLabel(member.role)) +
          " · " + (info.lastActive ? "Last learned " + esc(relTimeLower(info.lastActive)) : "No learning yet") +
          (info.nextShift ? " · Next shift " + esc(shiftPhrase(info.nextShift)) : "") + "</small></div>" +
          '<div class="tr-person-progress"><span class="tr-bar" role="progressbar" aria-label="' + esc(member.name) + ' completion" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + info.pct + '"><span style="width:' + info.pct + '%"></span></span><b>' + info.pct + "%</b><small>" + info.done.length + "/" + info.modules.length + "</small></div>" +
          '<div class="tr-flags">' + flagsFor(info) + "</div></div>" +
          '<div class="tr-person-action">' + action + "</div></article>"
        );
      })
      .join(""),
  );
}

function matrixMarkup(rows) {
  const used = allModules().filter((m) => rows.some((x) => moduleVisibleForRole(m, x.member.role)));
  const cols = [...used.filter((m) => m.priority), ...used.filter((m) => !m.priority)];
  return (
    '<div class="tr-matrix-wrap" tabindex="0" role="region" aria-label="Module completion matrix, scrolls sideways">' +
    '<table class="tr-matrix"><caption class="sr-only">Module completion for each team member</caption><thead><tr><th scope="col" class="tr-matrix-name">Team member</th>' +
    cols.map((m) => '<th scope="col" class="' + (m.priority ? "priority" : "") + '" title="' + esc(m.title) + '"><span aria-hidden="true">' + esc(m.icon) + '</span><span class="sr-only">' + esc(m.title) + "</span></th>").join("") +
    "</tr></thead><tbody>" +
    rows
      .map(({ member, info }) =>
        '<tr><th scope="row" class="tr-matrix-name"><span>' + esc(member.name) + "</span><small>" + info.pct + "%</small></th>" +
        cols
          .map((m) => {
            if (!moduleVisibleForRole(m, member.role)) return '<td class="na"><span aria-hidden="true">–</span><span class="sr-only">Not needed</span></td>';
            const entry = member.progress[m.id];
            if (entry?.completed) {
              const s = scoreOf(entry);
              return '<td class="done" title="' + esc(m.title + ": completed" + (s != null ? " · " + s + "%" : "")) + '"><span aria-hidden="true">✓</span><span class="sr-only">Completed</span></td>';
            }
            return '<td class="' + (m.priority ? "missing priority" : "missing") + '" title="' + esc(m.title + ": not done") + '"><span aria-hidden="true">' + (m.priority ? "!" : "·") + '</span><span class="sr-only">Not done</span></td>';
          })
          .join("") +
        "</tr>",
      )
      .join("") +
    "</tbody></table></div>" +
    '<p class="tr-legend"><span class="done">✓ Completed</span><span class="missing priority">! Priority to do</span><span class="missing">· To do</span><span class="na">– Not needed for role</span></p>'
  );
}

function nudgeContent(member, info) {
  const viewer = firstName(hub.data.profile.name);
  const first = firstName(member.name);
  const manager = hub.role === "manager" || kit.preview === "manager";
  if (info.state === "complete") {
    return {
      title: "Recognise " + first,
      text: "Hi " + first + ", " + viewer + " here. You’ve completed every learning module in the crew hub. That’s brilliant work, thank you!",
      prompt: manager
        ? "Give " + member.name + " 1 McStar for completing every learning module."
        : "Draft a short congratulations message for " + member.name + " for completing every learning module.",
      promptLabel: manager ? "Award a McStar with McAssist" : "Ask McAssist",
    };
  }
  const mods = [...info.priorityMissing, ...(info.stationGap && !info.priorityMissing.includes(info.stationGap) ? [info.stationGap] : [])];
  if (!mods.length && info.nextOpen) mods.push(info.nextOpen);
  const picked = mods.slice(0, 3);
  const minutes = picked.reduce((n, m) => n + minutesOf(m), 0);
  const when = info.nextShift ? " before your shift " + shiftPhrase(info.nextShift) : "";
  return {
    title: "Nudge " + first,
    text:
      "Hi " + first + ", " + viewer + " here. When you get a moment, could you complete " + listText(picked.map((m) => m.title)) +
      " in the crew hub learning section" + when + "? It takes about " + minutes + " minutes. Thanks, you’re doing great!",
    prompt:
      "Draft a short, friendly reminder for " + member.name + " to complete " + listText(picked.map((m) => m.title)) +
      " in the learning hub" + (info.nextShift ? ", ideally before their shift on " + kit.formatDate(info.nextShift.date) : "") + ". Keep it encouraging.",
    promptLabel: "Ask McAssist to help",
  };
}

function openNudge(memberId) {
  const dialog = $("trNudge");
  const row = hub.team.infos?.find((x) => x.member.id === memberId);
  if (!dialog || !row) return;
  const n = nudgeContent(row.member, row.info);
  dialog.innerHTML =
    '<button type="button" class="icon-btn dialog-close" id="trNudgeClose" aria-label="Close"><svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path d="m6 6 12 12M6 18 18 6"/></svg></button>' +
    '<h2 id="trNudgeTitle">' + esc(n.title) + "</h2>" +
    '<p class="tr-dialog-sub">Edit the message and copy it into your team chat, or let McAssist help.</p>' +
    '<label class="sr-only" for="trNudgeText">Message</label><textarea id="trNudgeText" rows="5">' + esc(n.text) + "</textarea>" +
    '<div class="dialog-actions"><button type="button" class="btn dark" id="trNudgeCopy">Copy message</button>' +
    '<a class="btn soft" href="' + esc(assistantUrl(n.prompt)) + '">' + esc(n.promptLabel) + ' <span aria-hidden="true">✦</span></a></div>' +
    '<p class="tr-dialog-note" id="trNudgeStatus" role="status"></p>';
  dialog.removeAttribute("data-closing");
  $("trNudgeClose").addEventListener("click", () => dialog.close());
  $("trNudgeCopy").addEventListener("click", async () => {
    const area = $("trNudgeText");
    let ok = false;
    try {
      await navigator.clipboard.writeText(area.value);
      ok = true;
    } catch {
      try {
        area.select();
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
    }
    $("trNudgeStatus").textContent = ok ? "Copied. Paste it into your team chat." : "Select the message and copy it manually.";
    if (ok) kit.toast("Message copied.");
  });
  if (typeof dialog.showModal === "function") {
    if (!dialog.open) dialog.showModal();
  } else dialog.setAttribute("open", "");
  $("trNudgeText").focus();
}

// ---------------------------------------------------------------------------
// Lesson player (module.html?id=…)
// ---------------------------------------------------------------------------
let lesson = null;

export function renderModule(data, k) {
  kit = k;
  const content = $("content");
  if (!content) return false;
  if (content.dataset.enhancedPage === "module" && lesson) {
    lesson.data = data;
    refreshLessonStatus();
    return true;
  }
  content.dataset.enhancedPage = "module";
  const role = kit.normaliseRole(data.profile.role);
  const id = kit.params.get("id");
  const m = allModules().find((x) => x.id === id);
  const back = kit.pageFor("training");
  if (!m || !moduleVisibleForRole(m, role)) {
    lesson = null;
    content.innerHTML =
      '<div class="tr-lesson"><a class="tr-back" href="' + esc(back) + '"><span aria-hidden="true">←</span> My learning</a>' +
      '<section class="tr-card-block tr-missing-module"><span aria-hidden="true">🧭</span><h1>' + (m ? "This module isn’t part of your role." : "Module not found.") + "</h1><p>" +
      (m ? esc(m.title) + " is for " + esc(m.roles.map((r) => kit.roleLabel(r)).join(" and ")) + "s. Choose another module from your learning hub." : "It may have moved. Choose another module from your learning hub.") +
      '</p><a class="btn" href="' + esc(back) + '">Back to my learning</a></section></div>';
    return true;
  }
  const saved = readLessons(data.profile.id)[m.id];
  const progress = progressOf(data);
  const steps = m.sections.length + 2;
  lesson = {
    data,
    role,
    m,
    steps,
    step: saved && !isDone(progress, m) ? Math.min(Math.max(0, Number(saved.step) || 0), steps - 1) : 0,
    furthest: 0,
    checks: new Set(),
    checkWarning: false,
    quiz: { index: 0, answers: [], checked: false, finished: false, attempts: 0 },
    save: { status: "idle", error: "" },
    resumed: Boolean(saved?.step) && !isDone(progress, m),
    celebration: null,
  };
  lesson.furthest = lesson.step;
  if (lesson.step >= steps - 1) lesson.step = steps - 2; // Resume at the confidence check, never mid-quiz.
  content.innerHTML = lessonMarkup();
  bindLesson(content);
  drawLesson(false);
  return true;
}

function lessonMarkup() {
  const { m } = lesson;
  const tone = metaFor(categoryOf(m)).tone;
  return (
    '<div class="tr-lesson">' +
    '<nav class="tr-lesson-nav" aria-label="Breadcrumb"><a class="tr-back" href="' + esc(kit.pageFor("training")) + '"><span aria-hidden="true">←</span> My learning</a><span class="tr-crumb" aria-hidden="true">/</span><span class="tr-crumb">' + esc(categoryOf(m)) + "</span></nav>" +
    '<header class="tr-lesson-hero tone-' + tone + '">' +
    '<span class="tr-lesson-icon" aria-hidden="true">' + esc(m.icon || "✦") + "</span>" +
    '<div class="tr-lesson-head"><div class="eyebrow">' + esc(categoryOf(m)) + " · " + esc(m.station || "All stations") + (m.priority ? ' · <span class="tr-priority">Priority</span>' : "") + "</div>" +
    "<h1>" + esc(m.title) + "</h1><p>" + esc(m.tagline) + "</p>" +
    '<div class="tr-meta"><span>⏱ ' + esc(m.time) + "</span><span>" + m.sections.length + " lessons</span><span>" + m.quiz.length + " questions</span><span>+" + esc(m.xp) + ' XP</span><span id="trLessonStatus" class="tr-pill"></span></div></div>' +
    "</header>" +
    '<div class="tr-lesson-progress"><div class="tr-lesson-progress-text"><span id="trStepLabel"></span><span id="trStepPct"></span></div>' +
    '<span class="tr-bar tr-bar-lg" id="trStepBar" role="progressbar" aria-label="Module progress" aria-valuemin="0" aria-valuemax="100"><span></span></span></div>' +
    '<div class="tr-lesson-layout">' +
    '<nav class="tr-steps-nav" aria-label="Module steps"><ol class="tr-steps" id="trSteps"></ol></nav>' +
    '<section class="tr-stage" id="trStage" aria-live="polite"></section>' +
    '<aside class="tr-focus" id="trFocus" aria-labelledby="trFocusTitle"></aside>' +
    "</div></div>"
  );
}

function stepName(i) {
  const { m } = lesson;
  if (i < m.sections.length) return m.sections[i].title;
  return i === m.sections.length ? "Confidence check" : "Quiz";
}

function allChecked() {
  return lesson.checks.size >= lesson.m.checklist.length;
}

function canOpenQuiz() {
  return allChecked() || isDone(progressOf(lesson.data), lesson.m);
}

function bindLesson(root) {
  root.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button || !root.contains(button)) return;
    const go = button.dataset.go;
    if (button.dataset.step !== undefined) {
      const target = Number(button.dataset.step);
      if (target === lesson.steps - 1 && !canOpenQuiz()) {
        lesson.checkWarning = true;
        goTo(lesson.steps - 2);
      } else goTo(target);
    } else if (go === "prev") goTo(lesson.step - 1);
    else if (go === "next") goTo(lesson.step + 1);
    else if (go === "quiz") {
      if (canOpenQuiz()) goTo(lesson.steps - 1);
      else {
        lesson.checkWarning = true;
        drawStage(true);
        $("trCheckWarning")?.focus();
      }
    } else if (go === "check") checkAnswer();
    else if (go === "next-question") nextQuestion();
    else if (go === "retry") retryQuiz();
    else if (go === "review") {
      resetQuiz();
      goTo(0);
    } else if (go === "save-again") saveCompletion();
    else if (go === "answers") {
      const list = $("trAnswerReview");
      if (list) {
        list.hidden = !list.hidden;
        button.setAttribute("aria-expanded", String(!list.hidden));
        button.textContent = list.hidden ? "Review answers" : "Hide answers";
      }
    }
  });
  root.addEventListener("change", (event) => {
    const input = event.target;
    if (input.matches?.("[data-check]")) {
      const i = Number(input.dataset.check);
      if (input.checked) lesson.checks.add(i);
      else lesson.checks.delete(i);
      if (allChecked()) lesson.checkWarning = false;
      const warn = $("trCheckWarning");
      if (warn && allChecked()) warn.hidden = true;
      $("trCheckCount").textContent = lesson.checks.size + " of " + lesson.m.checklist.length + " ticked";
      drawSteps();
    } else if (input.name === "trAnswer") {
      lesson.quiz.selected = Number(input.value);
      const check = root.querySelector('[data-go="check"]');
      if (check) check.disabled = false;
    }
  });
}

function goTo(step) {
  const target = Math.max(0, Math.min(lesson.steps - 1, step));
  if (target === lesson.steps - 1 && !canOpenQuiz()) {
    lesson.checkWarning = true;
    lesson.step = lesson.steps - 2;
  } else lesson.step = target;
  lesson.furthest = Math.max(lesson.furthest, lesson.step);
  lesson.resumed = false;
  if (!isDone(progressOf(lesson.data), lesson.m))
    writeLesson(lesson.data.profile.id, lesson.m.id, { step: lesson.step, steps: lesson.steps, at: Date.now() });
  drawLesson(true);
  const heading = document.querySelector("#trStage h2");
  heading?.focus({ preventScroll: true });
  const top = $("trStage")?.getBoundingClientRect().top ?? 0;
  if (top < 0 || top > window.innerHeight * 0.6)
    document.querySelector(".tr-lesson-progress")?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
}

function drawLesson(animate) {
  drawProgressBar();
  drawSteps();
  drawStage(animate);
  drawFocus();
  refreshLessonStatus();
}

function refreshLessonStatus() {
  const el = $("trLessonStatus");
  if (!el || !lesson) return;
  const entry = progressOf(lesson.data)[lesson.m.id];
  const s = scoreOf(entry);
  el.className = "tr-pill " + (entry?.completed ? "done" : lesson.furthest > 0 ? "progress" : "new");
  el.textContent = entry?.completed ? "Completed ✓" + (s != null ? " · best " + s + "%" : "") : lesson.furthest > 0 ? "In progress" : "Not started";
}

function drawProgressBar() {
  const { step, steps, quiz } = lesson;
  const finished = quiz.finished && quiz.passed;
  const pct = finished ? 100 : Math.round((step / steps) * 100);
  const label =
    step < lesson.m.sections.length
      ? "Lesson " + (step + 1) + " of " + lesson.m.sections.length
      : step === lesson.m.sections.length
        ? "Confidence check"
        : finished
          ? "Module complete"
          : quiz.finished
            ? "Quiz result · " + quiz.score.pct + "%"
            : "Quiz · question " + Math.min(quiz.index + 1, lesson.m.quiz.length) + " of " + lesson.m.quiz.length;
  $("trStepLabel").textContent = label;
  $("trStepPct").textContent = pct + "%";
  const bar = $("trStepBar");
  bar.setAttribute("aria-valuenow", String(pct));
  bar.firstElementChild.style.width = pct + "%";
}

function drawSteps() {
  const { steps, step } = lesson;
  const done = isDone(progressOf(lesson.data), lesson.m);
  $("trSteps").innerHTML = Array.from({ length: steps }, (_, i) => {
    const state = i === step ? "current" : i < lesson.furthest || (done && i !== step) ? "done" : "todo";
    const locked = i === steps - 1 && !canOpenQuiz();
    const icon = i === steps - 1 ? "?" : i === steps - 2 ? "✓" : String(i + 1);
    return (
      '<li class="' + state + (locked ? " locked" : "") + '"><button type="button" data-step="' + i + '"' + (i === step ? ' aria-current="step"' : "") +
      ' aria-label="' + esc("Step " + (i + 1) + ": " + stepName(i) + (state === "done" ? ", visited" : "") + (locked ? ", tick the confidence check first" : "")) + '">' +
      '<span class="tr-step-dot" aria-hidden="true">' + (state === "done" && i < steps - 2 ? "✓" : icon) + '</span><span class="tr-step-name">' + esc(stepName(i)) + "</span></button></li>"
    );
  }).join("");
}

function drawStage(animate) {
  const stage = $("trStage");
  const { m, step } = lesson;
  let html;
  if (step < m.sections.length) html = sectionMarkup(m.sections[step], step);
  else if (step === m.sections.length) html = checklistMarkup();
  else html = quizMarkup();
  stage.innerHTML = '<div class="tr-stage-inner' + (animate && !reducedMotion() ? " tr-enter" : "") + '">' + html + "</div>";
  drawSaveStatus();
}

function sectionMarkup(s, i) {
  const { m } = lesson;
  const last = i === m.sections.length - 1;
  return (
    (lesson.resumed ? '<p class="tr-resume" role="status">👋 Welcome back. You’re on lesson ' + (i + 1) + " of " + m.sections.length + ".</p>" : "") +
    '<article class="tr-section">' +
    '<div class="tr-section-num">Lesson ' + (i + 1) + " of " + m.sections.length + "</div>" +
    '<h2 tabindex="-1">' + esc(s.title) + "</h2>" +
    "<p>" + esc(s.text) + "</p>" +
    (s.points?.length ? '<ul class="tr-points">' + s.points.map((p) => "<li>" + esc(p) + "</li>").join("") + "</ul>" : "") +
    '<div class="tr-takeaway"><span class="tr-takeaway-label"><span aria-hidden="true">💡</span> Key takeaway</span><p>' + esc(s.takeaway) + "</p></div>" +
    "</article>" +
    '<div class="tr-stage-nav">' +
    (i > 0 ? '<button type="button" class="btn light" data-go="prev"><span aria-hidden="true">←</span> Back</button>' : "<span></span>") +
    '<button type="button" class="btn dark" data-go="next">' + (last ? "Confidence check" : "Next lesson") + ' <span aria-hidden="true">→</span></button></div>'
  );
}

function checklistMarkup() {
  const { m } = lesson;
  return (
    '<article class="tr-section">' +
    '<div class="tr-section-num">Before the quiz</div>' +
    '<h2 tabindex="-1">Your confidence check</h2>' +
    "<p>Tick each statement you feel confident about. Not sure about one yet? Revisit that lesson or talk it through with your trainer.</p>" +
    '<fieldset class="tr-checks"><legend class="sr-only">Confidence statements</legend>' +
    m.checklist
      .map((item, i) => '<label class="tr-check"><input type="checkbox" data-check="' + i + '"' + (lesson.checks.has(i) ? " checked" : "") + '><span>' + esc(item) + "</span></label>")
      .join("") +
    '</fieldset><p class="tr-check-count" id="trCheckCount">' + lesson.checks.size + " of " + m.checklist.length + " ticked</p>" +
    '<div class="tr-recap"><h3>What you’ve learned</h3><ul>' + m.sections.map((s) => "<li><b>" + esc(s.title) + ".</b> " + esc(s.takeaway) + "</li>").join("") + "</ul></div>" +
    '<p class="tr-warning" id="trCheckWarning" role="alert" tabindex="-1"' + (lesson.checkWarning && !allChecked() ? "" : " hidden") + ">Tick every statement to start the quiz. If one doesn’t feel true yet, review that lesson first.</p>" +
    "</article>" +
    '<div class="tr-stage-nav"><button type="button" class="btn light" data-go="prev"><span aria-hidden="true">←</span> Back</button>' +
    '<button type="button" class="btn dark" data-go="quiz">Start the quiz <span aria-hidden="true">→</span></button></div>'
  );
}

function quizMarkup() {
  const { m, quiz } = lesson;
  if (quiz.finished) return resultMarkup();
  const q = m.quiz[quiz.index];
  const answered = quiz.checked;
  const chosen = quiz.selected;
  const correct = answered && chosen === q.correct;
  const dots = m.quiz
    .map((_, i) => {
      const a = quiz.answers[i];
      const cls = a == null ? (i === quiz.index ? "current" : "") : a === m.quiz[i].correct ? "right" : "wrong";
      return '<li class="' + cls + '"><span class="sr-only">Question ' + (i + 1) + (a == null ? "" : a === m.quiz[i].correct ? ": correct" : ": incorrect") + "</span></li>";
    })
    .join("");
  return (
    '<article class="tr-section tr-quiz">' +
    '<div class="tr-quiz-top"><span class="tr-section-num">Question ' + (quiz.index + 1) + " of " + m.quiz.length + '</span><span class="tr-passmark">Pass mark ' + PASS_MARK() + "%</span></div>" +
    '<ol class="tr-quiz-dots" aria-label="Quiz progress">' + dots + "</ol>" +
    '<fieldset class="tr-answers"' + (answered ? " disabled" : "") + '><legend><h2 tabindex="-1">' + esc(q.q) + "</h2></legend>" +
    q.a
      .map((a, j) => {
        const state = answered ? (j === q.correct ? " right" : j === chosen ? " wrong" : " dim") : "";
        return '<label class="tr-answer' + state + '"><input type="radio" name="trAnswer" value="' + j + '"' + (chosen === j ? " checked" : "") + '><span class="tr-answer-text">' + esc(a) + "</span>" +
          (answered && j === q.correct ? '<span class="tr-answer-mark" aria-hidden="true">✓</span>' : answered && j === chosen ? '<span class="tr-answer-mark" aria-hidden="true">✕</span>' : "") + "</label>";
      })
      .join("") +
    "</fieldset>" +
    (answered
      ? '<div class="tr-feedback ' + (correct ? "right" : "wrong") + '" role="status"><b>' + (correct ? "Correct! " : "Not quite. ") + "</b>" +
        (correct ? "" : "The right answer is “" + esc(q.a[q.correct]) + "”. ") + esc(q.explain) + "</div>"
      : "") +
    "</article>" +
    '<div class="tr-stage-nav">' +
    (answered
      ? '<span></span><button type="button" class="btn dark" data-go="next-question">' + (quiz.index + 1 < m.quiz.length ? "Next question" : "See my result") + ' <span aria-hidden="true">→</span></button>'
      : '<button type="button" class="btn light" data-go="prev"><span aria-hidden="true">←</span> Checklist</button><button type="button" class="btn dark" data-go="check"' + (chosen == null ? " disabled" : "") + ">Check answer</button>") +
    "</div>"
  );
}

function checkAnswer() {
  const { quiz, m } = lesson;
  if (quiz.selected == null || quiz.checked) return;
  quiz.checked = true;
  quiz.answers[quiz.index] = quiz.selected;
  drawStage(false);
  drawProgressBar();
  const feedback = document.querySelector(".tr-feedback");
  if (feedback && !reducedMotion()) feedback.classList.add(quiz.selected === m.quiz[quiz.index].correct ? "tr-pop" : "tr-shake");
  const next = document.querySelector('[data-go="next-question"]');
  next?.focus({ preventScroll: true });
  reveal(next);
}

// Brings an element comfortably into view (clear of the phone tab bar).
function reveal(el) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  if (r.bottom > window.innerHeight - 110 || r.top < 70)
    el.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "center" });
}

function nextQuestion() {
  const { quiz, m } = lesson;
  if (quiz.index + 1 < m.quiz.length) {
    quiz.index++;
    quiz.selected = null;
    quiz.checked = false;
    drawStage(true);
    drawProgressBar();
    document.querySelector("#trStage h2")?.focus({ preventScroll: true });
    return;
  }
  finishQuiz();
}

function resetQuiz() {
  lesson.quiz = { index: 0, answers: [], checked: false, finished: false, attempts: lesson.quiz.attempts, selected: null };
}

function retryQuiz() {
  resetQuiz();
  drawStage(true);
  drawProgressBar();
  document.querySelector("#trStage h2")?.focus({ preventScroll: true });
}

function quizScore() {
  const { m, quiz } = lesson;
  const right = m.quiz.filter((q, i) => quiz.answers[i] === q.correct).length;
  return { right, total: m.quiz.length, pct: Math.round((right / m.quiz.length) * 100) };
}

function finishQuiz() {
  const { quiz } = lesson;
  const score = quizScore();
  quiz.finished = true;
  quiz.attempts++;
  quiz.passed = score.pct >= PASS_MARK();
  quiz.score = score;
  if (quiz.passed) {
    // Rewards are worked out up front so the celebration shows straight away;
    // the save status line then confirms (or offers a retry).
    const before = progressOf(lesson.data);
    const after = { ...before, [lesson.m.id]: { completed: true } };
    const modules = visibleModules(lesson.role);
    const earnedBefore = badgesFor(modules, before).filter((b) => b.earned).map((b) => b.category);
    const levelBefore = levelFor(xpFor(before));
    const levelAfter = levelFor(xpFor(after));
    lesson.celebration = {
      firstTime: !isDone(before, lesson.m),
      level: levelAfter.level > levelBefore.level ? levelAfter : null,
      badges: badgesFor(modules, after).filter((b) => b.earned && !earnedBefore.includes(b.category)),
    };
  }
  drawLesson(true);
  document.querySelector("#trStage h2")?.focus({ preventScroll: true });
  document.querySelector(".tr-lesson-progress")?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
  if (quiz.passed) {
    celebrate();
    saveCompletion();
  }
}

async function saveCompletion() {
  const { m, quiz } = lesson;
  const previous = progressOf(lesson.data)[m.id] || {};
  const best = Math.max(scoreOf(previous) ?? 0, quiz.score.pct);
  const payload = {
    completed: true,
    xp: m.xp,
    score: best,
    lastScore: quiz.score.pct,
    attempts: (Number(previous.attempts) || 0) + quiz.attempts,
    completedAt: Date.now(),
  };
  lesson.save = { status: "saving", error: "" };
  drawSaveStatus();
  try {
    await kit.saveProgress(m.id, payload);
    const progress = progressOf(lesson.data);
    if (!progress[m.id]?.completed) progress[m.id] = payload;
    if (lesson.data.progress && lesson.data.progress !== progress) lesson.data.progress[m.id] = payload;
    writeLesson(lesson.data.profile.id, m.id, null);
    lesson.save = { status: "saved", error: "" };
    lesson.quiz.attempts = 0;
    drawSaveStatus();
    drawSteps();
    refreshLessonStatus();
  } catch (error) {
    lesson.save = {
      status: "error",
      error: /permission/i.test(error?.code || error?.message || "") ? "Your account couldn’t save this. Ask your manager to check your access." : "We couldn’t save your result. Check your connection and try again.",
    };
    drawSaveStatus();
  }
}

function drawSaveStatus() {
  const el = $("trSaveStatus");
  if (!el) return;
  const { status, error } = lesson.save;
  el.className = "tr-save " + status;
  el.innerHTML =
    status === "saving"
      ? '<span class="tr-spinner" aria-hidden="true"></span> Saving your progress…'
      : status === "saved"
        ? '<span aria-hidden="true">✓</span> ' + (kit.preview ? "Saved in this preview tab." : "Saved to your learning record.")
        : status === "error"
          ? esc(error) + ' <button type="button" class="text-btn" data-go="save-again">Try again</button>'
          : "";
}

function resultMarkup() {
  const { m, quiz } = lesson;
  const score = quiz.score;
  const review =
    '<ol class="tr-review" id="trAnswerReview" hidden>' +
    m.quiz
      .map((q, i) => {
        const right = quiz.answers[i] === q.correct;
        return '<li class="' + (right ? "right" : "wrong") + '"><b>' + esc(q.q) + "</b><span>" + (right ? "✓ " : "✕ Your answer: " + esc(q.a[quiz.answers[i]] ?? "none") + ". Correct: ") + esc(q.a[q.correct]) + "</span><small>" + esc(q.explain) + "</small></li>";
      })
      .join("") +
    "</ol>";
  if (!quiz.passed) {
    const wrong = m.quiz.map((q, i) => (quiz.answers[i] === q.correct ? null : q)).filter(Boolean);
    return (
      '<article class="tr-section tr-result fail">' +
      '<div class="tr-result-ring" aria-hidden="true">' + ring(score.pct, { size: 120, stroke: 11 }) + "<span><b>" + score.pct + "%</b></span></div>" +
      '<h2 tabindex="-1">Almost there</h2>' +
      "<p>You got " + score.right + " of " + score.total + " right. The pass mark is " + PASS_MARK() + "%. Have a look at the explanations and try again. You’ve got this.</p>" +
      '<ul class="tr-wrong">' + wrong.map((q) => "<li><b>" + esc(q.q) + "</b><span>" + esc(q.explain) + "</span></li>").join("") + "</ul>" +
      "</article>" +
      '<div class="tr-stage-nav"><button type="button" class="btn light" data-go="review">Review lessons</button><button type="button" class="btn dark" data-go="retry">Try again <span aria-hidden="true">↻</span></button></div>'
    );
  }
  const c = lesson.celebration || {};
  const progress = { ...progressOf(lesson.data), [m.id]: { completed: true } };
  const modules = visibleModules(lesson.role);
  const next = planFor({ modules, progress, lessons: readLessons(lesson.data.profile.id), nextShift: nextShiftFor(lesson.data.profile.id, shiftsOf(lesson.data)), exclude: [m.id] });
  return (
    '<article class="tr-section tr-result pass" id="trCelebrate">' +
    '<div class="tr-result-ring" aria-hidden="true">' + ring(score.pct, { size: 120, stroke: 11 }) + "<span><b>" + score.pct + "%</b></span></div>" +
    '<h2 tabindex="-1">Module complete!</h2>' +
    "<p>You got " + score.right + " of " + score.total + " right. " + (c.firstTime === false ? "Nice refresher." : "Brilliant work.") + "</p>" +
    '<div class="tr-rewards"><span class="tr-reward xp">+' + esc(m.xp) + " XP</span>" +
    (c.level ? '<span class="tr-reward level"><span aria-hidden="true">⭐</span> Level ' + c.level.level + " · " + esc(c.level.name) + "</span>" : "") +
    (c.badges || []).map((b) => '<span class="tr-reward badge"><span aria-hidden="true">' + esc(b.meta.icon) + "</span> " + esc(b.meta.badge) + " badge earned</span>").join("") +
    "</div>" +
    '<p class="tr-save" id="trSaveStatus" role="status"></p>' +
    '<button type="button" class="text-btn" data-go="answers" aria-expanded="false" aria-controls="trAnswerReview">Review answers</button>' + review +
    "</article>" +
    (next
      ? '<a class="tr-next-mini" href="' + esc(moduleUrl(next.module)) + '"><span class="tr-rec-icon tone-' + metaFor(categoryOf(next.module)).tone + '" aria-hidden="true">' + esc(next.module.icon) + '</span><span class="tr-rec-copy"><small>Next module</small><b>' + esc(next.module.title) + "</b><small>" + esc(next.why) + '</small></span><span class="tr-rec-arrow" aria-hidden="true">→</span></a>'
      : "") +
    '<div class="tr-stage-nav"><a class="btn light" href="' + esc(kit.pageFor("training")) + '">Back to my learning</a>' +
    (next ? '<a class="btn dark" href="' + esc(moduleUrl(next.module)) + '">Next module <span aria-hidden="true">→</span></a>' : '<button type="button" class="btn dark" data-go="review">Review lessons</button>') +
    "</div>"
  );
}

function celebrate() {
  const card = $("trCelebrate");
  if (!card || reducedMotion()) return;
  const rect = card.getBoundingClientRect();
  const layer = document.createElement("div");
  layer.className = "tr-confetti";
  layer.setAttribute("aria-hidden", "true");
  const colours = ["#ffbc0d", "#e7a600", "#d9152b", "#3f6944", "#2f5fb3", "#ffd75c", "#ffffff"];
  const originX = rect.left + rect.width / 2;
  const originY = Math.max(40, rect.top + 70);
  for (let i = 0; i < 64; i++) {
    const piece = document.createElement("i");
    const angle = (Math.PI * 2 * i) / 64 + Math.random() * 0.4;
    const power = 120 + Math.random() * 180;
    piece.style.cssText =
      "left:" + originX + "px;top:" + originY + "px;background:" + colours[i % colours.length] +
      ";--dx:" + Math.round(Math.cos(angle) * power) + "px;--dy:" + Math.round(Math.sin(angle) * power * 0.7 - 120) + "px" +
      ";--rot:" + Math.round(Math.random() * 720 - 360) + "deg;--delay:" + Math.round(Math.random() * 120) + "ms" +
      (i % 3 === 0 ? ";width:7px;height:7px;border-radius:50%" : "");
    layer.appendChild(piece);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 2600);
}

function drawFocus() {
  const { m, data } = lesson;
  const verified = data.profile.verifiedStations || [];
  const specific = VERIFIABLE.includes(String(m.station || "").toLowerCase());
  const signedOff = specific && stationMatches(verified, m.station);
  const next = nextShiftFor(data.profile.id, shiftsOf(data));
  const matchesShift = next && stationModuleIds(next.station).includes(m.id);
  $("trFocus").innerHTML =
    '<div class="eyebrow">Station focus</div>' +
    '<h2 id="trFocusTitle"><span aria-hidden="true">' + esc(m.icon) + "</span> " + esc(m.station || "All stations") + "</h2>" +
    "<p>Practise these on shift with your trainer:</p>" +
    '<ul class="tr-practice">' + (m.practice || []).map((p) => "<li>" + esc(p) + "</li>").join("") + "</ul>" +
    (matchesShift ? '<p class="tr-focus-shift"><span aria-hidden="true">📅</span> You’re on ' + esc(next.station) + " " + esc(shiftPhrase(next)) + ". Perfect timing.</p>" : "") +
    (specific
      ? signedOff
        ? '<p class="tr-focus-status ok"><span aria-hidden="true">✓</span> You’re signed off on ' + esc(m.station) + ".</p>"
        : '<p class="tr-focus-status">Not signed off on ' + esc(m.station) + ' yet. After practice, ask your Crew Trainer about a two-signature station check.</p><a class="text-btn" href="' + esc(kit.pageFor("verification")) + '">Station sign-offs <span aria-hidden="true">→</span></a>'
      : "") +
    '<p class="tr-focus-note">Official station guidance and your trainer always come first.</p>';
}
