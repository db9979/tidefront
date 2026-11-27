// Playwright: Durchspielen im Handy-Format (iPhone 13, 390 × 664 CSS-Pixel) gegen einen frischen lokalen Stack.
// Start: npm run e2e   (baut Test-DB in Docker, startet api, worker, vite; räumt danach auf)
import { defineConfig, devices } from "@playwright/test";
import { E2E } from "./env.ts";

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  outputDir: "../../../node_modules/.cache/tidefront-e2e/results",
  fullyParallel: false,
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : 3,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "../../../node_modules/.cache/tidefront-e2e/report", open: "never" }]],
  use: {
    ...devices["iPhone 13"],
    // Chromium statt WebKit: gleiche Maße, Touch und Nutzeragent wie das iPhone, aber überall installierbar.
    browserName: "chromium",
    baseURL: E2E.webUrl,
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    actionTimeout: 10_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node apps/web/e2e/stack.ts",
    cwd: "../../..",
    url: `${E2E.webUrl}/trpc/meta`,
    timeout: 120_000,
    reuseExistingServer: !!process.env.E2E_REUSE,
    stdout: "pipe",
    stderr: "pipe",
    gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
  },
});
