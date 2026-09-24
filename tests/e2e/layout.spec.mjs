// Every signed-in page, on every device, with real emulator data: it must
// render, show no error banner and never scroll sideways. Full-page
// screenshots land in .out/3200/shots/ for a visual check.
import { mkdirSync } from "node:fs";
import { test, expect, signIn } from "./fixtures.mjs";

const SHOTS = ".out/3200/shots";
mkdirSync(SHOTS, { recursive: true });

const PAGES = {
  home: "/main.html",
  schedule: "/schedule.html",
  training: "/training.html",
  module: "/module.html?id=fries-station",
  availability: "/main.html?view=availability",
  rewards: "/break-rewards.html",
  verification: "/verification.html",
  waste: "/waste.html",
  assistant: "/main.html?view=assistant",
  team: "/admin.html",
  planner: "/shifts-admin.html",
};

const ROLES = {
  cosmin: ["home", "schedule", "training", "module", "availability", "rewards", "verification", "waste", "assistant"],
  maya: ["home", "schedule", "team", "planner", "verification", "waste", "assistant"],
  tara: ["verification"],
};

for (const [who, pages] of Object.entries(ROLES)) {
  test(`${who}: every page renders without sideways scrolling`, async ({ page: signInPage, newSession }, testInfo) => {
    test.setTimeout(180000);
    const errors = [];
    // WebKit reports Firestore's long-poll requests that are cut off by a page
    // navigation as "... due to access control checks". That is navigation
    // noise, not an app error.
    const navigationNoise = /Firestore\/(Listen|Write)\/channel.*access control checks/;
    const watch = (p) =>
      p.on("pageerror", (e) => {
        if (!navigationNoise.test(e.message)) errors.push(e.message);
      });
    watch(signInPage);
    await signIn(signInPage, who);
    // Each page opens in a fresh browser context that reuses the signed-in
    // session (Firebase Auth lives in IndexedDB). Playwright's WebKit on
    // Windows never releases the emulator connections of a page it has left,
    // so one context runs out of its six HTTP/1.1 connections after a few
    // pages (see README "Known flakiness").
    const session = await signInPage.context().storageState({ indexedDB: true });
    for (const name of pages) {
      const page = await newSession({ storageState: session });
      watch(page);
      await page.goto(PAGES[name], { waitUntil: "domcontentloaded" });
      await expect(page.locator("#content")).not.toBeEmpty();
      await expect(page.locator("#content .page-loading, #content [aria-busy='true']")).toHaveCount(0, { timeout: 20000 });
      await page.waitForTimeout(600); // let entrance animations settle
      await expect(page.locator(".data-warning")).toHaveCount(0);
      const overflow = await page.evaluate(() => ({
        doc: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
        view: window.innerWidth,
      }));
      expect(Math.max(overflow.doc, overflow.body), `${name} is wider than the screen`).toBeLessThanOrEqual(overflow.view + 1);
      await page.screenshot({ path: `${SHOTS}/${testInfo.project.name}-${who}-${name}.png`, fullPage: true });
      await page.context().close();
    }
    expect(errors, "uncaught page errors").toEqual([]);
  });
}
