// Tests for the authenticated waste proxy (api/waste.js) and its upstream
// client (server/waste-store.js). Every request goes to a local fake of the
// Hayle store; the production datastore is never contacted.
import assert from "node:assert/strict";
import http from "node:http";
import { after, before, beforeEach, test } from "node:test";
import crypto from "node:crypto";

const PRODUCTION = "https://haylewaster.vercel.app/api/store";

// ---------------------------------------------------------------- fake upstream
// Mirrors the real Hayle api/store.js contract (GET record, POST state, PIN
// actions with the same status codes) plus failure modes for the tests.
const upstream = {
  record: null,
  pin: null,
  mode: "normal",
  requests: [],
  reset() {
    this.record = null;
    this.pin = null;
    this.mode = "normal";
    this.requests = [];
  },
};
const digest = (pin) => crypto.createHash("sha256").update("pepper:" + pin).digest("hex");

function reply(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : null;
  upstream.requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body });
  if (url.pathname !== "/api/store") return reply(res, 404, { ok: false, error: "Not found" });
  const mode = upstream.mode;
  if (mode === "hang") return; // never answers
  if (mode === "hang-body") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.write('{"ok":true,');
    return; // body never completes
  }
  if (mode === "error500") return reply(res, 500, { ok: false, error: "Could not load shared datastore." });
  if (mode === "not-configured")
    return reply(res, 503, { ok: false, code: "STORE_NOT_CONFIGURED", error: "Shared datastore needs to be connected in Vercel." });
  if (mode === "invalid-json") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end("<html>oops</html>");
  }
  if (mode === "bad-record") return reply(res, 200, { ok: true, record: "nope" });

  if (req.method === "GET") return reply(res, 200, { ok: true, record: upstream.record });
  if (req.method !== "POST") return reply(res, 405, { ok: false, error: "Method not allowed." });
  const action = body?.action;
  const valid = (pin) => /^\d{4}$/.test(String(pin || ""));
  if (typeof action === "string" && action.startsWith("pin-")) {
    if (action === "pin-status") return reply(res, 200, { ok: true, configured: Boolean(upstream.pin) });
    if (action === "pin-setup") {
      if (!valid(body.pin)) return reply(res, 400, { ok: false, code: "PIN_INVALID", error: "PIN must be exactly 4 digits." });
      if (upstream.pin) return reply(res, 409, { ok: false, code: "PIN_ALREADY_CONFIGURED", error: "A manager PIN is already configured." });
      upstream.pin = digest(body.pin);
      return reply(res, 200, { ok: true, configured: true });
    }
    if (action === "pin-verify") {
      if (!valid(body.pin)) return reply(res, 400, { ok: false, code: "PIN_INVALID", error: "PIN must be exactly 4 digits." });
      if (!upstream.pin) return reply(res, 409, { ok: false, code: "PIN_NOT_CONFIGURED", error: "Manager PIN has not been set yet." });
      if (upstream.pin !== digest(body.pin)) return reply(res, 401, { ok: false, code: "PIN_INCORRECT", error: "Incorrect manager PIN." });
      return reply(res, 200, { ok: true });
    }
    if (action === "pin-change") {
      if (!valid(body.currentPin) || !valid(body.newPin))
        return reply(res, 400, { ok: false, code: "PIN_INVALID", error: "PIN must be exactly 4 digits." });
      if (!upstream.pin) return reply(res, 409, { ok: false, code: "PIN_NOT_CONFIGURED", error: "Manager PIN has not been set yet." });
      if (upstream.pin !== digest(body.currentPin)) return reply(res, 401, { ok: false, code: "PIN_INCORRECT", error: "Incorrect manager PIN." });
      upstream.pin = digest(body.newPin);
      return reply(res, 200, { ok: true, configured: true });
    }
  }
  const state = body?.state;
  if (!state || typeof state !== "object" || Array.isArray(state)) return reply(res, 400, { ok: false, error: "Invalid state." });
  if (JSON.stringify(state).length > 750_000) return reply(res, 413, { ok: false, error: "Datastore payload is too large." });
  const updatedAt = Math.max(Date.now(), (upstream.record?.updatedAt || 0) + 1);
  upstream.record = { version: 1, updatedAt, state };
  return reply(res, 200, { ok: true, updatedAt });
});

