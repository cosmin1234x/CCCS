import { defineConfig, devices } from "@playwright/test";
// PORT lets several local runs work side by side, each with its own build
// folder. CI and a plain `npm run test:browser` use port 3000 and public/.
const port = Number(process.env.PORT) || 3000;
const out = port === 3000 ? "public" : `.out/${port}`;
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 30000,
  fullyParallel: true,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  outputDir: port === 3000 ? "test-results" : `.out/test-results-${port}`,
  projects: [
    {
      name: "desktop",
      use: { browserName: "chromium", viewport: { width: 1440, height: 1000 } },
    },
    {
      name: "ipad",
      use: { ...devices["iPad (gen 7)"], browserName: "webkit" },
    },
    {
      name: "ipad-landscape",
      use: { ...devices["iPad (gen 7) landscape"], browserName: "webkit" },
    },
    { name: "iphone", use: { ...devices["iPhone 13"], browserName: "webkit" } },
  ],
  webServer: {
    command: "node scripts/build.mjs && node scripts/dev.mjs",
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
    env: { PORT: String(port), BUILD_OUT: out, DEV_ROOT: out },
  },
});
