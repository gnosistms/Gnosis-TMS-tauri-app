import { expect, test } from "./test.js";

async function mountProjectExport(page, multilingual = false) {
  await page.addInitScript(() => {
    window.__projectExports = [];
    window.__pdfListeners = {};
    window.__TAURI__ = {
      core: { invoke: async (command, args) => {
        if (["export_gtms_chapter_file", "inspect_gtms_chapter_pdf_fonts", "start_gtms_chapter_pdf_export", "cancel_gtms_chapter_pdf_export"].includes(command)) {
          window.__projectExports.push({ command, ...args });
        }
        if (command === "list_wordpress_connections") return window.__wordpressSites ?? [];
        if (command === "load_gtms_chapter_editor_data") return {
          fileTitle: args.input.chapterId, languages: [{ code: "en" }, { code: "vi" }],
          rows: [{ rowId: `${args.input.chapterId}-row`, textStyle: "paragraph", fields: { en: `Opening ${args.input.chapterId}`, vi: `Bản dịch ${args.input.chapterId}` } }],
        };
        if (command === "import_project_book_image") {
          if (args.input.fileName === "bad.png") throw new Error("The selected file is not a valid image.");
          return { assetId: "book-test.png", filePath: `data:image/png;base64,${args.input.dataBase64}`, fileName: args.input.fileName };
        }
        if (command === "inspect_gtms_chapter_pdf_fonts") {
          if (window.__holdPdfInspection) await new Promise((resolve) => { window.__resolvePdfInspection = resolve; });
          return { supported: true, fontFamilies: [], missingBytes: 0, requiredBytes: 0 };
        }
        return null;
      } },
      dialog: { save: async () => "/tmp/project-book-export.pdf" },
      event: { listen: async (name, callback) => {
        window.__pdfListeners[name] = callback;
        return () => {};
      } },
    };
  });
  await page.goto("/?fixture=editor&rows=1");
  await page.waitForFunction(() => typeof window.__gnosisDebug?.mountProjectsFixture === "function");
  await page.evaluate(async (multilingual) => {
    await window.__gnosisDebug.mountProjectsFixture({
      projectCount: 1, filesPerProject: 3, deletedFilesPerProject: 1,
      languages: [{ code: "en", name: "English", role: "target" }],
      ...(multilingual ? { languagesByFileIndex: [
        [{ code: "en", name: "English", role: "target" }, { code: "vi", name: "Vietnamese", role: "target" }],
        [{ code: "en", name: "English", role: "target" }],
        [{ code: "vi", name: "Vietnamese", role: "target" }],
      ] } : {}),
    });
  }, multilingual);
  const initialModal = page.locator(".modal-backdrop");
  if (await initialModal.count()) await initialModal.getByRole("button", { name: "Save", exact: true }).click();
  await page.locator('[data-action="export-project:fixture-project-001"]').click();
}

test("project card export saves all active files through the shared dialog", async ({ page }) => {
  await mountProjectExport(page);
  const modal = page.getByRole("dialog", { name: "Export project", exact: true });
  await expect(modal).toBeVisible();
  await expect(modal).toContainText("Arrange your book");
  await expect(modal.getByRole("button", { name: "Cancel", exact: true })).toBeInViewport();
  await expect(modal.locator('[data-book-included="true"]')).toHaveCount(3);
  await expect(modal.locator("[data-editor-export-language-select]")).toHaveValue("en");
  await modal.getByRole("button", { name: "Next", exact: true }).click();
  await modal.getByRole("button", { name: "Save", exact: true }).click();
  await expect(modal).toBeHidden();
  const exported = await page.evaluate(() => window.__projectExports[0]);
  expect(exported.command).toBe("export_gtms_chapter_file");
  expect(exported.input.chapterIds).toEqual(["fixture-chapter-0-0", "fixture-chapter-0-1", "fixture-chapter-0-2"]);
  expect(exported.input.projectTitle).toBe("Fixture Project 001");
});

