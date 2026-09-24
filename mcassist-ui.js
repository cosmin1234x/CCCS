// McAssist V4 — browser chat experience.
//
// portal-enhancements.js hands every signed-in/preview render to this module
// through a shared helper kit (see createKit there):
//   renderAssistant(data, kit)          main.html?view=assistant (owns #content)
//   installAssistantLauncher(data, kit) floating "Ask McAssist" button and
//                                       slide-over drawer on every other page
// Both surfaces share one chat engine and one session history
// (sessionStorage mc_v2_chat_<uid>, last 40 entries, in-memory fallback when
// storage is blocked). The live engine speaks the McAssist V4 contract
// (POST /api/ai-chat). Preview mode never touches the network: a scripted,
// clearly labelled demo engine answers from the sample data instead.
import {
  isoDate,
  weekDates,
  shiftMinutes,
  overlap,
  durationLabel,
} from "./portal-core.js";

const CHAT_KEY = "mc_v2_chat_";
const DRAFT_KEY = "mc_v2_draft_";
const MAX_STORED = 40;
const MAX_HISTORY = 12;
const REQUEST_TIMEOUT = 60000;
const PLAN_TTL = 15 * 60 * 1000;
const DEMO_NOTE = "Sample data · No changes were made.";
// Mirrors api/ai-chat.js: a typed "yes" / "cancel" sent straight after a plan
// resolves that plan on the server, exactly like pressing its button.
const TYPED_YES =
  /^(?:yes|yeah|yep|yup|ok|okay|sure|confirm(?:ed)?|approve[d]?|go ahead|do it|go for it|please do|sounds good|send it|publish(?: it| them)?|apply(?: it| them)?)(?:,? (?:please|thanks|thank you|do it|go ahead|confirm))?[.! ]*$/i;
const TYPED_NO =
  /^(?:no|nope|nah|cancel(?: it| that)?|stop|don'?t|do not|never ?mind|forget it|scrap (?:it|that))(?:,? thanks| thank you)?[.! ]*$/i;
const TYPED_CASUAL = /^(?:ok|okay|sure|sounds good)\b/i;
const DECISION_STATES = [
  "approved",
  "partial",
  "failed",
  "cancelled",
  "expired",
  "gone",
  "superseded",
  "handled",
];

let kit = null;
const S = {
  key: "",
  role: "crew",
  name: "",
  firstName: "there",
  initials: "?",
  data: null,
  items: null,
  cache: new Map(),
  busy: false,
  statuses: [],
  statusIndex: 0,
  statusTimer: 0,
  views: new Set(),
  openSteps: new Set(),
  ticker: 0,
  drawer: null,
  lastFocus: null,
  globalsBound: false,
  dictation: null,
};

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------
const escapeHTML = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const esc = escapeHTML;
const newId = () =>
  Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-5);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const reducedMotion = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const finePointer = () =>
  window.matchMedia?.("(hover: hover) and (pointer: fine)").matches ?? true;
const strings = (value, max = 20, length = 300) =>
  Array.isArray(value)
    ? value
        .filter((v) => typeof v === "string" && v.trim())
        .slice(0, max)
        .map((v) => v.trim().slice(0, length))
    : [];

function readJSON(key, fallback) {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function writeJSON(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false; // Private browsing or blocked storage: memory still works.
  }
}
function removeKey(key) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
// Session values with an in-memory mirror, so flows keep working when
// sessionStorage throws.
const memory = new Map();
function memRead(key, fallback = null) {
  if (memory.has(key)) return memory.get(key);
  const value = readJSON(key, fallback);
  memory.set(key, value);
  return value;
}
function memWrite(key, value) {
  memory.set(key, value);
  if (value == null) removeKey(key);
  else writeJSON(key, value);
}

const PATHS = {
  spark: "m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5Z",
  send: "M4 12 20 4l-4 16-4-7-8-1Zm8 1 8-9",
  mic: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Zm-7 9a7 7 0 0 0 14 0M12 19v3",
  close: "m6 6 12 12M6 18 18 6",
  check: "m5 12 4.5 4.5L19 7",
  warn: "M12 9v4m0 3.5h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  block: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM5.6 5.6l12.8 12.8",
  calendar:
    "M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2m2 10h2m4 0h2m-8 4h2",
  team: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.9M13 3a4 4 0 0 1 0 8M9 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8",
  book: "M12 6C8 3 4 4 2 5v15c4-2 7-1 10 1m0-15c4-3 8-2 10-1v15c-4-2-7-1-10 1V6",
  clock: "M12 7v5l3 2m7-2a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  shield: "m12 3 8 3v7c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-5",
  newChat: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z",
  expand: "M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7",
  list: "M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1ZM6 6h12v15H6V6Zm3 6h6m-6 4h4",
  steps: "M4 6h16M4 12h11M4 18h7",
  chevron: "m9 6 6 6-6 6",
  refresh: "M20 11a8 8 0 0 0-14.7-4.3L3 9m0-5v5h5m-4 4a8 8 0 0 0 14.7 4.3L21 15m0 5v-5h-5",
  bolt: "M13 2 4 14h7l-1 8 9-12h-7l1-8Z",
};
const svg = (name, cls = "") =>
  `<svg class="mca-i${cls ? " " + cls : ""}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${PATHS[name] || PATHS.spark}"/></svg>`;

const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_LONG = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};
const DAY_SHORT = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};
const dayKeyOf = (date) =>
  ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][
    new Date(date + "T12:00").getDay()
  ];
const addDaysISO = (date, days) => {
  const d = new Date(date + "T12:00");
  d.setDate(d.getDate() + days);
  return isoDate(d);
};
const dateText = (
  date,
  options = { weekday: "short", day: "numeric", month: "short" },
) => new Date(date + "T12:00").toLocaleDateString("en-GB", options);
const toMin = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
const validTime = (time) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(time || ""));
const firstNameOf = (name) =>
  String(name || "")
    .trim()
    .split(/\s+/)[0] || "there";
const plural = (n, word, many = word + "s") => `${n} ${n === 1 ? word : many}`;
const PAGE_LABELS = {
  home: "Home",
  schedule: "the schedule",
  training: "your learning",
  availability: "your availability",
  rewards: "McStars",
  assistant: "McAssist",
  team: "your team",
  manage: "the shift planner",
  verification: "verifications",
  waste: "the waste counter",
};

// ---------------------------------------------------------------------------
// Conversation store (shared by the page and the drawer)
// ---------------------------------------------------------------------------
function setOwner(data) {
  const profile = data?.profile || {};
  const id = String(profile.id || "anonymous");
  const key = kit.preview ? `preview-${kit.preview}-${id}` : id;
  if (key !== S.key) {
    S.key = key;
    S.items = null;
    S.openSteps.clear();
  }
  S.data = data;
  S.role = kit.normaliseRole(profile.role);
  S.name = String(profile.name || "");
  S.firstName = firstNameOf(profile.name);
  S.initials = (kit.initials?.(profile.name) || "?").slice(0, 2);
}

function cleanPending(p) {
  if (!p || typeof p !== "object" || typeof p.id !== "string" || !p.id)
    return null;
  let expiresAt = Number(p.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= 0)
    expiresAt = Date.now() + PLAN_TTL;
  else if (expiresAt < 1e12) expiresAt *= 1000; // seconds → milliseconds
  const items = Array.isArray(p.items)
    ? p.items
        .filter((i) => i && typeof i === "object")
        .slice(0, 60)
        .map((i, index) => ({
          id: String(i.id ?? "item-" + index),
          label: String(i.label || "Change " + (index + 1)).slice(0, 240),
          detail: typeof i.detail === "string" ? i.detail.slice(0, 300) : "",
          status: ["ok", "warning", "blocked"].includes(i.status)
            ? i.status
            : "ok",
          note: typeof i.note === "string" ? i.note.slice(0, 300) : "",
        }))
    : [];
  return {
    id: p.id,
    title: String(p.title || "Review this plan").slice(0, 200),
    summary: typeof p.summary === "string" ? p.summary.slice(0, 600) : "",
    risk: ["low", "medium", "high"].includes(p.risk) ? p.risk : "medium",
    confirmLabel: String(p.confirmLabel || "Confirm").slice(0, 60),
    cancelLabel: String(p.cancelLabel || "Cancel").slice(0, 60),
    expiresAt,
    items,
  };
}

function cleanResults(value) {
  return Array.isArray(value)
    ? value
        .filter((r) => r && typeof r === "object")
        .slice(0, 60)
        .map((r) => ({
          itemId: String(r.itemId ?? ""),
          ok: Boolean(r.ok),
          message: String(r.message || (r.ok ? "Done" : "Not applied")).slice(
            0,
            300,
          ),
        }))
    : [];
}

function cleanItem(raw) {
  if (
    !raw ||
    typeof raw !== "object" ||
    !["user", "assistant"].includes(raw.role) ||
    typeof raw.content !== "string"
  )
    return null;
  const item = {
    id: typeof raw.id === "string" && raw.id ? raw.id : newId(),
    role: raw.role,
    content: raw.content.slice(0, 8000),
    ts: Number(raw.ts) || 0,
    rev: 1,
  };
  if (typeof raw.display === "string") item.display = raw.display.slice(0, 200);
  if (raw.kind === "error") {
    item.kind = "error";
    item.local = true;
    if (raw.retry && typeof raw.retry.message === "string")
      item.retry = {
        message: raw.retry.message,
        confirm:
          raw.retry.confirm && typeof raw.retry.confirm.pendingId === "string"
            ? {
                pendingId: raw.retry.confirm.pendingId,
                decision:
                  raw.retry.confirm.decision === "cancel" ? "cancel" : "approve",
              }
            : null,
        planItemId:
          typeof raw.retry.planItemId === "string" ? raw.retry.planItemId : null,
        decision: raw.retry.decision === "cancel" ? "cancel" : raw.retry.decision ? "approve" : null,
        excludeId:
          typeof raw.retry.excludeId === "string" ? raw.retry.excludeId : null,
        typed: raw.retry.typed === true,
      };
  }
  const steps = strings(raw.steps, 20);
  if (steps.length) item.steps = steps;
  const actions = strings(raw.actions, 40);
  if (actions.length) item.actions = actions;
  const suggestions = strings(raw.suggestions, 4, 120);
  if (suggestions.length) item.suggestions = suggestions;
  if (typeof raw.note === "string") item.note = raw.note.slice(0, 200);
  const pending = cleanPending(raw.pending);
  if (pending) {
    item.pending = pending;
    const d = raw.decision;
    if (d && typeof d === "object" && DECISION_STATES.includes(d.status))
      item.decision = {
        status: d.status,
        at: Number(d.at) || 0,
        results: cleanResults(d.results),
      };
    // A request that was in flight when the page unloaded is unlocked again.
  }
  return item;
}

function items() {
  if (!S.items) {
    if (S.cache.has(S.key)) S.items = S.cache.get(S.key);
    else {
      const raw = readJSON(CHAT_KEY + S.key, []);
      S.items = Array.isArray(raw)
        ? raw.map(cleanItem).filter(Boolean).slice(-MAX_STORED)
        : [];
      // Only the newest plan can be live (the server supersedes older ones).
      const newest = [...S.items].reverse().find((item) => item.pending);
      supersedeOlderPlans(newest, S.items);
      S.cache.set(S.key, S.items);
    }
  }
  return S.items;
}

// Marks every unresolved plan card except `keep` as replaced. The server
// answers 409 for superseded plans, so their buttons must never be live.
function supersedeOlderPlans(keep, list = items()) {
  let changed = false;
  for (const item of list)
    if (
      item !== keep &&
      item.pending &&
      (!item.decision || item.decision.status === "working")
    ) {
      item.decision = { status: "superseded", at: Date.now(), results: [] };
      bump(item);
      changed = true;
    }
  return changed;
}

function saveItems() {
  const list = items();
  if (list.length > MAX_STORED) list.splice(0, list.length - MAX_STORED);
  S.cache.set(S.key, list);
  writeJSON(
    CHAT_KEY + S.key,
    list.map(({ rev, ...rest }) => rest),
  );
}

function findItem(id) {
  return items().find((item) => item.id === id) || null;
}

function bump(item) {
  item.rev = (item.rev || 1) + 1;
}

function pushItem(item) {
  item.id = item.id || newId();
  item.ts = item.ts || Date.now();
  item.rev = 1;
  items().push(item);
  saveItems();
  renderViews();
  return item;
}

function planIsLive(item) {
  return Boolean(
    item?.pending && !item.decision && item.pending.expiresAt > Date.now(),
  );
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function formatInline(text) {
  return text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

// Safe "markdown-lite": escape first, then paragraphs, line breaks,
// "- " bullets, "1. " numbered lists and **bold**.
function formatText(raw) {
  const lines = esc(raw).split(/\r?\n/);
  let html = "";
  let list = "";
  let para = [];
  const flushPara = () => {
    if (para.length) html += `<p>${para.map(formatInline).join("<br>")}</p>`;
    para = [];
  };
  const closeList = () => {
    if (list) html += `</${list}>`;
    list = "";
  };
  for (const line of lines) {
    const bullet = line.match(/^\s*(?:[-•*])\s+(.*)$/);
    const numbered = line.match(/^\s*\d{1,2}[.)]\s+(.*)$/);
    if (bullet || numbered) {
      flushPara();
      const tag = bullet ? "ul" : "ol";
      if (list !== tag) {
        closeList();
        html += `<${tag}>`;
        list = tag;
      }
      html += `<li>${formatInline((bullet || numbered)[1])}</li>`;
      continue;
    }
    closeList();
    if (!line.trim()) flushPara();
    else para.push(line.trim());
  }
  flushPara();
  closeList();
  return html || "<p></p>";
}

function timeHTML(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const label = d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `<time class="mca-time" datetime="${esc(d.toISOString())}">${esc(label)}</time>`;
}

function expiryText(at) {
  const left = Math.max(0, at - Date.now());
  if (left > 3600000)
    return (
      "Expires at " +
      new Date(at).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
      })
    );
  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);
  return `Expires in ${m}:${String(s).padStart(2, "0")}`;
}

// What happened to one plan item after approval. The server reports blocked
// (and no-longer-valid) items as { ok: false, message: "Skipped — …" }.
function outcomeOf(it, r, finished) {
  if (r) {
    if (r.ok) return "done";
    return it.status === "blocked" || /^skipped\b/i.test(r.message)
      ? "skipped"
      : "failed";
  }
  return finished && it.status === "blocked" ? "skipped" : "";
}

function planStatusFor(plan, decision, results) {
  if (decision === "cancel") return "cancelled";
  if (!results.length) return "approved";
  const byId = new Map(plan.pending.items.map((it) => [it.id, it]));
  let ok = 0;
  let trouble = 0;
  for (const r of results) {
    if (r.ok) ok++;
    else if (byId.get(r.itemId)?.status !== "blocked") trouble++;
  }
  return ok === 0 ? "failed" : trouble ? "partial" : "approved";
}

function planHTML(item) {
  const p = item.pending;
  const d = item.decision;
  const expired = !d && p.expiresAt <= Date.now();
  const state = d?.status || (expired ? "expired" : "pending");
  const results = new Map((d?.results || []).map((r) => [r.itemId, r]));
  const finished = ["approved", "partial", "failed"].includes(state);
  const allBlocked =
    p.items.length > 0 && p.items.every((i) => i.status === "blocked");
  const riskLabel = { low: "Low risk", medium: "Medium risk", high: "High risk" }[
    p.risk
  ];
  const statusWord = { ok: "Ready", warning: "Check", blocked: "Blocked" };
  const rows = p.items
    .map((it) => {
      const r = results.get(it.id);
      const outcome = outcomeOf(it, r, finished);
      const icon =
        outcome === "done"
          ? svg("check")
          : outcome === "failed" || outcome === "skipped"
            ? svg("block")
            : it.status === "ok"
              ? svg("check")
              : it.status === "warning"
                ? svg("warn")
                : svg("block");
      const result = r
        ? `<p class="mca-plan-result">${esc(r.message)}</p>`
        : outcome === "skipped"
          ? '<p class="mca-plan-result">Skipped</p>'
          : "";
      return `<li class="mca-plan-item is-${it.status}${outcome ? " is-" + outcome : ""}"><span class="mca-plan-item-icon">${icon}</span><div class="mca-plan-item-copy"><span class="mca-sr">${statusWord[it.status]}: </span><b>${esc(it.label)}</b>${it.detail ? `<small>${esc(it.detail)}</small>` : ""}${it.note ? `<p class="mca-plan-note">${esc(it.note)}</p>` : ""}${result}</div></li>`;
    })
    .join("");
  const buttons = (disabled) =>
    `<div class="mca-plan-buttons"><button type="button" class="mca-btn mca-btn-ghost" data-plan-cancel="${esc(item.id)}"${disabled ? " disabled" : ""}>${esc(p.cancelLabel)}</button><button type="button" class="mca-btn mca-btn-confirm risk-${p.risk}" data-plan-confirm="${esc(item.id)}"${disabled || allBlocked ? " disabled" : ""}>${svg("check")}<span>${esc(p.confirmLabel)}</span></button></div>`;
  let foot = "";
  if (state === "pending") {
    const at = new Date(p.expiresAt).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    });
    foot = `<div class="mca-plan-foot"><span class="mca-expiry${p.expiresAt - Date.now() < 60000 ? " is-urgent" : ""}" data-expires="${p.expiresAt}">${svg("clock")}<span class="mca-expiry-text" aria-hidden="true">${esc(expiryText(p.expiresAt))}</span><span class="mca-sr">Plan expires at ${esc(at)}</span></span>${buttons(S.busy)}${allBlocked ? '<p class="mca-plan-blocked">Every item is blocked, so there is nothing to apply. Ask McAssist to adjust the plan.</p>' : ""}</div>`;
  } else if (state === "working") {
    foot = `<div class="mca-plan-status is-working" role="status"><span class="mca-spinner" aria-hidden="true"></span>${d.decision === "cancel" ? "Cancelling…" : "Re-checking and applying…"}</div>`;
  } else if (finished) {
    const outcomes = p.items.map((it) =>
      outcomeOf(it, results.get(it.id), true),
    );
    const applied = outcomes.filter((o) => o === "done").length;
    const failed = outcomes.filter((o) => o === "failed").length;
    const skipped = outcomes.filter((o) => o === "skipped").length;
    const text =
      state === "failed"
        ? "Nothing was applied"
        : results.size
          ? `Approved · ${applied} of ${applied + failed} done`
          : "Approved and applied";
    foot = `<div class="mca-plan-status ${state === "failed" ? "is-bad" : state === "partial" ? "is-warn" : "is-good"}">${svg(state === "failed" ? "block" : state === "partial" ? "warn" : "check")}<span>${esc(text)}${skipped ? ` · ${skipped} skipped` : ""}</span></div>`;
  } else if (state === "superseded") {
    // Kept visible but locked: the server answers 409 for replaced plans.
    foot = `<div class="mca-plan-foot is-locked">${buttons(true)}</div><div class="mca-plan-status is-muted">${svg("refresh")}<span>Replaced by a newer plan · nothing was changed</span></div>`;
  } else {
    const text = {
      cancelled: "Cancelled · nothing was changed",
      expired: "Expired · nothing was changed. Ask again for a fresh plan.",
      gone: "No longer available · nothing was changed",
      handled: "Already handled · nothing more was changed",
    }[state];
    foot = `<div class="mca-plan-status is-muted">${svg(state === "cancelled" ? "close" : state === "handled" ? "check" : "clock")}<span>${esc(text)}</span></div>`;
  }
  const kicker =
    state === "pending"
      ? "Needs your OK"
      : state === "working"
        ? "Working on it"
        : state === "superseded"
          ? "Replaced"
          : "Plan";
  return `<article class="mca-plan risk-${p.risk} is-${state}" aria-label="${esc("Plan: " + p.title)}"><header class="mca-plan-head"><span class="mca-plan-icon">${svg("list")}</span><div class="mca-plan-titles"><span class="mca-plan-kicker">${kicker}</span><h3>${esc(p.title)}</h3></div><span class="mca-risk">${riskLabel}</span></header>${p.summary ? `<p class="mca-plan-summary">${esc(p.summary)}</p>` : ""}${rows ? `<ol class="mca-plan-items">${rows}</ol>` : ""}${foot}</article>`;
}

