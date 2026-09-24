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
  test.setTimeout(60000); // Three page loads; WebKit is slow on a busy machine.
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

// ---------------------------------------------------------------------------
// Prompt links, plan lifecycle against the final backend and data refresh.
// ---------------------------------------------------------------------------
test("a prompt link pre-fills the composer without sending and drops the parameter", async ({ page, isMobile }) => {
  const requests = await signedIn(page, { ai: () => ({ reply: "unexpected" }) });
  const prompt = "Who still needs Food Safety? Remind them on their next shift.";
  await page.goto("/main.html?view=assistant&prompt=" + encodeURIComponent(prompt));
  const input = page.getByRole("textbox", { name: "Message McAssist" });
  await expect(input).toHaveValue(prompt);
  if (!isMobile) await expect(input).toBeFocused();
  await expect(page).toHaveURL(/\/main\.html\?view=assistant$/);
  // The link is not applied again on reload.
  await input.fill("");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Message McAssist" })).toHaveValue("");
  expect(requests).toHaveLength(0);

  // Long prompts are capped at 2,000 characters; preview mode keeps its flag.
  await page.goto("/main.html?view=assistant&preview=manager&prompt=" + "a".repeat(2500));
  await expect(page.getByRole("textbox", { name: "Message McAssist" })).toHaveValue("a".repeat(2000));
  await expect(page).toHaveURL(/\/main\.html\?view=assistant&preview=manager$/);
});

