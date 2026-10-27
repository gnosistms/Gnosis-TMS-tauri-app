import test from "node:test";
import assert from "node:assert/strict";
import { state } from "../app/state.js";
import { newStudioStudy, STUDIO_STEPS, buildStudioDraft, stableSignature, entryBatchSignature, studioStepNumber } from "../app/glossary-research-studio-workflow.js";
import { STUDIO_SKIP_PROMPTS, studioRecommendationKey } from "../app/glossary-research-studio-recommendations.js";
import { renderGlossaryResearchStudio } from "./glossary-research-studio.js";

test("source neighbors are escaped and clearly separated from the sampled paragraph and its translation", () => {
  const previous = state.glossaryResearchStudio;
  try {
    const study = newStudioStudy({ sourceLanguage: { code: "es", name: "Spanish" },
      targetLanguage: { code: "en", name: "English" }, term: "fatal" }, "context");
    study.step = "3";
    study.passages = [{ id: "p", text: "Una diosa fatal", contextBefore: ["<script>source evidence</script>"], contextAfter: ["Belleza seductora"], references: [] }];
    state.glossaryResearchStudio = { study, history: [] };
    const html = renderGlossaryResearchStudio(state);
    assert.match(html, /<details class="studio-source-context"[^>]*><summary>Surrounding source context/);
    assert(html.includes("not counted as additional examples"));
    assert(html.includes("Before this paragraph"));
    assert(html.includes("After this paragraph"));
    assert(html.includes("&lt;script&gt;source evidence&lt;/script&gt;"));
    assert(!html.includes("<script>source evidence"));
    study.passages[0].contextBefore = []; study.passages[0].contextAfter = [];
    assert(!renderGlossaryResearchStudio(state).includes("Surrounding source context"));
  } finally { state.glossaryResearchStudio = previous; }
});

test("every studio stage renders through the page shell for a non-Spanish source language", () => {
  const previous = state.glossaryResearchStudio;
  try {
    const study = newStudioStudy({ sourceLanguage: { code: "en", name: "English" },
      targetLanguage: { code: "vi", name: "Vietnamese" }, term: "walk", corpus: "projects" }, "test");
    state.glossaryResearchStudio = { study, history: [], mergeDestinations: {} };
    for (const step of STUDIO_STEPS) {
      study.step = step.id;
      const html = renderGlossaryResearchStudio(state);
      assert(html.includes("Glossary") || html.includes("Research"), step.id);
      assert(html.includes(`${studioStepNumber(step.id)} · ${step.label}`), step.id);
      assert(!html.includes('data-action="studio:back"'), step.id);
      assert.doesNotMatch(html, /Research comparison|Rerun this step for comparison|studio:compare-run/, step.id);
      if (step.id === "2a") assert.doesNotMatch(html, /data-action="studio:recommend"/);
      assert(!html.includes("[object Object]"), step.id);
    }
    study.step = "1";
    assert(!renderGlossaryResearchStudio(state).includes('<option value="samael"'));
  } finally { state.glossaryResearchStudio = previous; }
});

test("Export research is available from step 4.2 onward with the shared tooltip", () => {
  const previous = state.glossaryResearchStudio;
  try {
    const s = newStudioStudy({ sourceLanguage: { code: "es", name: "Spanish" }, targetLanguage: { code: "en", name: "English" } }, "export-tip");
    state.glossaryResearchStudio = { study: s, history: [] };
    for (const [index, step] of STUDIO_STEPS.entries()) {
      s.step = step.id;
      const html = renderGlossaryResearchStudio(state);
      if (index < STUDIO_STEPS.findIndex((st) => st.id === "4.2")) assert.doesNotMatch(html, /data-action="studio:export"/);
      else assert.match(html, /data-action="studio:export"[^>]*data-tooltip="export a summary of the data uncovered during the research process in a JSON format appropriate for sending it to an AI for further discussion\."/);
    }
    state.glossaryResearchStudio.exporting = true;
    assert.match(renderGlossaryResearchStudio(state), /data-action="studio:export"[^>]*disabled/);
  } finally { state.glossaryResearchStudio = previous; }
});

test("the outline shows stale completed and skipped stages instead of making them look unstarted", () => {
  const previous = state.glossaryResearchStudio;
  try {
    const s = newStudioStudy({ term: "ilustre", sourceLanguage: { code: "es", name: "Spanish" }, targetLanguage: { code: "en", name: "English" } }, "ilustre-outline");
    s.step = "8";
    for (const id of ["4.7", "6", "7"]) s.steps[id] = { status: "stale", approved: { summary: "Preserved research" } };
    s.steps["5"] = { status: "stale", approved: { _studioArtifact: "a".repeat(64), skipped: true } };
    state.glossaryResearchStudio = { study: s, busy: false };
    const outline = renderGlossaryResearchStudio(state).split('aria-label="Research steps"')[1].split("</aside>")[0];
    assert.match(outline, /4\.7 · Split entries · needs review<\/button><\/li>/);
    assert.match(outline, /5 · Compounds and phrases · previously skipped; needs review<\/button><\/li>/);
    assert.match(outline, /6 · Translation candidates · needs review<\/button><\/li>/);
    assert.match(outline, /7 · Standardize spelling · needs review<\/button><\/li>/);
    assert.match(outline, /9 · Test complete entry<\/button><\/li>/, "future work remains unmarked");
    assert(outline.includes("Saved results remain available"));
    assert.equal(s.steps["4.7"].status, "stale", "rendering must not bless old results");
    assert.equal(s.steps["5"].approved.skipped, true);
  } finally { state.glossaryResearchStudio = previous; }
});

test("paused repair decisions are resumable rather than trapping the user in a modal", () => {
  const previous = state.glossaryResearchStudio;
  try {
    const study = newStudioStudy({ sourceLanguage: { code: "fr", name: "French" },
      targetLanguage: { code: "en", name: "English" }, term: "marcher" }, "test");
    study.step = "8"; study.pendingDecision = { kind: "progress", rounds: 5, report: "Progress" };
    state.glossaryResearchStudio = { study, history: [], hideDecision: false };
    assert(renderGlossaryResearchStudio(state).includes('data-modal-dialog="studio-question"'));
    assert(renderGlossaryResearchStudio(state).includes("Research progress · 5 repair rounds"));
    state.glossaryResearchStudio.hideDecision = true;
    const html = renderGlossaryResearchStudio(state);
    assert(!html.includes('data-modal-dialog="studio-question"'));
    assert(html.includes("Review paused research"));
  } finally { state.glossaryResearchStudio = previous; }
});