function actionsHTML(actions) {
  const chip = (a) => `<li>${svg("check")}<span>${esc(a)}</span></li>`;
  const head = actions.slice(0, 3).map(chip).join("");
  const rest = actions.slice(3);
  return `<div class="mca-actions-wrap"><p class="mca-sr">Changes made:</p><ul class="mca-actions">${head}</ul>${rest.length ? `<details class="mca-more"><summary>Show ${rest.length} more</summary><ul class="mca-actions">${rest.map(chip).join("")}</ul></details>` : ""}</div>`;
}

function messageHTML(item, { latest }) {
  const key = esc(item.id);
  if (item.role === "user") {
    const decision = Boolean(item.display);
    return `<div class="mca-msg mca-msg-user" data-key="${key}"><div class="mca-body"><div class="mca-bubble${decision ? " mca-bubble-decision" : ""}"><span class="mca-sr">You said: </span>${decision ? svg(item.content === "Cancel" ? "close" : "check") : ""}${formatText(item.display || item.content)}</div>${timeHTML(item.ts)}</div><span class="mca-avatar mca-avatar-user" aria-hidden="true">${esc(S.initials)}</span></div>`;
  }
  const error = item.kind === "error";
  const parts = [
    `<div class="mca-bubble${error ? " mca-bubble-error" : ""}"><span class="mca-sr">McAssist said: </span>${formatText(item.content)}${error && item.retry ? `<button type="button" class="mca-retry" data-retry="${key}">${svg("refresh")}<span>Try again</span></button>` : ""}</div>`,
  ];
  if (item.note)
    parts.push(`<p class="mca-note">${svg("shield")}<span>${esc(item.note)}</span></p>`);
  if (item.steps?.length)
    parts.push(
      `<details class="mca-steps" data-steps="${key}"${S.openSteps.has(item.id) ? " open" : ""}><summary>${svg("steps")}<span>What I checked</span><span class="mca-count">${item.steps.length}</span>${svg("chevron", "mca-chev")}</summary><ol>${item.steps.map((s) => `<li>${svg("check")}<span>${esc(s)}</span></li>`).join("")}</ol></details>`,
    );
  if (item.pending) parts.push(planHTML(item));
  if (item.actions?.length) parts.push(actionsHTML(item.actions));
  if (latest && item.suggestions?.length)
    parts.push(
      `<div class="mca-suggestions" role="group" aria-label="Suggested replies">${item.suggestions.map((s) => `<button type="button" class="mca-chip" data-suggest="${esc(s)}">${esc(s)}</button>`).join("")}</div>`,
    );
  parts.push(timeHTML(item.ts));
  return `<div class="mca-msg mca-msg-bot${error ? " is-error" : ""}" data-key="${key}"><span class="mca-avatar mca-avatar-bot" aria-hidden="true">${svg("spark")}</span><div class="mca-body${item.pending ? " has-plan" : ""}">${parts.join("")}</div></div>`;
}

function toNode(html) {
  const template = document.createElement("template");
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}

function typingNode() {
  const node = toNode(
    `<div class="mca-msg mca-msg-bot mca-typing"><span class="mca-avatar mca-avatar-bot" aria-hidden="true">${svg("spark")}</span><div class="mca-body"><div class="mca-bubble"><span class="mca-dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="mca-typing-text" aria-hidden="true"></span><span class="mca-sr">McAssist is working on it</span></div></div></div>`,
  );
  node.querySelector(".mca-typing-text").textContent =
    S.statuses[S.statusIndex] || "Thinking it through…";
  return node;
}

function welcomeItem(view) {
  const store = S.data?.profile?.storeName || S.data?.profile?.storeId || "";
  let content;
  if (kit.preview === "manager")
    content = `Hi ${S.firstName} 👋 This is the McAssist preview demo, running on sample data for ${store || "a sample restaurant"} — nothing real changes.\n\nTry planning a week of shifts or removing an account to see how I check first, ask when details are missing, and wait for your OK.`;
  else if (kit.preview)
    content = `Hi ${S.firstName} 👋 This is the McAssist preview demo for crew, running on sample data.\n\nAsk about your next shift, learn a station or update your availability.`;
  else if (S.role === "manager")
    content = `Hi ${S.firstName} 👋 I'm McAssist, your shift co-pilot${store ? " for " + store : ""}.\n\nAsk me in plain English — plan shifts, check cover, update the team or track learning. I check availability and the rota first, ask when something's missing, and show you a plan before I change anything important.`;
  else if (S.role === "crewTrainer")
    content = `Hi ${S.firstName} 👋 I'm McAssist. I can start station verifications, show who still needs a sign-off, and help you coach any station. I only do what your role allows.`;
  else
    content = `Hi ${S.firstName} 👋 I'm McAssist. Ask me about your shifts, learn a station, or update your availability. I only do what your role allows.`;
  return {
    id: "welcome",
    role: "assistant",
    content,
    ts: 0,
    rev: 1,
    suggestions: startersFor(view.surface),
  };
}

function renderViews() {
  for (const view of [...S.views]) syncView(view);
  ensureTicker();
  updateLauncherBadge();
}

function syncView(view, { initial = false } = {}) {
  if (!view.log.isConnected) {
    S.views.delete(view);
    return;
  }
  const list = items();
  const shown = list.length ? list : [welcomeItem(view)];
  let lastBot = -1;
  shown.forEach((item, index) => {
    if (item.role === "assistant") lastBot = index;
  });
  const existing = new Map();
  for (const node of [...view.log.children])
    if (node.dataset.key) existing.set(node.dataset.key, node);
  let anchor = null;
  let added = false;
  shown.forEach((item, index) => {
    const latest = index === lastBot && index === shown.length - 1 && !S.busy;
    const sig = `${item.rev || 1}|${latest ? "L" : ""}|${planIsLive(item) && S.busy ? "B" : ""}`;
    let node = existing.get(item.id);
    if (!node || node.dataset.sig !== sig) {
      const fresh = toNode(messageHTML(item, { latest }));
      fresh.dataset.sig = sig;
      if (!node && !initial && view.ready) {
        fresh.classList.add("mca-enter");
        added = true;
      }
      if (node) node.replaceWith(fresh);
      else if (anchor) anchor.after(fresh);
      else view.log.prepend(fresh);
      node = fresh;
    }
    existing.delete(item.id);
    anchor = node;
  });
  existing.forEach((node) => node.remove());
  if (S.busy) {
    if (!view.typing) {
      view.typing = typingNode();
      added = true;
    }
    if (view.log.lastElementChild !== view.typing)
      view.log.appendChild(view.typing);
  } else if (view.typing) {
    view.typing.remove();
    view.typing = null;
  }
  view.log.setAttribute("aria-busy", String(S.busy));
  view.send.disabled = S.busy;
  view.send.classList.toggle("is-busy", S.busy);
  if (view.clear) view.clear.disabled = S.busy;
  const page = view.surface === "page" ? view.root.closest(".mca-page") : null;
  if (page && page.classList.contains("is-chatting") !== list.length > 0) {
    // On phones the hero steps aside once the conversation starts.
    page.classList.toggle("is-chatting", list.length > 0);
    fitPanel();
  }
  if (!list.length && !S.busy) view.log.scrollTop = 0;
  else if (initial || added) scrollToEnd(view, initial ? "auto" : "smooth");
  view.ready = true;
}

