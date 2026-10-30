import { expect, test } from "./test.js";

async function mountStudio(page) {
  await page.addInitScript(() => {
    let next = 0; const jobs = new Map();
    const saved = JSON.parse(localStorage.getItem("studio-test-studies") ?? "{}");
    const artifacts = JSON.parse(localStorage.getItem("studio-test-artifacts") ?? "{}");
    function expand(value) {
      if (value?._studioArtifact) {
        if (!artifacts[value._studioArtifact]) throw new Error("Missing test evidence");
        return expand(artifacts[value._studioArtifact]);
      }
      if (Array.isArray(value)) return value.map(expand);
      return value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, expand(v)])) : value;
    }
    window.studioCalls = []; window.studioHold = null; window.studioReleased = [];
    const glossary = { glossaryId: "g1", title: "Research test", sourceLanguage: { code: "en", name: "English" },
      targetLanguage: { code: "vi", name: "Vietnamese" }, terms: [], termCount: 0 };
    window.studioGlossary = glossary;
    window.__TAURI__ = { dialog: { save: async (options) => {
      (window.studioSaveDialogs ??= []).push(options);
      if (window.studioHoldExportDialog) await new Promise((resolve) => { window.releaseStudioExportDialog = resolve; });
      return window.studioExportPath === undefined ? "/tmp/research chosen.json" : window.studioExportPath;
    } }, event: { listen: async () => () => {} }, core: { invoke: async (command, args = {}) => {
      window.studioCalls.push({ command, args });
      if (command === "plugin:app|version") return "0.8.125";
      if (command === "glossary_studio_storage") {
        const { input, operation } = args;
        if (operation === "artifact-write") {
          const refs = [];
          for (const value of input.value) {
            const bytes = new TextEncoder().encode(JSON.stringify(value));
            const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
            artifacts[hash] = structuredClone(value); refs.push({ _studioArtifact: hash, bytes: bytes.length });
          }
          localStorage.setItem("studio-test-artifacts", JSON.stringify(artifacts)); return refs;
        }
        if (operation === "artifact-read") {
          if (!artifacts[input.value._studioArtifact]) throw new Error("Missing test evidence");
          return structuredClone(artifacts[input.value._studioArtifact]);
        }
        if (operation === "save") {
          if (window.studioHoldSave) {
            window.studioHoldSave = false;
            await new Promise((resolve) => { window.releaseStudioSave = resolve; });
          }
          const row = { ...input.value, revision: (saved[input.value.id]?.revision ?? 0) + 1 };
          saved[row.id] = structuredClone(row); localStorage.setItem("studio-test-studies", JSON.stringify(saved));
          return { id: row.id, revision: row.revision, updatedAt: row.updatedAt };
        }
        if (["load", "manifest"].includes(operation)) {
          const value = structuredClone(operation === "load" ? expand(saved[input.studyId]) : saved[input.studyId]);
          if (window.studioHoldLoad) await new Promise((resolve) => { window.releaseStudioLoad = resolve; });
          window.studioLoadReleased = true;
          return value;
        }
        if (operation === "export") {
          if (window.studioExportError) throw new Error(window.studioExportError);
          (window.studioExports ??= []).push({ path: input.outputPath, value: structuredClone(expand(saved[input.studyId])) });
          return null;
        }
        if (operation === "delete") {
          if (window.studioDeleteError) throw new Error(window.studioDeleteError);
          delete saved[input.studyId];
          localStorage.setItem("studio-test-studies", JSON.stringify(saved));
          return null;
        }
        return Object.values(saved).map((s) => ({ id: s.id, term: s.scope.term, step: s.step, status: s.status }));
      }
      if (command === "start_glossary_studio_tool") {
        const { kind, payload } = args.input; let value;

        if (kind === "corpus" && payload.path === "/api/sample/source-books") value = structuredClone(window.studioReferenceFixture);
        else if (kind === "corpus" && payload.path === "/api/sample/original-terms") value = {};
        else if (kind === "corpus" && payload.path === "/api/sample" && window.studioReferenceFixture) value = { items: [{ item_id: "source-p", text: "walk", occurrences: [{ start: 0, end: 4 }], representative: { doc_id: "source-a", title: "Source book" } }] };
        else if (kind === "corpus" && payload.path === "/api/search/forms") value = { candidates: [{ form: "mundo" }, { form: "mundos" }, { form: "terrible" }] };
        else if (kind === "corpus" && payload.path === "/api/sample/context") {
          if (window.studioContextError) throw new Error(window.studioContextError);
          value = structuredClone(window.studioContextResponse);
        }
        else if (kind === "corpus" && payload.path === "/api/sample") {
          const plural = payload.params.forms.toLowerCase() === "mundos";
          value = { population_distinct: plural ? 2026 : 5600, items: [{ text: plural ? "Los mundos internos." : "Todo el mundo." }] };
        }
        else if (kind === "projects" && args.input.step === "3" && window.studioSampleError) throw new Error("Project snapshot unavailable");
        else if (kind === "projects") value = { items: [
          { id: "p1", text: "I walk in the morning.", reference: { projectTitle: "Book" } },
          { id: "p2", text: "Yesterday I walked home.", reference: { projectTitle: "Book" } },
          { id: "p3", text: "She is walking home.", reference: { projectTitle: "Book" } },
        ] };
        else if (kind === "web") value = { query: payload.query, summary: "Original spelling documented in a cited dictionary source.",
          citations: [{ title: "Original-spelling source", url: "https://example.org/original-spelling" }] };
        else if (kind === "translate") value = { rows: payload.rows.map((r) => ({ rowId: r.rowId, translatedText: "Tôi đi bộ về nhà." })) };
        else if (kind === "ai") {
          const prompt = payload.prompt; const evidence = JSON.parse(prompt.split("Evidence:\n")[1]);
          if (prompt.includes("Recommend whether the human should Skip or Run")) {
            if (window.studioRecommendationError) throw new Error("Recommendation provider unavailable");
            value = window.studioRecommendationAnswer ?? { recommendation: "Run", reason: "More research could help." };
          }
          else if (prompt.includes("List genuine source-language")) value = { forms: window.studioSpanish ? ["Mundo", "mundo", "Mundos", "mundos"] : ["walk", "walked", "walking"], originLanguage: null, ...window.studioOriginProposal };
          else if (prompt.includes("Verify all proposed")) value = { forms: window.studioSpanish
            ? [{ text: "mundo", sameWord: true, found: true, reason: "The noun means world, including a realm or plane of existence. Capitalization does not establish a separate word (/doc/book-34?line=21924). ".repeat(4) },
              { text: "supramundo", sameWord: false }, { text: "Mundo", sameWord: true, found: true }, { text: "mundos", sameWord: true, found: false, reason: "The regular plural of mundo, meaning worlds. It belongs to the same lexical word. ".repeat(4) }]
            : ["walk", "walked", "walking"].map((text) => ({ text, sameWord: true, found: true, reason: "Used in the selected project" })) };
          else if (prompt.includes("Identify possible borrowed-source AUTHORS")) value = { meanings: [{ definition: "Move on foot", author: "Author A" }], summary: "Source comparison complete; no unique origin established." };
          else if (prompt.includes("Identify existing glossary")) value = { termIds: window.studioRecognizeExisting ? evidence.entries.map((entry) => entry.termId) : [] };
          else if ((prompt.includes("Infer the meanings") || prompt.includes("Infer the author's meanings"))) value = { meanings: [{ definition: "Di chuyển bằng chân", grammar: "verb" }] };
          else if (prompt.includes("Build the meaning inventory")) value = { meanings: [{ id: "m1", definition: "Di chuyển bằng chân", grammar: "verb", sourceIds: evidence.sourceMeanings.map((m) => m.sourceId) }], excludedSources: [] };
          else if (prompt.includes("Assign a meaning to EACH")) value = { paragraphMeanings: evidence.paragraphs.map((p) => ({ paragraphId: p.id, meaningIds: p.occurrences.map(() => "m1") })) };
          else if (prompt.includes("Find source expressions")) value = { splits: [] };
          else if (args.input.step === "6") value = { candidates: [{ id: "c1", text: "đi bộ", meaningIds: ["m1"], groupId: "g1", note: "Di chuyển bằng chân" }] };
          else if (prompt.includes("Which supplied target forms")) value = { candidateIds: [] };
          else if (prompt.includes("Select one initial")) value = { candidateId: "c1" };
          else if (prompt.includes("Assess EACH")) value = { choices: evidence.assignments.map((a) => ({ ...a, candidateId: "c1", rendered: "đi bộ",
            problem: window.studioEntryRepair && ["p15", "p30"].includes(a.paragraphId) && !evidence.candidates.some((c) => c.note === "Coordinated conditions for both usages") ? "Missing selection condition" : "",
          })) };
          else if (prompt.includes("Repair selection by")) value = { order: evidence.candidates.map((c) => c.id), notes: [{ candidateId: "c1", note: "Coordinated conditions for both usages" }] };
          else throw new Error(`Unexpected test question: ${prompt.slice(0, 200)}`);
        } else throw new Error(`Unexpected tool ${kind}`);
        const stage = kind === "web" ? "origin" : kind === "corpus" && payload.path === "/api/sample/context" ? "context"
          : kind === "translate" ? "preliminary" : kind === "projects" ? args.input.step === "3" ? "sample" : "corpus"
          : payload.prompt?.includes("List genuine source-language") ? "proposal"
            : payload.prompt?.includes("Recommend whether the human should Skip or Run") ? "recommendation"
              : payload.prompt?.includes("Verify all proposed") ? "verification" : payload.prompt?.includes("Repair selection by") ? "entry-repair" : null;
        const id = `job-${next++}`; jobs.set(id, { value, stage });
        if (kind === "translate" && window.studioDelayTranslationPolls) (window.studioDelayedPollJobs ??= []).push(id);
        return id;
      }
      if (command === "glossary_studio_job") {
        if (args.cancel) { jobs.delete(args.jobId); return { complete: true, cancelled: true }; }
        if (window.studioDelayedPollJobs?.includes(args.jobId)) await new Promise((resolve) => {
          (window.studioPendingPolls ??= []).push(resolve);
        });
        const job = jobs.get(args.jobId);
        if (!job) throw new Error("Research was interrupted. Resume the saved study.");
        if (job.stage && (window.studioHold === job.stage || window.studioHoldStages?.includes(job.stage)) && !window.studioReleased.includes(job.stage)) return { complete: false };
        jobs.delete(args.jobId);
        return { complete: true, value: job.value };
      }
      if (command === "load_gtms_glossary_editor_data") {
        const snapshot = structuredClone(window.studioGlossary);
        if (window.studioHoldGlossaryLoad) {
          window.studioHoldGlossaryLoad = false;
          await new Promise((resolve) => { window.releaseStudioGlossaryLoad = resolve; });
        }
        return snapshot;
      }
      if (command === "load_gtms_glossary_term") return { term: window.studioGlossary.terms.find((t) => t.termId === args.input.termId) };
      if (command === "upsert_gtms_glossary_term") {
        if (window.studioSaveError) throw new Error(window.studioSaveError);
        if (window.studioHoldUpsert) {
          window.studioHoldUpsert = false;
          await new Promise((resolve) => { window.releaseStudioUpsert = resolve; });
        }
        const term = { ...args.input, termId: args.input.termId ?? "saved-term" };
        for (const change of args.input.researchChanges ?? []) {
          const old = window.studioGlossary.terms.find((t) => t.termId === change.termId);
          old.sourceTerms = change.sourceTerms;
        }
        window.studioGlossary.terms = window.studioGlossary.terms.filter((t) => t.sourceTerms.length && t.termId !== term.termId);
        window.studioGlossary.terms.push(term);
        return { term, termCount: window.studioGlossary.terms.length, previousHeadSha: "old-head" };
      }
      if (command === "sync_gtms_glossary_editor_repo" || command === "sync_gtms_glossary_repo") return {};
      if (command === "load_broker_auth_session") return null;
      if (command === "check_internet_connection") return true;
      if (command.startsWith("list_")) return [];
      return null;
    } } };
  });
  await page.goto("/");
  await page.waitForFunction(() => window.__gnosisDebug?.waitForBootstrap);
  await page.evaluate(async () => {
    await window.__gnosisDebug.waitForBootstrap();
    const { state, createGlossaryEditorState } = await import(`/${"app"}/state.js`);
    const { openStudio } = await import(`/${"app"}/glossary-research-studio-flow.js`);
    const { renderGlossaryResearchStudio } = await import(`/${"screens"}/glossary-research-studio.js`);
    state.teams = [{ id: "team", installationId: 7, membershipRole: "owner" }]; state.selectedTeamId = "team";
    state.glossaries = [{ id: "g1", repoName: "glossary", fullName: "team/glossary" }]; state.selectedGlossaryId = "g1";
    state.projects = [{ id: "p1", title: "Book" }];
    state.glossaryEditor = { ...createGlossaryEditorState(), status: "ready", glossaryId: "g1", repoName: "glossary",
      sourceLanguage: { code: "en", name: "English" }, targetLanguage: { code: "vi", name: "Vietnamese" } };
    state.offline.isEnabled = false;
    state.telemetryDisclosureModal.isOpen = false;
    const { captureStudioDisclosures, restoreStudioDisclosures } = await import(`/${"app"}/glossary-research-studio-disclosures.js`);
    await openStudio(() => {
      const root = document.querySelector("#app"); const snapshot = captureStudioDisclosures(root);
      root.innerHTML = renderGlossaryResearchStudio(state); restoreStudioDisclosures(root, snapshot);
    });
  });
}

async function startFormsResearch(page, { resuming = false } = {}) {
  if (resuming) await expect(page.locator(".studio-recommendation")).toHaveCount(0);
  else await expect(page.locator(".studio-recommendation")).toContainText("AI recommendation: Run it.");
  await expect(page.getByRole("button", { name: "Save and continue", exact: true })).toHaveCount(0);
  const footer = page.locator('.studio-footer[data-studio-step="2a"]');
  await expect(footer.getByRole("button", { name: "Back", exact: true })).toHaveCount(0);
  // Read all positions in one DOM snapshot; progress can replace the footer.
  await expect.poll(() => footer.evaluate((element) => {
    const skip = element.querySelector('[data-action="studio:skip"]')?.getBoundingClientRect();
    const run = element.querySelector('[data-action="studio:run"]')?.getBoundingClientRect();
    const panel = element.getBoundingClientRect();
    const gap = Number.parseFloat(getComputedStyle(element).columnGap);
    return Boolean(skip && run && Math.abs(skip.y + skip.height / 2 - run.y - run.height / 2) < 1
      && Math.abs(run.x - (skip.x + skip.width) - gap) < .5 && panel.right - run.right <= 29);
  })).toBe(true);
  await page.locator('[data-action="studio:run"]').click();
  await expect(page.locator(".studio-recommendation")).toHaveCount(0);
}

async function returnToStudioHistory(page) {
  await page.getByRole("button", { name: "Glossary", exact: true }).click();
  await page.getByRole("button", { name: "Research", exact: true }).click();
  await expect(page.getByRole("button", { name: "New research", exact: true })).toBeVisible();
}

async function showExportStep(page) {
  await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`);
    const { renderGlossaryResearchStudio } = await import(`/${"screens"}/glossary-research-studio.js`);
    state.glossaryResearchStudio.study.step = "4.2";
    document.querySelector("#app").innerHTML = renderGlossaryResearchStudio(state);
  });
}

test("research content preserves its position during progress renders and keeps actions in view", async ({ page }) => {
  await mountStudio(page);
  await seedRevisitStudy(page);
  await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`);
    const { renderGlossaryResearchStudio } = await import(`/${"screens"}/glossary-research-studio.js`);
    const s = state.glossaryResearchStudio.study;
    s.step = "3";
    s.passages = Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, text: `Sample paragraph ${i}`, references: [] }));
    document.querySelector('#app').innerHTML = renderGlossaryResearchStudio(state);
  });
  for (const width of [1280, 700]) {
    await page.setViewportSize({ width, height: 700 });
    const positions = await page.evaluate(async () => {
      const { state } = await import(`/${"app"}/state.js`);
      const { renderGlossaryResearchStudio } = await import(`/${"screens"}/glossary-research-studio.js`);
      const { captureStudioDisclosures, restoreStudioDisclosures } = await import(`/${"app"}/glossary-research-studio-disclosures.js`);
      const root = document.querySelector('#app');
      const content = root.querySelector('.studio-content');
      const outline = root.querySelector('.studio-outline');
      content.scrollTop = 400;
      outline.scrollTop = 200;
      outline.scrollLeft = 200;
      const before = { content: content.scrollTop, outline: outline.scrollTop, outlineLeft: outline.scrollLeft };
      const snapshot = captureStudioDisclosures(root);
      root.innerHTML = renderGlossaryResearchStudio(state);
      restoreStudioDisclosures(root, snapshot);
      return { before, after: { content: root.querySelector('.studio-content').scrollTop, outline: root.querySelector('.studio-outline').scrollTop, outlineLeft: root.querySelector('.studio-outline').scrollLeft } };
    });
    expect(positions.before.content).toBeGreaterThan(0);
    expect(positions.after).toEqual(positions.before);
    const footer = await page.locator('.studio-footer').boundingBox();
    expect(footer.y + footer.height).toBeLessThanOrEqual(700);
    await expect(page.getByRole('button', { name: 'Save and continue', exact: true })).toBeInViewport();
  }
  const navigation = await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`);
    const { renderGlossaryResearchStudio } = await import(`/${"screens"}/glossary-research-studio.js`);
    const { captureStudioDisclosures, restoreStudioDisclosures } = await import(`/${"app"}/glossary-research-studio-disclosures.js`);
    const root = document.querySelector('#app');
    const snapshot = captureStudioDisclosures(root);
    state.glossaryResearchStudio.study.step = "12";
    root.innerHTML = renderGlossaryResearchStudio(state);
    restoreStudioDisclosures(root, snapshot);
    const current = root.querySelector('.studio-step-link[aria-current="step"]').getBoundingClientRect();
    const outline = root.querySelector('.studio-outline').getBoundingClientRect();
    return { scroll: root.querySelector('.studio-content').scrollTop, left: current.left - outline.left, right: current.right - outline.right };
  });
  expect(navigation.scroll).toBe(0);
  expect(navigation.left).toBeGreaterThanOrEqual(0);
  expect(navigation.right).toBeLessThanOrEqual(1);
});

async function seedRevisitStudy(page) {
  await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`);
    const { newStudioStudy, STUDIO_STEPS, approveStep, deduplicatePassages } = await import(`/${"app"}/glossary-research-studio-workflow.js`);
    const { saveStudioStudy } = await import(`/${"app"}/glossary-research-studio-query.js`);
    const { renderGlossaryResearchStudio } = await import(`/${"screens"}/glossary-research-studio.js`);
    const s = newStudioStudy({ installationId: 7, teamId: "team", glossaryId: "g1", repoName: "glossary", term: "walk", corpus: "projects", projectIds: ["p1"],
      sourceLanguage: { code: "en", name: "English" }, targetLanguage: { code: "vi", name: "Vietnamese" } }, "revisit-study");
    s.model = { providerId: "openai", modelId: "test" }; s.translationRuntimeVersion = "0.8.125";
    s.forms = [{ text: "walk", selected: true }]; s.formDiscovery = { version: 3, phase: "complete" };
    s.meanings = [{ id: "m1", definition: "Move on foot", enabled: true }];
    s.passages = deduplicatePassages([{ id: "p1", text: "I walk home." }], ["walk"], "en");
    s.assignments = [{ paragraphId: "p1", occurrenceId: "o0", meaningId: "m1" }];
    s.candidates = [{ id: "c1", text: "đi bộ", note: "Original guidance", meaningIds: ["m1"], selected: true, confirmed: true, retained: true }];
    for (const { id } of STUDIO_STEPS.slice(0, -1)) {
      const value = id === "1" ? s.scope : id === "2a" ? { forms: s.forms } : id === "4.5" ? { meanings: s.meanings }
        : id === "4.6" ? { meanings: s.meanings, assignments: s.assignments } : id === "6" ? { candidates: s.candidates }
          : id === "5" ? { skipped: true } : { complete: true, summary: "Saved finding" };
      await approveStep(s, id, value); s.steps[id].value = structuredClone(value);
    }
    s.step = "11"; s.status = "complete"; s.savedTermId = "saved-entry";
    s.tests = { "8:m1": { passed: true }, "9:0": { passed: true } }; s.rounds = { "9:0": 2 };
    s.retentionReviewed = true; s.usage = { c1: { occurrences: 1, paragraphs: 1 } };
    s.draft = { targetTerms: ["đi bộ"] };
    const saved = await saveStudioStudy(s); s.revision = saved.revision; s.updatedAt = saved.updatedAt;
    state.glossaryResearchStudio.study = s;
    window.revisitBaseline = JSON.stringify(s.steps); window.revisitCalls = window.studioCalls.length;
    document.querySelector("#app").innerHTML = renderGlossaryResearchStudio(state);
  });
}

test("clicking saved steps and continuing unchanged only changes the displayed step", async ({ page }) => {
  await mountStudio(page); await seedRevisitStudy(page);
  await page.locator('[data-action="studio:visit:6"]').click();
  await expect(page.getByRole("heading", { name: "6 · Translation candidates", exact: true })).toBeVisible();
  await expect(page.locator('.studio-step-link[aria-current="step"]')).toHaveText("6 · Translation candidates ✓");
  await page.locator('[data-action="studio:next"]').click();
  await expect(page.getByRole("heading", { name: "7 · Standardize spelling", exact: true })).toBeVisible();
  await page.locator('[data-action="studio:visit:5"]').click();
  await page.locator('[data-action="studio:next"]').click();
  await expect(page.getByRole("heading", { name: "6 · Translation candidates", exact: true })).toBeVisible();
  expect(await page.evaluate(async () => {
    const s = (await import(`/${"app"}/state.js`)).state.glossaryResearchStudio.study;
    return { stepsUnchanged: JSON.stringify(s.steps) === window.revisitBaseline, status: s.status,
      newCalls: window.studioCalls.slice(window.revisitCalls) };
  })).toEqual({ stepsUnchanged: true, status: "complete", newCalls: [] });
});

