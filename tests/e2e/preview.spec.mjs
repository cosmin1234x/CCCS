// Preview mode (no account) must stay a self-contained demo: it may never
// write to Firebase or call the real McAssist endpoint.
import { test, expect } from "./fixtures.mjs";

for (const role of ["crew", "manager"]) {
  test(`${role} preview works without touching Firebase or the AI endpoint`, async ({ page, admin }) => {
    const calls = [];
    page.on("request", (r) => {
      const url = new URL(r.url());
      // The Auth SDK may load its helper iframe on start-up (/emulator/auth/…
      // here, /__/auth/iframe in production); that is not a data call.
      const authHelper = url.port === "9099" && url.pathname.startsWith("/emulator/auth/");
      if ((/^(8080|9099)$/.test(url.port) && !authHelper) || /^\/api\/(ai-chat|mcassist)$/.test(url.pathname))
        calls.push(r.method() + " " + url.pathname);
    });
    const before = (await admin.db.collectionGroup("Shifts").get()).size;

    await page.goto(`/main.html?preview=${role}`);
    await expect(page.getByRole("region", { name: /sample preview/i })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Cosmin");

    // McAssist answers from its scripted demo, clearly labelled.
    await page.goto(`/main.html?view=assistant&preview=${role}`);
    const input = page.getByRole("textbox", { name: "Message McAssist" });
    await input.fill(role === "manager" ? "Create 3 shifts for Amelia next week" : "When am I working next?");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.locator("#chat")).toContainText(/.{20,}/);
    await expect(page.locator("#chat .mca-msg-bot").last()).toBeVisible();

    // Learning and the rota still work in the preview.
    await page.goto(`/training.html?preview=${role}`);
    await expect(page.getByRole("heading", { name: "Your learning", exact: true })).toBeVisible();
    await page.goto(`/schedule.html?preview=${role}`);
    await expect(page.locator("#content")).not.toBeEmpty();

    expect(calls, "preview must not read or write Firebase data or call the AI endpoint").toEqual([]);
    expect((await admin.db.collectionGroup("Shifts").get()).size).toBe(before);
  });
}