function scrollToEnd(view, behavior = "smooth") {
  const run = () => {
    const log = view.log;
    if (typeof log.scrollTo === "function")
      log.scrollTo({
        top: log.scrollHeight,
        behavior: reducedMotion() ? "auto" : behavior,
      });
    else log.scrollTop = log.scrollHeight;
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
  else run();
}

function ensureTicker() {
  const live = items().some(planIsLive);
  if (live && !S.ticker) S.ticker = setInterval(tick, 1000);
  if (!live && S.ticker) {
    clearInterval(S.ticker);
    S.ticker = 0;
  }
}

function tick() {
  const now = Date.now();
  let changed = false;
  for (const item of items())
    if (item.pending && !item.decision && item.pending.expiresAt <= now) {
      item.decision = { status: "expired", at: now, results: [] };
      bump(item);
      changed = true;
    }
  if (changed) {
    saveItems();
    renderViews();
    return;
  }
  document.querySelectorAll(".mca-expiry[data-expires]").forEach((el) => {
    const at = Number(el.dataset.expires);
    const text = el.querySelector(".mca-expiry-text");
    if (text) text.textContent = expiryText(at);
    el.classList.toggle("is-urgent", at - now < 60000);
  });
  ensureTicker();
}

// ---------------------------------------------------------------------------
// Typing status ("Checking availability…")
// ---------------------------------------------------------------------------
const STATUS = {
  shifts: [
    "Reading your request…",
    "Checking availability…",
    "Checking the rota for clashes…",
    "Preparing a plan…",
  ],
  account: [
    "Reading your request…",
    "Looking up the account…",
    "Checking upcoming shifts…",
    "Preparing a safe plan…",
  ],
  team: [
    "Reading your request…",
    "Looking up your team…",
    "Checking their records…",
  ],
  learning: [
    "Reading your request…",
    "Checking learning records…",
    "Finding the right module…",
  ],
  availability: [
    "Reading your request…",
    "Checking availability…",
    "Updating the week…",
  ],
  approve: [
    "Re-checking everything…",
    "Applying the changes…",
    "Saving to your restaurant…",
  ],
  cancel: ["Cancelling the plan…"],
  general: [
    "Reading your request…",
    "Thinking it through…",
    "Checking your restaurant data…",
    "Putting the answer together…",
  ],
};

function statusesFor(text) {
  const t = String(text || "").toLowerCase();
  if (/\b(delete|remove|deactivate)\b.*\b(account|profile|user|login)\b/.test(t))
    return STATUS.account;
  if (/availab/.test(t)) return STATUS.availability;
  if (/\b(shifts?|rota|cover|coverage|schedule|closing|opening|free)\b/.test(t))
    return STATUS.shifts;
  if (/\b(module|learn|learning|training|teach|quiz|complete|completed|course|station)\b/.test(t))
    return STATUS.learning;
  if (/\b(team|mcstars?|stars|promote|rate|pay|role|profile)\b/.test(t))
    return STATUS.team;
  return STATUS.general;
}

function startStatus(list) {
  S.statuses = list;
  S.statusIndex = 0;
  clearInterval(S.statusTimer);
  S.statusTimer = setInterval(() => {
    if (S.statusIndex >= S.statuses.length - 1) return;
    S.statusIndex += 1;
    for (const view of S.views) {
      const el = view.typing?.querySelector(".mca-typing-text");
      if (!el) continue;
      el.textContent = S.statuses[S.statusIndex];
      el.classList.remove("is-swap");
      void el.offsetWidth; // restart the fade
      el.classList.add("is-swap");
    }
  }, 1100);
}

function stopStatus() {
  clearInterval(S.statusTimer);
  S.statusTimer = 0;
}

// ---------------------------------------------------------------------------
// Engine: sending, confirming, retrying
// ---------------------------------------------------------------------------
function currentPage() {
  const view = kit.params?.get("view");
  if (view === "assistant" || view === "availability") return view;
  const map = {
    "main.html": "home",
    "schedule.html": "schedule",
    "shifts-admin.html": "manage",
    "training.html": "training",
    "module.html": "module",
    "break-rewards.html": "rewards",
    "admin.html": "team",
    "verification.html": "verification",
    "waste.html": "waste",
    "wrapped.html": "training",
  };
  return map[kit.path] || "home";
}

function appContext() {
  const context = {
    page: currentPage(),
    clientTime: new Date().toISOString(),
  };
  try {
    context.timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    /* optional */
  }
  if (context.page === "module") {
    const id = kit.params?.get("id");
    const module = (window.McModules?.modules || []).find((m) => m.id === id);
    if (module)
      context.selectedModule = {
        id: module.id,
        title: module.title,
        category: module.category || "",
      };
  }
  return context;
}

function buildHistory(excludeId) {
  return items()
    .filter(
      (item) =>
        item.id !== excludeId && !item.kind && !item.local && item.content,
    )
    .slice(-MAX_HISTORY)
    .map((item) => ({
      role: item.role,
      content: String(item.content).slice(0, 2000),
    }));
}

function friendlyError(status, data) {
  const reply = typeof data?.reply === "string" ? data.reply.trim() : "";
  if (reply) return reply;
  const raw = typeof data?.error === "string" ? data.error.trim() : "";
  const sentence = /\s/.test(raw) ? raw : "";
  if (status === 401)
    return "Your session has expired. Sign in again to keep using McAssist.";
  if (status === 403)
    return sentence || "Your role doesn't allow that, so nothing was changed.";
  if (status === 404 || status === 410)
    return (
      sentence ||
      "That plan is no longer available, so nothing was changed. Ask again and I'll prepare a fresh one."
    );
  if (status === 409)
    return (
      sentence ||
      "That plan has already been handled, so nothing more was changed. Use the latest plan card."
    );
  if (status === 429)
    return sentence || "You're going a little fast. Wait a few seconds, then try again.";
  if (status >= 500)
    return sentence || "McAssist is having a moment. Please try again.";
  return sentence || "McAssist couldn't complete that. Please try again.";
}

async function callApi(body) {
  if (typeof kit.idToken !== "function")
    return kit.api("/api/ai-chat", {
      method: "POST",
      body: JSON.stringify(body),
    });
  const token = await kit.idToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  let response;
  try {
    response = await fetch("/api/ai-chat", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    const failure = new Error(
      error?.name === "AbortError"
        ? "That took longer than expected, so I stopped waiting. If you asked for a change, check it before trying again."
        : "I couldn't reach McAssist. Check your connection and try again.",
    );
    failure.status = 0;
    throw failure;
  } finally {
    clearTimeout(timer);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const failure = new Error(friendlyError(response.status, data));
    failure.status = response.status;
    failure.data = data;
    throw failure;
  }
  return data;
}

// The plan a typed "yes" / "cancel" will resolve server-side: only when
// McAssist's last message is that (still live) plan, and high-risk plans
// need a clear "yes" / "confirm" rather than "ok" or "sure".
function typedDecision(message) {
  const yes = TYPED_YES.test(message);
  if (!yes && !TYPED_NO.test(message)) return null;
  const last = [...items()]
    .reverse()
    .find(
      (item) =>
        item.role === "assistant" && !item.kind && !item.local && item.content,
    );
  if (!last || !planIsLive(last)) return null;
  if (yes && TYPED_CASUAL.test(message) && last.pending.risk === "high")
    return null;
  return { planItemId: last.id, decision: yes ? "approve" : "cancel" };
}

async function sendMessage(text) {
  const message = String(text || "")
    .trim()
    .slice(0, 2000);
  if (!message || S.busy) return false;
  const typed = typedDecision(message);
  if (typed) {
    const plan = findItem(typed.planItemId);
    plan.decision = {
      status: "working",
      decision: typed.decision,
      at: Date.now(),
      results: [],
    };
    bump(plan);
  }
  const echo = pushItem({ role: "user", content: message });
  await runRequest(
    { message },
    typed ? { excludeId: echo.id, ...typed, typed: true } : { excludeId: echo.id },
  );
  return true;
}

async function decide(itemId, decision) {
  if (S.busy) return;
  const plan = findItem(itemId);
  if (!plan?.pending || plan.decision) return;
  if (plan.pending.expiresAt <= Date.now()) {
    plan.decision = { status: "expired", at: Date.now(), results: [] };
    bump(plan);
    saveItems();
    renderViews();
    return;
  }
  plan.decision = { status: "working", decision, at: Date.now(), results: [] };
  bump(plan);
  const echo = pushItem({
    role: "user",
    content: decision === "approve" ? "Confirm" : "Cancel",
    display:
      decision === "approve"
        ? plan.pending.confirmLabel
        : plan.pending.cancelLabel,
  });
  await runRequest(
    {
      message: echo.content,
      confirm: { pendingId: plan.pending.id, decision },
    },
    { excludeId: echo.id, planItemId: plan.id, decision },
  );
}

async function retry(errorId) {
  if (S.busy) return;
  const list = items();
  const index = list.findIndex((item) => item.id === errorId);
  if (index < 0) return;
  const [failed] = list.splice(index, 1);
  saveItems();
  const r = failed.retry;
  if (!r) {
    renderViews();
    return;
  }
  if (r.planItemId) {
    const plan = findItem(r.planItemId);
    if (!planIsLive(plan)) {
      // The plan was resolved or replaced meanwhile. A typed reply is still
      // worth sending as an ordinary message; a button press is not.
      if (r.typed) await runRequest({ message: r.message }, { excludeId: r.excludeId });
      else renderViews();
      return;
    }
    plan.decision = {
      status: "working",
      decision: r.decision || "approve",
      at: Date.now(),
      results: [],
    };
    bump(plan);
    await runRequest(
      r.confirm ? { message: r.message, confirm: r.confirm } : { message: r.message },
      {
        excludeId: r.excludeId,
        planItemId: plan.id,
        decision: r.decision || "approve",
        typed: r.typed,
      },
    );
    return;
  }
  await runRequest({ message: r.message }, { excludeId: r.excludeId });
}

async function runRequest(payload, context = {}) {
  S.busy = true;
  startStatus(
    context.decision === "cancel"
      ? STATUS.cancel
      : context.decision
        ? STATUS.approve
        : statusesFor(payload.message),
  );
  renderViews();
  const body = {
    message: payload.message,
    history: buildHistory(context.excludeId),
    appContext: appContext(),
  };
  if (payload.confirm) body.confirm = payload.confirm;
  let data = null;
  let failure = null;
  try {
    data = kit.preview ? await demoRespond(body, context) : await callApi(body);
  } catch (error) {
    failure = error || new Error("McAssist couldn't complete that.");
  }
  S.busy = false;
  stopStatus();
  if (failure) applyFailure(failure, payload, context);
  else applyResponse(data || {}, context);
  renderViews();
}

// Resolves the plan card a response belongs to. A plan answer always carries
// `results` (an empty array for a cancel), which is also how a typed "yes"
// that the server resolved is recognised.
function resolvedPlanFor(data, context) {
  const hasResults = Array.isArray(data.results);
  let plan = context.planItemId ? findItem(context.planItemId) : null;
  if (context.typed && !hasResults) {
    // The server treated the reply as an ordinary message: unlock the card.
    if (plan?.decision?.status === "working") {
      plan.decision = undefined;
      bump(plan);
    }
    return null;
  }
  if (!plan && hasResults)
    plan =
      [...items()]
        .reverse()
        .find(
          (item) =>
            item.pending &&
            (!item.decision || item.decision.status === "working"),
        ) || null;
  if (!plan?.pending) return null;
  const decision =
    context.planItemId && !context.typed
      ? context.decision
      : hasResults && !data.results.length
        ? "cancel"
        : "approve";
  return { plan, decision };
}

function applyResponse(data, context) {
  const results = cleanResults(data.results);
  const resolved = resolvedPlanFor(data, context);
  if (resolved) {
    const { plan, decision } = resolved;
    plan.decision = {
      status: planStatusFor(plan, decision, results),
      at: Date.now(),
      results,
    };
    bump(plan);
  }
  const reply = {
    role: "assistant",
    content:
      (typeof data.reply === "string" && data.reply.trim()) ||
      (context.decision === "cancel"
        ? "Cancelled. Nothing was changed."
        : "Done."),
  };
  const steps = strings(data.steps, 20);
  if (steps.length) reply.steps = steps;
  const actions = strings(data.actions, 40);
  if (actions.length) reply.actions = actions;
  const suggestions = strings(data.suggestions, 4, 120);
  if (suggestions.length) reply.suggestions = suggestions;
  const pending = cleanPending(data.pending);
  if (pending) {
    reply.pending = pending;
    // One live plan at a time: older unresolved cards are now replaced.
    supersedeOlderPlans(reply);
  }
  if (kit.preview && typeof data._note === "string") reply.note = data._note;
  pushItem(reply);
  if (data.dataChanged) announceDataChange();
  // A plan waiting for approval always wins over navigation.
  if (data.uiAction && !reply.pending) handleUiAction(data.uiAction);
}

// Something changed in the restaurant data: refresh the shared cache (live)
// and tell the page so it re-renders in place.
function announceDataChange() {
  const preview = Boolean(kit.preview);
  const fire = () => {
    window.dispatchEvent(
      new CustomEvent("mcassist:data-changed", { detail: { preview } }),
    );
    // The page re-renders underneath: re-check what the launcher sits on.
    setTimeout(checkLauncherCollision, 120);
  };
  if (preview) {
    fire();
    return;
  }
  Promise.resolve()
    .then(() => kit.loadData?.(true))
    .catch(() => null)
    .then(fire);
}

function planFailureState(status, message) {
  if (status === 410) return "expired";
  if (status === 404) return "gone";
  if (/newer|replaced|superseded/i.test(message)) return "superseded";
  if (/cancel/i.test(message)) return "cancelled";
  return "handled";
}

function applyFailure(error, payload, context) {
  const status = Number(error?.status) || 0;
  const plan = context.planItemId ? findItem(context.planItemId) : null;
  if (plan && [404, 409, 410].includes(status)) {
    // The plan can't be resolved any more (expired, replaced, already
    // applied): lock the card and answer kindly, no retry.
    plan.decision = {
      status: planFailureState(status, String(error.message || "")),
      at: Date.now(),
      results: [],
    };
    bump(plan);
    pushItem({
      role: "assistant",
      content:
        error.message ||
        "That plan is no longer available, so nothing was changed. Ask again and I'll prepare a fresh one.",
    });
    return;
  }
  if (plan) {
    plan.decision = undefined;
    bump(plan);
  }
  pushItem({
    role: "assistant",
    kind: "error",
    local: true,
    content: error?.message || "McAssist couldn't complete that. Please try again.",
    retry: {
      message: payload.message,
      confirm: payload.confirm || null,
      planItemId: context.planItemId || null,
      decision: context.decision || null,
      excludeId: context.excludeId || null,
      typed: Boolean(context.typed),
    },
  });
}

function pageUrl(page) {
  if (page === "waste")
    return (
      "/waste.html" +
      (kit.preview ? "?preview=" + encodeURIComponent(kit.preview) : "")
    );
  return kit.pageFor(page);
}

function handleUiAction(action) {
  if (!action || typeof action !== "object") return;
  let url = "";
  let label = "";
  if (action.type === "openVerification" && action.id) {
    url = "/verification.html?id=" + encodeURIComponent(action.id);
    label = "the verification";
  } else if (action.type === "openPage" && typeof action.page === "string") {
    url = pageUrl(action.page);
    label = PAGE_LABELS[action.page] || "that page";
  } else if (
    kit.preview &&
    action.type === "openUrl" &&
    typeof action.url === "string" &&
    /^\/(?!\/)/.test(action.url)
  ) {
    url = action.url;
    label = String(action.label || "that page");
  }
  if (!url) return;
  const target = new URL(url, location.href);
  if (
    target.pathname === location.pathname &&
    target.search === location.search
  ) {
    closeDrawer();
    return;
  }
  closeDrawer(true);
  kit.toast("Opening " + label + "…");
  setTimeout(() => {
    location.href = url;
  }, 900);
}

function clearConversation(view) {
  if (S.busy) return;
  items().length = 0;
  S.openSteps.clear();
  saveItems();
  removeKey(CHAT_KEY + S.key);
  if (kit.preview) {
    memWrite(demoConvoKey(), null);
    memWrite(demoPlansKey(), null);
  }
  for (const v of S.views) v.ready = false;
  renderViews();
  for (const v of S.views) v.ready = true;
  notify("Conversation cleared.");
  if (finePointer()) view?.input.focus();
}

function notify(text) {
  const dialog = S.drawer?.dialog;
  if (dialog?.open) {
    const flash = dialog.querySelector(".mca-flash");
    if (flash) {
      flash.textContent = text;
      flash.classList.add("show");
      clearTimeout(S.flashTimer);
      S.flashTimer = setTimeout(() => flash.classList.remove("show"), 2600);
      return;
    }
  }
  kit.toast(text);
}

// ---------------------------------------------------------------------------
// Views (page panel and drawer panel share this)
// ---------------------------------------------------------------------------
function draftKey() {
  return DRAFT_KEY + S.key;
}

function autoGrow(input) {
  if (!input.offsetParent && !input.getClientRects().length) {
    input.style.height = ""; // Hidden (closed drawer): measure when shown.
    return;
  }
  input.style.height = "auto";
  const max = Math.max(
    96,
    Math.min(180, Math.round((window.innerHeight || 700) * 0.28)),
  );
  input.style.height = Math.min(input.scrollHeight, max) + "px";
  input.style.overflowY = input.scrollHeight > max ? "auto" : "hidden";
}

function fillInput(view, text) {
  view.input.value = text;
  autoGrow(view.input);
  memWrite(draftKey(), text);
  view.input.focus({ preventScroll: true });
  try {
    view.input.setSelectionRange(text.length, text.length);
  } catch {
    /* ignore */
  }
  const field = view.input.closest(".mca-field");
  field?.classList.remove("is-filled");
  void field?.offsetWidth;
  field?.classList.add("is-filled");
}

function submitFrom(view) {
  if (S.busy) return;
  const text = view.input.value.trim();
  if (!text) {
    view.input.focus();
    return;
  }
  stopDictation();
  view.input.value = "";
  autoGrow(view.input);
  memWrite(draftKey(), null);
  sendMessage(text);
}

function speechSupported() {
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

function stopDictation() {
  const d = S.dictation;
  if (!d) return;
  S.dictation = null;
  try {
    d.recognition.stop();
  } catch {
    /* ignore */
  }
  d.view.mic?.setAttribute("aria-pressed", "false");
  d.view.mic?.classList.remove("is-listening");
}

function toggleDictation(view) {
  if (S.dictation) {
    const same = S.dictation.view === view;
    stopDictation();
    if (same) return;
  }
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) return;
  let recognition;
  try {
    recognition = new Recognition();
  } catch {
    notify("Dictation isn't available in this browser.");
    return;
  }
  recognition.lang = "en-GB";
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;
  const base = view.input.value.trim();
  recognition.onresult = (event) => {
    let transcript = "";
    for (let i = 0; i < event.results.length; i++)
      transcript += event.results[i][0].transcript;
    view.input.value = (base ? base + " " : "") + transcript.trim();
    autoGrow(view.input);
    memWrite(draftKey(), view.input.value);
  };
  recognition.onerror = (event) => {
    if (event.error === "not-allowed" || event.error === "service-not-allowed")
      notify("Allow microphone access to dictate messages.");
    else if (!["aborted", "no-speech"].includes(event.error))
      notify("Dictation stopped. Please try again.");
  };
  recognition.onend = () => {
    if (S.dictation?.recognition === recognition) stopDictation();
    view.input.focus({ preventScroll: true });
  };
  try {
    recognition.start();
  } catch {
    notify("Dictation couldn't start. Please try again.");
    return;
  }
  S.dictation = { recognition, view };
  view.mic.setAttribute("aria-pressed", "true");
  view.mic.classList.add("is-listening");
}

function bindView(view) {
  view.form.addEventListener("submit", (event) => {
    event.preventDefault();
    submitFrom(view);
  });
  view.input.addEventListener("keydown", (event) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.isComposing &&
      event.keyCode !== 229
    ) {
      event.preventDefault();
      submitFrom(view);
    }
  });
  view.input.addEventListener("input", () => {
    autoGrow(view.input);
    memWrite(draftKey(), view.input.value || null);
  });
  if (view.mic && speechSupported()) {
    view.mic.hidden = false;
    view.mic.addEventListener("click", () => toggleDictation(view));
  }
  view.clear?.addEventListener("click", () => {
    if (S.busy) return;
    if (!items().length) {
      notify("Nothing to clear yet.");
      return;
    }
    const label = view.clear.querySelector(".mca-head-btn-label");
    if (view.clear.dataset.armed !== "true") {
      view.clear.dataset.armed = "true";
      view.clear.setAttribute("aria-label", "Tap again to clear the conversation");
      if (label) label.textContent = "Tap to confirm";
      clearTimeout(view.disarm);
      view.disarm = setTimeout(() => {
        view.clear.dataset.armed = "false";
        view.clear.setAttribute("aria-label", "Clear conversation");
        if (label) label.textContent = "New chat";
      }, 6000);
      return;
    }
    clearTimeout(view.disarm);
    view.clear.dataset.armed = "false";
    view.clear.setAttribute("aria-label", "Clear conversation");
    if (label) label.textContent = "New chat";
    clearConversation(view);
  });
  view.log.addEventListener("click", (event) => {
    const button = event.target.closest?.("button");
    if (!button || !view.log.contains(button) || button.disabled) return;
    if (button.dataset.suggest !== undefined) sendMessage(button.dataset.suggest);
    else if (button.dataset.planConfirm) decide(button.dataset.planConfirm, "approve");
    else if (button.dataset.planCancel) decide(button.dataset.planCancel, "cancel");
    else if (button.dataset.retry) retry(button.dataset.retry);
  });
  view.log.addEventListener(
    "toggle",
    (event) => {
      const details = event.target;
      if (!details?.matches?.("details[data-steps]")) return;
      if (details.open) S.openSteps.add(details.dataset.steps);
      else S.openSteps.delete(details.dataset.steps);
    },
    true,
  );
}

function createView(root, surface) {
  const view = {
    surface,
    root,
    log: root.querySelector("[data-mca-log]"),
    form: root.querySelector("[data-mca-form]"),
    input: root.querySelector("[data-mca-input]"),
    send: root.querySelector("[data-mca-send]"),
    mic: root.querySelector("[data-mca-mic]"),
    clear: root.querySelector("[data-mca-clear]"),
    typing: null,
    ready: false,
  };
  bindView(view);
  const draft = memRead(draftKey(), null);
  if (typeof draft === "string" && draft && !view.input.value) {
    view.input.value = draft.slice(0, 2000);
  }
  autoGrow(view.input);
  S.views.add(view);
  syncView(view, { initial: true });
  ensureTicker();
  return view;
}

// ---------------------------------------------------------------------------
// Prompt library and starters
// ---------------------------------------------------------------------------
function sampleNames() {
  const data = S.data || {};
  const selfId = data.profile?.id;
  const team =
    (kit.preview ? kit.portalState?.()?.team : null) || data.team || [];
  const others = team.filter((p) => p && p.id !== selfId && p.name);
  const crew = others.filter((p) => kit.normaliseRole(p.role) === "crew");
  const pool = crew.length ? crew : others;
  const byName = (name) =>
    others.find((p) => firstNameOf(p.name).toLowerCase() === name);
  if (kit.preview === "manager")
    return {
      shifts: S.firstName,
      remove: firstNameOf(byName("ryan")?.name || pool[1]?.name || "Ryan"),
      praise: firstNameOf(pool[0]?.name || "Amelia"),
      crew: firstNameOf(pool[0]?.name || "Alex"),
    };
  return {
    shifts: pool[0] ? firstNameOf(pool[0].name) : S.firstName,
    remove: firstNameOf(pool[1]?.name || pool[0]?.name || "Alex"),
    praise: firstNameOf(pool[0]?.name || "Alex"),
    crew: firstNameOf(pool[0]?.name || "Alex"),
  };
}

function libraryGroups() {
  const n = sampleNames();
  const groups = [];
  if (S.role === "manager") {
    groups.push({
      key: "plan",
      icon: "calendar",
      title: "Plan shifts",
      prompts: [
        ["Closing shifts", `Create 5 closing shifts for ${n.shifts} next week`],
        ["Coverage check", "What's our coverage on Saturday?"],
        ["Find cover", "Who's free to cover Friday evening?"],
      ],
    });
    groups.push({
      key: "team",
      icon: "team",
      title: "Team",
      prompts: [
        ["Remove an account", `Delete ${n.remove}'s account`],
        ["McStars", `Give ${n.praise} 3 McStars for great customer service`],
        ["Pay rate", `Set ${n.praise}'s hourly rate to £12.60`],
        ["Promote", `Promote ${n.praise} to Crew Trainer`],
      ],
    });
  }
  if (S.role === "crewTrainer")
    groups.push({
      key: "team",
      icon: "shield",
      title: "Team",
      prompts: [
        ["Start a verification", `Verify ${n.crew} on Fries`],
        ["Sign-offs", "Who still needs a station sign-off?"],
      ],
    });
  groups.push({
    key: "learn",
    icon: "book",
    title: "Learning",
    prompts:
      S.role === "manager"
        ? [
            ["Training gaps", "Who hasn't completed Food Safety?"],
            ["Station primer", "Teach me the chicken station basics"],
          ]
        : [
            ["Station primer", "Teach me the chicken station basics"],
            ["Quick quiz", "Quiz me on food safety"],
            ["What's next", "Which module should I do next?"],
          ],
  });
  groups.push({
    key: "week",
    icon: "clock",
    title: "My week",
    prompts: [
      ["My next shift", "What is my next shift and station?"],
      ["Availability", "Set my Friday availability to 16:00–23:00"],
      ["Hours", "How many hours am I working this week?"],
    ],
  });
  return groups;
}

function startersFor(surface) {
  const n = sampleNames();
  const page = surface === "page" ? "assistant" : currentPage();
  const manager = S.role === "manager";
  if (page === "module") {
    const module = (window.McModules?.modules || []).find(
      (m) => m.id === kit.params?.get("id"),
    );
    if (module)
      return [
        `Explain ${module.title} in 3 bullet points`,
        `Quiz me on ${module.title}`,
        "Which module should I do next?",
      ];
  }
  if (page === "training")
    return manager
      ? [
          "Who hasn't completed Food Safety?",
          "Teach me the chicken station basics",
          "Which module should I do next?",
        ]
      : [
          "Which module should I do next?",
          "Teach me the fries station basics",
          "Quiz me on food safety",
        ];
  if (page === "availability")
    return [
      "Set my Friday availability to 16:00–23:00",
      "Make me unavailable on Sunday",
      "When am I working next?",
    ];
  if (manager && (page === "schedule" || page === "manage"))
    return [
      "What's our coverage on Saturday?",
      `Create 5 closing shifts for ${n.shifts} next week`,
      "Who's free to cover Friday evening?",
    ];
  if (manager && page === "team")
    return [
      `Give ${n.praise} 3 McStars for great customer service`,
      `Promote ${n.praise} to Crew Trainer`,
      `Delete ${n.remove}'s account`,
    ];
  if (manager)
    return [
      `Create 5 closing shifts for ${n.shifts} next week`,
      kit.preview ? `Delete ${n.remove}'s account` : "Who hasn't completed Food Safety?",
      "What's our coverage on Saturday?",
    ];
  if (S.role === "crewTrainer")
    return [
      "Who still needs a station sign-off?",
      "When am I working next?",
      "Teach me the chicken station basics",
    ];
  return [
    "When am I working next?",
    "Teach me the fries station basics",
    "Set my Friday availability to 16:00–23:00",
  ];
}

