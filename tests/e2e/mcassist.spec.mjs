// McAssist end to end: the real /api/ai-chat loop, real Firestore tools and
// the real UI, with only the language model replaced by scripts/fake-openai.mjs.
import { mkdirSync } from "node:fs";
import {
  test,
  expect,
  SEED,
  signIn,
  weekDates,
  shiftsFor,
  userDoc,
  authUserExists,
} from "./fixtures.mjs";

const isChat = (r) =>
  /\/api\/(ai-chat|mcassist)$/.test(new URL(r.url()).pathname) && r.request().method() === "POST";

// Runs a UI action and returns the JSON the real McAssist endpoint answered.
async function chatTurn(page, action) {
  const responsePromise = page.waitForResponse(isChat, { timeout: 60000 });
  await action();
  const response = await responsePromise;
  return { status: response.status(), body: await response.json().catch(() => ({})), request: response.request().postDataJSON() };
}

async function openAssistant(page, who) {
  await signIn(page, who);
  await page.goto("/main.html?view=assistant");
  await expect(page.getByRole("textbox", { name: "Message McAssist" })).toBeVisible();
}

function send(page, text) {
  return chatTurn(page, async () => {
    await page.getByRole("textbox", { name: "Message McAssist" }).fill(text);
    await page.getByRole("button", { name: "Send message", exact: true }).click();
  });
}

const plan = (page) => page.getByRole("article", { name: /^Plan:/ }).last();

// Screenshots of the conversation for a visual check (.out/3200/shots/).
mkdirSync(".out/3200/shots", { recursive: true });
const shot = (page, name) =>
  page.screenshot({ path: `.out/3200/shots/${test.info().project.name}-mcassist-${name}.png` });

