// McAssist V4 chat experience (mcassist-ui.js). /api/ai-chat is mocked per
// the V4 contract; Firebase and portal data use the same offline fixture
// pattern as portal.spec.mjs. Preview tests assert that no AI call is made.
import { test, expect } from "@playwright/test";

const manager = {
  id: "qa-manager",
  name: "Cosmin Blidaru",
  role: "manager",
  storeId: "qa-store",
  storeName: "1170 · Hayle",
  verifiedStations: ["Fries"],
};
const team = [
  manager,
  { id: "qa-ryan", name: "Ryan Davies", role: "crew", storeId: "qa-store", verifiedStations: [] },
  { id: "qa-amelia", name: "Amelia Wilson", role: "crew", storeId: "qa-store", verifiedStations: ["Fries"] },
];

async function signedIn(page, { profile = manager, ai } = {}) {
  await page.addInitScript(
    ({ profile }) => {
      window.__qa = {
        profile,
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
      body: `export const db={};export const auth={currentUser:{uid:${JSON.stringify(profile.id)},email:'qa@example.invalid',getIdToken:async()=>'test-token'}};`,
    }),
  );
  await page.route("https://www.gstatic.com/firebasejs/**/firebase-auth.js", (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: `export const onAuthStateChanged=(auth,callback)=>{queueMicrotask(()=>callback(auth.currentUser));return ()=>{};};export const signOut=async()=>{};export const createUserWithEmailAndPassword=async()=>{};export const signInWithEmailAndPassword=async()=>{};export const updateProfile=async()=>{};export const sendPasswordResetEmail=async()=>{};`,
    }),
  );
  await page.route("https://www.gstatic.com/firebasejs/**/firebase-firestore.js", (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: `const qa=window.__qa;export const doc=(db,...path)=>({path:path.join('/')});export const collection=doc;export const where=()=>({});export const query=(ref)=>ref;export const orderBy=()=>({});export const limit=()=>({});export const serverTimestamp=()=>0;export const increment=(n)=>n;export const writeBatch=()=>({set(){},update(){},delete(){},commit:async()=>{}});export const setDoc=async()=>{};export const updateDoc=async()=>{};export const addDoc=async()=>({id:'test'});export const deleteDoc=async()=>{};export const getDoc=async()=>({exists:()=>true,data:()=>qa.profile});export const getDocs=async()=>({docs:[],forEach:()=>{}});export function onSnapshot(ref,callback){const run=()=>callback({docs:[]});qa.callbacks.push({kind:ref.path.includes('portalTraining')?'progress':'shifts',run});setTimeout(run,60);return ()=>{};}`,
    }),
  );
  await page.route("**/api/portal-data", (r) =>
    r.fulfill({
      json: {
        profile,
        progress: {},
        shifts: [],
        team: profile.role === "manager" ? team : [],
        verifications: [],
        roleRequests: [],
        permissions: {
          canPlanShifts: profile.role === "manager",
          canVerify: profile.role === "crewTrainer",
          canSeeTeam: profile.role !== "crew",
        },
      },
    }),
  );
  const requests = [];
  await page.route("**/api/ai-chat", async (route) => {
    const body = route.request().postDataJSON();
    requests.push(body);
    const answer = await ai(body, requests.length);
    await route.fulfill({ status: answer.status || 200, json: answer.json || answer });
  });
  return requests;
}

const plan = () => ({
  reply: "I've checked Ryan's week. Deleting an account is permanent, so please confirm.",
  steps: ["Found Ryan Davies · Crew Member", "Checked Ryan's upcoming shifts: 1"],
  pending: {
    id: "plan-123",
    title: "Delete Ryan Davies's account",
    summary: "Permanently removes Ryan from 1170 · Hayle.",
    risk: "high",
    confirmLabel: "Delete account",
    cancelLabel: "Keep Ryan",
    expiresAt: Date.now() + 15 * 60 * 1000,
    items: [
      { id: "a", label: "Delete account · Ryan Davies", detail: "Crew Member", status: "ok" },
      { id: "b", label: "Remove 1 upcoming shift", detail: "Sat 16:00–23:00", status: "warning", note: "Leaves a gap on Saturday." },
      { id: "c", label: "Revoke Fries verification", status: "blocked", note: "Verifications can't be revoked from a plan." },
    ],
  },
});

async function ask(page, text) {
  const input = page.getByRole("textbox", { name: "Message McAssist" });
  await input.fill(text);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
}

