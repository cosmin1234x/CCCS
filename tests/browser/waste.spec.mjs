// Waste tab (waste.html): the Hayle Waste Counter inside the hub.
// /api/waste is mocked in the page with the proxy's exact contract, so these
// tests never reach the real Hayle datastore.
import { test, expect as baseExpect } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import { defaultItems } from "../../waste-core.js";

// ------------------------------------------------------------ fixtures
// The Firebase SDK is replaced by small mocks. Export every name the hub's
// modules import so new imports elsewhere never break this spec.
function firebaseImports(kind) {
  const names = new Set();
  for (const file of readdirSync(".").filter((f) => f.endsWith(".js"))) {
    const source = readFileSync(file, "utf8");
    const pattern = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*["'][^"']*firebase-${kind}\\.js["']`, "g");
    for (const match of source.matchAll(pattern))
      match[1]
        .split(",")
        .map((part) => part.trim().split(/\s+as\s+/)[0].trim())
        .filter(Boolean)
        .forEach((name) => names.add(name));
  }
  return names;
}
function stubExports(kind, implemented) {
  return [...firebaseImports(kind)]
    .filter((name) => !implemented.includes(name))
    .map((name) => `export const ${name}=(...args)=>({});`)
    .join("");
}

const AUTH_IMPL = `export const onAuthStateChanged=(auth,callback)=>{queueMicrotask(()=>callback(auth.currentUser));return ()=>{};};export const signOut=async()=>{};export const createUserWithEmailAndPassword=async()=>{};export const signInWithEmailAndPassword=async()=>{};export const updateProfile=async()=>{};export const sendPasswordResetEmail=async()=>{};`;
const AUTH_NAMES = ["onAuthStateChanged", "signOut", "createUserWithEmailAndPassword", "signInWithEmailAndPassword", "updateProfile", "sendPasswordResetEmail"];
const STORE_IMPL = `const qa=window.__qa;export const doc=(db,...path)=>({path:path.join('/')});export const collection=doc;export const where=()=>({});export const query=(ref)=>ref;export const orderBy=()=>({});export const limit=()=>({});export const serverTimestamp=()=>0;export const setDoc=async()=>{};export const updateDoc=async()=>{};export const addDoc=async()=>({id:'test'});export const deleteDoc=async()=>{};export const getDoc=async()=>({exists:()=>true,data:()=>qa.profile,id:qa.profile.id});export const getDocs=async()=>({docs:[],empty:true,size:0,forEach:()=>{}});export function onSnapshot(ref,callback){const kind=String(ref?.path||'').includes('portalTraining')?'progress':'shifts';const run=()=>callback({docs:kind==='progress'?Object.entries(qa.progress).map(([id,value])=>({id,data:()=>value})):[]});qa.callbacks.push({kind,run});setTimeout(run,100);return ()=>{};}`;
const STORE_NAMES = ["doc", "collection", "where", "query", "orderBy", "limit", "serverTimestamp", "setDoc", "updateDoc", "addDoc", "deleteDoc", "getDoc", "getDocs", "onSnapshot"];

async function signedIn(page, role = "crew") {
  const profile = {
    id: "qa-" + role,
    name: role === "manager" ? "Morgan Manager" : "Alex Crew",
    role,
    storeId: "1170",
    storeName: "1170 · Hayle",
    verifiedStations: [],
  };
  await page.addInitScript(
    ({ profile }) => {
      window.__qa = {
        profile,
        progress: {},
        callbacks: [],
        emit(kind) {
          this.callbacks.filter((c) => c.kind === kind).forEach((c) => c.run());
        },
      };
      window.__printed = 0;
      window.print = () => {
        window.__printed += 1;
      };
    },
    { profile },
  );
  await page.route("**/firebase-init.js", (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: `export const db={};export const app={};export const analytics=null;export const auth={currentUser:{uid:'${profile.id}',email:'qa@example.invalid',getIdToken:async()=> 'test-token'}};`,
    }),
  );
  await page.route("https://www.gstatic.com/firebasejs/**/firebase-auth.js", (r) =>
    r.fulfill({ contentType: "text/javascript", body: AUTH_IMPL + stubExports("auth", AUTH_NAMES) }),
  );
  await page.route("https://www.gstatic.com/firebasejs/**/firebase-firestore.js", (r) =>
    r.fulfill({ contentType: "text/javascript", body: STORE_IMPL + stubExports("firestore", STORE_NAMES) }),
  );
  await page.route("**/api/portal-data", (r) =>
    r.fulfill({
      json: {
        profile,
        progress: {},
        shifts: [],
        team: [],
        verifications: [],
        roleRequests: [],
        permissions: { canPlanShifts: role === "manager", canSeeTeam: role === "manager" },
      },
    }),
  );
  await page.route("**/api/ai-chat", (r) => r.fulfill({ json: { reply: "Preview reply." } }));
  return profile;
}

const DAY = 86400000;
function sheet(id, daysAgo, label, entries, notes = "") {
  const items = defaultItems();
  const list = entries.map(([n, count]) => ({ ...items[n - 1], count }));
  const raw = list.filter((e) => e.type === "raw").reduce((s, e) => s + e.count, 0);
  const full = list.filter((e) => e.type === "full").reduce((s, e) => s + e.count, 0);
  const createdAt = new Date(Date.now() - daysAgo * DAY).toISOString();
  return { id, createdAt, updatedAt: createdAt, label, notes, shift: "main", totals: { raw, full, total: raw + full }, entries: list };
}

// In-page mock of /api/waste with the proxy's contract (auth required, PIN
// business answers as 200 { ok:false, code }).
async function wasteApi(page, { state, pin = "2468", fail = false } = {}) {
  const api = {
    record: state ? { version: 1, updatedAt: 1000, state } : null,
    pin,
    fail,
    requests: [],
    posts: () => api.requests.filter((r) => r.method === "POST" && r.body?.state),
    pins: () => api.requests.filter((r) => r.body?.action),
  };
  let clock = 2000;
  await page.route("**/api/waste**", async (route) => {
    const request = route.request();
    const raw = request.postData();
    const body = raw ? JSON.parse(raw) : null;
    const auth = request.headers()["authorization"] || "";
    api.requests.push({ method: request.method(), body, auth });
    if (!auth.startsWith("Bearer ")) return route.fulfill({ status: 401, json: { ok: false, error: "Sign in to continue." } });
    if (api.fail)
      return route.fulfill({
        status: 502,
        json: { ok: false, code: "WASTE_UPSTREAM_ERROR", error: "The shared waste datastore is unavailable right now." },
      });
    if (request.method() === "GET") return route.fulfill({ json: { ok: true, record: api.record } });
    if (body?.action) {
      if (body.action === "pin-status") return route.fulfill({ json: { ok: true, configured: Boolean(api.pin) } });
      if (body.action === "pin-verify")
        return route.fulfill({
          json: body.pin === api.pin ? { ok: true } : { ok: false, code: "PIN_INCORRECT", error: "Incorrect manager PIN." },
        });
      if (body.action === "pin-setup") {
        api.pin = body.pin;
        return route.fulfill({ json: { ok: true, configured: true } });
      }
      if (body.action === "pin-change") {
        if (body.currentPin !== api.pin)
          return route.fulfill({ json: { ok: false, code: "PIN_INCORRECT", error: "Incorrect manager PIN." } });
        api.pin = body.newPin;
        return route.fulfill({ json: { ok: true, configured: true } });
      }
      return route.fulfill({ status: 400, json: { ok: false, error: "Unknown waste action." } });
    }
    clock += 1000;
    api.record = { version: 1, updatedAt: clock, state: body.state };
    return route.fulfill({ json: { ok: true, updatedAt: clock } });
  });
  return api;
}

function sharedState(extra = {}) {
  return {
    version: 1,
    items: defaultItems(),
    counts: { "v2-default-1": 3, "v2-default-26": 2 },
    history: [
      sheet("sheet-close", 1, "Close · Ryan", [[1, 6], [3, 4], [26, 3]], "Grill slow after 11"),
      sheet("sheet-lunch", 2, "Lunch · Amelia", [[10, 5], [53, 2]]),
    ],
    draft: { sheetName: "", sheetNotes: "", sheetId: null },
    ...extra,
  };
}

// Headless WebKit on Windows renders at only a few frames per second, and
// these are full user journeys, so allow generous (but bounded) time.
test.describe.configure({ timeout: 120_000 });
const expect = baseExpect.configure({ timeout: 15_000 });

// Centre a control before tapping so the fixed bottom navigation or the Save
// dock never sits on top of it (as a person would scroll to it).
async function press(locator) {
  await locator.evaluate((el) => el.scrollIntoView({ block: "center", inline: "center" }));
  await locator.click();
}

const syncLabel = (page) => page.locator("#wasteSyncLabel");
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

// ---------------------------------------------------------------- tests
test("counts with fast +/- controls, saves the sheet and syncs through /api/waste", async ({ page }) => {
  await signedIn(page, "crew");
  const api = await wasteApi(page, { state: sharedState() });
  await page.goto("/waste.html");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Alex.");
  await expect(syncLabel(page)).toHaveText("Cloud synced");
  expect(api.requests[0].auth).toBe("Bearer test-token");
  await expect(page.locator("#content")).toHaveAttribute("data-enhanced-page", "waste");
  expect(await page.evaluate(() => document.body.dataset.hideAssistantLauncher)).toBe("true");

  const beef = page.getByRole("spinbutton", { name: "10:1 Beef Patty count" });
  await expect(beef).toHaveValue("3");
  const add = page.getByRole("button", { name: "Add one 10:1 Beef Patty" });
  await press(add);
  await press(add);
  await expect(beef).toHaveValue("5");
  await press(page.getByRole("button", { name: "Subtract one 10:1 Beef Patty" }));
  await expect(beef).toHaveValue("4");
  await expect(page.locator("#wasteRawTotal")).toHaveText("4");
  await expect(page.locator("#wasteGrandTotal")).toHaveText("6");
  // Typed values are accepted too.
  await page.getByRole("spinbutton", { name: "Regular Bun count" }).fill("12");
  await page.getByRole("spinbutton", { name: "Regular Bun count" }).press("Enter");
  await expect(page.locator("#wasteGrandTotal")).toHaveText("18");

  await expect.poll(() => api.posts().at(-1)?.body.state.counts["v2-default-10"]).toBe(12);
  expect(api.posts().at(-1).body.state.counts["v2-default-1"]).toBe(4);
  await expect(syncLabel(page)).toHaveText("Cloud synced");

  await page.getByRole("textbox", { name: "Crew / shift note" }).fill("Close · Alex");
  await press(page.getByRole("button", { name: "Save sheet" }));
  await expect(page.locator("#toast")).toContainText("Waste sheet saved");
  await expect(page.locator("#wasteDockState")).toContainText("Saved at");
  await expect
    .poll(() => api.posts().at(-1)?.body.state.history.find((s) => s.label === "Close · Alex")?.totals)
    .toEqual({ raw: 16, full: 2, total: 18 });
  // Saving again updates the same sheet instead of duplicating the day.
  await press(page.getByRole("button", { name: /^FULL/ }));
  await press(page.getByRole("button", { name: "Add one Big Mac" }));
  await expect(page.locator("#wasteDockState")).toHaveText("Unsaved changes · Save to update");
  await press(page.getByRole("button", { name: "Save sheet" }));
  await expect(page.locator("#toast")).toContainText("Saved sheet updated");
  await expect.poll(() => api.posts().at(-1)?.body.state.history.filter((s) => s.label === "Close · Alex").length).toBe(1);
});

test("press and hold keeps counting", async ({ page }) => {
  await signedIn(page, "crew");
  await wasteApi(page, { state: sharedState() });
  await page.goto("/waste.html");
  await expect(syncLabel(page)).toHaveText("Cloud synced");
  const add = page.getByRole("button", { name: "Add one McChicken Patty" });
  await add.evaluate((el) => el.scrollIntoView({ block: "center" }));
  const box = await add.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1300);
  await page.mouse.up();
  const value = Number(await page.getByRole("spinbutton", { name: "McChicken Patty count" }).inputValue());
  expect(value).toBeGreaterThanOrEqual(3);
  // Releasing must not add an extra count from the trailing click.
  await page.waitForTimeout(400);
  expect(Number(await page.getByRole("spinbutton", { name: "McChicken Patty count" }).inputValue())).toBe(value);
  // Subtracting at zero is refused.
  const minus = page.getByRole("button", { name: "Subtract one Select" });
  await press(minus);
  await expect(page.getByRole("spinbutton", { name: "Select count" })).toHaveValue("0");
});

test("the manager PIN can be changed from the item manager", async ({ page }) => {
  await signedIn(page, "crew");
  const api = await wasteApi(page, { state: sharedState() });
  await page.goto("/waste.html");
  await expect(syncLabel(page)).toHaveText("Cloud synced");
  await press(page.getByRole("button", { name: "Manage items" }));
  await press(page.getByRole("button", { name: "Manage PIN" }));
  const dialog = page.getByRole("dialog", { name: "Change manager PIN" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Current PIN", { exact: true }).fill("2468");
  await dialog.getByLabel("New manager PIN", { exact: true }).fill("1357");
  await dialog.getByLabel("Confirm manager PIN", { exact: true }).fill("1350");
  await press(dialog.getByRole("button", { name: "Change PIN" }));
  await expect(dialog.getByRole("alert")).toHaveText("The two new PINs do not match.");
  await dialog.getByLabel("Confirm manager PIN", { exact: true }).fill("1357");
  await press(dialog.getByRole("button", { name: "Change PIN" }));
  await expect(dialog).toBeHidden();
  await expect(page.locator("#toast")).toContainText("Manager PIN changed");
  expect(api.pin).toBe("1357");
  expect(api.pins().at(-1).body).toEqual({ action: "pin-change", currentPin: "2468", newPin: "1357" });
});

test("RAW/FULL, menu period, category and counted filters narrow the list", async ({ page }) => {
  await signedIn(page, "crew");
  await wasteApi(page, { state: sharedState() });
  await page.goto("/waste.html");
  await expect(syncLabel(page)).toHaveText("Cloud synced");
  await expect(page.locator(".waste-row")).toHaveCount(25);
  await press(page.getByRole("button", { name: /^FULL/ }));
  await expect(page.locator(".waste-row")).toHaveCount(53);
  await expect(page.locator("#wasteListLabel")).toHaveText("FULL PRODUCT");
  await press(page.locator(".waste-period").getByRole("button", { name: "Breakfast" }));
  await expect(page.locator(".waste-row")).toHaveCount(18);
  await press(page.getByRole("button", { name: "All menu" }));
  await press(page.locator("#wasteCats").getByRole("button", { name: /^Desserts/ }));
  await expect(page.locator(".waste-row")).toHaveCount(5);
  await press(page.locator("#wasteCats").getByRole("button", { name: /^All/ }));
  await press(page.getByRole("button", { name: "Counted", exact: true }));
  await expect(page.locator(".waste-row")).toHaveCount(1);
  await expect(page.locator(".waste-row")).toContainText("Big Mac");
  await press(page.getByRole("button", { name: "All items" }));
  await page.getByRole("searchbox", { name: "Search waste items" }).fill("mcflurry");
  await expect(page.locator(".waste-row")).toHaveCount(2);
  await page.getByRole("searchbox", { name: "Search waste items" }).fill("zzz");
  await expect(page.getByRole("heading", { name: "No items found" })).toBeVisible();
});

test("history search, open and PIN-protected delete for crew", async ({ page }) => {
  await signedIn(page, "crew");
  const api = await wasteApi(page, { state: sharedState() });
  await page.goto("/waste.html#history");
  await expect(page.getByRole("tab", { name: "History" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".waste-history-card")).toHaveCount(2);
  await expect(page.locator("#wasteHistoryCount")).toHaveText("2");
  await page.getByRole("searchbox", { name: "Search saved sheets" }).fill("grill");
  await expect(page.locator(".waste-history-card")).toHaveCount(1);
  await expect(page.locator("#wasteHistoryResults")).toHaveText("1 sheet of 2");
  const card = page.locator(".waste-history-card").first();
  await press(card.getByText("View counted items"));
  await expect(card.locator(".waste-history-breakdown")).toContainText("Saver / Mayo Chicken Patty");
  await page.getByRole("searchbox", { name: "Search saved sheets" }).fill("");

  await press(page.getByRole("button", { name: "Delete Close · Ryan" }));
  const dialog = page.getByRole("dialog", { name: "Enter manager PIN" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Delete Close · Ryan");
  await dialog.getByLabel("Manager PIN", { exact: true }).fill("1111");
  await press(dialog.getByRole("button", { name: "Authorise" }));
  await expect(dialog.getByRole("alert")).toHaveText("Incorrect manager PIN. Try again.");
  await expect(page.locator(".waste-history-card")).toHaveCount(2);
  await dialog.getByLabel("Manager PIN", { exact: true }).fill("2468");
  await press(dialog.getByRole("button", { name: "Authorise" }));
  await expect(dialog).toBeHidden();
  await expect(page.locator(".waste-history-card")).toHaveCount(1);
  expect(api.pins().map((r) => r.body.action)).toEqual(["pin-status", "pin-verify", "pin-verify"]);
  await expect.poll(() => api.posts().at(-1)?.body.state.history.map((s) => s.id)).toEqual(["sheet-lunch"]);

  // Cancelling the PIN prompt leaves everything untouched.
  await press(page.getByRole("button", { name: "Delete Lunch · Amelia" }));
  await expect(dialog).toBeVisible();
  await press(dialog.getByRole("button", { name: "Cancel" }));
  await expect(dialog).toBeHidden();
  await expect(page.locator(".waste-history-card")).toHaveCount(1);
});

test("managers confirm destructive actions without a PIN", async ({ page }) => {
  await signedIn(page, "manager");
  const api = await wasteApi(page, { state: sharedState() });
  await page.goto("/waste.html");
  await expect(syncLabel(page)).toHaveText("Cloud synced");
  await expect(page.locator("#wasteRole")).toContainText("Manager access");
  await press(page.getByRole("button", { name: /Clear current/ }));
  const confirm = page.getByRole("dialog", { name: "Clear current waste?" });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText("Manager access · no PIN needed");
  await expect(page.locator("#wastePinCurrent")).toBeHidden();
  await press(confirm.getByRole("button", { name: "Clear counts" }));
  await expect(page.locator("#wasteGrandTotal")).toHaveText("0");
  await expect.poll(() => api.posts().at(-1)?.body.state.counts).toEqual({});

  await press(page.getByRole("tab", { name: "History" }));
  await press(page.getByRole("button", { name: "Delete Lunch · Amelia" }));
  await press(page.getByRole("dialog", { name: "Delete Lunch · Amelia?" }).getByRole("button", { name: "Delete sheet" }));
  await expect(page.locator(".waste-history-card")).toHaveCount(1);
  expect(api.pins()).toHaveLength(0);
});

test("restore a saved sheet into the counter", async ({ page }) => {
  await signedIn(page, "crew");
  await wasteApi(page, { state: sharedState() });
  await page.goto("/waste.html#history");
  await press(page.getByRole("button", { name: "Restore Close · Ryan to the counter" }));
  const confirm = page.getByRole("dialog", { name: "Replace current counts?" });
  await expect(confirm).toBeVisible();
  await press(confirm.getByRole("button", { name: "Replace counts" }));
  await expect(page.getByRole("tab", { name: "Count" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("spinbutton", { name: "10:1 Beef Patty count" })).toHaveValue("6");
  await expect(page.locator("#wasteGrandTotal")).toHaveText("13");
  await expect(page.getByRole("textbox", { name: "Crew / shift note" })).toHaveValue("Close · Ryan");
});

test("graphics compare saved days over 7 and 30 days", async ({ page }) => {
  await signedIn(page, "manager");
  const state = sharedState({
    history: [
      sheet("d0", 0, "Today", [[1, 10], [26, 5]]),
      sheet("d1", 1, "Yesterday", [[1, 20], [26, 10]]),
      sheet("d12", 12, "Two weeks ago", [[1, 40]]),
    ],
  });
  await wasteApi(page, { state });
  await page.goto("/waste.html");
  await press(page.getByRole("tab", { name: "Graphics" }));
  await expect(page.getByRole("heading", { name: "Waste, day by day." })).toBeVisible();
  const summary = page.locator("#wasteGraphicsSummary");
  await expect(summary).toContainText("45units");
  await expect(summary).toContainText("2 saved sheets in the last 7 days");
  await expect(page.locator(".waste-chart-day")).toHaveCount(7);
  await expect(page.locator(".waste-chart-day.is-selected")).toHaveAttribute("aria-label", /−15 units compared with/);
  await page.getByRole("combobox", { name: "Period" }).selectOption("30");
  await expect(page.locator(".waste-chart-day")).toHaveCount(30);
  await expect(summary).toContainText("85units");
  await page.getByRole("combobox", { name: "Waste type" }).selectOption("full");
  await expect(summary).toContainText("15units");
  await expect(page.locator("#wasteTopItems li").first()).toContainText("Big Mac");
  await expect(page.locator(".waste-table tbody tr")).toHaveCount(3);
  expect(await noOverflow(page)).toBeTruthy();
});

test("item list management: add, rename and remove", async ({ page }) => {
  await signedIn(page, "manager");
  const api = await wasteApi(page, { state: sharedState() });
  await page.goto("/waste.html");
  await expect(syncLabel(page)).toHaveText("Cloud synced");
  await press(page.getByRole("button", { name: "Manage items" }));
  const dialog = page.getByRole("dialog", { name: "Manage waste items" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Item name", { exact: true }).fill("McSpicy");
  await dialog.getByRole("combobox", { name: "Type", exact: true }).selectOption("full");
  await dialog.getByRole("combobox", { name: "Category", exact: true }).selectOption("Burgers");
  await press(dialog.getByRole("button", { name: "Add item" }));
  await expect(page.locator("#toast")).toContainText("McSpicy added");
  await dialog.getByRole("searchbox", { name: "Find an item to manage" }).fill("mcspicy");
  await press(dialog.getByRole("button", { name: "Rename McSpicy" }));
  await dialog.getByRole("textbox", { name: "New name for McSpicy" }).fill("McSpicy Deluxe");
  await press(dialog.getByRole("button", { name: "Save name" }));
  await expect(dialog.locator(".waste-manage-row")).toContainText("McSpicy Deluxe");
  await expect.poll(() => api.posts().at(-1)?.body.state.items.some((i) => i.name === "McSpicy Deluxe" && i.custom)).toBe(true);
  await press(dialog.getByRole("button", { name: "Remove McSpicy Deluxe" }));
  await press(page.getByRole("dialog", { name: "Remove McSpicy Deluxe?" }).getByRole("button", { name: "Remove item" }));
  await expect(dialog.locator(".waste-manage-row")).toHaveCount(0);
  await expect.poll(() => api.posts().at(-1)?.body.state.items.some((i) => i.name.startsWith("McSpicy"))).toBe(false);
});

test("download paper produces the PDF sheet and offers a new sheet", async ({ page, browserName }) => {
  await signedIn(page, "manager");
  await wasteApi(page, { state: sharedState({ draft: { sheetName: "Close", sheetNotes: "", sheetId: null } }) });
  await page.goto("/waste.html");
  await expect(syncLabel(page)).toHaveText("Cloud synced");
  const downloadPromise = page.waitForEvent("download", { timeout: 8000 }).catch(() => null);
  await press(page.getByRole("button", { name: /Download paper/ }));
  const download = await downloadPromise;
  if (download || browserName === "chromium") {
    expect(download).not.toBeNull();
    expect(download.suggestedFilename()).toMatch(/^hayle-waste-paper-\d{4}-\d{2}-\d{2}-\d{4}\.pdf$/);
  }
  const complete = page.getByRole("dialog", { name: "Sheet complete." });
  await expect(complete).toBeVisible();
  await expect(complete.locator("#wasteCompleteTotal")).toHaveText("5");
  await press(complete.getByRole("button", { name: "Start new sheet" }));
  await expect(complete).toBeHidden();
  await expect(page.locator("#wasteGrandTotal")).toHaveText("0");
  await expect(page.getByRole("textbox", { name: "Crew / shift note" })).toHaveValue("");

  await press(page.getByRole("tab", { name: "History" }));
  await press(page.getByRole("button", { name: "Print Close · Ryan" }));
  expect(await page.evaluate(() => window.__printed)).toBe(1);
  await expect(page.locator("#wastePrintRoot")).toContainText("Close · Ryan");
});

test("sync status shows local safety when the datastore is down and counts survive a reload", async ({ page }) => {
  await signedIn(page, "crew");
  const api = await wasteApi(page, { state: sharedState(), fail: true });
  await page.goto("/waste.html");
  await expect(syncLabel(page)).toHaveText("Cloud unavailable · local safe");
  await expect(page.locator("#wasteSync")).toHaveAttribute("data-state", "error");
  await press(page.getByRole("button", { name: "Add one 10:1 Beef Patty" }));
  await expect(page.getByRole("spinbutton", { name: "10:1 Beef Patty count" })).toHaveValue("1");
  await page.reload();
  await expect(page.getByRole("spinbutton", { name: "10:1 Beef Patty count" })).toHaveValue("1");
  // Back online: the pending local edit wins over the older cloud copy.
  api.fail = false;
  await press(page.locator("#wasteSync"));
  await expect(syncLabel(page)).toHaveText("Cloud synced");
  await expect.poll(() => api.posts().at(-1)?.body.state.counts["v2-default-1"]).toBe(1);
  // Crew PIN prompts need the server; offline they explain why.
  await page.context().setOffline(true);
  await press(page.getByRole("button", { name: /Clear current/ }));
  await expect(page.locator("#toast")).toContainText("internet connection");
  await page.context().setOffline(false);
});

test("live portal updates never wipe counts or typed notes", async ({ page }) => {
  await signedIn(page, "crew");
  await wasteApi(page, { state: sharedState() });
  await page.goto("/waste.html");
  await expect(syncLabel(page)).toHaveText("Cloud synced");
  await page.getByRole("textbox", { name: "Notes" }).fill("Fryer 2 down");
  await press(page.getByRole("button", { name: "Add one 10:1 Beef Patty" }));
  await page.evaluate(() => {
    window.__qa.emit("shifts");
    window.__qa.emit("progress");
  });
  await page.waitForTimeout(300);
  await expect(page.getByRole("textbox", { name: "Notes" })).toHaveValue("Fryer 2 down");
  await expect(page.getByRole("spinbutton", { name: "10:1 Beef Patty count" })).toHaveValue("4");
  await expect(page.locator("#content")).toHaveAttribute("data-enhanced-page", "waste");
});

test("preview mode works offline with sample data and never calls /api/waste", async ({ page }) => {
  await signedIn(page, "crew");
  let calls = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/waste")) calls++;
  });
  await page.goto("/waste.html?preview=crew");
  await expect(syncLabel(page)).toHaveText("Preview · not synced");
  await expect(page.locator("#wasteGrandTotal")).toHaveText("30");
  await page.context().setOffline(true);
  await press(page.getByRole("button", { name: "Add one 10:1 Beef Patty" }));
  await expect(page.locator("#wasteGrandTotal")).toHaveText("31");
  await press(page.getByRole("button", { name: "Save sheet" }));
  await expect(page.locator("#toast")).toContainText("Waste sheet saved");
  await press(page.getByRole("tab", { name: "History" }));
  await expect(page.locator(".waste-history-card").first()).toContainText("Evening waste count");
  // Long histories load 12 sheets at a time.
  await expect(page.locator(".waste-history-card")).toHaveCount(12);
  await press(page.getByRole("button", { name: /^Show 12 more of \d+$/ }));
  await expect(page.locator(".waste-history-card")).toHaveCount(24);
  // The crew preview demonstrates the PIN flow locally.
  await press(page.getByRole("tab", { name: "Count" }));
  await press(page.getByRole("button", { name: /Clear current/ }));
  const dialog = page.getByRole("dialog", { name: "Enter manager PIN" });
  await expect(dialog).toContainText("Preview PIN: 1234");
  await dialog.getByLabel("Manager PIN", { exact: true }).fill("1234");
  await press(dialog.getByRole("button", { name: "Authorise" }));
  await expect(page.locator("#wasteGrandTotal")).toHaveText("0");
  await press(page.getByRole("tab", { name: "Graphics" }));
  await expect(page.locator(".waste-chart-day")).toHaveCount(7);
  await page.context().setOffline(false);
  expect(calls).toBe(0);
});

test("layout fits the screen with touch-friendly controls on every tab", async ({ page }) => {
  await signedIn(page, "crew");
  await wasteApi(page, { state: sharedState() });
  await page.goto("/waste.html");
  await expect(syncLabel(page)).toHaveText("Cloud synced");
  for (const tab of ["Count", "Graphics", "History"]) {
    await press(page.getByRole("tab", { name: tab }));
    await page.waitForTimeout(250);
    expect(await noOverflow(page), `${tab} tab overflows horizontally`).toBeTruthy();
  }
  await press(page.getByRole("tab", { name: "Count" }));
  const metrics = await page.evaluate(() => {
    const plus = document.querySelector(".waste-step.is-plus").getBoundingClientRect();
    const minus = document.querySelector(".waste-step.is-minus").getBoundingClientRect();
    const fonts = [...document.querySelectorAll("#wasteApp input, #wasteApp select, #wasteApp textarea")].map(
      (el) => parseFloat(getComputedStyle(el).fontSize),
    );
    const rows = [...document.querySelectorAll(".waste-row")].slice(0, 3).map((r) => r.getBoundingClientRect());
    const save = document.getElementById("wasteSaveBtn").getBoundingClientRect();
    return { plus, minus, minFont: Math.min(...fonts), rowsInside: rows.every((r) => r.left >= 0 && r.right <= innerWidth), save };
  });
  expect(metrics.plus.height).toBeGreaterThanOrEqual(44);
  expect(metrics.plus.width).toBeGreaterThanOrEqual(44);
  expect(metrics.minus.width).toBeGreaterThanOrEqual(44);
  expect(metrics.minFont, "inputs below 16px make iOS zoom in").toBeGreaterThanOrEqual(16);
  expect(metrics.rowsInside).toBeTruthy();
  expect(metrics.save.height).toBeGreaterThanOrEqual(44);
  // The Save dock stays visible while scrolling and above the bottom navigation.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 3));
  await page.waitForTimeout(250);
  const dock = await page.evaluate(() => {
    const rect = document.getElementById("wasteDock").getBoundingClientRect();
    const nav = document.querySelector(".mobile-nav");
    const navTop = nav && getComputedStyle(nav).display !== "none" ? nav.getBoundingClientRect().top : innerHeight;
    return { top: rect.top, bottom: rect.bottom, navTop, innerHeight };
  });
  expect(dock.bottom).toBeLessThanOrEqual(dock.navTop + 1);
  expect(dock.top).toBeGreaterThan(0);
  // Dialogs fit on screen.
  await press(page.getByRole("button", { name: "Manage items" }));
  const box = await page.getByRole("dialog", { name: "Manage waste items" }).boundingBox();
  const viewport = page.viewportSize();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
  // Phones get a full-width bottom sheet.
  if (viewport.width < 761) expect(box.width).toBeGreaterThanOrEqual(viewport.width - 1);
});
