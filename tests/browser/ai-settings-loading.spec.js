import { expect, test } from "@playwright/test";

async function showSettings(page, models) {
  await page.goto("/");
  await page.waitForFunction(() => typeof window.__gnosisDebug?.waitForBootstrap === "function");
  await page.evaluate(() => window.__gnosisDebug.waitForBootstrap());
  await page.evaluate(async (models) => {
    const { state } = await import(`${location.origin}/app/state.js`);
    const { renderAiKeyScreen } = await import(`${location.origin}/screens/ai-key.js`);
    state.screen = "aiKey";
    state.auth.session = null;
    state.aiSettings.status = "ready";
    state.aiSettings.apiKey = "";
    state.aiSettings.apiKeyIsSaved = true;
    state.aiSettings.aboutModal.isOpen = false;
    state.aiSettings.actionConfig = {
      ...state.aiSettings.actionConfig,
      availableProvidersStatus: "ready",
      savedProviderIds: ["openai"],
      unified: { providerId: "openai", modelId: "gpt-6-astra" },
      modelOptionsByProvider: {
        ...state.aiSettings.actionConfig.modelOptionsByProvider,
        openai: models,
      },
    };
    document.querySelector("#app").innerHTML = renderAiKeyScreen(state);
  }, models);
}

test("cached settings remain visible and enabled during model refresh", async ({ page }) => {
  await showSettings(page, {
    status: "ready", hasLoaded: true, isRefreshing: true, error: "",
    options: ["gpt-6-astra", "gpt-5.6-sol"].map((id) => ({ id, label: id })),
  });
  await expect(page.locator("[data-ai-key-input]")).toHaveValue("");
  await expect(page.locator("[data-ai-key-input]")).toHaveAttribute("type", "password");
  await expect(page.locator("[data-ai-key-input]")).toBeEnabled();
  await expect(page.locator("[data-ai-settings-model-select]")).toBeEnabled();
  await expect(page.locator("[data-ai-settings-model-select]")).toHaveValue("gpt-6-astra");
  await expect(page.locator("[data-ai-settings-model-select] option")).toHaveCount(2);
  await expect(page.getByText("Refreshing AI models...", { exact: true })).toBeVisible();
  await page.locator(".ai-key-page").screenshot({ path: test.info().outputPath("cached-settings.png") });
});

test("saved key is absent from the field and copy, cut and drag are blocked", async ({ page }) => {
  await showSettings(page, {
    status: "ready", hasLoaded: true, error: "",
    options: [{ id: "gpt-6-astra", label: "gpt-6-astra" }],
  });
  const field = page.locator("[data-ai-key-input]");
  await expect(field).toHaveValue("");
  await expect(field).toHaveAttribute("type", "password");
  await expect(field).toHaveAttribute("placeholder", "•".repeat(48));
  await expect(page.locator('[data-action="save-ai-key"]')).toBeDisabled();
  await expect(page.locator('[data-action="remove-ai-key"]')).toBeEnabled();
  const cancelled = await field.evaluate((element) => ["copy", "cut", "dragstart"].map((name) =>
    !element.dispatchEvent(new Event(name, { bubbles: true, cancelable: true }))));
  expect(cancelled).toEqual([true, true, true]);
});

test("entering a replacement exposes only the new draft and enables saving", async ({ page }) => {
  await showSettings(page, {
    status: "ready", hasLoaded: true, error: "",
    options: [{ id: "gpt-6-astra", label: "gpt-6-astra" }],
  });
  const field = page.locator("[data-ai-key-input]");
  await field.fill("sk-new-draft");
  await expect(field).toHaveAttribute("type", "text");
  await expect(field).toHaveValue("sk-new-draft");
  await expect(page.locator('[data-action="save-ai-key"]')).toBeEnabled();
  await expect(page.locator('[data-action="remove-ai-key"]')).toHaveCount(0);
});

test("first discovery displays the saved model while its options are loading", async ({ page }) => {
  await showSettings(page, {
    status: "loading", hasLoaded: false, isRefreshing: true, error: "", options: [],
  });
  const model = page.locator("[data-ai-settings-model-select]");
  await expect(model).toHaveValue("gpt-6-astra");
  await expect(model.locator("option:checked")).toHaveText("gpt-6-astra");
  await expect(model).toBeDisabled();
  await expect(page.locator("[data-ai-key-input]")).toBeEnabled();
});
