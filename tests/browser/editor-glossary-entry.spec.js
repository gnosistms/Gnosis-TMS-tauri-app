import { expect, test } from "./test.js";

const ROW = "fixture-row-0001";
const FIELDS = {
  es: "El Ser interior es la parte más elevada del hombre.",
  vi: "Đấng Nội Tại là phần cao nhất của con người.",
  en: "The Inner Being is the highest part of man.",
};

// The editor fixture with Spanish → Vietnamese, an English column, and a
// stand-in for the native side that answers the AI with window.entryAnswer.
async function mountEditor(page) {
  await page.addInitScript(() => {
    window.entryCalls = [];
    window.entryAnswer = { found: false, confidence: "low", sourceText: null };
    const glossary = { glossaryId: "fixture-glossary", title: "Fixture Glossary", terms: [], termCount: 0,
      sourceLanguage: { code: "es", name: "Spanish" }, targetLanguage: { code: "vi", name: "Vietnamese" } };
    window.__TAURI__ = { event: { listen: async () => () => {} }, core: { invoke: async (command, args = {}) => {
      window.entryCalls.push({ command, args });
      if (command === "plugin:app|version") return "0.8.133";
      if (command === "run_glossary_research_request") {
        if (window.entryHoldAi) await new Promise((resolve) => { window.releaseEntryAi = resolve; });
        return { status: "ok", text: JSON.stringify(window.entryAnswer), usage: {} };
      }
      if (command === "load_gtms_glossary_editor_data") return structuredClone(glossary);
      if (command === "sync_gtms_glossary_editor_repo") return {};
      if (command === "glossary_studio_storage") {
        const { operation, input } = args;
        if (operation === "save") return { id: input.value.id, revision: 1, updatedAt: new Date().toISOString() };
        return ["load", "manifest", "export", "delete"].includes(operation) ? null : [];
      }
      // The fixture team, so team-access refreshes keep it selected.
      if (command === "list_accessible_github_app_installations") {
        return [{ installationId: 1, accountLogin: "fixture", accountName: "Fixture Team", accountType: "organization",
          membershipRole: "owner", description: null }];
      }
      if (command === "check_internet_connection") return true;
      if (command.startsWith("list_")) return [];
      return null;
    } } };
  });
  await page.goto("/");
  await page.waitForFunction(() => typeof window.__gnosisDebug?.mountEditorFixture === "function");
  await page.evaluate(async (fields) => {
    await window.__gnosisDebug.waitForBootstrap();
    await window.__gnosisDebug.mountEditorFixture({
      rowCount: 3,
      glossary: true,
      languages: [
        { code: "es", name: "Spanish", role: "source" },
        { code: "vi", name: "Vietnamese", role: "target" },
        { code: "en", name: "English", role: "target" },
      ],
      fieldsByRowId: { "fixture-row-0001": fields },
    });
    // The default AI settings name a Research model, so the AI is asked.
  }, FIELDS);
  const disclosureSave = page.locator(".modal-backdrop").getByRole("button", { name: "Save" });
  if (await disclosureSave.count()) await disclosureSave.click();
}

function entryButton(page, languageCode) {
  return page.locator(`[data-editor-glossary-entry-button][data-row-id="${ROW}"][data-language-code="${languageCode}"]`);
}

/** Open a language's text box in the first row and highlight `words` in it. */
async function highlight(page, languageCode, words) {
  await page.locator(`[data-editor-display-field][data-row-id="${ROW}"][data-language-code="${languageCode}"]`).click();
  const box = page.locator(`textarea[data-editor-row-field][data-row-id="${ROW}"][data-language-code="${languageCode}"]`);
  await expect(box).toBeFocused();
  await box.evaluate((element, text) => {
    const start = element.value.indexOf(text);
    element.setSelectionRange(start, start + text.length);
  }, words);
}

const dialog = (page) => page.locator('[data-modal-dialog="editor-glossary-entry"]');

test("the button waits for highlighted text and explains itself", async ({ page }) => {
  await mountEditor(page);
  for (const code of ["es", "vi", "en"]) await expect(entryButton(page, code)).toHaveAttribute("aria-disabled", "true");
  await expect(entryButton(page, "es")).toHaveAttribute("data-tooltip",
    "Highlight any word or group of words, then click here to make a glossary entry for it.");
  await expect(entryButton(page, "vi")).toHaveAttribute("data-tooltip",
    "Highlight any word or group of words, then click here to make a glossary entry for it.");
  await expect(entryButton(page, "en")).toHaveAttribute("data-tooltip",
    "Identify the source language term that corresponds to this word and research its meaning.");

  // A greyed-out button does nothing.
  await entryButton(page, "es").click({ force: true });
  await expect(dialog(page)).toHaveCount(0);

  await highlight(page, "es", "Ser interior");
  await expect(entryButton(page, "es")).toHaveAttribute("aria-disabled", "false");
  await expect(entryButton(page, "vi")).toHaveAttribute("aria-disabled", "true");
  await expect(entryButton(page, "en")).toHaveAttribute("aria-disabled", "true");

  await page.locator(`textarea[data-editor-row-field][data-row-id="${ROW}"][data-language-code="es"]`)
    .evaluate((element) => element.setSelectionRange(3, 3));
  await expect(entryButton(page, "es")).toHaveAttribute("aria-disabled", "true");
});

