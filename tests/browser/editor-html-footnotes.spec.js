import { expect, test } from "@playwright/test";
import { serializeEditorPreviewHtml } from "../../src-ui/app/editor-preview.js";

function exportedChapter() {
  const paragraph = (rowId, text, footnotes = []) => ({
    kind: "text", rowId, text, footnotes, languageCode: "en", textStyle: "paragraph",
  });
  return serializeEditorPreviewHtml([
    paragraph("opening", "Opening passage[1]. Another citation[1].", [
      { marker: 1, text: "A shared note with <em>emphasis</em>." },
    ]),
    ...Array.from({ length: 35 }, (_, index) => paragraph(`body-${index}`,
      "Reading text between the citation and the collected footnotes. ".repeat(4))),
    paragraph("closing", "Closing passage[1].", [{ marker: 1, text: "A different note." }]),
  ]);
}

test("exported HTML footnotes navigate both ways by keyboard and pointer without scripts", async ({ page }) => {
  // This is the HTML clipboard payload in a standalone reader, with no TMS UI,
  // WordPress metadata, or scripts to implement the navigation.
  await page.setContent(`<!doctype html><html lang="en"><head><title>Footnote export</title></head><body>${exportedChapter()}</body></html>`);
  const references = page.locator('[role="doc-noteref"]');
  const notes = page.locator('[role="doc-endnotes"] li');
  await expect(references).toHaveCount(3);
  await expect(notes).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "Footnotes" })).toBeVisible();
  await expect(notes.first().locator("em")).toHaveText("emphasis");

  // Every exported fragment link has exactly one target, including backlinks.
  const brokenLinks = await page.locator('a[href^="#"]').evaluateAll((links) => links
    .filter((link) => document.querySelectorAll(`[id="${link.hash.slice(1)}"]`).length !== 1)
    .map((link) => link.outerHTML));
  expect(brokenLinks).toEqual([]);

  await references.first().focus();
  await page.keyboard.press("Enter");
  await expect(notes.first()).toBeFocused();
  await expect(notes.first()).toBeInViewport();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Back to reference 1 for footnote 1" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(references.first()).toBeFocused();
  await expect(references.first()).toBeInViewport();
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(100);

  // A second occurrence returns to its own citation, not the first one.
  await references.nth(1).click();
  await expect(notes.first()).toBeInViewport();
  await page.getByRole("link", { name: "Back to reference 2 for footnote 1" }).click();
  await expect(references.nth(1)).toBeFocused();
  await expect(references.nth(1)).toBeInViewport();

  await references.nth(2).click();
  await expect(notes.nth(1)).toBeFocused();
  await page.getByRole("link", { name: "Back to footnote reference 2" }).click();
  await expect(references.nth(2)).toBeFocused();
});
