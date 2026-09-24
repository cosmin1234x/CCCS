// Behaviour tests for the waste data store and offline-first sync engine
// (waste-core.js). Ported from the standalone Hayle Waste Counter's
// cloud-sync tests: same scenarios, driven through the hub transport
// (kit.api → /api/waste) with a fake clock. Nothing here touches a network.
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_ITEM_DATA,
  createWasteStore,
  defaultItems,
  mergeHistory,
  mergeItems,
  migrateItems,
  safeStorage,
  storageKeys,
} from "../waste-core.js";

const keys = storageKeys("mc_waste_");
const names = { items: keys.ITEMS, counts: keys.COUNTS, history: keys.HISTORY, draft: keys.DRAFT, meta: keys.CLOUD_META };

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const remote = (counts = {}, updatedAt = 2) => ({
  ok: true,
  record: { version: 1, updatedAt, state: { version: 1, items: [], counts, history: [], draft: {} } },
});

function harness({ online = false, seed = {}, fetch: fetchImpl, start = true, cloud = true, local = false } = {}) {
  const storage = new Map(Object.entries(seed).map(([name, data]) => [names[name] || name, JSON.stringify(data)]));
  const backend = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  };
  let elapsed = 0;
  let nextTimer = 1;
  const timers = new Map();
  const setTimer = (callback, delay, interval = false) => {
    const id = nextTimer++;
    timers.set(id, { callback, at: elapsed + Math.max(Number(delay) || 0, 1), interval: interval ? delay : 0 });
    return id;
  };
  const clock = {
    now: () => 1700000000000 + elapsed,
    setTimeout: (callback, delay) => setTimer(callback, delay),
    clearTimeout: (id) => timers.delete(id),
    setInterval: (callback, delay) => setTimer(callback, delay, true),
    clearInterval: (id) => timers.delete(id),
  };
  const env = { online, visible: true };
  const requests = [];
  const notices = [];
  const statuses = [];
  const send = (request) => {
    requests.push(request);
    if (!fetchImpl) throw new Error("Unexpected network request in offline test");
    return fetchImpl(request, requests.length);
  };
  const transport = {
    local,
    load: (options = {}) => send({ method: "GET", url: "/api/waste", ...options }),
    save: (state, options = {}) => send({ method: "POST", url: "/api/waste", body: JSON.stringify({ state }), ...options }),
    pin: (action, payload, options = {}) =>
      send({ method: "POST", url: "/api/waste", body: JSON.stringify({ action, ...payload }), ...options }),
  };
  const store = createWasteStore({
    storage: backend,
    keys,
    transport,
    cloud,
    clock,
    isOnline: () => env.online,
    isVisible: () => env.visible,
    onStatus: (s) => statuses.push(s),
    onNotice: (n) => notices.push(n),
    warn: () => {},
  });
  if (start) store.start();
  const flush = async () => {
    for (let i = 0; i < 40; i++) await Promise.resolve();
  };
  const tick = async (milliseconds) => {
    const end = elapsed + milliseconds;
    await flush();
    for (let steps = 0; ; steps++) {
      assert.ok(steps < 1000, "timer callbacks must not create a busy retry loop");
      const next = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      const [id, timer] = next;
      elapsed = timer.at;
      if (timer.interval) timer.at += timer.interval;
      else timers.delete(id);
      timer.callback();
      await flush();
    }
    elapsed = end;
    await flush();
  };
  return {
    store,
    requests,
    notices,
    statuses,
    flush,
    tick,
    read: (name) => JSON.parse(storage.get(names[name]) || "null"),
    status: () => store.status,
    online(value) {
      env.online = value;
      if (value) store.handleOnline();
      else store.handleOffline();
    },
    visible() {
      store.handleVisible();
    },
  };
}

// ------------------------------------------------------------ sync engine
test("a fresh offline install initialises default items and preserves usable local counters", async () => {
  const app = harness();
  await app.flush();
  assert.equal(app.read("items").length, DEFAULT_ITEM_DATA.length);
  assert.match(app.status().label, /local safe|saved locally/i);
  app.store.setCount("v2-default-1", 3);
  assert.equal(app.read("counts")["v2-default-1"], 3);
  assert.equal(app.requests.length, 0);
});

