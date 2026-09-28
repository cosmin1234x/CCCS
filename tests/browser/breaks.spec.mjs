// Break orders tab (breaks.html): crew put their own break food through.
// Preview mode runs on the built-in sample day; "signed in" runs against an
// in-page mock of /api/breaks that answers with the real rules engine.
import { test, expect } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import * as B from "../../breaks-core.js";

// A fixed Monday lunchtime in Hayle: no breakfast, deterministic dates.
const NOW = new Date("2026-09-28T12:30:00+01:00");
test.use({ timezoneId: "Europe/London", locale: "en-GB" });

test.beforeEach(async ({ page }) => {
  test.setTimeout(90000);
  await page.clock.setFixedTime(NOW);
  page.on("dialog", (dialog) => {
    throw new Error("Unexpected browser dialog: " + dialog.message());
  });
});

const phone = (page) => page.viewportSize().width <= 760;
const narrow = (page) => page.viewportSize().width < 1000;
const noOverflow = async (page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
const toast = (page, text) => expect(page.getByText(text, { exact: false }).filter({ visible: true }).first()).toBeVisible();
const item = (page, id) => page.locator(`[data-item="${id}"]`);
async function openTray(page) {
  if (narrow(page)) await page.locator("[data-open-tray]").click();
  await expect(page.locator("#boSubmit")).toBeVisible();
}

// ------------------------------------------------------------ fixtures
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
const stubExports = (kind, implemented) =>
  [...firebaseImports(kind)]
    .filter((name) => !implemented.includes(name))
    .map((name) => `export const ${name}=(...args)=>({});`)
    .join("");
const AUTH_IMPL = `export const onAuthStateChanged=(auth,callback)=>{queueMicrotask(()=>callback(auth.currentUser));return ()=>{};};export const signOut=async()=>{};`;
const STORE_IMPL = `const qa=window.__qa;export const doc=(db,...path)=>({path:path.join('/')});export const collection=doc;export const where=()=>({});export const query=(ref)=>ref;export const getDoc=async()=>({exists:()=>true,data:()=>qa.profile,id:qa.profile.id});export const getDocs=async()=>({docs:[],empty:true,size:0,forEach:()=>{}});export function onSnapshot(ref,callback){setTimeout(()=>callback({docs:[]}),50);return ()=>{};}`;

async function hermetic(page, { init = true } = {}) {
  if (init)
    await page.route("**/firebase-init.js", (r) =>
      r.fulfill({
        contentType: "text/javascript",
        body: "export const db={};export const app={};export const analytics=null;export const auth={currentUser:null};",
      }),
    );
  await page.route("https://www.gstatic.com/firebasejs/**/firebase-auth.js", (r) =>
    r.fulfill({ contentType: "text/javascript", body: AUTH_IMPL + stubExports("auth", ["onAuthStateChanged", "signOut"]) }),
  );
  await page.route("https://www.gstatic.com/firebasejs/**/firebase-firestore.js", (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: STORE_IMPL + stubExports("firestore", ["doc", "collection", "where", "query", "getDoc", "getDocs", "onSnapshot"]),
    }),
  );
}

async function signedIn(page, role = "crew") {
  const profile = { id: "qa-" + role, name: role === "manager" ? "Morgan Manager" : "Alex Crew", role, storeId: "1170", storeName: "1170 · Hayle" };
  await page.addInitScript(({ profile }) => (window.__qa = { profile }), { profile });
  await page.route("**/firebase-init.js", (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: `export const db={};export const app={};export const analytics=null;export const auth={currentUser:{uid:'${profile.id}',email:'qa@example.invalid',getIdToken:async()=>'test-token'}};`,
    }),
  );
  await hermetic(page, { init: false });
  await page.route("**/api/portal-data", (r) =>
    r.fulfill({ json: { profile, progress: {}, shifts: [], team: [], verifications: [], roleRequests: [], permissions: {} } }),
  );
  await page.route("**/api/ai-chat", (r) => r.fulfill({ json: { reply: "Preview reply." } }));
  return profile;
}

