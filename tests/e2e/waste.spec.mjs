// Waste tab end to end: real UI + real /api/waste proxy, with the Hayle
// shared store replaced by scripts/fake-waste-store.mjs (never production).
import { test, expect, signIn } from "./fixtures.mjs";

const FAKE_STORE = "http://127.0.0.1:4011";
const storeState = async () => (await fetch(FAKE_STORE + "/__e2e/state")).json();
const ITEM = "10:1 Beef Patty";

test.describe("waste", () => {
  test("the waste counter loads, counts and saves a sheet to the shared store", async ({ page, newSession }) => {
    await signIn(page, "maya");
    const loaded = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/waste" && r.request().method() === "GET");
    await page.goto("/waste.html");
    expect((await loaded).status()).toBe(200);

    const add = page.getByRole("button", { name: `Add one ${ITEM}`, exact: true });
    await expect(add).toBeVisible();
    for (let i = 0; i < 3; i++) await add.click();
    await expect(page.getByLabel(`${ITEM} count`, { exact: true })).toHaveValue("3");

    await page.getByRole("button", { name: /save sheet/i }).click();
    await expect(page.locator("#toast")).toContainText(/saved/i);

    // The shared record (what the standalone app and APK read) has the sheet.
    await expect
      .poll(async () => (await storeState()).record?.state?.history?.[0]?.totals?.raw ?? 0, { timeout: 20000 })
      .toBe(3);
    const { record } = await storeState();
    expect(record.state.history[0].entries).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: ITEM, count: 3 })]),
    );

    // Another device (a crew member on a fresh browser) sees the same history.
    const crew = await newSession();
    await signIn(crew, "cosmin");
    await crew.goto("/waste.html");
    await crew.getByRole("tab", { name: /history/i }).click();
    await expect(crew.locator("#wasteHistoryCount")).toHaveText("1");
  });

  test("the waste API refuses signed-out requests", async ({ request }) => {
    const response = await request.get("/api/waste");
    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.ok).toBe(false);
  });
});