function libraryHTML() {
  return `<aside class="mca-library" aria-labelledby="mcaLibraryTitle"><div class="mca-library-head"><h2 id="mcaLibraryTitle">Try asking</h2><p>Tap a prompt to drop it into the chat. Edit anything, then send.</p></div><div class="mca-library-groups">${libraryGroups()
    .map(
      (group) =>
        `<section class="mca-group" aria-labelledby="mcaGroup-${group.key}"><h3 class="mca-group-title" id="mcaGroup-${group.key}">${svg(group.icon)}<span>${esc(group.title)}</span></h3><div class="mca-group-list">${group.prompts
          .map(
            ([title, prompt]) =>
              `<button type="button" class="mca-prompt" data-mca-fill="${esc(prompt)}"><span class="mca-prompt-copy"><b>${esc(title)}</b><span class="mca-prompt-text">${esc(prompt)}</span></span>${svg("chevron", "mca-prompt-go")}</button>`,
          )
          .join("")}</div></section>`,
    )
    .join("")}</div></aside>`;
}

function panelHTML(surface) {
  const drawer = surface === "drawer";
  const ids = drawer
    ? {
        log: "mcaDrawerLog",
        form: "mcaDrawerForm",
        input: "mcaDrawerInput",
        title: "mcaDrawerTitle",
      }
    : {
        log: "chat",
        form: "chatForm",
        input: "chatInput",
        title: "mcaPanelTitle",
      };
  const roleText = kit.roleLabel(S.role);
  const status = kit.preview
    ? "Scripted demo · nothing real changes"
    : `Online · ${roleText} access`;
  const placeholder = "Message McAssist…";
  return `<header class="mca-panel-head"><div class="mca-id"><span class="mca-avatar mca-avatar-bot mca-avatar-lg" aria-hidden="true">${svg("spark")}</span><div class="mca-id-copy"><h2 id="${ids.title}"${drawer ? ' tabindex="-1"' : ""}>McAssist</h2><p class="mca-status"><span class="mca-status-dot" aria-hidden="true"></span><span>${esc(status)}</span></p></div></div><div class="mca-head-actions">${kit.preview ? '<span class="mca-demo-pill">Preview demo · sample data</span>' : ""}<button type="button" class="mca-head-btn" data-mca-clear aria-label="Clear conversation">${svg("newChat")}<span class="mca-head-btn-label">New chat</span></button>${drawer ? `<a class="mca-head-btn" href="${esc(kit.pageFor("assistant"))}" aria-label="Open McAssist full page">${svg("expand")}</a><button type="button" class="mca-head-btn" data-mca-close aria-label="Close McAssist">${svg("close")}</button>` : ""}</div></header><div class="mca-flash" role="status" aria-live="polite"></div><div id="${ids.log}" class="mca-log" data-mca-log role="log" aria-live="polite" aria-label="Conversation with McAssist" tabindex="0"></div><form id="${ids.form}" class="mca-composer" data-mca-form novalidate><div class="mca-field"><textarea id="${ids.input}" data-mca-input rows="1" aria-label="Message McAssist" placeholder="${esc(placeholder)}" maxlength="2000" enterkeyhint="send" autocomplete="off" autocapitalize="sentences"></textarea><button type="button" class="mca-mic" data-mca-mic aria-label="Dictate message" aria-pressed="false" hidden>${svg("mic")}</button><button type="submit" class="mca-send" data-mca-send aria-label="Send message">${svg("send")}<span class="mca-send-spin" aria-hidden="true"></span></button></div><p class="mca-hint"><span class="mca-hint-keys"><kbd>Enter</kbd> to send · <kbd>Shift</kbd> + <kbd>Enter</kbd> for a new line</span><span>${S.role === "manager" ? "Big changes always wait for your OK." : "McAssist only does what your role allows."}</span></p></form>`;
}

const HERO = {
  manager: {
    title: "Run your restaurant in plain English.",
    sub: "Plan a week of shifts, check cover or update the team — just ask. McAssist checks availability and the rota first, asks when details are missing, and waits for your OK before anything big changes.",
  },
  crewTrainer: {
    title: "Train, sign off and plan — just ask.",
    sub: "Start station verifications, see who still needs a sign-off and brush up on any station. McAssist only does what your role allows.",
  },
  crew: {
    title: "A helping hand for every shift.",
    sub: "Ask about your shifts, learn a station or update your availability. McAssist only does what your role allows and always tells you what it changed.",
  },
};

function pageHTML() {
  const copy = HERO[S.role] || HERO.crew;
  const eyebrow = kit.preview
    ? "Preview demo · sample data"
    : "McAssist · " + kit.roleLabel(S.role) + " access";
  return `<div class="mca-page" data-role="${esc(S.role)}"><header class="mca-hero"><div class="mca-hero-copy"><p class="mca-eyebrow">${esc(eyebrow)}</p><h1>${esc(copy.title)}</h1><p class="mca-hero-sub">${esc(copy.sub)}</p></div><ul class="mca-trust" aria-label="How McAssist works"><li>${svg("shield")}<span>Checks before it acts</span></li><li>${svg("spark")}<span>Asks when unsure</span></li><li>${svg("check")}<span>You approve big changes</span></li></ul><span class="mca-hero-orb" aria-hidden="true">${svg("spark")}</span></header><div class="mca-shell">${libraryHTML()}<section class="mca-panel mca-panel-page" id="v2AssistantMount" aria-labelledby="mcaPanelTitle">${panelHTML("page")}</section></div></div>`;
}

// Fit the chat panel to the viewport so the composer is always on screen.
function navLift() {
  const nav = document.querySelector(".mobile-nav");
  if (!nav) return 0;
  const style = getComputedStyle(nav);
  if (style.display === "none" || style.visibility === "hidden") return 0;
  const rect = nav.getBoundingClientRect();
  if (!rect.height || rect.top >= window.innerHeight) return 0;
  return Math.max(0, Math.round(window.innerHeight - rect.top));
}

function fitPanel() {
  const panel = document.querySelector(".mca-page .mca-panel-page");
  if (!panel) return;
  const top = panel.getBoundingClientRect().top + window.scrollY;
  const gap = window.innerWidth <= 760 ? 12 : 24;
  const height = Math.max(
    window.innerHeight - top - navLift() - gap,
    window.innerWidth <= 760 ? 300 : 440,
  );
  const value = Math.round(height) + "px";
  if (panel.style.getPropertyValue("--mca-panel-h") !== value)
    panel.style.setProperty("--mca-panel-h", value);
  const library = document.querySelector(".mca-page .mca-library");
  if (library && library.style.getPropertyValue("--mca-panel-h") !== value)
    library.style.setProperty("--mca-panel-h", value);
}

function bindGlobals() {
  if (S.globalsBound) return;
  S.globalsBound = true;
  let frame = 0;
  const onResize = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      fitPanel();
      if (!isPhone()) document.getElementById("mcaLauncher")?.classList.remove("is-away");
      positionLauncher();
      fitDrawerViewport();
    });
  };
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", onResize);
  let scrollFrame = 0;
  let settle = 0;
  window.addEventListener(
    "scroll",
    () => {
      if (!document.getElementById("mcaLauncher")) return;
      if (!scrollFrame)
        scrollFrame = requestAnimationFrame(() => {
          scrollFrame = 0;
          updateLauncherScroll();
          // Throttled while moving, then once more when scrolling settles.
          if (Date.now() - (S.launcherCheckedAt || 0) > 90) checkLauncherCollision();
        });
      clearTimeout(settle);
      settle = setTimeout(checkLauncherCollision, 160);
    },
    { passive: true },
  );
  // Pages re-render in place after McAssist changes data or live updates.
  window.addEventListener("portal:render", () =>
    setTimeout(checkLauncherCollision, 80),
  );
  window.visualViewport?.addEventListener("resize", fitDrawerViewport);
  window.visualViewport?.addEventListener("scroll", fitDrawerViewport);
  document.fonts?.ready?.then(onResize).catch(() => {});
  // Tuck the launcher away while someone types into a page form on a phone,
  // so it never sits on top of the field or the on-screen keyboard.
  document.addEventListener("focusin", (event) => {
    const launcher = document.getElementById("mcaLauncher");
    if (!launcher) return;
    const field = event.target?.closest?.(
      "input, textarea, select, [contenteditable='true']",
    );
    const inDrawer = S.drawer?.dialog?.contains(event.target);
    launcher.classList.toggle(
      "is-tucked",
      Boolean(
        field && !inDrawer && window.matchMedia("(max-width: 760px)").matches,
      ),
    );
  });
  document.addEventListener("focusout", () => {
    setTimeout(() => {
      const active = document.activeElement;
      if (!active?.closest?.("input, textarea, select, [contenteditable='true']"))
        document.getElementById("mcaLauncher")?.classList.remove("is-tucked");
    }, 80);
  });
  window.addEventListener("pagehide", stopDictation);
}

// ---------------------------------------------------------------------------
// Public: McAssist page
// ---------------------------------------------------------------------------
export function renderAssistant(data, k) {
  kit = k;
  if (!data?.profile) return;
  setOwner(data);
  const content = kit.$("content");
  if (!content) return;
  if (content.dataset.enhancedPage === "assistant") {
    // Live portal updates must never rebuild the chat, drafts or plans.
    fitPanel();
    return;
  }
  content.dataset.enhancedPage = "assistant";
  // The shell's legacy rail card shares the chat IDs; the page owns them now.
  document.getElementById("assistant")?.remove();
  content.innerHTML = pageHTML();
  bindGlobals();
  content.querySelectorAll("[data-mca-fill]").forEach((button) => {
    button.addEventListener("click", () => {
      const view = [...S.views].find((v) => v.surface === "page");
      if (view) fillInput(view, button.dataset.mcaFill);
    });
  });
  const view = createView(content.querySelector(".mca-panel-page"), "page");
  fitPanel();
  requestAnimationFrame(fitPanel);
  const prompt = takePromptParam();
  if (prompt) fillInput(view, prompt);
}

// main.html?view=assistant&prompt=… (e.g. training's Team progress links)
// pre-fills the composer without sending, then drops the parameter so a
// reload or a shared link never re-applies it.
function takePromptParam() {
  let url;
  try {
    url = new URL(location.href);
  } catch {
    return "";
  }
  if (!url.searchParams.has("prompt")) return "";
  const text = String(url.searchParams.get("prompt") || "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, 2000);
  url.searchParams.delete("prompt");
  try {
    history.replaceState(history.state, "", url.pathname + url.search + url.hash);
  } catch {
    /* Older browsers: the parameter simply stays in the address bar. */
  }
  return text;
}

// ---------------------------------------------------------------------------
// Public: floating launcher + slide-over drawer on every other page
// ---------------------------------------------------------------------------
// The launcher's bottom is owned by CSS: calc(22px + var(--dock-offset)),
// which already includes the phone tab bar and the safe area.
function positionLauncher() {
  const launcher = document.getElementById("mcaLauncher");
  if (!launcher) return;
  launcher.style.removeProperty("--mca-bottom");
  checkLauncherCollision();
}

// The launcher must never cover page content. Three resting states:
//   full     nothing under its spot
//   .is-peek something under it: a compact circle hugging the screen edge
//            (inside the page gutter, always fully on screen)
//   .is-covered  content under both spots: it steps aside until the way is
//            clear again (the nav's McAssist link is always there too)
// On phones it also hides while scrolling down and returns on scroll up
// (.is-away). Keep PEEK in step with the .is-peek rules in mcassist.css.
const PEEK = {
  phone: { shift: 12, scale: 0.846 },
  wide: { shift: 16, scale: 0.85 },
};
const INTERACTIVE =
  "a[href], button, input, select, textarea, summary, label, [role='button'], [role='tab'], [role='link'], [role='checkbox'], [role='switch']";
const MEDIA =
  "img, svg, video, canvas, picture, iframe, input, select, textarea, progress, meter";
const isPhone = () =>
  window.matchMedia?.("(max-width: 760px)").matches ?? window.innerWidth <= 760;

function launcherSpots(launcher) {
  const phone = isPhone();
  // offset* ignore transforms, so these are the resting position even while
  // the launcher is peeking or stepping aside. It is anchored by its right
  // edge, so that edge never moves.
  const right = launcher.offsetLeft + launcher.offsetWidth;
  const top = launcher.offsetTop;
  const h = launcher.offsetHeight;
  let width = h;
  if (!phone) {
    const cl = launcher.classList;
    if (!cl.contains("is-peek")) S.launcherWidth = launcher.offsetWidth;
    else if (!S.launcherWidth) {
      // Label hidden while peeking: measure the full pill once.
      cl.remove("is-peek");
      S.launcherWidth = launcher.offsetWidth;
      cl.add("is-peek");
    }
    width = S.launcherWidth || launcher.offsetWidth;
  }
  const rest = { left: right - width, right, top, bottom: top + h };
  const p = phone ? PEEK.phone : PEEK.wide;
  const size = h * p.scale;
  const middle = top + h / 2;
  const peek = {
    left: right + p.shift - size,
    right: right + p.shift,
    top: middle - size / 2,
    bottom: middle + size / 2,
  };
  return { rest, peek };
}

// Is (x, y) inside the pill/circle drawn in rect (radius = half its height)?
function insidePill(rect, x, y) {
  const r = (rect.bottom - rect.top) / 2;
  const cx = Math.min(Math.max(x, rect.left + r), rect.right - r);
  const cy = rect.top + r;
  return (x - cx) ** 2 + (y - cy) ** 2 <= (r + 1) * (r + 1);
}

function paintedBackground(style) {
  if (style.backgroundImage && style.backgroundImage !== "none") return true;
  const match = String(style.backgroundColor || "").match(/rgba?\(([^)]*)\)/);
  if (!match) return false;
  const parts = match[1].split(/[\s,/]+/).filter(Boolean);
  return (parts.length > 3 ? parseFloat(parts[3]) : 1) > 0.04;
}

function textUnder(el, rect) {
  for (const node of el.childNodes) {
    if (node.nodeType !== 3 || !node.nodeValue.trim()) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const r of range.getClientRects())
      if (
        r.width &&
        r.right > rect.left &&
        r.left < rect.right &&
        r.bottom > rect.top &&
        r.top < rect.bottom
      )
        return true;
  }
  return false;
}

// Content = controls, media, text, or small painted things (pills, chips,
// avatars, badges, bars). Large surfaces such as card backgrounds are not.
function isContent(el, rect) {
  if (!el || el === document.body || el === document.documentElement) return false;
  if (el.closest?.(".mobile-nav, .mca-drawer, #toast, .toast-stack")) return false;
  const control = el.closest?.(INTERACTIVE);
  if (control && control !== document.body) return true;
  if (el.closest?.(MEDIA)) return true;
  if (textUnder(el, rect)) return true;
  const box = el.getBoundingClientRect();
  // Taller boxes are surfaces (cards, tiles); their text is checked above.
  if (box.height > 56) return false;
  const style = getComputedStyle(el);
  if (/^table/.test(style.display)) return false; // Cell shading, not content.
  // Thin bars (progress, timeline shifts) and small rounded shapes (pills,
  // chips, avatars, badges, icon tiles).
  if (box.height <= 24) return paintedBackground(style);
  const rounded =
    parseFloat(style.borderTopLeftRadius) > 0 ||
    parseFloat(style.borderBottomRightRadius) > 0;
  if (!rounded || box.width > window.innerWidth * 0.6) return false;
  return (
    paintedBackground(style) ||
    (parseFloat(style.borderTopWidth) > 0 &&
      style.borderTopStyle !== "none" &&
      paintedBackground({ backgroundColor: style.borderTopColor }))
  );
}

function contentUnder(rect, launcher) {
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const vh = window.innerHeight;
  const seen = new Set();
  const steps = [0.08, 0.29, 0.5, 0.71, 0.92];
  for (const fx of steps)
    for (const fy of steps) {
      const x = rect.left + fx * (rect.right - rect.left);
      const y = rect.top + fy * (rect.bottom - rect.top);
      if (x < 0 || y < 0 || x >= vw || y >= vh || !insidePill(rect, x, y)) continue;
      for (const el of document.elementsFromPoint(x, y)) {
        if (launcher.contains(el)) continue;
        // Only the top-most surface under the launcher matters.
        if (!seen.has(el)) {
          seen.add(el);
          if (isContent(el, rect)) return true;
        }
        break;
      }
    }
  return false;
}

function checkLauncherCollision() {
  const launcher = document.getElementById("mcaLauncher");
  if (!launcher || typeof document.elementsFromPoint !== "function") return;
  S.launcherCheckedAt = Date.now();
  if (!launcher.offsetWidth || !launcher.offsetHeight) return; // hidden
  const { rest, peek } = launcherSpots(launcher);
  const state = !contentUnder(rest, launcher)
    ? "full"
    : !contentUnder(peek, launcher)
      ? "peek"
      : "covered";
  if (launcher.classList.contains("is-peek") !== (state === "peek"))
    launcher.classList.toggle("is-peek", state === "peek");
  if (launcher.classList.contains("is-covered") !== (state === "covered"))
    launcher.classList.toggle("is-covered", state === "covered");
}

// Phones: out of the way while scrolling down (reading), back on scroll up,
// at the top and at the very end of the page (where the page's extra bottom
// padding keeps the spot clear).
function updateLauncherScroll() {
  const launcher = document.getElementById("mcaLauncher");
  if (!launcher) return;
  const y = Math.max(0, window.scrollY || window.pageYOffset || 0);
  const last = S.lastScrollY ?? y;
  const end =
    Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) -
    window.innerHeight;
  let away = launcher.classList.contains("is-away");
  if (!isPhone() || y < 48 || y >= end - 24) away = false;
  else if (y - last > 8) away = true;
  else if (last - y > 8) away = false;
  else return; // Small movement: keep the current state and reference point.
  S.lastScrollY = y;
  if (launcher.classList.contains("is-away") !== away)
    launcher.classList.toggle("is-away", away);
}

function updateLauncherBadge() {
  const badge = document.querySelector("#mcaLauncher .mca-launcher-badge");
  if (!badge) return;
  const waiting = S.items ? S.items.filter(planIsLive).length : 0;
  const text = waiting ? String(waiting) : "";
  if (badge.textContent !== text) badge.textContent = text;
  badge.hidden = !waiting;
  const sr = document.querySelector("#mcaLauncher .mca-launcher-sr");
  const srText = waiting
    ? ` · ${waiting} plan${waiting === 1 ? "" : "s"} waiting for you`
    : "";
  if (sr && sr.textContent !== srText) sr.textContent = srText;
}

function fitDrawerViewport() {
  const dialog = S.drawer?.dialog;
  if (!dialog?.open) return;
  const vv = window.visualViewport;
  if (!vv) return;
  dialog.style.setProperty("--mca-vvh", Math.round(vv.height) + "px");
  dialog.style.setProperty("--mca-vvtop", Math.round(vv.offsetTop) + "px");
}