test("a revisited edit waits for confirmation, Cancel restores it, and Continue clears dependent results", async ({ page }) => {
  await mountStudio(page); await seedRevisitStudy(page);
  await page.locator('[data-action="studio:visit:6"]').click();
  await page.evaluate(async () => {
    const view = (await import(`/${"app"}/state.js`)).state.glossaryResearchStudio;
    view.study.pendingDecision = { kind: "progress", report: "Previous paused trial", rounds: 5 };
    view.decisionStep = "9"; view.hideDecision = true;
  });
  await page.getByText("Usage notes and editing", { exact: true }).click();
  await page.locator('[data-studio-field="candidates.0.note"]').fill("Original guidance");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.locator('[data-studio-field="candidates.0.note"]').fill("Concise guidance");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Redo this step?", exact: true })).toBeVisible();
  await expect(dialog).toContainText("Changing the data in this form means you will need to redo this step and any later steps that depend on it. Do you want to continue editing?");
  expect(await page.evaluate(async () => {
    const s = (await import(`/${"app"}/state.js`)).state.glossaryResearchStudio.study;
    return { note: s.candidates[0].note, passed: s.tests["9:0"].passed, stepsUnchanged: JSON.stringify(s.steps) === window.revisitBaseline };
  })).toEqual({ note: "Original guidance", passed: true, stepsUnchanged: true });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator('[data-studio-field="candidates.0.note"]')).toHaveValue("Original guidance");
  await page.locator('[data-studio-field="candidates.0.note"]').fill("Concise guidance");
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('[data-studio-field="candidates.0.note"]')).toHaveValue("Concise guidance");
  for (const id of ["7", "8", "9", "10a", "10b", "11"]) {
    await expect(page.locator(`[data-action="studio:visit:${id}"]`)).toBeDisabled();
    await expect(page.locator(`[data-action="studio:visit:${id}"]`)).toContainText("undone");
  }
  expect(await page.evaluate(async () => {
    const s = (await import(`/${"app"}/state.js`)).state.glossaryResearchStudio.study;
    return { tests: s.tests, rounds: s.rounds, draft: s.draft, retention: s.retentionReviewed, source: s.steps["4.6"].status,
      savedTermId: s.savedTermId, status: s.status, calls: window.studioCalls.slice(window.revisitCalls).filter((c) => c.command === "start_glossary_studio_tool") };
  })).toEqual({ tests: {}, rounds: {}, draft: null, retention: false, source: "complete", savedTermId: "saved-entry", status: "active", calls: [] });
  expect(await page.evaluate(async () => {
    const view = (await import(`/${"app"}/state.js`)).state.glossaryResearchStudio;
    return { decision: view.study.pendingDecision, hidden: view.hideDecision };
  })).toEqual({ decision: null, hidden: false });
  // Subsequent keystrokes do not ask again after the dependent outputs are gone.
  await page.locator('[data-studio-field="candidates.0.note"]').fill("Refined concise guidance");
  await expect(dialog).toHaveCount(0);
  await page.screenshot({ path: "/tmp/gnosis-studio-revisit-steps.png", fullPage: true });
  await page.locator('[data-action="studio:next"]').click();
  await expect(page.getByRole("heading", { name: "7 · Standardize spelling", exact: true })).toBeVisible();
  await expect(page.locator('[data-action="studio:visit:8"]')).toHaveText("8 · Test each meaning · undone");
});

test("reopening a study while revisiting stale work does not automatically ask AI for advice", async ({ page }) => {
  await mountStudio(page); await seedRevisitStudy(page);
  await page.evaluate(async () => {
    const s = (await import(`/${"app"}/state.js`)).state.glossaryResearchStudio.study;
    s.status = "active"; s.steps["4.3"].status = "stale";
  });
  await page.locator('[data-action="studio:visit:4.3"]').click();
  await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`);
    const { saveStudioStudy } = await import(`/${"app"}/glossary-research-studio-query.js`);
    const { studioAction } = await import(`/${"app"}/glossary-research-studio-flow.js`);
    const { renderGlossaryResearchStudio } = await import(`/${"screens"}/glossary-research-studio.js`);
    await saveStudioStudy(state.glossaryResearchStudio.study);
    await studioAction("studio:resume:revisit-study", () => { document.querySelector("#app").innerHTML = renderGlossaryResearchStudio(state); });
  });
  await expect(page.getByRole("heading", { name: "4.3 · Word parts", exact: true })).toBeVisible();
  await expect(page.locator('[data-action="studio:visit:4.3"]')).toContainText("needs review");
  await page.locator('[data-action="studio:next"]').click();
  await expect(page.getByRole("heading", { name: "4.4.1 · Bibliographical sources", exact: true })).toBeVisible();
  await expect(page.locator('[data-action="studio:visit:4.3"]')).toContainText("needs review");
  expect(await page.evaluate(() => window.studioCalls.filter((call) => call.command === "start_glossary_studio_tool"))).toEqual([]);
});

test("redoing saved research warns before running tools and cancellation preserves skipped and completed steps", async ({ page }) => {
  await mountStudio(page); await seedRevisitStudy(page);
  await page.locator('[data-action="studio:visit:4.2"]').click();
  await page.getByRole("button", { name: "Redo this step", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await page.evaluate(() => window.studioCalls.slice(window.revisitCalls))).toEqual([]);
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator('[data-action="studio:visit:5"]')).toContainText("skipped");
  await expect(page.locator('[data-action="studio:visit:9"]')).toContainText("✓");
  await page.getByRole("button", { name: "Redo this step", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator('[data-action="studio:next"]')).toBeEnabled();
  await expect(page.locator('[data-action="studio:visit:5"]')).toHaveText("5 · Compounds and phrases · undone");
  expect(await page.evaluate(() => window.studioCalls.slice(window.revisitCalls).some((c) => c.command === "start_glossary_studio_tool"))).toBe(true);
});

test("research export uses the save picker, shared tooltip and selected JSON path", async ({ page }) => {
  await mountStudio(page);
  await page.getByRole("button", { name: "New research", exact: true }).click();
  await page.getByLabel("Term to research").fill("ilustre");
  await page.evaluate(() => { window.studioExportPath = "/tmp/selected folder/ilustre discussion.json"; });
  await expect(page.locator('[data-action="studio:export"]')).toHaveCount(0);
  await showExportStep(page);
  const button = page.locator('[data-action="studio:export"]');
  await expect(button).toHaveAttribute("data-tooltip", "export a summary of the data uncovered during the research process in a JSON format appropriate for sending it to an AI for further discussion.");
  await button.click();
  await expect.poll(() => page.evaluate(() => window.studioExports?.length ?? 0)).toBe(1);
  const exported = await page.evaluate(() => ({ dialogs: window.studioSaveDialogs, saved: window.studioExports[0] }));
  expect(exported.dialogs).toEqual([{ title: "Export research", defaultPath: "glossary-research-ilustre.json", filters: [{ name: "JSON", extensions: ["json"] }] }]);
  expect(exported.saved.path).toBe("/tmp/selected folder/ilustre discussion.json");
  expect(exported.saved.value.scope.term).toBe("ilustre");
});

test("cancelling export performs no snapshot work and duplicate clicks share one picker", async ({ page }) => {
  await mountStudio(page);
  await page.getByRole("button", { name: "New research", exact: true }).click();
  await page.evaluate(() => { window.studioExportPath = null; window.studioHoldExportDialog = true; window.studioCalls = []; });
  await showExportStep(page);
  await page.locator('[data-action="studio:export"]').click();
  await expect(page.locator('[data-action="studio:export"]')).toBeDisabled();
  await page.evaluate(async () => {
    const { studioAction } = await import(`/${"app"}/glossary-research-studio-flow.js`);
    const { state } = await import(`/${"app"}/state.js`);
    const { renderGlossaryResearchStudio } = await import(`/${"screens"}/glossary-research-studio.js`);
    await studioAction("studio:export", () => { document.querySelector("#app").innerHTML = renderGlossaryResearchStudio(state); });
    window.releaseStudioExportDialog();
  });
  await expect(page.locator('[data-action="studio:export"]')).toBeEnabled();
  expect(await page.evaluate(() => ({ dialogs: window.studioSaveDialogs.length,
    writes: window.studioCalls.filter((c) => c.command === "glossary_studio_storage").length }))).toEqual({ dialogs: 1, writes: 0 });
});

test("export errors leave running research, its error and retry pointer intact", async ({ page }) => {
  await mountStudio(page);
  await page.getByRole("button", { name: "New research", exact: true }).click();
  await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`);
    const { renderGlossaryResearchStudio } = await import(`/${"screens"}/glossary-research-studio.js`);
    const view = state.glossaryResearchStudio;
    view.busy = true; view.error = "Research status"; view.study.error = "Research status";
    view.study.lastToolSignature = "research-pointer"; window.studioExportError = "Selected folder is read-only";
    document.querySelector("#app").innerHTML = renderGlossaryResearchStudio(state);
  });
  await showExportStep(page);
  await page.locator('[data-action="studio:export"]').click();
  await expect(page.locator('[data-action="studio:export"]')).toBeEnabled();
  const result = await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`); const view = state.glossaryResearchStudio;
    return { busy: view.busy, viewError: view.error, error: view.study.error, pointer: view.study.lastToolSignature,
      notice: state.statusBadges.left.text, exported: window.studioExports?.length ?? 0 };
  });
  expect(result).toEqual({ busy: true, viewError: "Research status", error: "Research status", pointer: "research-pointer", notice: "Selected folder is read-only", exported: 0 });
});

test("the outline identifies preserved stale work and previous Skip decisions without starting research", async ({ page }) => {
  await mountStudio(page);
  await page.getByRole("button", { name: "New research", exact: true }).click();
  await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`);
    const { renderGlossaryResearchStudio } = await import(`/${"screens"}/glossary-research-studio.js`);
    const s = state.glossaryResearchStudio.study; s.scope.term = "ilustre"; s.step = "8";
    for (const id of ["4.7", "6", "7"]) s.steps[id] = { status: "stale", approved: { summary: "Preserved findings" } };
    s.steps["5"] = { status: "stale", approved: { _studioArtifact: "a".repeat(64), skipped: true } };
    document.querySelector("#app").innerHTML = renderGlossaryResearchStudio(state);
  });
  const outline = page.getByRole("complementary", { name: "Research steps", exact: true });
  await expect(outline.getByText("4.7 · Split entries · needs review", { exact: true })).toBeVisible();
  await expect(outline.getByText("5 · Compounds and phrases · previously skipped; needs review", { exact: true })).toBeVisible();
  await expect(outline.getByText("6 · Translation candidates · needs review", { exact: true })).toBeVisible();
  await expect(outline.getByText("7 · Standardize spelling · needs review", { exact: true })).toBeVisible();
  await expect(outline.getByText("9 · Test complete entry", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.studioCalls.filter((c) => c.command === "start_glossary_studio_tool").length)).toBe(0);
  await page.screenshot({ path: "/tmp/gnosis-studio-step-statuses.png", fullPage: true });
});

test("Skip recommendation waits for the human, who can run the step anyway", async ({ page }) => {
  await mountStudio(page);
  await page.evaluate(() => { window.studioRecommendationAnswer = { recommendation: "Skip", reason: "The supplied forms already cover this entry." }; });
  await page.getByRole("button", { name: "New research", exact: true }).click();
  await page.getByLabel("Term to research").fill("walk");
  await page.getByRole("listbox", { name: "Projects", exact: true }).selectOption("p1");
  await page.getByRole("button", { name: "Begin research", exact: true }).click();
  await expect(page.getByRole("heading", { name: "AI recommendation: Skip it.", exact: true })).toBeVisible();
  await expect(page.locator(".studio-recommendation")).toBeInViewport();
  const formsBox = await page.getByRole("list", { name: "Entered forms", exact: true }).boundingBox();
  const guidanceBox = await page.getByText("Choose Run this step to search for more, or Skip this step to use only these.", { exact: true }).boundingBox();
  const adviceBox = await page.locator(".studio-recommendation").boundingBox();
  expect(formsBox.y + formsBox.height).toBeLessThan(guidanceBox.y);
  expect(guidanceBox.y + guidanceBox.height).toBeLessThan(adviceBox.y);
  const explanation = page.getByText("The supplied forms already cover this entry.", { exact: true });
  await expect(explanation).toBeHidden();
  await page.getByText("Show reasoning", { exact: true }).click();
  await expect(explanation).toBeVisible();
  await page.getByText("Show reasoning", { exact: true }).press("Enter");
  await expect(explanation).toBeHidden();
  const before = await page.evaluate(async () => {
    const s = (await import(`/${"app"}/state.js`)).state.glossaryResearchStudio.study;
    return { step: s.step, record: s.steps["2a"], calls: window.studioCalls.filter((c) => c.command === "start_glossary_studio_tool").map((c) => c.args.input.step) };
  });
  expect(before).toEqual({ step: "2a", record: undefined, calls: ["recommendation:2a"] });
  await page.screenshot({ path: "/tmp/gnosis-studio-skip-recommendation.png", fullPage: true });
  await page.getByRole("button", { name: "Run this step", exact: true }).click();
  await expect(page.getByLabel("Source form", { exact: true }).first()).toBeEnabled();
  await expect(page.getByLabel("Source form", { exact: true })).toHaveCount(3);
});

for (const choice of ["Run", "Skip"]) test(`${choice} works before the recommendation arrives, which is then discarded`, async ({ page }) => {
  await mountStudio(page);
  await page.evaluate(() => { window.studioHold = "recommendation"; });
  await page.getByRole("button", { name: "New research", exact: true }).click();
  await page.getByLabel("Term to research").fill("walk");
  await page.getByRole("listbox", { name: "Projects", exact: true }).selectOption("p1");
  await page.getByRole("button", { name: "Begin research", exact: true }).click();
  await expect(page.locator(".studio-recommendation")).toContainText("Considering whether this research step would help");
  const footer = page.locator('.studio-footer[data-studio-step="2a"]');
  await expect(footer.locator('[data-action="studio:run"]')).toHaveClass(/button--primary/u);
  await expect(footer.locator('[data-action="studio:skip"]')).not.toHaveClass(/button--primary/u);
  await expect(footer.getByRole("button", { name: "Pause research", exact: true })).toHaveCount(0);
  await footer.getByRole("button", { name: `${choice} this step`, exact: true }).click();
  if (choice === "Run") await expect(page.getByLabel("Source form", { exact: true })).toHaveCount(3);
  else await expect(page.getByRole("heading", { name: "4.1 · Dictionary", exact: true })).toBeVisible();
  const saved = await page.evaluate(async () => {
    const s = (await import(`/${"app"}/state.js`)).state.glossaryResearchStudio.study;
    return { status: s.steps["2a"]?.status, advice: s.skipRecommendations?.["2a"] ?? null,
      cancellations: window.studioCalls.filter((c) => c.command === "glossary_studio_job" && c.args.cancel).length };
  });
  expect(saved).toEqual({ status: choice === "Run" ? "awaiting-review" : "skipped", advice: null, cancellations: 1 });
});

