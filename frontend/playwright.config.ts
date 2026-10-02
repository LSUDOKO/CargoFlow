import { defineConfig, devices } from "@playwright/test";

// The stack (chain, backend, built frontend) is started by scripts/e2e-stack.sh, which sets E2E_BASE_URL.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // the tests share one chain and its test wallets
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
