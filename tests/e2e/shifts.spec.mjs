import { test, expect, SEED, signIn, weekDates, shiftsFor, pressVisible } from "./fixtures.mjs";

// Opens the planner's "Add a shift" sheet and fills it in.
async function fillShiftSheet(page, { memberId, date, start, end, station, breakMinutes = 30 }) {
  await page.goto("/shifts-admin.html");
  // The member list is fixed when the sheet opens: wait for the team first.
  await expect(page.locator("#content")).toContainText(SEED.users.cosmin.name);
  await page.getByRole("button", { name: "Add shift", exact: true }).first().click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await sheet.getByLabel("Team member").selectOption(memberId);
  await sheet.getByLabel("Date").fill(date);
  if (station) await sheet.getByLabel("Station").selectOption(station);
  await sheet.getByLabel(/^starts/i).fill(start);
  await sheet.getByLabel(/^finishes/i).fill(end);
  await sheet.getByLabel(/unpaid break/i).selectOption(String(breakMinutes));
  return sheet;
}

test.describe("rota", () => {
  test("a shift published in the planner appears live on the crew member's My shifts", async ({
    page,
    newSession,
    admin,
  }) => {
    const nextMonday = weekDates(1)[0];

    // Cosmin keeps next week's shifts open on his phone/tablet.
    const crew = await newSession();
    await signIn(crew, "cosmin");
    await crew.goto("/schedule.html");
    await crew.getByRole("button", { name: "Next week", exact: true }).click();
    await expect(crew.locator("#content")).toContainText("Fries"); // his seeded Friday shift
    await expect(crew.locator("#content")).not.toContainText("Front Counter");

    // Maya publishes a shift for him in the planner.
    await signIn(page, "maya");
    const sheet = await fillShiftSheet(page, {
      memberId: SEED.users.cosmin.uid,
      date: nextMonday,
      start: "10:00",
      end: "16:00",
      station: "Front Counter",
    });
    await expect(sheet).toContainText(/within availability/i);
    await pressVisible(page, sheet.getByRole("button", { name: "Publish shift", exact: true }));
    await expect(sheet).toBeHidden();

    // Firestore has the shift, written by the manager's own client.
    await expect
      .poll(async () => (await shiftsFor(admin, SEED.users.cosmin.uid)).filter((s) => s.date === nextMonday))
      .toEqual([
        expect.objectContaining({
          userName: SEED.users.cosmin.name,
          start: "10:00",
          end: "16:00",
          station: "Front Counter",
          breakMinutes: 30,
          createdBy: SEED.users.maya.uid,
        }),
      ]);

    // The crew page updates without a reload (Firestore onSnapshot).
    await expect(crew.locator("#content")).toContainText("Front Counter");
    await expect(crew.locator("#content")).toContainText(/10:00\s*[–-]\s*16:00/);
  });

  test("the planner warns before a day off and blocks a clash", async ({ page, admin }) => {
    const next = weekDates(1);
    await signIn(page, "maya");

    // Wednesday is Cosmin's day off: warned, and the button says so.
    let sheet = await fillShiftSheet(page, {
      memberId: SEED.users.cosmin.uid,
      date: next[2],
      start: "10:00",
      end: "16:00",
    });
    await expect(sheet).toContainText(/unavailable on wednesdays/i);
    await expect(sheet.getByRole("button", { name: /publish anyway/i })).toBeVisible();
    await pressVisible(page, sheet.getByRole("button", { name: "Cancel", exact: true }));
    await expect(sheet).toBeHidden();

    // Friday already has 17:00–23:00: a clash cannot be published.
    sheet = await fillShiftSheet(page, {
      memberId: SEED.users.cosmin.uid,
      date: next[4],
      start: "18:00",
      end: "22:00",
    });
    await expect(sheet).toContainText(/already works/i);
    await expect(sheet.getByRole("button", { name: /^publish/i })).toBeDisabled();
    await pressVisible(page, sheet.getByRole("button", { name: "Cancel", exact: true }));
    await expect(sheet).toBeHidden();

    const cosmin = await shiftsFor(admin, SEED.users.cosmin.uid);
    expect(cosmin.filter((s) => s.date === next[2])).toEqual([]);
    expect(cosmin.filter((s) => s.date === next[4])).toHaveLength(1);
  });

  test("crew members cannot use the shift planner", async ({ page }) => {
    await signIn(page, "cosmin");
    await page.goto("/shifts-admin.html");
    await expect(page.locator("#content")).toContainText(/managers/i);
    await expect(page.getByRole("button", { name: /publish shift|add shift/i })).toHaveCount(0);
  });
});
