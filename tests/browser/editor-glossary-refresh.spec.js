import { expect, test } from "./test.js";

test.use({ actionTimeout: 5000 });

async function mountEditor(page, rowCount = 2) {
  await page.addInitScript(() => {
    const term = { termId: "term-1", sourceTerms: ["alpha"], targetTerms: ["old wording"],
      targetVariantNotes: ["old variant note"], notesToTranslators: "old translator note",
      footnote: "old footnote", lifecycleState: "active" };
    window.glossaryDisk = { glossaryId: "fixture-glossary", title: "Fixture Glossary", termCount: 1,
      sourceLanguage: { code: "es", name: "Spanish" }, targetLanguage: { code: "vi", name: "Vietnamese" },
      terms: [term] };
    window.refreshCalls = [];
    window.__TAURI__ = { event: { listen: async () => () => {} }, core: { invoke: async (command, args = {}) => {
      window.refreshCalls.push(command);
      if (command === "plugin:app|version") return "0.8.133";
      if (command === "load_gtms_glossary_editor_data") {
        if (window.holdBatch && args.input.readMode !== "localSnapshot") {
          await new Promise(resolve => { window.releaseBatch = resolve; });
        }
        return { ...structuredClone(window.glossaryDisk), syncInProgress: window.holdBatch === true };
      }
      if (command === "load_gtms_glossary_term") return { term: structuredClone(window.glossaryDisk.terms[0]) };
      if (command === "sync_gtms_glossary_editor_repo") {
        if (window.holdPreflight) await new Promise(resolve => { window.releasePreflight = resolve; });
        return {};
      }
      if (command === "upsert_gtms_glossary_term") {
        window.glossaryDisk.terms = [{ ...term, ...args.input }];
        return { term: structuredClone(window.glossaryDisk.terms[0]), termCount: 1, previousHeadSha: "old-head" };
      }
      if (command === "sync_gtms_glossary_repos") {
        if (window.holdPush) await new Promise(resolve => { window.releasePush = resolve; });
        return [];
      }
      if (command === "load_gtms_chapter_editor_data") {
        if (window.holdChapter) await new Promise(resolve => { window.releaseChapter = resolve; });
        return structuredClone(window.chapterDisk);
      }
      if (command === "list_accessible_github_app_installations") {
        if (window.holdAccess) await new Promise(resolve => { window.releaseAccess = resolve; });
        return [{ installationId: 1,
          accountLogin: "fixture", accountName: "Fixture Team", accountType: "organization", membershipRole: "owner" }];
      }
      if (command === "check_internet_connection") return true;
      if (command.startsWith("list_")) return [];
      return null;
    } } };
  });
  await page.goto("/");
  await page.waitForFunction(() => typeof window.__gnosisDebug?.mountEditorFixture === "function");
  await page.evaluate(async rowCount => {
    await window.__gnosisDebug.waitForBootstrap();
    const { state } = await import("/app/state.js");
    const { queryClient, projectKeys, glossaryKeys } = await import("/app/query-client.js");
    await window.__gnosisDebug.mountEditorFixture({ rowCount, chapterStatus: "ready",
      languages: [{ code: "es", name: "Spanish", role: "source" },
        { code: "en", name: "English", role: "target" },
        { code: "vi", name: "Vietnamese", role: "target" }],
      glossarySourceLanguageCode: "es", glossaryTargetLanguageCode: "vi",
      glossaryTerms: window.glossaryDisk.terms,
      fieldsByRowId: { "fixture-row-0001": { es: "alpha", en: "inner chamber", vi: "old wording" } } });
    state.glossaries = [{ id: "fixture-glossary", repoName: "fixture-glossary",
      fullName: "fixture/fixture-glossary", title: "Fixture Glossary", lifecycleState: "active" }];
    state.editorChapter.glossary.repoName = "fixture-glossary";
    state.projects = [{ id: "fixture-project", name: "fixture-project", fullName: "fixture/fixture-project",
      chapters: [{ id: "fixture-chapter", name: "Editor Regression Fixture", status: "active",
        languages: state.editorChapter.languages, selectedSourceLanguageCode: "es", selectedTargetLanguageCode: "vi",
        linkedGlossary: { glossaryId: "fixture-glossary", repoName: "fixture-glossary" } }] }];
    state.projectsPage.visibleTeamId = state.selectedTeamId;
    state.projectsPage.visibleCacheKey = "installation:1";
    state.glossariesPage.visibleTeamId = state.selectedTeamId;
    state.glossariesPage.visibleCacheKey = "installation:1";
    queryClient.setQueryData(projectKeys.byTeam(state.selectedTeamId), {
      snapshot: { items: state.projects, deletedItems: [] }, glossaries: state.glossaries,
      discovery: { status: "ready" },
    });
    queryClient.setQueryData(glossaryKeys.byTeam(state.selectedTeamId), { glossaries: state.glossaries });
    const { buildEditorGlossaryRevisionKey, hydrateEditorDerivedGlossaryEntryState } = await import("/app/editor-derived-glossary-state.js");
    const { saveStoredEditorDerivedGlossariesForChapter } = await import("/app/editor-derived-glossary-cache.js");
    state.editorChapter.derivedGlossariesByRowId = { "fixture-row-0001": hydrateEditorDerivedGlossaryEntryState({
      status: "ready", requestKey: "fixture-derived", translationSourceLanguageCode: "en",
      glossarySourceLanguageCode: "es", targetLanguageCode: "vi", translationSourceText: "inner chamber",
      glossarySourceText: "alpha", glossarySourceTextOrigin: "row",
      glossaryRevisionKey: buildEditorGlossaryRevisionKey(state.editorChapter.glossary),
      entries: [{ sourceTerm: "inner chamber", glossarySourceTerm: "alpha",
        targetVariants: [{ text: "old wording", note: "old variant note" }],
        notes: ["old translator note"], globalNotes: ["old translator note"], footnotes: ["old footnote"] }],
    }, state.editorChapter.languages, state.editorChapter.glossary) };
    saveStoredEditorDerivedGlossariesForChapter(state.teams[0], "fixture-project", "fixture-chapter", state.editorChapter.derivedGlossariesByRowId);
    window.chapterDisk = { ...state.editorChapter, rows: structuredClone(state.editorChapter.rows) };
  }, rowCount);
  const disclosureSave = page.locator(".modal-backdrop").getByRole("button", { name: "Save" });
  if (await disclosureSave.count()) await disclosureSave.click();
}