test("an unfinished lookup does not claim there are no matching entries", () => {
  const previous = state.glossaryResearchStudio;
  try {
    const study = newStudioStudy({ sourceLanguage: { code: "es", name: "Spanish" },
      targetLanguage: { code: "en", name: "English" }, term: "Mundo" }, "test");
    study.step = "2b";
    state.glossaryResearchStudio = { study, busy: true, message: "Checking existing glossary entries" };
    const html = renderGlossaryResearchStudio(state);
    assert(!html.includes("No related existing entries found"));
    assert(html.includes("Results will appear here when this step is ready for review"));
  } finally { state.glossaryResearchStudio = previous; }
});

test("optional dictionary research explains the action and cannot continue before a result", () => {
  const previous = state.glossaryResearchStudio;
  try {
    const study = newStudioStudy({ sourceLanguage: { code: "es", name: "Spanish" },
      targetLanguage: { code: "en", name: "English" }, term: "Mundo" }, "test");
    study.step = "4.1";
    state.glossaryResearchStudio = { study, busy: false };
    const html = renderGlossaryResearchStudio(state);
    assert(html.includes("Look up definitions, grammatical uses and etymology"));
    assert.doesNotMatch(html, /data-action="studio:next"/u);
    assert(html.includes("Skip this step"));
    study.steps["4.1"] = { value: { meanings: [] } };
    assert(renderGlossaryResearchStudio(state).includes("Refresh dictionary research"));
  } finally { state.glossaryResearchStudio = previous; }
});

test("skip advice is escaped and advisory, stale advice is hidden, and the summary is numbered 4.4.3", () => {
  const previous = state.glossaryResearchStudio;
  try {
    const s = newStudioStudy({ term: "ilustre", sourceLanguage: { code: "es", name: "Spanish" }, targetLanguage: { code: "en", name: "English" } }, "skip-ui");
    s.step = "4.3"; s.skipRecommendations = { "4.3": { contextKey: studioRecommendationKey(s), recommendation: "Skip", reason: "<script>Untrusted source</script>" } };
    state.glossaryResearchStudio = { study: s, busy: false };
    let html = renderGlossaryResearchStudio(state);
    assert(html.includes("AI recommendation: Skip it."));
    assert.doesNotMatch(html, /You decide whether to run or skip|Uncertainty defaults to Run/);
    assert(html.includes("&lt;script&gt;Untrusted source&lt;/script&gt;"));
    assert.match(html, /<details class="studio-recommendation-reason" data-studio-disclosure="recommendation-reason"><summary class="text-link">Show reasoning<\/summary>/);
    assert.match(html, /data-action="studio:run"/); assert.match(html, /data-action="studio:skip"/);
    s.scope.term = "different";
    html = renderGlossaryResearchStudio(state);
    assert(!html.includes("AI recommendation: Skip it."));
    assert(html.includes("No current recommendation"));
    s.step = "4.4.4";
    html = renderGlossaryResearchStudio(state);
    assert.match(html, /<h2>4\.4\.3 · Source summary<\/h2>/);
    assert(!html.includes("4.4.4 · Source summary"));
    assert(html.includes("Skipping here discards the entire source-research branch"));
  } finally { state.glossaryResearchStudio = previous; }
});

test("all run-or-skip recommendations disappear after a choice, including paused and revisited research", () => {
  const previous = state.glossaryResearchStudio;
  try {
    for (const step of Object.keys(STUDIO_SKIP_PROMPTS)) {
      const s = newStudioStudy({ term: "mundo", sourceLanguage: { code: "es", name: "Spanish" },
        targetLanguage: { code: "en", name: "English" } }, "recommendation-visibility");
      s.step = step;
      s.skipRecommendations = { [step]: { contextKey: studioRecommendationKey(s), recommendation: "Run", reason: "Check the evidence." } };
      const saved = structuredClone(s.skipRecommendations);
      const view = { study: s, busy: false }; state.glossaryResearchStudio = view;
      assert.match(renderGlossaryResearchStudio(state), /AI recommendation: Run it\./u, `${step}: before choice`);
      view.busy = true; view.recommendingStep = step;
      assert.match(renderGlossaryResearchStudio(state), /Considering whether this research step would help/u, `${step}: getting advice`);
      view.recommendingStep = null;
      assert.doesNotMatch(renderGlossaryResearchStudio(state), /class="studio-recommendation"/u, `${step}: running`);
      view.busy = false;
      s.activitySteps = { [step]: { items: [{ id: "work", label: "Saved work", status: "paused", children: [] }] } };
      assert.doesNotMatch(renderGlossaryResearchStudio(state), /class="studio-recommendation"/u, `${step}: paused`);
      delete s.activitySteps;
      for (const status of ["awaiting-review", "complete", "skipped"]) {
        s.steps[step] = { status, ...(status === "skipped" ? { approved: { skipped: true } } : {}) };
        view.revisiting = status !== "awaiting-review";
        assert.doesNotMatch(renderGlossaryResearchStudio(state), /class="studio-recommendation"/u, `${step}: ${status}`);
      }
      assert.deepEqual(s.skipRecommendations, saved, "advice remains saved for diagnostics");
    }
  } finally { state.glossaryResearchStudio = previous; }
});

test("completed optional steps hide Skip while unstarted and unfinished steps retain it", () => {
  const previous = state.glossaryResearchStudio;
  try {
    for (const step of Object.keys(STUDIO_SKIP_PROMPTS)) {
      const s = newStudioStudy({ term: "mundo", sourceLanguage: { code: "es", name: "Spanish" },
        targetLanguage: { code: "en", name: "English" } }, "skip-visibility");
      s.step = step;
      const view = { study: s, busy: false }; state.glossaryResearchStudio = view;
      for (const record of [undefined, { status: "undone" }, { status: "failed" }, { value: { pending: true } }]) {
        if (record) s.steps[step] = record;
        else delete s.steps[step];
        assert.match(renderGlossaryResearchStudio(state), /data-action="studio:skip"/u, `${step}: ${JSON.stringify(record)}`);
      }
      for (const record of [{ value: { summary: "Completed research" } },
        { status: "awaiting-review", value: {} }, { status: "complete" }, { status: "skipped" },
        { status: "stale", approved: { summary: "Earlier research" } }]) {
        s.steps[step] = record;
        for (const revisiting of [false, true]) {
          view.revisiting = revisiting;
          assert.doesNotMatch(renderGlossaryResearchStudio(state), /data-action="studio:skip"/u, `${step}: ${JSON.stringify(record)}, revisiting=${revisiting}`);
        }
      }
    }
  } finally { state.glossaryResearchStudio = previous; }
});

