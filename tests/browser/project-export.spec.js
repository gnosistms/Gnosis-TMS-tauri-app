import { expect, test } from "./test.js";

async function advanceToExport(modal) {
  await modal.getByRole("button", { name: "Next", exact: true }).click();
  if (await modal.locator("[data-book-redundancy-results]").count()) {
    await expect(modal.getByRole("button", { name: "Next", exact: true })).toBeEnabled();
    await modal.getByRole("button", { name: "Next", exact: true }).click();
  }
}
async function backToComposition(modal) {
  await modal.getByRole("button", { name: "Previous", exact: true }).click();
  if (await modal.locator("[data-book-redundancy-results]").count()) await modal.getByRole("button", { name: "Previous", exact: true }).click();
}
async function mountProjectExport(page, multilingual = false, chapterTitles = false, filesPerProject = 3, settings = {}) {
  await page.addInitScript(({ chapterTitles, settings }) => {
    window.__projectExports = [];
    window.__redundancyCalls = [];
    window.__redundancyChoices = {};
    window.__redundancyResult = { images: [], footnotes: [], warnings: [], cached: true };
    window.__bookSettingsRequests = [];
    window.__remoteBookSettings = settings.remote || null;
    window.__localBookSettings = settings.local || null;
    window.__holdSettingsFetch = settings.holdFetch || false;
    window.__heldSettingsRequests = [];

    window.__pdfListeners = {};
    window.__pagePreviewRequests = [];
    window.__TAURI__ = {
      core: { invoke: async (command, args) => {
        if (["export_gtms_chapter_file", "inspect_gtms_chapter_pdf_fonts", "start_gtms_chapter_pdf_export", "cancel_gtms_chapter_pdf_export"].includes(command)) {
          window.__projectExports.push({ command, ...args });
        }
        if (command === "book_redundancy_cache") {
          if (args.input.choices && window.__holdRedundancySave) await new Promise((resolve) => { window.__releaseRedundancySave = resolve; });
          if (args.input.choices && window.__failRedundancySave) throw new Error("Review choices could not be saved");
          if (args.input.choices) window.__redundancyChoices = args.input.choices;
          return { result: window.__redundancyResult, choices: window.__redundancyChoices };
        }
        if (command === "start_book_redundancy") {
          window.__redundancyCalls.push(args.input);
          const requestId = args.input.requestId;
          window.__finishRedundancy = (error = "") => window.__pdfListeners["book-redundancy-progress"]?.({ payload: { requestId, complete: true, result: window.__redundancyResult, error } });
          window.__publishImages = () => window.__pdfListeners["book-redundancy-progress"]?.({ payload: { requestId, phase: "images", result: { ...window.__redundancyResult, footnotes: [] } } });
          setTimeout(() => {
            if (!window.__holdRedundancyImages) window.__publishImages();
            if (!window.__holdRedundancyFootnotes) window.__finishRedundancy();
          }, 0);
          return null;
        }
        if (command === "cancel_book_redundancy") return null;
        if (command === "load_project_export_settings") return { settings: window.__localBookSettings };
        if (command === "start_project_export_settings_sync") {
          window.__bookSettingsRequests.push(args.input);
          if ((!args.input.settings && window.__holdSettingsFetch) || (args.input.settings && window.__holdSettingsSave)) {
            window.__heldSettingsRequests.push(args.input);
          } else {
            const payload = { requestId: args.input.requestId, settings: args.input.settings || window.__remoteBookSettings, error: window.__settingsError || "" };
            if (args.input.settings && !payload.error) window.__localBookSettings = args.input.settings;
            setTimeout(() => window.__pdfListeners["project-export-settings"]?.({ payload }), 0);
          }
          return null;
        }
        if (command === "start_project_book_page_preview") {
          window.__pagePreviewRequests.push(args.input);
          const escaped = args.input.item.title.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
          const pages = [window.__pagePreviewSvg || `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="420" height="595"><rect width="100%" height="100%" fill="white"/><text x="60" y="120">${escaped}</text></svg>`)}`];
          if (!window.__holdPagePreview) setTimeout(() => window.__pdfListeners["book-page-preview"]?.({ payload: { requestId: args.input.requestId, pages, error: "" } }), 0);
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
  await advanceToExport(modal);
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
  await advanceToExport(modal);
  await modal.locator('[data-action="select-editor-export-option:file:pdf"]').click();
  await backToComposition(modal);
  await advanceToExport(modal);
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
  await advanceToExport(modal);
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

const lastContentsPreview = (page) => page.evaluate(() => window.__pagePreviewRequests.findLast((entry) => entry.item.kind === "contents"));
const previewedChapters = async (page) => (await lastContentsPreview(page))?.book.bookItems
  .filter((item) => item.kind === "chapter").map((item) => [item.chapterId, item.title, item.numbered]);

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

  // This project's title changes on the list, but the dialog output is unchanged.
  await page.evaluate(() => {
    window.__publishProjectsRefresh(true, "active");
    window.__publishProjectsRefresh(true, "active");
    window.__publishProjectsRefresh(false, "active");
    window.__publishProjectsRefresh(false, "active");
  });
  expect(await page.evaluate(() => window.__refreshDraws)).toEqual({ page: 2, modal: 0 });
  await expect(title).toHaveValue("My draft title");
  await advanceToExport(modal);
  await expect(modal.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
});

test("same-project summary refresh retains a scrolled chapter preview after scoped updates", async ({ page }) => {
  await mountProjectExport(page, false, false, 30);
  const modal = page.getByRole("dialog", { name: "Export project", exact: true });
  await expect(modal.locator(".book-page--chapter")).toBeVisible();
  await expect.poll(() => page.evaluate(async () => {
    const { state } = await import("/app/state.js");
    return state.editorChapter.exportModal.book.previewFonts?.status;
  })).toBe("ready");

  await page.evaluate(async () => {
    const { state } = await import("/app/state.js");
    state.projectsPage.isRefreshing = true;
    window.__gnosisDebug.renderProjectsBackground();
    // Selecting a chapter during sync finishes through the scoped preview path.
    const book = state.editorChapter.exportModal.book;
    const chapter = book.items.filter((item) => item.kind === "chapter")[1];
    book.previewCache.delete(chapter.id);
    window.__bookHeadingRows = { [chapter.chapterId]: Array.from({ length: 60 }, (_, index) => ({
      rowId: `paragraph-${index}`, textStyle: "paragraph", fields: { en: `Paragraph ${index}. ${"Chapter text for reading. ".repeat(20)}` },
    })) };
  });
  await modal.locator("[data-book-preview-select]").nth(1).click();
  await expect(modal.locator(".book-chapter__body")).toContainText("Paragraph 59.");
  await modal.locator("[data-book-chapter-title]").nth(1).fill("My chapter title");
  await page.evaluate(async () => {
    const { state } = await import("/app/state.js");
    const scroll = document.querySelector(".book-composer__page-scroll");
    const list = document.querySelector(".book-composer__list");
    scroll.scrollTop = 450;
    list.scrollTop = 170;
    window.__chapterRefresh = {
      page: document.querySelector("#app").firstElementChild,
      modal: document.querySelector('[data-modal-dialog="editor-export"]'),
      scroll, list, preview: scroll.firstElementChild, top: scroll.scrollTop, listTop: list.scrollTop,
    };
    const paragraph = scroll.querySelector("p").firstChild;
    const range = document.createRange();
    range.setStart(paragraph, 2);
    range.setEnd(paragraph, 12);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    window.__chapterRefresh.selection = window.getSelection().toString();

    const { createProjectsQuerySnapshot, applyProjectsQuerySnapshotToState } = await import("/app/project-query.js");
    const projects = structuredClone(state.projects);
    projects[0].chapters[0].wordCounts = { en: 4321 };
    projects[0].chapters[0].workflowStatus = "translated";
    projects[0].title = "Refreshed project title";
    applyProjectsQuerySnapshotToState(createProjectsQuerySnapshot({ items: projects, discovery: { status: "ready" } }), {
      teamId: state.selectedTeamId, isFetching: false,
    });
    window.__gnosisDebug.renderProjectsBackground();
    window.__gnosisDebug.renderProjectsBackground();
  });
  expect(await page.evaluate(() => {
    const before = window.__chapterRefresh;
    return {
      pageUpdated: document.querySelector("#app").firstElementChild !== before.page,
      sameModal: document.querySelector('[data-modal-dialog="editor-export"]') === before.modal,
      samePreview: document.querySelector(".book-composer__page-scroll").firstElementChild === before.preview,
      top: document.querySelector(".book-composer__page-scroll").scrollTop,
      listTop: document.querySelector(".book-composer__list").scrollTop,
      selection: window.getSelection().toString(),
      expectedSelection: before.selection,
    };
  })).toEqual({ pageUpdated: true, sameModal: true, samePreview: true, top: 450, listTop: 170,
    selection: "ragraph 0.", expectedSelection: "ragraph 0." });
  await expect(page.locator('[data-screen="projects"]')).toContainText("Refreshed project title");

  // A genuine change to the dialog still renders on background completion.
  await page.evaluate(async () => {
    const { state } = await import("/app/state.js");
    state.editorChapter.exportModal.error = "Preview unavailable";
    window.__gnosisDebug.renderProjectsBackground();
  });
  await expect(modal).toContainText("Preview unavailable");
});

test("background project refresh retains the redundancy page after review choices change", async ({ page }) => {
  await mountProjectExport(page);
  await page.evaluate(() => {
    const occurrence = (id, itemId, kind = "footnote") => ({ id, itemId, rowId: `${itemId}-row`, kind, marker: kind === "footnote" ? 1 : 0, signature: `sig-${id}`, chapterName: itemId, text: "An explanation of dependent origination.", context: "dependent origination", imageSrc: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='120'/%3E" });
    window.__redundancyResult = {
      images: [{ id: "image", occurrences: [occurrence("i1", "fixture-chapter-0-0", "image"), occurrence("i2", "fixture-chapter-0-1", "image")] }],
      footnotes: [{ id: "note", anchor: "dependent origination", occurrences: [occurrence("n1", "fixture-chapter-0-0"), occurrence("n2", "fixture-chapter-0-1")] }], warnings: [], cached: true,
    };
  });
  const modal = page.getByRole("dialog", { name: "Export project", exact: true });
  await modal.getByRole("button", { name: "Next", exact: true }).click();
  await expect(modal.getByRole("heading", { name: "Redundancy checks", exact: true })).toBeVisible();
  await expect(modal.getByRole("button", { name: "Next", exact: true })).toBeEnabled();
  const checks = modal.locator("[data-book-redundancy-choice]");
  await checks.nth(1).check();
  await checks.nth(2).uncheck();
  await expect.poll(() => page.evaluate(() => window.__redundancyChoices.n1)).toBe(false);
  await page.evaluate(async () => {
    const { state } = await import("/app/state.js");
    const { createProjectsQuerySnapshot, applyProjectsQuerySnapshotToState } = await import("/app/project-query.js");
    const scroll = document.querySelector(".book-redundancy__scroll");
    scroll.style.maxHeight = "120px";
    scroll.scrollTop = 60;
    window.__redundancyRefresh = {
      page: document.querySelector("#app").firstElementChild,
      modal: document.querySelector('[data-modal-dialog="editor-export"]'),
      image: document.querySelector(".book-redundancy__thumbnail"),
      control: document.querySelectorAll("[data-book-redundancy-choice]")[2],
      top: scroll.scrollTop,
    };
    window.__redundancyRefresh.control.focus();
    const projects = structuredClone(state.projects);
    window.__publishRedundancyRefresh = (fetching, change = "") => {
      const next = structuredClone(projects);
      next[0].chapters[0].wordCounts = { en: Math.random() };
      if (change === "title") next[0].title = "Refreshed project title";
      applyProjectsQuerySnapshotToState(createProjectsQuerySnapshot({ items: next, discovery: { status: "ready" } }), {
        teamId: state.selectedTeamId, isFetching: fetching,
      });
      window.__gnosisDebug.renderProjectsBackground();
    };
    for (let i = 0; i < 4; i++) window.__publishRedundancyRefresh(true);
    window.__publishRedundancyRefresh(false, "title");
    window.__publishRedundancyRefresh(false, "title");
  });
  expect(await page.evaluate(() => {
    const before = window.__redundancyRefresh;
    return {
      pageUpdated: document.querySelector("#app").firstElementChild !== before.page,
      sameModal: document.querySelector('[data-modal-dialog="editor-export"]') === before.modal,
      sameImage: document.querySelector(".book-redundancy__thumbnail") === before.image,
      focused: document.activeElement === before.control,
      top: document.querySelector(".book-redundancy__scroll").scrollTop === before.top,
      checked: [...document.querySelectorAll("[data-book-redundancy-choice]")].map((input) => input.checked),
    };
  })).toEqual({ pageUpdated: true, sameModal: true, sameImage: true, focused: true, top: true, checked: [true, true, false, false] });
  await expect(page.locator('[data-screen="projects"]')).toContainText("Refreshed project title");

  // A genuine change to the dialog still renders on background completion.
  await page.evaluate(async () => {
    const { state } = await import("/app/state.js");
    state.editorChapter.exportModal.book.redundancy.error = "Review unavailable";
    window.__gnosisDebug.renderProjectsBackground();
  });
  await expect(modal).toContainText("Review unavailable");
  await expect(checks.nth(1)).toBeChecked();await expect(checks.nth(2)).not.toBeChecked();
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
  await addSection(modal, "contents");
  const checkbox = modal.getByRole("checkbox", { name: "Include H1 headings", exact: true });
  await expect(checkbox).not.toBeChecked();
  await expect.poll(async () => (await lastContentsPreview(page))?.item.includeH1Headings).toBe(false);
  await checkbox.check();
  await expect.poll(async () => (await lastContentsPreview(page))?.item.includeH1Headings).toBe(true);
  await expect(modal.getByRole("img", { name: "Table of contents PDF preview", exact: true })).toBeVisible();
  // Typst reads the entries from the book itself, so excluded chapters drop out.
  await modal.locator('[data-action="book-exclude:fixture-chapter-0-2"]').click();
  await expect.poll(async () => (await previewedChapters(page))?.map(([id]) => id)).toEqual(["fixture-chapter-0-0", "fixture-chapter-0-1"]);
  await modal.locator('[data-action="book-include:fixture-chapter-0-2"]').click();
  await expect.poll(async () => (await previewedChapters(page))?.length).toBe(3);
  await modal.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.locator('[data-action="export-project:fixture-project-001"]').click();
  await expect(checkbox).toBeChecked();
  await page.screenshot({ path: test.info().outputPath("book-contents-headings.png") });
  await advanceToExport(modal);
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
  await expect(modal.getByRole("checkbox", { name: "Numbered", exact: true })).toHaveCount(0);
  await expect(modal.getByRole("button", { name: "Settings", exact: true })).toHaveCount(3);
  await expect(row(0).locator("[data-book-chapter-title]")).toHaveValue("File 001");
  await expect(row(0).locator("[data-book-chapter-number]")).toHaveJSProperty("isContentEditable", false);
  await row(1).getByRole("button", { name: "Preview chapter: File 002", exact: true }).click();
  const settings = row(1).getByRole("button", { name: "Settings", exact: true });
  await settings.click();
  const numbered = modal.getByRole("menuitemcheckbox", { name: "Numbered", exact: true });
  await expect(numbered).toHaveAttribute("aria-checked", "true");
  await page.evaluate(() => {
    window.__numberingList = document.querySelector(".book-composer__list");
    window.__numberingSettings = document.querySelector('[data-book-settings-button="fixture-chapter-0-1"]');
  });
  await numbered.click();
  await expect(numbered).toHaveCount(0);
  await expect(settings).toBeFocused();
  expect(await page.evaluate(() => document.querySelector(".book-composer__list") === window.__numberingList
    && document.querySelector('[data-book-settings-button="fixture-chapter-0-1"]') === window.__numberingSettings)).toBe(true);
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
  await expect.poll(async () => (await previewedChapters(page))?.map(([, title, numbered]) => [title, numbered])).toEqual([["File 003", true], ["File 001", true], ["File 002", false]]);
  await modal.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.locator('[data-action="export-project:fixture-project-001"]').click();
  await row(1).getByRole("button", { name: "Preview chapter: File 002", exact: true }).click();
  await settings.click();
  await expect(numbered).toHaveAttribute("aria-checked", "false");
  await numbered.press("Escape");
  await expect(modal.locator(".book-chapter__number")).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("optional-chapter-numbering.png") });
  await advanceToExport(modal);
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
  await expect.poll(async () => (await previewedChapters(page))?.length).toBe(2);
  await modal.locator('[data-action="book-exclude:fixture-chapter-0-0"]').click();
  await expect.poll(async () => (await previewedChapters(page))?.length).toBe(1);
  await modal.locator('[data-action="book-include:fixture-chapter-0-0"]').click();
  await expect.poll(async () => (await previewedChapters(page))?.length).toBe(2);
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
  await expect.poll(() => page.evaluate(() => window.__pagePreviewRequests.at(-1)?.item.title)).toBe("Hôn Nhân\nHoàn Hảo");
  await expect(modal.locator("[data-book-page-proof]")).toHaveAttribute("aria-busy", "false");
  expect(await title.evaluate((element) => ({ same: element === window.__titleEditor, focused: document.activeElement === element, caret: element.selectionStart }))).toEqual({ same: true, focused: true, caret: 9 });
  const formBox = await modal.getByRole("region", { name: "Title page details", exact: true }).boundingBox();
  const proofBox = await modal.getByRole("region", { name: "Title page PDF preview", exact: true }).boundingBox();
  expect(formBox.x + formBox.width).toBeLessThanOrEqual(proofBox.x + 1);
  await chooseBookOption(modal, "editor-export-paper-size", "A5 (148 × 210 mm)");
  await expect.poll(() => page.evaluate(() => window.__pagePreviewRequests.at(-1)?.paperSize)).toBe("a5");
  await page.screenshot({ path: test.info().outputPath("title-form-live-preview.png") });
  await modal.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.locator('[data-action="export-project:fixture-project-001"]').click();
  await expect(title).toHaveValue("Hôn Nhân\nHoàn Hảo");
  await expect(modal.locator("[data-editor-export-paper-size-select]")).toHaveValue("a5");
  await advanceToExport(modal);
  await modal.getByRole("button", { name: "Save", exact: true }).click();
  expect(await page.evaluate(() => window.__projectExports.at(-1).input.bookItems.find((item) => item.kind === "title").title)).toBe("Hôn Nhân\nHoàn Hảo");
});

test("late title previews do not overwrite new edits and failed previews can retry", async ({ page }) => {
  await mountProjectExport(page);
  const modal = page.getByRole("dialog", { name: "Export project", exact: true });
  await page.evaluate(() => { window.__holdPagePreview = true; });
  await addSection(modal, "title");
  const title = modal.getByRole("textbox", { name: "Title", exact: true });
  await title.fill("Old title");
  await expect.poll(() => page.evaluate(() => window.__pagePreviewRequests.at(-1)?.item.title)).toBe("Old title");
  await title.fill("New title");
  await expect.poll(() => page.evaluate(() => window.__pagePreviewRequests.at(-1)?.item.title)).toBe("New title");
  await page.evaluate(() => {
    const old = window.__pagePreviewRequests.find((entry) => entry.item.title === "Old title");
    window.__pdfListeners["book-page-preview"]({ payload: { requestId: old.requestId, error: "Old failure", pages: [] } });
  });
  await expect(modal).not.toContainText("Old failure");
  await expect(title).toBeFocused();
  await page.evaluate(() => {
    const latest = window.__pagePreviewRequests.at(-1);
    window.__pdfListeners["book-page-preview"]({ payload: { requestId: latest.requestId, error: "Font not ready", pages: [] } });
  });
  await expect(modal).toContainText("Font not ready");
  await page.evaluate(() => { window.__holdPagePreview = false; });
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
  await expect.poll(async () => (await previewedChapters(page))?.map(([, title]) => title)).toEqual(["Custom English Title", "A renamed chapter"]);
  await modal.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.locator('[data-action="export-project:fixture-project-001"]').click();
  await expect(first).toHaveValue("Custom English Title");
  await chooseBookOption(modal, "editor-export-language", "Vietnamese (vi)");
  await expect(first).toHaveValue("Tên chương tùy chỉnh");
  await chooseBookOption(modal, "editor-export-language", "English (en)");
  await first.click();
  await page.screenshot({ path: test.info().outputPath("editable-chapter-titles.png") });
  await advanceToExport(modal);
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
      row("paragraph", "A second reference [1].", { footnotes: { en: "A second footnote." } }),
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
    const contentEnd = (element) => element.getBoundingClientRect().right - parseFloat(getComputedStyle(element).paddingRight);
    const contentTop = (element) => element.getBoundingClientRect().top + parseFloat(getComputedStyle(element).paddingTop);
    return { trimmed: CSS.supports("text-box", "trim-both cap alphabetic"), body: read(".translate-preview__block--paragraph"), indent: read(".book-print-indent"),
      title: read(".book-chapter__header h1"), h1: read(".translate-preview__block--heading1"), h2: read(".translate-preview__block--heading2"),
      quote: read("blockquote"), attribution: read("cite"), caption: read("figcaption"),
      note: read(".book-footnote__text"), noteItem: read(".book-chapter__footnotes li"), centered: read(".translate-preview__block--centered"),
      quoteEnd: contentEnd(page.querySelector("blockquote")), attributionEnd: contentEnd(page.querySelector("cite")),
      citationGap: contentTop(page.querySelector("cite")) - page.querySelector("blockquote").getBoundingClientRect().bottom,
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
  expect(styles.h1.size / styles.body.size).toBeCloseTo(14.5 / 11.5, 3);
  expect(styles.h2.size / styles.body.size).toBeCloseTo(12 / 11.5, 3);
  expect(styles.h1.caps).toBe("uppercase");
  expect(styles.h2.caps).toBe("uppercase");
  // One body line below each heading: trimmed boxes add it as margin.
  expect(styles.h1.after / styles.body.size).toBeCloseTo(styles.trimmed ? .78 : 0, 3);
  expect(styles.h2.after / styles.body.size).toBeCloseTo(styles.trimmed ? .78 : 0, 3);
  expect(styles.h1.weight).toBe("400");
  expect(styles.quote.italic).toBe("normal");
  expect(styles.quote.size / styles.body.size).toBeCloseTo(.9, 3);
  expect(styles.attribution.size / styles.body.size).toBeCloseTo(.8, 3);
  expect(styles.attribution.caps).toBe("uppercase");
  // As in the PDF, a quote's citation ends where the quote text does, inside the
  // quote's inset rather than at the margin.
  expect(styles.attributionEnd).toBeCloseTo(styles.quoteEnd, 1);
  // It sits a quarter em further below than a new paragraph would; untrimmed
  // line boxes already hold the paragraph space.
  expect(styles.citationGap / styles.body.size).toBeCloseTo(styles.trimmed ? 1.03 : .25, 2);
  expect(styles.caption.size / styles.body.size).toBeCloseTo(.75, 3);
  expect(styles.caption.italic).toBe("italic");
  expect(styles.note.size / styles.body.size).toBeCloseTo(.85, 3);
  expect(styles.note.line).toBeCloseTo(1.0732421875, 3);
  // As in the PDF, consecutive notes are a third of a footnote line further apart.
  expect(styles.noteItem.after / styles.noteItem.size).toBeCloseTo(.36, 3);
  expect(styles.centered.align).toBe("center");
  await page.screenshot({ path: test.info().outputPath("book-print-elements.png") });
});

test("book preview sets an opening quote or image alone on a cover sheet, as the PDF does", async ({ page }) => {
  await page.route("https://example.com/book-cover.svg", (route) => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="400"><rect width="80" height="400" fill="#b79858"/></svg>' }));
  await page.addInitScript(() => {
    const row = (textStyle, text, extra = {}) => ({ rowId: crypto.randomUUID(), textStyle, fields: { en: text }, ...extra });
    window.__bookHeadingRows = {
      "fixture-chapter-0-0": [
        row("heading1", "An Opening Quote"),
        row("quote", "A first epigraph.", { attributions: { en: "— One" } }), row("quote", "A second epigraph."),
        row("paragraph", "The chapter text."),
      ],
      "fixture-chapter-0-1": [
        row("heading1", "An Opening Image"),
        row("paragraph", "", { images: { en: { kind: "url", url: "https://example.com/book-cover.svg" } }, imageCaptions: { en: "A cover caption" } }),
        row("paragraph", "The chapter text."),
      ],
    };
  });
  await mountProjectExport(page);
  const modal = page.getByRole("dialog", { name: "Export project", exact: true });
  await chooseBookOption(modal, "editor-export-paper-size", "A5 (148 × 210 mm)");
  const sheets = modal.locator(".book-page--chapter");
  await expect(sheets).toHaveCount(2);
  await expect(sheets.nth(0)).toContainText("A first epigraph.");
  await expect(sheets.nth(0)).toContainText("A second epigraph.");
  await expect(sheets.nth(0)).not.toContainText("The chapter text.");
  await expect(sheets.nth(1).locator(".book-chapter__header")).toHaveCount(0);
  await expect(sheets.nth(1)).toContainText("The chapter text.");

  await modal.locator('[data-action="book-select:fixture-chapter-0-1"]').click();
  await expect(sheets.nth(0).locator("h1")).toHaveText("An Opening Image");
  await expect(sheets).toHaveCount(2);
  // The tall image shrinks so it and its caption fit under the header on one
  // sheet. Polled: the preview can redraw the sheet while the image loads.
  await expect.poll(() => sheets.nth(0).evaluate((sheet) => {
    const image = sheet.querySelector("img");
    if (!image?.complete || !image.naturalHeight) return "loading";
    const box = (element) => element.getBoundingClientRect();
    const content = box(sheet).bottom - parseFloat(getComputedStyle(sheet).paddingBottom);
    return { below: box(image).top >= box(sheet.querySelector(".book-chapter__header")).bottom,
      visible: box(image).height > 50, fits: box(sheet.querySelector("figcaption")).bottom <= content + 0.5 };
  })).toEqual({ below: true, visible: true, fits: true });
  await expect(sheets.nth(1)).toContainText("The chapter text.");
  await page.screenshot({ path: test.info().outputPath("book-chapter-cover.png") });
});

test("book preview drops its cap as many lines as the opening paragraph has, as the PDF does", async ({ page }) => {
  await page.addInitScript(() => {
    const row = (text) => ({ rowId: crypto.randomUUID(), textStyle: "paragraph", fields: { en: text } });
    const next = "The following paragraph starts at the margin, clear of the cap. ".repeat(4);
    window.__bookHeadingRows = {
      "fixture-chapter-0-0": [row("One short line."), row(next)],
      "fixture-chapter-0-1": [row("Two\nlines."), row(next)],
      "fixture-chapter-0-2": [row("An opening paragraph long enough for the full cap. ".repeat(5)), row(next)],
    };
  });
  await mountProjectExport(page);
  const modal = page.getByRole("dialog", { name: "Export project", exact: true });
  await chooseBookOption(modal, "editor-export-paper-size", "A5 (148 × 210 mm)");
  const sheet = modal.locator(".book-page--chapter");
  // The cap's size, how many lines after the first the opening paragraph sets
  // beside it, and whether the next paragraph's first line starts at its own
  // indent rather than beside a cap that reaches past the paragraph.
  const cap = () => sheet.evaluate((page) => {
    const [first, next] = page.querySelectorAll(".book-chapter__body > p");
    const lineStarts = (paragraph, from = 0) => {
      const range = document.createRange();
      range.setStart(paragraph.firstChild, from);
      range.setEnd(paragraph.lastChild, paragraph.lastChild.length ?? paragraph.lastChild.childNodes.length);
      const starts = new Map();
      for (const rect of range.getClientRects()) if (!starts.has(Math.round(rect.top))) starts.set(Math.round(rect.top), rect.left);
      return [...starts.values()];
    };
    const left = (paragraph) => paragraph.getBoundingClientRect().left;
    const letter = getComputedStyle(first, "::first-letter");
    return { lines: first.dataset.bookDropcapLines, float: letter.cssFloat,
      scale: Math.round(parseFloat(letter.fontSize) / parseFloat(getComputedStyle(first).fontSize) * 100) / 100,
      beside: lineStarts(first, 1).slice(1).filter((start) => start > left(first) + 1).length,
      clear: Math.abs(lineStarts(next)[0] - left(next) - parseFloat(getComputedStyle(next).textIndent)) < 1 };
  });
  const shoot = async (name) => {
    const box = await sheet.boundingBox();
    await page.screenshot({ path: test.info().outputPath(name), clip: { x: box.x, y: box.y, width: box.width, height: box.height / 2 } });
  };
  await expect.poll(cap).toEqual({ lines: "1", float: "none", scale: 1, beside: 0, clear: true });
  await shoot("book-dropcap-one-line.png");
  await modal.locator('[data-action="book-select:fixture-chapter-0-1"]').click();
  await expect.poll(cap).toEqual({ lines: "2", float: "inline-start", scale: 2.29, beside: 1, clear: true });
  await shoot("book-dropcap-two-lines.png");
  await modal.locator('[data-action="book-select:fixture-chapter-0-2"]').click();
  await expect.poll(cap).toEqual({ lines: "3", float: "inline-start", scale: 3.9, beside: 2, clear: true });
  await shoot("book-dropcap-three-lines.png");
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
  await advanceToExport(modal);
  await modal.locator('[data-action="select-editor-export-option:file:pdf"]').click();
  await expect(modal.locator("[data-editor-export-paper-size-select]")).toHaveValue("a5");
  await chooseBookOption(modal, "editor-export-paper-size", "US Letter (8.5 × 11 in)");
  await modal.locator('[data-action="select-editor-export-option:file:docx"]').click();
  await expect(modal.locator("[data-editor-export-paper-size-select]")).toHaveCount(0);
  await modal.locator('[data-action="select-editor-export-option:file:pdf"]').click();
  await expect(modal.locator("[data-editor-export-paper-size-select]")).toHaveValue("us-letter");
  await backToComposition(modal);
  await expect(modal.locator("[data-editor-export-paper-size-select]")).toHaveValue("us-letter");
  expect((await measure()).ratio).toBeCloseTo(11 / 8.5, 3);
  await expect(modal.getByRole("textbox", { name: "Copyright text", exact: true })).toHaveText("Copyright © Gnosis VN, 2026.");
  await modal.getByRole("button", { name: "Cancel", exact: true }).click();
  // A fresh page boot must recover the preference from persistent settings,
  // rather than retaining it only on the in-memory modal object.
  await mountProjectExport(page);
  await expect(modal.locator("[data-editor-export-paper-size-select]")).toHaveValue("us-letter");
  await advanceToExport(modal);
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
  // setFiles completes before the asynchronous import replaces the empty page.
  // Measure the imported page, rather than a handle detached by its completion.
  await expect(modal.getByRole("img", { name: "Full page image", exact: true })).toBeVisible();
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
  await modal.getByRole("region", { name: "Table of contents details", exact: true }).getByRole("textbox", { name: "Title", exact: true }).fill("My mixed-case contents title");
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
  await modal.getByRole("region", { name: "Table of contents details", exact: true }).getByRole("textbox", { name: "Title", exact: true }).fill("Mục lục");
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
  await advanceToExport(modal);
  await modal.locator('[data-action="select-editor-export-option:file:pdf"]').click();
  await chooseBookOption(modal, "editor-export-paper-size", "A5 (148 × 210 mm)");
  await page.screenshot({ path: test.info().outputPath("book-export-options.png") });
  await backToComposition(modal);
  await chooseBookOption(modal, "editor-export-language", "English (en)");
  await expect(included).toHaveCount(2); // English title page and one included chapter.
  await modal.getByRole("button", { name: "Title page", exact: true }).click();
  await expect(modal.getByRole("textbox", { name: "Author", exact: true })).toHaveValue("An Author");
  await modal.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.locator('[data-action="export-project:fixture-project-001"]').click();
  await expect(modal.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("English Book");
  await chooseBookOption(modal, "editor-export-language", "Vietnamese (vi)");
  await expect(included.last()).toHaveAttribute("data-book-item", tocId);
  await page.screenshot({ path: test.info().outputPath("book-composer.png") });
  await advanceToExport(modal);
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
const settingsDialog = (page) => page.getByRole("dialog", { name: "Settings loaded", exact: true });
async function releaseSettingsFetch(page, settings) {
  await expect.poll(() => page.evaluate(() => window.__heldSettingsRequests.length)).toBeGreaterThan(0);
  await page.evaluate((settings) => {
    for (const request of window.__heldSettingsRequests.splice(0)) {
      window.__pdfListeners["project-export-settings"]({ payload: { requestId: request.requestId, settings, error: "" } });
    }
  }, settings);
}

test("Git export settings load before the selected-language change notice", async ({ page }) => {
  await mountProjectExport(page, false, false, 3, { local: settingsDoc(settingsLayout("Local title")), holdFetch: true });
  const modal = page.getByRole("dialog", { name: "Export project", exact: true });
  const title = modal.locator('[data-book-chapter-title="fixture-chapter-0-0"]');
  await expect(title).toHaveValue("Local title");
  await releaseSettingsFetch(page, settingsDoc(settingsLayout("GitHub title")));
  const notice = settingsDialog(page);
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("Someone has saved an export configuration for this project on GitHub. We have loaded the saved settings for you.");
  await expect(title).toHaveValue("GitHub title");
  await page.screenshot({ path: test.info().outputPath("settings-loaded-notice.png") });
  await notice.getByRole("button", { name: "Ok", exact: true }).click();
  await expect(notice).toBeHidden();
  await expect(title).toHaveValue("GitHub title");
  await modal.locator('[data-book-settings-button="fixture-chapter-0-0"]').click();
  const numbered = modal.getByRole("menuitemcheckbox", { name: "Numbered", exact: true });
  await expect(numbered).toHaveAttribute("aria-checked", "false");
  await numbered.press("Escape");
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
  await advanceToExport(modal);
  await expect.poll(() => page.evaluate(() => window.__bookSettingsRequests.filter((r) => r.settings).length)).toBe(1);
  await modal.locator('[data-action="select-editor-export-option:file:pdf"]').click();
  await backToComposition(modal);
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
  await advanceToExport(modal);
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

test("long chapter titles wrap inside the sidebar without hiding controls", async ({ page }) => {
  await mountProjectExport(page);
  const modal = page.getByRole("dialog", { name: "Export project", exact: true });
  const title = modal.locator('[data-book-chapter-title="fixture-chapter-0-0"]');
  const longTitle = "Hạnh phúc, âm nhạc, vũ điệu, và nụ hôn trong cuộc sống";
  await title.fill(longTitle);
  for (const width of [1440, 1000, 700]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(title).toHaveValue(longTitle);
    const geometry = await title.evaluate((input) => {
      const row = input.closest("[data-book-item]");
      const list = row.closest(".book-composer__list");
      const bounds = (el) => el.getBoundingClientRect().toJSON();
      return { row: bounds(row), list: bounds(list), input: bounds(input),
        toggle: bounds(row.querySelector(".book-item__toggle")),
        listWidth: list.clientWidth, listScrollWidth: list.scrollWidth,
        inputHeight: input.clientHeight, inputScrollHeight: input.scrollHeight,
        lineHeight: parseFloat(getComputedStyle(input).lineHeight),
      };
    });
    expect(geometry.row.right).toBeLessThanOrEqual(geometry.list.right + 1);
    expect(geometry.toggle.right).toBeLessThanOrEqual(geometry.row.right);
    expect(geometry.input.right).toBeLessThan(geometry.toggle.left);
    expect(geometry.listScrollWidth).toBeLessThanOrEqual(geometry.listWidth + 1);
    expect(geometry.inputScrollHeight).toBeLessThanOrEqual(geometry.inputHeight + 1);
    if (width > 760) expect(geometry.input.height).toBeGreaterThan(geometry.lineHeight * 2);
    await expect(modal.getByRole("button", { name: "+ Add new", exact: true })).toBeInViewport();
  }
  await page.setViewportSize({ width: 1000, height: 900 });
  await title.fill("VeryLongUnbrokenChapterTitle".repeat(5));
  expect(await title.evaluate((input) => input.scrollWidth <= input.clientWidth + 1)).toBe(true);
  await title.fill(longTitle);
  await title.press("Enter");
  await expect(title).not.toBeFocused();
  await expect(title).toHaveValue(longTitle);
  await expect(modal).toContainText("1 of 2");
  await page.screenshot({ path: test.info().outputPath("wrapped-chapter-titles.png") });
});

test("selecting front matter focuses its navigation button instead of a chapter editor", async ({ page }) => {
  await mountProjectExport(page);
  const modal = page.getByRole("dialog", { name: "Export project", exact: true });
  for (const kind of ["title", "copyright", "dedication", "contents", "image"]) await addSection(modal, kind);
  // WebKit on macOS does not normally focus a button when it is clicked.
  // Suppress Chrome's native mousedown focus to exercise that behavior too.
  await page.evaluate(() => document.addEventListener("mousedown", (event) => {
    if (event.target.closest('.book-item__select[data-action^="book-select:"]')) event.preventDefault();
  }));
  const chapter = modal.locator('[data-book-chapter-title="fixture-chapter-0-0"]');
  const sections = modal.locator('.book-item__select[data-action^="book-select:"]');
  await expect(sections).toHaveCount(5);
  for (let index = 0; index < 5; index++) {
    await chapter.focus();
    await chapter.evaluate((input) => input.select());
    const section = sections.nth(index);
    await section.click();
    await expect(section).toHaveAttribute("aria-pressed", "true");
    await expect(section).toBeFocused();
    await expect(chapter).not.toBeFocused();
    await expect(chapter).toHaveValue("File 001");
    await expect(chapter.locator('xpath=ancestor::li')).not.toHaveClass(/is-selected/);
  }
  await modal.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.locator('[data-action="export-project:fixture-project-001"]').click();
  await expect(modal.locator('.book-item__select[data-action][aria-pressed="true"]')).toBeFocused();
  await expect(chapter).not.toBeFocused();
});


test("chapter gear menus reuse app controls and stay accessible at list edges", async ({ page }) => {
  await mountProjectExport(page, false, false, 40);
  const modal = page.getByRole("dialog", { name: "Export project", exact: true });
  const row = (index) => modal.locator(`[data-book-item="fixture-chapter-0-${index}"]`);
  const gear = (index) => row(index).getByRole("button", { name: "Settings", exact: true });
  const menu = modal.getByRole("menu", { name: "Chapter settings", exact: true });
  const numbered = menu.getByRole("menuitemcheckbox", { name: "Numbered", exact: true });
  await expect(gear(0).locator("..")).toHaveAttribute("data-tooltip", "Settings");
  await expect(gear(0)).toHaveClass(/term-variant-row__action-button/);
  await expect(gear(0).locator("svg")).toHaveAttribute("aria-hidden", "true");
  await gear(0).focus();
  await gear(0).press("ArrowDown");
  await expect(numbered).toBeFocused();
  await expect(numbered).toHaveAttribute("aria-checked", "true");
  await expect(numbered.locator("[aria-hidden]" )).toHaveText("✓");
  await expect(menu.locator("button")).toHaveCount(1);
  await numbered.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(gear(0)).toBeFocused();
  await expect(modal).toBeVisible();
  await gear(0).click();
  await numbered.press("Tab");
  await expect(menu).toHaveCount(0);
  await expect(row(0).locator(".book-item__toggle")).toBeFocused();
  await gear(0).click();
  await modal.locator(".book-composer__list").evaluate((list) => { list.scrollTop = list.scrollHeight; });
  await expect(menu).toHaveCount(0);
  for (const width of [1440, 1000, 700]) {
    await page.setViewportSize({ width, height: 900 });
    await gear(39).scrollIntoViewIfNeeded();
    const before = await modal.locator(".book-composer__list").evaluate((list) => list.scrollTop);
    await gear(39).click();
    await expect(numbered).toBeFocused();
    const cardBox = await modal.boundingBox(), menuBox = await menu.boundingBox();
    expect(menuBox.x).toBeGreaterThanOrEqual(cardBox.x);
    expect(menuBox.y).toBeGreaterThanOrEqual(cardBox.y);
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
    expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(cardBox.y + cardBox.height);
    const gearBox = await gear(39).boundingBox(), toggleBox = await row(39).locator(".book-item__toggle").boundingBox();
    expect(gearBox.x + gearBox.width).toBeLessThanOrEqual(toggleBox.x);
    expect(Math.abs(gearBox.y - toggleBox.y)).toBeLessThan(1);
    expect(await modal.locator(".book-composer__list").evaluate((list) => list.scrollTop)).toBe(before);
    if (width === 1000) await page.screenshot({ path: test.info().outputPath("chapter-gear-menu.png") });
    await numbered.press("Escape");
  }
  await row(39).locator(".book-item__toggle").click();
  await gear(39).scrollIntoViewIfNeeded();
  await expect(row(39)).toHaveAttribute("data-book-included", "false");
  await gear(39).click();
  await numbered.click();
  await gear(39).click();
  await expect(numbered).toHaveAttribute("aria-checked", "false");
  await expect(numbered.locator("[aria-hidden]")).toHaveText("");
  await modal.getByRole("button", { name: "+ Add new", exact: true }).click();
  await expect(menu).toHaveCount(0);
  await expect(gear(39)).toHaveAttribute("aria-expanded", "false");
  await expect(modal.locator('[data-book-item="fixture-chapter-0-0"]')).toHaveClass(/is-selected/);
});

test("contents form shows Rendering until Typst returns and keeps typing in place", async ({ page }) => {
  await mountProjectExport(page);
  const modal = page.getByRole("dialog", { name: "Export project", exact: true });
  await page.evaluate(() => { window.__holdPagePreview = true; });
  await addSection(modal, "contents");
  const proof = modal.locator("[data-book-page-proof]");
  await expect(proof).toHaveAttribute("aria-busy", "true");
  await expect(proof.locator(".book-proof__pending")).toContainText("Rendering…");
  await expect(proof.getByRole("status", { name: "Rendering", exact: true })).toBeVisible();
  const deliver = () => page.evaluate(() => {
    const latest = window.__pagePreviewRequests.at(-1);
    window.__pdfListeners["book-page-preview"]({ payload: { requestId: latest.requestId, error: "",
      pages: [`data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="420" height="595"><rect width="100%" height="100%" fill="white"/><text x="60" y="120">${latest.item.title}</text></svg>`)}`] } });
  });
  await expect.poll(async () => (await lastContentsPreview(page))?.item.title).toBe("Table of Contents");
  await deliver();
  await expect(modal.getByRole("img", { name: "Table of contents PDF preview", exact: true })).toBeVisible();
  await expect(proof).toHaveAttribute("aria-busy", "false");
  const title = modal.getByRole("region", { name: "Table of contents details", exact: true }).getByRole("textbox", { name: "Title", exact: true });
  await title.focus();
  await title.evaluate((element) => { window.__contentsTitle = element; element.setSelectionRange(element.value.length, element.value.length); });
  await page.keyboard.type(" of the book");
  await expect.poll(async () => (await lastContentsPreview(page))?.item.title).toBe("Table of Contents of the book");
  // The previous page stays, dimmed, beside a Rendering status until it is replaced.
  await expect(proof).toHaveAttribute("aria-busy", "true");
  await expect(proof.locator(".book-proof__status")).toContainText("Rendering…");
  await expect(modal.getByRole("img", { name: "Table of contents PDF preview", exact: true })).toBeVisible();
  await deliver();
  await expect(proof).toHaveAttribute("aria-busy", "false");
  expect(await title.evaluate((element) => ({ same: element === window.__contentsTitle, focused: document.activeElement === element, caret: element.selectionStart })))
    .toEqual({ same: true, focused: true, caret: "Table of Contents of the book".length });
  await expect(modal.locator('[data-book-item-label]').filter({ hasText: "Table of Contents of the book" })).toHaveCount(1);
  await page.screenshot({ path: test.info().outputPath("contents-typst-preview.png") });
});