test("uncertainty recommends Run, while a human Skip preserves only the entered forms", async ({ page }) => {
  await mountStudio(page);
  await page.evaluate(() => { window.studioRecommendationAnswer = { recommendation: "Not sure", reason: "Unknown." }; });
  await page.getByRole("button", { name: "New research", exact: true }).click();
  await page.getByLabel("Term to research").fill("walk");
  await page.getByLabel("Additional forms or spellings (one per line)").fill("walked");
  await page.getByRole("listbox", { name: "Projects", exact: true }).selectOption("p1");
  await page.getByRole("button", { name: "Begin research", exact: true }).click();
  await expect(page.getByRole("heading", { name: "AI recommendation: Run it.", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Skip this step", exact: true }).click();
  await expect(page.getByRole("heading", { name: "4.1 · Dictionary", exact: true })).toBeVisible();
  const result = await page.evaluate(async () => {
    const s = (await import(`/${"app"}/state.js`)).state.glossaryResearchStudio.study;
    return { status: s.steps["2a"].status, forms: s.forms.map((f) => f.text),
      searches: window.studioCalls.filter((c) => c.args.input?.payload?.prompt?.includes("List genuine source-language")).length };
  });
  expect(result).toEqual({ status: "skipped", forms: ["walk", "walked"], searches: 0 });
});

test("automatic sampling stops on errors and proceeds only after a successful retry", async ({ page }) => {
  await mountStudio(page);
  await page.evaluate(() => { window.studioSampleError = true; });
  await page.getByRole("button", { name: "New research", exact: true }).click();
  await page.getByLabel("Term to research").fill("walk");
  await page.getByRole("listbox", { name: "Projects", exact: true }).selectOption("p1");
  await page.getByRole("button", { name: "Begin research", exact: true }).click();
  await expect(page.getByRole("heading", { name: "AI recommendation: Run it.", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Skip this step", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Project snapshot unavailable");
  await expect(page.getByRole("heading", { name: "3 · Research sample", exact: true })).toBeVisible();
  const status = await page.evaluate(async () => (await import(`/${"app"}/state.js`)).state.glossaryResearchStudio.study.steps["2b"].status);
  expect(status).toBe("complete");
  await page.evaluate(() => { window.studioSampleError = false; });
  await page.getByRole("button", { name: "Retry this step", exact: true }).click();
  await expect(page.getByRole("heading", { name: "4.1 · Dictionary", exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("automatic sampling respects Pause and resumes without skipping its evidence", async ({ page }) => {
  await mountStudio(page);
  await page.evaluate(() => { window.studioHold = "sample"; });
  await page.getByRole("button", { name: "New research", exact: true }).click();
  await page.getByLabel("Term to research").fill("walk");
  await page.getByRole("listbox", { name: "Projects", exact: true }).selectOption("p1");
  await page.getByRole("button", { name: "Begin research", exact: true }).click();
  await expect(page.getByRole("heading", { name: "AI recommendation: Run it.", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Skip this step", exact: true }).click();
  await expect(page.getByRole("heading", { name: "3 · Research sample", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Pause research", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause research", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "3 · Research sample", exact: true })).toBeVisible();
  await page.evaluate(() => { window.studioHold = null; });
  await page.locator('[data-action="studio:run"]').click();
  await expect(page.getByRole("heading", { name: "4.1 · Dictionary", exact: true })).toBeVisible();
  const saved = await page.evaluate(async () => {
    const s = (await import(`/${"app"}/state.js`)).state.glossaryResearchStudio.study;
    return { status: s.steps["3"].status, paragraphs: s.passages.length };
  });
  expect(saved).toEqual({ status: "complete", paragraphs: 1 });
});

test("reopening an empty completed result advances without repeating research and sidebar inspection stays put", async ({ page }) => {
  await mountStudio(page);
  await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`);
    const { newStudioStudy } = await import(`/${"app"}/glossary-research-studio-workflow.js`);
    const { saveStudioStudy } = await import(`/${"app"}/glossary-research-studio-query.js`);
    const s = newStudioStudy({ installationId: 7, teamId: "team", glossaryId: "g1", repoName: "glossary", term: "walk",
      corpus: "projects", projectIds: ["p1"], sourceLanguage: { code: "en", name: "English" }, targetLanguage: { code: "vi", name: "Vietnamese" } }, "empty-result");
    s.step = "4.3"; s.model = { providerId: "openai", modelId: "test" }; s.translationRuntimeVersion = "0.8.125";
    s.steps["4.3"] = { status: "awaiting-review", value: { parts: [], meanings: [], summary: "No separate word components." } };
    await saveStudioStudy(s);
  });
  await page.getByRole("button", { name: "Glossary", exact: true }).click();
  await page.getByRole("button", { name: "Research", exact: true }).click();
  await page.getByRole("button", { name: "Open study", exact: true }).click();
  await expect(page.getByRole("heading", { name: "4.4.2 · Internet sources", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.studioCalls.filter((call) => call.command === "start_glossary_studio_tool"
    && call.args.input.step === "4.3").length)).toBe(0);
  await expect.poll(() => page.evaluate(async () => Boolean((await import(`/${"app"}/state.js`)).state.glossaryResearchStudio.saving))).toBe(false);
  await page.locator('[data-action="studio:visit:4.3"]').click();
  await expect(page.getByRole("heading", { name: "4.3 · Word parts", exact: true })).toBeVisible();
  await expect(page.getByText("No separate word components.", { exact: true })).toBeVisible();
});

test("leaving automatic sampling cancels continuation and preserves the unfinished checkpoint", async ({ page }) => {
  await mountStudio(page);
  await page.evaluate(() => { window.studioHold = "sample"; });
  await page.getByRole("button", { name: "New research", exact: true }).click();
  await page.getByLabel("Term to research").fill("walk");
  await page.getByRole("listbox", { name: "Projects", exact: true }).selectOption("p1");
  await page.getByRole("button", { name: "Begin research", exact: true }).click();
  await expect(page.getByRole("heading", { name: "AI recommendation: Run it.", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Skip this step", exact: true }).click();
  await expect(page.getByRole("heading", { name: "3 · Research sample", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Glossary", exact: true }).click();
  await expect(page.getByRole("button", { name: "Research", exact: true })).toBeVisible();
  await page.evaluate(() => { window.studioHold = null; });
  const result = await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`); const s = state.glossaryResearchStudio.study;
    return { screen: state.screen, step: s.step, sampleStatus: s.steps["3"]?.status ?? null,
      dictionaryCalls: window.studioCalls.filter((call) => call.command === "start_glossary_studio_tool" && call.args.input.step === "recommendation:4.1").length };
  });
  expect(result).toEqual({ screen: "glossaryEditor", step: "3", sampleStatus: null, dictionaryCalls: 0 });
});

test("unchanged recommendations survive outline navigation, changed inputs refresh them, and provider failure leaves Run available", async ({ page }) => {
  await mountStudio(page);
  await page.getByRole("button", { name: "New research", exact: true }).click();
  await page.getByLabel("Term to research").fill("walk");
  await page.getByRole("listbox", { name: "Projects", exact: true }).selectOption("p1");
  const next = () => page.locator('[data-action="studio:next"]').click();
  const advice = () => expect(page.getByRole("heading", { name: "AI recommendation: Run it.", exact: true })).toBeVisible();
  const count = () => page.evaluate(() => window.studioCalls.filter((c) => c.args.input?.step === "recommendation:2a").length);
  await next(); await advice(); expect(await count()).toBe(1);
  await expect(page.getByText("More research could help.", { exact: true })).toBeHidden();
  await page.getByText("Show reasoning", { exact: true }).click();
  await expect(page.getByText("More research could help.", { exact: true })).toBeVisible();
  await page.locator('[data-action="studio:visit:1"]').click();
  await next(); await advice(); expect(await count()).toBe(1);
  await expect(page.getByRole("button", { name: "Refresh recommendation", exact: true })).toHaveCount(0);
  await page.locator('[data-action="studio:visit:1"]').click();
  await page.locator('[data-action="studio:visit:2a"]').click();
  await advice(); expect(await count()).toBe(1);
  await returnToStudioHistory(page);
  await page.getByRole("button", { name: "Open study", exact: true }).click();
  await advice(); expect(await count()).toBe(1);
  await page.locator('[data-action="studio:visit:1"]').click();
  await page.getByLabel("Term to research").fill("walking");
  await page.getByRole("dialog").getByRole("button", { name: "Continue", exact: true }).click();
  await next(); await advice(); expect(await count()).toBe(2);
  await page.evaluate(() => { window.studioRecommendationError = true; });
  await page.locator('[data-action="studio:visit:1"]').click();
  await page.getByLabel("Additional forms or spellings (one per line)").fill("walked");
  await page.getByRole("dialog").getByRole("button", { name: "Continue", exact: true }).click();
  await next(); await advice();
  await expect(page.locator(".studio-recommendation")).toContainText("could not be completed");
  await expect(page.locator(".studio-recommendation-reason > p")).toBeHidden();
  await page.getByText("Show reasoning", { exact: true }).click();
  await expect(page.locator(".studio-recommendation-reason > p")).toBeVisible();
  await expect(page.getByRole("button", { name: "Run this step", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Skip this step", exact: true })).toBeEnabled();
  expect(await count()).toBe(3);
});

test("step 1 edits after completed forms automatically produce new advice without clearing timing history", async ({ page }) => {
  await mountStudio(page);
  await page.getByRole("button", { name: "New research", exact: true }).click();
  await page.getByLabel("Term to research").fill("walk");
  await page.getByRole("listbox", { name: "Projects", exact: true }).selectOption("p1");
  await page.getByRole("button", { name: "Begin research", exact: true }).click();
  await startFormsResearch(page);
  await expect(page.getByLabel("Source form", { exact: true }).first()).toBeEnabled();
  await page.locator('[data-action="studio:visit:1"]').click();
  await page.getByLabel("Term to research").fill("walking");
  await page.getByRole("dialog").getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Begin research", exact: true }).click();
  await expect(page.getByRole("heading", { name: "AI recommendation: Run it.", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh recommendation", exact: true })).toHaveCount(0);
  const result = await page.evaluate(async () => {
    const s = (await import(`/${"app"}/state.js`)).state.glossaryResearchStudio.study;
    return { adviceCalls: window.studioCalls.filter((c) => c.args.input?.step === "recommendation:2a").length,
      researchRuns: s.timing.steps["2a"].runs.length, discovery: s.formDiscovery };
  });
  expect(result).toEqual({ adviceCalls: 2, researchRuns: 1, discovery: null });
});

test("source summary is shown as 4.4.3, waits for a choice and warns before discarding source research", async ({ page }) => {
  await mountStudio(page);
  await page.getByRole("button", { name: "New research", exact: true }).click();
  await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`);
    const { approveStep } = await import(`/${"app"}/glossary-research-studio-workflow.js`);
    const { renderGlossaryResearchStudio } = await import(`/${"screens"}/glossary-research-studio.js`);
    const s = state.glossaryResearchStudio.study; s.step = "4.4.2";
    await approveStep(s, "4.4.1", { summary: "Useful source finding.", meanings: [{ definition: "Move on foot" }] });
    document.querySelector("#app").innerHTML = renderGlossaryResearchStudio(state);
  });
  await page.getByRole("button", { name: "Skip this step", exact: true }).click();
  await expect(page.getByRole("heading", { name: "4.4.3 · Source summary", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "AI recommendation: Run it.", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run this step", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Skip this step", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("source research");
  await page.getByRole("button", { name: "Don't skip", exact: true }).click();
  expect(await page.evaluate(async () => (await import(`/${"app"}/state.js`)).state.glossaryResearchStudio.study.steps["4.4.1"].status)).toBe("complete");
  await page.getByRole("button", { name: "Run this step", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save and continue", exact: true })).toBeEnabled();
});

async function mountContextReview(page) {
  await mountStudio(page);
  await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`);
    const { newStudioStudy, deduplicatePassages, buildStudioDraft, stableSignature, entryBatchSignature } = await import(`/${"app"}/glossary-research-studio-workflow.js`);
    const { renderGlossaryResearchStudio } = await import(`/${"screens"}/glossary-research-studio.js`);
    const s = newStudioStudy({ ...state.glossaryEditor, installationId: 7, teamId: "team", term: "walk", corpus: "projects" }, "context-review");
    s.step = "9"; s.model = {}; s.lastToolSignature = "paused-ai-request";
    s.forms = [{ text: "walk" }]; s.meanings = [{ id: "m1", definition: "Move on foot" }];
    s.passages = deduplicatePassages([{ id: "p", text: "walk", contextBefore: ["Nearest paragraph"], contextAfter: [],
      reference: { line_id: 100, doc_id: "source-a", context_url: "/api/sample/context?line_id=100&context=3" } }], ["walk"]);
    s.assignments = [{ paragraphId: "p", occurrenceId: "o0", meaningId: "m1" }];
    s.candidates = [{ id: "c1", text: "đi bộ", meaningIds: ["m1"], confirmed: true, selected: true, retained: true }];
    s.tests = { "9:0": { phase: "9", passed: true, rounds: 0, signature: stableSignature(buildStudioDraft(s)),
      batchSignature: entryBatchSignature(s, s.passages, s.assignments), assignmentRevision: 0,
      translations: [{ paragraphId: "p", source: "walk", translation: "đi bộ" }],
      choices: [{ paragraphId: "p", occurrenceId: "o0", candidateId: "c1", rendered: "đi bộ", passed: true, problem: "" }] } };
    s.steps["8"] = { status: "approved" }; s.steps["9"] = { status: "approved" };
    s.decisionInput = { meaningReview: "m1" };
    window.studioContextResponse = { line_id: 100, doc_id: "source-a", text: "walk",
      context_before: ["Earlier decisive fact", "Middle paragraph", "Nearest paragraph"], context_after: ["First after", "Second after", "Third after"] };
    state.glossaryResearchStudio = { study: s, history: [], modal: { kind: "meaningReview", paragraphId: "p", occurrenceId: "o0" } };
    document.querySelector("#app").innerHTML = renderGlossaryResearchStudio(state);
  });
}

test("occurrence review loads wider source evidence without extra examples or AI calls and saves it for resume", async ({ page }) => {
  await mountContextReview(page);
  await page.evaluate(() => { window.studioHold = "context"; });
  await page.getByRole("button", { name: "Load wider context", exact: true }).click();
  await expect(page.getByText("Loading wider source context…", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save meaning", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeEnabled();
  await page.evaluate(() => { window.studioReleased.push("context"); });
  await expect(page.getByText("Wider source context loaded:", { exact: false })).toBeVisible();
  await page.getByRole("dialog").getByText("Surrounding source context", { exact: true }).click();
  await expect(page.getByRole("dialog").getByText("Earlier decisive fact", { exact: true })).toBeVisible();
  const result = await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`);
    const { entryTrialsAreCurrent } = await import(`/${"app"}/glossary-research-studio-workflow.js`);
    const s = state.glossaryResearchStudio.study;
    const calls = window.studioCalls.filter((c) => c.command === "start_glossary_studio_tool");
    const saved = await window.__TAURI__.core.invoke("glossary_studio_storage", { operation: "load", input: { studyId: s.id } });
    return { rows: s.passages.length, occurrences: s.assignments.length, oldPointer: s.lastToolSignature,
      current: entryTrialsAreCurrent(s), review: s.assignmentReviewPending,
      calls: calls.map((c) => ({ kind: c.args.input.kind, payload: c.args.input.payload })), savedBefore: saved.passages[0].contextBefore };
  });
  expect(result).toEqual({ rows: 1, occurrences: 1, oldPointer: "paused-ai-request", current: false, review: true,
    calls: [{ kind: "corpus", payload: { path: "/api/sample/context", params: { line_id: 100, context: 3 } } }],
    savedBefore: ["Earlier decisive fact", "Middle paragraph", "Nearest paragraph"] });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retest meanings", exact: true })).toBeVisible();
});

test("cancelling a wider-context load keeps source evidence and a later review independent", async ({ page }) => {
  await mountContextReview(page);
  await page.evaluate(() => { window.studioHold = "context"; });
  await page.getByRole("button", { name: "Load wider context", exact: true }).click();
  await expect(page.getByText("Loading wider source context…", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.studioCalls.filter((c) => c.command === "glossary_studio_job" && c.args.cancel).length)).toBe(1);
  const unchanged = await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`); const s = state.glossaryResearchStudio.study;
    window.studioReleased.push("context"); window.studioContextResponse.context_before[0] = "Fresh review fact";
    return { before: s.passages[0].contextBefore, pointer: s.lastToolSignature, expanded: s.expandedContextIds ?? [] };
  });
  expect(unchanged).toEqual({ before: ["Nearest paragraph"], pointer: "paused-ai-request", expanded: [] });
  await page.getByText(/Passed · Translation batch 1/, { exact: false }).first().click();
  await page.getByText("All trial translations (1 paragraph)", { exact: true }).click();
  await page.getByRole("button", { name: "Review occurrence 1", exact: true }).click();
  await page.getByRole("button", { name: "Load wider context", exact: true }).click();
  await expect(page.getByText("Wider source context loaded:", { exact: false })).toBeVisible();
  await page.getByRole("dialog").getByText("Surrounding source context", { exact: true }).click();
  await expect(page.getByRole("dialog").getByText("Fresh review fact", { exact: true })).toBeVisible();
});

test("wider-context identity errors keep evidence intact and Retry obtains a fresh result", async ({ page }) => {
  await mountContextReview(page);
  await page.evaluate(() => { window.studioContextResponse.doc_id = "wrong-document"; });
  await page.getByRole("button", { name: "Load wider context", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("does not match this source paragraph");
  await expect(page.getByRole("button", { name: "Save meaning", exact: true })).toBeEnabled();
  expect(await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`); return state.glossaryResearchStudio.study.passages[0].contextBefore;
  })).toEqual(["Nearest paragraph"]);
  await page.evaluate(() => { window.studioContextResponse.doc_id = "source-a"; });
  await page.getByRole("button", { name: "Retry loading context", exact: true }).click();
  await expect(page.getByText("Wider source context loaded:", { exact: false })).toBeVisible();
  expect(await page.evaluate(() => window.studioCalls.filter((c) => c.command === "start_glossary_studio_tool").map((c) => c.args.input.payload._researchRetry ?? 0))).toEqual([0, 1]);
});

test("English-source studio completes research, reuses previous-step results and shows occurrence/paragraph counts", async ({ page }) => {
  await mountStudio(page);
  await page.getByRole("button", { name: "New research", exact: true }).click();
  await page.getByLabel("Term to research").fill("walk");
  await page.getByRole("listbox", { name: "Projects", exact: true }).selectOption("p1");
  const next = () => page.locator('[data-action="studio:next"]').click();
  const heading = (text) => expect(page.getByRole("heading", { name: text, exact: true })).toBeVisible();
  await next(); await heading("2a · List other forms and spellings");
  await startFormsResearch(page);
  await expect(page.getByLabel("Source form", { exact: true })).toHaveCount(3);
  await expect(page.getByLabel("Source form", { exact: true }).first()).toBeEnabled();
  const calls = await page.evaluate(() => window.studioCalls.filter((c) => c.command === "start_glossary_studio_tool").length);
  await page.locator('[data-action="studio:visit:1"]').click();
  await next(); await heading("2a · List other forms and spellings");
  expect(await page.evaluate(() => window.studioCalls.filter((c) => c.command === "start_glossary_studio_tool").length)).toBe(calls);
  await next(); await heading("4.1 · Dictionary");
  await page.getByRole("button", { name: "Skip this step", exact: true }).click();
  await heading("4.2 · Corpus meanings"); await next(); await heading("4.3 · Word parts");
  await page.getByRole("button", { name: "Skip this step", exact: true }).click();
  await heading("4.4.2 · Internet sources");
  await page.getByRole("button", { name: "Skip this step", exact: true }).click();
  await heading("4.5 · Review meanings");
  await expect(page.getByText(/source summary \(4.4.3\) is skipped automatically/)).toBeVisible();
  await next(); await heading("4.6 · Assign meanings");
  await page.getByText("Show usage examples (3 paragraphs)").click();
  for (let i = 0; i < 3; i += 1) {
    await page.getByRole("button", { name: "Show preliminary translation", exact: true }).first().click();
    await expect(page.getByText("Preliminary translation", { exact: true })).toHaveCount(i + 1);
  }
  await expect(page.getByText("Tôi đi bộ về nhà.", { exact: true })).toHaveCount(3);
  await expect(page.getByText("Preliminary translation", { exact: true })).toHaveCount(3);
  await expect(page.getByText("Judge meanings from the original English text.", { exact: false })).toBeVisible();
  await next(); await heading("5 · Compounds and phrases");
  await page.getByRole("button", { name: "Skip this step", exact: true }).click();
  await heading("6 · Translation candidates"); await next(); await heading("10a · Review usage");
  await expect(page.getByText("3 occurrences across 3 paragraphs", { exact: true })).toBeVisible();
  const testedCalls = await page.evaluate(() => window.studioCalls.filter((c) => c.command === "start_glossary_studio_tool").length);
  await page.locator('[data-action="studio:visit:6"]').click();
  await heading("6 · Translation candidates");
  for (let i = 0; i < 4; i += 1) await next();
  await heading("10a · Review usage");
  expect(await page.evaluate(() => window.studioCalls.filter((c) => c.command === "start_glossary_studio_tool").length)).toBe(testedCalls);
  await expect(page.getByText("3 occurrences across 3 paragraphs", { exact: true })).toBeVisible();
  await next(); await heading("11 · Save glossary entry");
});

async function seedPreliminaryStudy(page) {
  await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`);
    const { newStudioStudy, deduplicatePassages } = await import(`/${"app"}/glossary-research-studio-workflow.js`);
    const { renderGlossaryResearchStudio } = await import(`/${"screens"}/glossary-research-studio.js`);
    const s = newStudioStudy({ installationId: 7, teamId: "team", glossaryId: "g1", repoName: "glossary", term: "walk",
      corpus: "projects", sourceLanguage: { code: "en", name: "English" }, targetLanguage: { code: "vi", name: "Vietnamese" } });
    s.step = "4.6"; s.model = { providerId: "openai", modelId: "test" }; s.forms = [{ text: "walk" }];
    s.passages = deduplicatePassages(Array.from({ length: 31 }, (_, i) => ({ id: `p${i}`, text: `I walk home ${i}.` })), ["walk"], "en");
    s.population = s.passages; s.meanings = [{ id: "m1", definition: "Di chuyển bằng chân" }];
    state.glossaryResearchStudio.study = s;
    window.studioHold = "preliminary";
    document.querySelector("#app").innerHTML = renderGlossaryResearchStudio(state);
  });
}

test("preliminary reading aids are lazy, cancellable, cached, and do not repeat assignment", async ({ page }) => {
  await mountStudio(page); await seedPreliminaryStudy(page);
  await page.getByRole("button", { name: "Run this step", exact: true }).click();
  await expect(page.getByText("Show usage examples (31 paragraphs)", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.studioCalls.filter((c) => c.command === "start_glossary_studio_tool" && c.args.input.kind === "translate").length)).toBe(0);
  await page.getByText("Show usage examples (31 paragraphs)", { exact: true }).click();
  await page.getByRole("button", { name: "Show preliminary translation", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("button", { name: "Show preliminary translation", exact: true }).first()).toBeEnabled();
  const cancelled = await page.evaluate(() => window.studioCalls.filter((c) => c.command === "glossary_studio_job" && c.args.cancel));
  expect(cancelled).toHaveLength(1);
  await page.evaluate(() => { window.studioReleased.push("preliminary"); });
  await page.getByRole("button", { name: "Show preliminary translation", exact: true }).first().click();
  await expect(page.getByText("Preliminary translation", { exact: true })).toHaveCount(1);
  await expect(page.getByRole("alert")).toHaveCount(0);
  const assignments = await page.evaluate(() => window.studioCalls.filter((c) => c.command === "start_glossary_studio_tool" && c.args.input.payload.prompt?.includes("Assign a meaning to EACH")).length);
  expect(assignments).toBe(1);
});

test("late cancelled reading polls do not clear a later request", async ({ page }) => {
  await mountStudio(page); await seedPreliminaryStudy(page);
  await page.getByRole("button", { name: "Run this step", exact: true }).click();
  await page.getByText("Show usage examples (31 paragraphs)", { exact: true }).click();
  await page.evaluate(() => { window.studioDelayTranslationPolls = true; });
  await page.getByRole("button", { name: "Show preliminary translation", exact: true }).first().click();
  await expect.poll(() => page.evaluate(() => window.studioPendingPolls?.length ?? 0)).toBe(1);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.evaluate(() => { window.studioDelayTranslationPolls = false; });
  await page.getByRole("button", { name: "Show preliminary translation", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
  await page.evaluate(async () => { window.studioPendingPolls.forEach((resolve) => resolve()); await new Promise((resolve) => setTimeout(resolve, 0)); });
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.evaluate(() => { window.studioReleased.push("preliminary"); });
  await expect(page.getByText("Preliminary translation", { exact: true })).toHaveCount(1);
});

async function seedCollision(page, { uppercase = false } = {}) {
  await page.evaluate(async (useUppercase) => {
    const { state } = await import(`/${"app"}/state.js`);
    const { newStudioStudy, deduplicatePassages } = await import(`/${"app"}/glossary-research-studio-workflow.js`);
    const { setCachedGlossaryEditorPayload } = await import(`/${"app"}/glossary-editor-query.js`);
    const { renderGlossaryResearchStudio } = await import(`/${"screens"}/glossary-research-studio.js`);
    const old = { termId: "old", sourceTerms: useUppercase ? ["WALK", "WALKED"] : ["walk", "walked"], targetTerms: ["old translation"], targetVariantNotes: ["old note"], notesToTranslators: "Keep this", footnote: "", untranslated: false, lifecycleState: "active" };
    window.studioGlossary.terms = [old]; state.glossaryEditor.terms = [old];
    setCachedGlossaryEditorPayload(state.teams[0], state.glossaries[0], window.studioGlossary);
    state.auth.session = { sessionToken: "fake-browser-test", login: "tester" };
    const s = newStudioStudy({ installationId: 7, teamId: "team", glossaryId: "g1", repoName: "glossary",
      term: "walk", corpus: "projects", sourceLanguage: { code: "en", name: "English" }, targetLanguage: { code: "vi", name: "Vietnamese" } });
    s.model = { providerId: "openai", modelId: "test" }; s.step = "10b";
    s.forms = [{ text: "walk" }, { text: "walked" }]; s.meanings = [{ id: "m1", definition: "Di chuyển bằng chân" }];
    s.candidates = [{ id: "c1", text: "đi bộ", meaningIds: ["m1"], confirmed: true, retained: true }];
    s.passages = deduplicatePassages([{ id: "p1", text: "I walk home." }], ["walk", "walked"], "en");
    s.assignments = [{ paragraphId: "p1", occurrenceId: "o0", meaningId: "m1" }];
    state.glossaryResearchStudio.study = s;
    document.querySelector("#app").innerHTML = renderGlossaryResearchStudio(state);
  }, uppercase);
}

test("mixed collisions remain staged through editor cancellation and survive reopening", async ({ page }) => {
  await mountStudio(page); await seedCollision(page, { uppercase: true });
  await page.locator('[data-studio-collision="walk"]').selectOption("overwrite");
  await page.locator('[data-studio-collision="walked"]').selectOption("keep");
  await page.getByRole("button", { name: "Save and continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "11 · Save glossary entry", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open term editor", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "New Term", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.studioCalls.filter((c) => c.command === "upsert_gtms_glossary_term").length)).toBe(0);
  await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`);
    Object.assign(state.glossaryTermEditor, { error: "An old save failed", failedIntentKey: "old-failure" });
  });
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("heading", { name: "12 · Split-entry queue", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.studioGlossary.terms[0].sourceTerms)).toEqual(["WALK", "WALKED"]);
  expect(await page.evaluate(async () => (await import(`/${"app"}/state.js`)).state.glossaryResearchStudio.study.steps["11"]?.status)).not.toBe("complete");
  await page.locator('[data-action="studio:visit:11"]').click();
  await page.getByRole("button", { name: "Open term editor", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "New Term", exact: true })).toBeVisible();
  const reopened = await page.evaluate(async () => (await import(`/${"app"}/state.js`)).state.glossaryTermEditor);
  expect(reopened.error).toBe("");
  expect(reopened.failedIntentKey).not.toBe("old-failure");
  expect(reopened.sourceTerms).toEqual(["walk"]);
  await page.getByRole("dialog").getByRole("button", { name: "Save entry", exact: true }).click();
  await expect(page.getByRole("heading", { name: "12 · Split-entry queue", exact: true })).toBeVisible();
  const writes = await page.evaluate(() => window.studioCalls.filter((c) => c.command === "upsert_gtms_glossary_term").map((c) => c.args.input));
  expect(writes).toHaveLength(1);
  expect(writes[0].sourceTerms).toEqual(["walk"]);
  expect(writes[0].researchChanges[0].sourceTerms).toEqual(["WALKED"]);
  const savedCheckpoint = await page.evaluate(async () => {
    const s = (await import(`/${"app"}/state.js`)).state.glossaryResearchStudio.study;
    const { resolveStudioEvidence } = await import(`/${"app"}/glossary-research-studio-evidence.js`);
    return { ...s.steps["11"], approved: await resolveStudioEvidence(s, s.steps["11"].approved) };
  });
  expect(savedCheckpoint.status).toBe("complete");
  expect(savedCheckpoint.approved.savedTermId).toBe("saved-term");
  await page.getByRole("button", { name: "Finish research", exact: true }).click();
  await page.getByRole("button", { name: "Return to glossary", exact: true }).click();
  await expect(page.getByText("WALKED", { exact: true })).toBeVisible();
  await expect(page.getByText("walk", { exact: true })).toBeVisible();
  await expect(page.getByText("WALK, WALKED", { exact: true })).toHaveCount(0);
});

test("five-round Stop checkpoints survive reload and reopen for an explicit decision", async ({ page }) => {
  await mountStudio(page); await seedCollision(page);
  await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`);
    const { renderGlossaryResearchStudio } = await import(`/${"screens"}/glossary-research-studio.js`);
    const s = state.glossaryResearchStudio.study;
    s.step = "8"; s.rounds["8:m1"] = 5; s.reports["m1:5"] = { report: "Five rounds completed. Verb forms still need review." };
    s.pendingDecision = { kind: "progress", reportKey: "m1:5", rounds: 5, report: s.reports["m1:5"].report };
    document.querySelector("#app").innerHTML = renderGlossaryResearchStudio(state);
  });
  await page.getByRole("dialog").getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Review paused research", exact: true })).toBeVisible();
  await mountStudio(page);
  await page.getByRole("button", { name: "Open study", exact: true }).click();
  await expect(page.getByRole("dialog").getByText("Five rounds completed. Verb forms still need review.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.studioCalls.filter((c) => c.command === "start_glossary_studio_tool").length)).toBe(0);
});

test("split studies retain their parent and shared temporary glossary without automatically running optional compounds", async ({ page }) => {
  await mountStudio(page); await seedCollision(page);
  await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`);
    const { renderGlossaryResearchStudio } = await import(`/${"screens"}/glossary-research-studio.js`);
    const s = state.glossaryResearchStudio.study;
    s.step = "12"; s.meanings[0].splitOff = true;
    s.queue = ["walk home", "walk in"].map((form, i) => ({ id: `split-${i}`, status: "queued", forms: [form],
      meaningId: "m1", targetTerms: ["đi bộ"], passages: s.passages, assignments: s.assignments }));
    document.querySelector("#app").innerHTML = renderGlossaryResearchStudio(state);
  });
  const parentId = await page.evaluate(async () => (await import(`/${"app"}/state.js`)).state.glossaryResearchStudio.study.id);
  await page.getByRole("button", { name: "Continue split-entry queue", exact: true }).click();
  await page.evaluate(() => { window.studioHoldSave = true; });
  await page.getByRole("dialog").getByRole("button", { name: "Continue", exact: true }).click();
  try {
    await expect(page.getByRole("dialog").getByRole("button", { name: "Opening study…", exact: true })).toBeDisabled();
    await expect(page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
    await expect(page.getByRole("dialog").getByRole("status", { name: "Opening compound research", exact: true })).toBeVisible();
    await expect(page.getByRole("dialog").getByText("Opening compound research…", { exact: true })).toBeVisible();
    await page.evaluate(async () => {
      const { continueQueue } = await import(`/${"app"}/glossary-research-studio-flow.js`);
      await continueQueue();
    });
    expect(await page.evaluate(() => window.studioCalls.filter((c) => c.command === "glossary_studio_storage" && c.args.operation === "save").length)).toBe(1);
  } finally { await page.evaluate(() => window.releaseStudioSave?.()); }
  await expect(page.getByRole("heading", { name: "5 · Compounds and phrases", exact: true })).toBeVisible();
  const child = await page.evaluate(async () => (await import(`/${"app"}/state.js`)).state.glossaryResearchStudio.study);
  expect(child.parentId).toBe(parentId);
  expect(child.translationRuntimeVersion).toBe("0.8.125");
  expect(child.temporaryEntries.map((e) => e.sourceTerms)).toEqual([["walk in"]]);
  expect(child.passages[0].text).toBe("I walk home.");
  await expect(page.getByRole("heading", { name: "AI recommendation: Run it.", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.studioCalls.filter((c) => c.command === "start_glossary_studio_tool").map((c) => c.args.input.step))).toEqual(["recommendation:5"]);
  await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`);
    const { renderGlossaryResearchStudio } = await import(`/${"screens"}/glossary-research-studio.js`);
    const s = state.glossaryResearchStudio.study; s.step = "11";
    s.candidates = [{ id: "c1", text: "đi bộ", meaningIds: ["m1"], confirmed: true, retained: true }];
    document.querySelector("#app").innerHTML = renderGlossaryResearchStudio(state);
  });
  await page.getByRole("button", { name: "Open term editor", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "New Term", exact: true })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Save entry", exact: true }).click();
  await expect(page.getByRole("heading", { name: "12 · Split-entry queue", exact: true })).toBeVisible();
  const saved = await page.evaluate((id) => JSON.parse(localStorage.getItem("studio-test-studies"))[id], child.id);
  expect(saved.status).toBe("complete");
  expect(await page.evaluate(async () => (await import(`/${"app"}/state.js`)).state.glossaryResearchStudio.study.id)).toBe(parentId);
});

test("step 2a recommends before searching, then expands forms when the researcher runs it", async ({ page }) => {
  await mountStudio(page);
  await page.getByRole("button", { name: "New research", exact: true }).click();
  await page.getByLabel("Term to research").fill("walk");
  await page.getByLabel("Additional forms or spellings (one per line)").fill("walked");
  await page.getByRole("listbox", { name: "Projects", exact: true }).selectOption("p1");
  await page.getByRole("button", { name: "Begin research", exact: true }).click();
  await expect(page.getByRole("heading", { name: "AI recommendation: Run it.", exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`);
    const { studioStageActivities } = await import(`/${"app"}/glossary-research-studio-activity.js`);
    const { renderGlossaryResearchStudio } = await import(`/${"screens"}/glossary-research-studio.js`);
    const s = state.glossaryResearchStudio.study;
    s.activitySteps = { "2a": { items: studioStageActivities(s).filter((item) => item.id !== "origin") } };
    window.studioHold = "proposal";
    document.querySelector("#app").innerHTML = renderGlossaryResearchStudio(state);
  });
  const work = page.getByRole("region", { name: "Work in this step", exact: true });
  await expect(work).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Entered forms", exact: true })).toHaveText("walkwalked");
  await expect(page.getByLabel("Source form", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await page.locator('[data-action="studio:run"]').click();
  await expect(work.locator(":scope > .studio-work-list > li")).toHaveCount(5);
  await expect(work.getByText("Verify original spelling", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Source form", { exact: true })).toHaveCount(0);
  await page.evaluate(() => { window.studioReleased.push("proposal"); });
  await expect(page.getByLabel("Source form", { exact: true })).toHaveCount(3);
  await expect(page.getByLabel("Source form", { exact: true }).first()).toBeEnabled();
  await expect(page.getByRole("button", { name: "Run this step", exact: true })).toHaveCount(0);
  const known = await page.evaluate(() => {
    const call = window.studioCalls.find((c) => c.command === "start_glossary_studio_tool" && c.args.input.payload.prompt?.includes("List genuine source-language"));
    return JSON.parse(call.args.input.payload.prompt.split("Evidence:\n")[1]).userForms;
  });
  expect(known).toEqual(["walk", "walked"]);
  await page.locator('.studio-form').filter({ has: page.locator('input[value="walking"]') }).getByRole("checkbox").uncheck();
  await page.getByRole("button", { name: "Add spelling or form", exact: true }).click();
  await page.getByLabel("Source form", { exact: true }).last().fill("walks");
  await page.getByRole("button", { name: "Save and continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "4.1 · Dictionary", exact: true })).toBeVisible();
  const selected = await page.evaluate(async () => (await import(`/${"app"}/state.js`)).state.glossaryResearchStudio.study.forms.filter((f) => f.selected).map((f) => f.text));
  expect(selected).toEqual(["walk", "walked", "walks"]);
});


test("step 2a shows live candidates and corpus progress while each search phase is still running", async ({ page }) => {
  await mountStudio(page);
  await page.getByRole("button", { name: "New research", exact: true }).click();
  await page.getByLabel("Term to research").fill("walk");
  await page.getByRole("listbox", { name: "Projects", exact: true }).selectOption("p1");
  await page.evaluate(() => { window.studioHold = "proposal"; });
  await page.getByRole("button", { name: "Begin research", exact: true }).click();
  const work = page.getByRole("region", { name: "Work in this step", exact: true });
  await expect(work).toHaveCount(0);
  await startFormsResearch(page);
  await expect(page.getByLabel("Source form", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("status", { name: "In progress: Find additional forms and spellings", exact: true })).toBeVisible();
  await expect(page.locator(".studio-work-announcement")).toContainText("Looking for additional forms and spellings");
  await page.evaluate(() => { window.studioReleased.push("proposal"); window.studioHold = "corpus"; });
  await expect(page.getByLabel("Source form", { exact: true })).toHaveCount(0);
  await expect(work).toContainText("3 forms proposed: walk, walked, walking.");
  await expect(page.locator(".studio-work-announcement")).toContainText("Reading selected project texts");
  await page.evaluate(() => { window.studioReleased.push("corpus"); window.studioHold = "verification"; });
  await expect(work).toContainText("We found 3 forms used in the selected projects:");
  await expect(work.getByRole("list", { name: "Forms found in the corpus", exact: true }).getByRole("listitem")).toHaveText([
    "walk — 1 matching paragraph", "walked — 1 matching paragraph", "walking — 1 matching paragraph",
  ]);
  await expect(work.getByText(/^1 exact matching paragraphs\./u)).toHaveCount(3);
  await expect(work.getByText(/^1 exact matching paragraphs\./u).first()).toBeHidden();
  await work.getByText("Check details", { exact: true }).click();
  await expect(work.getByText(/^1 exact matching paragraphs\./u).first()).toBeVisible();
  await expect(page.locator(".studio-work-announcement")).toContainText("Verifying which forms are the same word");
  await expect(page.getByRole("button", { name: "Save and continue", exact: true })).toHaveCount(0);
  await page.evaluate(() => { window.studioReleased.push("verification"); });
  await expect(page.getByLabel("Source form", { exact: true }).first()).toBeEnabled();
  await expect(page.locator('.studio-work [data-work-state="running"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save and continue", exact: true })).toBeEnabled();
});

for (const width of [1280, 700]) test(`completed step 2a puts review last and scrolls down once at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 700 });
  await mountStudio(page);
  await page.evaluate(() => { window.studioHold = "verification"; });
  await page.getByRole("button", { name: "New research", exact: true }).click();
  await page.getByLabel("Term to research").fill("walk");
  await page.getByRole("listbox", { name: "Projects", exact: true }).selectOption("p1");
  await page.getByRole("button", { name: "Begin research", exact: true }).click();
  await startFormsResearch(page);
  await expect(page.locator(".studio-work-announcement")).toContainText("Verifying which forms are the same word");
  const review = page.locator("[data-studio-forms-review]");
  await expect(review).toHaveCount(0);
  await page.locator(".studio-content").evaluate((element) => { element.scrollTop = 0; });
  await page.evaluate(() => { window.studioReleased.push("verification"); });
  await expect(review.getByLabel("Source form", { exact: true })).toHaveCount(3);
  await expect(review.locator(":scope > p").first()).toBeInViewport();
  const layout = await page.locator(".studio-content").evaluate((element) => {
    const review = element.querySelector("[data-studio-forms-review]");
    return { scroll: element.scrollTop, workBottom: element.querySelector(".studio-work").getBoundingClientRect().bottom,
      reviewTop: review.getBoundingClientRect().top, contentTop: element.getBoundingClientRect().top,
      padding: Number.parseFloat(getComputedStyle(element).paddingTop), reviewLast: element.lastElementChild === review };
  });
  expect(layout.scroll).toBeGreaterThan(0);
  expect(layout.workBottom).toBeLessThan(layout.reviewTop);
  expect(layout.reviewLast).toBe(true);
  expect(layout.reviewTop - layout.contentTop).toBeCloseTo(layout.padding, 0);
  await expect(page.getByRole("heading", { name: "2a · List other forms and spellings", exact: true })).toBeInViewport();
  await expect(page.getByRole("button", { name: "Save and continue", exact: true })).toBeInViewport();
  await page.screenshot({ path: `/tmp/gnosis-studio-bottom-review-${width}.png`, fullPage: true });
  const after = await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`);
    const { renderGlossaryResearchStudio } = await import(`/${"screens"}/glossary-research-studio.js`);
    const { captureStudioDisclosures, restoreStudioDisclosures } = await import(`/${"app"}/glossary-research-studio-disclosures.js`);
    const root = document.querySelector("#app"); root.querySelector(".studio-content").scrollTop = 0;
    const snapshot = captureStudioDisclosures(root);
    root.innerHTML = renderGlossaryResearchStudio(state); restoreStudioDisclosures(root, snapshot);
    return root.querySelector(".studio-content").scrollTop;
  });
  expect(after).toBe(0);
});

test("original-spelling findings have a clean preview and formatted complete report", async ({ page }) => {
  await mountStudio(page);
  await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`);
    const { newStudioStudy } = await import(`/${"app"}/glossary-research-studio-workflow.js`);
    const { renderGlossaryResearchStudio } = await import(`/${"screens"}/glossary-research-studio.js`);
    const study = newStudioStudy({ term: "Hierofantes", sourceLanguage: { code: "es", name: "Spanish" }, targetLanguage: { code: "vi", name: "Vietnamese" } }, "formatted-findings");
    const summary = "## Findings\n\n**The Ancient Greek headword is *ἱεροφάντης*.** Spanish uses *hierofante* (singular) and *hierofantes* (plural) (/doc/book-34?line=21924).\n\n### Attested forms\n\n- **Greek:** ἱεροφάντης\n- **Spanish:** hierofante\n\n| Form | Language |\n| --- | --- |\n| ἱεροφάντης | Ancient Greek |\n| hierofante | Spanish |\n\n### Source evidence\n\n> A cited dictionary attests the spelling (/doc/lecture-287?line=87357).\n\nSee [Dictionary entry](https://example.org/original-spelling).\n\n" + "Additional quoted evidence remains available for review. ".repeat(35) + "\n\n### Uncertainty\n\nFinal caveat beyond the saved activity receipt.";
    study.step = "2a";
    study.formDiscovery = { version: 3, phase: "checking-origin" };
    study.origin = { proposal: { originLanguage: "grc", originTerm: "ἱεροφάντης" }, evidence: { summary } };
    study.activitySteps = { "2a": { items: [{ id: "origin", label: "Verify original spelling", status: "complete", children: [
      { id: "search", label: "Search cited dictionary and book sources", status: "complete", children: [
        { id: "operation:web", status: "complete", result: summary.slice(0, 1800) + "…" },
      ] },
    ] }] } };
    state.glossaryResearchStudio = { ...state.glossaryResearchStudio, study, busy: false };
    document.querySelector("#app").innerHTML = renderGlossaryResearchStudio(state);
  });
  const search = page.locator(".studio-work-item").filter({ has: page.locator(":scope > .studio-work-heading", { hasText: "Search cited dictionary and book sources" }) });
  const preview = search.locator(":scope > .studio-work-result");
  await expect(preview).toHaveText("The Ancient Greek headword is ἱεροφάντης. Spanish uses hierofante (singular) and hierofantes (plural).");
  await expect(search.getByRole("heading", { name: "Findings", exact: true })).toBeHidden();
  await page.screenshot({ path: "/tmp/gnosis-studio-findings-collapsed.png", fullPage: true });
  await search.getByText("Read full findings", { exact: true }).click();
  await expect(search.getByRole("heading", { name: "Findings", exact: true })).toBeVisible();
  await expect(search.locator("strong").first()).toHaveText("The Ancient Greek headword is ἱεροφάντης.");
  await expect(search.locator("em").first()).toHaveText("ἱεροφάντης");
  await expect(search.getByRole("table")).toBeVisible();
  await expect(search.getByRole("link", { name: "Dictionary entry", exact: true })).toHaveAttribute("href", "https://example.org/original-spelling");
  await expect(search.getByText("Final caveat beyond the saved activity receipt.", { exact: true })).toBeAttached();
  await expect(search.locator(".studio-report")).not.toContainText("##");
  await expect(search).not.toContainText("/doc/");
  expect(await page.evaluate(async () => (await import(`/${"app"}/state.js`)).state.glossaryResearchStudio.study.origin.evidence.summary)).toContain("/doc/book-34?line=21924");
  await page.screenshot({ path: "/tmp/gnosis-studio-findings-expanded.png", fullPage: true });
});

test("step 2a publishes forms and corpus counts while original spelling is still searching, then shows cited findings", async ({ page }) => {
  await mountStudio(page);
  await page.evaluate(() => {
    window.studioOriginProposal = { originLanguage: "la", originTerm: "originalis" };
    window.studioHold = "origin";
  });
  await page.getByRole("button", { name: "New research", exact: true }).click();
  await page.getByLabel("Term to research").fill("walk");
  await page.getByRole("listbox", { name: "Projects", exact: true }).selectOption("p1");
  await page.getByRole("button", { name: "Begin research", exact: true }).click();
  await startFormsResearch(page);
  await expect(page.getByRole("status", { name: "In progress: Search cited dictionary and book sources", exact: true })).toBeVisible();
  await expect(page.getByLabel("Source form", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Original-spelling findings", exact: true })).toHaveCount(0);
  const findings = page.getByRole("region", { name: "Work in this step", exact: true });
  await expect(findings).toBeInViewport();
  await expect(findings).toContainText("We found 3 forms used in the selected projects:");
  await expect(findings.getByRole("list", { name: "Forms found in the corpus", exact: true }).getByRole("listitem")).toHaveCount(3);
  await expect(findings.getByText(/^1 exact matching paragraphs\./u)).toHaveCount(3);
  await expect(findings.getByText(/^1 exact matching paragraphs\./u).first()).toBeHidden();
  await expect(findings).toContainText("Possible origin language: la. Proposed original spelling: originalis.");
  await expect(findings).toContainText("Search cited dictionary and book sources");
  const checkpoint = await page.evaluate(async () => {
    const s = (await import(`/${"app"}/state.js`)).state.glossaryResearchStudio.study;
    const saved = JSON.parse(localStorage.getItem("studio-test-studies"))[s.id];
    const calls = window.studioCalls.filter((c) => c.command === "start_glossary_studio_tool");
    return { counts: saved.forms.map((f) => f.paragraphCount), phase: saved.formDiscovery.phase,
      originals: calls.filter((c) => c.args.input.kind === "web").length,
      identity: calls.filter((c) => c.args.input.payload.prompt?.includes("Verify all proposed")).length };
  });
  expect(checkpoint).toEqual({ counts: [1, 1, 1], phase: "checking-origin", originals: 1, identity: 0 });
  await page.evaluate(() => { window.studioReleased.push("origin"); window.studioHold = "verification"; });
  await expect(page.locator(".studio-work-announcement")).toContainText("Verifying which forms are the same word");
  await expect(findings).toContainText("Original spelling documented in a cited dictionary source.");
  await findings.getByText("Evidence and sources", { exact: true }).click();
  await expect(findings.getByRole("link")).toHaveAttribute("href", "https://example.org/original-spelling");
  await page.evaluate(() => { window.studioReleased.push("verification"); });
  await expect(page.getByLabel("Source form", { exact: true }).first()).toBeEnabled();
  await expect(page.locator(".studio-form-explanation")).toHaveCount(3);
  await page.locator('[data-action="studio:visit:1"]').click();
  await returnToStudioHistory(page);
  await page.getByRole("button", { name: "Open study", exact: true }).click();
  await page.locator('[data-action="studio:visit:2a"]').click();
  await expect(page.getByRole("region", { name: "Original-spelling findings", exact: true })).toHaveCount(0);
  await expect(findings).toContainText("Original spelling documented in a cited dictionary source.");
  await findings.getByText("Evidence and sources", { exact: true }).click();
  await expect(findings.getByRole("link")).toHaveAttribute("href", "https://example.org/original-spelling");
  expect(await page.evaluate(() => window.studioCalls.filter((c) => c.command === "start_glossary_studio_tool" && c.args.input.kind === "web").length)).toBe(1);
});

test("step 2a overlaps origin and project evidence, pauses both jobs, and resumes from saved discovery", async ({ page }) => {
  await mountStudio(page);
  await page.evaluate(() => {
    window.studioOriginProposal = { originLanguage: "la", originTerm: "originalis" };
    window.studioHoldStages = ["origin", "corpus"];
  });
  await page.getByRole("button", { name: "New research", exact: true }).click();
  await page.getByLabel("Term to research").fill("walk");
  await page.getByRole("listbox", { name: "Projects", exact: true }).selectOption("p1");
  await page.getByRole("button", { name: "Begin research", exact: true }).click();
  await startFormsResearch(page);
  await expect(page.getByRole("status", { name: "In progress: Search cited dictionary and book sources", exact: true })).toBeVisible();
  await expect(page.getByRole("status", { name: "In progress: Check forms against the corpus", exact: true })).toBeVisible();
  const starts = await page.evaluate(() => {
    const calls = window.studioCalls.filter((call) => call.command === "start_glossary_studio_tool");
    return { projects: calls.filter((call) => call.args.input.kind === "projects").length,
      web: calls.filter((call) => call.args.input.kind === "web").length,
      identity: calls.filter((call) => call.args.input.payload.prompt?.includes("Verify all proposed")).length };
  });
  expect(starts).toEqual({ projects: 1, web: 1, identity: 0 });
  await page.getByRole("button", { name: "Pause research", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause research", exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.studioCalls.filter((call) => call.command === "glossary_studio_job" && call.args.cancel).length)).toBe(2);
  await expect(page.locator('.studio-work [data-work-state="running"]')).toHaveCount(0);
  await page.locator('[data-action="studio:visit:1"]').click();
  await page.evaluate(() => { window.studioHoldStages = []; });
  await page.getByRole("button", { name: "Begin research", exact: true }).click();
  await startFormsResearch(page, { resuming: true });
  await expect(page.getByLabel("Source form", { exact: true })).toHaveCount(3);
  await expect(page.getByLabel("Source form", { exact: true }).first()).toBeEnabled();
  await expect(page.getByText("Research was interrupted. Resume the saved study.", { exact: true })).toHaveCount(0);
  const calls = await page.evaluate(() => window.studioCalls.filter((call) => call.command === "start_glossary_studio_tool").map((call) => call.args.input));
  expect(calls.filter((call) => call.kind === "ai" && call.payload.prompt.includes("List genuine source-language"))).toHaveLength(1);
  expect(calls.filter((call) => call.kind === "ai" && call.payload.prompt.includes("Verify all proposed"))).toHaveLength(1);
  expect(calls.filter((call) => call.kind === "projects")).toHaveLength(2);
  expect(calls.filter((call) => call.kind === "web")).toHaveLength(2);
});

test("pausing research allows outline navigation and resuming after the native job has been consumed", async ({ page }) => {
  await mountStudio(page);
  await page.getByRole("button", { name: "New research", exact: true }).click();
  await page.getByLabel("Term to research").fill("walk");
  await page.getByRole("listbox", { name: "Projects", exact: true }).selectOption("p1");
  await page.evaluate(() => { window.studioHold = "proposal"; });
  await page.getByRole("button", { name: "Begin research", exact: true }).click();
  await startFormsResearch(page);
  await expect(page.locator(".studio-work-announcement")).toContainText("Looking for additional forms and spellings");
  await page.getByRole("button", { name: "Pause research", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause research", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Source form", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Work in this step", exact: true })).toBeVisible();
  await expect(page.getByText("Research paused.", { exact: true })).toHaveCount(0);
  await expect(page.locator(".studio-recommendation")).toHaveCount(0);
  await page.locator('[data-action="studio:visit:1"]').click();
  await expect(page.getByRole("heading", { name: "1 · Scope", exact: true })).toBeVisible();
  await page.evaluate(() => { window.studioHold = null; });
  await page.getByRole("button", { name: "Begin research", exact: true }).click();
  await startFormsResearch(page, { resuming: true });
  await expect(page.getByLabel("Source form", { exact: true })).toHaveCount(3);
  await expect(page.getByLabel("Source form", { exact: true }).first()).toBeEnabled();
  await page.locator('[data-action="studio:visit:1"]').click();
  await expect(page.getByRole("heading", { name: "1 · Scope", exact: true })).toBeVisible();
  await expect(page.getByText("Research was interrupted. Resume the saved study.", { exact: true })).toHaveCount(0);
});

test("Spanish form cards combine case variants, select the attested plural, and contain long explanations", async ({ page }) => {
  await mountStudio(page);
  await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`);
    state.glossaryEditor.sourceLanguage = { code: 'es', name: 'Spanish' };
    state.glossaryEditor.targetLanguage = { code: 'en', name: 'English' };
    window.studioSpanish = true; window.studioHold = "verification";
  });
  await page.getByRole('button', { name: 'New research', exact: true }).click();
  await page.getByLabel('Term to research').fill('Mundo');
  await page.getByLabel('Additional forms or spellings (one per line)').fill('mundo\nMUNDOS\nmundos');
  await page.getByRole('button', { name: 'Begin research', exact: true }).click();
  await startFormsResearch(page);
  await expect(page.locator('.studio-work-announcement')).toContainText('Checking 3 possible forms');
  await expect(page.getByLabel('Source form', { exact: true })).toHaveCount(0);
  await expect(page.locator('input[value="terrible"]')).toHaveCount(0);
  await page.evaluate(() => { window.studioReleased.push('verification'); });
  await expect(page.getByLabel('Source form', { exact: true }).first()).toBeEnabled();
  const cards = page.locator('.studio-form');
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0).getByLabel('Source form', { exact: true })).toHaveValue('Mundo');
  await expect(cards.nth(1).getByLabel('Source form', { exact: true })).toHaveValue('MUNDOS');
  await expect(cards.nth(1).getByRole('checkbox', { name: 'Use', exact: true })).toBeChecked();
  await expect(cards.nth(1)).toContainText('Found in 2,026 distinct paragraphs');
  await expect(cards.nth(0)).toContainText('The noun means world');
  await expect(cards.nth(1)).toContainText('The regular plural');
  await expect(cards.nth(0)).not.toContainText('/doc/');
  expect(await page.evaluate(async () => (await import(`/${"app"}/state.js`)).state.glossaryResearchStudio.study.forms[0].reason)).toContain('/doc/book-34?line=21924');
  async function assertContained() {
    const boxes = await cards.evaluateAll((rows) => rows.map((row) => {
      const card = row.getBoundingClientRect(); const explanation = row.querySelector('.studio-form-explanation').getBoundingClientRect();
      return { top: card.top, bottom: card.bottom, left: card.left, right: card.right,
        explanationBottom: explanation.bottom, explanationRight: explanation.right };
    }));
    expect(boxes[0].bottom).toBeLessThan(boxes[1].top);
    for (const box of boxes) expect(box.right).toBeLessThanOrEqual(page.viewportSize().width);
    for (const box of boxes) {
      expect(box.explanationBottom).toBeLessThan(box.bottom);
      expect(box.explanationRight).toBeLessThan(box.right);
    }
  }
  await assertContained();
  await page.screenshot({ path: '/tmp/gnosis-studio-forms-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 700, height: 900 });
  await assertContained();
  await page.screenshot({ path: '/tmp/gnosis-studio-forms-narrow.png', fullPage: true });
  // Old studies must offer a human-controlled refresh rather than silently
  // accepting the old AI absence verdict or starting paid research on reopen.
  await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`);
    const { stepInput, stableSignature } = await import(`/${"app"}/glossary-research-studio-workflow.js`);
    const { invoke } = await import(`/${"app"}/runtime.js`);
    const { resumeStudy } = await import(`/${"app"}/glossary-research-studio-flow.js`);
    const s = state.glossaryResearchStudio.study;
    s.formDiscovery.version = 2;
    s.forms = [{ text: 'Mundo', selected: true }, { text: 'mundo', selected: true }, { text: 'MUNDOS', selected: false }];
    s.steps['2a'].value = { forms: s.forms };
    s.steps['2a'].generatedSignature = stableSignature({ ...stepInput(s, '2a'), operationVersion: 2 });
    await invoke('glossary_studio_storage', { operation: 'save', input: { value: s } });
    await resumeStudy(s.id);
  });
  await expect(page.getByRole("button", { name: "Save and continue", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Refresh forms research", exact: true }).click();
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(1).getByRole('checkbox', { name: 'Use', exact: true })).toBeChecked();
  await expect(cards.nth(1)).toContainText('Found in 2,026 distinct paragraphs');
});

test("saved research can be deleted individually, cancellation keeps it, and deletion survives reopening", async ({ page }) => {
  await mountStudio(page);
  for (const term of ["Mundo", "Other research"]) {
    await page.getByRole("button", { name: "New research", exact: true }).click();
    await page.getByLabel("Term to research").fill(term);
    await returnToStudioHistory(page);
  }
  const card = (term) => page.locator(".studio-history .studio-entry").filter({ has: page.getByRole("heading", { name: term, exact: true }) });
  await expect(page.locator(".studio-history .studio-entry")).toHaveCount(2);
  await card("Mundo").getByRole("button", { name: "Delete research", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Delete saved research?", exact: true });
  await expect(dialog).toContainText("Mundo");
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(card("Mundo")).toBeVisible();
  expect(await page.evaluate(() => window.studioCalls.filter((c) => c.command === "glossary_studio_storage" && c.args.operation === "delete").length)).toBe(0);
  await card("Mundo").getByRole("button", { name: "Delete research", exact: true }).click();
  await dialog.getByRole("button", { name: "Delete research", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(card("Mundo")).toHaveCount(0);
  await expect(card("Other research")).toBeVisible();
  expect(await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem("studio-test-studies"))).map((s) => s.scope.term))).toEqual(["Other research"]);
  await page.screenshot({ path: "/tmp/gnosis-studio-history-delete.png", fullPage: true });
  await mountStudio(page);
  await expect(card("Mundo")).toHaveCount(0);
  await card("Other research").getByRole("button", { name: "Open study", exact: true }).click();
  await expect(page.getByLabel("Term to research")).toHaveValue("Other research");
});

test("a deletion error keeps the saved study visible and allows retry", async ({ page }) => {
  await mountStudio(page);
  await page.getByRole("button", { name: "New research", exact: true }).click();
  await page.getByLabel("Term to research").fill("Keep on failure");
  await returnToStudioHistory(page);
  await page.evaluate(() => { window.studioDeleteError = "Could not delete research evidence."; });
  await page.getByRole("button", { name: "Delete research", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Delete saved research?", exact: true });
  await dialog.getByRole("button", { name: "Delete research", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Could not delete research evidence.");
  await expect(page.locator(".studio-history .studio-entry")).toHaveCount(1);
  await page.evaluate(() => { window.studioDeleteError = null; });
  await dialog.getByRole("button", { name: "Delete research", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".studio-history .studio-entry")).toHaveCount(0);
});

test("declining a proposed split preserves its meanings and occurrences in the parent study", async ({ page }) => {
  await mountStudio(page);
  await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`);
    const { newStudioStudy, deduplicatePassages, applySplitReview } = await import(`/${"app"}/glossary-research-studio-workflow.js`);
    const { renderGlossaryResearchStudio } = await import(`/${"screens"}/glossary-research-studio.js`);
    const s = newStudioStudy({ teamId: "team", installationId: 7, glossaryId: "g1", repoName: "glossary",
      term: "ser", forms: ["ser"], corpus: "projects", projectIds: ["p1"],
      sourceLanguage: { code: "es", name: "Spanish" }, targetLanguage: { code: "en", name: "English" } }, "split-review");
    s.model = { providerId: "openai", modelId: "test" }; s.step = "4.7"; s.forms = [{ text: "ser", selected: true }];
    s.passages = deduplicatePassages([{ id: "p", text: "ser y el Ser" }], ["ser"]);
    s.meanings = [{ id: "verb", definition: "To be" }, { id: "noun", definition: "The Being" }];
    s.assignments = [{ paragraphId: "p", occurrenceId: "o0", meaningId: "verb" }, { paragraphId: "p", occurrenceId: "o1", meaningId: "noun" }];
    s.steps["4.6"] = { approved: structuredClone({ meanings: s.meanings, assignments: s.assignments }) };
    s.splitProposals = [{ id: "noun", forms: ["el Ser", "del Ser"], meaningId: "noun", targetTerms: ["the Being"], selected: true },
      { id: "unwitnessed", forms: ["al Ser"], meaningId: "noun", targetTerms: ["to the Being"], selected: true }];
    Object.assign(s, applySplitReview(s, s.splitProposals));
    s.steps["4.7"] = { value: { splits: s.queue, proposals: s.splitProposals } };
    state.glossaryResearchStudio.study = s;
    document.querySelector("#app").innerHTML = renderGlossaryResearchStudio(state);
  });
  await expect(page.getByText("Provisional translation: the Being", { exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Create separate entry", exact: true })).toHaveCount(1);
  await expect(page.getByRole("checkbox", { name: "Create separate entry", exact: true })).toBeChecked();
  await expect(page.getByRole("heading", { name: "el Ser", exact: true })).toBeVisible();
  await page.getByText("Unverified suggestions (2)", { exact: true }).click();
  await expect(page.getByText("del Ser", { exact: true })).toBeVisible();
  await expect(page.getByText("al Ser", { exact: true })).toBeVisible();
  expect(await page.evaluate(async () => (await import(`/${"app"}/state.js`)).state.glossaryResearchStudio.study.queue[0].forms)).toEqual(["el Ser"]);
  await page.getByRole("button", { name: "Clear selection", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Create separate entry", exact: true })).not.toBeChecked();
  await page.getByRole("button", { name: "Save and continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "5 · Compounds and phrases", exact: true })).toBeVisible();
  const actual = await page.evaluate(async () => {
    const s = (await import(`/${"app"}/state.js`)).state.glossaryResearchStudio.study;
    return { queue: s.queue.length, meanings: s.meanings.map((m) => m.splitOff), entries: s.assignments.map((a) => a.entryId) };
  });
  expect(actual).toEqual({ queue: 0, meanings: [false, false], entries: ["original", "original"] });
});

test("candidate applicability is local while preference and inflection groups are shared", async ({ page }) => {
  await mountStudio(page);
  await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`);
    const { newStudioStudy, deduplicatePassages } = await import(`/${"app"}/glossary-research-studio-workflow.js`);
    const { renderGlossaryResearchStudio } = await import(`/${"screens"}/glossary-research-studio.js`);
    const s = newStudioStudy({ teamId: "team", installationId: 7, glossaryId: "g1", term: "mundo", forms: ["mundo"],
      sourceLanguage: { code: "es", name: "Spanish" }, targetLanguage: { code: "en", name: "English" } }, "candidate-review");
    s.step = "6"; s.forms = [{ text: "mundo", selected: true }];
    s.passages = deduplicatePassages([{ id: "p", text: "mundo y mundo" }], ["mundo"]);
    s.meanings = [{ id: "planet", definition: "Physical planet" }, { id: "realm", definition: "Nonphysical realm" }];
    s.assignments = [{ paragraphId: "p", occurrenceId: "o0", meaningId: "planet" }, { paragraphId: "p", occurrenceId: "o1", meaningId: "realm" }];
    s.candidates = [{ id: "world", text: "world", meaningIds: ["planet", "realm"], note: "Nonplanetary realm", selected: true },
      { id: "planet", text: "planet", meaningIds: ["planet"], note: "Physical planet", selected: true }];
    s.steps["6"] = { value: { candidates: s.candidates } };
    state.glossaryResearchStudio.study = s;
    document.querySelector("#app").innerHTML = renderGlossaryResearchStudio(state);
  });
  const planetMeaning = page.locator(".studio-meaning").filter({ has: page.getByRole("heading", { name: "Meaning 1", exact: true }) });
  const realmMeaning = page.locator(".studio-meaning").filter({ has: page.getByRole("heading", { name: "Meaning 2", exact: true }) });
  const world = planetMeaning.locator(".studio-candidate").filter({ has: page.locator('input[value="world"]') });
  const worldChoice = planetMeaning.getByRole("checkbox", { name: "world", exact: true });
  await expect(world.getByLabel("Translation", { exact: true })).toBeHidden();
  await expect(page.getByLabel("General translator note", { exact: true })).toBeHidden();
  await worldChoice.focus();
  await page.keyboard.press("Space");
  await expect(worldChoice).not.toBeChecked();
  await expect(worldChoice).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(planetMeaning.getByRole("checkbox", { name: "planet", exact: true })).toBeFocused();
  await expect(realmMeaning.getByRole("checkbox")).toBeChecked();
  await planetMeaning.locator(".studio-meaning-editor > summary").click();
  await expect(world.getByLabel("Translation", { exact: true })).toBeVisible();
  await expect(realmMeaning.locator(".studio-meaning-editor")).not.toHaveAttribute("open", "");
  const planet = planetMeaning.locator(".studio-candidate").filter({ has: page.locator('input[value="planet"]') });
  await planet.getByRole("button", { name: "Add inflection", exact: true }).click();
  const inflection = planetMeaning.locator(".studio-candidate").nth(2);
  await inflection.getByLabel("Translation", { exact: true }).fill("planets");
  await inflection.getByRole("button", { name: "Prefer first", exact: true }).click();
  await planet.getByRole("button", { name: "Prefer first", exact: true }).click();
  await expect(page.locator(".studio-preference li")).toHaveText(["planet", "planets", "world"]);
  await expect(planetMeaning.locator(".studio-meaning-editor")).toHaveAttribute("open", "");
  await expect(planetMeaning.getByRole("checkbox")).toHaveCount(3);
  await expect(planetMeaning.getByRole("checkbox", { name: "planets", exact: true })).toBeChecked();
  await planetMeaning.locator(".studio-meaning-editor > summary").click();
  await expect(planetMeaning.getByLabel("Usage note", { exact: true }).first()).toBeHidden();
  await expect(planetMeaning.getByRole("checkbox", { name: "planet", exact: true })).toBeVisible();
  await page.screenshot({ path: "/tmp/gnosis-studio-compact-candidates.png", fullPage: true });
  const actual = await page.evaluate(async () => {
    const s = (await import(`/${"app"}/state.js`)).state.glossaryResearchStudio.study;
    return s.candidates.map(({ text, meaningIds, groupId }) => ({ text, meaningIds, groupId: groupId ?? null }));
  });
  expect(actual[0].text).toBe("planet"); expect(actual[1].text).toBe("planets");
  expect(actual[0].groupId).toBeTruthy(); expect(actual[0].groupId).toBe(actual[1].groupId);
  expect(actual.find((c) => c.text === "world").meaningIds).toEqual(["realm"]);
});

test("new-form review lets the researcher constrain notes and decline an inflection", async ({ page }) => {
  await mountStudio(page);
  await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`);
    const { newStudioStudy } = await import(`/${"app"}/glossary-research-studio-workflow.js`);
    const { renderGlossaryResearchStudio } = await import(`/${"screens"}/glossary-research-studio.js`);
    const s = newStudioStudy({ teamId: "team", installationId: 7, glossaryId: "g1", term: "mundo",
      sourceLanguage: { code: "es", name: "Spanish" }, targetLanguage: { code: "en", name: "English" } }, "repair-review");
    s.step = "8"; s.meanings = [{ id: "m", definition: "Physical globe" }];
    s.candidates = [{ id: "p", text: "planet", meaningIds: ["m"], note: "Default physical globe", confirmed: true },
      { id: "w", text: "world", meaningIds: ["m"], groupId: "new", note: "Proposed exception", temporary: true, confirmed: true },
      { id: "ws", text: "worlds", meaningIds: ["m"], groupId: "new", note: "Proposed plural", temporary: true, confirmed: true }];
    s.pendingDecision = { kind: "candidate", groupId: "new", meaningId: "m", forms: s.candidates.slice(1),
      translations: [{ paragraphId: "p", source: "mundo", translation: "world" }] };
    state.glossaryResearchStudio.study = s;
    document.querySelector("#app").innerHTML = renderGlossaryResearchStudio(state);
  });
  const modal = page.getByRole("dialog", { name: "Review a new translation", exact: true });
  await expect(modal.getByText("Review 1 preview translation", { exact: true })).toBeVisible();
  await modal.getByRole("textbox", { name: "Usage note", exact: true }).nth(1).fill("Only for a fixed birth idiom.");
  await modal.getByRole("checkbox", { name: "Include proposed form", exact: true }).nth(1).uncheck();
  await expect(modal.getByRole("textbox", { name: "Usage note", exact: true }).nth(1)).toHaveValue("Only for a fixed birth idiom.");
  const actual = await page.evaluate(async () => {
    const s = (await import(`/${"app"}/state.js`)).state.glossaryResearchStudio.study;
    return { note: s.candidates[1].note, meanings: s.candidates[2].meaningIds, temporary: s.candidates[1].temporary };
  });
  expect(actual).toEqual({ note: "Only for a fixed birth idiom.", meanings: [], temporary: true });
});

test("full-entry note editing consolidates shared target notes and invalidates prior successes", async ({ page }) => {
  await mountStudio(page);
  await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`);
    const { newStudioStudy, deduplicatePassages, buildStudioDraft, stableSignature, entryBatchSignature } = await import(`/${"app"}/glossary-research-studio-workflow.js`);
    const { renderGlossaryResearchStudio } = await import(`/${"screens"}/glossary-research-studio.js`);
    const s = newStudioStudy({ teamId: "team", installationId: 7, glossaryId: "g1", term: "mundo",
      sourceLanguage: { code: "es", name: "Spanish" }, targetLanguage: { code: "en", name: "English" } }, "entry-notes");
    s.step = "9"; s.status = "complete"; s.forms = [{ text: "mundo", selected: true }];
    s.passages = deduplicatePassages([{ id: "p", text: "mundo" }], ["mundo"]);
    s.assignments = [{ paragraphId: "p", occurrenceId: "o0", meaningId: "m2" }];
    s.meanings = [{ id: "m1", definition: "Physical globe" }, { id: "m2", definition: "Realm" }];
    s.candidates = [{ id: "w", text: "world", meaningIds: ["m2"], note: "Realm", confirmed: true },
      { id: "birth", text: "world", meaningIds: ["m1"], note: "Birth idiom", confirmed: true },
      { id: "p", text: "planet", meaningIds: ["m1"], note: "Physical globe", confirmed: true }];
    s.tests["9:0"] = { phase: "9", signature: stableSignature(buildStudioDraft(s)), batchSignature: entryBatchSignature(s, s.passages, s.assignments), passed: true,
      choices: [{ ...s.assignments[0], candidateId: "w", rendered: "world", passed: true }],
      translations: [{ paragraphId: "p", source: "mundo", translation: "world" }] };
    s.steps["9"] = { value: { complete: true } };
    state.glossaryResearchStudio.study = s;
    document.querySelector("#app").innerHTML = renderGlossaryResearchStudio(state);
  });
  await expect(page.getByRole("button", { name: "Save and continue", exact: true })).toBeEnabled();
  await page.getByText("Entry under test · notes and preference", { exact: true }).click();
  const editor = page.locator(".studio-test-entry");
  await expect(editor.getByRole("textbox", { name: "Usage note for world", exact: true })).toHaveCount(1);
  await editor.getByRole("textbox", { name: "Usage note for world", exact: true }).fill("Use for realms or fixed birth idioms; physical globes prefer planet.");
  await expect(page.getByRole("button", { name: "Save and continue", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Retest entry", exact: true })).toBeEnabled();
  expect(await page.evaluate(async () => (await import(`/${"app"}/state.js`)).state.glossaryResearchStudio.study.status)).toBe("active");
  await editor.getByRole("button", { name: "Prefer first", exact: true }).click();
  await expect(page.getByText(/Recheck pending · Translation batch/u)).toBeVisible();
  const actual = await page.evaluate(async () => {
    const s = (await import(`/${"app"}/state.js`)).state.glossaryResearchStudio.study;
    return { notes: s.candidates.filter((c) => c.text === "world").map((c) => c.note), first: s.candidates[0].text };
  });
  expect(actual).toEqual({ notes: ["Use for realms or fixed birth idioms; physical globes prefer planet.", "Use for realms or fixed birth idioms; physical globes prefer planet."], first: "planet" });
});

test("a researcher can correct one failed occurrence without changing the other occurrence or losing its paragraph", async ({ page }) => {
  await mountStudio(page);
  await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`);
    const { newStudioStudy, deduplicatePassages, buildStudioDraft, stableSignature, entryBatchSignature } = await import(`/${"app"}/glossary-research-studio-workflow.js`);
    const { renderGlossaryResearchStudio } = await import(`/${"screens"}/glossary-research-studio.js`);
    const s = newStudioStudy({ teamId: "team", installationId: 7, glossaryId: "g1", term: "mundo", forms: ["mundo"],
      sourceLanguage: { code: "es", name: "Spanish" }, targetLanguage: { code: "en", name: "English" } }, "assignment-review");
    s.step = "9"; s.forms = [{ text: "mundo", selected: true }];
    s.passages = deduplicatePassages([{ id: "p", text: "mundo físico y mundo interno" }, { id: "q", text: "mundo interno" }], ["mundo"]);
    s.meanings = [{ id: "planet", definition: "Physical globe", unused: true }, { id: "realm", definition: "Nonphysical realm" }];
    s.assignments = [{ paragraphId: "p", occurrenceId: "o0", meaningId: "realm" },
      { paragraphId: "p", occurrenceId: "o1", meaningId: "realm" }, { paragraphId: "q", occurrenceId: "o0", meaningId: "realm" }];
    s.steps["4.6"] = { approved: structuredClone({ meanings: s.meanings, assignments: s.assignments }) };
    s.candidates = [{ id: "w", text: "world", meaningIds: ["realm"], note: "Realm", confirmed: true },
      { id: "p", text: "planet", meaningIds: ["planet"], note: "Physical globe", confirmed: true }];
    s.tests["9:0"] = { phase: "9", signature: stableSignature(buildStudioDraft(s)), batchSignature: entryBatchSignature(s, s.passages, s.assignments), passed: false,
      choices: [{ paragraphId: "p", occurrenceId: "o0", problem: "Review the physical reference in its full paragraph context. ".repeat(12) }],
      translations: [{ paragraphId: "p", source: s.passages[0].text, translation: "physical world and inner world" }] };
    s.steps["9"] = { value: { pending: true } };
    const { saveStudioStudy } = await import(`/${"app"}/glossary-research-studio-query.js`);
    const saved = await saveStudioStudy(s); s.revision = saved.revision;
    await saveStudioStudy(s);
    state.glossaryResearchStudio.study = s;
    document.querySelector("#app").innerHTML = renderGlossaryResearchStudio(state);
  });
  await page.getByText(/Needs review · Translation batch/u).click();
  for (const width of [1280, 700]) {
    await page.setViewportSize({ width, height: 900 });
    const bounds = await page.locator('.studio-step').evaluate((element) => ({
      right: element.getBoundingClientRect().right, scroll: element.scrollWidth, width: element.clientWidth,
    }));
    expect(bounds.right).toBeLessThanOrEqual(width);
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.width + 1);
    const finding = await page.locator('.studio-finding .modal__error').evaluate((element) => ({
      scroll: element.scrollWidth, width: element.clientWidth,
    }));
    expect(finding.scroll).toBeLessThanOrEqual(finding.width + 1);
  }
  await page.getByRole("button", { name: "Review meaning", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Review occurrence meaning", exact: true });
  await expect(modal.getByText("mundo físico y mundo interno", { exact: true })).toBeVisible();
  await expect(modal.locator("mark")).toHaveText("mundo");
  await modal.getByRole("combobox", { name: "Meaning in this occurrence", exact: true }).selectOption("planet");
  await modal.getByRole("button", { name: "Save meaning", exact: true }).click();
  await expect(modal).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retest meanings", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save and continue", exact: true })).toHaveCount(0);
  const actual = await page.evaluate(async () => {
    const s = (await import(`/${"app"}/state.js`)).state.glossaryResearchStudio.study;
    const { exportStudioStudy } = await import(`/${"app"}/glossary-research-studio-query.js`);
    const exported = await exportStudioStudy(s);
    return { exported: exported.steps["4.6"].approved.assignments[0].meaningId, meanings: s.assignments.slice(0, 2).map((a) => a.meaningId), baseline: s.steps["4.6"].approved.assignments[0].meaningId,
      paragraphs: s.passages.length, revision: s.assignmentRevision, pending: s.assignmentReviewPending };
  });
  expect(actual).toEqual({ exported: "planet", meanings: ["planet", "realm"], baseline: "planet", paragraphs: 2, revision: 1, pending: true });
  await mountStudio(page);
  await page.getByRole("button", { name: "Open study", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retest meanings", exact: true })).toBeVisible();
  expect(await page.evaluate(async () => (await import(`/${"app"}/state.js`)).state.glossaryResearchStudio.study.meanings.find((m) => m.id === "planet").unused)).toBe(false);
});

test("a human can retain a source spelling mention, cancel changes and require rechecking without losing context", async ({ page }) => {
  await mountStudio(page);
  await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`);
    const { newStudioStudy, deduplicatePassages } = await import(`/${"app"}/glossary-research-studio-workflow.js`);
    const { renderGlossaryResearchStudio } = await import(`/${"screens"}/glossary-research-studio.js`);
    const s = newStudioStudy({ teamId: "team", installationId: 7, glossaryId: "g1", term: "caminar",
      sourceLanguage: { code: "es", name: "Spanish" }, targetLanguage: { code: "en", name: "English" } }, "spelling-review");
    s.step = "4.6"; s.forms = [{ text: "caminar", selected: true }];
    s.passages = deduplicatePassages([{ id: "p", text: "caminar se escribe caminar" }], ["caminar"]);
    s.meanings = [{ id: "m", definition: "Move on foot" }];
    s.assignments = s.passages[0].occurrences.map((o) => ({ paragraphId: "p", occurrenceId: o.id, meaningId: "m" }));
    s.steps["4.6"] = { value: structuredClone({ meanings: s.meanings, assignments: s.assignments }) };
    state.glossaryResearchStudio.study = s;
    document.querySelector("#app").innerHTML = renderGlossaryResearchStudio(state);
  });
  const open = async () => {
    const summary = page.getByText("Show usage examples (1 paragraph)", { exact: true });
    if (!await summary.evaluate((element) => element.parentElement.open)) await summary.click();
    await page.getByRole("button", { name: "Review occurrence 2", exact: true }).click();
  };
  await open();
  const modal = page.getByRole("dialog", { name: "Review occurrence meaning", exact: true });
  const retain = modal.getByRole("checkbox", { name: "Retain this source spelling verbatim", exact: true });
  await expect(retain).not.toBeChecked(); await retain.check();
  await modal.getByRole("button", { name: "Save meaning", exact: true }).click();
  await expect(modal).toHaveCount(0);
  await expect(page.getByText(/1 occurrence retains the original source spelling by human choice/u)).toBeVisible();
  await open(); await expect(retain).toBeChecked(); await retain.uncheck();
  await modal.getByRole("button", { name: "Cancel", exact: true }).click();
  await open(); await expect(retain).toBeChecked();
  const actual = await page.evaluate(async () => {
    const s = (await import(`/${"app"}/state.js`)).state.glossaryResearchStudio.study;
    return { flags: s.assignments.map((a) => Boolean(a.preserveSourceSpelling)), baseline: s.steps["4.6"].approved.assignments[1].preserveSourceSpelling,
      text: s.passages[0].text, revision: s.assignmentRevision, pending: s.assignmentReviewPending };
  });
  expect(actual).toEqual({ flags: [false, true], baseline: true, text: "caminar se escribe caminar", revision: 1, pending: true });
});

test("retention combines shared spellings, keeps distinct inflections and preserves final usage while editing", async ({ page }) => {
  await mountStudio(page);
  await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`);
    const { newStudioStudy, deduplicatePassages, buildStudioDraft, stableSignature, entryBatchSignature } = await import(`/${"app"}/glossary-research-studio-workflow.js`);
    const { renderGlossaryResearchStudio } = await import(`/${"screens"}/glossary-research-studio.js`);
    const s = newStudioStudy({ teamId: "team", installationId: 7, glossaryId: "g1", term: "mundo",
      sourceLanguage: { code: "es", name: "Spanish" }, targetLanguage: { code: "en", name: "English" } }, "retention");
    s.step = "9"; s.forms = [{ text: "mundo" }]; s.meanings = [{ id: "m1" }, { id: "m2" }];
    s.candidates = [{ id: "a", text: "world", meaningIds: ["m1"], confirmed: true },
      { id: "b", text: "world", meaningIds: ["m2"], confirmed: true },
      { id: "c", text: "worlds", meaningIds: ["m2"], confirmed: true }];
    s.passages = deduplicatePassages([{ id: "p", text: "mundo y mundo" }, { id: "q", text: "mundo" }], ["mundo"]);
    s.assignments = [{ paragraphId: "p", occurrenceId: "o0", meaningId: "m1" },
      { paragraphId: "p", occurrenceId: "o1", meaningId: "m2" }, { paragraphId: "q", occurrenceId: "o0", meaningId: "m2" }];
    s.tests["9:0"] = { phase: "9", passed: true, signature: stableSignature(buildStudioDraft(s)),
      batchSignature: entryBatchSignature(s, s.passages, s.assignments), choices: s.assignments.map((a) => ({ ...a, candidateId: a.meaningId === "m1" ? "a" : "b" })) };
    s.steps["9"] = { value: { complete: true } };
    state.glossaryResearchStudio.study = s;
    document.querySelector("#app").innerHTML = renderGlossaryResearchStudio(state);
  });
  await page.getByRole("button", { name: "Save and continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "10a · Review usage", exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(2);
  const world = page.getByRole("checkbox", { name: "world", exact: true });
  await expect(world).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "worlds", exact: true })).not.toBeChecked();
  await expect(page.getByText("3 occurrences across 2 paragraphs", { exact: true })).toBeVisible();
  await world.uncheck();
  expect(await page.evaluate(async () => (await import(`/${"app"}/state.js`)).state.glossaryResearchStudio.study.candidates.slice(0, 2).map((c) => c.retained))).toEqual([false, false]);
  await expect(page.getByText("3 occurrences across 2 paragraphs", { exact: true })).toBeVisible();
  await world.check();
  expect(await page.evaluate(async () => (await import(`/${"app"}/state.js`)).state.glossaryResearchStudio.study.candidates.slice(0, 2).map((c) => c.retained))).toEqual([true, true]);
});

test("opening feedback covers slow loads and a late load cannot replace a newly started study", async ({ page }) => {
  await mountStudio(page);
  await page.getByRole("button", { name: "New research", exact: true }).click();
  await page.getByLabel("Term to research", { exact: true }).fill("walk");
  await expect.poll(() => page.evaluate(() => window.studioCalls.some((c) => c.command === "glossary_studio_storage"
    && c.args.operation === "save" && c.args.input.value.scope.term === "walk"))).toBe(true);
  const history = async () => page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`);
    const { openStudio } = await import(`/${"app"}/glossary-research-studio-flow.js`);
    const { renderGlossaryResearchStudio } = await import(`/${"screens"}/glossary-research-studio.js`);
    await openStudio(() => { document.querySelector("#app").innerHTML = renderGlossaryResearchStudio(state); });
    window.studioHoldLoad = true; window.studioLoadReleased = false;
  });
  await history();
  await page.getByRole("button", { name: "Open study", exact: true }).click();
  await expect(page.getByText("Opening saved research…", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Opening…", exact: true })).toBeDisabled();
  await page.evaluate(() => window.releaseStudioLoad());
  await expect(page.getByLabel("Term to research", { exact: true })).toHaveValue("walk");
  await expect(page.getByText("Opening saved research…", { exact: true })).toHaveCount(0);
  await history();
  await page.getByRole("button", { name: "Open study", exact: true }).click();
  await expect(page.getByText("Opening saved research…", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "New research", exact: true }).click();
  await page.getByLabel("Term to research", { exact: true }).fill("new study");
  await page.evaluate(() => window.releaseStudioLoad());
  await expect.poll(() => page.evaluate(() => window.studioLoadReleased)).toBe(true);
  await expect(page.getByLabel("Term to research", { exact: true })).toHaveValue("new study");
});


test("existing-entry research loads the glossary even when Research opened before its terms", async ({ page }) => {
  await mountStudio(page); await seedCollision(page, { uppercase: true });
  await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`);
    const { removeGlossaryEditorQuery } = await import(`/${"app"}/glossary-editor-query.js`);
    const { renderGlossaryResearchStudio } = await import(`/${"screens"}/glossary-research-studio.js`);
    removeGlossaryEditorQuery(state.teams[0], state.glossaries[0]); state.glossaryEditor.terms = [];
    const s = state.glossaryResearchStudio.study; s.step = "2b"; s.relatedEntries = []; s.steps = {};
    window.studioRecognizeExisting = true; window.studioCalls = [];
    document.querySelector("#app").innerHTML = renderGlossaryResearchStudio(state);
  });
  await page.getByRole("button", { name: "Run this step", exact: true }).click();
  await expect(page.locator("summary").filter({ hasText: "WALK, WALKED" })).toBeVisible();
  const result = await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`);
    return { entries: state.glossaryResearchStudio.study.relatedEntries,
      loaded: window.studioCalls.some((call) => call.command === "load_gtms_glossary_editor_data"),
      ai: window.studioCalls.filter((call) => call.command === "start_glossary_studio_tool" && call.args.input.kind === "ai").length };
  });
  expect(result.entries[0].sourceTerms).toEqual(["WALK", "WALKED"]);
  expect(result.loaded).toBe(true);
  expect(result.ai).toBe(0);
});

test("collision review refreshes cold glossary data before claiming there are no conflicts", async ({ page }) => {
  await mountStudio(page); await seedCollision(page, { uppercase: true });
  await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`);
    const { removeGlossaryEditorQuery } = await import(`/${"app"}/glossary-editor-query.js`);
    const { renderGlossaryResearchStudio } = await import(`/${"screens"}/glossary-research-studio.js`);
    removeGlossaryEditorQuery(state.teams[0], state.glossaries[0]); state.glossaryEditor.terms = [];
    state.glossaryResearchStudio.study.step = "10a";
    document.querySelector("#app").innerHTML = renderGlossaryResearchStudio(state);
  });
  await page.getByRole("button", { name: "Save and continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "10b · Resolve collisions", exact: true })).toBeVisible();
  await expect(page.locator('[data-studio-collision="walk"]')).toBeVisible();
  await expect(page.locator('[data-studio-collision="walked"]')).toBeVisible();
  await expect(page.getByText("No source variants collide with existing entries.", { exact: true })).toHaveCount(0);
});


test("opening the term editor from cold research loads its snapshot and rejected saves restore the draft visibly", async ({ page }) => {
  await mountStudio(page); await seedCollision(page);
  await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`);
    const { removeGlossaryEditorQuery } = await import(`/${"app"}/glossary-editor-query.js`);
    const { renderGlossaryResearchStudio } = await import(`/${"screens"}/glossary-research-studio.js`);
    removeGlossaryEditorQuery(state.teams[0], state.glossaries[0]);
    Object.assign(state.glossaryEditor, { status: "loading", terms: [] });
    const s = state.glossaryResearchStudio.study; s.step = "11"; s.collisions = { walk: "overwrite", walked: "overwrite" };
    window.studioSaveError = "Test save rejected";
    document.querySelector("#app").innerHTML = renderGlossaryResearchStudio(state);
  });
  await page.getByRole("button", { name: "Open term editor", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "New Term", exact: true })).toBeVisible();
  expect(await page.evaluate(async () => (await import(`/${"app"}/state.js`)).state.glossaryEditor.status)).toBe("ready");
  await page.getByRole("dialog").getByRole("button", { name: "Save entry", exact: true }).click();
  await expect(page.getByRole("dialog").getByText("Test save rejected", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.studioGlossary.terms[0].sourceTerms)).toEqual(["walk", "walked"]);
});


test("a pre-save glossary read cannot delay or replace the fresh post-save research snapshot", async ({ page }) => {
  await mountStudio(page); await seedCollision(page);
  await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`);
    const { renderGlossaryResearchStudio } = await import(`/${"screens"}/glossary-research-studio.js`);
    const s = state.glossaryResearchStudio.study; s.step = "11"; s.collisions = { walk: "overwrite", walked: "keep" };
    document.querySelector("#app").innerHTML = renderGlossaryResearchStudio(state);
  });
  await page.getByRole("button", { name: "Open term editor", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "New Term", exact: true })).toBeVisible();
  await page.evaluate(() => { window.studioHoldUpsert = true; });
  await page.getByRole("dialog").getByRole("button", { name: "Save entry", exact: true }).click();
  await page.waitForFunction(() => typeof window.releaseStudioUpsert === "function");
  await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`);
    const { queryClient } = await import(`/${"app"}/query-client.js`);
    const { createGlossaryEditorQueryOptions } = await import(`/${"app"}/glossary-editor-query.js`);
    window.studioHoldGlossaryLoad = true;
    window.preSaveRead = queryClient.fetchQuery({ ...createGlossaryEditorQueryOptions(state.teams[0], state.glossaries[0]), staleTime: 0 }).catch(() => null);
  });
  await page.waitForFunction(() => typeof window.releaseStudioGlossaryLoad === "function");
  await page.evaluate(() => window.releaseStudioUpsert());
  try {
    await expect(page.getByRole("heading", { name: "12 · Split-entry queue", exact: true })).toBeVisible();
    const terms = await page.evaluate(async () => {
      const { state } = await import(`/${"app"}/state.js`);
      const { studioGlossaryEntries } = await import(`/${"app"}/glossary-research-studio-query.js`);
      return studioGlossaryEntries(state.glossaryResearchStudio.study.scope).map((term) => term.sourceTerms);
    });
    expect(terms).toEqual(expect.arrayContaining([["walked"], ["walk"]]));
    expect(terms).not.toContainEqual(["walk", "walked"]);
  } finally { await page.evaluate(() => window.releaseStudioGlossaryLoad()); }
});


test("usage review initializes real counts and retention in its first saved snapshot", async ({ page }) => {
  await mountStudio(page); await seedCollision(page);
  await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`);
    const { buildStudioDraft, stableSignature, entryBatchSignature } = await import(`/${"app"}/glossary-research-studio-workflow.js`);
    const { renderGlossaryResearchStudio } = await import(`/${"screens"}/glossary-research-studio.js`);
    const s = state.glossaryResearchStudio.study;
    s.step = "9";
    s.candidates.push({ id: "unused", text: "bước", meaningIds: ["m1"], confirmed: true });
    s.tests["9:0"] = { phase: "9", passed: true, rounds: 0,
      signature: stableSignature(buildStudioDraft(s)), batchSignature: entryBatchSignature(s, s.passages, s.assignments),
      choices: [{ paragraphId: "p1", occurrenceId: "o0", candidateId: "c1", passed: true }],
      translations: [{ paragraphId: "p1", source: "I walk home.", translation: "Tôi đi bộ về nhà." }] };
    s.steps["9"] = { value: { passed: true } };
    document.querySelector("#app").innerHTML = renderGlossaryResearchStudio(state);
  });
  await page.getByRole("button", { name: "Save and continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "10a · Review usage", exact: true })).toBeVisible();
  await expect(page.getByText("1 occurrence across 1 paragraph", { exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "bước", exact: true })).not.toBeChecked();
  const snapshots = await page.evaluate(() => window.studioCalls.filter((c) => c.command === "glossary_studio_storage"
    && c.args.operation === "save" && c.args.input.value.step === "10a").map((c) => c.args.input.value));
  expect(snapshots.length).toBeGreaterThan(0);
  for (const snapshot of snapshots) {
    expect(snapshot.usageByText["đi bộ"]).toEqual({ occurrences: 1, paragraphs: 1 });
    expect(snapshot.candidates.find((c) => c.id === "unused").retained).toBe(false);
  }
});


test("bibliography groups source findings by author and opens their exact evidence", async ({ page }) => {
  await mountStudio(page);
  await page.getByRole("button", { name: "New research", exact: true }).click();
  await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`);
    const { renderGlossaryResearchStudio } = await import(`/${"screens"}/glossary-research-studio.js`);
    const s = state.glossaryResearchStudio.study; s.step = "4.4.1";
    s.steps[s.step] = { value: { summary: "Borrowing is uncertain", meanings: [
      { author: "Author A", definition: "Perceptible to the senses", evidence: [{ quotation: "Exact sensory quotation", url: "https://example.test/source", reference: { title: "Source book", chapter_title: "Original chapter", year: 1952, line_id: 42 }, usageNote: "This is an inferred interpretation" }] },
      { author: "Author A", definition: "Responsive to impressions" }, { author: "Author B", definition: "Sentient beings" },
    ] } };
    document.querySelector("#app").innerHTML = renderGlossaryResearchStudio(state);
  });
  await expect(page.getByText("Perceptible to the senses", { exact: true })).toBeHidden();
  await page.getByText("Author A · 2 source meanings", { exact: true }).click();
  await expect(page.getByText("Perceptible to the senses", { exact: true })).toBeVisible();
  await expect(page.getByText("Responsive to impressions", { exact: true })).toBeVisible();
  await expect(page.getByText("Sentient beings", { exact: true })).toBeHidden();
  await page.locator(".studio-author-group").first().getByText("Evidence and sources", { exact: true }).click();
  await expect(page.getByText("Exact sensory quotation", { exact: true })).toBeVisible();
  await expect(page.getByText("Source book · Original chapter · 1952 · Line 42", { exact: true })).toBeVisible();
  await expect(page.getByText("This is an inferred interpretation", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "https://example.test/source", exact: true })).toBeVisible();
  await page.getByText("Source assessment", { exact: true }).click();
  await expect(page.getByText("Borrowing is uncertain", { exact: true })).toBeVisible();
  await page.screenshot({ path: "/tmp/gnosis-studio-source-author-groups.png", fullPage: true });
});

