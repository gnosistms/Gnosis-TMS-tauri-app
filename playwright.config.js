import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  // A cold Vite dev server has to transform the full editor module graph on the
  // first navigation, and CI runners (Windows especially) stall mid-suite. 30s
  // was marginal and occasionally reddened main when the fixture harness had not
  // bootstrapped in time. 60s gives that boot generous headroom without masking
  // genuine hangs — the individual boot waits in mountEditorFixture stay well
  // under this ceiling.
  timeout: 60_000,
  expect: {
    timeout: 5_000,
  },
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:1431",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 1431",
    url: "http://127.0.0.1:1431",
    reuseExistingServer: true,
    stdout: "pipe",
    stderr: "pipe",
  },
});