test("redundancy page keeps local decisions through page 3 and reopening, and exports the exclusions", async ({ page }) => {
  await mountProjectExport(page);
  await page.evaluate(() => {
    const occurrence = (id, itemId, kind = "footnote") => ({ id, itemId, rowId: `${itemId}-row`, kind, marker: kind === "footnote" ? 1 : 0, signature: `sig-${id}`, chapterName: itemId, text: "An explanation of dependent origination.", context: "dependent origination", imageSrc: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMDAiIGhlaWdodD0iMTIwIj48cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjEyMCIgcng9IjgiIGZpbGw9IiNlZjlhMzIiLz48cGF0aCBkPSJNMjAgOTVMNzAgMzBMMTEwIDc1TDE1MCA0NUwxODUgOTVaIiBmaWxsPSIjODM1MDJkIi8+PC9zdmc+" });
    window.__redundancyResult = {
      images: [{ id: "image", occurrences: [occurrence("i1", "fixture-chapter-0-0", "image"), occurrence("i2", "fixture-chapter-0-1", "image")] }],
      footnotes: [{ id: "note", anchor: "dependent origination", occurrences: [occurrence("n1", "fixture-chapter-0-0"), occurrence("n2", "fixture-chapter-0-1")] }], warnings: [], cached: true, revisions: { "fixture-chapter-0-0": "reviewed-a", "fixture-chapter-0-1": "reviewed-b" },
    };
  });
  const modal = page.getByRole("dialog", { name: "Export project", exact: true });
  await modal.getByRole("button", { name: "Next", exact: true }).click();
  await expect(modal.getByRole("heading", { name: "Redundancy checks" })).toBeVisible();
  const checks = modal.locator("[data-book-redundancy-choice]");
  await expect(checks).toHaveCount(4);
  await expect(checks.nth(0)).toBeChecked();await expect(checks.nth(1)).not.toBeChecked();
  await expect(checks.nth(2)).toBeChecked();await expect(checks.nth(3)).not.toBeChecked();
  await page.screenshot({ path: test.info().outputPath("book-redundancy-review.png") });
  await checks.nth(1).check();
  await checks.nth(2).uncheck();
  await modal.getByRole("button", { name: "Next", exact: true }).click();
  await expect(modal.getByRole("button", { name: "Save", exact: true })).toBeVisible();
  await modal.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(checks.nth(1)).toBeChecked();await expect(checks.nth(2)).not.toBeChecked();
  await modal.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.locator('[data-action="export-project:fixture-project-001"]').click();
  await modal.getByRole("button", { name: "Next", exact: true }).click();
  await expect(checks.nth(1)).toBeChecked();await expect(checks.nth(2)).not.toBeChecked();
  await modal.getByRole("button", { name: "Next", exact: true }).click();
  await modal.getByRole("button", { name: "Save", exact: true }).click();
  const input = await page.evaluate(() => window.__projectExports.find((entry) => entry.command === "export_gtms_chapter_file").input);
  expect(input.bookItems[0].reviewRevision).toBe("reviewed-a");
  expect(input.bookItems[0].exclusions).toEqual([{ rowId: "fixture-chapter-0-0-row", kind: "footnote", marker: 1, signature: "sig-n1" }]);
  expect(input.bookItems[1].exclusions.filter((entry) => entry.kind === "image")).toHaveLength(0);
});


test("legacy footnote choices migrate locally and failed saves have an explicit retry", async ({ page }) => {
  await mountProjectExport(page);
  await page.evaluate(() => {
    window.__redundancyChoices = { legacy: false };
    const note = (id, itemId) => ({ id, itemId, rowId: `${itemId}-row`, kind: "footnote", marker: 1, signature: "signature", chapterName: itemId, text: "Equivalent definition", context: "term" });
    window.__redundancyResult = { images: [], warnings: [], footnotes: [{ id: "group", anchor: "term", occurrences: [{ ...note("current", "fixture-chapter-0-0"), choiceAliases: ["legacy"] }, note("later", "fixture-chapter-0-1")] }] };
  });
  const modal = page.getByRole("dialog", { name: "Export project", exact: true });
  await modal.getByRole("button", { name: "Next", exact: true }).click();
  const checks = modal.locator("[data-book-redundancy-choice]");
  await expect(checks).toHaveCount(2);await expect(checks.nth(0)).not.toBeChecked();
  await expect.poll(() => page.evaluate(() => window.__redundancyChoices.current)).toBe(false);
  await page.evaluate(() => { window.__failRedundancySave = true; });
  await checks.nth(1).check();
  const retry = modal.getByRole("button", { name: "Retry saving choices", exact: true });
  await expect(retry).toBeVisible();
  await modal.getByRole("button", { name: "Next", exact: true }).click();
  await expect(modal.getByRole("heading", { name: "Redundancy checks" })).toBeVisible();
  await page.evaluate(() => { window.__failRedundancySave = false; });
  await retry.click();await expect(retry).toBeHidden();await expect(checks.nth(1)).toBeChecked();
  await modal.getByRole("button", { name: "Next", exact: true }).click();
  await expect(modal.getByRole("button", { name: "Save", exact: true })).toBeVisible();
  await expect(modal.locator(".modal__error")).toHaveCount(0);
});


test("Back during a pending choice save cancels the old Next navigation", async ({ page }) => {
  await mountProjectExport(page);
  await page.evaluate(() => {
    const note = (id, itemId) => ({ id, itemId, rowId: `${itemId}-row`, kind: "footnote", marker: 1, signature: "sig", chapterName: itemId, text: "Definition", context: "term" });
    window.__redundancyResult = { images: [], warnings: [], footnotes: [{ id: "group", anchor: "term", occurrences: [note("first", "fixture-chapter-0-0"), note("second", "fixture-chapter-0-1")] }] };
    window.__holdRedundancySave = true;
  });
  const modal = page.getByRole("dialog", { name: "Export project", exact: true });
  await modal.getByRole("button", { name: "Next", exact: true }).click();
  await modal.locator("[data-book-redundancy-choice]").first().uncheck();
  await expect.poll(() => page.evaluate(() => typeof window.__releaseRedundancySave)).toBe("function");
  await modal.getByRole("button", { name: "Next", exact: true }).click();
  await modal.getByRole("button", { name: "Previous", exact: true }).click();
  await page.evaluate(() => { window.__holdRedundancySave = false; window.__releaseRedundancySave(); });
  await expect.poll(() => page.evaluate(() => window.__redundancyChoices.first)).toBe(false);
  await expect(modal.locator(".book-composer__list")).toBeVisible();
  await expect(modal.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
});


test("independent redundancy progress bypasses settings sync and preserves image controls", async ({ page }) => {
  await mountProjectExport(page);
  await page.evaluate(() => {
    window.__holdSettingsSave = true;
    window.__holdRedundancyImages = true;
    window.__holdRedundancyFootnotes = true;
    const picture = (id, itemId) => ({ id, itemId, rowId: id, kind: "image", marker: 0, signature: id, chapterName: itemId, imageSrc: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20'/%3E" });
    window.__redundancyResult = { images: [{ id: "same", occurrences: [picture("a", "fixture-chapter-0-0"), picture("b", "fixture-chapter-0-1")] }], footnotes: [], warnings: [], imageWarnings: [] };
  });
  const modal = page.getByRole("dialog", { name: "Export project", exact: true });
  await modal.getByRole("button", { name: "Next", exact: true }).click();
  await expect(modal.getByRole("heading", { name: "Redundancy checks", exact: true })).toBeVisible();
  await expect(modal.getByText("Check for redundant images and footnotes.", { exact: true })).toHaveCount(0);
  await expect(modal.getByText("Checking for new images and footnotes…")).toHaveCount(0);
  const images = modal.locator('[data-book-redundancy-section="images"]');
  const footnotes = modal.locator('[data-book-redundancy-section="footnotes"]');
  await expect(images.getByText("Checking for redundant images...", { exact: true })).toBeVisible();
  await expect(images.getByRole("status", { name: "Checking for redundant images...", exact: true })).toBeVisible();
  await expect(footnotes.getByText("Checking for redundant footnotes...", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__heldSettingsRequests.some((request) => request.settings))).toBe(true);
  await expect.poll(() => page.evaluate(() => typeof window.__publishImages)).toBe("function");
  await page.evaluate(() => window.__publishImages());
  const checks = images.locator("input");
  await expect(checks).toHaveCount(2);await expect(checks.nth(0)).toBeChecked();
  await expect(images.getByRole("status")).toHaveCount(0);
  await expect(footnotes.getByRole("status", { name: "Checking for redundant footnotes..." })).toBeVisible();
  await checks.nth(1).check();await checks.nth(1).focus();
  await checks.nth(1).evaluate((input) => { window.__originalImageControl = input; });
  await expect.poll(() => page.evaluate(() => window.__redundancyChoices["image:same:fixture-chapter-0-1"])).toBe(true);
  await page.screenshot({ path: test.info().outputPath("redundancy-independent-progress.png") });
  const phase = (name) => page.evaluate((name) => window.__pdfListeners["book-redundancy-progress"]({ payload: { requestId: window.__redundancyCalls.at(-1).requestId, phase: name, status: "loading" } }), name);
  await phase("frequencies");
  await expect(footnotes.getByText("Computing word frequency counts...", { exact: true })).toBeVisible();
  await expect(footnotes.getByRole("status", { name: "Computing word frequency counts...", exact: true })).toBeVisible();
  await phase("meanings");
  await expect(footnotes.getByText("Comparing footnote meanings...", { exact: true })).toBeVisible();
  await expect(footnotes.getByRole("status", { name: "Comparing footnote meanings...", exact: true })).toBeVisible();
  await expect(footnotes.getByText("Computing word frequency counts...", { exact: true })).toHaveCount(0);
  await expect(checks.nth(1)).toBeFocused();
  await expect(modal.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
  await page.evaluate(() => window.__finishRedundancy());
  await expect(footnotes.getByText("No redundant footnotes found.", { exact: true })).toBeVisible();
  await expect(footnotes.getByRole("status")).toHaveCount(0);
  await expect(checks.nth(1)).toBeChecked();await expect(checks.nth(1)).toBeFocused();
  expect(await checks.nth(1).evaluate((input) => input === window.__originalImageControl)).toBe(true);
  await expect(modal.getByRole("button", { name: "Next", exact: true })).toBeEnabled();
  await page.evaluate(() => {
    window.__holdSettingsSave = false;
    for (const input of window.__heldSettingsRequests) window.__pdfListeners["project-export-settings"]?.({ payload: { requestId: input.requestId, settings: input.settings, error: "" } });
  });
});

test("empty redundancy sections finish independently and failed footnotes retain images", async ({ page }) => {
  await mountProjectExport(page);
  await page.evaluate(() => { window.__holdRedundancyFootnotes = true; });
  const modal = page.getByRole("dialog", { name: "Export project", exact: true });
  await modal.getByRole("button", { name: "Next", exact: true }).click();
  await expect(modal.getByText("No redundant images found.", { exact: true })).toBeVisible();
  await expect(modal.getByText("Checking for redundant footnotes...", { exact: true })).toBeVisible();
  await page.evaluate(() => window.__finishRedundancy("Footnote check failed"));
  await expect(modal.getByText("No redundant images found.", { exact: true })).toBeVisible();
  await expect(modal.getByText("No redundant footnotes found.", { exact: true })).toHaveCount(0);
  await expect(modal.getByText("Could not finish checking for redundant footnotes.", { exact: true })).toBeVisible();
  await expect(modal.getByRole("button", { name: "Retry checks", exact: true })).toBeVisible();
});


test("equivalent Git export settings stay quiet across metadata, defaults and reopening", async ({ page }) => {
  const local = settingsDoc({ options: { pdfPaperSize: "a5" }, items: [
    { id: "fixture-chapter-0-0", kind: "chapter", chapterId: "fixture-chapter-0-0", title: "", excluded: false, numbered: true, subtitle: "", author: "", translator: "", text: "", caption: "" },
  ], selectedItemId: "fixture-chapter-0-0" });
  const remote = settingsDoc({ options: {}, items: [
    { kind: "chapter", id: "fixture-chapter-0-0" },
  ] });
  await mountProjectExport(page, false, false, 3, { local, holdFetch: true });
  const modal = page.getByRole("dialog", { name: "Export project", exact: true });
  await expect(modal.locator('[data-book-chapter-title="fixture-chapter-0-0"]')).toBeVisible();
  await releaseSettingsFetch(page, remote);
  await expect(settingsDialog(page)).toHaveCount(0);
  await modal.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__bookSettingsRequests.filter((request) => request.settings).length)).toBe(1);
  await page.locator('[data-action="export-project:fixture-project-001"]').click();
  await releaseSettingsFetch(page, remote);
  await expect(settingsDialog(page)).toHaveCount(0);
  await expect(modal.locator('[data-book-chapter-title="fixture-chapter-0-0"]')).toBeVisible();
});

test("accepted Git settings do not show a second notice when unchanged on reopening", async ({ page }) => {
  const remote = settingsDoc(settingsLayout("GitHub title"));
  await mountProjectExport(page, false, false, 3, { local: settingsDoc(settingsLayout("Local title")), holdFetch: true });
  const modal = page.getByRole("dialog", { name: "Export project", exact: true });
  await releaseSettingsFetch(page, remote);
  await expect(settingsDialog(page)).toBeVisible();
  await expect(modal.locator('[data-book-chapter-title="fixture-chapter-0-0"]')).toHaveValue("GitHub title");
  await settingsDialog(page).getByRole("button", { name: "Ok", exact: true }).click();
  await modal.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__bookSettingsRequests.filter((request) => request.settings).length)).toBe(1);
  await page.locator('[data-action="export-project:fixture-project-001"]').click();
  await releaseSettingsFetch(page, remote);
  await expect(settingsDialog(page)).toHaveCount(0);
  await expect(modal.locator('[data-book-chapter-title="fixture-chapter-0-0"]')).toHaveValue("GitHub title");
});

test("edits made while an unchanged Git fetch is pending stay quiet and are saved", async ({ page }) => {
  const saved = settingsDoc(settingsLayout("Saved title"));
  await mountProjectExport(page, false, false, 3, { local: saved, holdFetch: true });
  const modal = page.getByRole("dialog", { name: "Export project", exact: true });
  const title = modal.locator('[data-book-chapter-title="fixture-chapter-0-0"]');
  await expect(title).toHaveValue("Saved title");
  await title.fill("Edited while loading");
  await releaseSettingsFetch(page, saved);
  await expect(settingsDialog(page)).toHaveCount(0);
  await expect(title).toHaveValue("Edited while loading");
  await modal.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__bookSettingsRequests.filter((request) => request.settings).length)).toBe(1);
  const save = await page.evaluate(() => window.__bookSettingsRequests.find((request) => request.settings));
  expect(save.settings.layouts.en.items[0].title).toBe("Edited while loading");
});