test("project PDF export inspects the entire book and exposes cancellation", async ({ page }) => {
  await mountProjectExport(page);
  const modal = page.getByRole("dialog", { name: "Export project", exact: true });
  await page.evaluate(() => { window.__holdPdfInspection = true; });
  await modal.getByRole("button", { name: "Next", exact: true }).click();
  await modal.locator('[data-action="select-editor-export-option:file:pdf"]').click();
  await modal.getByRole("button", { name: "Previous", exact: true }).click();
  await modal.getByRole("button", { name: "Next", exact: true }).click();
  const save = modal.getByRole("button", { name: "Save", exact: true });
  await expect(save).toBeInViewport();
  await expect(save).toBeDisabled();
  await expect(save).toHaveAttribute("aria-busy", "true");
  await expect(save.locator(".button__spinner")).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof window.__resolvePdfInspection)).toBe("function");
  await page.evaluate(() => { window.__holdPdfInspection = false; window.__resolvePdfInspection(); });
  await expect(save).toBeEnabled();
  await expect(save.locator(".button__spinner")).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("project-export.png") });
  await modal.getByRole("button", { name: "Save", exact: true }).click();
  await expect(modal.getByRole("button", { name: "Cancel export", exact: true })).toBeEnabled();
  await expect.poll(async () => page.evaluate(() => window.__projectExports.map((call) => call.command))).toContain("start_gtms_chapter_pdf_export");
  const calls = await page.evaluate(() => window.__projectExports);
  expect(calls[0].input.chapterIds).toHaveLength(3);
  expect(calls.find((call) => call.command === "start_gtms_chapter_pdf_export").input.chapterIds).toEqual(calls[0].input.chapterIds);
  await modal.getByRole("button", { name: "Cancel export", exact: true }).click();
  await expect.poll(async () => page.evaluate(() => window.__projectExports.at(-1).command)).toBe("cancel_gtms_chapter_pdf_export");
});

async function chooseBookOption(modal, id, label) {
  await modal.locator(`#${id}-trigger`).click();
  await modal.getByRole("option", { name: label, exact: true }).click();
}

test("WordPress forget tooltips stay visible at both ends of the scrolling site list", async ({ page }) => {
  await mountProjectExport(page);
  await page.evaluate(() => {
    window.__wordpressSites = Array.from({ length: 12 }, (_, index) => ({
      siteId: `site-${index}`, displayName: `Site ${index + 1}`, siteUrl: `https://site-${index}.example`,
    }));
  });
  const modal = page.getByRole("dialog", { name: "Export project", exact: true });
  await modal.getByRole("button", { name: "Next", exact: true }).click();
  await modal.locator('[data-action="toggle-editor-export-category:link"]').click();
  await modal.locator('[data-action="select-editor-export-option:link:wordpress"]').click();
  const buttons = page.getByRole("button", { name: "Forget this site", exact: true });
  for (const button of [buttons.first(), buttons.last()]) {
    await button.hover();
    const bounds = await button.evaluate((element) => {
      const style = getComputedStyle(element, "::before");
      // Materialize the pseudo-element with its computed styles so the browser
      // measures its actual box, including padding, border, and transforms.
      const tooltip = document.createElement("span");
      for (const property of style) tooltip.style.setProperty(property, style.getPropertyValue(property));
      tooltip.textContent = element.dataset.tooltip;
      element.append(tooltip);
      const rect = tooltip.getBoundingClientRect().toJSON();
      tooltip.remove();
      const list = element.closest("ul");
      return {
        tooltip: rect, list: list.getBoundingClientRect().toJSON(),
        content: style.content, scrollable: list.scrollHeight > list.clientHeight,
      };
    });
    expect(bounds.content).toBe('"Forget this site"');
    expect(bounds.scrollable).toBe(true);
    expect(bounds.tooltip.top).toBeGreaterThanOrEqual(bounds.list.top);
    expect(bounds.tooltip.bottom).toBeLessThanOrEqual(bounds.list.bottom);
    expect(bounds.tooltip.left).toBeGreaterThanOrEqual(bounds.list.left);
    expect(bounds.tooltip.right).toBeLessThanOrEqual(bounds.list.right);
  }
});

async function addSection(modal, kind) {
  await modal.locator('[data-action="book-add-menu"]').click();
  await modal.locator(`[data-action="book-add:${kind}"]`).click();
}
async function dragBefore(page, source, target) {
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + 30, to.y + 4, { steps: 10 });
  await page.mouse.up();
}