test("meaning reports highlight only the occurrences assigned to each meaning in a shared paragraph", () => {
  const previous = state.glossaryResearchStudio;
  try {
    const study = newStudioStudy({ sourceLanguage: { code: "es", name: "Spanish" },
      targetLanguage: { code: "en", name: "English" }, term: "mundo" }, "test");
    study.step = "4.6"; study.steps["4.6"] = { value: {} };
    study.meanings = [{ id: "planet", definition: "A planet" }, { id: "realm", definition: "A realm" }];
    study.passages = [{ id: "p", text: "mundo y mundo", occurrences: [{ id: "o0", start: 0, end: 5 }, { id: "o1", start: 8, end: 13 }],
      references: [{ title: "Source book", chapter_title: "Original chapter context", line_id: 42 }] }];
    study.assignments = [{ paragraphId: "p", occurrenceId: "o0", meaningId: "planet" }, { paragraphId: "p", occurrenceId: "o1", meaningId: "realm" }];
    study.displayTranslations = { p: "Unverified reading aid" };
    state.glossaryResearchStudio = { study, busy: false };
    const html = renderGlossaryResearchStudio(state);
    assert(html.includes("<mark>mundo</mark> y mundo"));
    assert(html.includes("mundo y <mark>mundo</mark>"));
    assert.equal((html.match(/<mark>/gu) ?? []).length, 2);
    assert(html.includes("Meaning 1 · 1 occurrence"));
    assert(html.includes("Show usage examples (1 paragraph)"));
    assert(html.includes("Source book · Original chapter context · 42"));
    assert.equal((html.match(/<strong>Preliminary translation<\/strong>/gu) ?? []).length, 2);
    assert(html.includes("Without glossary guidance"));
    assert(html.includes("Judge meanings from the original Spanish text"));
    assert(html.includes("Unverified reading aid"));
  } finally { state.glossaryResearchStudio = previous; }
});

test("an interrupted pending test offers resume and cannot approve unfinished work", () => {
  const previous = state.glossaryResearchStudio;
  try {
    const s = newStudioStudy({ term: "mundo", sourceLanguage: { code: "es", name: "Spanish" },
      targetLanguage: { code: "en", name: "English" } }, "resume");
    s.step = "8"; s.steps["8"] = { value: { pending: true } };
    state.glossaryResearchStudio = { study: s, busy: false };
    const html = renderGlossaryResearchStudio(state);
    assert(html.includes("Resume this step"));
    assert.doesNotMatch(html, /data-action="studio:next"/u);
  } finally { state.glossaryResearchStudio = previous; }
});

test("meaning numbers stay consistent across reports, candidate review, trials and occurrence review when a meaning has no examples", () => {
  const previous = state.glossaryResearchStudio;
  try {
    const s = newStudioStudy({ term: "mundo", sourceLanguage: { code: "es", name: "Spanish" },
      targetLanguage: { code: "en", name: "English" } }, "stable-meaning-labels");
    s.forms = [{ text: "mundo" }];
    s.meanings = [{ id: "unused", definition: "No examples", unused: true },
      { id: "planet", definition: "A planet" }, { id: "realm", definition: "A realm" }];
    s.passages = [{ id: "p", text: "mundo", occurrences: [{ id: "o0", start: 0, end: 5 }] }];
    s.assignments = [{ paragraphId: "p", occurrenceId: "o0", meaningId: "realm" }];
    s.candidates = [{ id: "world", text: "world", meaningIds: ["realm"], confirmed: true }];
    s.step = "4.6"; s.steps["4.6"] = { value: {} };
    state.glossaryResearchStudio = { study: s, busy: false };
    assert(renderGlossaryResearchStudio(state).includes("Meaning 3 · 1 occurrence"));
    s.step = "6";
    assert(renderGlossaryResearchStudio(state).includes("<h3>Meaning 3</h3>"));
    s.step = "8";
    s.tests["8:realm"] = { passed: true, rounds: 0, translations: [], choices: [] };
    assert(renderGlossaryResearchStudio(state).includes("· Meaning 3 ·"));
    assert(renderGlossaryResearchStudio(state).includes("Meaning 3 · initial test"));
    s.tests["8:realm"].rounds = 5;
    assert(renderGlossaryResearchStudio(state).includes("Meaning 3 · repair round 5"));
    s.step = "4.5";
    assert(renderGlossaryResearchStudio(state).includes("<h3>Meaning 3</h3>"));
    s.step = "4.6"; s.decisionInput = { meaningReview: "realm" };
    state.glossaryResearchStudio.modal = { kind: "meaningReview", paragraphId: "p", occurrenceId: "o0" };
    assert.match(renderGlossaryResearchStudio(state), /value="realm" selected>3\. A realm/u);
  } finally { state.glossaryResearchStudio = previous; }
});


test("entry changes mark successful full-entry trials for recheck and expose notes for human editing", () => {
  const previous = state.glossaryResearchStudio;
  try {
    const s = newStudioStudy({ term: "mundo", sourceLanguage: { code: "es", name: "Spanish" },
      targetLanguage: { code: "en", name: "English" } }, "notes");
    s.step = "9"; s.meanings = [{ id: "m", definition: "A realm" }];
    s.candidates = [{ id: "c", text: "world", meaningIds: ["m"], confirmed: true, note: "Original note" }];
    s.tests["9:0"] = { phase: "9", signature: stableSignature(buildStudioDraft(s)), batchSignature: entryBatchSignature(s, [], []), passed: true, choices: [], translations: [] };
    state.glossaryResearchStudio = { study: s, busy: false };
    assert(!renderGlossaryResearchStudio(state).includes("Recheck pending"));
    s.candidates[0].note = "Updated selection guidance";
    const html = renderGlossaryResearchStudio(state);
    assert(html.includes("Recheck pending"));
    assert(html.includes("Entry under test · notes and preference"));
    assert(html.includes('data-studio-shared-note="world"'));
    assert(html.includes("Full research sample:"));
  } finally { state.glossaryResearchStudio = previous; }
});

test("failed occurrences share full paragraph context above the expandable trial translations", () => {
  const previous = state.glossaryResearchStudio;
  try {
    const s = newStudioStudy({ term: "mundo", sourceLanguage: { code: "es", name: "Spanish" },
      targetLanguage: { code: "en", name: "English" } }, "findings");
    s.step = "8"; s.meanings = [{ id: "m", definition: "A realm" }];
    s.passages = [{ id: "p", text: "mundo y mundo", occurrences: [{ id: "o0", start: 0, end: 5 }, { id: "o1", start: 8, end: 13 }] }];
    s.assignments = s.passages[0].occurrences.map((o) => ({ paragraphId: "p", occurrenceId: o.id, meaningId: "m" }));
    s.tests["8:m"] = { translations: [{ paragraphId: "p", source: "mundo y mundo", translation: "planet and planet" }],
      choices: s.assignments.map((a) => ({ ...a, problem: "Choose a realm here." })) };
    state.glossaryResearchStudio = { study: s, busy: false };
    const html = renderGlossaryResearchStudio(state);
    const findings = html.slice(html.indexOf('class="studio-findings"'), html.indexOf("All trial translations"));
    assert.equal((findings.match(/class="studio-passage"/gu) ?? []).length, 1);
    assert.equal((findings.match(/>Review meaning</gu) ?? []).length, 2);
    assert(findings.includes("<mark>mundo</mark> y <mark>mundo</mark>"));
    assert(findings.includes("planet and planet"));
  } finally { state.glossaryResearchStudio = previous; }
});