test("only verified parent compounds reach candidate research from a saved legacy report", async ({ page }) => {
  await mountStudio(page);
  await page.getByRole("button", { name: "New research", exact: true }).click();
  await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`);
    const { deduplicatePassages } = await import(`/${"app"}/glossary-research-studio-workflow.js`);
    const { renderGlossaryResearchStudio } = await import(`/${"screens"}/glossary-research-studio.js`);
    const s = state.glossaryResearchStudio.study; s.step = "5"; s.scope.term = "walk"; s.forms = [{ text: "walk" }];
    s.meanings = [{ id: "m1", definition: "Move on foot" }];
    s.passages = deduplicatePassages([{ id: "a", text: "I walk home." }, { id: "b", text: "We walk home." }, { id: "child", text: "I walk away." }], ["walk"]);
    s.assignments = s.passages.map((p) => ({ paragraphId: p.id, occurrenceId: "o0", meaningId: "m1", ...(p.id === "child" ? { entryId: "child-study" } : {}) }));
    s.steps["5"] = { value: { compounds: [{ phrase: "walk home", meaningId: "m1", paragraphIds: ["foreign"], explanation: "A recurring expression" },
      { phrase: "walk away", meaningId: "m1", paragraphIds: ["child"], specialMeaning: true, explanation: "Belongs to the child" }] } };
    document.querySelector("#app").innerHTML = renderGlossaryResearchStudio(state);
  });
  await expect(page.getByText("walk home · 2 paragraphs", { exact: true })).toBeVisible();
  await page.getByText("Unverified suggestions (1)", { exact: true }).click();
  await expect(page.getByText("walk away", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save and continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "6 · Translation candidates", exact: true })).toBeVisible();
  await expect(page.getByLabel("Translation", { exact: true })).toHaveCount(1);
  const evidence = await page.evaluate(() => {
    const call = window.studioCalls.find((c) => c.command === "start_glossary_studio_tool" && c.args.input.step === "6" && c.args.input.kind === "ai");
    return JSON.parse(call.args.input.payload.prompt.split("Evidence:\n")[1]);
  });
  expect(evidence.compounds.map((c) => c.phrase)).toEqual(["walk home"]);
  expect(evidence.compounds[0].paragraphIds).toEqual(["a", "b"]);
  expect(evidence.paragraphs.map((p) => p.id)).toEqual(["a", "b"]);
  expect(evidence.assignments).toBeUndefined();
  expect(evidence.paragraphs.flatMap((p) => p.occurrences)).toHaveLength(2);
  expect(evidence.paragraphs.every((p) => p.occurrences.every((o) => o.meaningId === "m1"))).toBe(true);
});


test("legacy source-heavy research reopens and reuses checkpoints with compact signatures and full evidence", async ({ page }) => {
  await mountStudio(page); await seedCollision(page);
  await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`);
    const { stepInput, stableSignature } = await import(`/${"app"}/glossary-research-studio-workflow.js`);
    const { invoke } = await import(`/${"app"}/runtime.js`);
    const { resumeStudy } = await import(`/${"app"}/glossary-research-studio-flow.js`);
    const s = state.glossaryResearchStudio.study; s.step = "5"; s.translationRuntimeVersion = "0.8.125";
    s.steps["4.4.1"] = { approved: { evidence: "Whole cited quotation á漢字 ".repeat(10000) }, status: "complete" };
    const signature = stableSignature(stepInput(s, "5"));
    s.steps["5"] = { value: { compounds: [] }, approved: { compounds: [] }, status: "complete", signature, generatedSignature: signature };
    await invoke("glossary_studio_storage", { operation: "save", input: { value: s } });
    await resumeStudy(s.id);
  });
  await expect(page.getByRole("heading", { name: "6 · Translation candidates", exact: true })).toBeVisible();
  await expect(page.getByLabel("Translation", { exact: true })).toHaveValue("đi bộ");
  expect(await page.evaluate(() => window.studioCalls.filter((c) => c.command === "start_glossary_studio_tool" && c.args.input.step === "5").length)).toBe(0);
  const calls = await page.evaluate(() => window.studioCalls.filter((c) => c.command === "start_glossary_studio_tool").length);
  await page.locator('[data-action="studio:visit:5"]').click();
  await expect(page.getByRole("heading", { name: "5 · Compounds and phrases", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save and continue", exact: true }).click();
  await expect(page.getByLabel("Translation", { exact: true })).toHaveValue("đi bộ");
  expect(await page.evaluate(() => window.studioCalls.filter((c) => c.command === "start_glossary_studio_tool").length)).toBe(calls);
  const result = await page.evaluate(async () => {
    const rows = Object.values(JSON.parse(localStorage.getItem("studio-test-studies")));
    const s = rows[0];
    const full = await window.__TAURI__.core.invoke("glossary_studio_storage", { operation: "load", input: { studyId: s.id } });
    return { signatures: Object.values(s.steps).flatMap((r) => [r.signature, r.generatedSignature]).filter(Boolean).map((v) => v.length),
      evidence: full.steps["4.4.1"].approved.evidence };
  });
  expect(result.signatures.every((n) => n === 71)).toBe(true);
  expect(result.evidence).toBe("Whole cited quotation á漢字 ".repeat(10000));
});


test("repeated start actions during asynchronous checkpoint comparison launch one research request", async ({ page }) => {
  await mountStudio(page); await seedCollision(page);
  await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`);
    const { runCurrentStage } = await import(`/${"app"}/glossary-research-studio-flow.js`);
    state.glossaryResearchStudio.study.step = "6";
    await Promise.all([runCurrentStage(), runCurrentStage()]);
  });
  await expect(page.getByLabel("Translation", { exact: true })).toHaveValue("đi bộ");
  expect(await page.evaluate(() => window.studioCalls.filter((c) => c.command === "start_glossary_studio_tool").length)).toBe(1);
});

test("research progress renders preserve independently opened trial details within the same study and step", async ({ page }) => {
  await mountStudio(page);
  await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`);
    const { newStudioStudy } = await import(`/${"app"}/glossary-research-studio-workflow.js`);
    const { renderGlossaryResearchStudio } = await import(`/${"screens"}/glossary-research-studio.js`);
    const s = newStudioStudy({ ...state.glossaryEditor, term: "walk", corpus: "projects" }, "details-test");
    s.step = "8";
    s.meanings = [{ id: "m1", definition: "Move on foot" }, { id: "m2", definition: "A second meaning" }];
    s.tests = Object.fromEntries(["m1", "m2"].map((id) => [`8:${id}`, {
      passed: true, rounds: 0, translations: [], choices: [], signature: "earlier-input",
    }]));
    s.pendingDecision = { kind: "progress", rounds: 5, report: "Completed five repairs" };
    state.glossaryResearchStudio = { study: s, history: [], hideDecision: true };
    document.querySelector("#app").innerHTML = renderGlossaryResearchStudio(state);
  });
  const first = page.locator("details.studio-entry").filter({ has: page.locator(":scope > summary", { hasText: "Meaning 1" }) });
  const second = page.locator("details.studio-entry").filter({ has: page.locator(":scope > summary", { hasText: "Meaning 2" }) });
  await first.locator(":scope > summary").click();
  await first.getByText("All trial translations (0 paragraphs)", { exact: true }).click();
  await second.locator(":scope > summary").click();
  await page.getByRole("button", { name: "Review paused research", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(first).toHaveAttribute("open", "");
  await expect(first.locator("details")).toHaveAttribute("open", "");
  await expect(second).toHaveAttribute("open", "");
  await expect(second.locator("details")).not.toHaveAttribute("open", "");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await first.locator("details > summary").click();
  await first.locator(":scope > summary").click();
  // A later render with changed counts/status must retain the user's closed choice too.
  await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`);
    const s = state.glossaryResearchStudio.study;
    s.tests["8:m1"].rounds = 1;
    s.pendingDecision = { kind: "progress", rounds: 10, report: "Completed ten repairs" };
    state.glossaryResearchStudio.hideDecision = true;
  });
  await page.locator('[data-action="studio:export"]').focus();
  // Opening the paused review uses the same full-render callback as live tool progress.
  await page.evaluate(async () => {
    const { studioAction } = await import(`/${"app"}/glossary-research-studio-flow.js`);
    const { state } = await import(`/${"app"}/state.js`);
    const { renderGlossaryResearchStudio } = await import(`/${"screens"}/glossary-research-studio.js`);
    const { captureStudioDisclosures, restoreStudioDisclosures } = await import(`/${"app"}/glossary-research-studio-disclosures.js`);
    const root = document.querySelector("#app");
    await studioAction("studio:review-decision", () => {
      const snapshot = captureStudioDisclosures(root);
      root.innerHTML = renderGlossaryResearchStudio(state);
      restoreStudioDisclosures(root, snapshot);
    });
  });
  await expect(first).not.toHaveAttribute("open", "");
  await expect(second).toHaveAttribute("open", "");
  // A different step and a different study must not inherit these selections.
  const isolated = await page.evaluate(async () => {
    const { captureStudioDisclosures, restoreStudioDisclosures } = await import(`/${"app"}/glossary-research-studio-disclosures.js`);
    const root = document.querySelector("#app"); const snapshot = captureStudioDisclosures(root);
    const context = root.querySelector("[data-studio-disclosure-context]");
    context.dataset.studioDisclosureContext += ":other-step";
    for (const details of context.querySelectorAll("details")) details.open = false;
    restoreStudioDisclosures(root, snapshot);
    const otherStep = [...context.querySelectorAll("details")].every((details) => !details.open);
    context.dataset.studioDisclosureContext = "other-study:8";
    restoreStudioDisclosures(root, snapshot);
    return { otherStep, otherStudy: [...context.querySelectorAll("details")].every((details) => !details.open) };
  });
  expect(isolated).toEqual({ otherStep: true, otherStudy: true });
});

test("neighbor context stays separate and preserves independent disclosure choices across trial renders", async ({ page }) => {
  await mountStudio(page);
  await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`);
    const { newStudioStudy, deduplicatePassages } = await import(`/${"app"}/glossary-research-studio-workflow.js`);
    const { renderGlossaryResearchStudio } = await import(`/${"screens"}/glossary-research-studio.js`);
    const s = newStudioStudy({ ...state.glossaryEditor, term: "walk", corpus: "projects" }, "neighbor-test");
    s.step = "8"; s.meanings = [{ id: "m1", definition: "Move on foot" }];
    s.passages = deduplicatePassages([{ id: "p", text: "walk", contextBefore: ["<script>source evidence only</script>"], contextAfter: ["Later source paragraph"] }], ["walk"]);
    s.assignments = [{ paragraphId: "p", occurrenceId: "o0", meaningId: "m1" }];
    s.tests = { "8:m1": { passed: false, rounds: 0, signature: "earlier-input", translations: [{ paragraphId: "p", translation: "đi bộ" }],
      choices: [{ paragraphId: "p", occurrenceId: "o0", problem: "Review this example" }] } };
    s.pendingDecision = { kind: "progress", rounds: 5, report: "Review progress" };
    state.glossaryResearchStudio = { study: s, history: [], hideDecision: true };
    document.querySelector("#app").innerHTML = renderGlossaryResearchStudio(state);
  });
  const trial = page.locator('details[data-studio-disclosure="8:m1"]');
  await trial.locator(":scope > summary").click();
  const finding = page.locator('details[data-studio-disclosure="8:m1:finding:p:source-context"]');
  const translation = page.locator('details[data-studio-disclosure="8:m1:translation:p:source-context"]');
  await finding.locator(":scope > summary").click();
  await expect(finding.getByText("<script>source evidence only</script>", { exact: true })).toBeVisible();
  await expect(finding.locator("script")).toHaveCount(0);
  await trial.getByText("All trial translations (1 paragraph)", { exact: true }).click();
  await expect(translation).not.toHaveAttribute("open", "");
  await page.getByRole("button", { name: "Review paused research", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(finding).toHaveAttribute("open", "");
  await expect(translation).not.toHaveAttribute("open", "");
});