test("book composer saves independent language layouts, sections, and format settings immediately", async ({ page }) => {
  await mountProjectExport(page, true);
  const modal = page.getByRole("dialog", { name: "Export project", exact: true });
  const included = modal.locator('[data-book-included="true"]');
  await expect(included).toHaveCount(2);
  const unavailable = modal.locator('[data-action="book-include:fixture-chapter-0-2"]');
  await expect(unavailable).toBeDisabled();
  await expect(unavailable.locator("..")).toHaveAttribute("data-tooltip", "This chapter does not contain a translation in English.");
  await dragBefore(page, modal.locator('[data-book-item="fixture-chapter-0-1"] [data-book-drag-handle]'), modal.locator('[data-book-item="fixture-chapter-0-0"]'));
  await expect(included.first()).toHaveAttribute("data-book-item", "fixture-chapter-0-1");
  await modal.locator('[data-action="book-exclude:fixture-chapter-0-1"]').click();
  await expect(modal.locator('[data-action="book-include:fixture-chapter-0-1"]')).toBeEnabled();
  await addSection(modal, "title");
  await modal.getByRole("textbox", { name: "Title", exact: true }).fill("English Book");
  await modal.getByRole("textbox", { name: "Author", exact: true }).fill("An Author");
  await modal.getByRole("textbox", { name: "Subtitle", exact: true }).fill("A subtitle");
  await chooseBookOption(modal, "editor-export-language", "Vietnamese (vi)");
  await expect(included).toHaveCount(2);
  await expect(modal.locator('[data-action="book-include:fixture-chapter-0-1"]')).toBeDisabled();
  await addSection(modal, "contents");
  await modal.getByRole("textbox", { name: "Table of Contents", exact: true }).fill("Mục lục");
  await addSection(modal, "copyright");
  const copyright = modal.getByRole("textbox", { name: "Copyright text", exact: true });
  await copyright.fill("All rights reserved.");
  await copyright.selectText();
  await modal.locator('[data-action="book-copyright:italic"]').click();
  await expect(copyright.locator("i")).toContainText("All rights reserved.");
  await page.keyboard.press("ArrowRight");
  await modal.locator('[data-action="book-copyright:symbol"]').click();
  await modal.locator('[data-action="book-copyright:flourish"]').click();
  await expect(copyright.locator("hr")).toHaveCount(1);
  await addSection(modal, "image");
  const chooser = page.waitForEvent("filechooser");
  await modal.locator('[data-action="book-image-pick"]').click();
  await (await chooser).setFiles({ name: "image.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64") });
  await modal.getByRole("textbox", { name: "Enter image caption.", exact: true }).fill("An illustration");
  await expect(modal.locator('.book-image img')).toBeVisible();
  const tocRow = modal.locator('[data-book-item]').filter({ hasText: "Mục lục" });
  const imageRow = modal.locator('[data-book-item]').filter({ hasText: "Full page image" });
  const tocId = await tocRow.getAttribute("data-book-item");
  // Move the image before the contents; TOC now sits at the end of this layout.
  await dragBefore(page, imageRow.locator('[data-book-drag-handle]'), tocRow);
  // Explicitly place contents after the last chapter using its real handle.
  const target = modal.locator('[data-book-item="fixture-chapter-0-2"]');
  const from = await tocRow.locator('[data-book-drag-handle]').boundingBox();
  const to = await target.boundingBox();
  await page.mouse.move(from.x + 12, from.y + 12); await page.mouse.down();
  await page.mouse.move(to.x + 40, to.y + to.height - 3, { steps: 10 }); await page.mouse.up();
  await expect(included.last()).toHaveAttribute("data-book-item", tocId);
  await modal.getByRole("button", { name: "Next", exact: true }).click();
  await modal.locator('[data-action="select-editor-export-option:file:pdf"]').click();
  await chooseBookOption(modal, "editor-export-paper-size", "A5 (148 × 210 mm)");
  await page.screenshot({ path: test.info().outputPath("book-export-options.png") });
  await modal.getByRole("button", { name: "Previous", exact: true }).click();
  await chooseBookOption(modal, "editor-export-language", "English (en)");
  await expect(included).toHaveCount(2); // English title page and one included chapter.
  await modal.locator('[data-action^="book-select:"]').filter({ hasText: "English Book" }).click();
  await expect(modal.getByRole("textbox", { name: "Author", exact: true })).toHaveValue("An Author");
  await modal.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.locator('[data-action="export-project:fixture-project-001"]').click();
  await expect(modal.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("English Book");
  await chooseBookOption(modal, "editor-export-language", "Vietnamese (vi)");
  await expect(included.last()).toHaveAttribute("data-book-item", tocId);
  await page.screenshot({ path: test.info().outputPath("book-composer.png") });
  await modal.getByRole("button", { name: "Next", exact: true }).click();
  await expect(modal.locator('[data-editor-export-paper-size-select]')).toHaveValue("a5");
  await expect(modal.locator('[data-action="select-editor-export-option:file:pdf"]')).toHaveClass(/is-selected/);
  await modal.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__projectExports.some((call) => call.command === "start_gtms_chapter_pdf_export"))).toBe(true);
  const input = await page.evaluate(() => window.__projectExports.findLast((call) => call.command === "start_gtms_chapter_pdf_export").input);
  expect(input.bookItems.at(-1).kind).toBe("contents");
  expect(input.bookItems.at(-1).title).toBe("Mục lục");
  expect(input.bookItems.find((item) => item.kind === "copyright").text).toContain("<i>");
  expect(input.bookItems.find((item) => item.kind === "image").caption).toBe("An illustration");
  expect(input.chapterIds).toEqual(["fixture-chapter-0-0", "fixture-chapter-0-2"]);
});
