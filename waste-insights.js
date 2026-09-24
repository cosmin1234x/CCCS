// Waste graphics: daily 7/30-day comparisons from saved sheets.
// Ported from the standalone Hayle Waste Counter (insights.js v17). Dates use
// the London calendar; days without a saved sheet stay unknown rather than 0.

const londonDate = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const shortDate = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" });
const longDate = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  weekday: "short",
  day: "numeric",
  month: "long",
  year: "numeric",
});
const numberFormat = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });

export function dayKey(value) {
  if (!(value instanceof Date) && typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(londonDate.formatToParts(date).map((part) => [part.type, part.value]));
  const key = `${parts.year}-${parts.month}-${parts.day}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null;
}

// Move calendar dates in UTC, after conversion to the London calendar. Adding
// milliseconds to a London timestamp would skip/repeat dates at DST changes.
export function shiftDay(key, amount) {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function validCount(value) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 && count <= Number.MAX_SAFE_INTEGER ? Math.floor(count) : null;
}

function add(a, b) {
  return Math.min(Number.MAX_SAFE_INTEGER, a + b);
}

export function sheetCounts(sheet) {
  if (!sheet || typeof sheet !== "object") return null;
  const totals = sheet.totals && typeof sheet.totals === "object" ? sheet.totals : {};
  const counts = { raw: validCount(totals.raw), full: validCount(totals.full) };
  const entries = { raw: 0, full: 0 };
  let hasEntries = false;
  for (const entry of Array.isArray(sheet.entries) ? sheet.entries : []) {
    if (!entry || (entry.type !== "raw" && entry.type !== "full")) continue;
    const count = validCount(entry.count);
    if (count === null) continue;
    entries[entry.type] = add(entries[entry.type], count);
    hasEntries = true;
  }
  if (counts.raw === null && counts.full === null && !hasEntries) return null;
  const raw = counts.raw === null ? entries.raw : counts.raw;
  const full = counts.full === null ? entries.full : counts.full;
  return { raw, full, total: add(raw, full) };
}
export const sheetTotals = sheetCounts;

export function aggregateDaily(history) {
  const byDay = new Map();
  const uniqueSheets = new Map();
  for (const [index, sheet] of (Array.isArray(history) ? history : []).entries()) {
    if (!sheet || typeof sheet !== "object") continue;
    const key = dayKey(sheet.createdAt);
    const counts = sheetCounts(sheet);
    if (!key || !counts) continue;
    // Cloud merging normally deduplicates IDs; this also makes imported or
    // older local history safe to display without counting an ID twice.
    const id = typeof sheet.id === "string" && sheet.id ? `id:${sheet.id}` : `index:${index}`;
    const time = new Date(sheet.createdAt).getTime();
    if (!uniqueSheets.has(id) || time > uniqueSheets.get(id).time) uniqueSheets.set(id, { key, counts, time });
  }
  for (const { key, counts } of uniqueSheets.values()) {
    const day = byDay.get(key) || { date: key, raw: 0, full: 0, total: 0, sheets: 0, recorded: true };
    day.raw = add(day.raw, counts.raw);
    day.full = add(day.full, counts.full);
    day.total = add(day.raw, day.full);
    day.sheets += 1;
    byDay.set(key, day);
  }
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function buildPeriod(history, options = {}) {
  const range = Number(options.range) === 30 ? 30 : 7;
  const type = options.type === "raw" || options.type === "full" ? options.type : "all";
  const metric = type === "all" ? "total" : type;
  const end = dayKey(options.now === undefined ? new Date() : options.now) || dayKey(new Date());
  const start = shiftDay(end, 1 - range);
  const allDays = aggregateDaily(history);
  const byDay = new Map();
  let previous = null;
  for (const day of allDays) {
    const row = {
      ...day,
      value: day[metric],
      previousDate: previous ? previous.date : null,
      previousValue: previous ? previous[metric] : null,
      delta: previous ? day[metric] - previous[metric] : null,
    };
    byDay.set(day.date, row);
    previous = day;
  }
  const days = Array.from({ length: range }, (_, index) => {
    const date = shiftDay(start, index);
    return (
      byDay.get(date) || {
        date,
        recorded: false,
        raw: null,
        full: null,
        total: null,
        value: null,
        sheets: 0,
        delta: null,
        previousDate: null,
        previousValue: null,
      }
    );
  });
  const recordedDays = days.filter((day) => day.recorded);
  const total = recordedDays.reduce((sum, day) => add(sum, day.value), 0);
  return {
    range,
    type,
    metric,
    start,
    end,
    days,
    recordedDays,
    total,
    average: recordedDays.length ? total / recordedDays.length : null,
    sheetCount: recordedDays.reduce((sum, day) => sum + day.sheets, 0),
    latest: recordedDays[recordedDays.length - 1] || null,
  };
}

function escapeHTML(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
  );
}

export function labelDate(key, long = false) {
  return (long ? longDate : shortDate).format(new Date(`${key}T12:00:00Z`));
}

export function formatNumber(value) {
  return numberFormat.format(value);
}

export function deltaText(delta) {
  if (delta === null) return "No earlier saved day";
  if (delta === 0) return "No change";
  return `${delta > 0 ? "+" : "−"}${formatNumber(Math.abs(delta))} units`;
}

export function deltaClass(delta) {
  return delta === null || delta === 0 ? "is-neutral" : delta < 0 ? "is-lower" : "is-higher";
}

export function metricLabel(type) {
  return type === "raw" ? "Raw waste" : type === "full" ? "Full waste" : "Total waste";
}

export function dayReadout(day, type) {
  if (!day.recorded) return `${labelDate(day.date, true)} · No saved sheet. Waste for this day is unknown.`;
  const comparison = day.previousDate
    ? `${deltaText(day.delta)} compared with ${labelDate(day.previousDate)}`
    : "Save another day to compare.";
  return `${labelDate(day.date, true)} · ${metricLabel(type)}: ${formatNumber(day.value)} units · ${formatNumber(day.raw)} raw + ${formatNumber(day.full)} full · ${day.sheets} saved sheet${day.sheets === 1 ? "" : "s"} · ${comparison}`;
}

// Renders the graphics view into the given elements. Returns the period.
export function renderInsights(el, history, { range = 7, type = "all", now } = {}) {
  if (!el?.summary || !el?.chart || !el?.breakdown) return null;
  const period = buildPeriod(history, { range, type, now });
  if (el.rangeLabel)
    el.rangeLabel.textContent = `${labelDate(period.start)} – ${labelDate(period.end)} · From saved sheets · London time`;
  if (el.empty) el.empty.hidden = period.recordedDays.length > 0;
  const latest = period.latest;
  el.summary.innerHTML = `
    <article class="waste-stat"><span class="waste-stat-label">${metricLabel(period.type)}</span><strong class="waste-stat-value">${period.recordedDays.length ? formatNumber(period.total) : "—"}<small>units</small></strong><span class="waste-stat-caption">${period.sheetCount} saved sheet${period.sheetCount === 1 ? "" : "s"} in the last ${period.range} days</span></article>
    <article class="waste-stat"><span class="waste-stat-label">Daily average</span><strong class="waste-stat-value">${period.average === null ? "—" : formatNumber(period.average)}<small>units</small></strong><span class="waste-stat-caption">Across ${period.recordedDays.length} recorded day${period.recordedDays.length === 1 ? "" : "s"}</span></article>
    <article class="waste-stat"><span class="waste-stat-label">Latest recorded day</span><strong class="waste-stat-value ${deltaClass(latest?.delta ?? null)}">${latest ? formatNumber(latest.value) : "—"}<small>units</small></strong><span class="waste-stat-caption">${latest ? `${labelDate(latest.date)} · ${deltaText(latest.delta)}${latest.previousDate ? ` vs ${labelDate(latest.previousDate)}` : ""}` : "Save a sheet to start comparing"}</span></article>`;

  const maximum = Math.max(
    1,
    ...period.recordedDays.map((day) => (period.type === "all" ? day.raw + day.full : day.value)),
  );
  const selectedDate = latest?.date || period.end;
  const bars = period.days
    .map((day) => {
      const rawHeight = day.recorded && period.type !== "full" ? (day.raw / maximum) * 100 : 0;
      const fullHeight = day.recorded && period.type !== "raw" ? (day.full / maximum) * 100 : 0;
      return `<button type="button" class="waste-chart-day${day.recorded ? "" : " is-missing"}${day.date === selectedDate ? " is-selected" : ""}" data-day="${day.date}" aria-pressed="${day.date === selectedDate}" aria-label="${escapeHTML(dayReadout(day, period.type))}">
        <span class="waste-chart-value">${day.recorded ? formatNumber(day.value) : "—"}</span>
        <span class="waste-chart-column" aria-hidden="true">${
          day.recorded
            ? `<span class="waste-chart-seg full" style="height:${fullHeight}%"></span><span class="waste-chart-seg raw" style="height:${rawHeight}%"></span>${day.value === 0 ? '<span class="waste-chart-zero"></span>' : ""}`
            : '<span class="waste-chart-none">·</span>'
        }</span>
        <span class="waste-chart-label">${labelDate(day.date)}</span></button>`;
    })
    .join("");
  el.chart.innerHTML = `<div class="waste-chart-legend">${period.type !== "full" ? '<span><i class="waste-legend-dot raw" aria-hidden="true"></i>Raw</span>' : ""}${period.type !== "raw" ? '<span><i class="waste-legend-dot full" aria-hidden="true"></i>Full</span>' : ""}<span class="waste-legend-note">— No saved sheet</span></div>
    <div class="waste-chart-scroll"><div class="waste-chart-bars" role="group" aria-label="Daily ${metricLabel(period.type).toLowerCase()} in units. Select a day for details." style="--chart-days:${period.range}">${bars}</div></div>
    <p class="waste-chart-readout" aria-live="polite" aria-atomic="true">${escapeHTML(dayReadout(period.days.find((day) => day.date === selectedDate), period.type))}</p>`;
  const readout = el.chart.querySelector(".waste-chart-readout");
  const buttons = Array.from(el.chart.querySelectorAll(".waste-chart-day"));
  function selectDay(button) {
    const day = period.days.find((item) => item.date === button.dataset.day);
    if (!day) return;
    buttons.forEach((item) => {
      item.classList.toggle("is-selected", item === button);
      item.setAttribute("aria-pressed", String(item === button));
    });
    if (readout) readout.textContent = dayReadout(day, period.type);
  }
  buttons.forEach((button, index) => {
    button.addEventListener("click", () => selectDay(button));
    button.addEventListener("focus", () => selectDay(button));
    button.addEventListener("mouseenter", () => selectDay(button));
    button.addEventListener("keydown", (event) => {
      let target = null;
      if (event.key === "ArrowRight") target = Math.min(buttons.length - 1, index + 1);
      if (event.key === "ArrowLeft") target = Math.max(0, index - 1);
      if (event.key === "Home") target = 0;
      if (event.key === "End") target = buttons.length - 1;
      if (target === null) return;
      event.preventDefault();
      buttons[target].focus();
    });
  });
  // On narrow screens the 30-day chart scrolls inside its own panel; start at
  // the most recent days.
  const scroller = el.chart.querySelector(".waste-chart-scroll");
  if (scroller) scroller.scrollLeft = scroller.scrollWidth;

  el.breakdown.innerHTML = period.recordedDays.length
    ? `<div class="waste-table-scroll"><table class="waste-table"><caption>Saved days · Change in ${period.type === "all" ? "total" : period.type} waste since the previous recorded day</caption><thead><tr><th scope="col">Day</th><th scope="col">Raw</th><th scope="col">Full</th><th scope="col">Total</th><th scope="col">Change</th></tr></thead><tbody>${[
        ...period.recordedDays,
      ]
        .reverse()
        .map(
          (day) =>
            `<tr><th scope="row">${labelDate(day.date)}<small>${day.sheets} sheet${day.sheets === 1 ? "" : "s"}</small></th><td>${formatNumber(day.raw)}</td><td>${formatNumber(day.full)}</td><td><strong>${formatNumber(day.total)}</strong></td><td class="${deltaClass(day.delta)}">${deltaText(day.delta)}${day.previousDate ? `<small>vs ${labelDate(day.previousDate)}</small>` : ""}</td></tr>`,
        )
        .join("")}</tbody></table></div>`
    : "";
  return period;
}
