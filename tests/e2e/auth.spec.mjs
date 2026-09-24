import { test, expect, SEED, signIn, openProfile, userDoc, waitForHub, expectSignedOut } from "./fixtures.mjs";

test.describe("accounts", () => {
  test("sign up as a Crew Trainer lands in the hub as crew with a pending role request", async ({ page, admin }) => {
    const email = `new.starter.${Date.now()}@e2e.test`;
    await page.goto("/signup.html");
    await page.getByLabel(/your name/i).fill("Nia Newstarter");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/^password/i).fill("brand-new-pass-1");
    await page.getByLabel(/store id/i).fill(SEED.store.id);
    await page.getByText("Crew Trainer", { exact: true }).click();
    await page.getByRole("button", { name: /create my account/i }).click();

    await page.waitForURL(/\/main(\.html)?(\?|$)/, { timeout: 20000 });
    await waitForHub(page);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Nia");

    const user = await admin.auth.getUserByEmail(email);
    const profile = await userDoc(admin, user.uid);
    expect(profile).toMatchObject({
      name: "Nia Newstarter",
      role: "crew",
      storeId: SEED.store.id,
      requestedRole: "crewTrainer",
      roleRequestStatus: "pending",
      stars: 0,
    });
    const request = await admin.db.doc("roleRequests/" + user.uid).get();
    expect(request.data()).toMatchObject({ requestedRole: "crewTrainer", status: "pending", storeId: SEED.store.id });

    // The profile card tells the new starter their request is waiting. (The
    // full profile card arrives once role data has loaded, so retry.)
    await expect(async () => {
      await page.keyboard.press("Escape");
      const dialog = await openProfile(page);
      await expect(dialog).toContainText(/crew trainer (requested|approval)|pending crew trainer/i, { timeout: 2000 });
      await expect(dialog).toContainText(/crew member/i, { timeout: 2000 });
    }).toPass({ timeout: 20000 });
  });

  test("sign in, see your own hub, sign out", async ({ page }) => {
    await signIn(page, "maya");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Maya");
    const dialog = await openProfile(page);
    await expect(dialog).toContainText("Maya Manager");
    await expect(dialog).toContainText("Manager");
    await dialog.getByRole("button", { name: /sign out/i }).click();
    await expectSignedOut(page);

    // Signed-out visitors are sent back to sign in.
    await page.goto("/main.html");
    await expectSignedOut(page);
  });

  test("a wrong password shows a friendly error and stays on sign in", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel(/email/i).fill(SEED.users.cosmin.email);
    await page.getByLabel(/^password/i).fill("not-the-password");
    await page.getByRole("button", { name: /^sign in/i }).click();
    const result = page.locator("#authResult");
    await expect(result).toBeVisible();
    await expect(result).not.toBeEmpty();
    await expect(page).toHaveURL(/\/($|index)/);
  });

  test("forgot password confirms a reset email without revealing accounts", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel(/email/i).fill(SEED.users.cosmin.email);
    await page.getByRole("button", { name: /forgot password/i }).click();
    await expect(page.locator("#authResult")).toContainText(/reset email is on its way/i);
  });
});