test("a newer plan replaces older cards, and a 409 for a replaced plan locks it kindly", async ({ page }) => {
  const second = () => {
    const p = plan();
    return { ...p, pending: { ...p.pending, id: "plan-456", title: "Delete Amelia Wilson's account", cancelLabel: "Keep Amelia" } };
  };
  const requests = await signedIn(page, {
    ai: (body, n) =>
      body.confirm
        ? { status: 409, json: { error: "superseded", reply: "That plan was replaced by a newer one, so nothing was changed. Use the latest plan card." } }
        : n === 1
          ? plan()
          : second(),
  });
  await page.goto("/main.html?view=assistant");
  await ask(page, "Delete Ryan's account");
  const first = page.getByRole("article", { name: /Plan: Delete Ryan Davies's account/ });
  await expect(first.getByRole("button", { name: "Delete account" })).toBeEnabled();
  await ask(page, "Actually delete Amelia's account");
  const latest = page.getByRole("article", { name: /Plan: Delete Amelia Wilson's account/ });
  await expect(latest.getByRole("button", { name: "Keep Amelia" })).toBeEnabled();
  await expect(first).toContainText("Replaced by a newer plan");
  await expect(first.getByRole("button", { name: "Delete account" })).toBeDisabled();
  await expect(first.getByRole("button", { name: "Keep Ryan" })).toBeDisabled();
  await expect(page.locator(".mca-expiry")).toHaveCount(1);

  // The server can still supersede a card first (another tab, say).
  await latest.getByRole("button", { name: "Delete account" }).click();
  await expect(latest).toContainText("Replaced by a newer plan");
  await expect(page.locator("#chat")).toContainText("Use the latest plan card.");
  await expect(page.locator("#chat").getByRole("button", { name: "Try again" })).toHaveCount(0);
  expect(requests.at(-1).confirm).toEqual({ pendingId: "plan-456", decision: "approve" });

  // Replaced cards stay locked after a reload.
  await page.reload();
  await expect(page.getByRole("article", { name: /Plan: Delete Ryan Davies's account/ })).toContainText("Replaced by a newer plan");
  await expect(page.locator(".mca-plan-foot:not(.is-locked) .mca-btn-confirm")).toHaveCount(0);
});

test("typing yes or cancel straight after a plan updates the card from the server's answer", async ({ page }) => {
  test.setTimeout(60000); // Eight chat turns; WebKit is slow on a busy machine.
  let release = () => {};
  let gate = null;
  const requests = await signedIn(page, {
    ai: async (body) => {
      if (gate) await gate;
      if (/^Delete/.test(body.message)) return plan();
      if (body.message === "yes")
        return {
          reply: "Done — deleted Ryan Davies's account. 1 item was skipped: Verifications can't be revoked from a plan.",
          dataChanged: true,
          actions: ["Deleted Ryan Davies's account", "Removed 1 shift"],
          results: [
            { itemId: "a", ok: true, message: "Deleted Ryan Davies's account" },
            { itemId: "b", ok: true, message: "Removed 1 shift" },
            { itemId: "c", ok: false, message: "Skipped — Verifications can't be revoked from a plan." },
          ],
        };
      if (body.message === "cancel") return { reply: "Cancelled — nothing was changed.", dataChanged: false, results: [], actions: [] };
      return { reply: "This one is permanent, so please type confirm or use the button." };
    },
  });
  await page.goto("/main.html?view=assistant");
  const log = page.locator("#chat");

  // "ok" is too casual for a high-risk plan: the server answers normally and the card stays live.
  await ask(page, "Delete Ryan's account");
  const card = page.getByRole("article", { name: /Plan: Delete Ryan Davies's account/ });
  await ask(page, "ok");
  await expect(log).toContainText("please type confirm");
  await expect(card.getByRole("button", { name: "Delete account" })).toBeEnabled();

  // A clear "yes" straight after a fresh plan resolves it server-side.
  await ask(page, "Delete Ryan's account");
  const fresh = page.getByRole("article", { name: /Plan: Delete Ryan Davies's account/ }).last();
  await expect(card.first()).toContainText("Replaced by a newer plan");
  gate = new Promise((resolve) => (release = resolve));
  await ask(page, "yes");
  await expect(fresh).toContainText("Re-checking and applying");
  release();
  gate = null;
  await expect(fresh).toContainText("Approved · 2 of 2 done · 1 skipped");
  await expect(fresh.getByRole("button", { name: "Delete account" })).toHaveCount(0);
  await expect(log.locator(".mca-actions").last()).toContainText("Deleted Ryan Davies's account");
  const yes = requests.find((r) => r.message === "yes");
  expect(yes.confirm).toBeUndefined();
  expect(yes.history.at(-1)).toEqual({ role: "assistant", content: plan().reply });

  // And "cancel" resolves the next plan as cancelled.
  await ask(page, "Delete Ryan's account");
  const third = page.getByRole("article", { name: /Plan: Delete Ryan Davies's account/ }).last();
  await expect(third.getByRole("button", { name: "Keep Ryan" })).toBeEnabled();
  await ask(page, "cancel");
  await expect(third).toContainText("Cancelled · nothing was changed");
  await expect(third.getByRole("button", { name: "Keep Ryan" })).toHaveCount(0);
});

test("changes made by McAssist refresh portal data and notify the page", async ({ page }) => {
  let portalLoads = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/portal-data")) portalLoads++;
  });
  await signedIn(page, {
    ai: () => ({ reply: "Done — gave Amelia 3 McStars.", dataChanged: true, actions: ["Gave Amelia Wilson 3 McStars"] }),
  });
  await page.goto("/main.html?view=assistant");
  await expect(page.getByRole("textbox", { name: "Message McAssist" })).toBeVisible();
  await page.evaluate(() => {
    window.__changes = [];
    window.addEventListener("mcassist:data-changed", (e) => window.__changes.push(e.detail));
  });
  const before = portalLoads;
  await ask(page, "Give Amelia 3 McStars");
  await expect.poll(() => page.evaluate(() => window.__changes)).toEqual([{ preview: false }]);
  // The event follows the fresh load, so listeners read up-to-date data.
  expect(portalLoads).toBeGreaterThan(before);

  // Preview: the demo changes sample data and says so, without the network.
  await page.goto("/main.html?view=assistant&preview=manager");
  await page.evaluate(() => {
    window.__changes = [];
    window.addEventListener("mcassist:data-changed", (e) => window.__changes.push(e.detail));
  });
  await ask(page, "Give Amelia 3 McStars for great customer service");
  await expect.poll(() => page.evaluate(() => window.__changes)).toEqual([{ preview: true }]);
});

test("preview demo: a typed yes confirms the plan and an older plan is replaced", async ({ page }) => {
  test.setTimeout(60000);
  await page.goto("/main.html?view=assistant&preview=manager");
  const log = page.locator("#chat");
  await ask(page, "Delete Ryan's account");
  const first = page.getByRole("article", { name: /Plan: Delete Ryan Davies's account/ });
  await expect(first).toContainText("High risk");
  await ask(page, "Set Amelia's hourly rate to £12.60");
  const rate = page.getByRole("article", { name: /Plan: Set Amelia Wilson's hourly rate/ });
  await expect(rate).toBeVisible();
  await expect(first).toContainText("Replaced by a newer plan");
  await expect(first.getByRole("button", { name: "Delete account" })).toBeDisabled();
  await ask(page, "yes");
  await expect(rate).toContainText("Approved · 1 of 1 done");
  await expect(log).toContainText("hourly rate is now £12.60");
});

// ---------------------------------------------------------------------------
// Launcher placement: above the dock, never over content, calm on phones.
// ---------------------------------------------------------------------------
async function launcherState(page) {
  return page.evaluate(() => {
    const l = document.getElementById("mcaLauncher");
    const r = l.getBoundingClientRect();
    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;bottom:calc(22px + var(--dock-offset, 0px));right:0;width:1px;height:1px";
    document.body.appendChild(probe);
    const expected = getComputedStyle(probe).bottom;
    probe.remove();
    return {
      classes: l.className,
      bottom: getComputedStyle(l).bottom,
      expected,
      rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
      vw: document.documentElement.clientWidth,
      vh: innerHeight,
      opacity: Number(getComputedStyle(l).opacity),
    };
  });
}

// Text or controls under the visible launcher (sampled like a finger would).
function coveredContent(page) {
  return page.evaluate(() => {
    const l = document.getElementById("mcaLauncher");
    if (Number(getComputedStyle(l).opacity) < 0.5) return [];
    const r = l.getBoundingClientRect();
    const hits = new Set();
    for (let i = 1; i < 6; i++)
      for (let j = 1; j < 6; j++) {
        const x = r.left + (i / 6) * r.width;
        const y = r.top + (j / 6) * r.height;
        const el = document.elementsFromPoint(x, y).find((e) => !l.contains(e));
        if (!el || el === document.body || el === document.documentElement) continue;
        if (el.closest("a[href], button, input, select, textarea, [role='button']")) hits.add(el.outerHTML.slice(0, 80));
        for (const node of el.childNodes) {
          if (node.nodeType !== 3 || !node.nodeValue.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const t of range.getClientRects())
            if (t.width && t.right > r.left && t.left < r.right && t.bottom > r.top && t.top < r.bottom) hits.add(node.nodeValue.trim());
        }
      }
    return [...hits];
  });
}

test("launcher sits above the dock and never covers text or controls", async ({ page }) => {
  test.setTimeout(60000);
  for (const url of ["/main.html?preview=manager", "/schedule.html?preview=manager", "/main.html?preview=crew"]) {
    await page.goto(url);
    await expect(page.locator("#mcaLauncher")).toHaveCount(1);
    await page.waitForTimeout(1900); // entrance animation + settle checks
    const state = await launcherState(page);
    expect(state.bottom).toBe(state.expected);
    expect(await coveredContent(page), url).toEqual([]);
    expect(await noOverflow(page)).toBeTruthy();
  }
});

test("launcher peek stays fully inside the viewport", async ({ page }) => {
  await page.goto("/main.html?preview=manager");
  await expect(page.locator("#mcaLauncher")).toHaveCount(1);
  await page.evaluate(() => {
    const l = document.getElementById("mcaLauncher");
    // Hold the peek state for the measurement.
    const hold = () => {
      l.classList.remove("is-covered", "is-away");
      l.classList.add("is-peek");
    };
    hold();
    window.__hold = setInterval(hold, 20);
  });
  await page.waitForTimeout(800);
  const state = await launcherState(page);
  expect(state.rect.left).toBeGreaterThanOrEqual(0);
  expect(state.rect.top).toBeGreaterThanOrEqual(0);
  expect(state.rect.right).toBeLessThanOrEqual(state.vw);
  expect(state.rect.bottom).toBeLessThanOrEqual(state.vh);
  expect(state.rect.right - state.rect.left).toBeGreaterThanOrEqual(43);
  await expect(page.getByRole("button", { name: /Ask McAssist/ })).toBeVisible();
});

test("on phones the launcher hides while scrolling down and returns on scroll up", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1440) > 760, "Phone behaviour");
  await page.goto("/main.html?preview=manager");
  const launcher = page.locator("#mcaLauncher");
  await expect(launcher).toHaveCount(1);
  await page.waitForTimeout(900);
  await page.evaluate(() => scrollTo(0, 320));
  await expect(launcher).toHaveClass(/is-away/);
  await expect.poll(async () => (await launcherState(page)).opacity).toBe(0);
  await page.evaluate(() => scrollTo(0, 200));
  await expect(launcher).not.toHaveClass(/is-away/);
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  await expect(launcher).not.toHaveClass(/is-away|is-covered/);
  await page.waitForTimeout(400);
  // At the very end the page's extra bottom padding keeps its spot clear.
  expect(await coveredContent(page)).toEqual([]);
  expect((await launcherState(page)).opacity).toBe(1);
});

test("McAssist has no endless decorative animations when idle", async ({ page }) => {
  const endless = () =>
    page.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming?.().iterations === Infinity && a.playState === "running")
        .map((a) => a.effect.target)
        .filter((t) => t?.closest?.(".mca-page, .mca-launcher, .mca-drawer"))
        .map((t) => String(t.className?.baseVal ?? t.className)),
    );
  await page.goto("/main.html?view=assistant&preview=manager");
  await expect(page.getByRole("textbox", { name: "Message McAssist" })).toBeVisible();
  expect(await endless()).toEqual([]);
  await page.goto("/main.html?preview=manager");
  await expect(page.locator("#mcaLauncher")).toHaveCount(1);
  expect(await endless()).toEqual([]);
});
