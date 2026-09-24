// Graphics maths and PDF output for the waste counter. The insights cases are
// ported from the standalone Hayle Waste Counter's insights tests.
import assert from "node:assert/strict";
import test from "node:test";
import * as insights from "../waste-insights.js";
import { buildPdfPages, createPaperPdf, pdfSafeText, wrapPdfText } from "../waste-pdf.js";

function sheet(id, createdAt, raw, full) {
  return { id, createdAt, totals: { raw, full, total: raw + full }, entries: [] };
}

test("London calendar dates handle summer midnight and both DST transitions", () => {
  assert.equal(insights.dayKey("2026-09-10T23:30:00Z"), "2026-09-11");
  assert.equal(insights.dayKey("2026-01-10T23:30:00Z"), "2026-01-10");
  assert.equal(insights.dayKey("2026-03-29T00:30:00Z"), "2026-03-29");
  assert.equal(insights.dayKey("2026-03-29T23:30:00Z"), "2026-03-30");
  assert.equal(insights.dayKey("2026-10-25T00:30:00Z"), "2026-10-25");
  assert.equal(insights.dayKey("2026-10-25T01:30:00Z"), "2026-10-25");
  assert.equal(insights.dayKey("2026-10-25T23:30:00Z"), "2026-10-25");
});

test("range always has consecutive calendar dates over a DST change and month boundary", () => {
  const spring = insights.buildPeriod([], { now: "2026-03-31T12:00:00Z", range: 7 });
  assert.deepEqual(
    spring.days.map((day) => day.date),
    ["2026-03-25", "2026-03-26", "2026-03-27", "2026-03-28", "2026-03-29", "2026-03-30", "2026-03-31"],
  );
  const autumn = insights.buildPeriod([], { now: "2026-11-01T12:00:00Z", range: 30 });
  assert.equal(autumn.days.length, 30);
  assert.equal(new Set(autumn.days.map((day) => day.date)).size, 30);
  assert.equal(autumn.start, "2026-10-03");
  assert.equal(autumn.end, "2026-11-01");
});

test("daily aggregation sums saved sheets in London dates and deduplicates sheet IDs", () => {
  const history = [
    sheet("second", "2026-09-11T15:00:00Z", 5, 3),
    sheet("first", "2026-09-10T23:30:00Z", 10, 2),
    sheet("earlier", "2026-09-10T12:00:00Z", 4, 1),
    sheet("second", "2026-09-11T15:00:00Z", 5, 3),
  ];
  const before = JSON.stringify(history);
  assert.deepEqual(insights.aggregateDaily(history), [
    { date: "2026-09-10", raw: 4, full: 1, total: 5, sheets: 1, recorded: true },
    { date: "2026-09-11", raw: 15, full: 5, total: 20, sheets: 2, recorded: true },
  ]);
  assert.equal(JSON.stringify(history), before, "aggregation must not mutate cloud/local history");
});

test("missing days remain unknown and are excluded from average and comparisons", () => {
  const model = insights.buildPeriod(
    [sheet("outside", "2026-09-01T12:00:00Z", 14, 6), sheet("a", "2026-09-06T12:00:00Z", 3, 1), sheet("b", "2026-09-10T12:00:00Z", 7, 5)],
    { now: "2026-09-11T12:00:00Z", range: 7 },
  );
  assert.equal(model.start, "2026-09-05");
  assert.equal(model.total, 16);
  assert.equal(model.average, 8);
  assert.equal(model.recordedDays.length, 2);
  assert.equal(model.days[0].recorded, false);
  assert.equal(model.days[0].value, null);
  assert.equal(model.recordedDays[0].previousDate, "2026-09-01");
  assert.equal(model.recordedDays[0].delta, -16);
  assert.equal(model.latest.previousDate, "2026-09-06");
  assert.equal(model.latest.delta, 8);
  assert.match(insights.dayReadout(model.days[0], "all"), /unknown/);
});

test("RAW and FULL filters change chart values, summaries and comparison units", () => {
  const history = [sheet("a", "2026-09-10T12:00:00Z", 10, 2), sheet("b", "2026-09-11T12:00:00Z", 5, 4)];
  const raw = insights.buildPeriod(history, { now: "2026-09-11T12:00:00Z", type: "raw" });
  const full = insights.buildPeriod(history, { now: "2026-09-11T12:00:00Z", type: "full" });
  assert.equal(raw.total, 15);
  assert.equal(raw.average, 7.5);
  assert.equal(raw.latest.value, 5);
  assert.equal(raw.latest.delta, -5);
  assert.equal(full.total, 6);
  assert.equal(full.latest.value, 4);
  assert.equal(full.latest.delta, 2);
  assert.equal(full.latest.total, 9, "original total is retained for the breakdown table");
  assert.match(insights.dayReadout(raw.latest, "raw"), /Raw waste: 5 units/);
});

test("empty history, unavailable history and out-of-period records do not fabricate data", () => {
  for (const history of [[], null, {}, [sheet("old", "2020-01-01T12:00:00Z", 8, 2)], [sheet("future", "2030-01-01T12:00:00Z", 8, 2)]]) {
    const model = insights.buildPeriod(history, { now: "2026-09-11T12:00:00Z" });
    assert.equal(model.total, 0);
    assert.equal(model.average, null);
    assert.equal(model.latest, null);
    assert.equal(model.sheetCount, 0);
    assert.ok(model.days.every((day) => day.recorded === false && day.total === null));
  }
});