function buildDrawer() {
  const dialog = document.createElement("dialog");
  dialog.className = "mca-drawer";
  dialog.id = "mcaDrawer";
  dialog.setAttribute("aria-labelledby", "mcaDrawerTitle");
  dialog.innerHTML = `<div class="mca-sheet"><section class="mca-panel mca-panel-drawer">${panelHTML("drawer")}</section></div>`;
  document.body.appendChild(dialog);
  const view = createView(dialog.querySelector(".mca-panel-drawer"), "drawer");
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeDrawer();
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeDrawer();
      return;
    }
    if (event.key !== "Tab") return;
    // Belt-and-braces focus trap (showModal already makes the page inert).
    const focusable = [
      ...dialog.querySelectorAll(
        'a[href], button:not([disabled]):not([hidden]), textarea, [tabindex="0"]',
      ),
    ].filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (!focusable.length) return;
    const firstEl = focusable[0];
    const lastEl = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === firstEl) {
      event.preventDefault();
      lastEl.focus();
    } else if (!event.shiftKey && document.activeElement === lastEl) {
      event.preventDefault();
      firstEl.focus();
    }
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeDrawer();
  });
  dialog
    .querySelector("[data-mca-close]")
    ?.addEventListener("click", () => closeDrawer());
  dialog.addEventListener("close", () => {
    dialog.classList.remove("is-closing");
    document.documentElement.classList.remove("mca-lock");
    stopDictation();
    const launcher = document.getElementById("mcaLauncher");
    launcher?.setAttribute("aria-expanded", "false");
    const back =
      S.lastFocus && document.contains(S.lastFocus) ? S.lastFocus : launcher;
    S.lastFocus = null;
    back?.focus?.({ preventScroll: true });
  });
  S.drawer = { dialog, view };
  return S.drawer;
}

function openDrawer() {
  const drawer = S.drawer || buildDrawer();
  const { dialog, view } = drawer;
  if (dialog.open) return;
  // Safari doesn't focus buttons on click, so fall back to the launcher.
  const active = document.activeElement;
  S.lastFocus =
    active && active !== document.body && active !== document.documentElement
      ? active
      : document.getElementById("mcaLauncher");
  dialog.classList.remove("is-closing");
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  document.documentElement.classList.add("mca-lock");
  document
    .getElementById("mcaLauncher")
    ?.setAttribute("aria-expanded", "true");
  fitDrawerViewport();
  autoGrow(view.input);
  view.ready = false;
  syncView(view, { initial: true });
  view.ready = true;
  if (finePointer()) view.input.focus({ preventScroll: true });
  else dialog.querySelector("#mcaDrawerTitle")?.focus({ preventScroll: true });
}

function closeDrawer(immediate = false) {
  const dialog = S.drawer?.dialog;
  if (!dialog?.open) return;
  const finish = () => {
    if (dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else {
        dialog.removeAttribute("open");
        dialog.dispatchEvent(new Event("close"));
      }
    }
  };
  if (immediate || reducedMotion()) {
    finish();
    return;
  }
  if (dialog.classList.contains("is-closing")) return;
  dialog.classList.add("is-closing");
  setTimeout(finish, 210);
}

export function installAssistantLauncher(data, k) {
  kit = k;
  if (!data?.profile || !document.body) return;
  setOwner(data);
  if (!document.body.classList.contains("mca-launcher-on"))
    document.body.classList.add("mca-launcher-on");
  let launcher = document.getElementById("mcaLauncher");
  if (!launcher) {
    launcher = document.createElement("button");
    launcher.type = "button";
    launcher.id = "mcaLauncher";
    launcher.className = "mca-launcher";
    launcher.setAttribute("aria-haspopup", "dialog");
    launcher.setAttribute("aria-expanded", "false");
    launcher.setAttribute("aria-controls", "mcaDrawer");
    launcher.innerHTML = `<span class="mca-launcher-icon">${svg("spark")}</span><span class="mca-launcher-label">Ask McAssist</span><span class="mca-sr mca-launcher-sr"></span><span class="mca-launcher-badge" aria-hidden="true" hidden></span>`;
    launcher.addEventListener("click", openDrawer);
    document.body.appendChild(launcher);
    S.lastScrollY = Math.max(0, window.scrollY || 0);
    bindGlobals();
    // Re-check once entrance animations and late content have settled, when
    // the page changes size, and gently in the background (content can also
    // move without resizing, e.g. entrance animations or live updates).
    setTimeout(checkLauncherCollision, 700);
    setTimeout(checkLauncherCollision, 1600);
    if (typeof ResizeObserver === "function") {
      let queued = 0;
      new ResizeObserver(() => {
        if (queued) return;
        queued = requestAnimationFrame(() => {
          queued = 0;
          checkLauncherCollision();
        });
      }).observe(document.body);
    }
    setInterval(() => {
      if (document.visibilityState === "visible" && !S.drawer?.dialog?.open)
        checkLauncherCollision();
    }, 1500);
  }
  positionLauncher();
  updateLauncherBadge();
}

// ---------------------------------------------------------------------------
// Preview demo engine — scripted, offline, sample data only.
// ---------------------------------------------------------------------------
const demoConvoKey = () => "mc_preview_convo_" + kit.preview;
const demoPlansKey = () => "mc_preview_plans_" + kit.preview;
const demoLastKey = () => "mc_preview_last_" + kit.preview;
const STOP_WORDS = new Set(
  "me my myself i the a an next this that tomorrow today tonight week weekend weekdays everyone all someone him her them us our team shifts shift closing opening morning evening night late early monday tuesday wednesday thursday friday saturday sunday mon tue wed thu fri sat sun every each his their".split(
    " ",
  ),
);
const NUMBER_WORDS = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
};
const WEEKDAY_WORDS = {
  monday: "mon",
  mon: "mon",
  tuesday: "tue",
  tues: "tue",
  tue: "tue",
  wednesday: "wed",
  wed: "wed",
  thursday: "thu",
  thurs: "thu",
  thu: "thu",
  friday: "fri",
  fri: "fri",
  saturday: "sat",
  sat: "sat",
  sunday: "sun",
  sun: "sun",
};
const STATION_WORDS = [
  ["front counter", "Front Counter"],
  ["counter", "Front Counter"],
  ["drive thru", "Drive-thru"],
  ["drive-thru", "Drive-thru"],
  ["drive through", "Drive-thru"],
  ["fries", "Fries"],
  ["grill", "Grill"],
  ["chicken", "Chicken & Fryer"],
  ["kitchen", "Kitchen Assembly"],
  ["mccafe", "Drinks & McCafé"],
  ["drinks", "Drinks & McCafé"],
  ["breakfast station", "Breakfast"],
  ["lobby", "Dining Area"],
  ["dining", "Dining Area"],
  ["shift lead", "Shift Lead"],
];
// Sample availability for the demo team members who have none recorded.
const win = (start, end) => ({ available: true, start, end });
const OFF = { available: false };
const SAMPLE_AVAILABILITY = {
  "preview-amelia": {
    mon: win("09:00", "17:00"),
    tue: win("09:00", "17:00"),
    wed: win("09:00", "17:00"),
    thu: win("09:00", "17:00"),
    fri: win("09:00", "17:00"),
    sat: OFF,
    sun: OFF,
  },
  "preview-ryan": {
    mon: win("16:00", "23:00"),
    tue: OFF,
    wed: win("16:00", "23:00"),
    thu: win("16:00", "23:00"),
    fri: win("16:00", "23:00"),
    sat: win("12:00", "23:00"),
    sun: win("12:00", "23:00"),
  },
  "preview-maya": {
    mon: OFF,
    tue: OFF,
    wed: win("12:00", "22:00"),
    thu: win("12:00", "22:00"),
    fri: OFF,
    sat: win("08:00", "20:00"),
    sun: win("08:00", "20:00"),
  },
};

