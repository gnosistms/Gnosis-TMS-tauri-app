import { test as base, expect } from "@playwright/test";

// Tests may reuse a developer's Vite server with the real DSN. Intercept at the
// browser boundary before any page boots, including tests that accept disclosure
// or intentionally throw. A successful empty response prevents SDK retry noise.
export const test = base.extend({
  context: async ({ context }, use) => {
    await context.route(/^https:\/\/(?:[^/]+\.)?sentry\.io\//, (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "{}",
    }));
    await use(context);
  },
});

export { expect };