test("edits made after reopening during a pending save stay quiet and are saved", async ({ page }) => {
  await mountProjectExport(page, false, false, 3, { holdFetch: true });
  const modal = page.getByRole("dialog", { name: "Export project", exact: true });
  const title = modal.locator('[data-book-chapter-title="fixture-chapter-0-0"]');
  await releaseSettingsFetch(page, null);
  await title.fill("First save");
  await page.evaluate(() => { window.__holdSettingsSave = true; });
  await modal.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__heldSettingsRequests.length)).toBe(1);
  await page.locator('[data-action="export-project:fixture-project-001"]').click();
  await title.fill("Second edit");
  const firstSave = await page.evaluate(() => {
    const request = window.__heldSettingsRequests.shift();
    window.__holdSettingsSave = false;
    window.__pdfListeners["project-export-settings"]({ payload: { requestId: request.requestId, settings: request.settings, error: "" } });
    return request.settings;
  });
  expect(firstSave.layouts.en.items[0].title).toBe("First save");
  await releaseSettingsFetch(page, firstSave);
  await expect(settingsDialog(page)).toHaveCount(0);
  await expect(title).toHaveValue("Second edit");
});


test("redundancy reports use page-one chapter titles and optional numbers", async ({ page }) => {
  await mountProjectExport(page, false, false, 5);
  const modal = page.getByRole("dialog", { name: "Export project", exact: true });
  const row = (index) => modal.locator(`[data-book-item="fixture-chapter-0-${index}"]`);
  await row(4).locator("[data-book-chapter-title]").fill("The great battle");
  await row(1).getByRole("button", { name: "Settings", exact: true }).click();
  await modal.getByRole("menuitemcheckbox", { name: "Numbered", exact: true }).click();
  await row(0).locator('[data-action^="book-exclude:"]').click();
  const radius = await row(4).locator(".term-variant-row__shell").evaluate((element) => getComputedStyle(element).borderRadius);
  await page.evaluate(() => {
    const picture = (chapter) => ({ id: `picture-${chapter}`, itemId: `fixture-chapter-0-${chapter}`, rowId: `row-${chapter}`, kind: "image", marker: 0, signature: `signature-${chapter}`, chapterName: "Stale native chapter title", imageSrc: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='100'%3E%3Crect width='160' height='100' rx='8' fill='%23ef9a32'/%3E%3C/svg%3E" });
    const footnote = (chapter, marker) => ({ id: `note-${chapter}`, itemId: `fixture-chapter-0-${chapter}`, rowId: `row-${chapter}`, kind: "footnote", marker, signature: `note-signature-${chapter}`, chapterName: "Stale native chapter title", text: "An explanation", context: "The term" });
    window.__redundancyResult = { images: [{ id: "repeated", occurrences: [picture(1), picture(3), picture(4)] }], footnotes: [{ id: "notes", anchor: "The term", occurrences: [footnote(1, 1), footnote(3, 2), footnote(4, 3)] }], warnings: [] };
  });
  await modal.getByRole("button", { name: "Next", exact: true }).click();
  const images = modal.locator('[data-book-redundancy-section="images"]');
  await expect(images.getByRole("heading", { name: "Chapters that include this image:", exact: true })).toBeVisible();
  await expect(images.locator("[data-book-redundancy-chapter-title]")).toHaveText(["File 002", "2. File 004", "3. The great battle"]);
  const footnotes = modal.locator('[data-book-redundancy-section="footnotes"]');
  await expect(footnotes.locator("[data-book-redundancy-chapter-title]")).toHaveText(["File 002", "2. File 004", "3. The great battle"]);
  await expect(footnotes.getByRole("checkbox", { name: "Include in export: 3. The great battle, note 3", exact: true })).toBeVisible();
  await expect(images.getByText("Stale native chapter title", { exact: true })).toHaveCount(0);
  const shells = images.locator(".term-variant-row__shell");
  expect(await shells.evaluateAll((elements) => elements.map((element) => getComputedStyle(element).borderRadius))).toEqual([radius, radius, radius]);
  const battle = images.getByRole("checkbox", { name: "Include in export: 3. The great battle", exact: true });
  await expect(shells.last().getByText("Include in export", { exact: true })).toBeVisible();
  await battle.check();
  await page.screenshot({ path: test.info().outputPath("redundancy-chapter-rows.png") });
  await modal.getByRole("button", { name: "Previous", exact: true }).click();
  await dragBefore(page, row(4).locator("[data-book-drag-handle]"), row(3));
  await expect(row(4).locator("[data-book-chapter-number]")).toHaveText("2.");
  await modal.getByRole("button", { name: "Next", exact: true }).click();
  await expect(images.locator("[data-book-redundancy-chapter-title]")).toHaveText(["File 002", "3. File 004", "2. The great battle"]);
  await expect(footnotes.locator("[data-book-redundancy-chapter-title]")).toHaveText(["File 002", "3. File 004", "2. The great battle"]);
  await expect(footnotes.getByRole("checkbox", { name: "Include in export: 2. The great battle, note 3", exact: true })).toBeVisible();
  await expect(images.getByRole("checkbox", { name: "Include in export: 2. The great battle", exact: true })).toBeChecked();
});
