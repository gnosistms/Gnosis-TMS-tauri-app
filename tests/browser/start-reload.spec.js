import { expect, test } from "@playwright/test";

test("reload shows the start hero while persistent storage is still loading", async ({ page }) => {
  await page.addInitScript(() => {
    try {
      globalThis.localStorage?.clear();
    } catch {
      // Ignore local-storage access restrictions in the browser harness.
    }

    let resolveStoreLoad = null;
    const storeLoadPromise = new Promise((resolve) => {
      resolveStoreLoad = resolve;
    });

    globalThis.__resolveGnosisStoreLoad = () => {
      resolveStoreLoad?.({
        entries: async () => [],
        set: async () => {},
        delete: async () => {},
      });
    };

    globalThis.__TAURI__ = {
      store: {
        load: async () => storeLoadPromise,
      },
      core: {
        invoke: async (command) => {
          if (command === "load_broker_auth_session") {
            return null;
          }
          if (command === "check_internet_connection") {
            return true;
          }
          if (command === "check_for_app_update") {
            return {
              available: false,
              currentVersion: "0.0.0-test",
              version: null,
              body: null,
            };
          }
          return null;
        },
      },
      event: {
        listen: async () => () => {},
      },
      opener: {
        openUrl() {},
      },
    };
  });

  await page.goto("/");
  await expect(page.locator(".card--hero .start-hero__logo-image")).toBeVisible();
  await expect(page.locator(".card--hero")).toContainText("Gnosis TMS");

  await page.evaluate(() => {
    globalThis.__resolveGnosisStoreLoad();
  });
  await page.evaluate(async () => {
    await window.__gnosisDebug.waitForBootstrap();
  });

  await page.reload();
  await expect(page.locator(".card--hero .start-hero__logo-image")).toBeVisible();
  await expect(page.locator(".card--hero")).toContainText("Gnosis TMS");
});
