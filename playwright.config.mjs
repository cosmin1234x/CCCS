import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 20000,
  fullyParallel: true,
  use: {
    baseURL: "http://127.0.0.1:3000",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
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
    command: "npm run build && node scripts/dev.mjs",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
  },
});
