// In-memory stand-in for the Hayle Waste Counter shared datastore
// (https://haylewaster.vercel.app/api/store) used by the e2e harness, so the
// Waste tab can be exercised end to end without ever writing to the real
// store. It mirrors hayle-waste-counter api/store.js:
//
//   GET  /api/store                          -> { ok, record: {version, updatedAt, state} | null }
//   POST /api/store { state }                -> { ok, updatedAt }
//   POST /api/store { action: "pin-status" } -> { ok, configured }
//   POST /api/store { action: "pin-setup", pin }
//   POST /api/store { action: "pin-verify", pin }
//   POST /api/store { action: "pin-change", currentPin, newPin }
//
// Test helpers (not part of the real API):
//   GET  /__e2e/state   -> { record, pinConfigured, requests }
//   POST /__e2e/reset   -> clears the record and PIN ({ pin: "1234" } presets one)
//
//   PORT (default 4011)
import http from "node:http";
import crypto from "node:crypto";
import { assertLocalEmulators, e2eEnv } from "./e2e-guard.mjs";

for (const [key, value] of Object.entries(e2eEnv()))
  if (process.env[key] === undefined) process.env[key] = value;
assertLocalEmulators(process.env, "fake-waste-store");

const port = Number(process.env.PORT) || 4011;
let record = null;
let pinDigest = null;
let requests = [];

const digest = (pin) => crypto.createHash("sha256").update("e2e:" + pin).digest("hex");
const validPin = (pin) => /^\d{4}$/.test(String(pin || ""));

function send(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

function pinAction(action, body) {
  if (action === "pin-status") return [200, { ok: true, configured: Boolean(pinDigest) }];
  if (action === "pin-setup") {
    if (!validPin(body.pin)) return [400, { ok: false, code: "PIN_INVALID", error: "PIN must be exactly 4 digits." }];
    if (pinDigest) return [409, { ok: false, code: "PIN_ALREADY_CONFIGURED", error: "A manager PIN is already configured." }];
    pinDigest = digest(body.pin);
    return [200, { ok: true, configured: true }];
  }
  if (action === "pin-verify") {
    if (!validPin(body.pin)) return [400, { ok: false, code: "PIN_INVALID", error: "PIN must be exactly 4 digits." }];
    if (!pinDigest) return [409, { ok: false, code: "PIN_NOT_CONFIGURED", error: "Manager PIN has not been set yet." }];
    if (pinDigest !== digest(body.pin)) return [401, { ok: false, code: "PIN_INCORRECT", error: "Incorrect manager PIN." }];
    return [200, { ok: true }];
  }
  if (action === "pin-change") {
    if (!validPin(body.currentPin) || !validPin(body.newPin))
      return [400, { ok: false, code: "PIN_INVALID", error: "PIN must be exactly 4 digits." }];
    if (!pinDigest) return [409, { ok: false, code: "PIN_NOT_CONFIGURED", error: "Manager PIN has not been set yet." }];
    if (pinDigest !== digest(body.currentPin)) return [401, { ok: false, code: "PIN_INCORRECT", error: "Incorrect manager PIN." }];
    pinDigest = digest(body.newPin);
    return [200, { ok: true, configured: true }];
  }
  return null;
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 2_000_000) return send(res, 413, { ok: false, error: "Too large." });
    }
    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      body = null;
    }

    if (url.pathname === "/__e2e/state")
      return send(res, 200, { record, pinConfigured: Boolean(pinDigest), requests });
    if (url.pathname === "/__e2e/reset" && req.method === "POST") {
      record = body?.record || null;
      pinDigest = body?.pin && validPin(body.pin) ? digest(body.pin) : null;
      requests = [];
      return send(res, 200, { ok: true });
    }
    if (url.pathname === "/" || url.pathname === "/health") return send(res, 200, { ok: true, fake: "waste-store" });
    if (url.pathname !== "/api/store") return send(res, 404, { ok: false, error: "Not found." });

    requests.push({ method: req.method, action: body?.action || (body?.state ? "save" : null), at: Date.now() });
    if (requests.length > 200) requests = requests.slice(-200);

    if (req.method === "OPTIONS") return send(res, 204);
    if (req.method === "GET") return send(res, 200, { ok: true, record });
    if (req.method === "POST") {
      if (body === null) return send(res, 400, { ok: false, error: "Invalid state." });
      if (typeof body.action === "string" && body.action.startsWith("pin-")) {
        const handled = pinAction(body.action, body);
        if (handled) return send(res, handled[0], handled[1]);
      }
      const state = body.state;
      if (!state || typeof state !== "object" || Array.isArray(state))
        return send(res, 400, { ok: false, error: "Invalid state." });
      if (JSON.stringify(state).length > 750_000)
        return send(res, 413, { ok: false, error: "Datastore payload is too large." });
      const updatedAt = Date.now();
      record = { version: 1, updatedAt, state };
      return send(res, 200, { ok: true, updatedAt });
    }
    res.setHeader("Allow", "GET, POST");
    return send(res, 405, { ok: false, error: "Method not allowed." });
  })
  .listen(port, "127.0.0.1", () => console.log(`[fake-waste-store] listening on http://127.0.0.1:${port}/api/store`));
