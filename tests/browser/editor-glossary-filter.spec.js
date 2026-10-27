import { expect, test } from "./test.js";

for (const platform of ["macos", "windows"]) {
  test(`glossary error filter finds unmounted rows and restores scrolling (${platform})`, async ({ page }) => {
    await page.goto(`/?platform=${platform}`);
    await page.waitForFunction(() => typeof window.__gnosisDebug?.mountEditorFixture === "function");
    await page.evaluate(async () => {
      await window.__gnosisDebug.waitForBootstrap();
      await window.__gnosisDebug.mountEditorFixture({
        rowCount: 450,
        glossary: true,
        fieldsByRowId: {
          "fixture-row-0449": { es: "alpha penultimate", vi: "missing" },
          "fixture-row-0450": { es: "alpha last", vi: "missing" },
        },
      });
    });
    const disclosureSave = page.locator(".modal-backdrop").getByRole("button", { name: "Save" });
    if (await disclosureSave.count()) await disclosureSave.click();

    const filter = page.locator("[data-editor-filter-select]");
    await expect(filter).toBeVisible();
    await expect(filter.locator('option[value="has-glossary-error"]')).toHaveText("Has glossary error");
    await expect(page.locator('[data-editor-row-card][data-row-id="fixture-row-0450"]')).toHaveCount(0);

    const scroll = page.locator(".translate-main-scroll");
    await scroll.hover();
    await page.mouse.wheel(0, 1500);
    await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(500);
    // Let the virtual window and row measurements settle before saving the viewport.
    await expect(page.locator('[data-editor-row-card][data-row-id="fixture-row-0001"]')).toHaveCount(0);
    const before = await scroll.evaluate((element) => element.scrollTop);

    await filter.selectOption("has-glossary-error");
    await expect(page.locator("[data-editor-row-card]")).toHaveCount(2);
    await expect(page.locator('[data-editor-row-card][data-row-id="fixture-row-0449"]')).toBeVisible();
    await expect(page.locator('[data-editor-row-card][data-row-id="fixture-row-0450"]')).toBeVisible();
    await expect(page.locator("[data-editor-display-field] .glossary-match-error")).toHaveCount(2);
    await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeLessThan(4);

    const search = page.locator("[data-editor-search-input]");
    await search.fill("penultimate");
    await expect(page.locator("[data-editor-row-card]")).toHaveCount(1);
    await expect(page.locator("[data-editor-row-card]")).toHaveAttribute("data-row-id", "fixture-row-0449");
    await search.fill("");
    await expect(page.locator("[data-editor-row-card]")).toHaveCount(2);

    await filter.selectOption("show-all");
    await expect.poll(async () => Math.abs(await scroll.evaluate((element) => element.scrollTop) - before)).toBeLessThan(48);
  });
}