// /api/breaks with the endpoint's contract, answered by the real rules.
async function breaksApi(page, profile) {
  const api = { orders: [], requests: [], settings: B.normalizeSettings(), menu: B.normalizeMenu() };
  const today = B.dayKey(NOW);
  const state = () => ({
    ok: true,
    manager: profile.role === "manager",
    today,
    day: today,
    settings: api.settings,
    menu: api.menu,
    mine: api.orders.filter((o) => o.crewId === profile.id),
    ...(profile.role === "manager" ? { log: api.orders } : {}),
  });
  await page.route("**/api/breaks**", async (route) => {
    const request = route.request();
    const body = request.postData() ? JSON.parse(request.postData()) : null;
    api.requests.push({ method: request.method(), body, auth: request.headers()["authorization"] || "" });
    if (!String(request.headers()["authorization"]).startsWith("Bearer "))
      return route.fulfill({ status: 401, json: { ok: false, error: "Sign in to continue." } });
    if (request.method() === "GET") return route.fulfill({ json: state() });
    if (body.action === "place") {
      try {
        const order = B.createOrder({
          crew: { id: profile.id, name: profile.name },
          items: body.items,
          note: body.note,
          menu: api.menu,
          settings: api.settings,
          orders: api.orders,
          no: api.orders.length + 1,
          now: NOW,
          id: "o" + (api.orders.length + 1),
        });
        api.orders.unshift(order);
        return route.fulfill({ status: 201, json: { ...state(), order } });
      } catch (error) {
        return route.fulfill({ status: 422, json: { ok: false, code: "RULES", error: error.message } });
      }
    }
    return route.fulfill({ status: 400, json: { ok: false, error: "Unknown break order action." } });
  });
  return api;
}

