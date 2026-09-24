import { test, expect, SEED, signIn, userDoc } from "./fixtures.mjs";

test.describe("team", () => {
  test("a crew member saves their availability", async ({ page, admin }) => {
    await signIn(page, "cosmin");
    await page.goto("/main.html?view=availability");
    const wednesday = page.getByRole("checkbox", { name: /wednesday|^wed/i });
    await expect(wednesday).not.toBeChecked();
    await wednesday.check();
    await page.getByLabel(/wednesday start|wed.*start/i).fill("10:00");
    await page.getByLabel(/wednesday (finish|end)|wed.*(finish|end)/i).fill("18:00");
    await page.getByRole("button", { name: /save availability/i }).click();
    await expect(page.locator("#content")).toContainText(/saved/i);

    await expect
      .poll(async () => (await userDoc(admin, SEED.users.cosmin.uid)).availability.wed)
      .toMatchObject({ available: true, start: "10:00", end: "18:00" });
    const saved = (await userDoc(admin, SEED.users.cosmin.uid)).availability;
    expect(saved.mon).toMatchObject({ available: true, start: "09:00", end: "23:00" });
    expect(saved.sun).toMatchObject({ available: false });

    // It is still there after a reload.
    await page.reload();
    await expect(page.getByRole("checkbox", { name: /wednesday|^wed/i })).toBeChecked();
    await expect(page.getByLabel(/wednesday start|wed.*start/i)).toHaveValue("10:00");
  });

  test("a manager approves a pending Crew Trainer request", async ({ page, admin, newSession }) => {
    await signIn(page, "maya");
    await page.goto("/admin.html");
    const approve = page.getByRole("button", { name: new RegExp("^approve( " + SEED.users.priya.name + ")?$", "i") }).first();
    await expect(page.locator("#content")).toContainText(SEED.users.priya.name);
    await expect(page.locator("#content")).toContainText(/requested crew trainer/i);
    await approve.click();

    await expect
      .poll(async () => (await userDoc(admin, SEED.users.priya.uid)).role)
      .toBe("crewTrainer");
    const request = (await admin.db.doc("roleRequests/" + SEED.users.priya.uid).get()).data();
    expect(request.status).toBe("approved");
    expect(request.reviewedBy).toBe(SEED.users.maya.uid);
    await expect(page.getByRole("button", { name: /^approve/i })).toHaveCount(0);

    // Priya now gets the Crew Trainer tools: she can start a verification.
    const priya = await newSession();
    await signIn(priya, "priya");
    await priya.goto("/verification.html");
    await expect(priya.locator('select[name="crewId"]')).toBeVisible();
  });

  test("a manager sees the whole store team and each member's details", async ({ page }) => {
    await signIn(page, "maya");
    await page.goto("/admin.html");
    for (const key of ["cosmin", "amelia", "ryan", "tara", "priya"])
      await expect(page.locator("#content")).toContainText(SEED.users[key].name);
    await page.getByRole("button", { name: new RegExp(SEED.users.amelia.name) }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(SEED.users.amelia.name);
    await expect(dialog).toContainText("Fries");
  });
});