test("the overall 10 second deadline includes a hanging request", async () => {
  const pending = deferred();
  const history = [{ id: "offline-sheet", createdAt: "2026-09-01T10:00:00Z", entries: [] }];
  const app = harness({ online: true, seed: { counts: { "v2-default-1": 6 }, history }, fetch: () => pending.promise });
  await app.flush();
  assert.equal(app.status().state, "syncing");
  await app.tick(9999);
  assert.equal(app.status().state, "syncing");
  await app.tick(2);
  assert.match(app.status().label, /Cloud unavailable.*local safe/i);
  assert.equal(app.store.busy, false);
  assert.equal(app.requests[0].signal.aborted, true);
  assert.equal(app.read("counts")["v2-default-1"], 6);
  assert.deepEqual(app.read("history"), history);
  // A timed-out request may finish later. It cannot overwrite local state or
  // turn a failed request into a successful empty-store upload.
  pending.resolve(remote({ "v2-default-1": 99 }));
  await app.flush();
  assert.equal(app.read("counts")["v2-default-1"], 6);
  assert.equal(app.status().state, "error");
  assert.equal(app.requests.length, 1);
});

test("a valid GET envelope updates a previously synced device and reaches Cloud synced", async () => {
  const app = harness({
    online: true,
    seed: { counts: { "v2-default-1": 1 }, meta: { everSynced: true, lastServerUpdatedAt: 1 } },
    fetch: () => Promise.resolve(remote({ "v2-default-1": 7 })),
  });
  await app.flush();
  assert.equal(app.status().label, "Cloud synced");
  assert.equal(app.status().state, "synced");
  assert.equal(app.read("counts")["v2-default-1"], 7);
  assert.equal(app.requests.length, 1);
  assert.equal(app.requests[0].method, "GET");
  assert.deepEqual(app.notices, ["Cloud data updated"]);
});

for (const [name, result] of [
  ["ok:false", () => Promise.resolve({ ok: false, error: "Datastore failed", record: null })],
  ["missing record", () => Promise.resolve({ ok: true })],
  ["invalid record", () => Promise.resolve({ ok: true, record: { updatedAt: 2, state: [] } })],
  ["non-object reply", () => Promise.resolve([])],
  ["HTTP failure (kit.api throws)", () => Promise.reject(new Error("The waste datastore is unavailable."))],
]) {
  test(`${name} is a failed GET, never a successful empty cloud`, async () => {
    const history = [{ id: "retained", entries: [] }];
    const app = harness({ online: true, seed: { counts: { "v2-default-1": 4 }, history }, fetch: () => result() });
    await app.flush();
    assert.equal(app.status().state, "error");
    assert.equal(app.store.busy, false);
    assert.equal(app.read("counts")["v2-default-1"], 4);
    assert.deepEqual(app.read("history"), history);
    assert.equal(app.requests.filter((r) => r.method === "POST").length, 0);
  });
}

test("offline startup automatically reconnects while retaining dirty first-sync counts and history", async () => {
  const localHistory = { id: "local-sheet", createdAt: "2026-09-02T10:00:00Z", entries: [] };
  const remoteHistory = { id: "remote-sheet", createdAt: "2026-09-01T10:00:00Z", entries: [] };
  const cloud = remote({ "v2-default-1": 90 });
  cloud.record.state.history = [remoteHistory];
  const app = harness({
    seed: { history: [localHistory] },
    fetch: (request) => Promise.resolve(request.method === "POST" ? { ok: true, updatedAt: 3 } : cloud),
  });
  app.store.setCount("v2-default-1", 5);
  app.online(true);
  await app.tick(1500); // reconnects are deliberately debounced
  assert.equal(app.status().label, "Cloud synced");
  assert.equal(app.read("counts")["v2-default-1"], 5);
  assert.deepEqual(app.read("history").map((sheet) => sheet.id).sort(), ["local-sheet", "remote-sheet"]);
  const sent = app.requests.filter((request) => request.method === "POST");
  assert.equal(sent.length, 1);
  assert.equal(JSON.parse(sent[0].body).state.counts["v2-default-1"], 5);
});

test("offline events update status immediately, even while the first GET is pending", async () => {
  const pending = deferred();
  const app = harness({ online: true, fetch: () => pending.promise });
  await app.flush();
  app.online(false);
  assert.match(app.status().label, /local safe|saved locally/i);
  assert.notEqual(app.status().state, "syncing");
  await app.tick(10001);
  assert.notEqual(app.status().state, "syncing");
});

test("online and visibility events cannot launch concurrent initial pulls", async () => {
  const pending = deferred();
  const app = harness({ online: true, fetch: () => pending.promise });
  await app.flush();
  app.online(true);
  app.online(true);
  app.visible();
  app.store.pull();
  await app.flush();
  assert.equal(app.requests.length, 1);
  await app.tick(10001);
  assert.equal(app.store.busy, false);
});