test("meaning review shows saving feedback and blocks duplicate saves during persistence", () => {
  const previous = state.glossaryResearchStudio;
  try {
    const s = newStudioStudy({ term: "mundo", sourceLanguage: { code: "es", name: "Spanish" },
      targetLanguage: { code: "en", name: "English" } }, "saving");
    s.meanings = [{ id: "m", definition: "A realm" }];
    s.passages = [{ id: "p", text: "mundo", occurrences: [{ id: "o0", start: 0, end: 5 }] }];
    state.glossaryResearchStudio = { study: s, savingAssignment: true,
      modal: { kind: "meaningReview", paragraphId: "p", occurrenceId: "o0" } };
    const html = renderGlossaryResearchStudio(state);
    assert(html.includes("Saving…"));
    assert.match(html, /data-action="studio:save-assignment"[^>]*disabled/u);
    assert.match(html, /data-studio-decision="meaningReview"[^>]*disabled/u);
  } finally { state.glossaryResearchStudio = previous; }
});

test("meaning review uses the matching focused trial instead of an older complete-entry translation", () => {
  const previous = state.glossaryResearchStudio;
  try {
    const s = newStudioStudy({ term: "mundo", sourceLanguage: { code: "es", name: "Spanish" },
      targetLanguage: { code: "en", name: "English" } }, "latest-review");
    s.step = "8"; s.meanings = [{ id: "m", definition: "A realm" }];
    s.passages = [{ id: "p", text: "mundo", occurrences: [{ id: "o0", start: 0, end: 5 }] }];
    s.assignments = [{ paragraphId: "p", occurrenceId: "o0", meaningId: "m" }];
    s.tests["9:0"] = { phase: "9", translations: [{ paragraphId: "p", translation: "Old full-entry rendering" }] };
    s.tests["8:m"] = { phase: "8", translations: [{ paragraphId: "p", translation: "Current focused rendering" }] };
    s.displayTranslations = { p: "Unverified reading aid" };
    state.glossaryResearchStudio = { study: s, modal: { kind: "meaningReview", paragraphId: "p", occurrenceId: "o0" } };
    const html = renderGlossaryResearchStudio(state).split('class="modal-backdrop"')[1];
    assert(html.includes("Current focused rendering"));
    assert(!html.includes("Old full-entry rendering"));
    assert(!html.includes("Unverified reading aid"));
    assert(!html.includes("Preliminary translation"));
  } finally { state.glossaryResearchStudio = previous; }
});

test("retention shows one row per active target spelling with combined usage", () => {
  const previous = state.glossaryResearchStudio;
  try {
    const s = newStudioStudy({ term: "mundo", sourceLanguage: { code: "es", name: "Spanish" },
      targetLanguage: { code: "en", name: "English" } }, "retention");
    s.step = "10a"; s.meanings = [{ id: "m", definition: "A realm" }];
    s.candidates = [{ id: "a", text: "world", confirmed: true, meaningIds: ["m"] },
      { id: "b", text: "world", confirmed: true, meaningIds: ["m"] },
      { id: "inactive", text: "worlds", confirmed: true, meaningIds: [] }];
    s.usageByText = { world: { occurrences: 3, paragraphs: 2 } };
    state.glossaryResearchStudio = { study: s };
    const html = renderGlossaryResearchStudio(state);
    assert.equal((html.match(/data-studio-retain-text="world"/gu) ?? []).length, 1);
    assert(!html.includes('data-studio-retain-text="worlds"'));
    assert(html.includes("3 occurrences across 2 paragraphs"));
  } finally { state.glossaryResearchStudio = previous; }
});

test("successful trial translations still allow a human to review each occurrence meaning", () => {
  const previous = state.glossaryResearchStudio;
  try {
    const s = newStudioStudy({ term: "mundo", sourceLanguage: { code: "es", name: "Spanish" },
      targetLanguage: { code: "en", name: "English" } }, "passed-review");
    s.step = "8"; s.meanings = [{ id: "m", definition: "A realm" }];
    s.passages = [{ id: "p", text: "mundo y mundo", occurrences: [{ id: "o0", start: 0, end: 5 }, { id: "o1", start: 8, end: 13 }] }];
    s.assignments = s.passages[0].occurrences.map((o) => ({ paragraphId: "p", occurrenceId: o.id, meaningId: "m" }));
    s.tests["8:m"] = { passed: true, choices: s.assignments,
      translations: [{ paragraphId: "p", source: "mundo y mundo", translation: "world and world" }] };
    state.glossaryResearchStudio = { study: s, busy: false };
    const html = renderGlossaryResearchStudio(state);
    assert(html.includes('data-action="studio:review-assignment:p:o0"'));
    assert(html.includes('data-action="studio:review-assignment:p:o1"'));
    assert(html.includes("Review occurrence 1"));
    assert(html.includes("Review occurrence 2"));
  } finally { state.glossaryResearchStudio = previous; }
});

test("complete-entry summaries identify the batch and current paragraph range", () => {
  const previous = state.glossaryResearchStudio;
  try {
    const s = newStudioStudy({ term: "mundo", sourceLanguage: { code: "es", name: "Spanish" },
      targetLanguage: { code: "en", name: "English" } }, "batch-labels");
    s.step = "9"; s.forms = [{ text: "mundo" }]; s.meanings = [{ id: "m", definition: "A realm" }];
    s.passages = Array.from({ length: 18 }, (_, i) => ({ id: `p${i}`, text: "mundo", occurrences: [{ id: "o0", start: 0, end: 5 }] }));
    s.assignments = s.passages.map((p) => ({ paragraphId: p.id, occurrenceId: "o0", meaningId: "m" }));
    s.tests["9:15"] = { phase: "9", choices: [], translations: [] };
    state.glossaryResearchStudio = { study: s };
    assert(renderGlossaryResearchStudio(state).includes("Translation batch 2 · paragraphs 16–18"));
  } finally { state.glossaryResearchStudio = previous; }
});


