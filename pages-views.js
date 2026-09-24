// Page views for Home, Schedule, Shift planner, Team, Availability and McStars.
// Pure HTML builders: every value from Firestore or the user is escaped.
// Interactions live in pages-ui.js; portal.js decides when to render.
import {
  isoDate,
  weekDates,
  shiftMinutes,
  shiftEnd,
  shiftStart,
  durationLabel,
  escapeHTML as esc,
  STATIONS,
  VERIFY_STATIONS,
  DAY_KEYS,
  normaliseAvailability,
  availabilityFor,
  validateShift,
  addDays,
  validTime,
} from "./portal-core.js";

// ---------------------------------------------------------------- helpers --
const PATHS = {
  plus: "M12 5v14M5 12h14",
  close: "m6 6 12 12M6 18 18 6",
  left: "m15 18-6-6 6-6",
  right: "m9 18 6-6-6-6",
  print:
    "M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v7H6z",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  clock: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  calendar:
    "M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2",
  wallet: "M3 7h18v13H3zM3 7V4h14v3m-1 7h5",
  star: "m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9Z",
  book: "M12 6C8 3 4 4 2 5v15c4-2 7-1 10 1m0-15c4-3 8-2 10-1v15c-4-2-7-1-10 1V6",
  team: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.9M13 3a4 4 0 0 1 0 8M9 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8",
  spark: "m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5Z",
  shield: "m12 3 8 3v7c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-5",
  check: "m5 12 4 4L19 6",
  arrow: "M5 12h14m-6-6 6 6-6 6",
  waste:
    "M4 7h16M9 7V4h6v3m-9 0 1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13",
  alert: "M12 9v4m0 4h.01M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  search: "m21 21-4.3-4.3M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z",
  user: "M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z",
  pound: "M17 20H7c2-2 2-4 2-7V8a4 4 0 0 1 7-2.6M6 13h8",
  moon: "M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z",
  sun: "M12 3v2m0 14v2M5.6 5.6 7 7m10 10 1.4 1.4M3 12h2m14 0h2M5.6 18.4 7 17M17 7l1.4-1.4M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
  trophy: "M8 21h8m-4-4v4M7 4h10v5a5 5 0 0 1-10 0V4Zm0 2H4a3 3 0 0 0 3 4m10-4h3a3 3 0 0 1-3 4",
  edit: "M4 20h4L19 9l-4-4L4 16v4Zm9-13 4 4",
};
export const ic = (name, cls = "") =>
  `<svg class="icon pg-icon ${cls}" aria-hidden="true" viewBox="0 0 24 24"><path d="${PATHS[name] || PATHS.spark}"/></svg>`;

export function normaliseRole(role) {
  const value = String(role || "")
    .toLowerCase()
    .replace(/[\s_-]/g, "");
  if (["manager", "shiftcreator", "admin"].includes(value)) return "manager";
  if (["crewtrainer", "trainer"].includes(value)) return "crewTrainer";
  return "crew";
}
export const roleLabel = (role) =>
  ({ manager: "Manager", crewTrainer: "Crew Trainer", crew: "Crew Member" })[
    normaliseRole(role)
  ];
const ROLE_ORDER = { manager: 0, crewTrainer: 1, crew: 2 };
/** Deactivated accounts (McAssist "deactivate") keep their history only. */
export const isInactive = (m) =>
  String(m?.status || "").toLowerCase() === "inactive" || m?.deactivated === true;