test("poll and reconnect serialise with POST; changes made during POST are sent afterwards", async () => {
  const pendingPost = deferred();
  let posts = 0;
  const app = harness({
    online: true,
    seed: { meta: { everSynced: true, lastServerUpdatedAt: 2 } },
    fetch: (request) => {
      if (request.method !== "POST") return Promise.resolve(remote());
      posts++;
      return posts === 1 ? pendingPost.promise : Promise.resolve({ ok: true, updatedAt: 4 });
    },
  });
  await app.flush();
  await app.tick(14500);
  app.store.setCount("v2-default-1", 3);
  app.store.push();
  await app.flush();
  assert.equal(posts, 1);
  assert.equal(JSON.parse(app.requests.find((r) => r.method === "POST").body).state.counts["v2-default-1"], 3);
  // Both edits share the same millisecond: a time-only dirty check loses this edit.
  app.store.setCount("v2-default-1", 4);
  app.online(true);
  app.visible();
  await app.tick(500); // the 15-second poll fires while the POST is still pending
  assert.equal(app.requests.length, 2, "GET and POST must share the same in-flight guard");
  pendingPost.resolve({ ok: true, updatedAt: 3 });
  await app.flush();
  if (posts === 1) assert.ok(app.read("meta").localModifiedAt > 0, "a pending edit must stay dirty after the older POST succeeds");
  await app.tick(1000);
  const sent = app.requests.filter((r) => r.method === "POST");
  assert.equal(sent.length, 2);
  assert.equal(JSON.parse(sent[1].body).state.counts["v2-default-1"], 4);
  assert.equal(app.read("counts")["v2-default-1"], 4);
  assert.equal(app.status().label, "Cloud synced");
});

test("unsuccessful POST responses preserve dirty data for automatic retry", async () => {
  let failPost = true;
  const app = harness({
    online: true,
    seed: { meta: { everSynced: true, lastServerUpdatedAt: 2 } },
    fetch: (request) =>
      request.method === "POST"
        ? failPost
          ? Promise.reject(new Error("Save rejected"))
          : Promise.resolve({ ok: true, updatedAt: 3 })
        : Promise.resolve(remote()),
  });
  await app.flush();
  app.store.setCount("v2-default-1", 8);
  await app.tick(650);
  assert.equal(app.status().state, "error");
  assert.ok(app.read("meta").localModifiedAt > 0);
  assert.equal(app.read("counts")["v2-default-1"], 8);
  failPost = false;
  app.online(true);
  await app.tick(1500);
  assert.equal(app.status().label, "Cloud synced");
  assert.equal(app.read("counts")["v2-default-1"], 8);
});

test("a POST reply without updatedAt is a failed save", async () => {
  const app = harness({
    online: true,
    seed: { meta: { everSynced: true, lastServerUpdatedAt: 2 } },
    fetch: (request) => Promise.resolve(request.method === "POST" ? { ok: true } : remote()),
  });
  await app.flush();
  app.store.setCount("v2-default-2", 1);
  await app.tick(650);
  assert.equal(app.status().state, "error");
  assert.ok(app.read("meta").localModifiedAt > 0);
});

test("a GET followed by an upload shares one overall 10 second deadline", async () => {
  const pendingGet = deferred();
  const pendingPost = deferred();
  const app = harness({
    online: true,
    seed: { counts: { "v2-default-1": 6 } },
    fetch: (request) => (request.method === "POST" ? pendingPost.promise : pendingGet.promise),
  });
  await app.tick(9000);
  pendingGet.resolve({ ok: true, record: null });
  await app.flush();
  assert.equal(app.requests.length, 2);
  assert.equal(app.requests[1].method, "POST");
  await app.tick(999);
  assert.equal(app.status().state, "syncing");
  await app.tick(2);
  assert.equal(app.status().state, "error");
  assert.equal(app.store.busy, false);
  assert.equal(app.requests[1].signal.aborted, true);
  assert.equal(app.read("counts")["v2-default-1"], 6);
  pendingPost.resolve({ ok: true, updatedAt: 4 });
  await app.flush();
  assert.equal(app.status().state, "error");
  assert.equal(app.read("counts")["v2-default-1"], 6);
});