function normText(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9:'£.\-–— ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
const escRe = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const capitalise = (word) => word.charAt(0).toUpperCase() + word.slice(1);

function demoError(status, reply) {
  const error = new Error(reply);
  error.status = status;
  error.data = { reply };
  return error;
}

function demoState() {
  const live = kit.portalState?.();
  if (live?.user) {
    live.shifts = Array.isArray(live.shifts) ? live.shifts : [];
    live.team = Array.isArray(live.team) ? live.team : [];
    return live;
  }
  const saved = kit.loadPreview?.();
  if (saved?.user) {
    saved.shifts = Array.isArray(saved.shifts) ? saved.shifts : [];
    saved.team = Array.isArray(saved.team) ? saved.team : [];
    return saved;
  }
  const d = S.data || {};
  return {
    user: { ...(d.profile || {}) },
    team: [d.profile, ...(d.team || [])].filter(Boolean),
    shifts: [...(d.shifts || [])],
    progress: { ...(d.progress || {}) },
  };
}

function demoPersist(state) {
  kit.savePreview?.(state);
}

function demoPeople(state) {
  const list = [];
  const seen = new Set();
  for (const person of [state.user, ...(state.team || [])])
    if (person?.id && person.name && !seen.has(person.id)) {
      seen.add(person.id);
      list.push(person);
    }
  return list;
}

const isSelf = (state, person) => Boolean(person && person.id === state.user?.id);

function updatePerson(state, id, patch) {
  if (state.user?.id === id) Object.assign(state.user, patch);
  for (const person of state.team || [])
    if (person?.id === id && person !== state.user) Object.assign(person, patch);
}

function findPerson(state, t, { self = true } = {}) {
  let best = null;
  let score = 0;
  for (const person of demoPeople(state)) {
    const full = normText(person.name);
    const given = full.split(" ")[0];
    let s = 0;
    if (full && new RegExp(`\\b${escRe(full)}(?:'s|s)?\\b`).test(t)) s = 3;
    else if (given && new RegExp(`\\b${escRe(given)}(?:'s|s)?\\b`).test(t))
      s = 2;
    if (s > score) {
      best = person;
      score = s;
    }
  }
  if (best) return best;
  if (self && /\b(me|myself|my|i)\b/.test(t))
    return demoPeople(state).find((p) => isSelf(state, p)) || state.user;
  return null;
}

function mentionedName(t) {
  const match =
    t.match(/\bfor\s+([a-z][a-z'-]{1,24})/) ||
    t.match(
      /\b(?:delete|remove|deactivate|promote|give|pay|verify)\s+([a-z][a-z'-]{1,24})/,
    );
  const word = match?.[1]?.replace(/'s?$/, "");
  return word && !STOP_WORDS.has(word) ? word : null;
}

function availabilityOf(person) {
  const own = person?.availability;
  if (own && typeof own === "object" && Object.keys(own).length)
    return { value: own, sample: false };
  if (SAMPLE_AVAILABILITY[person?.id])
    return { value: SAMPLE_AVAILABILITY[person.id], sample: true };
  return { value: null, sample: false };
}

function dayWindow(availability, key) {
  if (!availability) return { status: "unset" };
  const entry = availability[key] ?? availability[DAY_LONG[key].toLowerCase()];
  if (entry === undefined || entry === null) return { status: "unset" };
  const windows = Array.isArray(entry) ? entry : entry.available ? [entry] : [];
  const w = windows.find((x) => validTime(x?.start) && validTime(x?.end));
  return w ? { status: "on", start: w.start, end: w.end } : { status: "off" };
}

function fitsWindow(times, window) {
  if (window.status !== "on") return false;
  const s = toMin(times.start);
  let e = toMin(times.end);
  if (e <= s) e += 1440;
  const a = toMin(window.start);
  let b = toMin(window.end);
  if (b <= a) b += 1440;
  return s >= a && e <= b;
}

function availabilitySummary(availability) {
  if (!availability) return "nothing saved yet";
  const groups = new Map();
  const off = [];
  const unset = [];
  for (const key of DAY_ORDER) {
    const w = dayWindow(availability, key);
    if (w.status === "on") {
      const label = `${w.start}–${w.end}`;
      groups.set(label, [...(groups.get(label) || []), DAY_SHORT[key]]);
    } else if (w.status === "off") off.push(DAY_SHORT[key]);
    else unset.push(DAY_SHORT[key]);
  }
  const parts = [...groups].map(([label, days]) => `${days.join(", ")} ${label}`);
  if (off.length) parts.push(`off ${off.join(", ")}`);
  if (unset.length) parts.push(`${unset.join(", ")} not set`);
  return parts.join(" · ");
}

function parseCount(t) {
  const match = t.match(
    /\b(\d{1,2}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen)\s+(?:(?:more|extra|new|opening|closing|morning|evening|night|late|early|mid|breakfast|weekend|weekday|full|half|day)[\s-]+){0,2}shifts?\b/,
  );
  if (!match) return null;
  const n = /^\d+$/.test(match[1]) ? Number(match[1]) : NUMBER_WORDS[match[1]];
  return n > 0 ? n : null;
}

function to24(hour, minutes, meridiem) {
  let h = Number(hour);
  const m = Number(minutes || 0);
  if (meridiem === "pm" && h < 12) h += 12;
  if (meridiem === "am" && h === 12) h = 0;
  if (h > 24 || m > 59) return null;
  if (h === 24) h = 0;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function parseTimes(t) {
  const range = t.match(
    /\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\s*(?:-|–|—|to|until|till)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\b/,
  );
  if (range) {
    let h1 = Number(range[1]);
    let h2 = Number(range[4]);
    let ap1 = range[3];
    const ap2 = range[6];
    const colon = Boolean(range[2] || range[5]);
    if (!ap1 && ap2 === "pm" && h1 < 12 && h1 + 12 <= (h2 % 12) + 12) ap1 = "pm";
    if (!ap1 && !ap2 && !colon && h1 <= 12 && h2 <= 12) {
      if (h1 < 6) {
        h1 += 12;
        h2 += 12;
      } else if (h2 <= h1) h2 += 12;
    }
    const start = to24(h1, range[2], ap1);
    const end = to24(h2, range[5], ap2);
    if (start && end && start !== end) return { start, end, name: "" };
  }
  if (/\bmatch\b.*\bavailab/.test(t) || /\b(their|his|her) availability\b/.test(t))
    return { match: true, name: "availability-matched" };
  if (/\b(clos(e|ing|er|ers)|late)\b/.test(t))
    return { start: "16:00", end: "23:00", name: "closing" };
  if (/\b(open(ing|er|ers)|breakfast|morning|early)\b/.test(t))
    return { start: "06:00", end: "14:00", name: "opening" };
  if (/\bevening\b/.test(t)) return { start: "17:00", end: "23:00", name: "evening" };
  if (/\b(daytime|mid|middle|lunch)\b/.test(t))
    return { start: "10:00", end: "18:00", name: "day" };
  if (/\b(overnight|night)\b/.test(t))
    return { start: "22:00", end: "06:00", name: "overnight" };
  return null;
}

function parseDays(t) {
  const days = new Set();
  if (/\bweekends?\b/.test(t)) {
    days.add("sat");
    days.add("sun");
  }
  if (/\bweekdays\b/.test(t)) ["mon", "tue", "wed", "thu", "fri"].forEach((d) => days.add(d));
  for (const [word, key] of Object.entries(WEEKDAY_WORDS))
    if (new RegExp(`\\b${word}s?\\b`).test(t)) days.add(key);
  return DAY_ORDER.filter((d) => days.has(d));
}

function parseWeek(t) {
  if (/\bthis week\b/.test(t)) return 0;
  if (/\b(week after next|in two weeks|in 2 weeks)\b/.test(t)) return 2;
  if (/\bnext week\b/.test(t)) return 1;
  return null;
}

function parseStation(t) {
  const hit = STATION_WORDS.find(([word]) => new RegExp(`\\b${escRe(word)}\\b`).test(t));
  return hit ? hit[1] : null;
}

function nextDateFor(key, { includeToday = true } = {}) {
  const today = isoDate();
  for (let i = includeToday ? 0 : 1; i < 8; i++) {
    const date = addDaysISO(today, i);
    if (dayKeyOf(date) === key) return date;
  }
  return today;
}

function parseQueryDate(t) {
  if (/\btomorrow\b/.test(t)) return addDaysISO(isoDate(), 1);
  if (/\btoday\b|\btonight\b/.test(t)) return isoDate();
  const days = parseDays(t);
  if (days.length) {
    const date = nextDateFor(days[0]);
    return parseWeek(t) === 1 && date < weekDates(1)[0]
      ? addDaysISO(date, 7)
      : date;
  }
  return isoDate();
}

function findModule(t) {
  const modules = window.McModules?.modules || [];
  let best = null;
  let score = 0;
  for (const module of modules) {
    let s = 0;
    const title = normText(module.title);
    if (title && t.includes(title)) s += 10;
    for (const word of title.split(" "))
      if (word.length > 3 && new RegExp(`\\b${escRe(word)}`).test(t)) s += 2;
    for (const keyword of module.keywords || [])
      if (keyword && t.includes(normText(keyword))) s += 3;
    if (s > score) {
      best = module;
      score = s;
    }
  }
  return score >= 2 ? best : null;
}

function storeName(state) {
  return state.user?.storeName || S.data?.profile?.storeName || "the sample restaurant";
}

function mostCommonStation(state, personId) {
  const counts = new Map();
  for (const s of state.shifts || [])
    if (s.userId === personId && s.station)
      counts.set(s.station, (counts.get(s.station) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

function upcomingFor(state, personId) {
  const now = new Date();
  return (state.shifts || [])
    .filter((s) => s.userId === personId && s.date && validTime(s.start))
    .filter((s) => {
      const end = new Date(`${s.date}T${s.end || s.start}`);
      if (validTime(s.end) && s.end <= s.start) end.setDate(end.getDate() + 1);
      return end > now;
    })
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
}

const read = (reply, extra = {}) => ({ reply, _note: DEMO_NOTE, ...extra });

function refuse(what) {
  return read(
    `${what} is a manager action, so I can't do it from a Crew Member account — McAssist only does what your role allows.\n\nIf something needs changing, ask your shift manager. Want to see how managers use McAssist? Try the manager preview.`,
    {
      suggestions: [
        "Try the manager preview",
        "When am I working next?",
        "Set my Friday availability to 16:00–23:00",
      ],
    },
  );
}

function newPlan(record) {
  const id = "demo-" + newId();
  const plans = memRead(demoPlansKey(), {}) || {};
  for (const [key, value] of Object.entries(plans))
    if (!value || value.expiresAt < Date.now()) delete plans[key];
    // Like the server: a newer plan replaces any plan still waiting.
    else if (!value.supersededBy) value.supersededBy = id;
  plans[id] = record;
  memWrite(demoPlansKey(), plans);
  return id;
}

// Demo answers take about as long as the real thing would, so the typing
// indicator can show what McAssist is checking. Plans take a little longer.
async function demoRespond(body, context = {}) {
  const started = Date.now();
  const settle = async (ms) => pause(Math.max(0, ms - (Date.now() - started)));
  // A typed "yes" / "cancel" right after a plan resolves it, like the server.
  const typedPlan =
    context.typed && context.planItemId ? findItem(context.planItemId) : null;
  if (body.confirm || typedPlan?.pending) {
    await settle(1300);
    return demoConfirm(
      body.confirm || {
        pendingId: typedPlan.pending.id,
        decision: context.decision === "cancel" ? "cancel" : "approve",
      },
    );
  }
  const text = String(body.message || "");
  const t = normText(text);
  const state = demoState();
  const convo = memRead(demoConvoKey(), null);
  let response = null;
  if (convo?.intent) {
    response = demoContinue(convo, text, t, state);
    if (!response) memWrite(demoConvoKey(), null);
  }
  if (!response) response = demoRoute(text, t, state);
  await settle(
    response.pending ? 2000 : (response.steps?.length || 0) > 1 ? 1400 : 800,
  );
  return response;
}

function demoContinue(convo, text, t, state) {
  if (convo.intent === "shifts") {
    const slots = { ...convo.slots };
    const before = JSON.stringify(slots);
    const found = shiftSlots(t, state);
    Object.assign(slots, found);
    if (!slots.count && /^\d{1,2}$/.test(t)) slots.count = Number(t);
    if (/\bevery day\b|\ball (of )?(their|his|her|the) (free )?days\b/.test(t))
      slots.count = "all";
    if (JSON.stringify(slots) === before) return null;
    return demoShifts(state, slots, t);
  }
  if (convo.intent === "availability") {
    const slots = { ...convo.slots };
    const days = parseDays(t);
    if (days.length) slots.days = days;
    const times = parseTimes(t);
    if (times && !times.match) slots.times = times;
    if (/\b(not available|unavailable|off|day off|can't|cannot)\b/.test(t))
      slots.off = true;
    if (!days.length && !times && !slots.off) return null;
    return demoAvailability(state, slots);
  }
  if (convo.intent === "quiz") {
    const module = (window.McModules?.modules || []).find(
      (m) => m.id === convo.moduleId,
    );
    const question = module?.quiz?.[convo.index];
    if (!question) return null;
    if (/\b(another|next) question\b|\bquiz me again\b/.test(t))
      return demoQuiz(module, convo.index + 1);
    const answers = question.a.map((a) => normText(a));
    let pick = answers.findIndex((a) => a === t || (t.length > 3 && a.includes(t)));
    const letter = t.match(/^([abc])\)?$/);
    if (pick < 0 && letter) pick = "abc".indexOf(letter[1]);
    if (pick < 0 && /^[123]$/.test(t)) pick = Number(t) - 1;
    if (pick < 0) return null;
    memWrite(demoConvoKey(), null);
    const right = pick === question.correct;
    return read(
      right
        ? `✅ **Correct!** "${question.a[question.correct]}" is the one.\n\nKeep going and finish the ${module.title} module to lock it in.`
        : `Not quite. The answer is **${question.a[question.correct]}**.\n\nHave another look at the ${module.title} notes — it's worth getting this one right.`,
      {
        suggestions:
          module.quiz.length > convo.index + 1
            ? ["Another question", `Open the ${module.title} module`]
            : [`Open the ${module.title} module`, "Which module should I do next?"],
      },
    );
  }
  return null;
}

function shiftSlots(t, state) {
  const slots = {};
  const person = findPerson(state, t);
  if (person) slots.personId = person.id;
  const count = parseCount(t);
  if (count) slots.count = count;
  const times = parseTimes(t);
  if (times) slots.times = times;
  const week = parseWeek(t);
  if (week !== null) slots.week = week;
  const days = parseDays(t);
  if (days.length) slots.days = days;
  if (/\btomorrow\b/.test(t)) slots.date = addDaysISO(isoDate(), 1);
  const station = parseStation(t);
  if (station) slots.station = station;
  return slots;
}

function demoRoute(text, t, state) {
  const manager = kit.preview === "manager";
  const self = demoPeople(state).find((p) => isSelf(state, p)) || state.user;
  const planLive = items().some(planIsLive);

  if (/\bmanager (preview|view|demo)\b/.test(t) || /\btry the manager\b/.test(t)) {
    if (manager) return read("You're already in the manager preview. Try one of the prompts below.", { suggestions: startersFor("page") });
    const url = new URL(location.href);
    url.searchParams.set("preview", "manager");
    return read("Switching you to the manager preview…", {
      uiAction: { type: "openUrl", url: url.pathname + url.search, label: "the manager preview" },
    });
  }
  if (/\bcrew (preview|view|demo)\b/.test(t) && manager) {
    const url = new URL(location.href);
    url.searchParams.set("preview", "crew");
    return read("Switching you to the crew preview…", {
      uiAction: { type: "openUrl", url: url.pathname + url.search, label: "the crew preview" },
    });
  }
  if (planLive && /^(yes|yep|yeah|confirm|go ahead|do it|ok|okay|sure|approve)\b/.test(t)) {
    const live = [...items()].reverse().find(planIsLive);
    return read(
      live?.pending.risk === "high" && TYPED_CASUAL.test(t)
        ? `This one can't be undone, so I need a clear yes — tap **${live.pending.confirmLabel}** on the plan above, or type "confirm".`
        : `Tap **${live?.pending.confirmLabel || "the confirm button"}** on the plan above to go ahead — I always wait for your OK before changing anything important.`,
    );
  }
  if (planLive && /^(no|nope|cancel|stop|don't|do not)\b/.test(t))
    return read("Tap the cancel button on the plan above and I'll drop it.");

  // Navigation
  const openModule = t.match(/\bopen (?:the )?(.+?) module\b/);
  if (openModule) {
    const module = findModule(normText(openModule[1])) || findModule(t);
    if (module)
      return {
        reply: `Opening **${module.title}**…`,
        uiAction: {
          type: "openUrl",
          url: `/module.html?id=${encodeURIComponent(module.id)}&preview=${encodeURIComponent(kit.preview)}`,
          label: module.title,
        },
      };
  }
  if (/^(please )?(show|open|take me to|go to|bring up|view)\b/.test(t)) {
    const targets = [
      [/\b(schedule|rota|my shifts|shifts)\b/, "schedule"],
      [/\bplanner\b/, manager ? "manage" : "schedule"],
      [/\bteam\b/, manager ? "team" : "home"],
      [/\bavailability\b/, "availability"],
      [/\b(learning|training|modules)\b/, "training"],
      [/\bwaste\b/, "waste"],
      [/\b(mcstars|stars|rewards)\b/, "rewards"],
      [/\bhome\b/, "home"],
    ];
    const hit = targets.find(([re]) => re.test(t));
    const last = memRead(demoLastKey(), null);
    if (hit?.[1] === "schedule" && last?.date >= isoDate())
      return {
        reply: `Opening the schedule on ${dateText(last.date, { weekday: "long", day: "numeric", month: "short" })}…`,
        uiAction: {
          type: "openUrl",
          url: `/schedule.html?date=${encodeURIComponent(last.date)}&preview=${encodeURIComponent(kit.preview)}`,
          label: "the schedule",
        },
      };
    if (hit)
      return {
        reply: `Opening ${PAGE_LABELS[hit[1]]}…`,
        uiAction: { type: "openPage", page: hit[1] },
      };
  }

  // Manager actions
  const deleteShifts =
    /\b(delete|remove|cancel|clear)\b/.test(t) && /\bshifts?\b/.test(t);
  const deleteAccount =
    !deleteShifts &&
    /\b(delete|remove|deactivate|close|terminate)\b/.test(t) &&
    /\b(account|profile|user|login|from the team|from my team)\b/.test(t);
  if (deleteAccount)
    return manager ? demoDeleteAccount(state, t) : refuse("Deleting an account");
  if (deleteShifts)
    return manager ? demoDeleteShifts(state, t) : refuse("Removing shifts");
  const createShifts =
    /\bshifts?\b/.test(t) &&
    /\b(create|add|make|plan|schedule|book|put|give|set up|rota|roster|need)\b/.test(t) &&
    !/\bwho\b/.test(t);
  if (createShifts) {
    if (!manager) return refuse("Creating shifts");
    return demoShifts(state, shiftSlots(t, state), t);
  }
  if (/\b(hourly )?(rate|pay|wage)\b/.test(t) && /\b(set|change|update|raise|increase|make)\b/.test(t))
    return manager ? demoPayRate(state, t) : refuse("Changing pay rates");
  if (/\bpromote\b|\bmake\b.*\b(crew trainer|trainer|manager)\b/.test(t))
    return manager ? demoPromote(state, t) : refuse("Changing roles");
  if (/\b(give|award|add)\b/.test(t) && /\b(mc)?stars?\b/.test(t))
    return manager ? demoStars(state, t) : refuse("Awarding McStars");

  // Availability
  if (/availab|\bday off\b/.test(t) && /\b(set|change|update|make|mark|put|can't|cannot|unavailable|off)\b/.test(t)) {
    const slots = { days: parseDays(t) };
    const times = parseTimes(t);
    if (times && !times.match) slots.times = times;
    if (/\b(not available|unavailable|day off|can't|cannot)\b/.test(t)) slots.off = true;
    const target = manager ? findPerson(state, t, { self: true }) : self;
    slots.personId = (target || self)?.id;
    return demoAvailability(state, slots);
  }

  // Team questions
  if (/\bwho('s| is)? (free|available)\b|\bfind (cover|someone)\b|\bwho can cover\b|\bcover\b.*\bevening\b/.test(t))
    return manager ? demoWhoFree(state, t) : refuse("Checking the team's availability");
  if (/\b(coverage|covered|staffing|cover)\b|\bwho('s| is) (working|on|in)\b/.test(t))
    return demoCoverage(state, t, manager);
  if (/\b(who|which)\b.*\b(hasn't|hasnt|has not|haven't|havent|not|still)\b.*\b(complete|completed|done|finished|needs?)\b/.test(t) || /\btraining gaps?\b|\bsign[- ]?offs?\b/.test(t))
    return demoTrainingGaps(state, t, manager);

  // Learning
  const quiz = t.match(/\bquiz me\b(?: on)?(.*)$/);
  if (quiz) {
    const module = findModule(normText(quiz[1] || "")) || findModule(t);
    const next = memRead(demoConvoKey(), null);
    if (module) return demoQuiz(module, 0);
    if (next?.moduleId) return demoQuiz((window.McModules?.modules || []).find((m) => m.id === next.moduleId), 0);
    return read("Which topic should I quiz you on?", {
      suggestions: ["Quiz me on food safety", "Quiz me on allergens", "Quiz me on the fries station"],
    });
  }
  if (/\b(another|next) question\b/.test(t)) {
    const last = [...items()].reverse().find((i) => i.role === "assistant");
    const module = findModule(normText(last?.content || ""));
    if (module) return demoQuiz(module, 1);
  }
  if (/\bwhich module\b|\bwhat (should i|to) (learn|do|study) next\b|\bnext module\b/.test(t))
    return demoNextModule(state);
  if (/\b(teach|explain|learn|basics|primer|how do i|tips|coach|summar)\w*/.test(t)) {
    const module = findModule(t);
    if (module) return demoTeach(module);
  }

  // My week
  if (/\bnext shift\b|\bwhen am i (next )?working\b|\bworking next\b|\bmy (next )?shift\b.*\b(when|where|station)\b/.test(t))
    return demoNextShift(state, self);
  if (/\bhow many hours\b|\bhours (am i|this week|next week)\b|\bhow much (will i|am i going to) (earn|make)\b/.test(t))
    return demoHours(state, self, t);
  if (/\b(prepare|prep|ready|help)\b.*\bshift\b|\bshift prep\b/.test(t))
    return demoPrep(state, self);

  if (/^(hi|hello|hey|hiya|morning|good (morning|afternoon|evening))\b/.test(t))
    return read(`Hi ${S.firstName}! What can I help with?`, {
      suggestions: startersFor("page"),
    });
  if (/\b(thanks|thank you|cheers|ta)\b/.test(t))
    return read("Any time! Anything else I can help with?", {
      suggestions: startersFor("page"),
    });

  return read(
    manager
      ? "I'm the preview demo, so I only know a few tricks here: planning shifts, checking cover, updating the team and learning questions. Sign in to ask McAssist anything about your real restaurant."
      : "I'm the preview demo, so I only know a few tricks here: your next shift, your hours, availability and station learning. Sign in to ask McAssist anything about your real shifts.",
    { suggestions: startersFor("page") },
  );
}

function demoShifts(state, slots, t) {
  const person = demoPeople(state).find((p) => p.id === slots.personId);
  if (!person) {
    memWrite(demoConvoKey(), { intent: "shifts", slots });
    const unknown = mentionedName(t);
    return read(
      unknown
        ? `I couldn't find anyone called ${capitalise(unknown)} in the sample team at ${storeName(state)}. Who should I plan the shifts for?`
        : "Sure — who should I plan the shifts for?",
      {
        steps: [`Checked the sample team at ${storeName(state)}`],
        suggestions: demoPeople(state)
          .slice(0, 4)
          .map((p) => firstNameOf(p.name)),
      },
    );
  }
  const given = firstNameOf(person.name);
  const { value: availability, sample } = availabilityOf(person);
  const weekOffset = slots.week ?? 1;
  const weekDays = weekDates(weekOffset);
  const booked = (state.shifts || []).filter(
    (s) => s.userId === person.id && weekDays.includes(s.date),
  );
  const weekText =
    slots.date || slots.days?.length
      ? ""
      : weekOffset === 0
        ? " this week"
        : weekOffset === 2
          ? " the week after next"
          : " next week";
  const steps = [
    `Found ${person.name} · ${kit.roleLabel(person.role)} at ${storeName(state)}`,
    `Checked ${given}'s availability${sample ? " (sample)" : ""}: ${availabilitySummary(availability)}`,
    `Checked the rota for ${dateText(weekDays[0], { day: "numeric", month: "short" })} – ${dateText(weekDays[6], { day: "numeric", month: "short" })}: ${plural(booked.length, "shift")} already booked for ${given}`,
  ];
  if (!slots.times) {
    memWrite(demoConvoKey(), { intent: "shifts", slots });
    const countText =
      slots.count === "all"
        ? "the shifts"
        : slots.count
          ? `the ${plural(slots.count, "shift")}`
          : "the shifts";
    const bookedText = booked.length
      ? `${given} already works ${booked.map((s) => `${dateText(s.date)} ${s.start}–${s.end}`).join(", ")}.`
      : `${given} has nothing booked${weekText} yet.`;
    return read(
      `I can do that — I've checked ${given}'s week first.\n\n- Availability: ${availabilitySummary(availability)}\n- ${bookedText}\n\nYou didn't say what times, so: when should ${countText} start and finish? Give me something like 16:00–23:00, or pick one below.`,
      {
        steps,
        suggestions: [
          "16:00–23:00",
          "09:00–17:00",
          "06:00–14:00",
          `Match ${given}'s availability`,
        ],
      },
    );
  }
  if (!slots.count && !slots.date && !slots.days?.length) {
    memWrite(demoConvoKey(), { intent: "shifts", slots });
    return read(`How many shifts should I plan for ${given}${weekText}?`, {
      steps,
      suggestions: ["3", "5", `Every day ${given}'s free`],
    });
  }
  memWrite(demoConvoKey(), null);
  return buildShiftPlan(state, person, slots, steps, availability);
}

function buildShiftPlan(state, person, slots, steps, availability) {
  const given = firstNameOf(person.name);
  const today = isoDate();
  const all = slots.count === "all";
  const specificDays = !all && slots.days?.length && slots.week == null;
  const count = all
    ? 7
    : Math.min(
        Number(slots.count) || (slots.date ? 1 : slots.days?.length || 1),
        14,
      );
  let dates = [];
  let explicit = false;
  if (slots.date) {
    dates = [slots.date];
    explicit = true;
  } else if (specificDays && count <= slots.days.length) {
    dates = slots.days
      .map((d) => nextDateFor(d, { includeToday: false }))
      .sort();
    explicit = true;
  } else {
    const weekOffset = slots.week ?? (count === 1 ? 0 : 1);
    let from = weekDates(weekOffset)[0];
    if (from <= today) from = addDaysISO(today, 1);
    for (let i = 0; i < 28; i++) dates.push(addDaysISO(from, i));
    // "next week" means next week: never spill into the week after.
    if (all || slots.week != null) {
      const end = weekDates(weekOffset)[6];
      dates = dates.filter((d) => d <= end);
    }
    if (slots.days?.length)
      dates = dates.filter((d) => slots.days.includes(dayKeyOf(d)));
  }
  const station =
    slots.station ||
    person.verifiedStations?.[0] ||
    mostCommonStation(state, person.id) ||
    "Front Counter";
  const chosen = [];
  const skipped = [];
  for (const date of dates) {
    if (chosen.length >= count) break;
    const key = dayKeyOf(date);
    const window = dayWindow(availability, key);
    const times = slots.times.match
      ? window.status === "on"
        ? { start: window.start, end: window.end }
        : null
      : slots.times;
    const draft = times
      ? { date, start: times.start, end: times.end, breakMinutes: 30 }
      : null;
    const sameDay = (state.shifts || []).find(
      (s) => s.userId === person.id && s.date === date,
    );
    const clash = draft
      ? (state.shifts || []).find(
          (s) =>
            s.userId === person.id &&
            s.date &&
            validTime(s.start) &&
            validTime(s.end) &&
            overlap(s, draft),
        )
      : null;
    if (!explicit) {
      if (window.status === "off") {
        skipped.push(`${dateText(date)} (not available)`);
        continue;
      }
      if (!times) {
        skipped.push(`${dateText(date)} (no availability to match)`);
        continue;
      }
      if (sameDay || clash) {
        skipped.push(`${dateText(date)} (already working)`);
        continue;
      }
      if (all && window.status !== "on") {
        skipped.push(`${dateText(date)} (availability not set)`);
        continue;
      }
    }
    let status = "ok";
    let note = "";
    if (!times) {
      status = "blocked";
      note = `No availability saved for ${DAY_LONG[key]} to match.`;
    } else if (clash) {
      status = "blocked";
      note = `Clashes with ${given}'s ${clash.start}–${clash.end} shift${clash.station ? " on " + clash.station : ""}.`;
    } else if (window.status === "off") {
      status = "warning";
      note = `${given} is marked unavailable on ${DAY_LONG[key]}s.`;
    } else if (window.status === "unset") {
      status = "warning";
      note = `No availability saved for ${DAY_LONG[key]} — check with ${given} first.`;
    } else if (!fitsWindow(times, window)) {
      status = "warning";
      note = `Outside ${given}'s availability (${window.start}–${window.end}).`;
    }
    chosen.push({
      date,
      start: times?.start || "",
      end: times?.end || "",
      status,
      note,
    });
  }
  if (skipped.length)
    steps.push(
      `Skipped ${skipped.slice(0, 3).join(", ")}${skipped.length > 3 ? ` and ${skipped.length - 3} more` : ""}`,
    );
  else steps.push("Checked for clashes: none found");
  steps.push(
    `Station: ${station}${slots.station ? "" : person.verifiedStations?.[0] ? ` (${given} is verified there)` : " (default — say another if you prefer)"}`,
  );
  if (!chosen.length)
    return read(
      `I couldn't find any days that work for ${given}${slots.week === 0 ? " this week" : ""}: ${skipped.slice(0, 4).join(", ") || "no availability saved"}.\n\nTry different times or another week.`,
      {
        steps,
        suggestions: [`Match ${given}'s availability`, "Try the week after next"],
      },
    );
  const timesLabel = slots.times.match
    ? "availability-matched"
    : slots.times.name || `${slots.times.start}–${slots.times.end}`;
  const rangeText =
    chosen.length === 1
      ? `on ${dateText(chosen[0].date, { weekday: "long", day: "numeric", month: "short" })}`
      : `from ${dateText(chosen[0].date)} to ${dateText(chosen[chosen.length - 1].date)}`;
  // A single, fully specified, clean shift is low risk and runs straight away.
  if (chosen.length === 1 && count === 1 && chosen[0].status === "ok") {
    const c = chosen[0];
    const shift = {
      id: "demo-" + newId(),
      date: c.date,
      start: c.start,
      end: c.end,
      breakMinutes: 30,
      userId: person.id,
      userName: person.name,
      station,
    };
    state.shifts.push(shift);
    demoPersist(state);
    memWrite(demoLastKey(), { date: c.date });
    return {
      reply: `Done — ${given} is on ${dateText(c.date, { weekday: "long", day: "numeric", month: "short" })}, ${c.start}–${c.end} on ${station}. It fits ${given}'s availability and doesn't clash with anything, so I added it straight away.`,
      steps,
      actions: [
        `Created ${person.name} · ${dateText(c.date)} · ${c.start}–${c.end} · ${station}`,
      ],
      dataChanged: true,
      suggestions: ["Show me on the schedule", "What's our coverage on Saturday?"],
    };
  }
  const warnings = chosen.filter((c) => c.status === "warning").length;
  const blocked = chosen.filter((c) => c.status === "blocked").length;
  const n = chosen.length;
  const expiresAt = Date.now() + PLAN_TTL;
  const planItems = chosen.map((c, i) => ({
    id: "s" + (i + 1),
    label: c.start
      ? `${dateText(c.date)} · ${c.start}–${c.end}`
      : dateText(c.date),
    detail: c.start
      ? `${station} · ${durationLabel(shiftMinutes({ start: c.start, end: c.end, breakMinutes: 30 }))} paid · 30 min break`
      : station,
    status: c.status,
    note: c.note,
  }));
  const pendingId = newPlan({
    kind: "createShifts",
    personId: person.id,
    station,
    expiresAt,
    shifts: chosen.map((c, i) => ({ itemId: "s" + (i + 1), ...c })),
  });
  const confirmLabel = `Create ${plural(n - blocked, "shift")}`;
  let reply = `Here's the plan: ${plural(n, timesLabel === "availability-matched" ? "shift" : `${timesLabel} shift`)} for ${given} ${rangeText}.`;
  if (all && n < 7) reply += ` That's every day ${given} is free${slots.week === 0 ? " this week" : ""}.`;
  if (count > n && !all)
    reply += `\n\nI could only fit ${n} of the ${count} you asked for${slots.week != null ? ` ${slots.week === 0 ? "this week" : slots.week === 2 ? "that week" : "next week"}` : ""}${skipped.length ? ` — ${skipped.slice(0, 4).join(", ")}` : ""}.`;
  reply +=
    warnings || blocked
      ? `\n\n${warnings ? `**${plural(warnings, "shift")}** need${warnings === 1 ? "s" : ""} a second look` : ""}${warnings && blocked ? " and " : ""}${blocked ? `**${blocked}** ${blocked === 1 ? "is" : "are"} blocked and will be skipped` : ""} — check the notes before you confirm.`
      : `\n\nEverything fits ${given}'s availability and nothing clashes.`;
  reply += `\n\nTap **${confirmLabel}** and I'll add ${n - blocked === 1 ? "it" : "them"} to the rota.`;
  return {
    reply,
    steps,
    pending: {
      id: pendingId,
      title: `Create ${plural(n, "shift")} for ${person.name}`,
      summary: `${rangeText.charAt(0).toUpperCase() + rangeText.slice(1)} · ${slots.times.match ? `matched to ${given}'s availability` : `${slots.times.start}–${slots.times.end}`} · ${station} · 30 min unpaid break each.`,
      risk: n > 1 || warnings || blocked ? "medium" : "low",
      confirmLabel,
      cancelLabel: "Not now",
      expiresAt,
      items: planItems,
    },
  };
}

function demoDeleteAccount(state, t) {
  const person = findPerson(state, t, { self: false });
  if (!person) {
    const unknown = mentionedName(t);
    return read(
      unknown
        ? `I couldn't find anyone called ${capitalise(unknown)} in the sample team, so nothing was changed.`
        : "Whose account should I remove?",
      {
        suggestions: demoPeople(state)
          .filter((p) => !isSelf(state, p))
          .slice(0, 3)
          .map((p) => `Delete ${firstNameOf(p.name)}'s account`),
      },
    );
  }
  const given = firstNameOf(person.name);
  if (isSelf(state, person))
    return read(
      "I can't delete your own account from McAssist — that has to go through another manager, so your store is never left without one.",
    );
  const upcoming = upcomingFor(state, person.id);
  const steps = [
    `Found ${person.name} · ${kit.roleLabel(person.role)} at ${storeName(state)}`,
    `Checked ${given}'s upcoming shifts: ${upcoming.length ? upcoming.map((s) => `${dateText(s.date)} ${s.start}–${s.end}`).join(", ") : "none"}`,
    "Checked open verifications and role requests: none",
    "Confirmed you're a manager at this store",
  ];
  const expiresAt = Date.now() + PLAN_TTL;
  const planItems = [
    {
      id: "account",
      label: `Delete ${person.name}'s account`,
      detail: `${kit.roleLabel(person.role)} · ${Number(person.stars) || 0} McStars`,
      status: "ok",
      note: "",
    },
    {
      id: "access",
      label: "Remove sign-in access",
      detail: `${given} will no longer be able to sign in to ${storeName(state)}`,
      status: "ok",
      note: "",
    },
  ];
  if (upcoming.length)
    planItems.push({
      id: "shifts",
      label: `Remove ${plural(upcoming.length, "upcoming shift")}`,
      detail: upcoming
        .slice(0, 3)
        .map((s) => `${dateText(s.date)} ${s.start}–${s.end}`)
        .join(" · "),
      status: "warning",
      note: "This leaves gaps on the rota. Plan cover afterwards.",
    });
  const pendingId = newPlan({ kind: "deleteAccount", personId: person.id, expiresAt });
  return {
    reply: `Before I do that, here's exactly what will happen. Deleting ${given}'s account can't be undone from McAssist${upcoming.length ? `, and ${given} still has ${plural(upcoming.length, "upcoming shift")}` : ""}.\n\nPlease check the plan and confirm.`,
    steps,
    pending: {
      id: pendingId,
      title: `Delete ${person.name}'s account`,
      summary: `Permanently removes ${given} from ${storeName(state)}. This can't be undone from McAssist.`,
      risk: "high",
      confirmLabel: "Delete account",
      cancelLabel: `Keep ${given}`,
      expiresAt,
      items: planItems,
    },
  };
}

function demoDeleteShifts(state, t) {
  const person = findPerson(state, t, { self: true });
  if (!person)
    return read("Whose shifts should I remove?", {
      suggestions: demoPeople(state)
        .slice(0, 3)
        .map((p) => `Remove ${firstNameOf(p.name)}'s shifts next week`),
    });
  const given = firstNameOf(person.name);
  let list = upcomingFor(state, person.id);
  const week = parseWeek(t);
  const days = parseDays(t);
  if (week !== null) {
    const range = weekDates(week);
    list = list.filter((s) => range.includes(s.date));
  }
  if (days.length) list = list.filter((s) => days.includes(dayKeyOf(s.date)));
  if (/\btomorrow\b/.test(t)) list = list.filter((s) => s.date === addDaysISO(isoDate(), 1));
  if (!list.length)
    return read(`${given} has no upcoming shifts that match, so there's nothing to remove.`, {
      steps: [`Checked ${given}'s upcoming shifts`],
    });
  const expiresAt = Date.now() + PLAN_TTL;
  const pendingId = newPlan({
    kind: "deleteShifts",
    shiftIds: list.map((s) => s.id),
    personId: person.id,
    expiresAt,
  });
  return {
    reply: `I found ${plural(list.length, "shift")} for ${given}. Removing shifts is destructive, so please confirm.`,
    steps: [`Found ${person.name}`, `Checked ${given}'s upcoming shifts: ${list.length} match`],
    pending: {
      id: pendingId,
      title: `Remove ${plural(list.length, "shift")} for ${person.name}`,
      summary: "These shifts will disappear from the rota and from the team member's schedule.",
      risk: "high",
      confirmLabel: `Remove ${plural(list.length, "shift")}`,
      cancelLabel: "Keep them",
      expiresAt,
      items: list.map((s) => ({
        id: s.id,
        label: `${dateText(s.date)} · ${s.start}–${s.end}`,
        detail: s.station || "Station not set",
        status: "ok",
        note: "",
      })),
    },
  };
}

function demoPayRate(state, t) {
  const person = findPerson(state, t, { self: false });
  const rate = Number(t.match(/£?\s*(\d{1,2}(?:\.\d{1,2})?)\b/)?.[1]);
  if (!person)
    return read("Whose hourly rate should I change?", {
      suggestions: demoPeople(state)
        .filter((p) => !isSelf(state, p))
        .slice(0, 3)
        .map((p) => `Set ${firstNameOf(p.name)}'s hourly rate to £12.60`),
    });
  const given = firstNameOf(person.name);
  if (!Number.isFinite(rate) || rate <= 0 || rate > 60)
    return read(`What should ${given}'s new hourly rate be?`, {
      suggestions: ["£12.60", "£13.00", "£13.55"],
    });
  const old = Number(person.hourlyRate);
  const expiresAt = Date.now() + PLAN_TTL;
  const pendingId = newPlan({ kind: "payRate", personId: person.id, rate, expiresAt });
  return {
    reply: `Pay changes always need your OK. Here's the change for ${given}.`,
    steps: [
      `Found ${person.name} · ${kit.roleLabel(person.role)}`,
      `Checked ${given}'s current rate: ${Number.isFinite(old) && old > 0 ? "£" + old.toFixed(2) : "not set"}`,
    ],
    pending: {
      id: pendingId,
      title: `Set ${person.name}'s hourly rate`,
      summary: "Used for pay estimates on the rota. It isn't payroll.",
      risk: "medium",
      confirmLabel: "Update pay rate",
      cancelLabel: "Not now",
      expiresAt,
      items: [
        {
          id: "rate",
          label: `Hourly rate · ${person.name}`,
          detail: `${Number.isFinite(old) && old > 0 ? "£" + old.toFixed(2) : "Not set"} → £${rate.toFixed(2)}`,
          status: rate < 10 ? "warning" : "ok",
          note: rate < 10 ? "That looks low. Double-check the minimum wage for their age band." : "",
        },
      ],
    },
  };
}

function demoPromote(state, t) {
  const person = findPerson(state, t, { self: false });
  if (!person)
    return read("Who should I promote?", {
      suggestions: demoPeople(state)
        .filter((p) => !isSelf(state, p))
        .slice(0, 3)
        .map((p) => `Promote ${firstNameOf(p.name)} to Crew Trainer`),
    });
  const role = /\bmanager\b/.test(t) ? "manager" : "crewTrainer";
  const given = firstNameOf(person.name);
  if (kit.normaliseRole(person.role) === role)
    return read(`${given} is already a ${kit.roleLabel(role)}, so nothing needs to change.`);
  const expiresAt = Date.now() + PLAN_TTL;
  const pendingId = newPlan({ kind: "role", personId: person.id, role, expiresAt });
  return {
    reply: `Role changes need your OK. Here's what changes for ${given}.`,
    steps: [
      `Found ${person.name} · ${kit.roleLabel(person.role)}`,
      `Checked ${given}'s verified stations: ${(person.verifiedStations || []).join(", ") || "none yet"}`,
    ],
    pending: {
      id: pendingId,
      title: `Promote ${person.name} to ${kit.roleLabel(role)}`,
      summary:
        role === "manager"
          ? "Managers can plan shifts, manage the team and approve McAssist plans."
          : "Crew Trainers can start station verifications and coach new starters.",
      risk: role === "manager" ? "high" : "medium",
      confirmLabel: `Make ${given} ${role === "manager" ? "a Manager" : "a Crew Trainer"}`,
      cancelLabel: "Not now",
      expiresAt,
      items: [
        {
          id: "role",
          label: `Role · ${person.name}`,
          detail: `${kit.roleLabel(person.role)} → ${kit.roleLabel(role)}`,
          status: "ok",
          note: "",
        },
        {
          id: "access",
          label: "Access updated",
          detail:
            role === "manager"
              ? "Team, rota and pay-rate tools unlocked"
              : "Station verification tools unlocked",
          status: (person.verifiedStations || []).length || role === "manager" ? "ok" : "warning",
          note:
            role === "crewTrainer" && !(person.verifiedStations || []).length
              ? `${given} has no verified stations yet. Most trainers are verified first.`
              : "",
        },
      ],
    },
  };
}

function demoStars(state, t) {
  const person = findPerson(state, t, { self: false });
  if (!person)
    return read("Who should get the McStars?", {
      suggestions: demoPeople(state)
        .filter((p) => !isSelf(state, p))
        .slice(0, 3)
        .map((p) => `Give ${firstNameOf(p.name)} 3 McStars for great customer service`),
    });
  const match = t.match(
    /\b(\d{1,2}|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:mc)?stars?\b/,
  );
  const amount = Math.min(
    match ? (/^\d+$/.test(match[1]) ? Number(match[1]) : NUMBER_WORDS[match[1]]) : 1,
    20,
  );
  const reason = t.match(/\bfor (.+)$/)?.[1]?.replace(/\.$/, "") || "";
  const given = firstNameOf(person.name);
  const total = (Number(person.stars) || 0) + amount;
  updatePerson(state, person.id, { stars: total });
  if (state.extras && typeof state.extras === "object") {
    const note = reason ? capitalise(reason) + "." : "Recognised by McAssist.";
    state.extras.recognition = [
      {
        id: "demo-" + newId(),
        userId: person.id,
        userName: person.name,
        amount,
        note,
        createdBy: state.user?.id || "",
        createdByName: state.user?.name || "Manager",
        createdAt: Date.now(),
        source: "mcassist",
      },
      ...(Array.isArray(state.extras.recognition) ? state.extras.recognition : []),
    ];
  }
  demoPersist(state);
  return {
    reply: `Done — ${given} now has **${total} McStars**. A single recognition like this is low risk, so I added it straight away.`,
    steps: [`Found ${person.name}`, `${given} had ${total - amount} McStars`],
    actions: [
      `Gave ${person.name} ${plural(amount, "McStar")}${reason ? " · " + reason : ""}`,
    ],
    dataChanged: true,
    suggestions: ["Show me the team", "Who's free to cover Friday evening?"],
  };
}

function demoAvailability(state, slots) {
  const person =
    demoPeople(state).find((p) => p.id === slots.personId) || state.user;
  const self = isSelf(state, person);
  const given = firstNameOf(person.name);
  const whose = self ? "your" : `${given}'s`;
  if (!slots.days?.length) {
    memWrite(demoConvoKey(), { intent: "availability", slots });
    return read(`Which day should I update ${whose} availability for?`, {
      suggestions: ["Friday", "Weekends", "Weekdays"],
    });
  }
  if (!slots.times && !slots.off) {
    memWrite(demoConvoKey(), { intent: "availability", slots });
    const dayNames = slots.days.map((d) => DAY_LONG[d]).join(", ");
    return read(`What times ${self ? "can you" : `can ${given}`} work on ${dayNames}?`, {
      suggestions: ["16:00–23:00", "09:00–17:00", "Not available"],
    });
  }
  memWrite(demoConvoKey(), null);
  const next = { ...(availabilityOf(person).sample ? {} : person.availability || {}) };
  for (const day of slots.days)
    next[day] = slots.off
      ? { available: false, start: "", end: "" }
      : { available: true, start: slots.times.start, end: slots.times.end };
  updatePerson(state, person.id, { availability: next });
  demoPersist(state);
  const dayNames = slots.days.map((d) => DAY_LONG[d]).join(", ");
  const value = slots.off ? "not available" : `${slots.times.start}–${slots.times.end}`;
  return {
    reply: `Done — ${whose} ${dayNames} availability is now **${value}**. Updating ${self ? "your own" : "a team member's"} availability is a single low-risk change, so I saved it straight away.${self ? " Your manager will see it right away." : ""}`,
    steps: [`Checked ${whose} current availability`, "Checked published shifts: availability doesn't move them"],
    actions: [`Updated ${self ? "your" : given + "'s"} availability · ${dayNames} ${value}`],
    dataChanged: true,
    suggestions: ["Show me my availability", "When am I working next?"],
  };
}

function demoWhoFree(state, t) {
  const date = parseQueryDate(t);
  const key = dayKeyOf(date);
  const window = /\bevening\b|\bnight\b|\bclos/.test(t)
    ? { start: "17:00", end: "23:00", label: "evening (17:00–23:00)" }
    : /\bmorning\b|\bopen/.test(t)
      ? { start: "06:00", end: "14:00", label: "morning (06:00–14:00)" }
      : null;
  const free = [];
  const busy = [];
  for (const person of demoPeople(state)) {
    const given = firstNameOf(person.name);
    const avail = dayWindow(availabilityOf(person).value, key);
    const working = (state.shifts || []).find(
      (s) => s.userId === person.id && s.date === date,
    );
    if (working) busy.push(`${given} (already on ${working.start}–${working.end})`);
    else if (avail.status === "on" && (!window || fitsWindow(window, avail)))
      free.push({ person, text: `${given} · free ${avail.start}–${avail.end}` });
    else if (avail.status === "unset")
      free.push({ person, text: `${given} · availability not set, check first` });
    else busy.push(`${given} (${avail.status === "off" ? "day off" : `free ${avail.start}–${avail.end} only`})`);
  }
  const when = `${dateText(date, { weekday: "long", day: "numeric", month: "short" })}${window ? " " + window.label : ""}`;
  const pick = free.find((f) => !f.text.includes("not set"))?.person;
  return read(
    free.length
      ? `Who can cover **${when}**:\n${free.map((f) => "- " + f.text).join("\n")}${busy.length ? `\n\nNot free: ${busy.join(", ")}.` : ""}`
      : `Nobody in the sample team is free for ${when}. ${busy.join(", ")}.`,
    {
      steps: ["Checked everyone's availability", `Checked the rota for ${dateText(date)}`],
      suggestions: pick
        ? [
            `Create a shift for ${firstNameOf(pick.name)} on ${DAY_LONG[key]} ${window ? `${window.start}–${window.end}` : "16:00–23:00"}`,
            "What's our coverage on Saturday?",
          ]
        : ["What's our coverage on Saturday?"],
    },
  );
}

function demoCoverage(state, t, manager) {
  const date = parseQueryDate(t);
  const label = dateText(date, { weekday: "long", day: "numeric", month: "short" });
  const selfId = state.user?.id;
  const shifts = (state.shifts || [])
    .filter((s) => s.date === date && (manager || s.userId === selfId))
    .sort((a, b) => a.start.localeCompare(b.start));
  if (!manager)
    return read(
      shifts.length
        ? `You're on **${label}**, ${shifts[0].start}–${shifts[0].end}${shifts[0].station ? " on " + shifts[0].station : ""}. I can only see your own shifts — your manager has the full rota.`
        : `You're not on the rota for ${label}. I can only see your own shifts — your manager has the full rota.`,
      { suggestions: ["When am I working next?", "How many hours am I working this week?"] },
    );
  if (!shifts.length)
    return read(`Nobody is on the sample rota for **${label}** yet — that's a gap to fill.`, {
      steps: [`Checked the rota for ${dateText(date)}`],
      suggestions: [
        `Who's free on ${DAY_LONG[dayKeyOf(date)]}?`,
        `Create a closing shift for ${firstNameOf(demoPeople(state).find((p) => !isSelf(state, p))?.name || S.firstName)} on ${DAY_LONG[dayKeyOf(date)]}`,
      ],
    });
  const earliest = shifts[0].start;
  const latestEnd = shifts
    .map((s) => (toMin(s.end) <= toMin(s.start) ? toMin(s.end) + 1440 : toMin(s.end)))
    .reduce((a, b) => Math.max(a, b), 0);
  const gaps = [];
  if (toMin(earliest) > 10 * 60) gaps.push(`nobody before ${earliest}, so breakfast and lunch are uncovered`);
  if (latestEnd < 23 * 60) gaps.push(`nobody after ${String(Math.floor(latestEnd / 60)).padStart(2, "0")}:${String(latestEnd % 60).padStart(2, "0")}, so close is uncovered`);
  const idle = demoPeople(state).filter(
    (p) => !shifts.some((s) => s.userId === p.id) && !isSelf(state, p),
  );
  const other = gaps.length
    ? idle.find(
        (p) =>
          dayWindow(availabilityOf(p).value, dayKeyOf(date)).status === "on",
      )
    : null;
  return read(
    `**${label}** · ${plural(shifts.length, "person", "people")} on the rota:\n${shifts.map((s) => `- ${s.userName || "Team member"} · ${s.start}–${s.end} · ${s.station || "station not set"}`).join("\n")}\n\n${gaps.length ? `Gaps: ${gaps.join("; ")}.` : "Opening to close is covered."}`,
    {
      steps: [`Checked the rota for ${dateText(date)}`, "Compared opening and closing times"],
      suggestions: other
        ? [
            `Create ${gaps.some((g) => g.includes("close")) ? "a closing" : "an opening"} shift for ${firstNameOf(other.name)} on ${DAY_LONG[dayKeyOf(date)]}`,
            `Who's free on ${DAY_LONG[dayKeyOf(date)]}?`,
          ]
        : [
            `Who's free on ${DAY_LONG[dayKeyOf(date)]}?`,
            "How many hours am I working this week?",
          ],
    },
  );
}

function demoTrainingGaps(state, t, manager) {
  const module = findModule(t) || (window.McModules?.modules || []).find((m) => m.id === "food-safety");
  if (!module) return read("Which module should I check?");
  if (!manager) {
    const done = state.progress?.[module.id]?.completed;
    return read(
      `I can only see your own learning. ${done ? `You've completed **${module.title}** — nice work.` : `You haven't completed **${module.title}** yet. It takes about ${module.time || "10 min"}.`}`,
      { suggestions: done ? ["Which module should I do next?"] : [`Open the ${module.title} module`, `Quiz me on ${module.title}`] },
    );
  }
  const team = demoPeople(state).filter((p) => !isSelf(state, p));
  const records = state.extras?.teamProgress;
  // Sample learning records when the preview has them; otherwise a stable
  // pseudo-random split so the demo always tells the same story.
  const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const completed = (person, id) =>
    records && typeof records === "object"
      ? Array.isArray(records[person.id]) && records[person.id].includes(id)
      : hash(person.id + id) % 3 === 0;
  const missing = team.filter((p) => !completed(p, module.id));
  const done = team.filter((p) => completed(p, module.id));
  let extra = "";
  if (!missing.length) {
    const gap = (window.McModules?.modules || [])
      .filter((m) => m.id !== module.id && (!m.roles || m.roles.includes("crew")))
      .map((m) => ({ m, people: team.filter((p) => !completed(p, m.id)) }))
      .find((g) => g.people.length);
    if (gap)
      extra = `\n\nWorth a look: ${gap.people.slice(0, 4).map((p) => firstNameOf(p.name)).join(", ")}${gap.people.length > 4 ? ` and ${gap.people.length - 4} more` : ""} still ${gap.people.length === 1 ? "needs" : "need"} **${gap.m.title}**.`;
  }
  return read(
    missing.length
      ? `**${plural(missing.length, "person", "people")}** ${missing.length === 1 ? "hasn't" : "haven't"} completed ${module.title} yet:\n${missing.map((p) => `- ${p.name}`).join("\n")}${done.length ? `\n\nCompleted: ${done.map((p) => firstNameOf(p.name)).join(", ")}.` : ""}`
      : `Good news — everyone in the team has completed **${module.title}**.${extra}`,
    {
      steps: [`Checked ${plural(team.length, "learning record")} for ${module.title}`],
      suggestions: [`Teach me the ${module.title} basics`, "Who's free to cover Friday evening?"],
    },
  );
}

function demoTeach(module) {
  const sections = (module.sections || []).slice(0, 4);
  return read(
    `**${module.title}**${module.time ? ` · ${module.time}` : ""}\n${module.tagline || ""}\n\n${sections.map((s) => `- **${s.title}** — ${s.text}`).join("\n")}\n\nYour trainer and your restaurant's official guidance always come first.`,
    {
      suggestions: [`Quiz me on ${module.title}`, `Open the ${module.title} module`],
    },
  );
}

function demoQuiz(module, index) {
  if (!module?.quiz?.length)
    return read("That module doesn't have a quiz yet. Try another topic.", {
      suggestions: ["Quiz me on food safety"],
    });
  const i = index % module.quiz.length;
  const question = module.quiz[i];
  memWrite(demoConvoKey(), { intent: "quiz", moduleId: module.id, index: i });
  return read(`**Quick quiz · ${module.title}** (question ${i + 1} of ${module.quiz.length})\n${question.q}`, {
    suggestions: question.a.slice(0, 4),
  });
}

function demoNextModule(state) {
  const modules = (window.McModules?.modules || []).filter(
    (m) => !m.roles || m.roles.includes(kit.preview === "manager" ? "manager" : "crew"),
  );
  const next = modules.find((m) => !state.progress?.[m.id]?.completed);
  const done = modules.filter((m) => state.progress?.[m.id]?.completed).length;
  if (!next) return read("You've completed every module — brilliant work!");
  return read(
    `You've completed ${done} of ${modules.length} modules. Next up: **${next.title}**${next.time ? ` (${next.time})` : ""} — ${String(next.tagline || "a good one to do next").replace(/\.$/, "")}.`,
    { suggestions: [`Open the ${next.title} module`, `Teach me the ${next.title} basics`] },
  );
}

function demoNextShift(state, self) {
  const upcoming = upcomingFor(state, self?.id);
  if (!upcoming.length)
    return read("You don't have any upcoming shifts on the sample rota. New shifts appear here as soon as they're published.", {
      suggestions: ["Set my Friday availability to 16:00–23:00"],
    });
  const [next, after] = upcoming;
  const paid = durationLabel(shiftMinutes(next));
  const onNow = new Date(`${next.date}T${next.start}`) <= new Date();
  const when = `**${dateText(next.date, { weekday: "long", day: "numeric", month: "short" })}, ${next.start}–${next.end}**`;
  const where = `**${next.station || "a station to be confirmed"}**`;
  return read(
    `${onNow ? `You're on shift right now: ${when} on ${where}, until ${next.end}.` : `Your next shift is ${when} on ${where} (${paid} paid) at ${storeName(state)}.`}${after ? `\n\n${onNow ? "Next up" : "After that"}: ${dateText(after.date)}, ${after.start}–${after.end}${after.station ? " on " + after.station : ""}.` : ""}`,
    {
      steps: ["Checked your published shifts"],
      suggestions: ["Help me prepare for my next shift", "How many hours am I working this week?"],
    },
  );
}

function demoHours(state, self, t) {
  const offset = /\bnext week\b/.test(t) ? 1 : 0;
  const days = weekDates(offset);
  const shifts = (state.shifts || []).filter(
    (s) => s.userId === self?.id && days.includes(s.date),
  );
  const minutes = shifts.reduce((sum, s) => sum + shiftMinutes(s), 0);
  const rate = Number(self?.hourlyRate || state.user?.hourlyRate);
  const pay =
    Number.isFinite(rate) && rate > 0
      ? ` That's about **${new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format((minutes / 60) * rate)}** before tax at ${new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(rate)}/h — an estimate, not payroll.`
      : "";
  return read(
    shifts.length
      ? `${offset ? "Next week" : "This week"} you're booked for **${plural(shifts.length, "shift")}**, **${durationLabel(minutes)} paid** after breaks.${pay}\n${shifts.map((s) => `- ${dateText(s.date)} · ${s.start}–${s.end}${s.station ? " · " + s.station : ""}`).join("\n")}`
      : `You're not on the rota ${offset ? "next week" : "this week"} yet.`,
    {
      steps: [`Checked your shifts for ${dateText(days[0], { day: "numeric", month: "short" })} – ${dateText(days[6], { day: "numeric", month: "short" })}`],
      suggestions: offset ? ["When am I working next?"] : ["How many hours am I working next week?", "When am I working next?"],
    },
  );
}

function demoPrep(state, self) {
  const next = upcomingFor(state, self?.id)[0];
  const module = next?.station ? findModule(normText(next.station)) : null;
  const tips = module?.sections?.slice(0, 2).map((s) => `- **${s.title}** — ${s.text}`) || [];
  return read(
    `${next ? `Your next shift is **${dateText(next.date, { weekday: "long", day: "numeric", month: "short" })}, ${next.start}–${next.end}** on **${next.station || "a station to be confirmed"}**.` : "You don't have a shift booked yet, but here's how to get ready."}\n\nQuick prep:\n- Arrive a few minutes early and find your shift lead\n- Check your station is stocked and clean before the rush\n- Ask if anything has changed since your last shift${tips.length ? `\n\nFrom ${module.title}:\n${tips.join("\n")}` : ""}`,
    {
      suggestions: module
        ? [`Quiz me on ${module.title}`, "How many hours am I working this week?"]
        : ["Which module should I do next?"],
    },
  );
}

function demoConfirm(confirm) {
  const plans = memRead(demoPlansKey(), {}) || {};
  const plan = plans[confirm.pendingId];
  if (!plan)
    throw demoError(
      404,
      "That plan is no longer available, so nothing was changed. Ask again and I'll prepare a fresh one.",
    );
  if (plan.supersededBy)
    throw demoError(
      409,
      "That plan was replaced by a newer one, so nothing was changed. Use the latest plan card.",
    );
  delete plans[confirm.pendingId];
  memWrite(demoPlansKey(), plans);
  if (plan.expiresAt < Date.now())
    throw demoError(
      410,
      "That plan expired after 15 minutes, so nothing was changed. Ask again and I'll prepare a fresh one.",
    );
  if (confirm.decision === "cancel")
    return {
      reply: "No problem — I've cancelled that plan. Nothing was changed.",
      results: [],
      actions: [],
      suggestions: startersFor("page").slice(0, 2),
    };
  const state = demoState();
  const person = demoPeople(state).find((p) => p.id === plan.personId);
  if (!person)
    return {
      reply: "That team member isn't in the sample team any more, so nothing was changed.",
      results: [{ itemId: "account", ok: false, message: "Team member not found" }],
    };
  const given = firstNameOf(person.name);
  if (plan.kind === "createShifts") {
    const results = [];
    const actions = [];
    for (const s of plan.shifts) {
      if (s.status === "blocked") continue; // Blocked items are skipped.
      const shift = {
        id: "demo-" + newId(),
        date: s.date,
        start: s.start,
        end: s.end,
        breakMinutes: 30,
        userId: person.id,
        userName: person.name,
        station: plan.station,
      };
      const clash = state.shifts.find(
        (x) =>
          x.userId === person.id &&
          x.date &&
          validTime(x.start) &&
          validTime(x.end) &&
          overlap(x, shift),
      );
      if (clash) {
        results.push({
          itemId: s.itemId,
          ok: false,
          message: `Not added: now clashes with ${clash.start}–${clash.end}`,
        });
        continue;
      }
      state.shifts.push(shift);
      results.push({ itemId: s.itemId, ok: true, message: "Added to the rota" });
      actions.push(
        `Created ${person.name} · ${dateText(s.date)} · ${s.start}–${s.end} · ${plan.station}`,
      );
    }
    demoPersist(state);
    const added = results.filter((r) => r.ok).length;
    const firstAdded = plan.shifts.find((s) =>
      results.some((r) => r.itemId === s.itemId && r.ok),
    );
    if (firstAdded) memWrite(demoLastKey(), { date: firstAdded.date });
    return {
      reply: added
        ? `Done — I re-checked everything and added **${plural(added, "shift")}** for ${given} to the sample rota.${added < results.length ? ` ${results.length - added} couldn't be added because things changed.` : ""} ${isSelf(state, person) ? "They're on My shifts and the schedule now." : "They're on the schedule now."}`
        : "Things changed since the plan was made, so nothing was added.",
      steps: ["Re-checked availability and clashes for every shift", "Saved to the sample rota"],
      actions,
      results,
      dataChanged: added > 0,
      suggestions: added
        ? ["Show me on the schedule", "What's our coverage on Saturday?"]
        : ["What's our coverage on Saturday?"],
    };
  }
  if (plan.kind === "deleteAccount") {
    const removedShifts = state.shifts.filter((s) => s.userId === person.id && s.date >= isoDate()).length;
    state.team = state.team.filter((p) => p?.id !== person.id);
    state.shifts = state.shifts.filter((s) => !(s.userId === person.id && s.date >= isoDate()));
    demoPersist(state);
    return {
      reply: `Done. ${person.name}'s account has been deleted from the sample team${removedShifts ? ` and ${plural(removedShifts, "upcoming shift")} came off the rota` : ""}.`,
      actions: [
        `Deleted ${person.name}'s account`,
        ...(removedShifts ? [`Removed ${plural(removedShifts, "upcoming shift")}`] : []),
      ],
      results: [
        { itemId: "account", ok: true, message: "Account deleted" },
        { itemId: "access", ok: true, message: "Sign-in access removed" },
        ...(removedShifts ? [{ itemId: "shifts", ok: true, message: `${plural(removedShifts, "shift")} removed` }] : []),
      ],
      dataChanged: true,
      suggestions: ["Show me the team", "What's our coverage on Saturday?"],
    };
  }
  if (plan.kind === "deleteShifts") {
    const results = plan.shiftIds.map((id) => {
      const exists = state.shifts.some((s) => s.id === id);
      return { itemId: id, ok: exists, message: exists ? "Removed" : "Already gone" };
    });
    state.shifts = state.shifts.filter((s) => !plan.shiftIds.includes(s.id));
    demoPersist(state);
    const removed = results.filter((r) => r.ok).length;
    return {
      reply: `Done — ${plural(removed, "shift")} removed for ${given}.`,
      actions: [`Removed ${plural(removed, "shift")} for ${person.name}`],
      results,
      dataChanged: true,
      suggestions: ["Show me the schedule", `Who's free to cover Friday evening?`],
    };
  }
  if (plan.kind === "payRate") {
    updatePerson(state, person.id, { hourlyRate: plan.rate });
    demoPersist(state);
    return {
      reply: `Done — ${given}'s hourly rate is now £${plan.rate.toFixed(2)}.`,
      actions: [`Set ${person.name}'s hourly rate to £${plan.rate.toFixed(2)}`],
      results: [{ itemId: "rate", ok: true, message: "Rate updated" }],
      dataChanged: true,
    };
  }
  if (plan.kind === "role") {
    updatePerson(state, person.id, { role: plan.role });
    demoPersist(state);
    return {
      reply: `Done — ${given} is now a ${kit.roleLabel(plan.role)}.`,
      actions: [`Promoted ${person.name} to ${kit.roleLabel(plan.role)}`],
      results: [
        { itemId: "role", ok: true, message: "Role updated" },
        { itemId: "access", ok: true, message: "Access updated" },
      ],
      dataChanged: true,
      suggestions: ["Show me the team"],
    };
  }
  return {
    reply: "That plan type isn't part of the demo, so nothing was changed.",
    results: [],
  };
}