test("candidate review shares edited notes across separate records with the same spelling", async ({ page }) => {
  await mountStudio(page);
  await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`);
    const { newStudioStudy } = await import(`/${"app"}/glossary-research-studio-workflow.js`);
    const { renderGlossaryResearchStudio } = await import(`/${"screens"}/glossary-research-studio.js`);
    const s = newStudioStudy({ ...state.glossaryEditor, term: "sensible", corpus: "projects" }, "shared-review-note");
    s.step = "6"; s.forms = [{ text: "sensible", selected: true }];
    s.meanings = [{ id: "physical", definition: "Physical responsiveness" }, { id: "emotional", definition: "Emotional sensitivity" }];
    s.candidates = [
      { id: "c1", text: "sensitive", meaningIds: ["physical"], note: "Physical note", confirmed: true },
      { id: "c2", text: "sensitive", meaningIds: ["emotional"], note: "Emotional note", confirmed: true },
    ];
    s.steps["6"] = { value: { candidates: s.candidates } };
    state.glossaryResearchStudio.study = s;
    document.querySelector("#app").innerHTML = renderGlossaryResearchStudio(state);
  });
  const first = page.locator(".studio-meaning").filter({ has: page.getByRole("heading", { name: "Meaning 1", exact: true }) });
  const second = page.locator(".studio-meaning").filter({ has: page.getByRole("heading", { name: "Meaning 2", exact: true }) });
  await expect(first.getByRole("checkbox", { name: "sensitive", exact: true })).toBeVisible();
  await expect(first.getByLabel("Usage note", { exact: true })).toBeHidden();
  await first.locator(".studio-meaning-editor > summary").click();
  await second.locator(".studio-meaning-editor > summary").click();
  const note = "Use for physical responsiveness or emotional sensitivity; distinguish from perceptibility.";
  await first.getByRole("textbox", { name: "Usage note", exact: true }).fill(note);
  await expect(first.getByRole("textbox", { name: "Usage note", exact: true })).toBeFocused();
  await expect(second.getByRole("textbox", { name: "Usage note", exact: true })).toHaveValue(note);
  await first.getByRole("checkbox").uncheck();
  await expect(second.getByRole("checkbox")).toBeChecked();
  const actual = await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`);
    const { buildStudioDraft } = await import(`/${"app"}/glossary-research-studio-workflow.js`);
    const s = state.glossaryResearchStudio.study;
    return { candidates: s.candidates.map(({ note, meaningIds }) => ({ note, meaningIds })), draft: buildStudioDraft(s) };
  });
  expect(actual.candidates).toEqual([{ note, meaningIds: [] }, { note, meaningIds: ["emotional"] }]);
  expect(actual.draft.targetTerms).toEqual(["sensitive"]);
  expect(actual.draft.targetVariantNotes).toEqual([note]);
  // Rename and edit without a full render: the old spelling must stay independent.
  await first.getByLabel("Translation", { exact: true }).fill("perceptible");
  await expect(first.getByLabel("Translation", { exact: true })).toBeFocused();
  await expect(first.getByRole("checkbox", { name: "perceptible", exact: true })).toBeVisible();
  await expect(second.getByRole("checkbox", { name: "sensitive", exact: true })).toBeChecked();
  const renamedNote = "Use for objects that can be perceived through the senses.";
  await first.getByRole("textbox", { name: "Usage note", exact: true }).fill(renamedNote);
  await expect(second.getByRole("textbox", { name: "Usage note", exact: true })).toHaveValue(note);
  const renamed = await page.evaluate(async () => (await import(`/${"app"}/state.js`)).state.glossaryResearchStudio.study.candidates.map(({ text, note }) => ({ text, note })));
  expect(renamed).toEqual([{ text: "perceptible", note: renamedNote }, { text: "sensitive", note }]);
});

