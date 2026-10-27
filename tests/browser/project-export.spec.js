import { expect, test } from "./test.js";

async function mountProjectExport(page, multilingual = false, chapterTitles = false, filesPerProject = 3, settings = {}) {
  await page.addInitScript(({ chapterTitles, settings }) => {
    window.__projectExports = [];
    window.__bookSettingsRequests = [];
    window.__remoteBookSettings = settings.remote || null;
    window.__localBookSettings = settings.local || null;
    window.__holdSettingsFetch = settings.holdFetch || false;
    window.__heldSettingsRequests = [];

    window.__pdfListeners = {};
    window.__titlePreviewRequests = [];
    window.__TAURI__ = {
      core: { invoke: async (command, args) => {
        if (["export_gtms_chapter_file", "inspect_gtms_chapter_pdf_fonts", "start_gtms_chapter_pdf_export", "cancel_gtms_chapter_pdf_export"].includes(command)) {
          window.__projectExports.push({ command, ...args });
        }
        if (command === "load_project_export_settings") return { settings: window.__localBookSettings };
        if (command === "start_project_export_settings_sync") {
          window.__bookSettingsRequests.push(args.input);
          if (!args.input.settings && window.__holdSettingsFetch) {
            window.__heldSettingsRequests.push(args.input);
          } else {
            const payload = { requestId: args.input.requestId, settings: args.input.settings || window.__remoteBookSettings, error: window.__settingsError || "" };
            if (args.input.settings && !payload.error) window.__localBookSettings = args.input.settings;
            setTimeout(() => window.__pdfListeners["project-export-settings"]?.({ payload }), 0);
          }
          return null;
        }
        if (command === "start_project_book_title_preview") {
          window.__titlePreviewRequests.push(args.input);
          const escaped = args.input.item.title.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
          const pages = [window.__titlePreviewSvg || `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="420" height="595"><rect width="100%" height="100%" fill="white"/><text x="60" y="120">${escaped}</text></svg>`)}`];
          if (!window.__holdTitlePreview) setTimeout(() => window.__pdfListeners["book-title-preview"]?.({ payload: { requestId: args.input.requestId, pages, error: "" } }), 0);
          return null;
        }
        if (command === "start_project_book_preview_fonts") {
          const payload = { requestId: args.input.requestId, fonts: window.__printFonts || [], profile: {
            bodyFamilies: ["Crimson Pro", "EB Garamond"], headingFamilies: ["Alegreya", "EB Garamond"],
            direction: "ltr", bodySizePt: 11.5, lineHeight: 1.3532421875, frontMatterLineHeight: 1.2532421875,
            headingLineHeight: 1.417, wordSpacingEm: .022, latin: true,
          }, error: "" };
          setTimeout(() => window.__pdfListeners["book-preview-fonts"]?.({ payload }), 0);
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
  }, { chapterTitles, settings });
  await page.goto("/?fixture=editor&rows=1");
  await page.waitForFunction(() => typeof window.__gnosisDebug?.mountProjectsFixture === "function");
  await page.evaluate(async ({ multilingual, filesPerProject }) => {
    await window.__gnosisDebug.mountProjectsFixture({
      projectCount: 1, filesPerProject, deletedFilesPerProject: 1,
      repositoryOwner: "fixture",
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

test("chapter row space previews without editing and only the title text takes a caret", async ({ page }) => {
  await mountProjectExport(page);
  const modal = page.getByRole("dialog", { name: "Export project", exact: true });
  const first = modal.locator('[data-book-chapter-title="fixture-chapter-0-0"]');
  const second = modal.locator('[data-book-chapter-title="fixture-chapter-0-1"]');
  const third = modal.locator('[data-book-chapter-title="fixture-chapter-0-2"]');
  const preview = modal.getByRole("button", { name: "Preview chapter: File 002", exact: true });
  await first.click();
  await first.fill("Edited title");
  await expect(first).toBeFocused();
  const inputBox = await second.boundingBox();
  const buttonBox = await preview.boundingBox();
  expect(buttonBox.x).toBeGreaterThanOrEqual(inputBox.x + inputBox.width - 1);
  expect(buttonBox.width).toBeGreaterThanOrEqual(24);
  await preview.click();
  await expect(modal.locator(".book-chapter__number")).toHaveText("2");
  await expect(preview).toBeFocused();
  await expect(second).not.toBeFocused();
  await expect(first).not.toBeFocused();
  await expect(first).toHaveValue("Edited title");
  await expect(preview).toHaveAttribute("aria-pressed", "true");
  await modal.locator('[data-book-item="fixture-chapter-0-0"] [data-book-chapter-select]').click({ position: { x: 60, y: 2 } });
  await expect(modal.locator(".book-chapter__number")).toHaveText("1");
  await expect(first).not.toBeFocused();
  await expect(modal.getByRole("button", { name: "Preview chapter: File 001", exact: true })).toBeFocused();
  await second.click();
  await expect(second).toBeFocused();
  const before = await second.boundingBox();
  await second.fill("A much longer chapter title that must not cover the separate preview target");
  const after = await second.boundingBox();
  expect(after.width).toBeGreaterThan(before.width);
  const longPreviewBox = await preview.boundingBox();
  expect(longPreviewBox.width).toBeGreaterThanOrEqual(24);
  expect(longPreviewBox.x).toBeGreaterThanOrEqual(after.x + after.width - 1);
  const thirdPreview = modal.getByRole("button", { name: "Preview chapter: File 003", exact: true });
  await thirdPreview.focus();
  await thirdPreview.press("Enter");
  await expect(modal.locator(".book-chapter__number")).toHaveText("3");
  await expect(thirdPreview).toBeFocused();
  await expect(third).not.toBeFocused();
  await expect(modal).toContainText("1 of 2");
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

test("chapter numbers are read-only, optional, consecutive, and saved in the export", async ({ page }) => {
  await mountProjectExport(page);
  const modal = page.getByRole("dialog", { name: "Export project", exact: true });
  const row = (index) => modal.locator(`[data-book-item="fixture-chapter-0-${index}"]`);
  const numbers = () => modal.locator('[data-book-list="included"] [data-book-chapter-number]').allTextContents();
  await expect.poll(numbers).toEqual(["1.", "2.", "3."]);
  await expect(row(0).getByRole("checkbox", { name: "Numbered", exact: true })).toBeChecked();
  await expect(modal.getByRole("checkbox", { name: "Numbered", exact: true })).toHaveCount(1);
  await expect(row(0).locator("[data-book-chapter-title]")).toHaveValue("File 001");
  await expect(row(0).locator("[data-book-chapter-number]")).toHaveJSProperty("isContentEditable", false);
  await row(1).getByRole("button", { name: "Preview chapter: File 002", exact: true }).click();
  const numbered = row(1).getByRole("checkbox", { name: "Numbered", exact: true });
  await expect(numbered).toBeChecked();
  await page.evaluate(() => {
    window.__numberingList = document.querySelector(".book-composer__list");
    window.__numberingCheckbox = document.querySelector('[data-book-numbered-item="fixture-chapter-0-1"]');
  });
  await row(1).getByText("Numbered", { exact: true }).click();
  await expect(numbered).not.toBeChecked();
  await expect(numbered).toBeFocused();
  expect(await page.evaluate(() => document.querySelector(".book-composer__list") === window.__numberingList
    && document.querySelector('[data-book-numbered-item="fixture-chapter-0-1"]') === window.__numberingCheckbox)).toBe(true);
  await expect.poll(numbers).toEqual(["1.", "", "2."]);
  await expect(modal.locator(".book-chapter__number")).toHaveCount(0);
  await expect(row(1).locator("[data-book-chapter-title]")).toHaveValue("File 002");
  await row(2).getByRole("button", { name: "Preview chapter: File 003", exact: true }).click();
  await expect(modal.locator(".book-chapter__number")).toHaveText("2");
  await row(0).locator('[data-action^="book-exclude:"]').click();
  await expect(modal.locator(".book-chapter__number")).toHaveText("1");
  await row(0).locator('[data-action^="book-include:"]').click();
  await expect(modal.locator(".book-chapter__number")).toHaveText("2");
  await dragBefore(page, row(2).locator("[data-book-drag-handle]"), row(0));
  await expect.poll(numbers).toEqual(["1.", "2.", ""]);
  await addSection(modal, "contents");
  await expect(modal.getByRole("checkbox", { name: "Numbered", exact: true })).toHaveCount(0);
  await expect(modal.locator(".book-contents li > span:first-child")).toHaveText(["1. File 003", "2. File 001", "File 002"]);
  await modal.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.locator('[data-action="export-project:fixture-project-001"]').click();
  await row(1).getByRole("button", { name: "Preview chapter: File 002", exact: true }).click();
  await expect(row(1).getByRole("checkbox", { name: "Numbered", exact: true })).not.toBeChecked();
  await expect(modal.locator(".book-chapter__number")).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("optional-chapter-numbering.png") });
  await modal.getByRole("button", { name: "Next", exact: true }).click();
  await modal.locator('[data-action="select-editor-export-option:file:pdf"]').click();
  await modal.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__projectExports.some((call) => call.command === "start_gtms_chapter_pdf_export"))).toBe(true);
  const exported = await page.evaluate(() => window.__projectExports.find((call) => call.command === "start_gtms_chapter_pdf_export").input.bookItems);
  expect(exported.filter((item) => item.kind === "chapter").map((item) => [item.chapterId, item.numbered])).toEqual([
    ["fixture-chapter-0-2", true], ["fixture-chapter-0-0", true], ["fixture-chapter-0-1", false],
  ]);
  await modal.getByRole("button", { name: "Cancel export", exact: true }).click();
});

test("Add new stays fixed while the book list and preview scroll at resized window sizes", async ({ page }) => {
  await mountProjectExport(page, false, false, 40);
  const modal = page.getByRole("dialog", { name: "Export project", exact: true });
  const list = modal.locator(".book-composer__list");
  const preview = modal.locator(".book-composer__page-scroll");
  const add = modal.getByRole("button", { name: "+ Add new", exact: true });
  const geometry = () => modal.evaluate((element) => {
    const card = element.getBoundingClientRect(), footer = element.querySelector(".book-add").getBoundingClientRect();
    const button = element.querySelector('[data-action="book-add-menu"]').getBoundingClientRect();
    return { footerTop: footer.top, footerBottom: footer.bottom, buttonBottom: button.bottom,
      modalBottom: card.bottom, outerScrollRange: element.scrollHeight - element.clientHeight, outerScroll: element.scrollTop };
  });
  for (const [width, height] of [[1280, 720], [1003, 560], [1600, 1000], [720, 900]]) {
    await page.setViewportSize({ width, height });
    const before = await geometry();
    expect(before.outerScrollRange).toBeLessThanOrEqual(1);
    expect(before.outerScroll).toBe(0);
    if (width > 760) expect(Math.abs(before.modalBottom - before.footerBottom)).toBeLessThan(2);
    expect(before.footerBottom - before.buttonBottom).toBeGreaterThanOrEqual(11);
    await expect(add).toBeInViewport();
    for (const pane of [list, preview]) {
      for (const deltaY of [20000, 20000, -20000, -20000]) {
        // Start at the edge explicitly: one large wheel event need not travel
        // the whole pane, and this regression is about scrolling past its edge.
        await pane.evaluate((element, direction) => { element.scrollTop = direction > 0 ? element.scrollHeight : 0; }, deltaY);
        await pane.hover();
        await page.mouse.wheel(0, deltaY);
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const after = await geometry();
        expect(after.footerTop).toBeCloseTo(before.footerTop, 1);
        expect(after.footerBottom).toBeCloseTo(before.footerBottom, 1);
        expect(after.outerScroll).toBe(0);
      }
    }
    await add.click();
    await expect(modal.locator(".book-add__menu")).toBeInViewport();
    await expect(modal.getByRole("button", { name: "Title page", exact: true })).toBeInViewport();
    await expect(modal.getByRole("button", { name: "Full page image", exact: true })).toBeInViewport();
    if (width === 1280 || width === 720) await page.screenshot({ path: test.info().outputPath(`fixed-add-footer-${width}.png`) });
    await add.click();
  }
});

test("Include and Exclude retain the scrolling list and preview in a long book", async ({ page }) => {
  await mountProjectExport(page, false, false, 40);
  const modal = page.getByRole("dialog", { name: "Export project", exact: true });
  await addSection(modal, "copyright");
  const editor = modal.getByRole("textbox", { name: "Copyright text", exact: true });
  await editor.fill("Copyright text to keep mounted.");
  // Leave enough excluded rows to exercise Include in the lower list as well.
  for (let index = 0; index < 10; index++) await modal.locator(`[data-action="book-exclude:fixture-chapter-0-${index}"]`).click();
  const read = () => page.evaluate(() => ({
    list: document.querySelector(".book-composer__list") === window.__inclusionList,
    preview: document.querySelector("[data-book-copyright-editor]") === window.__inclusionEditor,
    input: document.querySelector('[data-book-chapter-title="fixture-chapter-0-30"]') === window.__inclusionInput,
    scroll: document.querySelector(".book-composer__list").scrollTop,
    previewScroll: document.querySelector(".book-composer__page-scroll").scrollTop,
  }));
  await modal.locator('[data-action="book-exclude:fixture-chapter-0-24"]').scrollIntoViewIfNeeded();
  const beforeExclude = await modal.evaluate((element) => {
    window.__inclusionList = element.querySelector(".book-composer__list");
    window.__inclusionEditor = element.querySelector("[data-book-copyright-editor]");
    window.__inclusionInput = element.querySelector('[data-book-chapter-title="fixture-chapter-0-30"]');
    element.querySelector(".book-composer__page-scroll").scrollTop = 120;
    return { scroll: window.__inclusionList.scrollTop, previewScroll: element.querySelector(".book-composer__page-scroll").scrollTop };
  });
  expect(beforeExclude.scroll).toBeGreaterThan(0);
  await modal.locator('[data-action="book-exclude:fixture-chapter-0-24"]').click();
  expect(await read()).toEqual({ list: true, preview: true, input: true, ...beforeExclude });
  await expect(modal.locator('[data-book-count="included"]')).toHaveText("30");
  await expect(modal.locator('[data-action="book-exclude:fixture-chapter-0-25"]')).toBeFocused();
  await modal.locator('[data-action="book-exclude:fixture-chapter-0-25"]').press("Enter");
  expect(await read()).toEqual({ list: true, preview: true, input: true, ...beforeExclude });
  await expect(modal.locator('[data-book-count="included"]')).toHaveText("29");

  const include = modal.locator('[data-action="book-include:fixture-chapter-0-5"]');
  await include.scrollIntoViewIfNeeded();
  const anchor = modal.locator('[data-book-item="fixture-chapter-0-4"]');
  const beforeInclude = await anchor.boundingBox();
  const previewBefore = (await read()).previewScroll;
  await include.click();
  const afterInclude = await anchor.boundingBox();
  // Including inserts above this viewport. Native anchoring keeps the visible
  // neighboring rows in place instead of jumping to the newly included row.
  expect(Math.abs(afterInclude.y - beforeInclude.y)).toBeLessThan(1);
  expect(await read()).toMatchObject({ list: true, preview: true, input: true, previewScroll: previewBefore });
  await expect(modal.locator('[data-book-count="included"]')).toHaveText("30");
  await expect(modal.locator('[data-action="book-include:fixture-chapter-0-6"]')).toBeFocused();
  await expect(editor).toHaveText("Copyright text to keep mounted.");
});

test("inclusion updates empty groups, Next, and chapter numbers without rebuilding the dialog", async ({ page }) => {
  await mountProjectExport(page, false, false, 2);
  const modal = page.getByRole("dialog", { name: "Export project", exact: true });
  await modal.locator('[data-action="book-select:fixture-chapter-0-1"]').click();
  await expect(modal.locator(".book-chapter__number")).toHaveText("2");
  await modal.locator('[data-action="book-exclude:fixture-chapter-0-0"]').click();
  await expect(modal.locator(".book-chapter__number")).toHaveText("1");
  // Some platforms keep the chapter input focused when its toggle is clicked.
  // Excluding that row must not restore focus to it in the distant Excluded list.
  await modal.locator('[data-book-chapter-title="fixture-chapter-0-1"]').focus();
  await modal.locator('[data-action="book-exclude:fixture-chapter-0-1"]').evaluate((button) => button.click());
  await expect(modal.locator(".book-composer__list")).toBeFocused();
  await expect(modal.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
  await expect(modal.locator("[data-book-empty-hint]")).toBeVisible();
  await modal.locator('[data-action="book-include:fixture-chapter-0-1"]').click();
  await expect(modal.getByRole("button", { name: "Next", exact: true })).toBeEnabled();
  await expect(modal.locator("[data-book-empty-hint]")).toBeHidden();
  await modal.locator('[data-action="book-include:fixture-chapter-0-0"]').click();
  await expect(modal.locator(".book-chapter__number")).toHaveText("2");
  await expect(modal.locator(".book-excluded-heading")).toBeHidden();
  await addSection(modal, "contents");
  await expect(modal.locator(".book-contents li")).toHaveCount(2);
  await modal.locator('[data-action="book-exclude:fixture-chapter-0-0"]').click();
  await expect(modal.locator(".book-contents li")).toHaveCount(1);
  await modal.locator('[data-action="book-include:fixture-chapter-0-0"]').click();
  await expect(modal.locator(".book-contents li")).toHaveCount(2);
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
    expect(spacing.line).toBeCloseTo(1.2532421875, 3);
    expect(spacing.paragraph).toBeCloseTo(.75, 3);
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

test("book preview uses print typography for body, headings, quotes, captions, and footnotes", async ({ page }) => {
  await page.route("https://example.com/book-proof.svg", (route) => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="80"><rect width="300" height="80" fill="#b79858"/></svg>' }));
  await page.addInitScript(() => {
    const row = (textStyle, text, extra = {}) => ({ rowId: crypto.randomUUID(), textStyle, fields: { en: text }, ...extra });
    window.__bookHeadingRows = { "fixture-chapter-0-0": [
      row("paragraph", "An opening paragraph to compare with the print edition. ".repeat(5)),
      row("paragraph", "The next paragraph uses a first-line indent without an empty line."),
      row("heading1", "A mixed-case Heading"), row("heading2", "A smaller Heading"),
      row("quote", "An upright quotation with <i>explicit italics</i>.", { attributions: { en: "— An Author" } }),
      row("centered", "Centered text"), row("indented", "Indented text"),
      row("paragraph", "A reference [1] in ordinary text.", { footnotes: { en: "A footnote with <i>italic</i> words. ".repeat(4) } }),
      row("paragraph", "<hr>"),
      row("paragraph", "", { images: { en: { kind: "url", url: "https://example.com/book-proof.svg" } }, imageCaptions: { en: "An italic image caption" } }),
    ] };
  });
  await mountProjectExport(page);
  const modal = page.getByRole("dialog", { name: "Export project", exact: true });
  await chooseBookOption(modal, "editor-export-paper-size", "A5 (148 × 210 mm)");
  await expect(modal.locator(".book-chapter__footnotes")).toBeVisible();
  await expect(modal.locator("[data-book-font-status]")).toBeEmpty();
  const styles = await modal.locator(".book-page--chapter").evaluate((page) => {
    const read = (selector) => {
      const element = page.querySelector(selector), s = getComputedStyle(element);
      return { family: s.fontFamily, size: parseFloat(s.fontSize), line: parseFloat(s.lineHeight) / parseFloat(s.fontSize),
        weight: s.fontWeight, italic: s.fontStyle, caps: s.textTransform, tracking: parseFloat(s.letterSpacing) || 0,
        indent: parseFloat(s.textIndent), before: parseFloat(s.marginTop), after: parseFloat(s.marginBottom), align: s.textAlign };
    };
    return { trimmed: CSS.supports("text-box", "trim-both cap alphabetic"), body: read(".translate-preview__block--paragraph"), indent: read(".book-print-indent"),
      title: read(".book-chapter__header h1"), h1: read(".translate-preview__block--heading1"), h2: read(".translate-preview__block--heading2"),
      quote: read("blockquote"), attribution: read("cite"), caption: read("figcaption"),
      note: read(".book-footnote__text"), centered: read(".translate-preview__block--centered"),
    };
  });
  expect(styles.body.family).toContain("Crimson Pro");
  expect(styles.body.line).toBeCloseTo(1.3532421875, 3);
  expect(styles.body.before).toBe(0);
  expect(styles.body.after / styles.body.size).toBeCloseTo(styles.trimmed ? .78 : 0, 3);
  expect(styles.indent.indent / styles.body.size).toBeCloseTo(1.5, 3);
  expect(styles.title.family).toContain("Alegreya");
  expect(styles.title.caps).toBe("uppercase");
  expect(styles.title.tracking / styles.title.size).toBeCloseTo(.1, 3);
  expect(styles.h1.family).toContain("Alegreya");
  expect(styles.h1.size / styles.body.size).toBeCloseTo(13 / 11.5, 3);
  expect(styles.h2.size).toBeCloseTo(styles.body.size, 3);
  expect(styles.h1.caps).toBe("none");
  expect(styles.h1.weight).toBe("400");
  expect(styles.quote.italic).toBe("normal");
  expect(styles.quote.size / styles.body.size).toBeCloseTo(.9, 3);
  expect(styles.attribution.size / styles.body.size).toBeCloseTo(.8, 3);
  expect(styles.attribution.caps).toBe("uppercase");
  expect(styles.caption.size / styles.body.size).toBeCloseTo(.75, 3);
  expect(styles.caption.italic).toBe("italic");
  expect(styles.note.size / styles.body.size).toBeCloseTo(.85, 3);
  expect(styles.note.line).toBeCloseTo(1.0732421875, 3);
  expect(styles.centered.align).toBe("center");
  await page.screenshot({ path: test.info().outputPath("book-print-elements.png") });
});

test("shared paper size gives copyright pages print proportions and survives export steps", async ({ page }) => {
  await mountProjectExport(page);
  const modal = page.getByRole("dialog", { name: "Export project", exact: true });
  await addSection(modal, "copyright");
  await modal.getByRole("textbox", { name: "Copyright text", exact: true }).fill("Copyright © Gnosis VN, 2026.");
  const language = await modal.locator("#editor-export-language-trigger").boundingBox();
  const paper = await modal.locator("#editor-export-paper-size-trigger").boundingBox();
  expect(paper.x).toBeGreaterThanOrEqual(language.x + language.width);
  expect(Math.abs(paper.y - language.y)).toBeLessThan(1);
  await expect(modal.locator("[data-editor-export-paper-size-select]")).toHaveCount(1);
  const measure = () => modal.locator(".book-page--copyright").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const editor = element.querySelector("[data-book-copyright-editor]");
    return { width: rect.width, ratio: rect.height / rect.width, left: parseFloat(style.paddingLeft) / rect.width,
      right: parseFloat(style.paddingRight) / rect.width, font: parseFloat(style.fontSize) / rect.width,
      bottom: rect.bottom - parseFloat(style.paddingBottom) - editor.getBoundingClientRect().bottom };
  });
  for (const [label, width, height] of [
    ["A5 (148 × 210 mm)", 148, 210], ["A4 (210 × 297 mm)", 210, 297],
    ["US Letter (8.5 × 11 in)", 215.9, 279.4], ["US Legal (8.5 × 14 in)", 215.9, 355.6],
    ["US Executive (7.25 × 10.5 in)", 184.15, 266.7], ["US Tabloid (11 × 17 in)", 279.4, 431.8],
    ["A3 (297 × 420 mm)", 297, 420], ["B5 / ISO (176 × 250 mm)", 176, 250],
  ]) {
    await chooseBookOption(modal, "editor-export-paper-size", label);
    const geometry = await measure();
    expect(geometry.ratio).toBeCloseTo(height / width, 3);
    expect(geometry.left).toBeCloseTo((width === 148 ? 19 : 21.59) / width, 3);
    expect(geometry.right).toBeCloseTo((width === 148 ? 22 : 21.59) / width, 3);
    expect(geometry.font).toBeCloseTo(9.2 * 25.4 / 72 / width, 4);
    expect(Math.abs(geometry.bottom)).toBeLessThan(1);
    await expect(modal.getByRole("textbox", { name: "Copyright text", exact: true })).toHaveText("Copyright © Gnosis VN, 2026.");
  }
  await chooseBookOption(modal, "editor-export-paper-size", "A5 (148 × 210 mm)");
  await page.screenshot({ path: test.info().outputPath("copyright-a5-paper.png") });
  await page.setViewportSize({ width: 820, height: 1000 });
  const narrow = await measure();
  expect(narrow.width).toBeLessThan(148 * 96 / 25.4);
  expect(narrow.ratio).toBeCloseTo(210 / 148, 3);
  expect(narrow.font).toBeCloseTo(9.2 * 25.4 / 72 / 148, 4);
  await page.setViewportSize({ width: 1280, height: 720 });
  await modal.getByRole("button", { name: "Next", exact: true }).click();
  await modal.locator('[data-action="select-editor-export-option:file:pdf"]').click();
  await expect(modal.locator("[data-editor-export-paper-size-select]")).toHaveValue("a5");
  await chooseBookOption(modal, "editor-export-paper-size", "US Letter (8.5 × 11 in)");
  await modal.locator('[data-action="select-editor-export-option:file:docx"]').click();
  await expect(modal.locator("[data-editor-export-paper-size-select]")).toHaveCount(0);
  await modal.locator('[data-action="select-editor-export-option:file:pdf"]').click();
  await expect(modal.locator("[data-editor-export-paper-size-select]")).toHaveValue("us-letter");
  await modal.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(modal.locator("[data-editor-export-paper-size-select]")).toHaveValue("us-letter");
  expect((await measure()).ratio).toBeCloseTo(11 / 8.5, 3);
  await expect(modal.getByRole("textbox", { name: "Copyright text", exact: true })).toHaveText("Copyright © Gnosis VN, 2026.");
  await modal.getByRole("button", { name: "Cancel", exact: true }).click();
  // A fresh page boot must recover the preference from persistent settings,
  // rather than retaining it only on the in-memory modal object.
  await mountProjectExport(page);
  await expect(modal.locator("[data-editor-export-paper-size-select]")).toHaveValue("us-letter");
  await modal.getByRole("button", { name: "Next", exact: true }).click();
  await expect(modal.locator("[data-editor-export-paper-size-select]")).toHaveValue("us-letter");
  await modal.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__projectExports.find((call) => call.command === "start_gtms_chapter_pdf_export")?.input.paperSize)).toBe("us-letter");
});

test("full-page captions wrap below a centered image and contents titles retain their entered case", async ({ page }) => {
  await mountProjectExport(page);
  const modal = page.getByRole("dialog", { name: "Export project", exact: true });
  await addSection(modal, "image");
  const chooser = page.waitForEvent("filechooser");
  await modal.locator('[data-action="book-image-pick"]').click();
  await (await chooser).setFiles({ name: "image.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64") });
  const caption = modal.getByRole("textbox", { name: "Enter image caption.", exact: true });
  const first = "An image caption long enough to wrap within the printed text column. ".repeat(4);
  await caption.fill(first);
  const geometry = await modal.locator(".book-page--image").evaluate((element) => {
    const image = element.querySelector(".book-image").getBoundingClientRect(), caption = element.querySelector(".book-page__caption").getBoundingClientRect();
    const page = element.getBoundingClientRect(), style = getComputedStyle(element);
    return { gap: caption.top - image.bottom, font: parseFloat(style.fontSize), captionHeight: caption.height,
      center: (image.top + caption.bottom) / 2, pageCenter: (page.top + page.bottom) / 2 };
  });
  expect(geometry.gap / geometry.font).toBeCloseTo(.85, 2);
  expect(geometry.captionHeight).toBeGreaterThan(geometry.font * 2);
  expect(Math.abs(geometry.center - geometry.pageCenter)).toBeLessThan(1);
  await caption.evaluate((element) => {
    const selection = window.getSelection();
    selection.selectAllChildren(element);
    selection.collapseToEnd();
  });
  await caption.press("Enter");
  await page.keyboard.insertText("A second line");
  const imageId = await modal.locator(".book-item.is-selected").getAttribute("data-book-item");
  await addSection(modal, "contents");
  await modal.getByRole("textbox", { name: "Table of Contents", exact: true }).fill("My mixed-case contents title");
  const saved = await page.evaluate(async (imageId) => {
    const { state } = await import("/app/state.js");
    const book = state.editorChapter.exportModal.book;
    return { caption: book.items.find((item) => item.id === imageId).caption, title: book.items.find((item) => item.id === book.selectedItemId).title };
  }, imageId);
  expect(saved.caption).toBe(first + "\nA second line");
  expect(saved.title).toBe("My mixed-case contents title");
});

test("book composer saves independent language layouts, sections, and format settings immediately", async ({ page }) => {
  await mountProjectExport(page, true);
  const modal = page.getByRole("dialog", { name: "Export project", exact: true });
  const included = modal.locator('[data-book-included="true"]');
  await expect(included).toHaveCount(2);
  const unavailable = modal.locator('[data-action="book-include:fixture-chapter-0-2"]');
  await expect(unavailable).toBeDisabled();
  await expect(unavailable.locator("..")).toHaveAttribute("data-tooltip", "Include this in the export.");
  await expect(unavailable).toHaveAttribute("aria-description", "This chapter does not contain a translation in English.");
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

const settingsLayout = (title, code = "en") => ({ options: { pdfPaperSize: "a5" }, items: [
  { id: "fixture-chapter-0-0", kind: "chapter", chapterId: "fixture-chapter-0-0", title, numbered: false },
], selectedItemId: "fixture-chapter-0-0", code });
const settingsDoc = (en, vi) => ({ version: 1, layouts: { ...(en ? { en } : {}), ...(vi ? { vi } : {}) } });
const settingsDialog = (page) => page.getByRole("dialog", { name: "Settings saved on GitHub", exact: true });
async function releaseSettingsFetch(page, settings) {
  await expect.poll(() => page.evaluate(() => window.__heldSettingsRequests.length)).toBeGreaterThan(0);
  await page.evaluate((settings) => {
    for (const request of window.__heldSettingsRequests.splice(0)) {
      window.__pdfListeners["project-export-settings"]({ payload: { requestId: request.requestId, settings, error: "" } });
    }
  }, settings);
}

test("Git export settings load locally first, then require acknowledgement for the selected language", async ({ page }) => {
  await mountProjectExport(page, false, false, 3, { local: settingsDoc(settingsLayout("Local title")), holdFetch: true });
  const modal = page.getByRole("dialog", { name: "Export project", exact: true });
  const title = modal.locator('[data-book-chapter-title="fixture-chapter-0-0"]');
  await expect(title).toHaveValue("Local title");
  await releaseSettingsFetch(page, settingsDoc(settingsLayout("GitHub title")));
  const notice = settingsDialog(page);
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("Export settings for this project have been saved on GitHub. We will now load the saved settings.");
  await expect(title).toHaveValue("Local title");
  await notice.getByRole("button", { name: "Ok", exact: true }).click();
  await expect(notice).toBeHidden();
  await expect(title).toHaveValue("GitHub title");
  await expect(modal.locator('[data-book-numbered-item="fixture-chapter-0-0"]')).not.toBeChecked();
});

test("other-language Git changes overwrite quietly and language selection uses them", async ({ page }) => {
  await mountProjectExport(page, true, false, 3, { local: settingsDoc(settingsLayout("English"), settingsLayout("Old Vietnamese", "vi")), holdFetch: true });
  const modal = page.getByRole("dialog", { name: "Export project", exact: true });
  await expect(modal.locator('[data-book-chapter-title="fixture-chapter-0-0"]')).toHaveValue("English");
  await releaseSettingsFetch(page, settingsDoc(settingsLayout("English"), settingsLayout("New Vietnamese", "vi")));
  await expect(settingsDialog(page)).toHaveCount(0);
  await chooseBookOption(modal, "editor-export-language", "Vietnamese (vi)");
  await expect(modal.locator('[data-book-chapter-title="fixture-chapter-0-0"]')).toHaveValue("New Vietnamese");
});

test("page 1 saves to Git on Next and Cancel, reloads on Back, and leaves format local", async ({ page }) => {
  await mountProjectExport(page, false, false, 3, { holdFetch: true });
  const modal = page.getByRole("dialog", { name: "Export project", exact: true });
  await releaseSettingsFetch(page, null);
  await modal.locator('[data-book-chapter-title="fixture-chapter-0-0"]').fill("Saved title");
  await modal.getByRole("button", { name: "Next", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__bookSettingsRequests.filter((r) => r.settings).length)).toBe(1);
  await modal.locator('[data-action="select-editor-export-option:file:pdf"]').click();
  await modal.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(modal.locator('[data-book-chapter-title="fixture-chapter-0-0"]')).toHaveValue("Saved title");
  await releaseSettingsFetch(page, settingsDoc(settingsLayout("Updated on GitHub")));
  await settingsDialog(page).getByRole("button", { name: "Ok", exact: true }).click();
  await modal.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(modal).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.__bookSettingsRequests.filter((r) => r.settings).length)).toBe(2);
  const saves = await page.evaluate(() => window.__bookSettingsRequests.filter((r) => r.settings));
  expect(saves[0].settings.layouts.en.items[0].title).toBe("Saved title");
  expect(saves[1].settings.layouts.en.items[0].title).toBe("Updated on GitHub");
  expect(saves[1].settings.layouts.en.options).toEqual({ pdfPaperSize: "a5" });
  expect(JSON.stringify(saves)).not.toContain("selectedOptionId");
  await page.locator('[data-action="export-project:fixture-project-001"]').click();
  await modal.getByRole("button", { name: "Next", exact: true }).click();
  await expect(modal.locator('[data-action="select-editor-export-option:file:pdf"]')).toHaveAttribute("aria-pressed", "true");
});

test("a delayed settings fetch cannot change a closed modal or a newer entry", async ({ page }) => {
  await mountProjectExport(page, false, false, 3, { holdFetch: true });
  const modal = page.getByRole("dialog", { name: "Export project", exact: true });
  await expect.poll(() => page.evaluate(() => window.__heldSettingsRequests.length)).toBe(1);
  await page.evaluate(() => { window.__oldSettingsRequest = window.__heldSettingsRequests.shift(); });
  await modal.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.locator('[data-action="export-project:fixture-project-001"]').click();
  await modal.locator('[data-book-chapter-title="fixture-chapter-0-0"]').fill("New draft");
  await page.evaluate((settings) => window.__pdfListeners["project-export-settings"]({ payload: {
    requestId: window.__oldSettingsRequest.requestId, settings, error: "",
  } }), settingsDoc(settingsLayout("Stale fetch")));
  await expect(settingsDialog(page)).toHaveCount(0);
  await expect(modal.locator('[data-book-chapter-title="fixture-chapter-0-0"]')).toHaveValue("New draft");
});

test("offline Git save keeps local setup and Cancel remains immediate", async ({ page }) => {
  await mountProjectExport(page, false, false, 3, { holdFetch: true });
  const modal = page.getByRole("dialog", { name: "Export project", exact: true });
  await releaseSettingsFetch(page, null);
  await modal.locator('[data-book-chapter-title="fixture-chapter-0-0"]').fill("Offline draft");
  await page.evaluate(() => { window.__settingsError = "Offline"; });
  await modal.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(modal).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.__bookSettingsRequests.filter((r) => r.settings).length)).toBe(1);
  await page.locator('[data-action="export-project:fixture-project-001"]').click();
  await expect(modal.locator('[data-book-chapter-title="fixture-chapter-0-0"]')).toHaveValue("Offline draft");
});