test("edits made while GET is pending survive the returned cloud snapshot", async () => {
  const pendingGet = deferred();
  const app = harness({
    online: true,
    seed: { meta: { everSynced: true, lastServerUpdatedAt: 1 } },
    fetch: (request) => (request.method === "POST" ? Promise.resolve({ ok: true, updatedAt: 3 }) : pendingGet.promise),
  });
  await app.flush();
  app.store.setCount("v2-default-1", 4);
  await app.tick(650);
  assert.equal(app.requests.length, 1);
  pendingGet.resolve(remote({ "v2-default-1": 90 }));
  await app.flush();
  assert.equal(app.read("counts")["v2-default-1"], 4);
  assert.equal(app.status().label, "Cloud synced");
  assert.equal(JSON.parse(app.requests.find((r) => r.method === "POST").body).state.counts["v2-default-1"], 4);
});

test("server failures retry automatically with backoff, without a reconnect event or request spam", async () => {
  let available = false;
  const app = harness({
    online: true,
    seed: { meta: { everSynced: true, lastServerUpdatedAt: 2 } },
    fetch: () => (available ? Promise.resolve(remote()) : Promise.reject(new Error("Server error"))),
  });
  await app.flush();
  assert.equal(app.requests.length, 1);
  await app.tick(14999);
  assert.equal(app.requests.length, 1);
  await app.tick(1);
  assert.equal(app.requests.length, 2);
  await app.tick(29999);
  assert.equal(app.requests.length, 2);
  available = true;
  await app.tick(1);
  assert.equal(app.requests.length, 3);
  assert.equal(app.status().label, "Cloud synced");
});

test("the manager PIN client preserves action payloads and structured API errors", async () => {
  const app = harness({
    fetch: (request) => {
      const body = JSON.parse(request.body);
      assert.equal(body.action, "pin-verify");
      assert.equal(body.state, undefined);
      return Promise.resolve(
        body.pin === "1234" ? { ok: true } : { ok: false, code: "PIN_INCORRECT", error: "Incorrect manager PIN." },
      );
    },
  });
  await assert.rejects(app.store.pinRequest("pin-verify", { pin: "1234" }), /internet connection/);
  app.online(true);
  assert.equal((await app.store.pinRequest("pin-verify", { pin: "1234" })).ok, true);
  await assert.rejects(app.store.pinRequest("pin-verify", { pin: "9999" }), (error) => {
    assert.equal(error.code, "PIN_INCORRECT");
    assert.equal(error.message, "Incorrect manager PIN.");
    return true;
  });
  const pinRequests = app.requests.filter((r) => r.body?.includes("pin-verify"));
  assert.equal(pinRequests.length, 2);
  for (const request of pinRequests) assert.equal(request.method, "POST");
});

test("a hanging manager PIN reply has the same bounded timeout", async () => {
  const pending = deferred();
  const app = harness({ fetch: () => pending.promise, start: false });
  app.online(true);
  const rejected = assert.rejects(app.store.pinRequest("pin-status"), /timed out/i);
  await app.tick(10001);
  await rejected;
  assert.equal(app.requests[0].signal.aborted, true);
});

test("a local (preview) PIN transport works offline and never needs the cloud", async () => {
  const app = harness({
    cloud: false,
    local: true,
    fetch: () => Promise.resolve({ ok: true, configured: true }),
  });
  await app.flush();
  assert.equal((await app.store.pinRequest("pin-status")).configured, true);
  app.store.setCount("v2-default-1", 2);
  await app.tick(60000);
  assert.equal(app.requests.length, 1, "only the PIN call; no sync without a cloud");
  assert.equal(app.read("counts")["v2-default-1"], 2);
});

test("typing only a sheet name during first GET retains the cloud counts", async () => {
  const pendingGet = deferred();
  const cloud = remote({ "v2-default-1": 7 });
  cloud.record.state.draft = { sheetName: "Cloud sheet", sheetNotes: "Cloud notes" };
  const app = harness({
    online: true,
    fetch: (request) => (request.method === "POST" ? Promise.resolve({ ok: true, updatedAt: 3 }) : pendingGet.promise),
  });
  await app.flush();
  app.store.setDraft({ sheetName: "New local sheet" });
  pendingGet.resolve(cloud);
  await app.flush();
  assert.equal(app.status().label, "Cloud synced");
  assert.equal(app.read("counts")["v2-default-1"], 7, "editing draft text must not make empty local counts authoritative");
  assert.equal(app.read("draft").sheetName, "New local sheet");
  const sent = JSON.parse(app.requests.find((r) => r.method === "POST").body).state;
  assert.equal(sent.counts["v2-default-1"], 7);
  assert.equal(sent.draft.sheetName, "New local sheet");
});