test("a saved zero day is recorded, unlike an absent day, without division by zero", () => {
  const model = insights.buildPeriod([sheet("zero", "2026-09-10T12:00:00Z", 0, 0), sheet("later", "2026-09-11T12:00:00Z", 2, 0)], {
    now: "2026-09-11T12:00:00Z",
  });
  assert.equal(model.recordedDays[0].value, 0);
  assert.equal(model.average, 1);
  assert.equal(model.latest.delta, 2);
  assert.equal(model.latest.previousValue, 0);
  assert.match(insights.dayReadout(model.latest, "all"), /\+2 units/);
  assert.doesNotMatch(insights.dayReadout(model.latest, "all"), /NaN|Infinity|%/);
});

test("legacy entry-only sheets normalise string counts and reject negative/non-finite entries", () => {
  const totals = insights.sheetTotals({
    entries: [
      { type: "raw", count: "4" },
      { type: "full", count: "3" },
      { type: "raw", count: -9 },
      { type: "full", count: Infinity },
      { type: "raw", count: "<script>" },
      { type: "other", count: 100 },
      null,
      { type: "raw", count: true },
      { type: "full", count: {} },
    ],
  });
  assert.deepEqual(totals, { raw: 4, full: 3, total: 7 });
  assert.deepEqual(insights.sheetTotals({ totals: { raw: "8", full: "2", total: "untrusted total" } }), { raw: 8, full: 2, total: 10 });
  assert.equal(insights.sheetTotals({ totals: { raw: "bad", full: -1 } }), null);
});

test("malformed dates and sheets cannot produce invalid chart values", () => {
  for (const value of [null, undefined, "", "bad date", NaN, Infinity, {}, [], true]) assert.equal(insights.dayKey(value), null);
  assert.deepEqual(
    insights.aggregateDaily([
      null,
      {},
      { createdAt: "bad date", totals: { raw: 1, full: 2 } },
      { createdAt: null, totals: { raw: 1, full: 2 } },
      { createdAt: "2026-09-11T12:00:00Z", entries: "<script>" },
    ]),
    [],
  );
  const model = insights.buildPeriod([sheet("large", "2026-09-11T12:00:00Z", Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)], {
    now: "2026-09-11T12:00:00Z",
  });
  assert.ok(Number.isFinite(model.total));
  assert.ok(Number.isFinite(model.average));
});

test("unknown filters normalise to the seven-day total view and rendering is safe without elements", () => {
  const model = insights.buildPeriod([], { now: "2026-09-11T12:00:00Z", range: "bad", type: "<script>" });
  assert.equal(model.range, 7);
  assert.equal(model.type, "all");
  assert.doesNotThrow(() => insights.renderInsights(null, []));
  assert.equal(insights.renderInsights({}, []), null);
});

// ------------------------------------------------------------------ paper
function entries(count, type = "raw") {
  return Array.from({ length: count }, (_, i) => ({ id: `${type}-${i}`, name: `${type.toUpperCase()} item ${i + 1}`, type, count: i + 1 }));
}

function parsePdf(bytes) {
  const text = Buffer.from(bytes).toString("latin1");
  return text;
}

test("the paper PDF is a valid A4 document with correct cross-reference offsets", () => {
  const pdf = createPaperPdf({
    entries: [...entries(3, "raw"), ...entries(2, "full")],
    label: "Close · Cosmin",
    notes: "Busy night — lots of fries (check fryer).",
    createdAt: "2026-09-11T21:30:00Z",
  });
  assert.ok(pdf);
  assert.match(pdf.filename, /^hayle-waste-paper-\d{4}-\d{2}-\d{2}-\d{4}\.pdf$/);
  assert.equal(pdf.data.rawTotal, 6);
  assert.equal(pdf.data.fullTotal, 3);
  const text = parsePdf(pdf.bytes);
  assert.ok(text.startsWith("%PDF-1.4"));
  assert.ok(text.trimEnd().endsWith("%%EOF"));
  assert.match(text, /\/MediaBox \[0 0 595 842\]/);
  assert.match(text, /\(Waste Sheet\) Tj/);
  assert.match(text, /\(Close - Cosmin - /);
  assert.match(text, /fryer\\\)/, "parentheses are escaped");
  assert.match(text, /\/Count 1 /);
  // Every xref entry must point at the start of its object.
  const bytes = Buffer.from(pdf.bytes);
  const startxref = Number(text.match(/startxref\n(\d+)/)[1]);
  assert.equal(bytes.subarray(startxref, startxref + 4).toString("latin1"), "xref");
  const offsets = [...text.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  assert.ok(offsets.length >= 5);
  offsets.forEach((offset, index) => {
    assert.equal(bytes.subarray(offset, offset + String(index + 1).length + 6).toString("latin1"), `${index + 1} 0 obj`);
  });
});

test("long sheets continue onto more pages and empty sheets produce no PDF", () => {
  const pages = buildPdfPages({ raw: entries(25), full: entries(3, "full"), rawTotal: 325, fullTotal: 6, total: 331, label: "Big", notes: "", date: new Date() });
  assert.equal(pages.length, 2);
  assert.match(pages[0], /Page 1 of 2/);
  assert.match(pages[1], /No more waste recorded/);
  assert.equal(createPaperPdf({ entries: [{ id: "a", name: "A", type: "raw", count: 0 }] }), null);
  assert.equal(createPaperPdf({}), null);
});

test("PDF text is reduced to safe printable characters", () => {
  assert.equal(pdfSafeText("Café · “Quote” – done…"), "Cafe - \"Quote\" - done...");
  assert.deepEqual(wrapPdfText("one two three four", 9), ["one two", "three", "four"]);
});