test("source-language text fills the source box; Cancel returns to the editor", async ({ page }) => {
  await mountEditor(page);
  await highlight(page, "es", "Ser interior");
  await entryButton(page, "es").click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).locator('[data-editor-glossary-entry-field="sourceTerm"]')).toHaveValue("Ser interior");
  await expect(dialog(page).locator('[data-editor-glossary-entry-field="targetTerm"]')).toHaveValue("");
  await expect(dialog(page).locator('[data-editor-glossary-entry-field="targetTerm"]')).toBeFocused();
  expect(await page.evaluate(() => window.entryCalls.some((call) => call.command === "run_glossary_research_request"))).toBe(false);
  await dialog(page).getByRole("button", { name: "Cancel" }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.locator('[data-screen="translate"]')).toBeVisible();
});

test("target-language text: the AI finds the source text, then Save to glossary opens New Term filled in", async ({ page }) => {
  await mountEditor(page);
  await page.evaluate(() => {
    window.entryHoldAi = true;
    window.entryAnswer = { found: true, confidence: "high", sourceText: "ser Interior" };
  });
  await highlight(page, "vi", "Đấng Nội Tại");
  await entryButton(page, "vi").click();
  await expect(dialog(page)).toContainText("Finding the Spanish text that corresponds to it");
  await expect(dialog(page).locator(".button__spinner")).toBeVisible();
  await expect(dialog(page).locator('[data-editor-glossary-entry-field="targetTerm"]')).toHaveValue("Đấng Nội Tại");
  await page.evaluate(() => window.releaseEntryAi());

  // The row's own spelling is used, not the AI's capitalization.
  await expect(dialog(page).locator('[data-editor-glossary-entry-field="sourceTerm"]')).toHaveValue("Ser interior");
  await expect(dialog(page).locator('[data-editor-glossary-entry-field="targetTerm"]')).toHaveValue("Đấng Nội Tại");
  const request = await page.evaluate(() => window.entryCalls.find((call) => call.command === "run_glossary_research_request").args.request);
  expect(request.content).toContain("Highlighted in Vietnamese: Đấng Nội Tại");
  expect(request.content).toContain(`[Spanish (source)]\n${"El Ser interior es la parte más elevada del hombre."}`);
  expect(request.schemaName).toBe("selection_source");

  await expect(dialog(page).getByRole("button")).toHaveText(["Cancel", "Research meanings", "Save to glossary"]);
  await expect(dialog(page).getByRole("button", { name: "Save to glossary" })).toHaveAttribute("data-tooltip",
    "Open the glossary editor and enter this term. You'll have a chance to review before saving.");
  await dialog(page).getByRole("button", { name: "Save to glossary" }).click();
  const termEditor = page.locator("#glossary-term-editor-modal-title");
  await expect(termEditor).toHaveText("New Term");
  const modal = page.locator(".modal-card", { has: termEditor });
  await expect(modal.locator("[data-glossary-term-variant-input]").first()).toHaveValue("Ser interior");
  const values = await modal.locator("input, textarea").evaluateAll((elements) => elements.map((element) => element.value));
  expect(values).toContain("Đấng Nội Tại");
  await expect(page.locator('[data-screen="glossaryEditor"]')).toBeVisible();
});

test("text in another language is matched to its source term and can go to research", async ({ page }) => {
  await mountEditor(page);
  await page.evaluate(() => { window.entryAnswer = { found: true, confidence: "high", sourceText: "Ser interior" }; });
  await highlight(page, "en", "Inner Being");
  await entryButton(page, "en").click();
  await expect(dialog(page).locator('[data-editor-glossary-entry-field="sourceTerm"]')).toHaveValue("Ser interior");
  await expect(dialog(page).locator('[data-editor-glossary-entry-field="targetTerm"]')).toHaveValue("");
  await expect(dialog(page)).toContainText("Highlighted in English");
  await expect(dialog(page).getByRole("button", { name: "Research meanings" })).toHaveAttribute("data-tooltip",
    "Use AI to investigate the meaning of the source term and suggest target language translations");

  await dialog(page).getByRole("button", { name: "Research meanings" }).click();
  await expect(page.locator('[data-studio-field="scope.term"]')).toHaveValue("Ser interior");
});

test("text in another language with no source match ends with only Cancel", async ({ page }) => {
  await mountEditor(page);
  await page.evaluate(() => { window.entryAnswer = { found: true, confidence: "high", sourceText: "alma eterna" }; });
  await highlight(page, "en", "highest part");
  await entryButton(page, "en").click();
  await expect(dialog(page)).toContainText("We could not find the Spanish term that corresponds to “highest part”.");
  await expect(dialog(page).getByRole("button")).toHaveText(["Cancel"]);
  await dialog(page).getByRole("button", { name: "Cancel" }).click();
  await expect(dialog(page)).toHaveCount(0);
});
