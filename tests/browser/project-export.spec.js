import { expect, test } from "./test.js";

async function mountProjectExport(page, multilingual = false, chapterTitles = false, filesPerProject = 3) {
  await page.addInitScript(({ chapterTitles }) => {
    window.__projectExports = [];
    window.__pdfListeners = {};
    window.__titlePreviewRequests = [];
    window.__TAURI__ = {
      core: { invoke: async (command, args) => {
        if (["export_gtms_chapter_file", "inspect_gtms_chapter_pdf_fonts", "start_gtms_chapter_pdf_export", "cancel_gtms_chapter_pdf_export"].includes(command)) {
          window.__projectExports.push({ command, ...args });
        }
        if (command === "start_project_book_title_preview") {
          window.__titlePreviewRequests.push(args.input);
          const escaped = args.input.item.title.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
          const pages = [window.__titlePreviewSvg || `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="420" height="595"><rect width="100%" height="100%" fill="white"/><text x="60" y="120">${escaped}</text></svg>`)}`];
          if (!window.__holdTitlePreview) setTimeout(() => window.__pdfListeners["book-title-preview"]?.({ payload: { requestId: args.input.requestId, pages, error: "" } }), 0);
          return null;
        }
        if (command === "list_wordpress_connections") return window.__wordpressSites ?? [];
        if (command === "load_gtms_chapter_editor_data") {
          if (window.__holdBookPreviewChapter === args.input.chapterId) {
            await new Promise((resolve) => { window.__releaseBookPreview = resolve; });
          }
          return {
          fileTitle: args.input.chapterId, languages: [{ code: "en" }, { code: "vi" }],
          rows: window.__bookHeadingRows?.[args.input.chapterId] ?? (chapterTitles ? [
            { rowId: `${args.input.chapterId}-row`, textStyle: args.input.chapterId.endsWith("-0") ? "heading1" : "paragraph", fields: { en: "English opening heading", vi: "Tiêu đề tiếng Việt" } },
            { rowId: `${args.input.chapterId}-body`, textStyle: "paragraph", fields: { en: "Chapter body", vi: "Nội dung" } },
            { rowId: `${args.input.chapterId}-later`, textStyle: "heading1", fields: { en: "Later heading", vi: "Tiêu đề sau" } },
          ] : [{ rowId: `${args.input.chapterId}-row`, textStyle: "paragraph", fields: { en: `Opening ${args.input.chapterId}`, vi: `Bản dịch ${args.input.chapterId}` } }]),
          };
        }
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
  }, { chapterTitles });
  await page.goto("/?fixture=editor&rows=1");
  await page.waitForFunction(() => typeof window.__gnosisDebug?.mountProjectsFixture === "function");
  await page.evaluate(async ({ multilingual, filesPerProject }) => {
    await window.__gnosisDebug.mountProjectsFixture({
      projectCount: 1, filesPerProject, deletedFilesPerProject: 1,
      languages: [{ code: "en", name: "English", role: "target" }],
      ...(multilingual ? { languagesByFileIndex: [
        [{ code: "en", name: "English", role: "target" }, { code: "vi", name: "Vietnamese", role: "target" }],
        [{ code: "en", name: "English", role: "target" }],
        [{ code: "vi", name: "Vietnamese", role: "target" }],
      ] } : {}),
    });
  }, { multilingual, filesPerProject });
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
  const cancelBox = await modal.getByRole("button", { name: "Cancel", exact: true }).boundingBox();
  const nextBox = await modal.getByRole("button", { name: "Next", exact: true }).boundingBox();
  expect(Math.abs(cancelBox.y + cancelBox.height / 2 - nextBox.y - nextBox.height / 2)).toBeLessThan(1);
  expect(cancelBox.x + cancelBox.width).toBeLessThan(nextBox.x);
  await expect(modal.locator("footer")).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("book-composer-top-actions.png") });
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

test("background project refresh draws once and retains an unrelated export dialog", async ({ page }) => {
  await mountProjectExport(page);
  const modal = page.getByRole("dialog", { name: "Export project", exact: true });
  await expect(modal.locator(".book-page--chapter")).toBeVisible();
  await addSection(modal, "title");
  const title = modal.locator('.book-page--title [data-book-field="title"]');
  await title.fill("My draft title");
  await title.evaluate((element) => element.setSelectionRange(3, 8));
  await page.evaluate(async () => {
    const { state } = await import("/app/state.js");
    const { createProjectsQuerySnapshot, applyProjectsQuerySnapshotToState } = await import("/app/project-query.js");
    window.__refreshProjects = structuredClone(state.projects);
    window.__refreshPage = document.querySelector("#app").firstElementChild;
    window.__refreshModal = document.querySelector('[data-modal-dialog="editor-export"]');
    window.__refreshTitle = document.querySelector('.book-page--title [data-book-field="title"]');
    const scroll = document.querySelector(".book-composer__page-scroll");
    scroll.scrollTop = 72;
    window.__refreshScroll = scroll.scrollTop;
    window.__refreshDraws = { page: 0, modal: 0 };
    new MutationObserver((records) => {
      for (const record of records) for (const node of record.removedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.matches('.screen--page')) window.__refreshDraws.page++;
        if (node.matches('[data-modal-dialog="editor-export"]') || node.querySelector('[data-modal-dialog="editor-export"]')) window.__refreshDraws.modal++;
      }
    }).observe(document.querySelector("#app"), { childList: true });
    window.__publishProjectsRefresh = (fetching, change = "") => {
      const projects = structuredClone(window.__refreshProjects);
      if (change === "other") projects.push({ ...projects[0], id: "other", name: "other", title: "Other project", chapters: [] });
      if (change === "active") projects[0].title = "Updated project";
      applyProjectsQuerySnapshotToState(createProjectsQuerySnapshot({ items: projects, discovery: { status: "ready" } }), {
        teamId: state.selectedTeamId, isFetching: fetching,
      });
      window.__gnosisDebug.renderProjectsBackground();
    };
  });
  await page.evaluate(() => {
    for (let i = 0; i < 8; i++) window.__publishProjectsRefresh(true, i % 2 ? "active" : "other");
  });
  expect(await page.evaluate(() => ({
    draws: window.__refreshDraws,
    page: document.querySelector("#app").firstElementChild === window.__refreshPage,
    title: document.activeElement === window.__refreshTitle,
    selection: [window.__refreshTitle.selectionStart, window.__refreshTitle.selectionEnd],
  }))).toEqual({ draws: { page: 0, modal: 0 }, page: true, title: true, selection: [3, 8] });

  // No net change, even though intermediate snapshots changed this project.
  await page.evaluate(() => { window.__publishProjectsRefresh(false); window.__publishProjectsRefresh(false); });
  expect(await page.evaluate(() => window.__refreshDraws)).toEqual({ page: 0, modal: 0 });

  // Another project changes: redraw the list once, retain the focused dialog.
  await page.evaluate(() => {
    window.__publishProjectsRefresh(true, "other");
    window.__publishProjectsRefresh(false, "other");
    window.__publishProjectsRefresh(false, "other");
  });
  expect(await page.evaluate(() => ({
    draws: window.__refreshDraws,
    sameDialog: document.querySelector('[data-modal-dialog="editor-export"]') === window.__refreshModal,
    title: document.activeElement === window.__refreshTitle,
    selection: [window.__refreshTitle.selectionStart, window.__refreshTitle.selectionEnd],
    scrollUnchanged: document.querySelector(".book-composer__page-scroll").scrollTop === window.__refreshScroll,
  }))).toEqual({ draws: { page: 1, modal: 0 }, sameDialog: true, title: true, selection: [3, 8], scrollUnchanged: true });
  await expect(title).toHaveValue("My draft title");

  // This project changes: one final dialog redraw, with the draft preserved.
  await page.evaluate(() => {
    window.__publishProjectsRefresh(true, "active");
    window.__publishProjectsRefresh(true, "active");
    window.__publishProjectsRefresh(false, "active");
    window.__publishProjectsRefresh(false, "active");
  });
  expect(await page.evaluate(() => window.__refreshDraws)).toEqual({ page: 2, modal: 1 });
  await expect(title).toHaveValue("My draft title");
  await modal.getByRole("button", { name: "Next", exact: true }).click();
  await expect(modal.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
});

test("background migration progress updates without rebuilding the projects page or export", async ({ page }) => {
  await mountProjectExport(page);
  await expect(page.locator(".book-page--chapter")).toBeVisible();
  await page.evaluate(async () => {
    const { state } = await import("/app/state.js");
    window.__migrationPage = document.querySelector("#app").firstElementChild;
    window.__migrationExport = document.querySelector('[data-modal-dialog="editor-export"]');
    state.projectsPage.isRefreshing = true;
    state.teamResourceMigrationModal = { isOpen: true, message: "Preparing migration…" };
    window.__gnosisDebug.renderProjectsBackground();
  });
  const progress = page.locator('[data-modal-dialog="team-resource-migration"]');
  await expect(progress).toContainText("Preparing migration…");
  await page.evaluate(async () => {
    const { state } = await import("/app/state.js");
    state.teamResourceMigrationModal.message = "Synchronizing project…";
    window.__gnosisDebug.renderProjectsBackground();
  });
  await expect(progress).toContainText("Synchronizing project…");
  expect(await page.evaluate(() => ({
    page: document.querySelector("#app").firstElementChild === window.__migrationPage,
    modal: document.querySelector('[data-modal-dialog="editor-export"]') === window.__migrationExport,
  }))).toEqual({ page: true, modal: true });
});

test("book contents include H1 headings only when the saved checkbox is selected", async ({ page }) => {
  await mountProjectExport(page);
  const modal = page.getByRole("dialog", { name: "Export project", exact: true });
  await page.evaluate(() => {
    window.__bookHeadingRows = Object.fromEntries([0, 1, 2].map((index) => [
      `fixture-chapter-0-${index}`, [
        { rowId: `title-${index}`, textStyle: "heading1", fields: { en: `Promoted title ${index}` } },
        { rowId: `body-${index}`, textStyle: "paragraph", fields: { en: "Opening paragraph." } },
        { rowId: `h1-${index}`, textStyle: "heading1", fields: { en: `Inside chapter ${index}` } },
        { rowId: `h2-${index}`, textStyle: "heading2", fields: { en: `Second-level heading ${index}` } },
      ],
    ]));
  });
  await addSection(modal, "contents");
  const checkbox = modal.getByRole("checkbox", { name: "Include H1 headings", exact: true });
  await expect(checkbox).not.toBeChecked();
  await expect(modal.locator(".book-contents__subheading")).toHaveCount(0);
  await checkbox.check();
  await expect(modal.locator(".book-contents__subheading")).toHaveCount(3);
  await expect(modal.locator(".book-contents")).toContainText("Inside chapter 0");
  await expect(modal.locator(".book-contents__subheading")).toHaveText(["Inside chapter 0", "Inside chapter 1", "Inside chapter 2"]);
  await expect(modal.locator(".book-contents")).toContainText("1. Promoted title 0");
  await expect(modal.locator(".book-contents")).not.toContainText("Second-level heading");
  await modal.locator('[data-action="book-exclude:fixture-chapter-0-2"]').click();
  await expect(modal.locator(".book-contents__subheading")).toHaveCount(2);
  await page.evaluate(() => { window.__bookHeadingRows["fixture-chapter-0-2"][2].fields.en = "Updated inside chapter 2"; });
  await modal.locator('[data-action="book-include:fixture-chapter-0-2"]').click();
  await expect(modal.locator(".book-contents")).toContainText("Updated inside chapter 2");
  await modal.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.locator('[data-action="export-project:fixture-project-001"]').click();
  await expect(checkbox).toBeChecked();
  await expect(modal.locator(".book-contents__subheading")).toHaveCount(3);
  await page.screenshot({ path: test.info().outputPath("book-contents-headings.png") });
  await modal.getByRole("button", { name: "Next", exact: true }).click();
  await modal.locator('[data-action="select-editor-export-option:file:pdf"]').click();
  await modal.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__projectExports.some((call) => call.command === "start_gtms_chapter_pdf_export"))).toBe(true);
  const contents = await page.evaluate(() => window.__projectExports.findLast((call) => call.command === "start_gtms_chapter_pdf_export").input.bookItems.find((item) => item.kind === "contents"));
  expect(contents.includeH1Headings).toBe(true);
});

test("editing adjacent chapter titles keeps focus and long-list scroll through preview loads", async ({ page }) => {
  await mountProjectExport(page, false, false, 40);
  const modal = page.getByRole("dialog", { name: "Export project", exact: true });
  await expect.poll(() => page.evaluate(async () => {
    const { state } = await import("/app/state.js");
    return state.editorChapter.exportModal.book.previewCache.size;
  })).toBe(40);
  await page.evaluate(async () => {
    const { state } = await import("/app/state.js");
    await Promise.all(state.editorChapter.exportModal.book.previewCache.values());
  });
  const first = modal.locator('[data-book-chapter-title="fixture-chapter-0-24"]');
  const next = modal.locator('[data-book-chapter-title="fixture-chapter-0-25"]');
  await first.scrollIntoViewIfNeeded();
  await first.click();
  await first.fill("Edited chapter 25");
  await expect(next).toBeInViewport();
  const before = await modal.locator(".book-composer__list").evaluate((list) => {
    window.__chapterTitleList = list;
    window.__chapterTitleInput = list.querySelector('[data-book-chapter-title="fixture-chapter-0-25"]');
    return list.scrollTop;
  });
  expect(before).toBeGreaterThan(0);
  await next.click();
  await expect(next).toBeFocused();
  await expect(modal.locator(".book-chapter__number")).toHaveText("26");
  const readList = () => page.evaluate(() => ({
    sameList: document.querySelector(".book-composer__list") === window.__chapterTitleList,
    sameInput: document.querySelector('[data-book-chapter-title="fixture-chapter-0-25"]') === window.__chapterTitleInput,
    scrollTop: document.querySelector(".book-composer__list").scrollTop,
  }));
  expect(await readList()).toEqual({ sameList: true, sameInput: true, scrollTop: before });
  await next.fill("Edited chapter 26");
  await next.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(next).toBeFocused();
  expect(await readList()).toEqual({ sameList: true, sameInput: true, scrollTop: before });

  // Also exercise a chapter whose preview must finish asynchronously.
  await page.evaluate(async () => {
    const { state } = await import("/app/state.js");
    state.editorChapter.exportModal.book.previewCache.delete("fixture-chapter-0-26");
    window.__holdBookPreviewChapter = "fixture-chapter-0-26";
  });
  const third = modal.locator('[data-book-chapter-title="fixture-chapter-0-26"]');
  await expect(third).toBeInViewport();
  await third.click();
  await expect(third).toBeFocused();
  await expect(modal.locator(".book-composer__page-scroll")).toContainText("Loading chapter preview");
  expect(await readList()).toEqual({ sameList: true, sameInput: true, scrollTop: before });
  await page.evaluate(() => window.__releaseBookPreview());
  await expect(modal.locator(".book-chapter__number")).toHaveText("27");
  await expect(third).toBeFocused();
  expect(await readList()).toEqual({ sameList: true, sameInput: true, scrollTop: before });
  await expect(first).toHaveValue("Edited chapter 25");
  await expect(next).toHaveValue("Edited chapter 26");
});

test("title form keeps edits and Enter breaks beside a live PDF preview", async ({ page }) => {
  await mountProjectExport(page);
  const modal = page.getByRole("dialog", { name: "Export project", exact: true });
  await addSection(modal, "title");
  const title = modal.getByRole("textbox", { name: "Title", exact: true });
  await title.fill("Hôn Nhân Hoàn Hảo");
  await modal.getByRole("textbox", { name: "Subtitle", exact: true }).fill("Bí mật về tình yêu và tâm linh");
  await expect(modal.getByRole("img", { name: "Title page PDF preview", exact: true })).toBeVisible();
  await title.focus();
  await title.evaluate((element) => { window.__titleEditor = element; element.setSelectionRange(8, 9); });
  await title.press("Enter");
  await expect(title).toHaveValue("Hôn Nhân\nHoàn Hảo");
  await expect(modal).toContainText("1 of 2");
  await expect.poll(() => page.evaluate(() => window.__titlePreviewRequests.at(-1)?.item.title)).toBe("Hôn Nhân\nHoàn Hảo");
  await expect(modal.locator("[data-book-title-proof]")).toHaveAttribute("aria-busy", "false");
  expect(await title.evaluate((element) => ({ same: element === window.__titleEditor, focused: document.activeElement === element, caret: element.selectionStart }))).toEqual({ same: true, focused: true, caret: 9 });
  const formBox = await modal.getByRole("region", { name: "Title page details", exact: true }).boundingBox();
  const proofBox = await modal.getByRole("region", { name: "Title page PDF preview", exact: true }).boundingBox();
  expect(formBox.x + formBox.width).toBeLessThanOrEqual(proofBox.x + 1);
  await chooseBookOption(modal, "editor-export-paper-size", "A5 (148 × 210 mm)");
  await expect.poll(() => page.evaluate(() => window.__titlePreviewRequests.at(-1)?.paperSize)).toBe("a5");
  await page.screenshot({ path: test.info().outputPath("title-form-live-preview.png") });
  await modal.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.locator('[data-action="export-project:fixture-project-001"]').click();
  await expect(title).toHaveValue("Hôn Nhân\nHoàn Hảo");
  await expect(modal.locator("[data-editor-export-paper-size-select]")).toHaveValue("a5");
  await modal.getByRole("button", { name: "Next", exact: true }).click();
  await modal.getByRole("button", { name: "Save", exact: true }).click();
  expect(await page.evaluate(() => window.__projectExports.at(-1).input.bookItems.find((item) => item.kind === "title").title)).toBe("Hôn Nhân\nHoàn Hảo");
});

test("late title previews do not overwrite new edits and failed previews can retry", async ({ page }) => {
  await mountProjectExport(page);
  const modal = page.getByRole("dialog", { name: "Export project", exact: true });
  await page.evaluate(() => { window.__holdTitlePreview = true; });
  await addSection(modal, "title");
  const title = modal.getByRole("textbox", { name: "Title", exact: true });
  await title.fill("Old title");
  await expect.poll(() => page.evaluate(() => window.__titlePreviewRequests.at(-1)?.item.title)).toBe("Old title");
  await title.fill("New title");
  await expect.poll(() => page.evaluate(() => window.__titlePreviewRequests.at(-1)?.item.title)).toBe("New title");
  await page.evaluate(() => {
    const old = window.__titlePreviewRequests.find((entry) => entry.item.title === "Old title");
    window.__pdfListeners["book-title-preview"]({ payload: { requestId: old.requestId, error: "Old failure", pages: [] } });
  });
  await expect(modal).not.toContainText("Old failure");
  await expect(title).toBeFocused();
  await page.evaluate(() => {
    const latest = window.__titlePreviewRequests.at(-1);
    window.__pdfListeners["book-title-preview"]({ payload: { requestId: latest.requestId, error: "Font not ready", pages: [] } });
  });
  await expect(modal).toContainText("Font not ready");
  await page.evaluate(() => { window.__holdTitlePreview = false; });
  await modal.getByRole("button", { name: "Retry preview", exact: true }).click();
  await expect(modal.getByRole("img", { name: "Title page PDF preview", exact: true })).toBeVisible();
  await expect(title).toHaveValue("New title");
});

test("Enter finishes and saves a chapter title without advancing the export modal", async ({ page }) => {
  await mountProjectExport(page);
  const modal = page.getByRole("dialog", { name: "Export project", exact: true });
  const title = modal.locator('[data-book-chapter-title="fixture-chapter-0-0"]');
  await title.click();
  await title.fill("A title saved with Enter");
  // Return used to confirm an IME composition must leave the field focused.
  await title.dispatchEvent("keydown", { key: "Enter", isComposing: true, bubbles: true });
  await expect(title).toBeFocused();
  const before = await modal.locator(".book-composer__list").evaluate((list) => {
    window.__enterTitleList = list;
    return list.scrollTop;
  });
  await title.press("Enter");
  await expect(title).not.toBeFocused();
  await expect(title).toHaveValue("A title saved with Enter");
  await expect(modal.locator(".book-step")).toContainText("1 of 2");
  expect(await page.evaluate(() => ({
    sameList: document.querySelector(".book-composer__list") === window.__enterTitleList,
    scrollTop: document.querySelector(".book-composer__list").scrollTop,
    exports: window.__projectExports.length,
  }))).toEqual({ sameList: true, scrollTop: before, exports: 0 });
  await modal.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.locator('[data-action="export-project:fixture-project-001"]').click();
  await expect(title).toHaveValue("A title saved with Enter");
});

test("chapter export titles use opening H1s, edit inline, and persist independently by language", async ({ page }) => {
  await mountProjectExport(page, true, true);
  const modal = page.getByRole("dialog", { name: "Export project", exact: true });
  const first = modal.locator('[data-book-chapter-title="fixture-chapter-0-0"]');
  const second = modal.locator('[data-book-chapter-title="fixture-chapter-0-1"]');
  await expect(first).toHaveValue("English opening heading");
  // A later H1 must not replace the filename when the file opens with prose.
  await expect(second).toHaveValue("File 002");
  await first.click();
  await first.fill("");
  await first.pressSequentially("Custom English Title");
  await expect(first).toBeFocused();
  await expect(first).toHaveValue("Custom English Title");
  await expect(modal.locator(".book-page--chapter h1").first()).toHaveText("Custom English Title");
  await expect(modal.locator(".book-chapter__number")).toHaveText("1");
  await expect(modal.locator(".book-page--chapter")).not.toContainText("English opening heading");
  await second.click();
  await expect(second).toBeFocused();
  await second.fill("A renamed chapter");
  await expect(modal.locator(".book-page--chapter h1").first()).toHaveText("A renamed chapter");
  await expect(modal.locator(".book-chapter__number")).toHaveText("2");
  await chooseBookOption(modal, "editor-export-language", "Vietnamese (vi)");
  await expect(first).toHaveValue("Tiêu đề tiếng Việt");
  await first.fill("Tên chương tùy chỉnh");
  await chooseBookOption(modal, "editor-export-language", "English (en)");
  await expect(first).toHaveValue("Custom English Title");
  await expect(second).toHaveValue("A renamed chapter");
  await addSection(modal, "contents");
  await expect(modal.locator(".book-contents")).toContainText("1. Custom English Title");
  await expect(modal.locator(".book-contents")).toContainText("2. A renamed chapter");
  await modal.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.locator('[data-action="export-project:fixture-project-001"]').click();
  await expect(first).toHaveValue("Custom English Title");
  await chooseBookOption(modal, "editor-export-language", "Vietnamese (vi)");
  await expect(first).toHaveValue("Tên chương tùy chỉnh");
  await chooseBookOption(modal, "editor-export-language", "English (en)");
  await first.click();
  await page.screenshot({ path: test.info().outputPath("editable-chapter-titles.png") });
  await modal.getByRole("button", { name: "Next", exact: true }).click();
  await modal.locator('[data-action="select-editor-export-option:file:docx"]').click();
  await modal.getByRole("button", { name: "Save", exact: true }).click();
  await expect(modal).toBeHidden();
  const exported = await page.evaluate(() => window.__projectExports.find((call) => call.command === "export_gtms_chapter_file"));
  expect(exported.input.bookItems.filter((item) => item.kind === "chapter").map((item) => item.titleOverride)).toEqual(["Custom English Title", "A renamed chapter"]);
});
async function dragBefore(page, source, target) {
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + 30, to.y + 4, { steps: 10 });
  await page.mouse.up();
}

test("front matter keeps Return paragraphs distinct from Shift+Return line breaks", async ({ page }) => {
  await mountProjectExport(page);
  const modal = page.getByRole("dialog", { name: "Export project", exact: true });
  for (const kind of ["copyright", "dedication"]) {
    await addSection(modal, kind);
    const editor = modal.locator("[data-book-copyright-editor]");
    await editor.click();
    await page.keyboard.insertText("First paragraph");
    await page.keyboard.press("Enter");
    await page.keyboard.insertText("Second paragraph");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.insertText("soft line");
    const itemId = await modal.locator(".book-item.is-selected").getAttribute("data-book-item");
    const saved = await page.evaluate(async (id) => {
      const { state } = await import("/app/state.js");
      return state.editorChapter.exportModal.book.items.find((item) => item.id === id).text;
    }, itemId);
    expect(saved).toBe("First paragraph\nSecond paragraph\u2028soft line");
    const spacing = await editor.evaluate((element) => {
      const style = getComputedStyle(element);
      return { line: parseFloat(style.lineHeight) / parseFloat(style.fontSize), paragraph: parseFloat(getComputedStyle(element.firstElementChild).marginBottom) / parseFloat(style.fontSize) };
    });
    expect(spacing).toEqual({ line: 1.25, paragraph: .75 });
    await modal.locator('[data-action="book-select:fixture-chapter-0-0"]').click();
    await modal.locator(`[data-action="book-select:${itemId}"]`).click();
    await expect(editor.locator(":scope > p")).toHaveCount(2);
    await expect(editor.locator("p").nth(1).locator("br")).toHaveCount(1);
    const blocks = await page.evaluate(async (id) => {
      const { state } = await import("/app/state.js");
      const { loadProjectExportBlocks } = await import("/app/project-export-context.js");
      return (await loadProjectExportBlocks(state.editorChapter.exportModal)).filter((block) => block.bookItemId === id);
    }, itemId);
    expect(blocks.map((block) => block.text)).toEqual(["First paragraph", "Second paragraph\nsoft line"]);
    await editor.selectText();
    await editor.evaluate((element) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", "Pasted first\nPasted second");
      element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
    });
    await expect(editor.locator(":scope > p")).toHaveCount(2);
    const pasted = await page.evaluate(async (id) => {
      const { state } = await import("/app/state.js");
      return state.editorChapter.exportModal.book.items.find((item) => item.id === id).text;
    }, itemId);
    expect(pasted).toBe("Pasted first\nPasted second");
  }
});

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