test("an empty split queue offers Finish, then Return to glossary once complete", () => {
  const previous = state.glossaryResearchStudio;
  try {
    const s = newStudioStudy({ term: "mundo", sourceLanguage: { code: "es", name: "Spanish" },
      targetLanguage: { code: "en", name: "English" } }, "finished");
    s.step = "12"; state.glossaryResearchStudio = { study: s, busy: false };
    let html = renderGlossaryResearchStudio(state);
    assert(html.includes("All split entries have been reviewed."));
    assert(html.includes(">Finish research</button>"));
    s.status = "complete"; html = renderGlossaryResearchStudio(state);
    assert(html.includes('data-action="studio:exit"'));
    assert(html.includes(">Return to glossary</button>"));
    assert(!html.includes(">Continue split-entry queue</button>"));
  } finally { state.glossaryResearchStudio = previous; }
});


test("research findings precede expandable retrieval details and source links are deduplicated", () => {
  const previous = state.glossaryResearchStudio;
  try {
    const s = newStudioStudy({ term: "hooltanpanas", sourceLanguage: { code: "es", name: "Spanish" },
      targetLanguage: { code: "en", name: "English" } }, "sources");
    s.step = "4.1";
    const source = { url: "https://example.org/book", quotation: "Original source text" };
    s.steps["4.1"] = { value: { dictionaryVersion: 3, summary: "Verified finding", meanings: [{ definition: "Cosmic color unit", evidence: [source] }],
      evidence: { primary: { status: "unreachable", reason: "Verification expired" }, fallback: { summary: "Detailed search report", citations: [source, source] } } } };
    state.glossaryResearchStudio = { study: s, busy: false };
    const html = renderGlossaryResearchStudio(state);
    assert(html.indexOf("Cosmic color unit") < html.indexOf("Sources and retrieval details"));
    assert(html.indexOf("Sources and retrieval details") < html.indexOf("Detailed search report"));
    assert.equal((html.match(/>https:\/\/example.org\/book<\/a>/gu) ?? []).length, 1);
    assert(html.includes("Verification expired"));
    s.steps["4.1"].value.meanings.push({ definition: "Another sourced meaning", evidence: [source, source] });
    const cards = [...renderGlossaryResearchStudio(state).matchAll(/<article class="studio-entry">([\s\S]*?)<\/article>/gu)];
    assert.equal(cards.length, 2);
    for (const card of cards) assert.equal((card[1].match(/>https:\/\/example.org\/book<\/a>/gu) ?? []).length, 1);
  } finally { state.glossaryResearchStudio = previous; }
});


test("bibliographical details separate author mentions from per-book term counts and preserve metadata uncertainty", () => {
  const previous = state.glossaryResearchStudio;
  try {
    const s = newStudioStudy({ term: "hooltanpanas", sourceLanguage: { code: "es", name: "Spanish" },
      targetLanguage: { code: "en", name: "English" } }, "bibliography");
    s.step = "4.4.1"; s.steps[s.step] = { value: { summary: "Source comparison", evidence: { authors: [{
      author: "Gurdjieff", verifiedMentions: null,
      books: [{ doc_id: "book", title: "Original book", original_first_printing: "1950" }],
      termCounts: [{ docId: "book", occurrences: 2, paragraphs: 1 }], passages: [{ text: "Original witness" }],
    }] } } };
    state.glossaryResearchStudio = { study: s, busy: false };
    const html = renderGlossaryResearchStudio(state);
    assert(html.includes("Sources and retrieval details"));
    assert(html.includes("Verified author or book mentions: Unresolved"));
    assert(html.includes("2 term occurrences in 1 paragraph"));
    assert(html.includes("Original publication: 1950"));
    assert(html.includes("First Spanish translation: Unknown"));
    assert(html.includes("Sampled source passages (1)"));
    assert(html.includes("Original witness"));
  } finally { state.glossaryResearchStudio = previous; }
});


test("a completed empty compound search says no qualifying expressions were found", () => {
  const previous = state.glossaryResearchStudio;
  try {
    const s = newStudioStudy({ term: "hooltanpanas", sourceLanguage: { code: "es", name: "Spanish" }, targetLanguage: { code: "en", name: "English" } }, "empty-compounds");
    s.step = "5"; s.steps["5"] = { value: { compounds: [] } };
    state.glossaryResearchStudio = { study: s, busy: false };
    assert(renderGlossaryResearchStudio(state).includes("No qualifying recurring compounds or phrases were found"));
  } finally { state.glossaryResearchStudio = previous; }
});


test("collision-step retained-entry verification shows the full trial report", () => {
  const previous = state.glossaryResearchStudio;
  try {
    const s = newStudioStudy({ term: "mundo", sourceLanguage: { code: "es", name: "Spanish" },
      targetLanguage: { code: "en", name: "English" } }, "retained-verification");
    s.step = "10b"; s.forms = [{ text: "mundo" }];
    s.meanings = [{ id: "m", definition: "A planet" }];
    s.passages = [{ id: "p", text: "mundo", occurrences: [{ id: "o0", start: 0, end: 5 }] }];
    s.assignments = [{ paragraphId: "p", occurrenceId: "o0", meaningId: "m" }];
    s.candidates = [{ id: "c", text: "planet", meaningIds: ["m"], confirmed: true, retained: true }];
    s.tests["9:0"] = { phase: "9", passed: true, rounds: 0,
      signature: stableSignature(buildStudioDraft(s)), batchSignature: entryBatchSignature(s, s.passages, s.assignments),
      choices: [{ paragraphId: "p", occurrenceId: "o0", candidateId: "c", passed: true }],
      translations: [{ paragraphId: "p", source: "mundo", translation: "planet" }] };
    state.glossaryResearchStudio = { study: s, busy: true };
    const html = renderGlossaryResearchStudio(state);
    assert(html.includes("Checking the retained translations before saving"));
    assert(html.includes("Passed · Translation batch 1 · paragraphs 1–1 · initial test · 1 occurrence in 1 paragraph"));
    assert(html.includes("Entry under test · notes and preference"));
    assert(!html.includes("Results will appear here"));
    assert(!html.includes("No source variants collide"));
  } finally { state.glossaryResearchStudio = previous; }
});