test("a footnote edit after opening during batch sync preserves newly synced wording", async ({ page }) => {
  await mountEditor(page);
  await page.evaluate(() => { window.holdBatch = true; });
  await page.locator('[data-action="open-editor-glossary"]').click();
  await page.waitForFunction(() => typeof window.releaseBatch === "function");
  await expect(page.locator('[data-action="edit-glossary-term:term-1"]')).toHaveCount(0);
  await page.evaluate(() => {
    window.glossaryDisk.terms[0].targetTerms = ["new remote wording"];
    window.holdBatch = false;
    window.releaseBatch();
  });
  await page.locator('button[data-action="edit-glossary-term:term-1"]').first().click();
  await expect(page.locator('[data-glossary-term-variant-input][data-variant-side="target"]')).toHaveValue("new remote wording");
  await page.locator('[data-glossary-term-footnote-input]').fill("my footnote edit");
  await page.locator('[data-action="submit-glossary-term-editor"]').click();
  await expect.poll(() => page.evaluate(() => window.glossaryDisk.terms[0].footnote)).toBe("my footnote edit");
  expect(await page.evaluate(() => window.glossaryDisk.terms[0].targetTerms)).toEqual(["new remote wording"]);
});

for (const timing of ["during-push", "during-preflight", "during-chapter-reload", "saved-before-return", "virtualized", "during-access-refresh"]) {
  test(`returning from a glossary edit refreshes hovered notes (${timing})`, async ({ page }) => {
    await mountEditor(page, timing === "virtualized" ? 120 : 2);
    await page.locator('[data-action="open-editor-glossary"]').click();
    await expect(page.locator('[data-screen="glossaryEditor"]')).toBeVisible();
    await page.locator('button[data-action="edit-glossary-term:term-1"]').first().click();
    await page.locator('[data-glossary-term-notes-input]').fill("new translator note");
    await page.locator('[data-glossary-term-footnote-input]').fill("new footnote");
    await page.evaluate(timing => {
      window.holdPush = true;
      window.holdChapter = timing === "during-chapter-reload" || timing === "saved-before-return";
      window.holdPreflight = timing === "during-preflight" || timing === "during-chapter-reload";
    }, timing);
    await page.locator('[data-action="submit-glossary-term-editor"]').click();
    await expect(page.locator('[data-modal-dialog="glossary-term-editor"]')).toHaveCount(0);
    if (timing === "saved-before-return" || timing === "during-access-refresh") {
      await expect.poll(() => page.evaluate(() => typeof window.releasePush)).toBe("function");
    }
    if (timing === "during-access-refresh") {
      await page.evaluate(async () => {
        const { state } = await import("/app/state.js");
        const { queryClient, teamKeys } = await import("/app/query-client.js");
        await queryClient.invalidateQueries({ queryKey: teamKeys.currentUser(state.auth.session.login), refetchType: "none" });
        window.holdAccess = true;
      });
    }
    await page.locator('[data-nav-target="translate"]').click();
    await expect(page.locator('[data-screen="translate"]')).toBeVisible();
    try {
      if (timing === "during-access-refresh") {
        await page.waitForFunction(() => typeof window.releaseAccess === "function");
      }
      if (timing === "during-chapter-reload" || timing === "saved-before-return") {
        await expect.poll(() => page.evaluate(() => typeof window.releaseChapter)).toBe("function");
      }
      const mark = page.locator('[data-row-id="fixture-row-0001"] [data-language-code="es"] [data-editor-glossary-mark]').first();
      await mark.hover();
      if (timing === "during-preflight" || timing === "during-chapter-reload") {
        // Keep the pointer stationary while the save completes. The open hover
        // must refresh along with its underlying mark, before the chapter loads.
        await expect(page.locator(".editor-glossary-tooltip")).toContainText("old translator note");
        await page.evaluate(() => window.releasePreflight());
      }
      await expect(page.locator(".editor-glossary-tooltip")).toContainText("new translator note");
      await expect(page.locator(".editor-glossary-tooltip")).toContainText("new footnote");
      const targetMark = page.locator('[data-row-id="fixture-row-0001"] [data-language-code="vi"] [data-editor-glossary-mark]').first();
      await targetMark.hover();
      await expect(page.locator(".editor-glossary-tooltip")).toContainText("new footnote");
      if (timing === "during-access-refresh") {
        // Local hover data must be fresh even before the network access check
        // allows the chapter reload to start.
        expect(await page.evaluate(() => window.refreshCalls.includes("load_gtms_chapter_editor_data"))).toBe(false);
        await page.evaluate(() => { window.holdAccess = false; window.releaseAccess(); });
      }
      await page.evaluate(() => { window.holdChapter = false; window.releaseChapter?.(); });
      await page.waitForFunction(async () => (await import("/app/state.js")).state.editorChapter.status === "ready");
      await targetMark.hover();
      await expect(page.locator(".editor-glossary-tooltip")).toContainText("new footnote");
      expect(await page.evaluate(() => typeof window.releasePush)).toBe("function");
      const englishMark = page.locator('[data-row-id="fixture-row-0001"] [data-language-code="en"] [data-editor-glossary-mark]').first();
      await englishMark.hover();
      await expect(page.locator(".editor-glossary-tooltip")).toContainText("new footnote");
      await expect(page.locator(".editor-glossary-tooltip")).toContainText("new translator note");
    } finally {
      await page.evaluate(() => {
        window.holdAccess = window.holdPreflight = window.holdChapter = window.holdPush = false;
        window.releaseAccess?.(); window.releasePreflight?.(); window.releaseChapter?.(); window.releasePush?.();
      });
    }
  });
}