const activeTeam = (team) => (team || []).filter((m) => !isInactive(m));
export const initials = (name) =>
  String(name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join("") || "?";
const AVATAR_TONES = [
  ["#fff1bf", "#6b5000"],
  ["#e5f0e2", "#35593c"],
  ["#e3eefb", "#2d4f7a"],
  ["#fbe6e1", "#8a3a2c"],
  ["#efe8fb", "#54408a"],
  ["#f6ead9", "#7a5424"],
];
export function avatar(name, size = "") {
  let h = 0;
  for (const ch of String(name || "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const [bg, fg] = AVATAR_TONES[h % AVATAR_TONES.length];
  return `<span class="pg-avatar ${size}" style="background:${bg};color:${fg}" aria-hidden="true">${esc(initials(name))}</span>`;
}
const STATION_TONES = {
  Fries: ["#ffc629", "#fff5d6"],
  Grill: ["#ec8b3c", "#fdeedf"],
  "Chicken & Fryer": ["#e9a93b", "#fcf1dc"],
  "Front Counter": ["#4ea5d0", "#e4f2f9"],
  "Drive-thru": ["#5ea84a", "#e7f3e2"],
  "Drinks & McCafé": ["#a8784c", "#f3ebe2"],
  "Kitchen Assembly": ["#e0685c", "#fbe7e4"],
  Breakfast: ["#f08a6c", "#fdebe5"],
  "Dining Area": ["#7f9460", "#eef1e6"],
  "Shift Lead": ["#2f332e", "#e9eae5"],
  Training: ["#7f78e0", "#ecebfb"],
};
export const stationStyle = (station) => {
  const [bar, bg] = STATION_TONES[station] || ["#9aa08f", "#f1f2ec"];
  return `--st:${bar};--st-bg:${bg}`;
};
export const firstName = (name) =>
  String(name || "Team member")
    .trim()
    .split(/\s+/)[0];
export const fmt = (date, options) =>
  new Date(`${date}T12:00`).toLocaleDateString("en-GB", options);
export const dayShort = (date) => fmt(date, { weekday: "short" });
export const dayNum = (date) => fmt(date, { day: "numeric" });
export const dateMed = (date) =>
  fmt(date, { weekday: "short", day: "numeric", month: "short" });
export const dateLong = (date) =>
  fmt(date, { weekday: "long", day: "numeric", month: "long" });
export function weekRangeLabel(dates) {
  const a = new Date(`${dates[0]}T12:00`),
    b = new Date(`${dates[6]}T12:00`);
  const sameMonth = a.getMonth() === b.getMonth();
  return `${a.getDate()}${sameMonth ? "" : " " + a.toLocaleDateString("en-GB", { month: "short" })} – ${b.getDate()} ${b.toLocaleDateString("en-GB", { month: "short" })}`;
}
export const weekCaption = (offset) =>
  offset === 0
    ? "This week"
    : offset === 1
      ? "Next week"
      : offset === -1
        ? "Last week"
        : offset > 0
          ? `In ${offset} weeks`
          : `${-offset} weeks ago`;
const money = (value) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(
    value,
  );
export const rateOf = (person) => {
  const n = Number(person?.hourlyRate);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const sortShifts = (list) =>
  [...list].sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
const nextDay = (s) =>
  shiftEnd(s).getDate() !== shiftStart(s).getDate()
    ? '<sup title="Finishes the next day">+1</sup>'
    : "";
export const timeRange = (s) => `${esc(s.start)}–${esc(s.end)}${nextDay(s)}`;
// Chips in narrow grid cells may wrap after the dash instead of clipping.
const chipTime = (s) => `${esc(s.start)}–<wbr>${esc(s.end)}${nextDay(s)}`;
export function timeAgo(ms, now = Date.now()) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) return "";
  const mins = Math.round((now - value) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}
/** Human description of when a shift starts, relative to now. */
export function whenLabel(shift, now = new Date()) {
  const start = shiftStart(shift),
    end = shiftEnd(shift);
  if (start <= now && now < end)
    return { live: true, text: `On shift now · until ${shift.end}` };
  const mins = Math.round((start - now) / 60000);
  if (mins < 60) return { soon: true, text: `Starts in ${Math.max(1, mins)} min` };
  if (mins < 10 * 60)
    return { soon: true, text: `Starts in ${durationLabel(mins - (mins % 5))}` };
  const days = Math.round(
    (new Date(`${shift.date}T12:00`) - new Date(`${isoDate(now)}T12:00`)) /
      864e5,
  );
  if (days === 0) return { text: `Today at ${shift.start}` };
  if (days === 1) return { text: `Tomorrow at ${shift.start}` };
  if (days < 7) return { text: `${fmt(shift.date, { weekday: "long" })} at ${shift.start}` };
  return { text: `In ${days} days` };
}
export function visibleModules(modules, role) {
  const r = normaliseRole(role);
  return (modules || []).filter(
    (m) => !Array.isArray(m.roles) || !m.roles.length || m.roles.includes(r),
  );
}
export function learningStats(modules, role, completedIds) {
  const list = visibleModules(modules, role);
  const done = new Set(completedIds || []);
  const completed = list.filter((m) => done.has(m.id)).length;
  return {
    total: list.length,
    completed,
    pct: list.length ? Math.round((completed / list.length) * 100) : 0,
    next: list.find((m) => !done.has(m.id)) || null,
  };
}
const ownCompleted = (progress) =>
  Object.entries(progress || {})
    .filter(([, p]) => p?.completed)
    .map(([id]) => id);
export function memberLearning(c, member) {
  const { state, modules } = c;
  const ids =
    member.id === state.user.id
      ? ownCompleted(state.progress)
      : state.extras?.teamProgress?.[member.id];
  if (!Array.isArray(ids)) return null;
  return learningStats(modules, member.role, ids);
}
export const sortTeam = (team) =>
  [...(team || [])].sort(
    (a, b) =>
      (ROLE_ORDER[normaliseRole(a.role)] ?? 3) -
        (ROLE_ORDER[normaliseRole(b.role)] ?? 3) ||
      String(a.name || "").localeCompare(String(b.name || "")),
  );
/** Team members plus anyone who has a shift but is no longer in the team list. */
export function rotaMembers(team, shifts) {
  const withShifts = new Set(shifts.map((s) => s.userId));
  const list = sortTeam(team).filter((m) => !isInactive(m) || withShifts.has(m.id));
  const known = new Set(list.map((m) => m.id));
  for (const s of shifts) {
    if (s.userId && !known.has(s.userId)) {
      known.add(s.userId);
      list.push({
        id: s.userId,
        name: s.userName || "Former team member",
        role: s.role || "crew",
        missing: true,
      });
    }
  }
  return list;
}
const weekOffsetText = (c) => weekCaption(c.state.offset || 0);
export const clampOffset = (n) => Math.max(-4, Math.min(8, Number(n) || 0));
const pctRing = (pct, label) =>
  `<div class="pg-ring" style="--pct:${Math.max(0, Math.min(100, pct))}" role="img" aria-label="${esc(label)}"><span>${pct}<small>%</small></span></div>`;
const bar = (pct, label) =>
  `<div class="pg-bar" role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></div>`;

function pageHead(eyebrow, title, sub, actions = "") {
  return `<header class="pg-head"><div class="pg-head-copy"><p class="pg-eyebrow">${eyebrow}</p><h1>${title}</h1>${sub ? `<p class="pg-sub">${sub}</p>` : ""}</div>${actions ? `<div class="pg-head-actions">${actions}</div>` : ""}</header>`;
}
function weekNav(c, dates) {
  const offset = c.state.offset || 0;
  return `<div class="pg-weeknav" role="group" aria-label="Choose week"><button type="button" class="pg-iconbtn" data-week-step="-1" aria-label="Previous week" ${offset <= -4 ? "disabled" : ""}>${ic("left")}</button><div class="pg-weeknav-label" aria-live="polite"><b id="pgWeekLabel">${weekRangeLabel(dates)}</b><small>${weekOffsetText(c)}</small></div><button type="button" class="pg-iconbtn" data-week-step="1" aria-label="Next week" ${offset >= 8 ? "disabled" : ""}>${ic("right")}</button>${offset !== 0 ? `<button type="button" class="pg-chip" data-week-today>Today</button>` : ""}</div>`;
}
function emptyState(title, text, action = "") {
  return `<div class="pg-empty"><div class="pg-empty-art" aria-hidden="true">${ic("calendar")}</div><h3>${title}</h3><p>${text}</p>${action}</div>`;
}
function kpi(iconName, value, label, detail = "", tone = "") {
  return `<article class="pg-kpi ${tone}"><span class="pg-kpi-icon">${ic(iconName)}</span><strong>${value}</strong><span class="pg-kpi-label">${label}</span>${detail ? `<small>${detail}</small>` : ""}</article>`;
}
function shiftChip(s, { editable = false, flag = false, showName = false } = {}) {
  const label = `${showName ? esc(s.userName) + " · " : ""}${esc(dateMed(s.date))} ${esc(s.start)} to ${esc(s.end)}${s.station ? " · " + esc(s.station) : ""}`;
  const inner = `<b>${chipTime(s)}</b><span>${showName ? esc(firstName(s.userName)) + " · " : ""}${esc(s.station || "Station TBC")}</span>${flag ? '<i class="pg-flag" aria-hidden="true">!</i>' : ""}`;
  return editable
    ? `<button type="button" class="pg-shift" style="${stationStyle(s.station)}" data-shift="${esc(s.id)}" aria-label="Edit shift: ${label}${flag ? " (needs a look)" : ""}">${inner}</button>`
    : `<span class="pg-shift" style="${stationStyle(s.station)}" title="${label}">${inner}</span>`;
}
function shiftFlags(c, shifts) {
  const flags = new Map();
  const today = isoDate();
  for (const s of shifts) {
    const member = c.state.team.find((m) => m.id === s.userId);
    const check = validateShift(s, { shifts: c.state.shifts, member, today });
    const issues = [...check.errors, ...check.warnings.filter((w) => w !== "This date has already passed.")];
    if (issues.length) flags.set(s.id, issues);
  }
  return flags;
}

// ------------------------------------------------------------------- home --
export function homeView(c) {
  return c.isManager() ? managerHome(c) : crewHome(c);
}

function greeting(now = new Date()) {
  const h = now.getHours();
  return h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function nextShiftCard(c, next) {
  const u = c.state.user;
  if (!next)
    return `<article class="pg-next pg-next-empty"><div class="pg-next-body"><p class="pg-kicker">Your next shift</p><h2>${c.state.loaded ? "Nothing published yet" : "Finding your next shift…"}</h2><p>${c.state.loaded ? "When your manager publishes your next shift it will appear here straight away." : "Loading your rota."}</p></div><a class="btn light" href="${c.url("availability")}">Update availability</a></article>`;
  const when = whenLabel(next);
  const paid = shiftMinutes(next);
  const rate = rateOf(u);
  return `<article class="pg-next ${when.live ? "is-live" : ""}"><div class="pg-date-tile"><span>${esc(dayShort(next.date))}</span><b>${esc(dayNum(next.date))}</b><span>${esc(fmt(next.date, { month: "short" }))}</span></div><div class="pg-next-body"><p class="pg-kicker"><span class="pg-live-dot ${when.live ? "on" : when.soon ? "soon" : ""}" aria-hidden="true"></span>${esc(when.text)}</p><h2>${timeRange(next)}</h2><p><span class="pg-station-tag" style="${stationStyle(next.station)}">${esc(next.station || "Station to be confirmed")}</span> ${durationLabel(paid)} paid${Number(next.breakMinutes) ? ` · ${Number(next.breakMinutes)} min break` : ""}</p></div>${rate ? `<div class="pg-next-pay"><b>${money((paid / 60) * rate)}</b><small>est. gross</small></div>` : ""}</article>`;
}

function crewHome(c) {
  const { state, url } = c;
  const u = state.user;
  const now = new Date();
  const role = normaliseRole(u.role);
  const mine = c.myShifts();
  const upcoming = mine.filter((s) => shiftEnd(s) > now);
  const next = upcoming[0];
  const dates = weekDates(0);
  const week = mine.filter((s) => dates.includes(s.date));
  const minutes = week.reduce((n, s) => n + shiftMinutes(s), 0);
  const rate = rateOf(u);
  const learn = learningStats(c.modules, role, ownCompleted(state.progress));
  const recognition = (state.extras?.recognition || [])
    .filter((r) => r.userId === u.id)
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  const toSign = (state.extras?.verifications || []).filter(
    (v) =>
      v.status !== "verified" &&
      ((v.crewId === u.id && !v.crewSignature) ||
        (role === "crewTrainer" && v.trainerId === u.id && !v.trainerSignature)),
  );
  const verified = Array.isArray(u.verifiedStations) ? u.verifiedStations : [];
  const alert = toSign.length
    ? `<a class="pg-alert" href="/verification.html?id=${encodeURIComponent(toSign[0].id)}${c.preview ? "&preview=" + c.preview : ""}">${ic("shield")}<span><b>${toSign.length === 1 ? `Your ${esc(toSign[0].station)} sign-off is ready` : `${toSign.length} sign-offs need your signature`}</b><small>${esc(toSign[0].crewId === u.id ? toSign[0].trainerName : toSign[0].crewName)} is waiting for your signature.</small></span>${ic("arrow")}</a>`
    : "";
  return `<div class="pg-page pg-home">
<section class="pg-hero"><div class="pg-hero-top"><div><p class="pg-eyebrow">${esc(dateLong(isoDate(now)))}</p><h1>${greeting(now)}, ${esc(firstName(u.name))}.</h1><p class="pg-hero-sub">${next ? "Here’s your day at a glance." : "Your week at a glance."}</p></div><span class="pg-role-badge">${esc(roleLabel(role))}</span></div>${nextShiftCard(c, next)}</section>
${alert}
<div class="pg-kpis">${kpi("clock", durationLabel(minutes), "This week", `${week.length} shift${week.length === 1 ? "" : "s"} · ${esc(weekRangeLabel(dates))}`)}${kpi("wallet", rate ? money((minutes / 60) * rate) : "—", "Est. gross pay", rate ? `Before tax · ${money(rate)}/h` : "Hourly rate not set")}${kpi("star", `${Number(u.stars) || 0}<span class="pg-star">★</span>`, "McStars", esc(u.badge || "Every contribution counts"))}${kpi("book", `${learn.pct}%`, "Learning", `${learn.completed} of ${learn.total} modules`)}</div>
<div class="pg-grid-2">
<section class="pg-card"><div class="pg-card-head"><h2>Coming up</h2><a class="pg-link" href="${url("schedule")}">Full schedule ${ic("arrow")}</a></div>${
    upcoming.length
      ? `<ul class="pg-list">${upcoming
          .slice(0, 4)
          .map(
            (s) =>
              `<li class="pg-list-row"><div class="pg-mini-date"><span>${esc(dayShort(s.date))}</span><b>${esc(dayNum(s.date))}</b></div><div class="grow"><b>${timeRange(s)}</b><small>${esc(s.station || "Station TBC")} · ${durationLabel(shiftMinutes(s))}</small></div>${rate ? `<span class="pg-amount">${money((shiftMinutes(s) / 60) * rate)}</span>` : ""}</li>`,
          )
          .join("")}</ul>`
      : emptyState("No shifts yet", "Published shifts appear here as soon as your manager adds them.")
  }</section>
<section class="pg-card pg-learn-card"><div class="pg-card-head"><h2>Your learning</h2><a class="pg-link" href="${url("training")}">All modules ${ic("arrow")}</a></div><div class="pg-learn-row">${pctRing(learn.pct, `${learn.pct}% of learning complete`)}<div class="grow"><b>${learn.completed} of ${learn.total} modules complete</b><p class="pg-muted">${learn.next ? `Up next: ${esc(learn.next.title)}` : "You’re all caught up. Brilliant work."}</p>${learn.next ? `<a class="btn soft pg-btn-sm" href="${url("module", { id: learn.next.id })}">Continue learning ${ic("arrow")}</a>` : ""}</div></div><div class="pg-subhead">Verified stations</div><div class="pg-station-chips">${
    verified.length
      ? verified.map((s) => `<span class="pg-station-tag" style="${stationStyle(s)}">${ic("check")}${esc(s)}</span>`).join("")
      : '<span class="pg-muted">No station sign-offs yet. Your Crew Trainer will verify you on the job.</span>'
  }</div></section>
</div>
<div class="pg-grid-2">
<section class="pg-card"><div class="pg-card-head"><h2>Recent recognition</h2><a class="pg-link" href="${url("rewards")}">My McStars ${ic("arrow")}</a></div>${
    recognition.length
      ? `<ul class="pg-list">${recognition
          .slice(0, 3)
          .map(
            (r) =>
              `<li class="pg-list-row"><span class="pg-star-badge">+${Number(r.amount) || 0}</span><div class="grow"><b>${esc(r.note || "Great work on shift")}</b><small>${esc(r.createdByName ? "From " + r.createdByName : "From your manager")}${r.createdAt ? " · " + esc(timeAgo(r.createdAt)) : ""}</small></div></li>`,
          )
          .join("")}</ul>`
      : emptyState("No McStars yet", "When your manager recognises your work, it will show up here.")
  }</section>
<section class="pg-card"><div class="pg-card-head"><h2>Quick actions</h2></div><div class="pg-actions">${[
    [url("availability"), "clock", "My availability", "Tell your manager when you can work"],
    [url("schedule"), "calendar", "My shifts", "Week by week, with pay"],
    [url("assistant"), "spark", "Ask McAssist", "Shift prep and help"],
    [url("waste"), "waste", "Waste", "Log today’s waste"],
    ...(role === "crewTrainer"
      ? [[`/verification.html${c.preview ? "?preview=" + c.preview : ""}`, "shield", "Verify crew", "Start a station sign-off"]]
      : [[`/verification.html${c.preview ? "?preview=" + c.preview : ""}`, "shield", "Sign-offs", "Your station verifications"]]),
    [url("training"), "book", "Learning", "Pick up where you left off"],
  ]
    .map(
      ([href, i, title, sub]) =>
        `<a class="pg-action" href="${href}"><span class="pg-action-icon">${ic(i)}</span><b>${title}</b><small>${sub}</small></a>`,
    )
    .join("")}</div></section>
</div></div>`;
}

function timeline(c, shifts, today) {
  // 05:00 today until 05:00 tomorrow covers breakfast through the late close.
  const origin = new Date(`${today}T05:00`);
  const span = 24 * 60;
  const now = new Date();
  const nowPct = ((now - origin) / 60000 / span) * 100;
  const rows = sortShifts(shifts)
    .map((s) => {
      const a = Math.max(0, (shiftStart(s) - origin) / 60000);
      const b = Math.min(span, (shiftEnd(s) - origin) / 60000);
      if (b <= 0 || a >= span) return "";
      const live = shiftStart(s) <= now && now < shiftEnd(s);
      return `<div class="pg-tl-row"><span class="pg-tl-name">${esc(firstName(s.userName))}</span><div class="pg-tl-track"><span class="pg-tl-bar ${live ? "is-live" : ""}" style="${stationStyle(s.station)};left:${((a / span) * 100).toFixed(2)}%;width:${(((b - a) / span) * 100).toFixed(2)}%" title="${esc(s.userName)} · ${esc(s.start)}–${esc(s.end)} · ${esc(s.station || "")}"><b>${esc(s.start)}–${esc(s.end)}</b><span>${esc(s.station || "")}</span></span></div></div>`;
    })
    .join("");
  if (!rows) return emptyState("No shifts today", "Nobody is on the rota today yet.", `<a class="btn soft pg-btn-sm" href="${c.url("manage")}">Plan a shift</a>`);
  const ticks = [6, 9, 12, 15, 18, 21, 0, 3]
    .map((h) => {
      const mins = ((h - 5 + 24) % 24) * 60;
      return `<span style="left:${((mins / span) * 100).toFixed(2)}%">${String(h).padStart(2, "0")}:00</span>`;
    })
    .join("");
  return `<div class="pg-timeline"><div class="pg-tl-ticks" aria-hidden="true">${ticks}</div>${rows}${nowPct > 0 && nowPct < 100 ? `<div class="pg-tl-now" style="left:calc(var(--tl-name) + (100% - var(--tl-name)) * ${(nowPct / 100).toFixed(4)})" aria-hidden="true"><span>Now</span></div>` : ""}</div>`;
}

function managerHome(c) {
  const { state, url } = c;
  const u = state.user;
  const now = new Date();
  const today = isoDate(now);
  const dates = weekDates(0);
  const onNow = sortShifts(
    state.shifts.filter((s) => shiftStart(s) <= now && now < shiftEnd(s)),
  );
  const todayShifts = state.shifts.filter((s) => s.date === today);
  const later = sortShifts(
    state.shifts.filter((s) => shiftStart(s) > now),
  ).slice(0, 4);
  const headcount = new Set(todayShifts.map((s) => s.userId)).size;
  const weekShifts = state.shifts.filter((s) => dates.includes(s.date));
  const weekMinutes = weekShifts.reduce((n, s) => n + shiftMinutes(s), 0);
  let labour = 0,
    unpriced = 0;
  for (const s of weekShifts) {
    const rate = rateOf(state.team.find((m) => m.id === s.userId));
    if (rate) labour += (shiftMinutes(s) / 60) * rate;
    else unpriced++;
  }
  const requests = state.extras?.roleRequests || [];
  const pendingVer = (state.extras?.verifications || []).filter(
    (v) => v.status !== "verified",
  );
  const flags = shiftFlags(
    c,
    weekShifts.filter((s) => shiftEnd(s) > now),
  );
  const waiting = requests.length + pendingVer.length;
  const myNext = c.myShifts().find((s) => shiftEnd(s) > now);
  const learners = sortTeam(activeTeam(state.team))
    .map((m) => ({ m, l: memberLearning(c, m) }))
    .filter((x) => x.l);
  const avg = learners.length
    ? Math.round(learners.reduce((n, x) => n + x.l.pct, 0) / learners.length)
    : null;
  const person = (s, live) =>
    `<li class="pg-glance-row">${avatar(s.userName)}<div class="grow"><b>${esc(s.userName)}</b><small>${esc(s.station || "Station TBC")}</small></div><span class="pg-glance-time ${live ? "is-live" : ""}">${live ? `until ${esc(s.end)}` : s.date === today ? esc(s.start) : `${esc(dayShort(s.date))} ${esc(s.start)}`}</span></li>`;
  return `<div class="pg-page pg-home pg-home-manager">
<section class="pg-hero pg-hero-manager"><div class="pg-hero-top"><div><p class="pg-eyebrow">${esc(dateLong(today))} · ${esc(u.storeName || u.storeId || "")}</p><h1>${greeting(now)}, ${esc(firstName(u.name))}.</h1><p class="pg-hero-sub">${myNext ? (shiftStart(myNext) <= now ? `You’re on shift now until ${esc(myNext.end)} · ${esc(myNext.station || "Station TBC")}` : `Your next shift: ${esc(dateMed(myNext.date))} · ${timeRange(myNext)} · ${esc(myNext.station || "Station TBC")}`) : "Here’s your restaurant today."}</p></div><span class="pg-role-badge">Manager</span></div>
<div class="pg-glance"><div class="pg-glance-col"><h3><span class="pg-live-dot ${onNow.length ? "on" : ""}" aria-hidden="true"></span>On shift now <span class="pg-count">${onNow.length}</span></h3>${onNow.length ? `<ul>${onNow.slice(0, 5).map((s) => person(s, true)).join("")}</ul>${onNow.length > 5 ? `<p class="pg-more">+${onNow.length - 5} more</p>` : ""}` : `<p class="pg-glance-empty">Nobody is on shift right now.</p>`}</div><div class="pg-glance-col"><h3>Coming up next</h3>${later.length ? `<ul>${later.map((s) => person(s, false)).join("")}</ul>` : `<p class="pg-glance-empty">No more shifts planned yet.</p>`}</div></div></section>
<div class="pg-kpis">${kpi("team", String(onNow.length), "On shift now", onNow.length ? esc(onNow.map((s) => firstName(s.userName)).slice(0, 3).join(", ")) : "Quiet right now")}${kpi("calendar", String(todayShifts.length), "Shifts today", `${headcount} ${headcount === 1 ? "person" : "people"} working`)}${kpi("clock", durationLabel(weekMinutes), "Team hours this week", labour ? `≈ ${money(labour)} labour${unpriced ? ` (+${unpriced} unpriced)` : ""}` : "Set pay rates to estimate labour")}${kpi("alert", String(waiting), "Waiting on you", waiting ? `${requests.length} role request${requests.length === 1 ? "" : "s"} · ${pendingVer.length} sign-off${pendingVer.length === 1 ? "" : "s"}` : "All clear", waiting ? "is-attention" : "")}</div>
<section class="pg-card pg-today"><div class="pg-card-head"><div><h2>Today’s rota</h2><p class="pg-muted">${todayShifts.length} shift${todayShifts.length === 1 ? "" : "s"} · ${esc(dateMed(today))}</p></div><a class="pg-link" href="${url("schedule")}">Team rota ${ic("arrow")}</a></div>${timeline(c, state.shifts.filter((s) => s.date === today || (s.date === addDays(today, -1) && shiftEnd(s) > new Date(`${today}T05:00`))), today)}</section>
<div class="pg-grid-2">
<section class="pg-card"><div class="pg-card-head"><h2>Needs your attention</h2>${waiting ? `<span class="pg-pill warn">${waiting} waiting</span>` : ""}</div>${
    requests.length || pendingVer.length || flags.size
      ? `<ul class="pg-list">${requests
          .map(
            (r) =>
              `<li class="pg-list-row">${avatar(r.name)}<div class="grow"><b>${esc(r.name || r.email || "Team member")}</b><small>Requested ${esc(roleLabel(r.requestedRole))} access</small></div><div class="pg-row-actions"><button type="button" class="btn light pg-btn-sm" data-role-reject="${esc(r.uid || r.id)}" aria-label="Reject ${esc(r.name || "request")}">Reject</button><button type="button" class="btn pg-btn-sm" data-role-approve="${esc(r.uid || r.id)}" aria-label="Approve ${esc(r.name || "request")}">Approve</button></div></li>`,
          )
          .join("")}${pendingVer
          .slice(0, 4)
          .map(
            (v) =>
              `<li class="pg-list-row"><span class="pg-list-icon">${ic("shield")}</span><div class="grow"><b>${esc(v.crewName)} · ${esc(v.station)}</b><small>${v.trainerSignature ? `Waiting for ${esc(firstName(v.crewName))} to sign` : `Waiting for ${esc(v.trainerName || "the Crew Trainer")}`}</small></div><a class="pg-link" href="/verification.html?id=${encodeURIComponent(v.id)}${c.preview ? "&preview=" + c.preview : ""}">Open</a></li>`,
          )
          .join("")}${
          flags.size
            ? `<li class="pg-list-row"><span class="pg-list-icon warn">${ic("alert")}</span><div class="grow"><b>${flags.size} shift${flags.size === 1 ? "" : "s"} this week need a look</b><small>${esc([...flags.values()][0][0])}</small></div><a class="pg-link" href="${url("manage")}">Review</a></li>`
            : ""
        }</ul>`
      : `<div class="pg-allclear">${ic("check")}<div><b>All clear</b><p class="pg-muted">No approvals, sign-offs or rota issues waiting.</p></div></div>`
  }</section>
<section class="pg-card"><div class="pg-card-head"><h2>Team learning</h2><a class="pg-link" href="${url("team")}">My team ${ic("arrow")}</a></div>${
    learners.length
      ? `<div class="pg-learn-row">${pctRing(avg, `Team average ${avg}%`)}<div class="grow"><b>Team average ${avg}%</b><p class="pg-muted">${learners.filter((x) => x.l.pct === 100).length} fully trained · ${learners.filter((x) => x.l.pct < 40).length} need support</p></div></div><ul class="pg-learn-list">${learners
          .sort((a, b) => a.l.pct - b.l.pct)
          .slice(0, 5)
          .map(
            (x) =>
              `<li><button type="button" class="pg-learn-member" data-member="${esc(x.m.id)}">${avatar(x.m.name, "sm")}<span class="grow"><b>${esc(x.m.name)}</b>${bar(x.l.pct, `${x.m.name} learning progress`)}</span><span class="pg-pct">${x.l.pct}%</span></button></li>`,
          )
          .join("")}</ul>`
      : emptyState("Learning data on its way", "Team progress appears once your team data has loaded.")
  }</section>
</div>
<section class="pg-card"><div class="pg-card-head"><h2>Quick actions</h2></div><div class="pg-actions pg-actions-6">${[
    [url("manage"), "plus", "Plan a shift", "Week grid with availability"],
    [url("assistant"), "spark", "Open McAssist", "Ask it to plan or update"],
    [url("team"), "team", "My team", "Profiles, pay and McStars"],
    [url("schedule"), "calendar", "Team rota", "Print-ready weekly rota"],
    [`/verification.html${c.preview ? "?preview=" + c.preview : ""}`, "shield", "Verifications", "Station sign-offs"],
    [url("waste"), "waste", "Waste", "Today’s waste log"],
  ]
    .map(
      ([href, i, title, sub]) =>
        `<a class="pg-action" href="${href}"><span class="pg-action-icon">${ic(i)}</span><b>${title}</b><small>${sub}</small></a>`,
    )
    .join("")}</div></section>
</div>`;
}

// --------------------------------------------------------------- schedule --
export function scheduleView(c) {
  const { state } = c;
  const dates = weekDates(state.offset || 0);
  const manager = c.isManager();
  const teamMode = manager && state.ui.scheduleMode !== "mine";
  const actions = `${manager ? `<div class="segmented pg-segment" role="group" aria-label="Rota view"><button type="button" data-schedule-mode="team" aria-pressed="${teamMode}">Team rota</button><button type="button" data-schedule-mode="mine" aria-pressed="${!teamMode}">My shifts</button></div>` : ""}<button type="button" class="btn light pg-btn-sm" data-print>${ic("print")}Print</button>${manager ? `<a class="btn pg-btn-sm" href="${c.url("manage", state.offset ? { week: state.offset } : {})}">${ic("plus")}Plan shifts</a>` : ""}`;
  const head = pageHead(
    esc(state.user.storeName || state.user.storeId || "Your restaurant"),
    teamMode ? "Team rota" : "Your shifts",
    teamMode
      ? "Who’s in, where they’re working and how the week is covered."
      : "Your week at a glance, with hours and estimated pay.",
    actions,
  );
  const printHead = `<div class="pg-print-head"><b>${esc(state.user.storeName || state.user.storeId || "")} · ${teamMode ? "Team rota" : esc(state.user.name)}</b><span>${esc(weekRangeLabel(dates))} ${esc(fmt(dates[6], { year: "numeric" }))}</span></div>`;
  return `<div class="pg-page pg-schedule">${head}<div class="pg-toolbar">${weekNav(c, dates)}</div>${printHead}${teamMode ? teamRota(c, dates) : crewAgenda(c, dates)}${
    teamMode
      ? ""
      : `<section class="pg-card pg-callout pg-no-print"><div>${ic("clock")}</div><div class="grow"><h3>Plans changed?</h3><p class="pg-muted">Keep your availability up to date and talk to your manager about swaps.</p></div><a class="btn light" href="${c.url("availability")}">Update availability</a></section>`
  }</div>`;
}

function crewAgenda(c, dates) {
  const { state } = c;
  const today = isoDate();
  const mine = c.myShifts().filter((s) => dates.includes(s.date));
  const minutes = mine.reduce((n, s) => n + shiftMinutes(s), 0);
  const rate = rateOf(state.user);
  const days = dates
    .map((d) => {
      const list = sortShifts(mine.filter((s) => s.date === d));
      return `<li class="pg-agenda-day ${d === today ? "is-today" : ""} ${d < today ? "is-past" : ""}"><div class="pg-agenda-date"><span>${esc(dayShort(d))}</span><b>${esc(dayNum(d))}</b>${d === today ? '<em>Today</em>' : ""}</div><div class="pg-agenda-items">${
        list.length
          ? list
              .map(
                (s) =>
                  `<article class="pg-agenda-shift" style="${stationStyle(s.station)}"><div class="grow"><b>${timeRange(s)}</b><small>${esc(s.station || "Station TBC")} · ${durationLabel(shiftMinutes(s))} paid${Number(s.breakMinutes) ? ` · ${Number(s.breakMinutes)} min break` : ""}</small></div>${rate ? `<span class="pg-amount">${money((shiftMinutes(s) / 60) * rate)}</span>` : ""}</article>`,
              )
              .join("")
          : `<span class="pg-agenda-off">${d < today ? "No shift" : "Day off"}</span>`
      }</div></li>`;
    })
    .join("");
  return `<div class="pg-kpis pg-kpis-3">${kpi("calendar", String(mine.length), "Shifts", esc(weekRangeLabel(dates)))}${kpi("clock", durationLabel(minutes), "Paid hours", "After unpaid breaks")}${kpi("wallet", rate ? money((minutes / 60) * rate) : "—", "Est. gross pay", rate ? `${money(rate)}/h · before tax` : "Hourly rate not set")}</div><section class="pg-card pg-agenda-card">${
    state.loaded || mine.length
      ? `<ol class="pg-agenda">${days}</ol>`
      : `<div class="pg-loading" role="status"><span class="pg-spinner" aria-hidden="true"></span>Loading your shifts…</div>`
  }</section>`;
}

function teamRota(c, dates) {
  const { state } = c;
  const today = isoDate();
  const shifts = state.shifts.filter((s) => dates.includes(s.date));
  const members = rotaMembers(state.team, shifts);
  const selected = dates.includes(state.selected) ? state.selected : dates.includes(today) ? today : dates[0];
  const byCell = (id, d) => sortShifts(shifts.filter((s) => s.userId === id && s.date === d));
  const rows = members
    .map((m) => {
      const own = shifts.filter((s) => s.userId === m.id);
      const mins = own.reduce((n, s) => n + shiftMinutes(s), 0);
      return `<tr><th scope="row"><div class="pg-rota-member">${avatar(m.name, "sm")}<span><b>${esc(m.name)}</b><small>${esc(roleLabel(m.role))}</small></span></div></th>${dates
        .map((d) => {
          const list = byCell(m.id, d);
          return `<td class="${d === today ? "is-today" : ""} ${d === selected ? "is-selected" : ""}">${list.length ? list.map((s) => shiftChip(s, { editable: true })).join("") : '<span class="pg-rota-off" aria-label="No shift">·</span>'}</td>`;
        })
        .join("")}<td class="pg-rota-total">${mins ? durationLabel(mins) : "—"}</td></tr>`;
    })
    .join("");
  const foot = dates
    .map((d) => {
      const list = shifts.filter((s) => s.date === d);
      return `<td><b>${new Set(list.map((s) => s.userId)).size}</b> on · ${durationLabel(list.reduce((n, s) => n + shiftMinutes(s), 0))}</td>`;
    })
    .join("");
  const total = shifts.reduce((n, s) => n + shiftMinutes(s), 0);
  const table = members.length
    ? `<div class="pg-rota-scroll" data-keep-scroll="rota"><table class="pg-rota"><caption class="sr-only">Team rota for ${esc(weekRangeLabel(dates))}</caption><thead><tr><th scope="col">Team member</th>${dates
        .map(
          (d) =>
            `<th scope="col" class="${d === today ? "is-today" : ""} ${d === selected ? "is-selected" : ""}"><button type="button" data-select-day="${d}" aria-pressed="${d === selected}" aria-label="Show ${esc(dateLong(d))}"><span>${esc(dayShort(d))}</span><b>${esc(dayNum(d))}</b></button></th>`,
        )
        .join("")}<th scope="col">Hours</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><th scope="row">Cover</th>${foot}<td class="pg-rota-total"><b>${durationLabel(total)}</b></td></tr></tfoot></table></div>`
    : emptyState("No team members yet", "Team members appear here once they join your store.");
  const strip = `<div class="pg-daystrip pg-only-mobile" role="group" aria-label="Choose a day">${dates
    .map((d) => {
      const n = new Set(shifts.filter((s) => s.date === d).map((s) => s.userId)).size;
      return `<button type="button" data-select-day="${d}" aria-pressed="${d === selected}" class="${d === today ? "is-today" : ""}"><span>${esc(dayShort(d))}</span><b>${esc(dayNum(d))}</b><i>${n || ""}</i></button>`;
    })
    .join("")}</div>`;
  const dayList = sortShifts(shifts.filter((s) => s.date === selected));
  const detail = `<section class="pg-card pg-day-detail" aria-labelledby="pgDayTitle"><div class="pg-card-head"><div><h2 id="pgDayTitle">${esc(dateLong(selected))}</h2><p class="pg-muted">${dayList.length} shift${dayList.length === 1 ? "" : "s"} · ${new Set(dayList.map((s) => s.userId)).size} people · ${durationLabel(dayList.reduce((n, s) => n + shiftMinutes(s), 0))}</p></div><a class="btn soft pg-btn-sm pg-no-print" href="${c.url("manage", { date: selected, ...(state.offset ? { week: state.offset } : {}) })}">${ic("plus")}Add shift</a></div>${
    dayList.length
      ? `<ul class="pg-list">${dayList
          .map(
            (s) =>
              `<li class="pg-list-row">${avatar(s.userName)}<div class="grow"><b>${esc(s.userName)}</b><small><span class="pg-station-tag" style="${stationStyle(s.station)}">${esc(s.station || "Station TBC")}</span> ${durationLabel(shiftMinutes(s))} paid</small></div><button type="button" class="pg-time-btn" data-shift="${esc(s.id)}" aria-label="Edit ${esc(s.userName)}’s shift">${timeRange(s)}${ic("edit")}</button></li>`,
          )
          .join("")}</ul>`
      : emptyState("Nobody scheduled", "No shifts planned for this day yet.")
  }</section>`;
  return `<section class="pg-card pg-rota-card pg-only-desktop">${table}</section>${strip}${detail}`;
}

// ---------------------------------------------------------------- planner --
export function plannerView(c) {
  const { state } = c;
  if (!c.isManager())
    return `<div class="pg-page">${pageHead("Shift planner", "Managers only", "Shift planning is available to managers. You can see your own rota in My shifts.", `<a class="btn" href="${c.url("schedule")}">My shifts</a>`)}</div>`;
  const dates = weekDates(state.offset || 0);
  const today = isoDate();
  const shifts = state.shifts.filter((s) => dates.includes(s.date));
  const members = rotaMembers(state.team, shifts);
  const flags = shiftFlags(c, shifts.filter((s) => s.date >= today));
  const selected = dates.includes(state.selected) ? state.selected : dates.includes(today) ? today : dates[0];
  const lastWeek = weekDates((state.offset || 0) - 1);
  const lastWeekCount = state.shifts.filter((s) => lastWeek.includes(s.date)).length;
  const avText = (a) =>
    a.status === "on"
      ? a.windows.map((w) => `${w.start}–${w.end}`).join(", ")
      : a.status === "off"
        ? "Unavailable"
        : "Not set";
  const cell = (m, d) => {
    const a = availabilityFor(m.availability, d);
    const list = sortShifts(shifts.filter((s) => s.userId === m.id && s.date === d));
    const past = d < today;
    return `<div class="pg-pl-cell av-${a.status} ${past ? "is-past" : ""} ${d === today ? "is-today" : ""}" role="cell"><span class="pg-pl-av">${esc(avText(a)).replace(/–/g, "–<wbr>")}</span>${list.map((s) => shiftChip(s, { editable: true, flag: flags.has(s.id) })).join("")}${past || m.missing ? "" : `<button type="button" class="pg-pl-add" data-add-shift data-member="${esc(m.id)}" data-date="${d}" aria-label="Add shift for ${esc(m.name)} on ${esc(dateMed(d))}">${ic("plus")}</button>`}</div>`;
  };
  const grid = `<div class="pg-planner-scroll" data-keep-scroll="planner"><div class="pg-planner" role="table" aria-label="Shift planner for ${esc(weekRangeLabel(dates))}"><div class="pg-pl-row pg-pl-headrow" role="row"><div class="pg-pl-corner" role="columnheader">Team member</div>${dates
    .map((d) => {
      const n = new Set(shifts.filter((s) => s.date === d).map((s) => s.userId)).size;
      return `<div class="pg-pl-day ${d === today ? "is-today" : ""}" role="columnheader"><span>${esc(dayShort(d))}</span><b>${esc(dayNum(d))}</b><small>${n} on</small></div>`;
    })
    .join("")}<div class="pg-pl-total" role="columnheader">Week</div></div>${members
    .map((m) => {
      const own = shifts.filter((s) => s.userId === m.id);
      const mins = own.reduce((n, s) => n + shiftMinutes(s), 0);
      const rate = rateOf(m);
      return `<div class="pg-pl-row" role="row"><div class="pg-pl-member" role="rowheader">${avatar(m.name, "sm")}<span><b>${esc(m.name)}</b><small>${esc(roleLabel(m.role))}${m.missing ? " · left team" : ""}</small></span></div>${dates.map((d) => cell(m, d)).join("")}<div class="pg-pl-total" role="cell"><b>${mins ? durationLabel(mins) : "—"}</b>${rate && mins ? `<small>${money((mins / 60) * rate)}</small>` : ""}</div></div>`;
    })
    .join("")}</div></div>`;
  const strip = `<div class="pg-daystrip" role="group" aria-label="Choose a day">${dates
    .map((d) => {
      const n = new Set(shifts.filter((s) => s.date === d).map((s) => s.userId)).size;
      return `<button type="button" data-select-day="${d}" aria-pressed="${d === selected}" class="${d === today ? "is-today" : ""}"><span>${esc(dayShort(d))}</span><b>${esc(dayNum(d))}</b><i>${n || ""}</i></button>`;
    })
    .join("")}</div>`;
  const dayRows = members
    .map((m) => {
      const a = availabilityFor(m.availability, selected);
      const list = sortShifts(shifts.filter((s) => s.userId === m.id && s.date === selected));
      return `<li class="pg-pl-dayrow av-${a.status}">${avatar(m.name, "sm")}<div class="grow"><b>${esc(m.name)}</b><small class="pg-pl-av">${esc(avText(a))}</small>${list.length ? `<div class="pg-pl-dayshifts">${list.map((s) => shiftChip(s, { editable: true, flag: flags.has(s.id) })).join("")}</div>` : ""}</div>${selected < today || m.missing ? "" : `<button type="button" class="pg-iconbtn" data-add-shift data-member="${esc(m.id)}" data-date="${selected}" aria-label="Add shift for ${esc(m.name)} on ${esc(dateMed(selected))}">${ic("plus")}</button>`}</li>`;
    })
    .join("");
  const weekMins = shifts.reduce((n, s) => n + shiftMinutes(s), 0);
  const health = flags.size
    ? `<ul class="pg-list">${[...flags.entries()]
        .map(([id, issues]) => {
          const s = shifts.find((x) => x.id === id);
          return `<li class="pg-list-row"><span class="pg-list-icon warn">${ic("alert")}</span><div class="grow"><b>${esc(s.userName)} · ${esc(dateMed(s.date))} ${timeRange(s)}</b><small>${esc(issues.join(" "))}</small></div><button type="button" class="btn light pg-btn-sm" data-shift="${esc(id)}">Review</button></li>`;
        })
        .join("")}</ul>`
    : `<div class="pg-allclear">${ic("check")}<div><b>Looking good</b><p class="pg-muted">No clashes, availability or rest issues in the upcoming shifts this week.</p></div></div>`;
  return `<div class="pg-page pg-planner-page">${pageHead(
    "Manager tools",
    "Shift planner",
    "Tap an open slot to add a shift. Availability is shaded so you can plan with confidence.",
    `<button type="button" class="btn light pg-btn-sm" data-copy-week ${lastWeekCount ? "" : "disabled"} title="${lastWeekCount ? "" : "No shifts last week"}">${ic("copy")}Copy last week</button><button type="button" class="btn pg-btn-sm" data-add-shift>${ic("plus")}Add shift</button>`,
  )}<div class="pg-toolbar">${weekNav(c, dates)}<div class="pg-legend" aria-label="Legend"><span><i class="lg-on"></i>Available</span><span><i class="lg-off"></i>Unavailable</span><span><i class="lg-unset"></i>Not set</span><span><i class="lg-flag">!</i>Needs a look</span></div></div><div class="pg-planner-stats"><span><b>${shifts.length}</b> shifts</span><span><b>${durationLabel(weekMins)}</b> scheduled</span><span><b>${new Set(shifts.map((s) => s.userId)).size}</b> of ${members.length} people</span></div><section class="pg-card pg-planner-card pg-only-desktop">${members.length ? grid : state.teamLoaded ? emptyState("No team yet", "Team members appear here once they join your store.") : `<div class="pg-loading" role="status"><span class="pg-spinner" aria-hidden="true"></span>Loading your team…</div>`}</section><div class="pg-only-mobile">${strip}<section class="pg-card pg-pl-day-card"><div class="pg-card-head"><h2>${esc(dateLong(selected))}</h2><span class="pg-pill">${sortShifts(shifts.filter((s) => s.date === selected)).length} shifts</span></div><ul class="pg-pl-daylist">${dayRows}</ul></section></div><section class="pg-card" aria-labelledby="pgHealthTitle"><div class="pg-card-head"><h2 id="pgHealthTitle">Week check</h2>${flags.size ? `<span class="pg-pill warn">${flags.size} to review</span>` : '<span class="pg-pill ok">All clear</span>'}</div>${health}</section></div>`;
}

// ------------------------------------------------------------------- team --
export function teamView(c) {
  const { state } = c;
  if (!c.isManager())
    return `<div class="pg-page">${pageHead("Team", "Managers only", "The team page is available to managers.", `<a class="btn" href="${c.url("home")}">Back home</a>`)}</div>`;
  const team = sortTeam(activeTeam(state.team));
  const inactive = sortTeam((state.team || []).filter(isInactive));
  const q = String(state.ui.teamQuery || "").toLowerCase();
  const roleFilter = state.ui.teamRole || "";
  const requests = state.extras?.roleRequests || [];
  const now = new Date();
  const cards = team
    .map((m) => {
      const role = normaliseRole(m.role);
      const l = memberLearning(c, m);
      const next = c.state.shifts
        .filter((s) => s.userId === m.id && shiftEnd(s) > now)
        .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))[0];
      const stations = Array.isArray(m.verifiedStations) ? m.verifiedStations : [];
      const search = [m.name, m.email, roleLabel(role), m.badge, ...stations].join(" ").toLowerCase();
      const hidden = (q && !search.includes(q)) || (roleFilter && roleFilter !== role);
      return `<li${hidden ? " hidden" : ""} data-search="${esc(search)}" data-role="${role}"><button type="button" class="pg-member" data-member="${esc(m.id)}" aria-label="Open ${esc(m.name || "team member")}">${avatar(m.name, "lg")}<span class="pg-member-main"><b>${esc(m.name || "Team member")}${m.id === state.user.id ? ' <small class="pg-you">You</small>' : ""}</b><span class="pg-role r-${role}">${esc(roleLabel(role))}</span>${m.roleRequestStatus === "pending" && m.requestedRole ? `<span class="pg-role r-pending">Requested ${esc(roleLabel(m.requestedRole))}</span>` : ""}</span><span class="pg-member-stats"><span title="McStars">★ ${Number(m.stars) || 0}</span><span>${l ? `${l.pct}% learning` : "Learning —"}</span><span>${stations.length} station${stations.length === 1 ? "" : "s"}</span></span><span class="pg-member-next">${ic("calendar")}${next ? `${esc(dateMed(next.date))} · ${esc(next.start)}–${esc(next.end)}` : "No upcoming shifts"}</span></button></li>`;
    })
    .join("");
  const visibleCount = team.filter((m) => {
    const role = normaliseRole(m.role);
    const search = [m.name, m.email, roleLabel(role), m.badge, ...(m.verifiedStations || [])].join(" ").toLowerCase();
    return !((q && !search.includes(q)) || (roleFilter && roleFilter !== role));
  }).length;
  const counts = { crew: 0, crewTrainer: 0, manager: 0 };
  team.forEach((m) => counts[normaliseRole(m.role)]++);
  return `<div class="pg-page pg-team">${pageHead(
    esc(state.user.storeName || state.user.storeId || "Your restaurant"),
    "Your team",
    `${team.length} people · ${counts.manager} manager${counts.manager === 1 ? "" : "s"} · ${counts.crewTrainer} Crew Trainer${counts.crewTrainer === 1 ? "" : "s"} · ${counts.crew} Crew Member${counts.crew === 1 ? "" : "s"}`,
    `<a class="btn pg-btn-sm" href="${c.url("manage")}">${ic("plus")}Plan a shift</a>`,
  )}${
    requests.length
      ? `<section class="pg-card pg-requests" aria-labelledby="pgRequestsTitle"><div class="pg-card-head"><div><h2 id="pgRequestsTitle">Role requests</h2><p class="pg-muted">Approve Crew Trainer or Manager access for people in your store.</p></div><span class="pg-pill warn">${requests.length} pending</span></div><ul class="pg-list">${requests
          .map(
            (r) =>
              `<li class="pg-list-row">${avatar(r.name)}<div class="grow"><b>${esc(r.name || r.email || "Team member")}</b><small>Requested ${esc(roleLabel(r.requestedRole))}${r.createdAt ? " · " + esc(timeAgo(r.createdAt)) : ""}</small></div><div class="pg-row-actions"><button type="button" class="btn light pg-btn-sm" data-role-reject="${esc(r.uid || r.id)}" aria-label="Reject ${esc(r.name || "request")}">Reject</button><button type="button" class="btn pg-btn-sm" data-role-approve="${esc(r.uid || r.id)}" aria-label="Approve ${esc(r.name || "request")}">Approve</button></div></li>`,
          )
          .join("")}</ul></section>`
      : ""
  }<div class="pg-filterbar" role="search"><label class="pg-search">${ic("search")}<span class="sr-only">Search team</span><input id="teamSearch" type="search" placeholder="Search by name, role or station" autocomplete="off" value="${esc(state.ui.teamQuery || "")}"></label><label class="pg-select"><span class="sr-only">Filter by role</span><select id="teamRole">${[
    ["", "All roles"],
    ["crew", "Crew Members"],
    ["crewTrainer", "Crew Trainers"],
    ["manager", "Managers"],
  ]
    .map(([v, t]) => `<option value="${v}" ${roleFilter === v ? "selected" : ""}>${t}</option>`)
    .join("")}</select></label><span class="pg-muted" id="teamCount" role="status">${visibleCount} of ${team.length}</span></div>${
    team.length
      ? `<ul class="pg-team-grid" id="teamGrid">${cards}</ul><div class="pg-empty" id="teamEmpty" ${visibleCount ? "hidden" : ""}><h3>No one matches</h3><p>Try another name or clear the filters.</p><button type="button" class="btn light" data-team-reset>Clear filters</button></div>`
      : state.teamLoaded
        ? emptyState("No team members yet", "Team members must belong to the same store ID.")
        : `<div class="pg-loading" role="status"><span class="pg-spinner" aria-hidden="true"></span>Loading your team…</div>`
  }${
    inactive.length
      ? `<details class="pg-card pg-inactive"><summary><b>Deactivated accounts</b><span class="pg-pill">${inactive.length}</span></summary><ul class="pg-list">${inactive
          .map(
            (m) =>
              `<li class="pg-list-row">${avatar(m.name)}<div class="grow"><b>${esc(m.name || "Team member")}</b><small>${esc(roleLabel(m.role))} · deactivated · no access until reactivated</small></div><button type="button" class="btn light pg-btn-sm" data-member="${esc(m.id)}">View</button></li>`,
          )
          .join("")}</ul><p class="pg-muted">Ask McAssist to reactivate someone, for example “Reactivate ${esc(firstName(inactive[0].name))}’s account”.</p></details>`
      : ""
  }</div>`;
}

/** Body of the member drawer (rendered into the pages sheet). */
export function memberDrawer(c, m) {
  const { state } = c;
  const role = normaliseRole(m.role);
  const self = m.id === state.user.id;
  const l = memberLearning(c, m);
  const now = new Date();
  const upcoming = sortShifts(
    state.shifts.filter((s) => s.userId === m.id && shiftEnd(s) > now),
  ).slice(0, 5);
  const week = weekDates(0);
  const weekMins = state.shifts
    .filter((s) => s.userId === m.id && week.includes(s.date))
    .reduce((n, s) => n + shiftMinutes(s), 0);
  const av = normaliseAvailability(m.availability);
  const stations = Array.isArray(m.verifiedStations) ? m.verifiedStations : [];
  const recognition = (state.extras?.recognition || [])
    .filter((r) => r.userId === m.id)
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
    .slice(0, 4);
  const rate = rateOf(m);
  const dayNames = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
  return `<div class="pg-drawer">
<div class="pg-drawer-top">${avatar(m.name, "xl")}<div><span class="pg-role r-${role}">${esc(roleLabel(role))}</span>${isInactive(m) ? ' <span class="pg-role r-pending">Deactivated</span>' : ""}${m.roleRequestStatus === "pending" && m.requestedRole ? ` <span class="pg-role r-pending">Requested ${esc(roleLabel(m.requestedRole))}</span>` : ""}<p class="pg-muted">${esc(m.email || "")}${m.badge ? `${m.email ? " · " : ""}${esc(m.badge)}` : ""}</p></div></div>
<div class="pg-drawer-stats"><div><b>${Number(m.stars) || 0}<span class="pg-star">★</span></b><small>McStars</small></div><div><b>${l ? l.pct + "%" : "—"}</b><small>Learning</small></div><div><b>${stations.length}</b><small>Stations</small></div><div><b>${durationLabel(weekMins)}</b><small>This week</small></div></div>
<section class="pg-drawer-sec"><h3>Upcoming shifts</h3>${
    upcoming.length
      ? `<ul class="pg-list pg-list-tight">${upcoming.map((s) => `<li class="pg-list-row"><div class="pg-mini-date"><span>${esc(dayShort(s.date))}</span><b>${esc(dayNum(s.date))}</b></div><div class="grow"><b>${timeRange(s)}</b><small>${esc(s.station || "Station TBC")} · ${durationLabel(shiftMinutes(s))}</small></div></li>`).join("")}</ul>`
      : '<p class="pg-muted">No upcoming shifts.</p>'
  }${m.missing || isInactive(m) ? "" : `<a class="btn soft pg-btn-sm" href="${c.url("manage", { member: m.id })}">${ic("plus")}Plan a shift</a>`}</section>
<section class="pg-drawer-sec"><h3>Availability</h3><ul class="pg-avail-mini">${DAY_KEYS.map((k) => {
    const d = av[k];
    return `<li class="${d ? (d.available ? "on" : "off") : "unset"}"><span>${dayNames[k]}</span><b>${d ? (d.available ? `${esc(d.start)}–${esc(d.end)}` : "Off") : "Not set"}</b></li>`;
  }).join("")}</ul></section>
<section class="pg-drawer-sec"><h3>Station sign-offs</h3><div class="pg-station-chips">${VERIFY_STATIONS.map((s) => `<span class="pg-station-tag ${stations.includes(s) ? "" : "is-muted"}" style="${stationStyle(s)}">${stations.includes(s) ? ic("check") : ""}${esc(s)}</span>`).join("")}</div>${l ? `<div class="pg-subhead">Learning · ${l.completed} of ${l.total} modules</div>${bar(l.pct, "Learning progress")}` : ""}</section>
<section class="pg-drawer-sec"><h3>Recent recognition</h3>${
    recognition.length
      ? `<ul class="pg-list pg-list-tight">${recognition.map((r) => `<li class="pg-list-row"><span class="pg-star-badge">+${Number(r.amount) || 0}</span><div class="grow"><b>${esc(r.note || "Great work")}</b><small>${esc(r.createdByName || "Manager")}${r.createdAt ? " · " + esc(timeAgo(r.createdAt)) : ""}</small></div></li>`).join("")}</ul>`
      : '<p class="pg-muted">No McStars recorded yet.</p>'
  }</section>
${
  m.missing
    ? '<p class="pg-muted">This person is no longer in your store’s team list.</p>'
    : isInactive(m)
      ? '<section class="pg-drawer-sec"><h3>Account deactivated</h3><p class="pg-muted">This account can’t sign in or be given shifts. Ask McAssist to reactivate it if they are coming back.</p></section>'
      : self
      ? `<section class="pg-drawer-sec"><h3>Pay and notes</h3><p class="pg-muted">Your hourly rate is ${rate ? money(rate) : "not set"}. Another manager looks after your own pay rate and McStars.</p></section>`
      : `<form class="pg-drawer-sec" id="pgMemberForm" novalidate><h3>Manager details</h3><div class="pg-form-grid"><label class="pg-field"><span>Hourly rate (£)</span><input name="hourlyRate" type="number" inputmode="decimal" min="0" max="100" step="0.01" placeholder="Not set" value="${rate ? rate.toFixed(2) : ""}"></label><label class="pg-field"><span>Badge</span><input name="badge" maxlength="60" placeholder="e.g. Drive-thru star" value="${esc(m.badge || "")}"></label><label class="pg-field pg-span-2"><span>Manager notes</span><textarea name="notes" rows="3" maxlength="1000" placeholder="Private notes for managers">${esc(m.notes || "")}</textarea></label></div><div class="pg-form-foot"><span class="pg-form-status" id="pgMemberStatus" role="status"></span><button type="submit" class="btn" id="pgMemberSave" disabled>Save changes</button></div></form>
<form class="pg-drawer-sec pg-stars-form" id="pgStarsForm" novalidate><h3>Give McStars</h3><div class="pg-amounts" role="radiogroup" aria-label="How many McStars">${[1, 2, 3, 5].map((n) => `<label><input type="radio" name="amount" value="${n}" ${n === 1 ? "checked" : ""}><span>+${n} ★</span></label>`).join("")}</div><label class="pg-field"><span>What did they do well?</span><input name="note" maxlength="200" required placeholder="e.g. Stayed calm during the lunch rush"></label><div class="pg-form-foot"><span class="pg-form-status" id="pgStarsStatus" role="status"></span><button type="submit" class="btn" id="pgStarsSave">${ic("star")}Give McStars</button></div></form>`
}
</div>`;
}

// ----------------------------------------------------------- availability --
export const AVAILABILITY_PRESETS = {
  weekdays: { label: "Weekdays 9–5", days: ["mon", "tue", "wed", "thu", "fri"], start: "09:00", end: "17:00" },
  evenings: { label: "Evenings 5–11", days: DAY_KEYS, start: "17:00", end: "23:00" },
  weekends: { label: "Weekends", days: ["sat", "sun"], start: "09:00", end: "23:00" },
  anytime: { label: "Any time", days: DAY_KEYS, start: "06:00", end: "00:00" },
};
const DAY_LONG = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };
export function availabilityView(c) {
  const { state } = c;
  const draft = state.ui.availabilityDraft || normaliseAvailability(state.user.availability);
  const rows = DAY_KEYS.map((k) => {
    const d = draft[k];
    const on = Boolean(d?.available);
    const start = validTime(d?.start) ? d.start : "09:00";
    const end = validTime(d?.end) ? d.end : "17:00";
    return `<div class="pg-avail-row ${on ? "" : "is-off"}" data-day="${k}"><label class="pg-switch"><input type="checkbox" class="switch" name="${k}" ${on ? "checked" : ""} aria-label="Available on ${DAY_LONG[k]}"><b>${DAY_LONG[k]}</b></label><div class="pg-avail-times"><label><span class="sr-only">${DAY_LONG[k]} start time</span><input type="time" name="${k}Start" value="${esc(start)}" step="900" ${on ? "" : "disabled"}></label><span class="pg-avail-to" aria-hidden="true">to</span><label><span class="sr-only">${DAY_LONG[k]} finish time</span><input type="time" name="${k}End" value="${esc(end)}" step="900" ${on ? "" : "disabled"}></label><small class="pg-avail-note" data-note="${k}"></small></div><span class="pg-avail-offtext">${d ? "Not available" : "Not set yet"}</span></div>`;
  }).join("");
  return `<div class="pg-page pg-availability">${pageHead(
    "Your week",
    "Your availability",
    "Let your manager know when you can work. This does not change shifts that are already published.",
  )}<form id="availabilityForm" class="pg-card pg-avail" novalidate><div class="pg-presets" role="group" aria-label="Quick presets">${Object.entries(AVAILABILITY_PRESETS)
    .map(([key, p]) => `<button type="button" class="pg-chip" data-preset="${key}">${esc(p.label)}</button>`)
    .join("")}<button type="button" class="pg-chip pg-chip-quiet" data-preset="clear">Clear all</button></div><div class="pg-avail-rows">${rows}</div><div class="pg-avail-summary" id="availSummary" aria-live="polite"></div><div id="availabilityResult" role="status"></div><div class="pg-savebar ${state.ui.availabilityDirty ? "is-dirty" : ""}" id="availSavebar"><span class="pg-savebar-text">${ic("alert")}<span>You have unsaved changes</span></span><span class="pg-savebar-saved">${ic("check")}<span>Saved and shared with your manager</span></span><button type="button" class="btn light" data-avail-discard>Discard</button><button type="submit" class="btn" id="availSave">Save availability</button></div></form><p class="pg-footnote pg-muted">Overnight windows are fine: a finish time earlier than the start means you can work past midnight.</p></div>`;
}

// ---------------------------------------------------------------- McStars --
export function rewardsView(c) {
  const { state, url } = c;
  const u = state.user;
  const manager = c.isManager();
  const stars = Number(u.stars) || 0;
  const mine = (state.extras?.recognition || [])
    .filter((r) => r.userId === u.id)
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  const ranked = sortTeam(activeTeam(state.team)).sort(
    (a, b) => (Number(b.stars) || 0) - (Number(a.stars) || 0),
  );
  const rank = ranked.findIndex((m) => m.id === u.id) + 1;
  const top = ranked.length ? Number(ranked[0].stars) || 1 : 1;
  const teamRecent = (state.extras?.recognition || [])
    .slice()
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
    .slice(0, 6);
  const thisMonth = mine
    .filter((r) => Number(r.createdAt) > Date.now() - 30 * 864e5)
    .reduce((n, r) => n + (Number(r.amount) || 0), 0);
  const history = mine.length
    ? `<ul class="pg-list">${mine
        .map(
          (r) =>
            `<li class="pg-list-row"><span class="pg-star-badge ${Number(r.amount) < 0 ? "neg" : ""}">${Number(r.amount) > 0 ? "+" : ""}${Number(r.amount) || 0}</span><div class="grow"><b>${esc(r.note || "Recognised for great work")}</b><small>${esc(r.createdByName ? "From " + r.createdByName : "From your manager")}${r.createdAt ? " · " + esc(timeAgo(r.createdAt)) : ""}</small></div></li>`,
        )
        .join("")}</ul>`
    : emptyState("Your first McStar is coming", "Help your team, keep learning and look after customers. Your manager records recognition here.");
  const leaderboard = manager
    ? `<section class="pg-card" aria-labelledby="pgBoardTitle"><div class="pg-card-head"><div><h2 id="pgBoardTitle">Team leaderboard</h2><p class="pg-muted">Recognise great work in a couple of taps.</p></div>${ic("trophy")}</div>${
        ranked.length
          ? `<ol class="pg-board">${ranked
              .map(
                (m, i) =>
                  `<li class="${i < 3 ? "top-" + (i + 1) : ""}"><span class="pg-rank">${i + 1}</span>${avatar(m.name, "sm")}<div class="grow"><b>${esc(m.name)}${m.id === u.id ? ' <small class="pg-you">You</small>' : ""}</b>${bar(Math.round(((Number(m.stars) || 0) / top) * 100), `${m.name} McStars`)}</div><span class="pg-board-stars">${Number(m.stars) || 0}<span class="pg-star">★</span></span>${m.id === u.id ? '<span class="pg-board-gap"></span>' : `<button type="button" class="btn light pg-btn-sm" data-give-stars="${esc(m.id)}" aria-label="Give McStars to ${esc(m.name)}">${ic("star")}<span class="pg-hide-sm">Give</span></button>`}</li>`,
              )
              .join("")}</ol>`
          : emptyState("No team yet", "Team members appear here once they join your store.")
      }</section>`
    : "";
  const recent = manager
    ? `<section class="pg-card"><div class="pg-card-head"><h2>Recent team recognition</h2></div>${
        teamRecent.length
          ? `<ul class="pg-list">${teamRecent
              .map(
                (r) =>
                  `<li class="pg-list-row">${avatar(r.userName)}<div class="grow"><b>${esc(r.userName)} <span class="pg-star-inline">+${Number(r.amount) || 0}★</span></b><small>${esc(r.note || "")}${r.createdAt ? " · " + esc(timeAgo(r.createdAt)) : ""}</small></div></li>`,
              )
              .join("")}</ul>`
          : '<p class="pg-muted">No recognition recorded yet. Be the first to give McStars.</p>'
      }</section>`
    : "";
  return `<div class="pg-page pg-rewards"><section class="pg-reward-hero"><div class="pg-reward-copy"><p class="pg-eyebrow">Your McStars</p><div class="pg-reward-number">${stars}<span class="pg-star">★</span></div><p>${esc(u.badge || "Every contribution counts.")}</p><div class="pg-reward-meta">${rank && ranked.length > 1 ? `<span>${ic("trophy")}#${rank} of ${ranked.length} in your team</span>` : ""}<span>${ic("star")}${thisMonth ? `+${thisMonth} in the last 30 days` : "Keep shining"}</span></div></div><div class="pg-reward-art" aria-hidden="true"><span>★</span><span>★</span><span>★</span></div></section>${manager ? `<div class="pg-grid-2">${leaderboard}${recent}</div>` : ""}<div class="pg-grid-2"><section class="pg-card"><div class="pg-card-head"><h2>${manager ? "Your recognition" : "Recognition history"}</h2><span class="pg-pill">${mine.length}</span></div>${history}</section><section class="pg-card"><div class="pg-card-head"><h2>Ways to shine</h2></div><ul class="pg-shine">${[
    ["team", "Help your team", "Jump in where the rush needs you."],
    ["book", "Keep learning", `Finish a module in <a href="${url("training")}">My learning</a>.`],
    ["shield", "Get verified", "Complete a station sign-off with your Crew Trainer."],
    ["star", "Make someone’s day", "Great service is always noticed."],
  ]
    .map(([i, t, d]) => `<li><span class="pg-action-icon">${ic(i)}</span><div><b>${t}</b><p class="pg-muted">${d}</p></div></li>`)
    .join("")}</ul><p class="pg-footnote pg-muted">McStars are recorded by managers. Ask your shift lead about rewards at your restaurant.</p></section></div></div>`;
}
