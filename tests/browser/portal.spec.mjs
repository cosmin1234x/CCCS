import { test, expect } from "@playwright/test";

// These are multi-page journeys (four page loads each); WebKit on a busy
// machine needs more than the default 30 seconds for them.
test.describe.configure({ timeout: 60000 });

for (const preview of [false, true]) {
  test(`older Safari navigation preserves destinations (${preview ? "preview" : "signed in"})`, async ({
    page,
    isMobile,
  }) => {
    const activate = (locator) => (isMobile ? locator.tap() : locator.click());
    await signedInFixture(page);
    // iPadOS 16 and earlier do not expose URLSearchParams.size. Device
    // emulation alone still uses the installed, modern WebKit engine.
    await page.addInitScript(() => {
      delete URLSearchParams.prototype.size;
    });
    await page.goto("/main.html" + (preview ? "?preview=crew" : ""));
    const nav = page
      .getByRole("navigation", { name: /Main navigation|Mobile navigation/ })
      .filter({ visible: true });
    const assistant = nav.getByRole("link", { name: "McAssist", exact: true });
    await expect(assistant).toHaveAttribute(
      "href",
      "/main.html?view=assistant" + (preview ? "&preview=crew" : ""),
    );
    await activate(assistant);
    await expect(page).toHaveURL(/view=assistant/);
    await expect(
      page.getByRole("textbox", { name: "Message McAssist" }),
    ).toBeVisible();
    await page
      .getByRole("textbox", { name: "Message McAssist" })
      .fill("Help with my shift");
    await activate(
      page.getByRole("button", { name: "Send message", exact: true }),
    );
    await expect(page.locator("#chat")).toContainText(
      preview
        ? "No changes were made."
        : "Your next shift is not published yet.",
    );
    await activate(
      nav.getByRole("link", { name: /My learning|Learn/, exact: true }),
    );
    // The signed-in fixture has only First Shift done, so the priority Food
    // Safety module is next. The preview sample has its own progress.
    await activate(page.getByRole("link", { name: /Start learning/ }));
    await expect(page).toHaveURL(
      preview ? /module\.html\?id=[a-z-]+&preview=crew/ : /id=food-safety/,
    );
  });
}
const profile = {
  id: "qa-crew",
  name: "Alex QA",
  role: "crew",
  storeId: "qa-store",
  verifiedStations: [],
};
async function signedInFixture(page) {
  await page.addInitScript(
    ({ profile }) => {
      window.__qa = {
        profile,
        progress: { "first-shift": { completed: true } },
        callbacks: [],
        emit(kind) {
          this.callbacks.filter((c) => c.kind === kind).forEach((c) => c.run());
        },
      };
    },
    { profile },
  );
  await page.route("**/firebase-init.js", (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: `export const db={};export const auth={currentUser:{uid:'qa-crew',email:'qa@example.invalid',getIdToken:async()=> 'test-token'}};`,
    }),
  );
  await page.route(
    "https://www.gstatic.com/firebasejs/**/firebase-auth.js",
    (r) =>
      r.fulfill({
        contentType: "text/javascript",
        body: `export const onAuthStateChanged=(auth,callback)=>{queueMicrotask(()=>callback(auth.currentUser));return ()=>{};};export const signOut=async()=>{};export const createUserWithEmailAndPassword=async()=>{};export const signInWithEmailAndPassword=async()=>{};export const updateProfile=async()=>{};export const sendPasswordResetEmail=async()=>{};`,
      }),
  );
  await page.route(
    "https://www.gstatic.com/firebasejs/**/firebase-firestore.js",
    (r) =>
      r.fulfill({
        contentType: "text/javascript",
        body: `const qa=window.__qa;export const doc=(db,...path)=>({path:path.join('/')});export const collection=doc;export const where=()=>({});export const query=(ref)=>ref;export const serverTimestamp=()=>0;export const setDoc=async()=>{};export const updateDoc=async()=>{};export const addDoc=async()=>({id:'test'});export const deleteDoc=async()=>{};export const getDoc=async()=>({exists:()=>true,data:()=>qa.profile});export const getDocs=async()=>({docs:[],forEach:()=>{}});export function onSnapshot(ref,callback){const kind=ref.path.includes('portalTraining')?'progress':'shifts';const run=()=>callback({docs:kind==='progress'?Object.entries(qa.progress).map(([id,value])=>({id,data:()=>value})):[]});qa.callbacks.push({kind,run});setTimeout(run,100);return ()=>{};}`,
      }),
  );
  await page.route("**/api/portal-data", (r) =>
    r.fulfill({
      json: {
        profile,
        progress: { "first-shift": { completed: true } },
        shifts: [],
        team: [],
        verifications: [],
        roleRequests: [],
        permissions: {},
      },
    }),
  );
  await page.route("**/api/ai-chat", (r) =>
    r.fulfill({
      json: {
        reply: "Your next shift is not published yet. Ask your shift lead.",
      },
    }),
  );
}
test("AI tab stays open and keeps drafts through live shift updates", async ({
  page,
}) => {
  await signedInFixture(page);
  await page.goto("/main.html");
  const nav = page
    .getByRole("navigation", { name: /Main navigation|Mobile navigation/ })
    .filter({ visible: true });
  await nav.getByRole("link", { name: "McAssist", exact: true }).click();
  await expect(page.locator("#v2AssistantMount #chatInput")).toBeVisible();
  await page.locator("#chatInput").fill("When is my next shift?");
  await page.evaluate(() => window.__qa.emit("shifts"));
  await expect(page.locator("#chatInput")).toBeVisible();
  await expect(page.locator("#chatInput")).toHaveValue(
    "When is my next shift?",
  );
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.locator("#chat")).toContainText(
    "Your next shift is not published yet.",
  );
  await page.evaluate(() => window.__qa.emit("shifts"));
  await expect(page.locator("#chat")).toContainText(
    "Your next shift is not published yet.",
  );
});