test("snapshot-backed hovers refresh when standalone sync completes", async ({ page }) => {
  await mountEditor(page);
  await page.evaluate(() => { window.holdBatch = true; });
  await page.getByRole("button", { name: "Refresh page", exact: true }).click();
  try {
    await page.waitForFunction(() => typeof window.releaseBatch === "function");
    const mark = page.locator('[data-row-id="fixture-row-0001"] [data-language-code="es"] [data-editor-glossary-mark]').first();
    await mark.hover();
    await expect(page.locator(".editor-glossary-tooltip")).toContainText("old footnote");
    await page.evaluate(() => {
      window.glossaryDisk.terms[0].footnote = "new remote footnote";
      window.holdBatch = false;
      window.releaseBatch();
    });
    // Keep the pointer stationary through the post-sync refresh.
    await expect(page.locator(".editor-glossary-tooltip")).toContainText("new remote footnote");
    const englishMark = page.locator('[data-row-id="fixture-row-0001"] [data-language-code="en"] [data-editor-glossary-mark]').first();
    await englishMark.hover();
    await expect(page.locator(".editor-glossary-tooltip")).toContainText("new remote footnote");
    expect(await page.evaluate(() => window.refreshCalls.includes("upsert_gtms_glossary_term"))).toBe(false);
  } finally {
    await page.evaluate(() => { window.holdBatch = false; window.releaseBatch?.(); });
  }
});
