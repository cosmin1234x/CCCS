// Server-only client for the Hayle Waste Counter's shared datastore.
//
// The standalone waste app (https://haylewaster.vercel.app) and its Android
// APK keep one shared record behind /api/store. The crew hub talks to the same
// record through api/waste.js so every device keeps seeing the same counts,
// history and item list. Never import this file from browser code.
//
//   WASTE_STORE_URL  – upstream endpoint (default: the live Hayle store).
//                      Local development and tests MUST point this at a fake
//                      upstream so the production store is never written to.

export const DEFAULT_WASTE_STORE_URL = "https://haylewaster.vercel.app/api/store";
export const WASTE_STATE_LIMIT = 750_000;
export const WASTE_TIMEOUT_MS = 10_000;
export const PIN_ACTIONS = new Set(["pin-status", "pin-setup", "pin-verify", "pin-change"]);
// Business answers from the upstream PIN endpoint. They are passed back to the
// client as data, never as proxy failures.
export const PIN_CODES = new Set([
  "PIN_INVALID",
  "PIN_INCORRECT",
  "PIN_NOT_CONFIGURED",
  "PIN_ALREADY_CONFIGURED",
]);

export class WasteStoreError extends Error {
  constructor(message, { status = 502, code = "WASTE_UPSTREAM_ERROR", upstreamStatus = null } = {}) {
    super(message);
    this.name = "WasteStoreError";
    this.status = status;
    this.code = code;
    this.upstreamStatus = upstreamStatus;
  }
}

export function wasteStoreUrl() {
  const configured = String(process.env.WASTE_STORE_URL || "").trim();
  return configured || DEFAULT_WASTE_STORE_URL;
}

function timeoutError() {
  return new WasteStoreError(
    "The waste datastore took too long to respond. Counts stay safe on this device.",
    { status: 504, code: "WASTE_TIMEOUT" },
  );
}

function unavailableError(upstreamStatus = null) {
  return new WasteStoreError(
    "The shared waste datastore is unavailable right now. Counts stay safe on this device.",
    { status: 502, code: "WASTE_UPSTREAM_ERROR", upstreamStatus },
  );
}

// One upstream call with a single deadline covering the connection, headers
// and the response body. A stalled body can never hold the function open.
async function upstream(method, payload, { timeoutMs = WASTE_TIMEOUT_MS } = {}) {
  const base = wasteStoreUrl();
  let url;
  try {
    url = new URL(base);
  } catch {
    throw new WasteStoreError("WASTE_STORE_URL is not a valid URL.", {
      status: 500,
      code: "WASTE_STORE_MISCONFIGURED",
    });
  }
  if (method === "GET") url.searchParams.set("t", String(Date.now()));
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(timeoutError());
      controller.abort();
    }, timeoutMs);
  });
  const request = (async () => {
    let response;
    try {
      response = await fetch(url, {
        method,
        headers: { Accept: "application/json", ...(payload ? { "Content-Type": "application/json" } : {}) },
        body: payload ? JSON.stringify(payload) : undefined,
        cache: "no-store",
        signal: controller.signal,
      });
    } catch (error) {
      if (error?.name === "AbortError") throw timeoutError();
      throw unavailableError();
    }
    let text;
    try {
      text = await response.text();
    } catch (error) {
      if (error?.name === "AbortError") throw timeoutError();
      throw unavailableError(response.status);
    }
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new WasteStoreError("The waste datastore sent an invalid reply.", {
        status: 502,
        code: "WASTE_INVALID_RESPONSE",
        upstreamStatus: response.status,
      });
    }
    return { status: response.status, data };
  })();
  try {
    return await Promise.race([deadline, request]);
  } finally {
    clearTimeout(timer);
    // The losing promise may still reject later; it has already been handled
    // by Promise.race, so nothing leaks as an unhandled rejection.
  }
}

function isRecord(value) {
  return value === null || (typeof value === "object" && !Array.isArray(value));
}

export function isValidWasteState(state) {
  return Boolean(state) && typeof state === "object" && !Array.isArray(state);
}

export function wasteStateSize(state) {
  return JSON.stringify(state).length;
}

// GET → the shared record ({ version, updatedAt, state }) or null.
export async function readWasteRecord(options) {
  const { status, data } = await upstream("GET", null, options);
  if (status < 200 || status >= 300 || data.ok !== true) {
    if (data.code === "STORE_NOT_CONFIGURED")
      throw new WasteStoreError("The shared waste datastore is not connected yet.", {
        status: 502,
        code: "WASTE_STORE_NOT_CONFIGURED",
        upstreamStatus: status,
      });
    throw unavailableError(status);
  }
  if (!Object.prototype.hasOwnProperty.call(data, "record") || !isRecord(data.record))
    throw new WasteStoreError("The waste datastore sent an invalid record.", {
      status: 502,
      code: "WASTE_INVALID_RESPONSE",
      upstreamStatus: status,
    });
  return data.record;
}

// POST { state } → { updatedAt }.
export async function writeWasteState(state, options) {
  if (!isValidWasteState(state))
    throw new WasteStoreError("Invalid state.", { status: 400, code: "WASTE_INVALID_STATE" });
  if (wasteStateSize(state) > WASTE_STATE_LIMIT)
    throw new WasteStoreError("Datastore payload is too large.", { status: 413, code: "WASTE_TOO_LARGE" });
  const { status, data } = await upstream("POST", { state }, options);
  if (status === 413)
    throw new WasteStoreError("Datastore payload is too large.", { status: 413, code: "WASTE_TOO_LARGE" });
  if (status < 200 || status >= 300 || data.ok !== true || !Number.isFinite(data.updatedAt)) {
    if (data.code === "STORE_NOT_CONFIGURED")
      throw new WasteStoreError("The shared waste datastore is not connected yet.", {
        status: 502,
        code: "WASTE_STORE_NOT_CONFIGURED",
        upstreamStatus: status,
      });
    throw new WasteStoreError(
      "The shared waste datastore could not save right now. Counts stay safe on this device.",
      { status: 502, code: "WASTE_UPSTREAM_ERROR", upstreamStatus: status },
    );
  }
  return { updatedAt: data.updatedAt };
}

const digits = (value) => String(value ?? "").slice(0, 12);

// Manager PIN actions are forwarded with only the fields each action needs.
// Returns { ok, configured?, code?, error? } for every business answer and
// throws WasteStoreError when the upstream itself fails.
export async function wastePinAction(action, body = {}, options) {
  if (!PIN_ACTIONS.has(action))
    throw new WasteStoreError("Unknown manager PIN action.", { status: 400, code: "WASTE_UNKNOWN_ACTION" });
  const payload = { action };
  if (action === "pin-setup" || action === "pin-verify") payload.pin = digits(body.pin);
  if (action === "pin-change") {
    payload.currentPin = digits(body.currentPin);
    payload.newPin = digits(body.newPin);
  }
  const { status, data } = await upstream("POST", payload, options);
  if (status >= 200 && status < 300 && data.ok === true) {
    const result = { ok: true };
    if (typeof data.configured === "boolean") result.configured = data.configured;
    return result;
  }
  if (status >= 400 && status < 500 && PIN_CODES.has(data.code)) {
    return {
      ok: false,
      code: data.code,
      error: typeof data.error === "string" && data.error ? data.error.slice(0, 200) : "Manager PIN was not accepted.",
    };
  }
  throw new WasteStoreError("Manager approval is unavailable right now. Please try again.", {
    status: 502,
    code: "WASTE_UPSTREAM_ERROR",
    upstreamStatus: status,
  });
}