test("editing only a count during first GET retains the untouched cloud draft", async () => {
  const pendingGet = deferred();
  const cloud = remote({ "v2-default-1": 7 });
  const draft = { sheetName: "Cloud sheet", sheetNotes: "Cloud notes" };
  cloud.record.state.draft = draft;
  const app = harness({
    online: true,
    fetch: (request) => (request.method === "POST" ? Promise.resolve({ ok: true, updatedAt: 3 }) : pendingGet.promise),
  });
  await app.flush();
  app.store.setCount("v2-default-1", 4);
  pendingGet.resolve(cloud);
  await app.flush();
  assert.equal(app.status().label, "Cloud synced");
  assert.equal(app.read("counts")["v2-default-1"], 4);
  assert.deepEqual(app.read("draft"), draft, "editing counts must not make an untouched empty local draft authoritative");
  const sent = JSON.parse(app.requests.find((r) => r.method === "POST").body).state;
  assert.equal(sent.counts["v2-default-1"], 4);
  assert.deepEqual(sent.draft, { ...draft, sheetId: null });
});

test("a truly fresh install adopts the cloud item catalogue without restoring defaults or posting", async () => {
  const select = { id: "v6-select-123", name: "Select", category: "Chicken & Fish", shift: "main", type: "raw", custom: false };
  const nugget = { id: "v10-nugget-123", name: "Nugget", category: "Chicken & Fish", shift: "main", type: "raw", custom: false };
  const cloud = remote({ [select.id]: 5 });
  cloud.record.state.items = [select, nugget];
  const app = harness({
    online: true,
    fetch: (request) => {
      assert.notEqual(request.method, "POST", "a fresh device should adopt the existing record without rewriting it");
      return Promise.resolve(cloud);
    },
  });
  await app.flush();
  assert.equal(app.status().label, "Cloud synced");
  assert.deepEqual(app.read("items"), [select, nugget]);
  assert.deepEqual(app.read("counts"), { [select.id]: 5 });
  assert.equal(app.store.countedEntries().reduce((sum, entry) => sum + entry.count, 0), 5);
  assert.equal(app.requests.length, 1);
});

test("first-sync merging remaps local counts and saved history to the canonical cloud item ID", async () => {
  const select = { id: "v6-select-123", name: "Select", category: "Chicken & Fish", shift: "main", type: "raw", custom: false };
  const localSelectId = "v2-default-9";
  const history = [
    {
      id: "local-select-sheet",
      createdAt: "2026-09-02T10:00:00Z",
      label: "Local history",
      notes: "",
      entries: [{ ...select, id: localSelectId, count: 2 }],
      totals: { raw: 2, full: 0, total: 2 },
    },
  ];
  const cloud = remote({ [select.id]: 5 });
  cloud.record.state.items = [select];
  const app = harness({
    online: true,
    seed: { counts: { [localSelectId]: 3 }, history },
    fetch: (request) => Promise.resolve(request.method === "POST" ? { ok: true, updatedAt: 3 } : cloud),
  });
  await app.flush();
  assert.equal(app.status().label, "Cloud synced");
  const selects = app.read("items").filter((item) => item.name === "Select" && item.type === "raw");
  assert.equal(selects.length, 1);
  assert.equal(selects[0].id, select.id);
  assert.equal(app.read("counts")[select.id], 3);
  assert.equal(app.read("counts")[localSelectId], undefined);
  assert.equal(app.store.countedEntries().reduce((sum, entry) => sum + entry.count, 0), 3);
  const restoredEntry = app.read("history").find((sheet) => sheet.id === "local-select-sheet").entries[0];
  assert.equal(restoredEntry.id, select.id);
  assert.equal(restoredEntry.count, 2);
  const sent = JSON.parse(app.requests.find((r) => r.method === "POST").body).state;
  assert.equal(sent.counts[select.id], 3);
  assert.equal(sent.history.find((sheet) => sheet.id === "local-select-sheet").entries[0].id, select.id);
});