test("work checklist declares future steps, adds discovered tasks and preserves result disclosures", async ({ page }) => {
  await mountStudio(page);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`);
    const { newStudioStudy } = await import(`/${"app"}/glossary-research-studio-workflow.js`);
    const { createStudioActivity, studioStageActivities } = await import(`/${"app"}/glossary-research-studio-activity.js`);
    const { renderGlossaryResearchStudio } = await import(`/${"screens"}/glossary-research-studio.js`);
    const { captureStudioDisclosures, restoreStudioDisclosures } = await import(`/${"app"}/glossary-research-studio-disclosures.js`);
    const study = newStudioStudy({ sourceLanguage: { code: "es", name: "Spanish" }, targetLanguage: { code: "en", name: "English" }, term: "fatal", corpus: "samael" }, "progress-fixture");
    study.step = "4.4.1";
    state.glossaryResearchStudio = { study, busy: true, message: "Reading source-author metadata", history: [] };
    window.renderWorkFixture = () => {
      const root = document.querySelector("#app"); const snapshot = captureStudioDisclosures(root);
      root.innerHTML = renderGlossaryResearchStudio(state); restoreStudioDisclosures(root, snapshot);
    };
    window.workFixture = createStudioActivity(study, window.renderWorkFixture, () => true);
    window.workFixture.plan(studioStageActivities(study));
    window.workFixture.start(["metadata", "operation:lookup"], "Read source metadata");
  });
  const work = page.getByRole("region", { name: "Work in this step" });
  await expect(work.locator(":scope > ol > li")).toHaveCount(6);
  await expect(work.getByText("Consolidate bibliographical findings", { exact: true })).toBeVisible();
  await expect(work.locator('[data-work-state="running"]')).toHaveCount(1);
  await page.evaluate(() => {
    window.workFixture.done(["metadata", "operation:lookup"], { books: [{ title: "Source book A" }, { title: "Source book B" }] });
    window.workFixture.start(["sources", "operation:lookup"], "Find matching passages");
    window.workFixture.done(["sources", "operation:lookup"], { population_distinct: 842 });
    window.workFixture.start(["originals", "operation:lookup"], "Check original terms");
    window.workFixture.done(["originals", "operation:lookup"], { summary: "Latin fatālis is the etymon; no separate borrowed spelling was established." });
    window.workFixture.plan([{ id: "Author A", label: "Author A" }, { id: "Author B", label: "Author B" }], ["authors"]);
    window.workFixture.start(["authors", "Author A", "operation:verify"], "Verify author mentions");
    window.workFixture.done(["authors", "Author A", "operation:verify"], { summary: "A lexical parallel is supported, but this does not establish direct borrowing. ".repeat(9), judgments: [{ genuine: true }, { genuine: true }, { genuine: null }] });
    window.workFixture.start(["authors", "Author B", "operation:verify"], "Verify author mentions");
  });
  await expect(work.getByText("Author B", { exact: true })).toBeVisible();
  await expect(work.getByText("842 matching paragraphs.", { exact: true })).toBeVisible();
  const summary = work.getByText("Read result summary", { exact: true });
  await summary.click();
  await expect(work.locator("details[open]")).toHaveCount(1);
  await page.evaluate(() => {
    window.workFixture.done(["authors", "Author B", "operation:verify"], { judgments: [{ genuine: false }] });
    window.workFixture.finish(["authors"], "Two authors reviewed. One mention remains unresolved.");
    window.workFixture.plan([{ id: "batch-0", label: "Comparison 1 of 2" }, { id: "batch-1", label: "Comparison 2 of 2" }], ["comparisons"]);
    window.workFixture.start(["comparisons", "batch-0", "operation:compare"], "Compare source meanings");
  });
  await expect(work.locator("details[open]")).toHaveCount(1);
  await expect(work.getByText("Comparison 2 of 2", { exact: true })).toBeVisible();
  await expect(work.getByText("One mention remains unresolved.", { exact: false })).toBeVisible();
  // No actual AI/corpus requests are necessary to validate this presentation.
  expect(await page.evaluate(() => window.studioCalls.filter((c) => c.command === "start_glossary_studio_tool").length)).toBe(0);
  await summary.click();
  await page.screenshot({ path: "/tmp/gnosis-studio-progress.png", fullPage: true });
  await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`);
    window.workFixture.pause(); state.glossaryResearchStudio.busy = false;
    state.glossaryResearchStudio.message = ""; window.renderWorkFixture();
  });
  await expect(work.locator('[data-work-state="paused"]')).toHaveCount(2);
  await expect(work.getByText("842 matching paragraphs.", { exact: true })).toBeVisible();
});

