import { expect, test } from "./test.js";

const start = new Date("2026-01-01T12:00:00Z").getTime();
const week = 7 * 24 * 60 * 60 * 1000;
const storageKey = "gnosis-tms-gnosis-tms-ai-model-history:owner";

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(start);
  await page.addInitScript((key) => {
    localStorage.setItem("gnosis-tms-telemetry-enabled", "false");
    localStorage.setItem("gnosis-tms-telemetry-disclosure-shown", "true");
    localStorage.setItem("gnosis-tms-gnosis-tms-ai-settings-about-dismissed:owner", "true");
    if (!localStorage.getItem(key)) {
      localStorage.setItem(key, JSON.stringify({
        checkedAt: Date.now(), sources: {}, providers: { openai: { knownIds: ["old-model"], pending: [] } },
      }));
    }
    window.availableModels = ["old-model", "new-model"];
    window.weeklyListings = 0;
    window.__TAURI__ = {
      core: { invoke: async (command, payload = {}) => {
        if (command === "check_internet_connection") return true;
        if (command === "load_broker_auth_session" || command === "inspect_broker_auth_session") {
          return { login: "owner", sessionToken: "fixture-session" };
        }
        if (command === "list_accessible_github_app_installations") return [{
          installationId: 1, accountLogin: "owner-team", accountType: "organization", membershipRole: "owner",
        }];
        if (command === "load_ai_provider_secret") return payload.providerId === "openai" ? "fixture" : null;
        if (command === "load_team_ai_settings") return { actionPreferences: {
          unified: { providerId: "openai", modelId: "old-model" }, detailedConfiguration: false,
        } };
        if (command === "load_team_ai_secrets_metadata") return { providers: {} };
        if (command === "load_team_ai_provider_cache") return { apiKey: "fixture", keyVersion: null };
        if (command === "list_ai_provider_models") {
          if (payload.noticeKnownIds) window.weeklyListings += 1;
          return window.availableModels.filter((id) => !payload.noticeKnownIds?.includes(id))
            .map((id) => ({ id, label: id }));
        }
        if (command.startsWith("list_")) return [];
        return null;
      } },
      event: { listen: async () => () => {} },
    };
  }, storageKey);
  await page.goto("/");
  await expect(page.locator('[data-nav-target="aiKey"]')).toBeVisible();
});

async function runWeek(page, number) {
  await page.clock.setFixedTime(start + week * number);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => page.evaluate(() => window.weeklyListings)).toBe(number);
}

function providerHistory(page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)).providers.openai, storageKey);
}

test("a model loaded on the settings page still gets a notice if the picker was never opened", async ({ page }) => {
  await page.locator('[data-nav-target="aiKey"]').click();
  await expect(page.locator('[data-ai-settings-model-select] option[value="new-model"]')).toHaveCount(1);
  await runWeek(page, 1);
  const notice = page.getByRole("dialog", { name: "New AI models from OpenAI" });
  await expect(notice.getByRole("listitem")).toHaveText(["new-model"]);
});

test("only opening the model dropdown acknowledges the options loaded by AI Settings", async ({ page }) => {
  await page.locator('[data-nav-target="aiKey"]').click();
  const model = page.locator("[data-ai-settings-model-select]");
  await expect(model.locator('option[value="new-model"]')).toHaveCount(1);
  await model.focus();
  await model.press("Tab");
  expect((await providerHistory(page)).knownIds).toEqual(["old-model"]);
  await model.click();
  await model.press("Escape");
  expect((await providerHistory(page)).knownIds).toEqual(["old-model", "new-model"]);
  await runWeek(page, 1);
  await expect(page.locator('[data-modal-dialog="ai-model-notification"]')).toHaveCount(0);
});

test("Ignore and AI Settings each consume a discovery once, including across a reload", async ({ page }) => {
  await page.evaluate(() => window.availableModels.push("another-model"));
  await runWeek(page, 1);
  const dialog = page.getByRole("dialog", { name: "New AI models from OpenAI" });
  await expect(dialog.getByRole("listitem")).toHaveText(["new-model", "another-model"]);
  await expect(dialog.getByText("Click AI Settings to change your AI model settings.")).toBeVisible();
  await dialog.getByRole("button", { name: "Ignore" }).click();
  await expect(dialog).toHaveCount(0);
  await page.evaluate(() => window.availableModels.push("latest-model"));
  await runWeek(page, 2);
  await expect(dialog.getByRole("listitem")).toHaveText(["latest-model"]);
  await dialog.getByRole("button", { name: "AI Settings" }).click();
  await expect(page.locator("[data-ai-settings-model-select]")).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await expect(page.locator('[data-nav-target="aiKey"]')).toBeVisible();
  const remembered = await providerHistory(page);
  expect(remembered.pending).toEqual([]);
  expect(remembered.knownIds).toContain("latest-model");
});