test("bibliographical findings group repeated meanings by author with expandable evidence", () => {
  const previous = state.glossaryResearchStudio;
  try {
    const s = newStudioStudy({ term: "sensible", sourceLanguage: { code: "es", name: "Spanish" }, targetLanguage: { code: "en", name: "English" } }, "test");
    s.step = "4.4.1"; s.steps[s.step] = { value: { summary: "Attribution remains uncertain", meanings: [
      { author: "Author A", definition: "Perceptible", evidence: [{ quotation: "Exact quotation", url: "https://example.test/source", reference: { title: "Source book", chapter_title: "Original chapter", year: 1952, line_id: 42 }, usageNote: "Inferred sense; uncertain attribution" }] },
      { author: "Author A", definition: "Responsive" }, { author: "Author B", definition: "Sentient" },
    ] } };
    state.glossaryResearchStudio = { study: s, busy: false };
    const html = renderGlossaryResearchStudio(state);
    assert.equal((html.match(/class="studio-entry studio-author-group"/gu) ?? []).length, 2);
    assert(html.includes("Author A · 2 source meanings")); assert(html.includes("Author B · 1 source meaning"));
    for (const text of ["Source assessment", "Attribution remains uncertain", "Perceptible", "Responsive", "Sentient", "Exact quotation", "Source book", "Original chapter", "1952", "Line 42", "Inferred sense; uncertain attribution"]) assert(html.includes(text));
  } finally { state.glossaryResearchStudio = previous; }
});


test("meaning decisions number enabled definitions and offer report-only senses for human correction", () => {
  const previous = state.glossaryResearchStudio;
  try {
    const s = newStudioStudy({ term: "sensible", sourceLanguage: { code: "es", name: "Spanish" }, targetLanguage: { code: "en", name: "English" } }, "test");
    s.step = "4.6"; s.meanings = [{ id: "a", definition: "Perceptible" }, { id: "b", definition: "Sensory receptivity", unused: true }, { id: "c", definition: "Excluded", enabled: false }];
    s.passages = [{ id: "p", text: "sensible", occurrences: [{ id: "o0", start: 0, end: 8 }] }];
    s.assignments = [{ paragraphId: "p", occurrenceId: "o0", meaningId: "a" }];
    state.glossaryResearchStudio = { study: s, modal: { kind: "meaningReview", paragraphId: "p", occurrenceId: "o0" } };
    let html = renderGlossaryResearchStudio(state);
    assert.match(html, /value="b"\s*>2\. Sensory receptivity/u);
    assert(!html.includes('value="c"'));
    state.glossaryResearchStudio.modal = null;
    s.pendingDecision = { kind: "unmatched", paragraph: s.passages[0], paragraphId: "p", occurrenceId: "o0", recommendation: { definition: "New meaning", translation: "perceptible" } };
    html = renderGlossaryResearchStudio(state);
    assert(html.includes('value="b" >2. Sensory receptivity'));
    assert(html.includes("Choose an existing definition"));
    assert(!html.includes("does not match a listed meaning"));
  } finally { state.glossaryResearchStudio = previous; }
});


test("split review separates unwitnessed suggestions from selectable expressions", () => {
  const previous = state.glossaryResearchStudio;
  try {
    const s = newStudioStudy({ term: "sensible", sourceLanguage: { code: "es", name: "Spanish" }, targetLanguage: { code: "en", name: "English" } }, "test");
    s.step = "4.7"; s.forms = [{ text: "sensible" }]; s.meanings = [{ id: "m", definition: "Sensitive" }];
    s.passages = [{ id: "p", text: "placa muy sensible", occurrences: [{ id: "o0", start: 10, end: 18 }] }];
    s.assignments = [{ paragraphId: "p", occurrenceId: "o0", meaningId: "m" }];
    s.splitProposals = [{ id: "plate", forms: ["placa sensible", "placa muy sensible"], meaningId: "m", targetTerms: ["sensitive plate"] },
      { id: "nerves", forms: ["nervios sensibles"], meaningId: "m", targetTerms: ["sensory nerves"] }];
    s.steps[s.step] = { value: {} }; state.glossaryResearchStudio = { study: s, busy: false };
    const html = renderGlossaryResearchStudio(state);
    assert.equal((html.match(/Create separate entry/gu) ?? []).length, 1);
    assert(html.includes("<h3>placa muy sensible</h3>"));
    assert(html.includes("Unverified suggestions (2)"));
    assert(html.includes("nervios sensibles"));
    assert(!html.includes("<h3>placa sensible, placa muy sensible</h3>"));
  } finally { state.glossaryResearchStudio = previous; }
});

test("legacy compound findings show verified research counts and separate unsupported source suggestions", () => {
  const previous = state.glossaryResearchStudio;
  try {
    const s = newStudioStudy({ term: "sensible", sourceLanguage: { code: "es", name: "Spanish" }, targetLanguage: { code: "en", name: "English" } }, "test");
    s.step = "5"; s.meanings = [{ id: "m", definition: "Responsive" }];
    s.passages = [{ id: "a", text: "sensibles mallas", occurrences: [{ id: "o0", start: 0, end: 9 }] },
      { id: "b", text: "Dos sensibles mallas", occurrences: [{ id: "o0", start: 4, end: 13 }] }];
    s.assignments = s.passages.map((p) => ({ paragraphId: p.id, occurrenceId: "o0", meaningId: "m" }));
    s.steps["5"] = { value: { compounds: [{ phrase: "sensibles mallas", meaningId: "m", paragraphIds: ["wrong-source"], explanation: "Networks" },
      { phrase: "nervios sensibles", meaningId: "m", paragraphIds: ["outside-source"], specialMeaning: true, explanation: "Outside this study" }] } };
    state.glossaryResearchStudio = { study: s, busy: false };
    const html = renderGlossaryResearchStudio(state);
    assert(html.includes("sensibles mallas · 2 paragraphs"));
    assert(html.includes("Unverified suggestions (1)"));
    assert(!html.includes("<summary>nervios sensibles"));
    assert(html.includes("No exact occurrence with this meaning"));
  } finally { state.glossaryResearchStudio = previous; }
});


test("the nested work list shows planned work, active siblings and escaped results after pausing", () => {
  const previous = state.glossaryResearchStudio;
  try {
    const study = newStudioStudy({ sourceLanguage: { code: "es", name: "Spanish" }, targetLanguage: { code: "en", name: "English" }, term: "fatal" }, "progress");
    study.step = "4.4.1";
    study.activitySteps = { "4.4.1": { items: [
      { id: "authors", label: "Verify authors", status: "running", children: [
        { id: "a", label: "Author A", status: "complete", result: "<script>source finding</script> ".repeat(30), children: [] },
        { id: "b", label: "Author B", status: "running", children: [] },
      ] }, { id: "consolidate", label: "Consolidate findings", status: "waiting", children: [] },
    ] } };
    state.glossaryResearchStudio = { study, busy: true, message: "Checking Author B" };
    let html = renderGlossaryResearchStudio(state);
    assert.match(html, /aria-label="Work in this step"/);
    assert.match(html, /data-work-state="complete"/);
    assert.match(html, /data-work-state="running"/);
    assert.match(html, /data-work-state="waiting"/);
    assert.match(html, /&lt;script&gt;source finding/);
    assert(!html.includes("<script>source finding"));
    assert.match(html, /Read result summary/);
    state.glossaryResearchStudio.busy = false; state.glossaryResearchStudio.message = "";
    html = renderGlossaryResearchStudio(state);
    assert.match(html, /data-work-state="paused"/);
    assert.match(html, /Author A/); assert.match(html, /Consolidate findings/);
  } finally { state.glossaryResearchStudio = previous; }
});