test.describe("McAssist", () => {
  test("a manager plans shifts: it checks availability, asks for times, then creates them after confirmation", async ({
    page,
    admin,
  }) => {
    const next = weekDates(1);
    const before = await shiftsFor(admin, SEED.users.cosmin.uid);
    await openAssistant(page, "maya");

    // 1. Missing times: McAssist checks first and asks instead of guessing.
    const ask = await send(page, "Create 3 shifts for Cosmin next week");
    expect(ask.status).toBe(200);
    expect(ask.body.pending).toBeFalsy();
    expect(ask.body.reply).toMatch(/what (hours|times)/i);
    expect(ask.body.reply).toMatch(/availab/i);
    expect((ask.body.steps || []).join(" ")).toMatch(/availability/i);
    expect(ask.body.suggestions?.length).toBeGreaterThan(0);
    await expect(page.locator("#chat")).toContainText(/what (hours|times)/i);
    await shot(page, "1-question");
    expect(await shiftsFor(admin, SEED.users.cosmin.uid)).toHaveLength(before.length);

    // 2. Answer with a quick reply: a pending plan with 3 shifts, nothing saved yet.
    const chip = page.getByRole("group", { name: "Suggested replies" }).getByRole("button", { name: "16:00–23:00 on Fries" });
    const proposal = await chatTurn(page, () => chip.click());
    expect(proposal.status).toBe(200);
    expect(proposal.request.history?.length).toBeGreaterThan(0);
    const pending = proposal.body.pending;
    expect(pending).toBeTruthy();
    expect(pending.items).toHaveLength(3);
    expect(pending.items.every((i) => i.status !== "blocked")).toBe(true);
    await expect(plan(page)).toBeVisible();
    await expect(plan(page)).toContainText(pending.title);
    await plan(page).scrollIntoViewIfNeeded();
    await shot(page, "2-plan");
    expect(await shiftsFor(admin, SEED.users.cosmin.uid)).toHaveLength(before.length);
    const stored = await admin.db.doc(`stores/${SEED.store.id}/assistantPending/${pending.id}`).get();
    expect(stored.exists).toBe(true);
    expect(stored.data().status).toBe("pending");

    // 3. Confirm on the card: the server re-validates and writes all three.
    const done = await chatTurn(page, () => plan(page).getByRole("button", { name: pending.confirmLabel, exact: true }).click());
    expect(done.status).toBe(200);
    expect(done.request.confirm).toMatchObject({ pendingId: pending.id, decision: "approve" });
    expect(done.body.dataChanged).toBe(true);
    expect(done.body.results?.filter((r) => r.ok)).toHaveLength(3);
    await expect(plan(page)).toContainText(/approved|done|applied/i);
    await shot(page, "3-done");

    const after = await shiftsFor(admin, SEED.users.cosmin.uid);
    const created = after.filter((s) => !before.some((b) => b.id === s.id));
    expect(created).toHaveLength(3);
    for (const s of created) {
      expect(next).toContain(s.date);
      expect(s).toMatchObject({ start: "16:00", end: "23:00", station: "Fries", userName: SEED.users.cosmin.name });
    }
    // Never on his day off, never on top of his existing Friday shift.
    expect(created.map((s) => s.date)).not.toContain(next[2]);
    expect(created.map((s) => s.date)).not.toContain(next[4]);
    const audit = await admin.db.collection(`stores/${SEED.store.id}/assistantAudit`).get();
    expect(audit.size).toBeGreaterThanOrEqual(3);
    expect((await admin.db.doc(`stores/${SEED.store.id}/assistantPending/${pending.id}`).get()).data().status).toBe("done");
  });

  test("deleting an account is a high-risk plan and removes the login and profile only after confirmation", async ({
    page,
    admin,
  }) => {
    const amelia = SEED.users.amelia.uid;
    await openAssistant(page, "maya");
    const proposal = await send(page, "Delete Amelia's account");
    expect(proposal.status).toBe(200);
    const pending = proposal.body.pending;
    expect(pending).toMatchObject({ risk: "high" });
    await expect(plan(page)).toBeVisible();
    await plan(page).scrollIntoViewIfNeeded();
    await shot(page, "4-delete-plan");
    // Still there until the manager confirms.
    expect(await authUserExists(admin, amelia)).toBe(true);
    expect(await userDoc(admin, amelia)).not.toBeNull();

    const done = await chatTurn(page, () => plan(page).getByRole("button", { name: pending.confirmLabel, exact: true }).click());
    expect(done.status).toBe(200);
    expect(done.body.results?.some((r) => r.ok)).toBe(true);
    await expect.poll(() => authUserExists(admin, amelia)).toBe(false);
    expect(await userDoc(admin, amelia)).toBeNull();
    // Her upcoming shift next Monday is gone too; other people are untouched.
    expect((await admin.db.doc(`stores/${SEED.store.id}/Shifts/e2e-shift-amelia-nextmon`).get()).exists).toBe(false);
    expect(await authUserExists(admin, SEED.users.ryan.uid)).toBe(true);
  });

  test("cancelling a plan changes nothing", async ({ page, admin }) => {
    await openAssistant(page, "maya");
    const proposal = await send(page, "Delete Ryan's account");
    const pending = proposal.body.pending;
    expect(pending).toBeTruthy();
    const cancelled = await chatTurn(page, () => plan(page).getByRole("button", { name: pending.cancelLabel, exact: true }).click());
    expect(cancelled.status).toBe(200);
    expect(cancelled.request.confirm).toMatchObject({ pendingId: pending.id, decision: "cancel" });
    expect(await authUserExists(admin, SEED.users.ryan.uid)).toBe(true);
    expect(await userDoc(admin, SEED.users.ryan.uid)).not.toBeNull();
    expect((await admin.db.doc(`stores/${SEED.store.id}/assistantPending/${pending.id}`).get()).data().status).toBe("cancelled");
  });

  test("a crew member asking to delete someone is refused and nothing changes", async ({ page, admin }) => {
    await openAssistant(page, "cosmin");
    const answer = await send(page, "Delete Amelia's account");
    expect(answer.status).toBe(200);
    expect(answer.body.pending).toBeFalsy();
    expect(answer.body.dataChanged).toBeFalsy();
    expect(answer.body.reply).toMatch(/can.?t|cannot|not allowed|only a manager/i);
    await expect(page.getByRole("article", { name: /^Plan:/ })).toHaveCount(0);
    await shot(page, "5-crew-refused");
    expect(await authUserExists(admin, SEED.users.amelia.uid)).toBe(true);
    expect(await userDoc(admin, SEED.users.amelia.uid)).not.toBeNull();
    const pendingPlans = await admin.db.collection(`stores/${SEED.store.id}/assistantPending`).get();
    expect(pendingPlans.size).toBe(0);
  });

  test("a manager cannot reach people in another store through McAssist", async ({ page, admin }) => {
    await openAssistant(page, "maya");
    const answer = await send(page, "Delete Olivia's account");
    expect(answer.status).toBe(200);
    if (answer.body.pending) {
      // If anything was staged it must be blocked and cannot be applied.
      expect(answer.body.pending.items.every((i) => i.status === "blocked")).toBe(true);
    }
    expect(await authUserExists(admin, SEED.users.olivia.uid)).toBe(true);
    expect(await userDoc(admin, SEED.users.olivia.uid)).not.toBeNull();
  });
});