test("independent local counts never adopt the remote active sheet identity during first sync", async () => {
  const pendingGet = deferred();
  const cloud = remote({ "v2-default-1": 7 });
  cloud.record.state.draft = { sheetName: "Cloud shift", sheetNotes: "Remote notes", sheetId: "remote-saved-sheet" };
  cloud.record.state.history = [
    {
      id: "remote-saved-sheet",
      createdAt: "2023-11-13T18:00:00Z",
      label: "Cloud shift",
      notes: "",
      totals: { raw: 7, full: 0, total: 7 },
      entries: [{ id: "v2-default-1", name: "10:1 Beef Patty", type: "raw", count: 7 }],
    },
  ];
  const app = harness({
    online: true,
    fetch: (request) => (request.method === "POST" ? Promise.resolve({ ok: true, updatedAt: 3 }) : pendingGet.promise),
  });
  await app.flush();
  app.store.setCount("v2-default-1", 4);
  pendingGet.resolve(cloud);
  await app.flush();
  assert.equal(app.read("counts")["v2-default-1"], 4);
  assert.equal(app.read("draft").sheetName, "Cloud shift", "untouched draft text still adopts the shared notes");
  assert.ok(!app.read("draft").sheetId, "identity follows the independent local counts, not remote draft text");
  const sent = JSON.parse(app.requests.find((r) => r.method === "POST").body).state;
  assert.ok(!sent.draft.sheetId);
  app.store.saveSheet();
  const saved = app.read("history");
  assert.equal(saved.length, 2);
  assert.equal(saved.find((sheet) => sheet.id === "remote-saved-sheet").totals.total, 7);
  assert.equal(saved.find((sheet) => sheet.id !== "remote-saved-sheet").totals.total, 4);
});

test("adopting cloud state preserves the active saved ID and its original reporting date", async () => {
  const cloud = remote({ "v2-default-1": 10 });
  cloud.record.state.draft = { sheetName: "Cloud closing sheet", sheetNotes: "", sheetId: "cloud-active" };
  cloud.record.state.history = [
    {
      id: "cloud-active",
      createdAt: "2023-11-13T18:00:00Z",
      label: "Cloud closing sheet",
      notes: "",
      totals: { raw: 10, full: 0, total: 10 },
      entries: [{ id: "v2-default-1", name: "10:1 Beef Patty", type: "raw", count: 10 }],
    },
  ];
  const app = harness({
    online: true,
    seed: { meta: { everSynced: true, lastServerUpdatedAt: 1 } },
    fetch: () => Promise.resolve(cloud),
  });
  await app.flush();
  assert.equal(app.read("draft").sheetId, "cloud-active");
  app.store.setCount("v2-default-1", 12);
  app.store.saveSheet();
  assert.equal(app.read("history").length, 1);
  assert.equal(app.read("history")[0].id, "cloud-active");
  assert.equal(app.read("history")[0].createdAt, "2023-11-13T18:00:00Z");
  assert.equal(app.read("history")[0].totals.total, 12);
  assert.equal(app.store.currentCloudState().draft.sheetId, "cloud-active");
});

// ------------------------------------------------------------- sheets
test("saving a current sheet again updates its counts without inflating daily history", async () => {
  const app = harness();
  app.store.setCount("v2-default-1", 10);
  assert.equal(app.store.saveSheet().updated, false);
  const first = app.read("history")[0];
  await app.tick(1001);
  app.store.setCount("v2-default-1", 12);
  assert.equal(app.store.saveSheet().updated, true);
  app.store.saveSheet();
  const saved = app.read("history");
  assert.equal(saved.length, 1, "repeated Save must update the active sheet, not append snapshots");
  assert.equal(saved[0].id, first.id);
  assert.equal(saved[0].createdAt, first.createdAt, "updating must keep the original reporting day");
  assert.equal(saved[0].totals.total, 12);
  assert.equal(saved[0].entries[0].count, 12);
  assert.equal(app.read("draft").sheetId, first.id, "the active saved ID must survive reload and sync");
  assert.equal(app.store.currentCloudState().draft.sheetId, first.id);
});

test("saving with nothing counted is refused", () => {
  const app = harness();
  assert.deepEqual(app.store.saveSheet(), { ok: false, reason: "empty" });
  assert.equal(app.read("history"), null);
});

test("reloading retains the active saved sheet and updates that record on the next Save", async () => {
  const first = harness();
  first.store.setCount("v2-default-1", 6);
  first.store.saveSheet();
  const original = first.read("history")[0];
  const reloaded = harness({
    seed: {
      items: first.read("items"),
      counts: first.read("counts"),
      history: first.read("history"),
      draft: first.read("draft"),
      meta: first.read("meta") || {},
    },
  });
  reloaded.store.setCount("v2-default-1", 8);
  reloaded.store.saveSheet();
  assert.equal(reloaded.read("history").length, 1);
  assert.equal(reloaded.read("history")[0].id, original.id);
  assert.equal(reloaded.read("history")[0].totals.total, 8);
});