test("saved timing diagnostics are not rendered on any research step", () => {
  const previous = state.glossaryResearchStudio;
  try {
    const study = newStudioStudy({ sourceLanguage: { code: "es", name: "Spanish" }, targetLanguage: { code: "en", name: "English" }, term: "fatal" }, "timed");
    study.step = "4.4.1";
    study.timing = { version: 1, steps: {
      "4.1": { runs: [{ sequence: 1, status: "complete", elapsedMs: 1200, operations: [{ label: "<script>dictionary</script>", status: "complete", elapsedMs: 1000, requestMs: 900, cacheSource: "study-cache", path: ["dictionary"] }] }], saves: { count: 1, totalMs: 50 } },
      "4.4.1": { runs: [{ sequence: 1, status: "complete", elapsedMs: 166000, startedAt: "2026-10-16T00:00:00Z", operations: [{ label: "Source synthesis", status: "complete", elapsedMs: 165000, requestMs: 164000, cacheSource: "executed", aiOperationMs: 160000, path: ["consolidate"] }] }], saves: { count: 2, totalMs: 2000 } },
    } };
    state.glossaryResearchStudio = { study, busy: false };
    const timing = JSON.stringify(study.timing);
    for (const step of STUDIO_STEPS) {
      study.step = step.id;
      const html = renderGlossaryResearchStudio(state);
      assert.doesNotMatch(html, /Step timings|Tool time:|Recorded research timings|Request and retry details/);
      assert.doesNotMatch(html, /studio-timings|studio-work-timing|studio-timing-table/);
    }
    assert.equal(JSON.stringify(study.timing), timing);
  } finally { state.glossaryResearchStudio = previous; }
});

test("completed corpus checks summarize attested forms and accurate paragraph counts with the full tree collapsed", () => {
  const previous = state.glossaryResearchStudio;
  try {
    const s = newStudioStudy({ term: "Hierofantes", corpus: "samael", sourceLanguage: { code: "es", name: "Spanish" }, targetLanguage: { code: "vi", name: "Vietnamese" } }, "corpus-summary");
    s.step = "2a";
    s.formDiscovery = { version: 3, phase: "checking-origin", corpusResults: [
      { text: "Hierofantes", paragraphCount: 113 }, { text: "hierofante", paragraphCount: 177 }, { text: "unattested", paragraphCount: 0 },
    ] };
    s.forms = [{ text: "Hierofantes", paragraphCount: 113 }];
    s.activitySteps = { "2a": { items: [{ id: "forms", label: "Check forms against the corpus", status: "complete",
      result: "Three proposed forms checked.", children: [{ id: "raw", label: "Raw exact check", status: "complete", result: "8 candidates." }] }] } };
    state.glossaryResearchStudio = { study: s, busy: true };
    let html = renderGlossaryResearchStudio(state);
    assert.match(html, /We found 2 forms used in the Samael Aun Weor corpus:/);
    assert.match(html, /<li>Hierofantes — 113 matching paragraphs/);
    assert.match(html, /<li>hierofante — 177 matching paragraphs/);
    assert(!html.includes("unattested"));
    assert.match(html, /<details data-studio-disclosure="forms-corpus-details"><summary>Check details<\/summary>/);
    delete s.formDiscovery.corpusResults; s.scope.corpus = "projects";
    s.forms = [{ text: "walk", paragraphCount: 1 }, { text: "absent", paragraphCount: 0 }];
    html = renderGlossaryResearchStudio(state);
    assert.match(html, /We found 1 form used in the selected projects:/);
    assert.match(html, /<li>walk — 1 matching paragraph<\/li>/);
    s.forms = [{ text: "absent", paragraphCount: 0 }];
    html = renderGlossaryResearchStudio(state);
    assert.match(html, /We found 0 forms used in the selected projects\./);
    assert(!html.includes('aria-label="Forms found in the corpus"'));
    s.forms = [{ text: "unknown" }];
    html = renderGlossaryResearchStudio(state);
    assert(!html.includes("We found 0 forms"), "missing historical counts do not establish absence");
  } finally { state.glossaryResearchStudio = previous; }
});