const noOverflow = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test("pending plan: renders, confirms with the contract body and shows per-item results", async ({ page }) => {
  const requests = await signedIn(page, {
    ai: (body) =>
      body.confirm
        ? {
            reply: "Done. Ryan's account has been deleted.",
            dataChanged: true,
            actions: ["Deleted Ryan Davies's account", "Removed 1 shift"],
            results: [
              { itemId: "a", ok: true, message: "Account deleted" },
              { itemId: "b", ok: true, message: "Shift removed" },
            ],
          }
        : plan(),
  });
  await page.goto("/main.html?view=assistant");
  await ask(page, "Delete Ryan's account");
  const card = page.getByRole("article", { name: /Plan: Delete Ryan Davies's account/ });
  await expect(card).toBeVisible();
  await expect(card).toContainText("High risk");
  await expect(card).toContainText("Leaves a gap on Saturday.");
  await expect(card.locator(".mca-plan-item.is-ok")).toHaveCount(1);
  await expect(card.locator(".mca-plan-item.is-warning")).toHaveCount(1);
  await expect(card.locator(".mca-plan-item.is-blocked")).toHaveCount(1);
  await expect(card.locator(".mca-expiry")).toContainText(/Expires in 1[45]:\d\d/);
  await expect(card.getByRole("button", { name: "Keep Ryan" })).toBeEnabled();

  const first = requests[0];
  expect(first.message).toBe("Delete Ryan's account");
  expect(first.history).toEqual([]);
  expect(first.appContext.page).toBe("assistant");
  expect(Number.isNaN(Date.parse(first.appContext.clientTime))).toBe(false);
  expect(typeof first.appContext.timeZone).toBe("string");

  await card.getByRole("button", { name: "Delete account" }).click();
  await expect(card).toContainText("Approved · 2 of 2 done · 1 skipped");
  await expect(card).toContainText("Account deleted");
  await expect(card).toContainText("Shift removed");
  await expect(card).toContainText("Skipped");
  await expect(card.getByRole("button", { name: "Delete account" })).toHaveCount(0);
  await expect(page.locator(".mca-actions")).toContainText("Deleted Ryan Davies's account");

  const confirm = requests[1];
  expect(confirm.message).toBe("Confirm");
  expect(confirm.confirm).toEqual({ pendingId: "plan-123", decision: "approve" });
  expect(confirm.history.at(-1)).toEqual({ role: "assistant", content: plan().reply });
  for (const turn of confirm.history) expect(Object.keys(turn).sort()).toEqual(["content", "role"]);

  // The resolved card survives a reload (session chat history).
  await page.reload();
  const again = page.getByRole("article", { name: /Plan: Delete Ryan Davies's account/ });
  await expect(again).toContainText("Approved · 2 of 2 done");
  await expect(again.getByRole("button", { name: "Delete account" })).toHaveCount(0);
  expect(await noOverflow(page)).toBeTruthy();
});

test("pending plan: cancel sends a cancel decision and locks the card", async ({ page }) => {
  const requests = await signedIn(page, {
    ai: (body) =>
      body.confirm ? { reply: "Cancelled. Nothing was changed." } : plan(),
  });
  await page.goto("/main.html?view=assistant");
  await ask(page, "Delete Ryan's account");
  const card = page.getByRole("article", { name: /Plan:/ });
  await card.getByRole("button", { name: "Keep Ryan" }).click();
  await expect(card).toContainText("Cancelled · nothing was changed");
  await expect(card.getByRole("button", { name: "Keep Ryan" })).toHaveCount(0);
  expect(requests[1]).toMatchObject({
    message: "Cancel",
    confirm: { pendingId: "plan-123", decision: "cancel" },
  });
  await expect(page.locator("#chat")).toContainText("Cancelled. Nothing was changed.");
});

test("an expired plan is answered kindly and locked", async ({ page }) => {
  await signedIn(page, {
    ai: (body) =>
      body.confirm
        ? { status: 410, json: { error: "expired", reply: "That plan expired, so nothing was changed." } }
        : plan(),
  });
  await page.goto("/main.html?view=assistant");
  await ask(page, "Delete Ryan's account");
  const card = page.getByRole("article", { name: /Plan:/ });
  await card.getByRole("button", { name: "Delete account" }).click();
  await expect(card).toContainText("Expired · nothing was changed");
  await expect(page.locator("#chat")).toContainText("That plan expired, so nothing was changed.");
});

test("suggestion chips send, steps toggle and markdown stays safe", async ({ page }) => {
  const requests = await signedIn(page, {
    ai: (body, n) =>
      n === 1
        ? {
            reply: "I've checked Cosmin's week.\n\n- **Availability:** Mon–Fri\n- <b>not bold</b>\n\nWhat times should the shifts be?",
            steps: ["Checked Cosmin's availability", "Checked the rota for next week"],
            suggestions: ["16:00–23:00", "Match his availability"],
          }
        : { reply: "Here's the plan." },
  });
  await page.goto("/main.html?view=assistant");
  await ask(page, "Create 10 shifts for Cosmin");
  const log = page.locator("#chat");
  await expect(log.locator("strong", { hasText: "Availability:" })).toBeVisible();
  await expect(log.locator("li", { hasText: "<b>not bold</b>" })).toBeVisible();
  await expect(log.locator("b", { hasText: "not bold" })).toHaveCount(0);

  const steps = log.locator("details.mca-steps");
  await expect(steps.getByText("Checked the rota for next week")).toBeHidden();
  await steps.locator("summary").click();
  await expect(steps.getByText("Checked the rota for next week")).toBeVisible();
  await steps.locator("summary").click();
  await expect(steps.getByText("Checked the rota for next week")).toBeHidden();

  await page.getByRole("button", { name: "16:00–23:00", exact: true }).click();
  await expect(log).toContainText("Here's the plan.");
  expect(requests[1].message).toBe("16:00–23:00");
  expect(requests[1].history.map((t) => t.role)).toEqual(["user", "assistant"]);
  // Suggestions belong to the latest reply only.
  await expect(page.getByRole("button", { name: "Match his availability" })).toHaveCount(0);
});

test("errors show a friendly bubble and retry resends once", async ({ page }) => {
  const requests = await signedIn(page, {
    ai: (body, n) =>
      n === 1
        ? { status: 500, json: { error: "internal", reply: "McAssist is having a moment. Please try again." } }
        : { reply: "Your next shift is Saturday at 16:00." },
  });
  await page.goto("/main.html?view=assistant");
  await ask(page, "When am I working next?");
  const log = page.locator("#chat");
  await expect(log).toContainText("McAssist is having a moment.");
  await log.getByRole("button", { name: "Try again" }).click();
  await expect(log).toContainText("Your next shift is Saturday at 16:00.");
  await expect(log).not.toContainText("McAssist is having a moment.");
  await expect(log.locator(".mca-msg-user")).toHaveCount(1);
  expect(requests).toHaveLength(2);
  expect(requests[1].message).toBe("When am I working next?");
  expect(requests[1].history).toEqual([]);
});

test("composer: Enter sends once, Shift+Enter adds a line, uiAction navigates", async ({ page }) => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const requests = await signedIn(page, {
    ai: async (body, n) => {
      if (n === 1) await gate;
      return n === 1
        ? { reply: "Opening the schedule.", uiAction: { type: "openPage", page: "schedule" } }
        : { reply: "unexpected" };
    },
  });
  await page.goto("/main.html?view=assistant");
  const input = page.getByRole("textbox", { name: "Message McAssist" });
  await input.click();
  await input.pressSequentially("Show me");
  await input.press("Shift+Enter");
  await input.pressSequentially("the rota");
  await expect(input).toHaveValue("Show me\nthe rota");
  await input.press("Enter");
  await expect(page.locator(".mca-typing")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeDisabled();
  await input.fill("second message");
  await input.press("Enter");
  release();
  await expect(page).toHaveURL(/\/schedule\.html/);
  expect(requests).toHaveLength(1);
  expect(requests[0].message).toBe("Show me\nthe rota");
});

test("launcher opens the drawer on other pages, shares history and closes with Esc", async ({ page, isMobile }) => {
  await signedIn(page, { ai: () => ({ reply: "Hi from the drawer." }) });
  await page.goto("/main.html");
  const launcher = page.getByRole("button", { name: /Ask McAssist/ });
  await expect(launcher).toBeVisible();
  // Never sits on the phone tab bar.
  const nav = page.locator(".mobile-nav");
  if (await nav.isVisible()) {
    const a = await launcher.boundingBox();
    const b = await nav.boundingBox();
    expect(a.y + a.height).toBeLessThanOrEqual(b.y);
  }
  // Click near the leading edge: the launcher may be peeking at the screen
  // edge if a page control sits under its resting spot.
  await launcher.click({ position: { x: 14, y: 20 } });
  const drawer = page.getByRole("dialog", { name: "McAssist" });
  await expect(drawer).toBeVisible();
  if (!isMobile)
    await expect(drawer.getByRole("textbox", { name: "Message McAssist" })).toBeFocused();
  await drawer.getByRole("textbox", { name: "Message McAssist" }).fill("Hello");
  await drawer.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(drawer).toContainText("Hi from the drawer.");
  expect(await noOverflow(page)).toBeTruthy();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(launcher).toBeFocused();
  // Idempotent across live re-renders.
  await page.evaluate(() => window.__qa.emit("shifts"));
  await expect(page.locator("#mcaLauncher")).toHaveCount(1);
  // The full page shows the same conversation.
  await page.goto("/main.html?view=assistant");
  await expect(page.locator("#chat")).toContainText("Hi from the drawer.");
  await expect(page.locator("#mcaLauncher")).toHaveCount(0);
});

test("pages can opt out of the launcher", async ({ page }) => {
  await signedIn(page, { ai: () => ({ reply: "ok" }) });
  await page.goto("/main.html");
  await expect(page.locator("#mcaLauncher")).toBeVisible();
  await page.evaluate(() => (document.body.dataset.hideAssistantLauncher = "true"));
  await expect(page.locator("#mcaLauncher")).toBeHidden();
});

test("clear conversation asks for a second tap", async ({ page }) => {
  await signedIn(page, { ai: () => ({ reply: "Noted." }) });
  await page.goto("/main.html?view=assistant");
  await ask(page, "Remember this");
  await expect(page.locator("#chat")).toContainText("Noted.");
  const clear = page.getByRole("button", { name: "Clear conversation" });
  await clear.click();
  await expect(page.locator("#chat")).toContainText("Noted.");
  await page.getByRole("button", { name: /Tap again to clear/ }).click();
  await expect(page.locator("#chat")).not.toContainText("Noted.");
  await expect(page.locator("#chat")).toContainText("I'm McAssist");
});

test("preview demo: asks for times, plans, confirms and the shifts reach the schedule", async ({ page }) => {
  test.setTimeout(60000);
  let aiCalls = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/ai-chat")) aiCalls++;
  });
  await page.goto("/main.html?view=assistant&preview=manager");
  await expect(page.getByText("Preview demo · sample data").first()).toBeVisible();
  await ask(page, "Create 2 shifts for Cosmin next week");
  const log = page.locator("#chat");
  await expect(log).toContainText("You didn't say what times");
  await expect(log).toContainText("Checked Cosmin's availability", { useInnerText: false });
  await page.getByRole("button", { name: "16:00–23:00", exact: true }).click();
  const card = page.getByRole("article", { name: /Plan: Create 2 shifts for Cosmin Blidaru/ });
  await expect(card).toBeVisible();
  await expect(card.locator(".mca-plan-item")).toHaveCount(2);
  await card.getByRole("button", { name: /Create 2 shifts/ }).click();
  await expect(card).toContainText("Approved · 2 of 2 done");
  await expect(log.locator(".mca-actions")).toContainText("Created Cosmin Blidaru");
  expect(await noOverflow(page)).toBeTruthy();
  await page.getByRole("button", { name: "Show me on the schedule" }).click();
  await expect(page).toHaveURL(/schedule\.html\?date=\d{4}-\d{2}-\d{2}&preview=manager/, { timeout: 15000 });
  await expect(page.locator("#content")).toContainText(/16:00\s*[–-]\s*23:00/);
  expect(aiCalls).toBe(0);
});

test("preview demo: deleting an account is a high-risk plan", async ({ page }) => {
  test.setTimeout(60000);
  await page.goto("/main.html?view=assistant&preview=manager");
  await ask(page, "Delete Ryan's account");
  const card = page.getByRole("article", { name: /Plan: Delete Ryan Davies's account/ });
  await expect(card).toContainText("High risk");
  await card.getByRole("button", { name: "Delete account" }).click();
  await expect(page.locator("#chat")).toContainText("Ryan Davies's account has been deleted");
  await ask(page, "Delete Ryan's account");
  await expect(page.locator("#chat")).toContainText("couldn't find anyone called Ryan");
});

test("crew preview refuses manager actions and answers from sample data", async ({ page }) => {
  test.setTimeout(60000);
  let aiCalls = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/ai-chat")) aiCalls++;
  });
  await page.goto("/main.html?view=assistant&preview=crew");
  await ask(page, "Delete Ryan's account");
  const log = page.locator("#chat");
  await expect(log).toContainText("manager action");
  await expect(log).toContainText("No changes were made.");
  await expect(page.locator(".mca-plan")).toHaveCount(0);
  await ask(page, "What is my next shift and station?");
  await expect(log.locator(".mca-msg-bot").last()).toContainText(/next shift|upcoming shifts/);
  expect(aiCalls).toBe(0);
  expect(await noOverflow(page)).toBeTruthy();
});