test("hidden timing diagnostics survive normal saves, reopening and research export", async ({ page }) => {
  await mountStudio(page);
  await page.getByRole("button", { name: "New research", exact: true }).click();
  await page.getByLabel("Term to research").fill("walk");
  await page.getByRole("listbox", { name: "Projects", exact: true }).selectOption("p1");
  await page.getByRole("button", { name: "Begin research", exact: true }).click();
  await startFormsResearch(page);
  await expect(page.getByLabel("Source form", { exact: true }).first()).toBeEnabled();
  const original = await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`); const s = state.glossaryResearchStudio.study;
    const durable = JSON.parse(localStorage.getItem("studio-test-studies"))[s.id];
    return { timing: s.timing, savedRun: durable.timing.steps["2a"].runs[0], recommendationRun: durable.timing.steps["recommendation:2a"].runs[0], calls: window.studioCalls.filter((c) => c.command === "start_glossary_studio_tool").length };
  });
  expect(original.savedRun.status).toBe("complete");
  expect(original.recommendationRun.status).toBe("complete");
  expect(original.savedRun.elapsedMs).toBeGreaterThan(0);
  expect(original.savedRun.operations.length).toBeGreaterThan(2);
  expect(original.savedRun.operations[0].path[0]).toBe("discover");
  expect(original.savedRun.operations[0].requestMs).toBeGreaterThan(0);
  expect(original.timing.steps["2a"].saves.count).toBeGreaterThan(0);
  await expect(page.getByText(/Step timings|Tool time:/)).toHaveCount(0);
  await expect(page.getByRole("table", { name: "Recorded research timings" })).toHaveCount(0);
  await page.locator('[data-action="studio:visit:1"]').click();
  await returnToStudioHistory(page);
  await page.getByRole("button", { name: "Open study", exact: true }).click();
  await expect(page.getByRole("heading", { name: "1 · Scope", exact: true })).toBeVisible();
  const reopened = await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`);
    return { run: state.glossaryResearchStudio.study.timing.steps["2a"].runs[0], calls: window.studioCalls.filter((c) => c.command === "start_glossary_studio_tool").length };
  });
  await expect(page.getByText(/Step timings|Tool time:/)).toHaveCount(0);
  expect(reopened.run).toEqual(original.savedRun);
  expect(reopened.calls).toBe(original.calls);
  await page.locator('[data-action="studio:visit:2a"]').click();
  await expect(page.getByLabel("Source form", { exact: true }).first()).toBeEnabled();
  await expect(page.locator(".studio-recommendation")).toHaveCount(0);
  await showExportStep(page);
  await page.locator('[data-action="studio:export"]').click();
  await expect.poll(() => page.evaluate(() => window.studioExports?.length ?? 0)).toBe(1);
  const exported = await page.evaluate(() => window.studioExports[0].value);
  expect(exported.timing.steps["2a"].runs[0]).toEqual(original.savedRun);
  expect(exported.timing.steps["recommendation:2a"].runs[0]).toEqual(original.recommendationRun);
});