for (const action of ["clearCurrent", "restartSheet"]) {
  test(`${action}() detaches the active saved record so the next Save starts a distinct sheet`, async () => {
    const app = harness();
    app.store.setCount("v2-default-1", 10);
    app.store.setDraft({ sheetName: "Close", sheetNotes: "Busy night" });
    app.store.saveSheet();
    const original = app.read("history")[0];
    app.store[action]();
    assert.ok(!app.read("draft").sheetId);
    assert.deepEqual(app.read("counts"), {});
    if (action === "restartSheet") assert.deepEqual([app.store.draft.sheetName, app.store.draft.sheetNotes], ["", ""]);
    else assert.equal(app.store.draft.sheetName, "Close", "clearing keeps the notes like the standalone app");
    app.store.setCount("v2-default-1", 4);
    app.store.saveSheet();
    const saved = app.read("history");
    assert.equal(saved.length, 2);
    assert.notEqual(saved[0].id, original.id, "a second sheet needs a distinct ID even within the same clock tick");
    assert.equal(saved.find((sheet) => sheet.id === original.id).totals.total, 10);
    assert.equal(saved.find((sheet) => sheet.id !== original.id).totals.total, 4);
  });
}

test("restoring historical counts starts a new sheet and preserves the original record", async () => {
  const app = harness();
  app.store.setCount("v2-default-1", 10);
  app.store.setDraft({ sheetName: "Lunch", sheetNotes: "Rush" });
  app.store.saveSheet();
  const original = app.read("history")[0];
  app.store.clearCurrent();
  assert.equal(app.store.restoreHistory(original.id), true);
  assert.equal(app.store.countOf("v2-default-1"), 10);
  assert.equal(app.store.draft.sheetName, "Lunch");
  assert.ok(!app.read("draft").sheetId);
  app.store.setCount("v2-default-1", 3);
  app.store.saveSheet();
  app.store.saveSheet();
  const saved = app.read("history");
  assert.equal(saved.length, 2);
  assert.equal(saved.find((sheet) => sheet.id === original.id).totals.total, 10);
  assert.equal(saved.find((sheet) => sheet.id !== original.id).totals.total, 3);
  assert.equal(app.store.restoreHistory("missing"), false);
});

test("deleting a saved sheet removes only that sheet and detaches it if active", () => {
  const app = harness();
  app.store.setCount("v2-default-1", 2);
  app.store.saveSheet();
  const first = app.read("history")[0];
  app.store.clearCurrent();
  app.store.setCount("v2-default-2", 5);
  app.store.saveSheet();
  assert.equal(app.read("history").length, 2);
  const active = app.store.draft.sheetId;
  assert.equal(app.store.deleteHistory(active), true);
  assert.deepEqual(app.read("history").map((s) => s.id), [first.id]);
  assert.equal(app.store.draft.sheetId, null);
  assert.equal(app.store.deleteHistory("nope"), false);
});

test("totals and counted entries follow RAW/FULL types and never go negative", () => {
  const app = harness();
  app.store.step("v2-default-1", 1);
  app.store.step("v2-default-1", 1);
  app.store.step("v2-default-26", 1); // Big Mac (FULL)
  app.store.step("v2-default-2", -1);
  app.store.setCount("v2-default-3", "7");
  app.store.setCount("v2-default-4", -5);
  app.store.setCount("v2-default-5", "abc");
  assert.deepEqual(app.store.totals(), { raw: 9, full: 1, total: 10, lines: 3 });
  assert.deepEqual(app.read("counts"), { "v2-default-1": 2, "v2-default-26": 1, "v2-default-3": 7 });
  app.store.setCount("v2-default-1", 0);
  assert.equal(app.read("counts")["v2-default-1"], undefined);
});

// ----------------------------------------------------------- item list
test("items can be added, renamed and removed with duplicate protection", () => {
  const app = harness();
  const added = app.store.addItem({ name: "  McSpicy  ", type: "full", category: "Burgers", shift: "main" });
  assert.equal(added.ok, true);
  assert.equal(added.item.name, "McSpicy");
  assert.equal(added.item.custom, true);
  assert.equal(app.store.addItem({ name: "mcspicy", type: "full", category: "Burgers", shift: "main" }).reason, "duplicate");
  assert.equal(app.store.addItem({ name: "McSpicy", type: "raw", category: "Beef", shift: "main" }).ok, true, "same name, other type is fine");
  assert.equal(app.store.addItem({ name: "   ", type: "raw" }).reason, "name");
  assert.equal(app.store.addItem({ name: "X", type: "other" }).reason, "type");
  const odd = app.store.addItem({ name: "Odd", type: "raw", category: "Burgers", shift: "never" });
  assert.equal(odd.item.category, "Beef", "unknown categories fall back to the first valid one");
  assert.equal(odd.item.shift, "main");

  app.store.setCount(added.item.id, 3);
  assert.equal(app.store.renameItem(added.item.id, "Big Mac").reason, "duplicate");
  const renamed = app.store.renameItem(added.item.id, "McSpicy Deluxe");
  assert.equal(renamed.ok, true);
  assert.equal(app.store.countOf(added.item.id), 3, "renaming keeps the current count");
  assert.equal(app.read("items").find((i) => i.id === added.item.id).name, "McSpicy Deluxe");
  assert.equal(app.store.renameItem(added.item.id, "McSpicy Deluxe").unchanged, true);
  assert.equal(app.store.renameItem("missing", "x").reason, "missing");

  assert.equal(app.store.removeItem(added.item.id), true);
  assert.equal(app.read("counts")[added.item.id], undefined);
  assert.ok(!app.read("items").some((i) => i.id === added.item.id));
  assert.equal(app.store.removeItem(added.item.id), false);
});