let baseUrl;
let wasteModule;
let storeModule;
before(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/store`;
  process.env.WASTE_STORE_URL = baseUrl;
  storeModule = await import("../server/waste-store.js");
  wasteModule = await import("../api/waste.js");
});
after(() => {
  server.closeAllConnections?.();
  server.close();
});
beforeEach(() => {
  upstream.reset();
  process.env.WASTE_STORE_URL = baseUrl;
});

// ------------------------------------------------------------------ helpers
const signedIn = async () => ({ decoded: { uid: "crew-1" }, token: "test" });
const signedOut = async () => {
  throw Object.assign(new Error("Sign in to continue."), { status: 401 });
};
const quietLog = { warn() {}, error() {} };

function handler(options = {}) {
  return wasteModule.createWasteHandler({ authenticate: signedIn, log: quietLog, ...options });
}

async function call(fn, { method = "GET", body, headers = {} } = {}) {
  const result = { status: 0, headers: {}, body: undefined };
  const res = {
    setHeader(name, value) {
      result.headers[name.toLowerCase()] = value;
    },
    status(code) {
      result.status = code;
      return this;
    },
    json(data) {
      result.body = JSON.parse(JSON.stringify(data));
      return this;
    },
  };
  await fn({ method, body, headers, query: {} }, res);
  return result;
}

const sampleState = () => ({
  version: 1,
  items: [{ id: "v2-default-1", name: "10:1 Beef Patty", category: "Beef", shift: "main", type: "raw", custom: false }],
  counts: { "v2-default-1": 4 },
  history: [],
  draft: { sheetName: "Close · Cosmin", sheetNotes: "", sheetId: null },
});

// -------------------------------------------------------------------- tests
test("the store URL is overridable and tests never target production", () => {
  assert.equal(storeModule.DEFAULT_WASTE_STORE_URL, PRODUCTION);
  assert.equal(storeModule.wasteStoreUrl(), baseUrl);
  assert.notEqual(storeModule.wasteStoreUrl(), PRODUCTION);
  assert.equal(storeModule.WASTE_TIMEOUT_MS, 10_000);
  assert.equal(storeModule.WASTE_STATE_LIMIT, 750_000);
});

test("requests without a valid Firebase session get 401 and never reach the upstream", async () => {
  for (const [method, body] of [
    ["GET", undefined],
    ["POST", { state: sampleState() }],
    ["POST", { action: "pin-status" }],
  ]) {
    const result = await call(handler({ authenticate: signedOut }), { method, body });
    assert.equal(result.status, 401);
    assert.equal(result.body.ok, false);
    assert.match(result.body.error, /sign in/i);
  }
  // The real default handler rejects a missing bearer token before any lookup.
  const real = await call(wasteModule.default, { method: "GET" });
  assert.equal(real.status, 401);
  assert.equal(upstream.requests.length, 0);
});

test("an optional store allowlist limits the counter to that store's crew", async () => {
  process.env.WASTE_STORE_IDS = "1170, 2040";
  try {
    const profiles = { "crew-1": { id: "crew-1", storeId: "1170" }, other: { id: "other", storeId: "9999" } };
    const as = (uid) =>
      wasteModule.createWasteHandler({
        authenticate: async () => ({ decoded: { uid } }),
        loadProfile: async (id) => {
          if (!profiles[id]) throw Object.assign(new Error("missing"), { status: 403 });
          return profiles[id];
        },
        log: quietLog,
      });
    assert.equal((await call(as("crew-1"))).status, 200);
    const outsider = await call(as("other"), { method: "POST", body: { state: sampleState() } });
    assert.equal(outsider.status, 403);
    assert.match(outsider.body.error, /Hayle crew/);
    assert.equal((await call(as("ghost"))).status, 403);
    assert.equal(upstream.requests.filter((r) => r.method === "POST").length, 0);
  } finally {
    delete process.env.WASTE_STORE_IDS;
  }
  // Without the setting, any signed-in crew member can use it.
  assert.equal((await call(handler({ loadProfile: async () => null }))).status, 200);
});

test("GET returns the shared record and is never cached", async () => {
  const empty = await call(handler());
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body, { ok: true, record: null });
  assert.match(empty.headers["cache-control"], /no-store/);
  upstream.record = { version: 1, updatedAt: 42, state: sampleState() };
  const loaded = await call(handler());
  assert.equal(loaded.status, 200);
  assert.deepEqual(loaded.body.record, upstream.record);
  const gets = upstream.requests.filter((r) => r.method === "GET");
  assert.equal(gets.length, 2);
  assert.ok(gets.every((r) => r.query.t), "GET requests carry a cache-busting parameter");
});

test("POST { state } saves through the upstream and returns updatedAt", async () => {
  const state = sampleState();
  const saved = await call(handler(), { method: "POST", body: { state } });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.ok, true);
  assert.ok(Number.isFinite(saved.body.updatedAt));
  assert.deepEqual(upstream.record.state, state);
  const post = upstream.requests.find((r) => r.method === "POST");
  assert.deepEqual(post.body, { state }, "only the state is forwarded");
  // A JSON string body (raw Vercel/Node request) works too.
  const again = await call(handler(), { method: "POST", body: JSON.stringify({ state: { ...state, counts: {} } }) });
  assert.equal(again.status, 200);
  assert.deepEqual(upstream.record.state.counts, {});
  assert.ok(again.body.updatedAt > saved.body.updatedAt);
});

test("invalid bodies and oversized states are rejected before the upstream", async () => {
  upstream.record = { version: 1, updatedAt: 5, state: sampleState() };
  const cases = [
    [{ state: [] }, 400],
    [{ state: null }, 400],
    [{}, 400],
    ["{not json", 400],
    [[1, 2], 400],
    [{ state: { nope: 1 } }, 400],
    [{ state: { ...sampleState(), items: {} } }, 400],
    [{ state: { ...sampleState(), counts: [] } }, 400],
    [{ state: { ...sampleState(), history: null } }, 400],
    [{ state: { ...sampleState(), draft: "Close" } }, 400],
    [{ state: { ...sampleState(), notes: "x".repeat(750_001) } }, 413],
    [{ action: "drop-table" }, 400],
    [{ action: 7 }, 400],
  ];
  for (const [body, status] of cases) {
    const result = await call(handler(), { method: "POST", body });
    assert.equal(result.status, status, JSON.stringify(body).slice(0, 40));
    assert.equal(result.body.ok, false);
  }
  assert.equal(upstream.requests.length, 0);
  assert.equal(upstream.record.updatedAt, 5, "existing data is untouched");
});

test("a state exactly at the 750 KB limit is accepted", async () => {
  const base = JSON.stringify({ ...sampleState(), notes: "" }).length;
  const state = { ...sampleState(), notes: "y".repeat(750_000 - base) };
  assert.equal(JSON.stringify(state).length, 750_000);
  const result = await call(handler(), { method: "POST", body: { state } });
  assert.equal(result.status, 200);
});

test("manager PIN actions are forwarded with only their own fields", async () => {
  const pin = (action, fields = {}) => call(handler(), { method: "POST", body: { action, ...fields } });
  assert.deepEqual((await pin("pin-status")).body, { ok: true, configured: false });
  const notSet = await pin("pin-verify", { pin: "1234" });
  assert.equal(notSet.status, 200);
  assert.deepEqual(notSet.body, { ok: false, code: "PIN_NOT_CONFIGURED", error: "Manager PIN has not been set yet." });
  assert.equal((await pin("pin-setup", { pin: "12" })).body.code, "PIN_INVALID");
  const setup = await pin("pin-setup", { pin: "1234", state: sampleState(), extra: "ignored" });
  assert.deepEqual(setup.body, { ok: true, configured: true });
  const forwarded = upstream.requests.at(-1).body;
  assert.deepEqual(forwarded, { action: "pin-setup", pin: "1234" }, "state and unknown fields are never forwarded");
  assert.equal(upstream.record, null, "a PIN action never writes the shared state");
  assert.deepEqual((await pin("pin-status")).body, { ok: true, configured: true });
  assert.equal((await pin("pin-setup", { pin: "9999" })).body.code, "PIN_ALREADY_CONFIGURED");
  const wrong = await pin("pin-verify", { pin: "9999" });
  assert.equal(wrong.status, 200, "a wrong PIN is an answer, not an auth failure of the proxy");
  assert.equal(wrong.body.code, "PIN_INCORRECT");
  assert.equal((await pin("pin-verify", { pin: "1234" })).body.ok, true);
  assert.equal((await pin("pin-change", { currentPin: "0000", newPin: "5678" })).body.code, "PIN_INCORRECT");
  assert.deepEqual((await pin("pin-change", { currentPin: "1234", newPin: "5678" })).body, { ok: true, configured: true });
  assert.deepEqual(upstream.requests.at(-1).body, { action: "pin-change", currentPin: "1234", newPin: "5678" });
  assert.equal((await pin("pin-verify", { pin: "1234" })).body.code, "PIN_INCORRECT");
  assert.equal((await pin("pin-verify", { pin: "5678" })).body.ok, true);
});

test("an upstream that never answers is cut off with a 504", async () => {
  upstream.mode = "hang";
  const started = Date.now();
  const result = await call(handler({ timeoutMs: 150 }));
  assert.equal(result.status, 504);
  assert.equal(result.body.code, "WASTE_TIMEOUT");
  assert.match(result.body.error, /took too long/i);
  assert.ok(Date.now() - started < 2000);
});

test("a stalled response body shares the same deadline", async () => {
  upstream.mode = "hang-body";
  const result = await call(handler({ timeoutMs: 150 }), { method: "POST", body: { state: sampleState() } });
  assert.equal(result.status, 504);
  const pin = await call(handler({ timeoutMs: 150 }), { method: "POST", body: { action: "pin-status" } });
  assert.equal(pin.status, 504);
});

test("upstream failures map to clear 502 errors", async () => {
  const expectations = [
    ["error500", "WASTE_UPSTREAM_ERROR"],
    ["invalid-json", "WASTE_INVALID_RESPONSE"],
    ["not-configured", "WASTE_STORE_NOT_CONFIGURED"],
    ["bad-record", "WASTE_INVALID_RESPONSE"],
  ];
  for (const [mode, code] of expectations) {
    upstream.mode = mode;
    const result = await call(handler());
    assert.equal(result.status, 502, mode);
    assert.equal(result.body.ok, false);
    assert.equal(result.body.code, code, mode);
    assert.ok(result.body.error.length > 10);
  }
  upstream.mode = "error500";
  const save = await call(handler(), { method: "POST", body: { state: sampleState() } });
  assert.equal(save.status, 502);
  assert.match(save.body.error, /safe on this device/);
  const pin = await call(handler(), { method: "POST", body: { action: "pin-verify", pin: "1234" } });
  assert.equal(pin.status, 502);
});

test("an unreachable upstream is reported as unavailable", async () => {
  process.env.WASTE_STORE_URL = "http://127.0.0.1:9/api/store";
  const result = await call(handler({ timeoutMs: 2000 }));
  assert.equal(result.status, 502);
  assert.equal(result.body.code, "WASTE_UPSTREAM_ERROR");
  process.env.WASTE_STORE_URL = "not a url";
  const bad = await call(handler());
  assert.equal(bad.status, 500);
  assert.equal(bad.body.code, "WASTE_STORE_MISCONFIGURED");
});

test("unsupported methods are refused", async () => {
  for (const method of ["PUT", "DELETE", "PATCH"]) {
    const result = await call(handler(), { method });
    assert.equal(result.status, 405);
    assert.equal(result.headers.allow, "GET, POST");
  }
  assert.equal(upstream.requests.length, 0);
});

test("server helpers validate before contacting the upstream", async () => {
  await assert.rejects(storeModule.writeWasteState([]), (e) => e.status === 400);
  await assert.rejects(storeModule.writeWasteState({ big: 1 }), (e) => e.status === 400);
  await assert.rejects(storeModule.writeWasteState({ ...sampleState(), big: "z".repeat(760_000) }), (e) => e.status === 413);
  await assert.rejects(storeModule.wastePinAction("pin-drop"), (e) => e.status === 400);
  assert.equal(upstream.requests.length, 0);
  const { updatedAt } = await storeModule.writeWasteState(sampleState());
  assert.ok(updatedAt > 0);
  assert.deepEqual((await storeModule.readWasteRecord()).state, sampleState());
});
