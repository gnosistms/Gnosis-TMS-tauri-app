import { expect, test } from "./test.js";

for (const aiLatest of [true, false]) {
  test(`unchanged-text history groups expand and credit the latest ${aiLatest ? "AI" : "human"}`, async ({ page }) => {
    await page.addInitScript((aiLatest) => {
      const entry = (commitSha, overrides = {}) => ({
        commitSha,
        authorName: "translator",
        authorLogin: "translator",
        authorEmail: "translator@users.noreply.github.com",
        committedAt: "2026-11-06T00:00:00Z",
        operationType: "field-status",
        plainText: "Current translation",
        footnote: "",
        reviewed: false,
        pleaseCheck: false,
        textStyle: "paragraph",
        ...overrides,
      });
      const entries = [
        entry("latest", { aiModel: aiLatest ? "gpt-5.4" : null, reviewed: true }),
        entry("middle", { aiModel: aiLatest ? null : "gpt-5.4", pleaseCheck: true }),
        entry("oldest", { operationType: "editor-update" }),
        entry("previous-text", { plainText: "Previous translation", reviewed: true }),
      ];
      window.__TAURI__ = {
        event: { listen: async () => () => {} },
        core: { invoke: async (command) => {
          if (command === "plugin:app|version") return "0.8.146";
          if (command === "load_gtms_editor_field_history") return { entries: structuredClone(entries) };
          if (command === "check_internet_connection") return true;
          if (command.startsWith("list_")) return [];
          return null;
        } },
      };
      localStorage.clear();
    }, aiLatest);

    await page.goto("/");
    await page.waitForFunction(() => typeof window.__gnosisDebug?.mountEditorFixture === "function");
    await page.evaluate(async () => {
      await window.__gnosisDebug.waitForBootstrap();
      await window.__gnosisDebug.mountEditorFixture({
        rowCount: 2,
        fieldsByRowId: { "fixture-row-0001": { es: "Source", vi: "Current translation" } },
      });
    });
    const disclosureSave = page.locator(".modal-backdrop").getByRole("button", { name: "Save" });
    if (await disclosureSave.count()) await disclosureSave.click();
    await page.locator('[data-editor-display-field][data-row-id="fixture-row-0001"][data-language-code="vi"]').click();
    await page.getByRole("button", { name: "History", exact: true }).click();

    const groups = page.locator(".history-stack .history-group");
    await expect(groups).toHaveCount(2);
    const group = groups.first();
    const toggle = group.locator("button.history-group__toggle");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(group.locator(".history-group__author")).toHaveText(aiLatest ? "GPT 5.4 - translator" : "translator");
    await expect(group.locator(".history-group__meta")).toHaveText("3 revisions");
    await expect(group.locator(".history-item")).toHaveCount(1);
    await expect(group.locator(".history-item__author")).toHaveCount(0);

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(group.locator(".history-item")).toHaveCount(3);
    await expect(group.locator(".history-item__author")).toHaveText([
      aiLatest ? "GPT 5.4 - translator" : "translator",
      aiLatest ? "translator" : "GPT 5.4 - translator",
      "translator",
    ]);
    await expect(group.locator(".history-item__unchanged")).toHaveText(["Text unchanged.", "Text unchanged."]);
    await expect(group.locator(".history-item").nth(0).locator(".history-item__content-stack")).toHaveCount(0);
    await expect(group.locator(".history-item").nth(1).locator(".history-item__content-stack")).toHaveCount(0);
    await expect(group.locator(".history-item").nth(2).locator(".history-item__content-stack")).toContainText("Current translation");
    const fonts = await group.locator(".history-item__unchanged").first().evaluate((element) => ({
      actual: getComputedStyle(element).fontFamily,
      expected: getComputedStyle(document.documentElement).getPropertyValue("--font-sans").trim(),
    }));
    expect(fonts.actual).toBe(fonts.expected);
    await expect(group.locator('[data-action="restore-editor-history:middle"]')).toBeVisible();
    await expect(group.locator(".history-item").last().getByRole("button", { name: "Current", exact: true })).toBeDisabled();

    for (const kind of ["reviewed", "please-check"]) {
      const enabled = group.locator(`.history-item__marker-note-icon--${kind}:not(.history-item__marker-note-icon--removed)`).first();
      const removed = group.locator(`.history-item__marker-note-icon--${kind}.history-item__marker-note-icon--removed`).first();
      await expect(enabled.locator(".translation-marker-button__active-fill")).toHaveCSS("display", "block");
      await expect(enabled.locator(".translation-marker-button__glyph").first()).toHaveCSS("display", "none");
      await expect(removed.locator(".translation-marker-button__active-fill")).toHaveCSS("display", "none");
      await expect(removed.locator(".translation-marker-button__glyph").first()).not.toHaveCSS("display", "none");
    }

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(group.locator(".history-item")).toHaveCount(1);
    await expect(group.locator(".history-item__author")).toHaveCount(0);
    await expect(group.locator(".history-item__unchanged")).toHaveCount(0);
    await expect(groups.nth(1)).toContainText("Previous translation");
  });
}