test("forms setup, active work, pause and review show the controls relevant to each phase", () => {
  const previous = state.glossaryResearchStudio;
  try {
    const s = newStudioStudy({ term: "walk", sourceLanguage: { code: "en", name: "English" }, targetLanguage: { code: "vi", name: "Vietnamese" } }, "forms-phases");
    s.step = "2a"; s.forms = [{ text: "walk", selected: true }];
    s.activitySteps = { "2a": { items: [{ id: "discover", label: "Find forms", status: "waiting" }] } };
    const view = state.glossaryResearchStudio = { study: s, busy: false };
    let html = renderGlossaryResearchStudio(state);
    assert.match(html, /aria-label="Entered forms"/);
    assert.doesNotMatch(html, /type="checkbox"|data-studio-field="forms\./);
    assert.doesNotMatch(html, /aria-label="Work in this step"/);
    view.busy = true; view.recommendingStep = "2a";
    html = renderGlossaryResearchStudio(state);
    assert.match(html, /aria-label="Entered forms"/);
    assert.doesNotMatch(html, /type="checkbox"|data-studio-field="forms\./);
    assert.doesNotMatch(html, /aria-label="Work in this step"/);
    view.recommendingStep = null;
    html = renderGlossaryResearchStudio(state);
    assert.doesNotMatch(html, /aria-label="Discovered forms"/);
    assert.match(html, /aria-label="Work in this step"/);
    s.formDiscovery = { version: 3, phase: "checking" }; view.busy = false;
    html = renderGlossaryResearchStudio(state);
    assert.doesNotMatch(html, /aria-label="Discovered forms"/);
    assert.match(html, /aria-label="Work in this step"/);
    view.error = "Provider unavailable";
    html = renderGlossaryResearchStudio(state);
    assert.doesNotMatch(html, /aria-label="Discovered forms"/);
    assert.match(html, /Provider unavailable/);
    view.error = ""; s.formDiscovery.phase = "complete";
    s.forms[0].reason = "A verified form (/doc/book-34?line=21924). Dictionary: https://dle.rae.es/hierofante.";
    s.steps["2a"] = { value: { forms: s.forms } };
    html = renderGlossaryResearchStudio(state);
    assert.match(html, /aria-label="Discovered forms"/);
    assert.match(html, /data-action="studio:add-form"/);
    assert(html.indexOf('data-studio-forms-review') > html.indexOf('aria-label="Work in this step"'));
    assert.match(html, /A verified form\. Dictionary: https:\/\/dle.rae.es\/hierofante\./u);
    assert.doesNotMatch(html, /\/doc\/book-34|line=21924/u);
    assert(s.forms[0].reason.includes("/doc/book-34?line=21924"), "saved explanation keeps the audit locator");
  } finally { state.glossaryResearchStudio = previous; }
});

test("step6 keeps translation choices outside default-collapsed editors and entry-wide notes", () => {
  const previous = state.glossaryResearchStudio;
  try {
    const study = newStudioStudy({ sourceLanguage: { code: "es", name: "Spanish" }, targetLanguage: { code: "en", name: "English" }, term: "mundo" }, "compact");
    study.step = "6"; study.meanings = [{ id: "planet", definition: "Physical planet" }];
    study.candidates = [{ id: "c1", text: "<planet>", meaningIds: ["planet"], note: "A detailed selection rule." }];
    study.generalNote = "A lengthy provenance report."; study.steps["6"] = { value: {} };
    state.glossaryResearchStudio = { study, busy: false };
    const html = renderGlossaryResearchStudio(state);
    const choices = html.slice(html.indexOf('<ul class="studio-candidate-choices"'), html.indexOf('<details class="studio-meaning-editor"'));
    assert.match(choices, /type="checkbox"/);
    assert.match(choices, /&lt;planet&gt;/);
    assert(!choices.includes("textarea"));
    assert.match(html, /data-studio-disclosure="candidate-meaning:planet"/);
    assert.match(html, /data-studio-disclosure="candidate-entry-settings"/);
    assert(!html.includes('class="studio-meaning-editor" open'));
    assert(!html.includes('class="studio-entry studio-entry-settings" open'));
    assert.match(html, /A detailed selection rule/);
    assert.match(html, /A lengthy provenance report/);
  } finally { state.glossaryResearchStudio = previous; }
});

test("step9 does not mark an otherwise identical trial stale solely because the assignment audit counter changed", () => {
  const previous = state.glossaryResearchStudio;
  try {
    const study = newStudioStudy({ sourceLanguage: { code: "es", name: "Spanish" }, targetLanguage: { code: "en", name: "English" }, term: "mundo" }, "counter");
    study.step = "9"; study.forms = [{ text: "mundo" }];
    study.meanings = [{ id: "m", definition: "World" }];
    study.candidates = [{ id: "c", text: "world", confirmed: true, meaningIds: ["m"] }];
    study.passages = [{ id: "p", text: "mundo", occurrences: [{ id: "o", start: 0, end: 5 }] }];
    study.assignments = [{ paragraphId: "p", occurrenceId: "o", meaningId: "m" }];
    study.tests["9:0"] = { phase: "9", passed: true, signature: stableSignature(buildStudioDraft(study)), batchSignature: entryBatchSignature(study, study.passages, study.assignments),
      assignmentRevision: 1, choices: [{ paragraphId: "p", occurrenceId: "o", candidateId: "c", passed: true }], translations: [{ paragraphId: "p", translation: "world" }] };
    study.assignmentRevision = 2; state.glossaryResearchStudio = { study, busy: false };
    const html = renderGlossaryResearchStudio(state);
    assert.match(html, /Passed · Translation batch 1/);
    assert(!html.includes("This batch has changed glossary guidance"));
    study.candidates[0].note = "New shared condition";
    assert.match(renderGlossaryResearchStudio(state), /Recheck pending · Translation batch 1/);
  } finally { state.glossaryResearchStudio = previous; }
});

test("dictionary details stay structured and visible without inflating the definition", async () => {
  const previous = state.glossaryResearchStudio;
  try {
    const { STUDIO_DICTIONARY_REVIEW_VERSION } = await import("../app/glossary-research-studio-workflow.js");
    const s = newStudioStudy({ term: "tenebroso", sourceLanguage: { code: "es", name: "Spanish" }, targetLanguage: { code: "en", name: "English" } }, "dictionary-metadata");
    s.step = "4.1"; s.steps["4.1"] = { value: { dictionaryVersion: STUDIO_DICTIONARY_REVIEW_VERSION,
      meanings: [{ definition: "Dark; covered in darkness.", sourceSense: "1", grammar: "adjective", synonyms: ["sombrío", "<oscuro>"], antonyms: ["luminoso"], evidence: [{ quotation: "Oscuro, cubierto de tinieblas." }] }] } };
    state.glossaryResearchStudio = { study: s, history: [] };
    const html = renderGlossaryResearchStudio(state);
    assert(html.includes("Dictionary sense 1 · adjective"));
    assert(html.includes("<p>Dark; covered in darkness.</p>"));
    assert(html.includes("Synonyms:</strong> sombrío, &lt;oscuro&gt;"));
    assert(html.includes("Antonyms:</strong> luminoso"));
    assert(!html.includes("<oscuro>"));
  } finally { state.glossaryResearchStudio = previous; }
});

test("report-only note explanations are collapsed, escaped and kept out of editable usage notes", () => {
  const previous = state.glossaryResearchStudio;
  try {
    const s = newStudioStudy({ term: "ilustre", sourceLanguage: { code: "es", name: "Spanish" }, targetLanguage: { code: "en", name: "English" } }, "note-report");
    s.step = "6"; s.meanings = [{ id: "m", definition: "Distinction" }];
    s.candidates = [{ id: "c", text: "distinguished", meaningIds: ["m"], note: "For distinction or respectful address." }];
    const report = { summary: "Verified provenance and detailed reasoning.", candidates: [{ text: "distinguished",
      explanation: "<script>Source explanation</script>", longNoteReason: "Prevents an invented hereditary title." }] };
    s.steps["6"] = { value: { research: report } };
    state.glossaryResearchStudio = { study: s, history: [] };
    let html = renderGlossaryResearchStudio(state);
    assert.match(html, /<details class="studio-entry" data-studio-disclosure="candidate-note-research"><summary>Research report/);
    assert(html.includes("&lt;script&gt;Source explanation&lt;/script&gt;"));
    assert(!html.includes("<script>Source explanation</script>"));
    assert.match(html, /Why this note needs extra detail/);
    assert(!html.match(/<textarea[^>]*>[^<]*Source explanation/));
    s.step = "8"; s.reports["usage-notes:8:m:1"] = { kind: "usage-notes", step: "8", ...report };
    html = renderGlossaryResearchStudio(state);
    assert(html.includes('data-studio-disclosure="usage-note-repairs:8"'));
    assert(html.includes("Verified provenance and detailed reasoning."));
  } finally { state.glossaryResearchStudio = previous; }
});
