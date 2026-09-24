// Authenticated proxy for the Hayle waste counter's shared datastore.
//
//   GET  /api/waste                         → { ok: true, record }
//   POST /api/waste { state }               → { ok: true, updatedAt }
//   POST /api/waste { action: "pin-…", … }  → { ok, configured?, code?, error? }
//
// Every request needs a Firebase ID token (Authorization: Bearer …). The hub,
// the standalone waste app and its Android APK all share one record upstream,
// so counts taken on any device appear everywhere.
//
//   WASTE_STORE_IDS (optional) – comma-separated store IDs (e.g. "1170") whose
//   signed-in members may use the waste counter. When set, the caller's crew
//   profile is checked server-side and anyone else gets 403.
import { authenticateRequest, getProfile } from "../server/portal-admin.js";
import {
  PIN_ACTIONS,
  WASTE_STATE_LIMIT,
  WasteStoreError,
  isValidWasteState,
  readWasteRecord,
  wastePinAction,
  wasteStateSize,
  writeWasteState,
} from "../server/waste-store.js";

function send(res, status, body) {
  return res.status(status).json(body);
}

function parseBody(req) {
  const raw = req.body;
  if (raw == null || raw === "") return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  if (typeof raw === "object") return raw;
  return undefined;
}

function allowedStores() {
  return String(process.env.WASTE_STORE_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

export function createWasteHandler({
  authenticate = authenticateRequest,
  loadProfile = getProfile,
  store = { readWasteRecord, writeWasteState, wastePinAction },
  timeoutMs, // defaults to WASTE_TIMEOUT_MS (10 s) in server/waste-store.js
  log = console,
} = {}) {
  const options = timeoutMs ? { timeoutMs } : undefined;
  return async function wasteHandler(req, res) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    if (req.method !== "GET" && req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return send(res, 405, { ok: false, error: "Method not allowed." });
    }

    let session;
    try {
      session = await authenticate(req);
    } catch (error) {
      return send(res, 401, {
        ok: false,
        error: error?.status === 401 && error.message ? error.message : "Sign in to continue.",
      });
    }

    const stores = allowedStores();
    if (stores.length) {
      let profile = null;
      try {
        profile = await loadProfile(session?.decoded?.uid);
      } catch {
        profile = null;
      }
      if (!profile || !stores.includes(String(profile.storeId || "")))
        return send(res, 403, { ok: false, error: "The waste counter is only available to Hayle crew." });
    }

    try {
      if (req.method === "GET") {
        const record = await store.readWasteRecord(options);
        return send(res, 200, { ok: true, record });
      }

      const body = parseBody(req);
      if (!body || typeof body !== "object" || Array.isArray(body))
        return send(res, 400, { ok: false, error: "Invalid request body." });

      if (body.action !== undefined) {
        if (typeof body.action !== "string" || !PIN_ACTIONS.has(body.action))
          return send(res, 400, { ok: false, error: "Unknown waste action." });
        const result = await store.wastePinAction(body.action, body, options);
        return send(res, 200, result);
      }

      const state = body.state;
      if (!isValidWasteState(state)) return send(res, 400, { ok: false, error: "Invalid state." });
      if (wasteStateSize(state) > WASTE_STATE_LIMIT)
        return send(res, 413, { ok: false, error: "Datastore payload is too large." });
      const { updatedAt } = await store.writeWasteState(state, options);
      return send(res, 200, { ok: true, updatedAt });
    } catch (error) {
      if (error instanceof WasteStoreError || Number.isInteger(error?.status)) {
        const status = Number.isInteger(error.status) ? error.status : 502;
        if (status >= 500) log.warn?.("[waste] upstream", error.code || "", error.upstreamStatus || "");
        return send(res, status, {
          ok: false,
          code: error.code || "WASTE_ERROR",
          error: error.message || "The waste datastore is unavailable.",
        });
      }
      log.error?.("[waste] unexpected", error);
      return send(res, 500, { ok: false, code: "WASTE_ERROR", error: "The waste datastore is unavailable." });
    }
  };
}

export default createWasteHandler();