test("restoring defaults brings back the exact Hayle lists and clears counts", () => {
  const app = harness();
  app.store.removeItem("v2-default-1");
  app.store.addItem({ name: "Promo", type: "full", category: "Seasonal", shift: "main" });
  app.store.setCount("v2-default-2", 4);
  app.store.restoreDefaults();
  assert.deepEqual(app.read("items"), defaultItems());
  assert.deepEqual(app.read("counts"), {});
});

test("the default catalogue keeps the business labels exactly", () => {
  const items = defaultItems();
  assert.equal(items.length, 78);
  assert.equal(items.filter((i) => i.type === "raw").length, 25);
  assert.equal(items.filter((i) => i.type === "full").length, 53);
  assert.deepEqual(items[0], { id: "v2-default-1", name: "10:1 Beef Patty", category: "Beef", shift: "main", type: "raw", custom: false });
  assert.equal(items[7].name, "Nugget");
  assert.equal(items[8].name, "Select");
  assert.deepEqual(items.at(-1), { id: "v2-default-78", name: "Cheesy Potato Bites", category: "Seasonal", shift: "main", type: "full", custom: false });
});

test("V6/V10 migrations rename old RAW items and add missing Select/Nugget", () => {
  const { items, changed } = migrateItems(
    [
      { id: "a", name: "Chicken Select", type: "raw", category: "Chicken & Fish", shift: "main" },
      { id: "b", name: "Big Mac", type: "full", category: "Burgers", shift: "main" },
    ],
    123,
  );
  assert.equal(changed, true);
  assert.deepEqual(items.map((i) => i.name), ["Select", "Big Mac", "Nugget"]);
  assert.equal(items[2].id, "v10-nugget-123");
  const fresh = migrateItems(null);
  assert.equal(fresh.fresh, true);
  assert.equal(fresh.items.length, 78);
  const untouched = migrateItems(defaultItems());
  assert.equal(untouched.changed, false);
});

test("merge helpers keep the newest sheet per ID and canonical item IDs", () => {
  const merged = mergeHistory(
    [{ id: "a", createdAt: "2026-01-01T00:00:00Z", label: "old" }],
    [
      { id: "a", createdAt: "2026-01-02T00:00:00Z", label: "new" },
      { id: "b", createdAt: "2026-01-03T00:00:00Z" },
      { createdAt: "2026-01-04T00:00:00Z" },
    ],
  );
  assert.deepEqual(merged.map((s) => s.id), ["b", "a"]);
  assert.equal(merged[1].label, "new");
  const items = mergeItems(
    [{ id: "cloud-1", name: "Select", type: "raw" }],
    [{ id: "local-9", name: " select ", type: "raw" }, { id: "x", name: "Big Mac", type: "full" }],
  );
  assert.deepEqual(items.map((i) => i.id), ["cloud-1", "x"]);
});

test("safeStorage keeps working when the browser blocks storage", () => {
  const blocked = {
    getItem() {
      throw new Error("SecurityError");
    },
    setItem() {
      throw new Error("QuotaExceededError");
    },
    removeItem() {
      throw new Error("SecurityError");
    },
  };
  const storage = safeStorage(blocked);
  assert.equal(storage.getItem("k"), null);
  storage.setItem("k", "v");
  assert.equal(storage.getItem("k"), "v");
  storage.removeItem("k");
  assert.equal(storage.getItem("k"), null);
  const store = createWasteStore({ storage: safeStorage(blocked), keys, warn() {} });
  store.setCount("v2-default-1", 2);
  assert.equal(store.saveSheet().ok, true);
  assert.equal(store.history().length, 1);
});