test("training filters survive live progress updates and show current completion", async ({
  page,
}) => {
  await signedInFixture(page);
  await page.goto("/training");
  await expect(
    page.getByRole("heading", { name: "Your learning", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".tr-module")).toHaveCount(6);
  await page.getByRole("button", { name: "Show more modules" }).click();
  await expect(page.locator(".tr-module")).toHaveCount(12);
  await page.getByRole("searchbox", { name: "Search modules" }).fill("grill");
  await expect(page.locator(".tr-module")).toHaveCount(1);
  await page.evaluate(() => {
    window.__qa.progress["grill-station"] = { completed: true };
    window.__qa.progress["retired-module"] = { completed: true };
    window.__qa.emit("progress");
    window.__qa.emit("shifts");
  });
  await expect(
    page.getByRole("searchbox", { name: "Search modules" }),
  ).toHaveValue("grill");
  // 21 crew modules; the retired module id is ignored.
  await expect(page.locator("#trCompletedCount")).toHaveText(
    "2 of 21 modules",
  );
  await expect(page.locator(".tr-module")).toContainText("Completed");
  await page.getByRole("button", { name: "To do", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "No modules found" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reset filters" }).click();
  await expect(page.locator(".tr-module")).toHaveCount(6);
  await page.getByRole("combobox", { name: "Category" }).selectOption("Safety");
  await expect(page.locator(".tr-module")).toHaveCount(3);
  await expect(page.locator(".tr-module").first()).toContainText(
    "Food Safety",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

test("preview lesson links preserve preview and the AI preview makes no API calls", async ({
  page,
}) => {
  await signedInFixture(page);
  let requests = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/ai-chat")) requests++;
  });
  await page.goto("/training.html?preview=crew");
  const start = page.getByRole("link", { name: /Start learning/ });
  const id = new URLSearchParams(
    (await start.getAttribute("href")).split("?")[1],
  ).get("id");
  await start.click();
  await expect(page).toHaveURL(
    new RegExp(`module\\.html\\?id=${id}&preview=crew`),
  );
  const title = await page.evaluate(
    (id) => window.McModules.modules.find((m) => m.id === id).title,
    id,
  );
  await expect(
    page.getByRole("heading", { level: 1, name: title, exact: true }),
  ).toBeVisible();
  await page.goto("/main.html?view=assistant&preview=crew");
  await page.getByRole("button", { name: /My next shift/ }).click();
  await expect(
    page.getByRole("textbox", { name: "Message McAssist" }),
  ).toHaveValue("What is my next shift and station?");
  expect(requests).toBe(0);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.locator("#chat")).toContainText("No changes were made.");
  expect(requests).toBe(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

test("AI handles a failed response and works when browser storage is unavailable", async ({
  page,
}) => {
  await signedInFixture(page);
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new Error("Storage blocked");
    };
  });
  await page.route("**/api/ai-chat", (r) =>
    r.fulfill({
      status: 503,
      json: { error: "Temporarily unavailable. Please try again." },
    }),
  );
  await page.goto("/main.html?view=assistant");
  await page
    .getByRole("textbox", { name: "Message McAssist" })
    .fill("Help me prepare");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.locator("#chat")).toContainText("Help me prepare");
  await expect(page.locator("#chat")).toContainText("Temporarily unavailable");
  await expect(
    page.getByRole("button", { name: "Send message", exact: true }),
  ).toBeEnabled();
});

test("enhancement rendering settles without a self-triggering DOM loop", async ({
  page,
}) => {
  await signedInFixture(page);
  await page.goto("/training.html");
  await expect(page.locator(".tr-module")).toHaveCount(6);
  await page.waitForTimeout(350);
  const mutations = await page.evaluate(
    () =>
      new Promise((resolve) => {
        let count = 0;
        const observer = new MutationObserver((records) => {
          count += records.length;
        });
        observer.observe(document.getElementById("app"), {
          childList: true,
          subtree: true,
        });
        setTimeout(() => {
          observer.disconnect();
          resolve(count);
        }, 350);
      }),
  );
  expect(mutations).toBe(0);
});
