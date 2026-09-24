import { test, expect, SEED, signIn } from "./fixtures.mjs";

const MODULE = "food-safety";

// Walks a module like a crew member would: every lesson, the confidence
// check, then the quiz, answering from the live module data
// (window.McModules) either correctly or deliberately wrong.
async function takeModule(page, moduleId, { correct = true } = {}) {
  const answers = await page.evaluate(
    ({ id, correct }) =>
      window.McModules.modules
        .find((m) => m.id === id)
        .quiz.map((q) => q.a[correct ? q.correct : (q.correct + 1) % q.a.length]),
    { id: moduleId, correct },
  );
  const confidence = page.getByRole("button", { name: /^confidence check/i });
  for (let i = 0; i < 25 && !(await confidence.isVisible()); i++)
    await page.getByRole("button", { name: /^next lesson/i }).click();
  await confidence.click();

  const boxes = page.locator("#content").getByRole("checkbox");
  await expect(boxes.first()).toBeVisible();
  for (let i = 0; i < (await boxes.count()); i++) await boxes.nth(i).check();
  await page.getByRole("button", { name: /start the quiz/i }).click();

  for (const [i, answer] of answers.entries()) {
    await page.getByRole("radio", { name: answer, exact: true }).check();
    await page.getByRole("button", { name: /^check answer/i }).click();
    await page.getByRole("button", { name: i + 1 < answers.length ? /^next question/i : /^see my result/i }).click();
  }
}

const progressDoc = (admin, id) => admin.db.doc(`users/${SEED.users.cosmin.uid}/portalTraining/${id}`).get();

test.describe("learning", () => {
  test("completing a module is saved to the account and survives a reload", async ({ page, admin }) => {
    await signIn(page, "cosmin");
    await page.goto(`/module.html?id=${MODULE}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/food safety/i);
    await takeModule(page, MODULE, { correct: true });
    await expect(page.locator("#content")).toContainText(/module complete|passed|nicely done|well done/i);

    await expect.poll(async () => (await progressDoc(admin, MODULE)).data()?.completed, { timeout: 20000 }).toBe(true);
    const saved = (await progressDoc(admin, MODULE)).data();
    expect(saved.completedAt).toBeTruthy();

    // The learning hub shows it as completed (with the seeded First Shift one).
    await page.goto("/training.html");
    await expect(page.getByRole("heading", { name: "Your learning", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Completed", exact: true }).click();
    await expect(page.locator("#content")).toContainText(/food safety/i);
    await expect(page.locator("#content")).toContainText(/first shift/i);
  });

  test("failing the quiz does not complete the module", async ({ page, admin }) => {
    await signIn(page, "cosmin");
    await page.goto(`/module.html?id=${MODULE}`);
    await takeModule(page, MODULE, { correct: false });
    await expect(page.locator("#content")).toContainText(/not quite|try again|retry|pass mark/i);
    const doc = await progressDoc(admin, MODULE);
    expect(doc.exists ? doc.data().completed : false).toBeFalsy();
  });
});
