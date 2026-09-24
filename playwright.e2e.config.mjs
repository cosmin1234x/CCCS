// End-to-end harness: real UI + real API handlers + local Firebase emulators.
//
//   npm run test:e2e                          all specs on all four devices
//   npm run test:e2e -- --project=desktop     quick run on desktop Chromium
//
// Playwright starts (and stops) everything it needs:
//   1. Firebase Auth + Firestore emulators (demo-cccs), seeded  → :9099 / :8080
//   2. scripts/fake-openai.mjs, a scripted OpenAI-compatible model → :4010
//   3. scripts/fake-waste-store.mjs, the Hayle waste store stand-in → :4011
//   4. scripts/e2e-dev.mjs, the allowlisted build + every api/*.js  → :3200
// Every process refuses to run unless it points at 127.0.0.1, so a run can
// never touch the production Firebase project or the live waste store.
import { defineConfig, devices } from "@playwright/test";
import { assertLocalEmulators, e2eEnv } from "./scripts/e2e-guard.mjs";

const PORT = 3200;
const env = e2eEnv({
  OPENAI_API_KEY: "test",
  OPENAI_BASE_URL: "http://127.0.0.1:4010/v1",
  OPENAI_MODEL: "gpt-4o-mini",
  WASTE_STORE_URL: "http://127.0.0.1:4011/api/store",
});
// The test runner itself uses firebase-admin (seeding and assertions).
for (const [key, value] of Object.entries(env)) process.env[key] = value;
assertLocalEmulators(process.env, "playwright.e2e.config");

const reuse = process.env.E2E_REUSE === "1";
const shared = { stdout: "pipe", stderr: "pipe" };

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /.*\.spec\.mjs$/,
  timeout: 90000,
  expect: { timeout: 15000 },
  // All specs share one pair of emulators and each test wipes + reseeds them,
  // so tests must run one at a time.
  fullyParallel: false,
  workers: 1,
  // One retry: Playwright WebKit on Windows occasionally drops the Firestore
  // emulator's long-poll connection. A test that only passes on retry is
  // reported as "flaky" in the summary, never hidden. E2E_RETRIES=0 disables.
  retries: process.env.E2E_RETRIES !== undefined ? Number(process.env.E2E_RETRIES) : 1,
  reporter: [["list"], ["html", { outputFolder: ".out/e2e-report", open: "never" }]],
  outputDir: ".out/e2e-results",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: "en-GB",
    timezoneId: "Europe/London",
    // Functional runs use reduced motion: smooth scrolling and entrance
    // animations otherwise move buttons while Playwright clicks them.
    // E2E_MOTION=full runs with every animation on.
    reducedMotion: process.env.E2E_MOTION === "full" ? "no-preference" : "reduce",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    actionTimeout: 15000,
    navigationTimeout: 30000,
  },
  projects: [
    { name: "desktop", use: { browserName: "chromium", viewport: { width: 1440, height: 900 } } },
    { name: "ipad", use: { ...devices["iPad (gen 7)"], browserName: "webkit" } },
    { name: "ipad-landscape", use: { ...devices["iPad (gen 7) landscape"], browserName: "webkit" } },
    { name: "iphone", use: { ...devices["iPhone 13"], browserName: "webkit" } },
  ],
  webServer: [
    {
      command: "node scripts/e2e-emulators.mjs",
      url: "http://127.0.0.1:4399/ready",
      // Emulators are slow to boot; tests wipe and reseed them anyway.
      reuseExistingServer: true,
      timeout: 240000,
      env,
      ...shared,
    },
    {
      command: "node scripts/fake-openai.mjs",
      url: "http://127.0.0.1:4010/health",
      reuseExistingServer: reuse,
      timeout: 20000,
      env: { ...env, PORT: "4010" },
      ...shared,
    },
    {
      command: "node scripts/fake-waste-store.mjs",
      url: "http://127.0.0.1:4011/health",
      reuseExistingServer: reuse,
      timeout: 20000,
      env: { ...env, PORT: "4011" },
      ...shared,
    },
    {
      command: "node scripts/e2e-dev.mjs",
      url: `http://127.0.0.1:${PORT}/index.html`,
      reuseExistingServer: reuse,
      timeout: 60000,
      env: { ...env, PORT: String(PORT) },
      ...shared,
    },
  ],
});