async function mountEntryPassStudy(page, paused = false) {
  await mountStudio(page);
  await page.evaluate(async (paused) => {
    const { state } = await import(`/${"app"}/state.js`);
    const { newStudioStudy, deduplicatePassages } = await import(`/${"app"}/glossary-research-studio-workflow.js`);
    const { renderGlossaryResearchStudio } = await import(`/${"screens"}/glossary-research-studio.js`);
    const s = newStudioStudy({ ...state.glossaryEditor, teamId: "team", installationId: 7, term: "walk", corpus: "projects" }, "entry-pass");
    s.step = "9"; s.forms = [{ text: "walk" }]; s.meanings = [{ id: "m1", definition: "Move on foot" }];
    s.passages = deduplicatePassages(Array.from({ length: 31 }, (_, i) => ({ id: `p${i}`, text: `I walk ${i}.` })), ["walk"], "en");
    s.assignments = s.passages.map((p) => ({ paragraphId: p.id, occurrenceId: "o0", meaningId: "m1", entryId: "original" }));
    s.candidates = [{ id: "c1", text: "đi bộ", note: "Initial selection conditions", meaningIds: ["m1"], selected: true, confirmed: true, retained: true }];
    if (paused) {
      s.rounds = { "9:15": 3, "9:30": 3 };
      s.entryValidation = { pass: 0, bootstrapPending: false };
      s.pendingDecision = { kind: "selection", key: "9:15", keys: ["9:15", "9:30"], rounds: 3, report: "Batches 2, 3 need review after three repair rounds." };
      s.steps["9"] = { value: { pending: true } };
    } else { window.studioEntryRepair = true; window.studioHold = "entry-repair"; }
    state.glossaryResearchStudio.study = s;
    document.querySelector("#app").innerHTML = renderGlossaryResearchStudio(state);
  }, paused);
}

test("step9 collects a stable pass before one coordinated repair and finishes with every batch current", async ({ page }) => {
  await mountEntryPassStudy(page);
  await page.getByRole("button", { name: "Run this step", exact: true }).click();
  await expect(page.getByText("Coordinated repair after validation pass 1", { exact: true })).toBeVisible();
  const before = await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`); const s = state.glossaryResearchStudio.study;
    const calls = window.studioCalls.filter((c) => c.command === "start_glossary_studio_tool");
    const repair = calls.find((c) => c.args.input.payload.prompt?.includes("Repair selection by"));
    return { translations: calls.filter((c) => c.args.input.kind === "translate").length, note: s.candidates[0].note,
      signatures: Object.values(s.tests).map((trial) => trial.signature), repair: JSON.parse(repair.args.input.payload.prompt.split("Evidence:\n")[1]) };
  });
  expect(before.translations).toBe(3);
  expect(before.note).toBe("Initial selection conditions");
  expect(new Set(before.signatures).size).toBe(1);
  expect(before.repair.failedBatches.map((batch) => batch.batch)).toEqual([2, 3]);
  expect(before.repair.trial.translations.map((p) => p.paragraphId)).toEqual(["p15", "p30"]);
  await page.evaluate(() => { window.studioReleased.push("entry-repair"); window.studioHold = null; });
  await expect(page.getByRole("button", { name: "Save and continue", exact: true })).toBeEnabled();
  const after = await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`);
    const { entryTrialsAreCurrent, finalUsage } = await import(`/${"app"}/glossary-research-studio-workflow.js`);
    const s = state.glossaryResearchStudio.study;
    const calls = window.studioCalls.filter((c) => c.command === "start_glossary_studio_tool");
    return { current: entryTrialsAreCurrent(s), usage: finalUsage(s).c1.occurrences,
      translations: calls.filter((c) => c.args.input.kind === "translate").length,
      repairs: calls.filter((c) => c.args.input.payload.prompt?.includes("Repair selection by")).length };
  });
  expect(after).toEqual({ current: true, usage: 31, translations: 6, repairs: 1 });
  await expect(page.getByText(/Recheck pending · Translation batch/)).toHaveCount(0);
});

test("Continue extends only the failed batches presented in a grouped three-round pause", async ({ page }) => {
  await mountEntryPassStudy(page, true);
  await expect(page.getByRole("dialog")).toContainText("Batches 2, 3");
  await page.getByRole("dialog").getByRole("button", { name: "Review the errors yourself", exact: true }).click();
  await expect(page.getByRole("button", { name: "Review paused research", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Review paused research", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Continue 3 more rounds with AI", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save and continue", exact: true })).toBeEnabled();
  const allowances = await page.evaluate(async () => (await import(`/${"app"}/state.js`)).state.glossaryResearchStudio.study.retryAllowances);
  expect(allowances).toEqual({ "9:15": 6, "9:30": 6 });
});

// The paused study with saved trials: batch 1 passed; batches 2 and 3 each fail one occurrence.
async function mountReviewedEntryStudy(page) {
  await mountEntryPassStudy(page, true);
  await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`);
    const { buildStudioDraft, stableSignature, entryBatchSignature, studyAssignments } = await import(`/${"app"}/glossary-research-studio-workflow.js`);
    const { renderGlossaryResearchStudio } = await import(`/${"screens"}/glossary-research-studio.js`);
    const s = state.glossaryResearchStudio.study;
    const assignments = studyAssignments(s);
    const signature = stableSignature(buildStudioDraft(s));
    for (const index of [0, 15, 30]) {
      const batch = s.passages.slice(index, index + 15);
      const members = assignments.filter((a) => batch.some((p) => p.id === a.paragraphId));
      const fails = (id) => index > 0 && id === `p${index}`;
      s.tests[`9:${index}`] = { phase: "9", signature, batchSignature: entryBatchSignature(s, batch, members), rounds: index ? 3 : 0, passed: index === 0,
        translations: batch.map((p) => ({ paragraphId: p.id, source: p.text, translation: `Tôi đi bộ ${p.id}.` })),
        choices: members.map((a) => ({ paragraphId: a.paragraphId, occurrenceId: a.occurrenceId, candidateId: "c1", rendered: "đi bộ",
          passed: !fails(a.paragraphId), problem: fails(a.paragraphId) ? "The reviewer disagrees" : "" })) };
    }
    document.querySelector("#app").innerHTML = renderGlossaryResearchStudio(state);
  });
}

test("reviewing stuck findings yourself can accept or ignore them and finish step9 without new translations", async ({ page }) => {
  await mountReviewedEntryStudy(page);
  await page.getByRole("dialog").getByRole("button", { name: "Review the errors yourself", exact: true }).click();
  const second = page.locator('details[data-studio-disclosure="9:15"]');
  await expect(second).toHaveAttribute("open", "");
  await second.getByRole("button", { name: "Mark this translation as acceptable.", exact: true }).click();
  await expect(second.getByText("You marked this translation as acceptable.", { exact: true })).toBeVisible();
  const third = page.locator('details[data-studio-disclosure="9:30"]');
  await third.locator(":scope > summary").click();
  await third.getByRole("button", { name: "Ignore this error.", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save and continue", exact: true })).toBeEnabled();
  const result = await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`); const s = state.glossaryResearchStudio.study;
    return { decision: s.pendingDecision, accepted: s.acceptedTranslations, ignored: s.ignoredTestParagraphIds, complete: s.steps["9"].value.complete,
      calls: window.studioCalls.filter((c) => c.command === "start_glossary_studio_tool").length };
  });
  expect(result).toEqual({ decision: null, accepted: { "p15:o0": ["Tôi đi bộ p15."] }, ignored: ["p30"], complete: true, calls: 0 });
});

test("editing the entry from a finding changes only the study and replaces the stuck question", async ({ page }) => {
  await mountReviewedEntryStudy(page);
  await page.getByRole("dialog").getByRole("button", { name: "Review the errors yourself", exact: true }).click();
  await page.locator('details[data-studio-disclosure="9:15"]').getByRole("button", { name: "Edit glossary entry.", exact: true }).click();
  const editor = page.locator('[data-modal-dialog="glossary-term-editor"]');
  await expect(editor).toContainText("Edit Term");
  await expect(editor).toContainText("This edits the entry tested in step 9.");
  await expect(editor.locator('[data-glossary-term-variant-input][data-variant-side="source"]').first()).toBeDisabled();
  await editor.locator("[data-glossary-term-variant-note-input]").first().fill("Use for walking on foot.");
  await editor.locator("[data-glossary-term-notes-input]").fill("Edited general note.");
  await editor.getByRole("button", { name: "Save Term", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Resume this step", exact: true })).toBeEnabled();
  const result = await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`); const s = state.glossaryResearchStudio.study;
    return { note: s.candidates[0].note, generalNote: s.generalNote, decision: s.pendingDecision,
      calls: window.studioCalls.filter((c) => ["start_glossary_studio_tool", "upsert_gtms_glossary_term"].includes(c.command)).length };
  });
  expect(result).toEqual({ note: "Use for walking on foot.", generalNote: "Edited general note.", decision: null, calls: 0 });
});


test("bibliography reads published references and performs no author-verification calls", async ({ page }) => {
  await mountStudio(page);
  await page.getByRole("button", { name: "New research", exact: true }).click();
  await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`);
    const { renderGlossaryResearchStudio } = await import(`/${"screens"}/glossary-research-studio.js`);
    const s = state.glossaryResearchStudio.study; s.step = "4.4.1"; s.scope.corpus = "samael"; s.scope.term = "walk"; s.forms = [{ text: "walk" }]; s.model = {};
    const book = { doc_id: "source-a", title: "Source book — Author A", original_author: "Author A" };
    window.studioReferenceFixture = { books: [book], author_references: { schema_version: 2, ready: true, corpus_fingerprint: "same-corpus" }, authors: [{
      author_id: "author-a", author: "Author A", books: [book], schema_version: 2, count_unit: "distinct_paragraph_texts", fingerprint: "saved-index", review_status: "reviewed", review_rules: "author-or-work-reference-v2",
      pending_witnesses: 0, unresolved_witnesses: 1, confirmed_paragraphs: 2, confirmed_copies: 3, confirmed_occurrences: 4, verified_mentions: null,
      witnesses: [{ id: "w", text: "Ambiguous author reference" }], judgments: [{ id: "w", genuine: null, reason: "Saved uncertainty" }],
    }] };
    document.querySelector("#app").innerHTML = renderGlossaryResearchStudio(state);
  });
  await page.getByRole("button", { name: "Run this step", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save and continue", exact: true })).toBeEnabled();
  const calls = await page.evaluate(() => window.studioCalls.filter((c) => c.command === "start_glossary_studio_tool").map((c) => c.args.input));
  expect(calls.filter((c) => c.kind === "author")).toHaveLength(0);
  expect(calls.filter((c) => c.kind === "ai")).toHaveLength(1);
  expect(calls.filter((c) => c.kind === "corpus" && c.payload.path === "/api/sample" && c.payload.params.kind === "samael")).toHaveLength(0);
  expect(calls.filter((c) => c.payload.params?.author_id === "author-a")).toHaveLength(0);
  expect(calls.filter((c) => c.payload.path === "/api/sample/source-books")).toHaveLength(2);
  await page.getByText("Sources and retrieval details", { exact: true }).click();
  await expect(page.getByText(/2 confirmed paragraphs.*3 corpus copies.*4 name\/title occurrences.*1 unresolved reference/)).toBeVisible();
  const saved = await page.evaluate(async () => (await import(`/${"app"}/state.js`)).state.glossaryResearchStudio.study.steps["4.4.1"].value.evidence.authors[0]);
  expect(saved.review.source).toBe("shared-corpus-index"); expect(saved.mentionEvidence.unresolved_witnesses).toBe(1);
  expect(saved.mentionEvidence.witnesses).toBeUndefined();
});

test("completed forms have no comparison rerun and export the original evidence", async ({ page }) => {
  await mountStudio(page);
  await page.getByRole("button", { name: "New research", exact: true }).click();
  await page.getByLabel("Term to research").fill("walk");
  await page.getByRole("listbox", { name: "Projects", exact: true }).selectOption("p1");
  await page.getByRole("button", { name: "Begin research", exact: true }).click();
  await startFormsResearch(page);
  await expect(page.getByLabel("Source form", { exact: true }).first()).toBeEnabled();
  await expect(page.getByText("Research comparison", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Rerun this step for comparison", exact: true })).toHaveCount(0);
  const before = await page.evaluate(() => window.studioCalls.filter((c) => c.command === "start_glossary_studio_tool").length);
  // A stale action from an older render cannot start a comparison either.
  await page.evaluate(async () => {
    const { studioAction } = await import(`/${"app"}/glossary-research-studio-flow.js`);
    await studioAction("studio:compare-run", () => {});
  });
  expect(await page.evaluate(() => window.studioCalls.filter((c) => c.command === "start_glossary_studio_tool").length)).toBe(before);
  await showExportStep(page);
  await page.locator('[data-action="studio:export"]').click();
  await expect.poll(() => page.evaluate(() => window.studioExports?.length ?? 0)).toBe(1);
  const full = await page.evaluate(() => window.studioExports[0].value);
  expect(full.steps["2a"].value.forms.length).toBeGreaterThan(0);
  expect(full.timing.steps["2a"].runs).toHaveLength(1);
  expect(Object.values(full.cache).some((entry) => entry.request.payload.prompt?.includes("Verify all proposed"))).toBe(true);
  expect(JSON.stringify(full)).not.toContain("_studioArtifact");
});


test("compact corpus citations open complete saved source context on demand without research calls", async ({ page }) => {
  await mountStudio(page);
  await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`);
    const { newStudioStudy, deduplicatePassages } = await import(`/${"app"}/glossary-research-studio-workflow.js`);
    const { saveStudioStudy } = await import(`/${"app"}/glossary-research-studio-query.js`);
    const { renderGlossaryResearchStudio } = await import(`/${"screens"}/glossary-research-studio.js`);
    const s = newStudioStudy({ ...state.glossaryEditor, installationId: 7, teamId: "team", term: "walk", corpus: "projects" }, "source-citation");
    s.step = "4.5"; s.revision = 1;
    s.passages = deduplicatePassages([{ id: "083baae125951446", text: "I walk through the complete saved source paragraph.",
      contextBefore: ["Earlier decisive context"], references: [{ title: "Test source", line_id: 42 }] }], ["walk"], "en");
    s.meanings = [{ id: "m1", definition: "Move on foot", evidence: ["083baae125951446"] }];
    s.steps["4.5"] = { value: { meanings: s.meanings } };
    state.glossaryResearchStudio = { study: s, history: [] };
    await saveStudioStudy(s);
    if (!s.passages._studioArtifact) throw new Error("Expected cold source evidence");
    document.querySelector("#app").innerHTML = renderGlossaryResearchStudio(state);
    window.studioCalls = [];
  });
  await page.getByText("Evidence and sources", { exact: true }).click();
  await page.getByRole("button", { name: "View source paragraph", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Cited source paragraph" })).toBeVisible();
  await expect(dialog).toContainText("complete saved source paragraph");
  await dialog.getByText("Surrounding source context", { exact: true }).click();
  await expect(dialog).toContainText("Earlier decisive context");
  expect(await page.evaluate(() => window.studioCalls.filter((c) => c.command === "start_glossary_studio_tool").length)).toBe(0);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test("outline navigation opens a cold report's complete evidence without rerunning research", async ({ page }) => {
  await mountStudio(page);
  await page.getByRole("button", { name: "New research", exact: true }).click();
  await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`);
    const { saveStudioStudy } = await import(`/${"app"}/glossary-research-studio-query.js`);
    const { renderGlossaryResearchStudio } = await import(`/${"screens"}/glossary-research-studio.js`);
    const s = state.glossaryResearchStudio.study; s.step = "4.4.2";
    s.steps["4.4.1"] = { value: { summary: "Approved findings", meanings: [], evidence: { extract: "Complete preserved book evidence for review" } } };
    await saveStudioStudy(s);
    document.querySelector("#app").innerHTML = renderGlossaryResearchStudio(state);
  });
  await page.locator('[data-action="studio:visit:4.4.1"]').click();
  await expect(page.getByRole("heading", { name: "4.4.1 · Bibliographical sources", exact: true })).toBeVisible();
  await page.getByText("Sources and retrieval details", { exact: true }).click();
  await page.getByText("Dictionary text", { exact: true }).click();
  await expect(page.getByText("Complete preserved book evidence for review", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.studioCalls.filter((c) => c.command === "start_glossary_studio_tool").length)).toBe(0);
});


test("completed assignments progress without offering a comparison rerun", async ({ page }) => {
  await mountStudio(page); await seedPreliminaryStudy(page);
  await page.evaluate(() => window.studioReleased.push("preliminary"));
  await page.getByRole("button", { name: "Run this step", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save and continue", exact: true })).toBeEnabled();
  await expect(page.getByText("Research comparison", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Rerun this step for comparison", exact: true })).toHaveCount(0);
  const result = await page.evaluate(async () => {
    const s = (await import(`/${"app"}/state.js`)).state.glossaryResearchStudio.study;
    const calls = window.studioCalls.filter((c) => c.command === "start_glossary_studio_tool").map((c) => c.args.input);
    return { aiCalls: calls.filter((c) => c.kind === "ai").length,
      translationCalls: calls.filter((c) => c.kind === "translate").length,
      assignments: s.assignments.length, runs: s.timing.steps["4.6"].runs.length };
  });
  expect(result).toEqual({ aiCalls: 1, translationCalls: 0, assignments: 31, runs: 1 });
});


test("completed meaning and entry tests do not offer comparison reruns", async ({ page }) => {
  await mountStudio(page); await seedCollision(page);
  await page.evaluate(async () => {
    const { state } = await import(`/${"app"}/state.js`);
    const { renderGlossaryResearchStudio } = await import(`/${"screens"}/glossary-research-studio.js`);
    const s = state.glossaryResearchStudio.study; s.step = "8"; s.candidates[0].confirmed = false;
    document.querySelector("#app").innerHTML = renderGlossaryResearchStudio(state);
  });
  await page.getByRole("button", { name: "Run this step", exact: true }).click();
  await expect(page.getByRole("heading", { name: "10a · Review usage", exact: true })).toBeVisible();
  await page.locator('[data-action="studio:visit:8"]').click();
  await expect(page.getByRole("button", { name: "Save and continue", exact: true })).toBeEnabled();
  await expect(page.getByText("Research comparison", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Rerun this step for comparison", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Save and continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "9 · Test complete entry", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save and continue", exact: true })).toBeEnabled();
  await expect(page.getByText("Research comparison", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Rerun this step for comparison", exact: true })).toHaveCount(0);
  const runs = await page.evaluate(async () => {
    const s = (await import(`/${"app"}/state.js`)).state.glossaryResearchStudio.study;
    return ["8", "9"].map((step) => s.timing.steps[step].runs.length);
  });
  expect(runs).toEqual([1, 1]);
});