// ------------------------------------------------------------ preview --
test.describe("preview mode", () => {
  test("crew order a break within the rules and get a ticket", async ({ page }) => {
    await hermetic(page);
    let apiCalls = 0;
    page.on("request", (r) => {
      if (/\/api\//.test(r.url())) apiCalls++;
    });
    await page.goto("/breaks.html?preview=crew");
    await expect(page.getByRole("heading", { name: "Hi Cosmin, what's for break?" })).toBeVisible();
    await expect(page.locator(".bo-stat.is-points strong")).toHaveText("4");
    // A main goes in, a second main is refused with the reason.
    await item(page, "bigmac").click();
    await expect(page.locator(".bo-stat.is-points .bo-coin.is-pending")).toHaveCount(3);
    await item(page, "cb").click();
    await toast(page, "Only 1 main per break");
    await expect(item(page, "cb")).toHaveClass(/is-blocked/);
    // Side and drink use the last point; a McFlurry would go over.
    await page.locator('[data-cat="sides"]').click();
    await item(page, "fries-m").click();
    await page.locator('[data-cat="drinks"]').click();
    await item(page, "coke").click();
    await page.locator('[data-cat="treats"]').click();
    await expect(item(page, "mcflurry")).toContainText("No points left");
    await openTray(page);
    await expect(page.locator('[data-check="points"]')).toContainText("4 of 4 used");
    await page.locator("#boNote").fill("No pickles please");
    await page.locator("#boSubmit").click();
    const ticket = page.getByRole("dialog", { name: "Put through!" });
    await expect(ticket).toBeVisible();
    await expect(ticket.locator(".bo-ticket-code")).toHaveText(/^B-\d{3}$/);
    await expect(ticket).toContainText("No pickles please");
    await expect(ticket).toContainText("0 of 4 points left today");
    await ticket.getByRole("button", { name: "My breaks" }).click();
    await expect(page.locator("#boPanel-mine")).toBeVisible();
    await expect(page.locator("#boPanel-mine .bo-row").first()).toContainText("Big Mac + Medium Fries + Coca-Cola");
    await expect(page.locator(".bo-stat.is-points strong")).toHaveText("0");
    await expect(page.getByRole("heading", { name: /You're all set for today/ })).toBeVisible();
    await noOverflow(page);
    expect(apiCalls).toBe(0);
  });

  test("crew see the rules and the points menu, and no manager tab", async ({ page }) => {
    await hermetic(page);
    await page.goto("/breaks.html?preview=crew#rules");
    await expect(page.locator("#boPanel-rules")).toBeVisible();
    await expect(page.locator(".bo-rule").first()).toContainText("points a day");
    await expect(page.locator(".bo-examples .is-bad")).toHaveCount(3);
    await expect(page.locator(".bo-points-cat li", { hasText: "Big Mac" })).toContainText("3 pts");
    await expect(page.locator('[data-tab="manage"]')).toHaveCount(0);
    await noOverflow(page);
  });

  test("managers void a break and change the points", async ({ page }) => {
    await hermetic(page);
    await page.goto("/breaks.html?preview=manager#manage");
    await expect(page.locator(".bo-kpis")).toBeVisible();
    await expect(page.locator(".bo-kpi").first()).toContainText("3");
    const row = page.locator(".bo-log-row", { hasText: "Sophie Turner" });
    await row.getByRole("button", { name: "Void" }).click();
    const confirm = page.getByRole("dialog", { name: /Void B-\d{3}\?/ });
    await expect(confirm).toContainText("gets their 3 points back");
    await confirm.getByRole("button", { name: "Void order" }).click();
    await toast(page, "voided, points returned");
    await expect(page.locator(".bo-log-row", { hasText: "Sophie Turner" })).toHaveClass(/is-void/);
    await expect(page.locator(".bo-kpi").first()).toContainText("2");
    // Points menu: Big Mac to 4 points, Coke off, then save.
    await page.locator('[data-mgr="menu"]').click();
    await page.locator('[data-stepper="pts:bigmac"] [data-step="1"]').click();
    await page.locator('[data-menu="coke"] [data-menu-on]').uncheck();
    await expect(page.locator(".bo-savebar")).toContainText("2 unsaved changes");
    await page.locator("[data-save-config]").click();
    await toast(page, "Saved");
    await expect(page.locator(".bo-savebar")).toBeHidden();
    await page.locator('[data-tab="rules"]').click();
    await expect(page.locator(".bo-points-cat li", { hasText: "Big Mac" })).toContainText("4 pts");
    await expect(page.locator(".bo-points-cat li", { hasText: "Coca-Cola" })).toContainText("off today");
    await noOverflow(page);
  });

  test("Break orders is in the navigation for everyone", async ({ page }) => {
    await hermetic(page);
    await page.goto("/main.html?preview=crew");
    if (phone(page)) {
      await page.getByRole("button", { name: "More", exact: true }).click();
      await page.getByRole("navigation", { name: "More destinations" }).getByRole("link", { name: /Break orders/ }).click();
    } else {
      await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: /Break orders|Breaks/ }).click();
    }
    await expect(page).toHaveURL(/\/breaks\.html\?preview=crew/);
    await expect(page.locator(".bo-item").first()).toBeVisible();
  });
});

// ---------------------------------------------------------- signed in --
test.describe("signed in", () => {
  test("orders go to /api/breaks with the account's token", async ({ page }) => {
    const profile = await signedIn(page, "crew");
    const api = await breaksApi(page, profile);
    await page.goto("/breaks.html");
    await expect(page.getByRole("heading", { name: "Hi Alex, what's for break?" })).toBeVisible();
    await expect(page.locator("#boChip")).toContainText("Live for your store");
    await item(page, "mcchicken").click();
    await page.locator('[data-cat="sides"]').click();
    await item(page, "fries-l").click();
    await openTray(page);
    await page.locator("#boSubmit").click();
    await expect(page.getByRole("dialog", { name: "Put through!" })).toContainText("B-001");
    const post = api.requests.find((r) => r.method === "POST");
    expect(post.auth).toBe("Bearer test-token");
    expect(post.body).toEqual({ action: "place", items: ["mcchicken", "fries-l"], note: "" });
    expect(api.orders[0].crewName).toBe("Alex Crew");
  });

  test("a rule the server refuses is shown and nothing is lost", async ({ page }) => {
    const profile = await signedIn(page, "crew");
    const api = await breaksApi(page, profile);
    // Another device already used today's points.
    api.orders.push(B.createOrder({ crew: { id: profile.id, name: profile.name }, items: ["cb", "fries-m"], menu: api.menu, settings: api.settings, orders: [], no: 1, now: NOW, id: "earlier" }));
    api.settings = B.normalizeSettings({ dailyPoints: 4 });
    await page.goto("/breaks.html");
    await expect(page.locator(".bo-stat.is-points strong")).toHaveText("2");
    // The page thinks 2 points are left; the server has another order.
    await item(page, "mcchicken").click();
    api.orders.push(B.createOrder({ crew: { id: profile.id, name: profile.name }, items: ["hb"], menu: api.menu, settings: api.settings, orders: api.orders, no: 2, now: NOW, id: "other-device" }));
    await openTray(page);
    await page.locator("#boSubmit").click();
    await toast(page, "you have 1 left today");
    await expect(page.locator(".bo-stat.is-points strong")).toHaveText("1");
  });
});
