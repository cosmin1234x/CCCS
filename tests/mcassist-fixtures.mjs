// Shared fixtures for the McAssist unit tests: an in-memory store seeded with a
// small Hayle team, a scripted OpenAI provider and a tiny req/res harness.
// (Not a test file itself — node --test only runs tests/*.test.mjs.)
import { createHandler } from "../api/ai-chat.js";
import {
  createMemoryAuth,
  createMemoryFieldValue,
  createMemoryFirestore,
} from "../server/mcassist-memory-db.js";

// Thursday 24 September 2026, 10:00 in London (BST = UTC+1).
export const NOW = Date.parse("2026-09-24T09:00:00Z");
export const TODAY = "2026-09-24";
export const NEXT_WEEK = ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"];

const open = (start = "09:00", end = "23:00") => ({ available: true, start, end });
const off = () => ({ available: false, start: "09:00", end: "17:00" });

export const COSMIN_AVAILABILITY = {
  mon: open(),
  tue: open(),
  wed: off(),
  thu: open(),
  fri: open(),
  sat: open(),
  sun: off(),
};

export function seedData() {
  const user = (name, role, extra = {}) => ({
    name,
    email: name.toLowerCase().replace(/[^a-z]+/g, ".") + "@hayle.test",
    role,
    storeId: "1170",
    storeName: "1170 · Hayle",
    stars: 5,
    ...extra,
  });
  return {
    "users/maya": user("Maya Manager", "manager", { hourlyRate: 14.5 }),
    "users/max": user("Max Morgan", "manager", { hourlyRate: 14.5 }),
    "users/cosmin": user("Cosmin Blidaru", "crew", {
      hourlyRate: 12.55,
      availability: COSMIN_AVAILABILITY,
      verifiedStations: ["Fries"],
      requestedRole: "crewTrainer",
      roleRequestStatus: "pending",
    }),
    "users/alexj": user("Alex Johnson", "crew", { hourlyRate: 12, availability: { mon: open("16:00", "23:00") } }),
    "users/alexs": user("Alex Smith", "crewTrainer", { hourlyRate: 12.9 }),
    "users/tara": user("Tara Trainer", "crewTrainer", { hourlyRate: 12.9 }),
    "users/olivia": { ...user("Olivia Other", "crew"), storeId: "2280", storeName: "2280 · Truro" },
    "users/cosmin/portalTraining/fries-station": { completed: true },
    "users/cosmin/portalTraining/first-shift": { completed: true },
    "roleRequests/cosmin": { uid: "cosmin", storeId: "1170", requestedRole: "crewTrainer", status: "pending", name: "Cosmin Blidaru" },
    "stores/1170/Shifts/past1": {
      userId: "cosmin",
      userName: "Cosmin Blidaru",
      role: "crew",
      date: "2026-09-20",
      start: "09:00",
      end: "17:00",
      station: "Fries",
      breakMinutes: 30,
    },
    "stores/1170/Shifts/sat1": {
      userId: "cosmin",
      userName: "Cosmin Blidaru",
      role: "crew",
      date: "2026-09-26",
      start: "09:00",
      end: "17:00",
      station: "Fries",
      breakMinutes: 30,
    },
    "stores/1170/Shifts/fri2": {
      userId: "cosmin",
      userName: "Cosmin Blidaru",
      role: "crew",
      date: "2026-10-02",
      start: "16:00",
      end: "23:00",
      station: "Grill",
      breakMinutes: 30,
    },
    "stores/1170/Shifts/alex1": {
      userId: "alexj",
      userName: "Alex Johnson",
      role: "crew",
      date: "2026-09-28",
      start: "16:00",
      end: "23:00",
      station: "Front Counter",
      breakMinutes: 30,
    },
    "stores/2280/Shifts/o1": {
      userId: "olivia",
      userName: "Olivia Other",
      date: "2026-09-29",
      start: "09:00",
      end: "17:00",
      station: "Fries",
    },
  };
}

export const toolCall = (name, args, id) => ({
  id: id || "call_" + name + "_" + Math.random().toString(36).slice(2, 7),
  type: "function",
  function: { name, arguments: JSON.stringify(args) },
});
export const calls = (...list) => ({ content: "", tool_calls: list });
export const say = (content) => ({ content });
export const fail = (status, error) => ({ status, body: { error } });

// Scripted provider. Each step is a message, a function(body, requests) → message,
// or { status, body } for an HTTP error.
export function scriptedProvider(steps = []) {
  const queue = [...steps];
  const requests = [];
  const fetchAPI = async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push({ url, body, headers: options.headers });
    const step = queue.shift();
    if (!step) throw new Error("No scripted provider response left");
    const out = typeof step === "function" ? step(body, requests) : step;
    if (out.status && out.status >= 400) return { ok: false, status: out.status, json: async () => out.body };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { role: "assistant", ...out } }] }) };
  };
  return { fetchAPI, requests, queue };
}

export function response() {
  return {
    code: 200,
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
    status(n) {
      this.code = n;
      return this;
    },
    json(d) {
      this.data = d;
      return this;
    },
  };
}

export function setup({ steps = [], seed = seedData(), now = NOW, handlerOptions = {} } = {}) {
  process.env.OPENAI_API_KEY = "unit-test-key";
  const clock = { now };
  const FieldValue = createMemoryFieldValue();
  const db = createMemoryFirestore(seed, { now: () => clock.now });
  const auth = createMemoryAuth(
    Object.entries(seed)
      .filter(([path]) => /^users\/[^/]+$/.test(path))
      .map(([path, data]) => ({ uid: path.split("/")[1], email: data.email, displayName: data.name })),
  );
  const provider = scriptedProvider(steps);
  const handler = createHandler({
    verifyUser: async (req) => {
      const uid = req.headers?.["x-test-uid"];
      if (!uid) throw Object.assign(new Error("Sign in to continue."), { status: 401 });
      return { uid };
    },
    fetchAPI: provider.fetchAPI,
    deps: { db: () => db, auth: () => auth, FieldValue, now: () => clock.now, loadWaste: async () => null },
    ...handlerOptions,
  });
  async function send(uid, body) {
    const res = response();
    await handler({ method: "POST", headers: { "x-test-uid": uid }, body }, res);
    return res;
  }
  return { db, auth, clock, provider, handler, send, FieldValue };
}

export function toolNames(request) {
  return (request.body.tools || []).map((t) => t.function.name);
}

export function toolResults(request) {
  return request.body.messages
    .filter((m) => m.role === "tool")
    .map((m) => {
      try {
        return JSON.parse(m.content);
      } catch {
        return m.content;
      }
    });
}
