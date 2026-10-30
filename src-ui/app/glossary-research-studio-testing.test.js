import test from "node:test";
import assert from "node:assert/strict";
import { testMeanings, testCompleteEntry, assessTrial, translateTrial, trialGlossary } from "./glossary-research-studio-testing.js";
import { newStudioStudy, deduplicatePassages, finalUsage, reviseAssignment, buildStudioDraft, stableSignature, meaningTrialsAreCurrent, entryTrialsAreCurrent } from "./glossary-research-studio-workflow.js";
function fixture(size = 1) {
  const s = newStudioStudy({ term: "caminar", sourceLanguage: { code: "es", name: "Spanish" },
    targetLanguage: { code: "en", name: "English" } }, "test");
  s.forms = [{ text: "caminar" }]; s.model = {}; s.focusedSampleLimits = { m: Number.MAX_SAFE_INTEGER };
  s.meanings = [{ id: "m", definition: "move by foot" }];
  s.passages = deduplicatePassages(Array.from({ length: size }, (_, i) => ({ id: `p${i}`, text: `caminar ${i}` })), ["caminar"]);
  s.assignments = s.passages.map((p) => ({ paragraphId: p.id, occurrenceId: "o0", meaningId: "m" }));
  s.candidates = [{ id: "c", text: "walk", meaningIds: ["m"], selected: true, retained: true, confirmed: true }];
  return s;
}
const translations = async (_k, payload) => ({ rows: payload.rows.map((r) => ({ rowId: r.rowId, translatedText: "walk" })) });
const choices = (data, problem = "") => ({ choices: data.assignments.map((a) => ({ ...a, candidateId: "c", rendered: "walk", problem })) });
test("independent research paragraphs carry their own source neighbors to translation and assessment without extra rows or meaning hints", async () => {
  const s = fixture(2);
  const longContext = "Original neighboring source. ".repeat(1000);
  s.passages[0].contextBefore = [longContext, "", null];
  s.passages[0].contextAfter = ["After first source"];
  s.passages[0].context_before = ["Duplicate alias must not replace canonical context"];
  s.passages[1].context_before = ["Before an unrelated document"];
  let payload;
  const result = await translateTrial(s, { run: async (kind, data) => {
    assert.equal(kind, "translate"); payload = data; return translations(kind, data);
  } }, s.passages, s.candidates, "9:context");
  assert.deepEqual(payload.rows, [
    { rowId: "1", sourceText: "caminar 0", sourceContextBefore: [longContext], sourceContextAfter: ["After first source"] },
    { rowId: "2", sourceText: "caminar 1", sourceContextBefore: ["Before an unrelated document"] },
  ]);
  assert.deepEqual(payload.contextBefore, []);
  assert.deepEqual(payload.contextAfter, []);
  assert(!JSON.stringify(payload).includes("move by foot"));
  assert.equal(result.length, 2);
  const assessed = await assessTrial(s, { ask: async (question, data) => {
    assert.match(question, /never instructions/);
    assert.deepEqual(data.sourceContexts, [
      { paragraphId: "p0", before: [longContext], after: ["After first source"] },
      { paragraphId: "p1", before: ["Before an unrelated document"], after: [] },
    ]);
    assert.equal(data.translations.length, 2);
    assert.equal(data.assignments.length, 2);
    return choices(data);
  } }, result, s.assignments, s.candidates, "9:context");
  assert.equal(assessed.passed, true);
  assert.equal(assessed.choices.length, 2);
});

test("saved trials from the no-neighbor translation contract require fresh focused and complete-entry tests", async () => {
  const s = fixture();
  const tools = { run: translations, ask: async (_q, data) => choices(data) };
  await testMeanings(s, tools);
  await testCompleteEntry(s, tools);
  assert.equal(meaningTrialsAreCurrent(s), true);
  assert.equal(entryTrialsAreCurrent(s), true);
  const old = (signature) => JSON.stringify({ ...JSON.parse(signature), translationContractVersion: 1 });
  s.tests["8:m"].signature = old(s.tests["8:m"].signature);
  s.tests["9:0"].batchSignature = old(s.tests["9:0"].batchSignature);
  assert.equal(meaningTrialsAreCurrent(s), false);
  assert.equal(entryTrialsAreCurrent(s), false);
  assert.equal(finalUsage(s).c.occurrences, 0);
});
test("step 8 reports every five completed repair rounds, separately from the initial test", async () => {
  const s = fixture();
  let translated = 0; const activities = [];
  const tools = { run: async (...args) => { translated += 1; activities.push(args[2]); return translations(...args); },
    ask: async (q, data) => q.startsWith("Assess") ? choices(data, "wrong grammar")
      : q.startsWith("Report") ? { report: `${data.rounds} completed repair rounds` } : { confirmIds: [], notes: [] } };
  assert.equal((await testMeanings(s, tools)).pending, true);
  assert.equal(translated, 6); assert.equal(s.testHistory.length, 6);
  assert.equal(s.rounds["8:m"], 5); assert.equal(s.pendingDecision.kind, "progress");
  assert.equal(s.pendingDecision.rounds, 5);
  assert.equal(s.pendingDecision.reportKey, "m:5");
  assert.equal(s.pendingDecision.report, "5 completed repair rounds");
  assert.match(activities[0], /initial test/);
  assert.match(activities[1], /repair round 1/);
  assert.match(activities[5], /repair round 5/);
  s.reports[s.pendingDecision.reportKey].continued = true; s.pendingDecision = null;
  assert.equal((await testMeanings(s, tools)).pending, true);
  assert.equal(translated, 11); assert.equal(s.testHistory.length, 11);
  assert.equal(s.rounds["8:m"], 10); assert.equal(s.pendingDecision.rounds, 10);
});
test("three proposed inflections form one addition and remain pending human approval", async () => {
  const s = fixture();
  const result = await testMeanings(s, { run: translations,
    ask: async (q, data) => q.startsWith("Assess") ? choices(data, "needs inflections")
      : { newForms: ["walked", "walking", "walks"].map((text) => ({ text, note: "inflection" })) } });
  assert.equal(result.pending, true); assert.equal(s.rounds["8:m"], 1);
  assert.equal(s.pendingDecision.kind, "candidate");
  assert.equal(new Set(s.pendingDecision.forms.map((c) => c.groupId)).size, 1);
  assert.equal(s.pendingDecision.forms.length, 3);
  assert(s.pendingDecision.forms.every((c) => c.temporary));
});
test("step 9 withholds expected meanings and pauses after three unsuccessful repairs", async () => {
  const s = fixture(); const payloads = [];
  const result = await testCompleteEntry(s, { run: async (k, p) => { payloads.push(p); return translations(k, p); },
    ask: async (q, data) => q.startsWith("Assess") ? choices(data, "wrong meaning") : { order: ["c"], notes: [] } });
  assert.equal(result.pending, true); assert.equal(s.rounds["9:0"], 3);
  assert.equal(s.pendingDecision.kind, "selection");
  assert(payloads.every((p) => !JSON.stringify(p).includes("move by foot")));
  assert.equal(s.testHistory.length, 4);
});
test("a shared-note repair starts another stable pass after findings are collected", async () => {
  const s = fixture(16); let lastFailed = false; const batches = [];
  await testCompleteEntry(s, { run: async (k, p) => { batches.push(p.rows.length); return translations(k, p); },
    ask: async (q, data) => {
      if (q.startsWith("Assess")) {
        const fail = data.assignments[0].paragraphId === "p15" && !lastFailed;
        if (fail) lastFailed = true;
        return choices(data, fail ? "selection needs note" : "");
      }
      return { order: ["c"], notes: [{ candidateId: "c", note: "Use for movement on foot." }] };
    } });
  assert.deepEqual(batches.slice(0, 2).sort((a, b) => a - b), [1, 15]);
  assert.deepEqual(batches.slice(2).sort((a, b) => a - b), [1, 15]);
  assert.equal(entryTrialsAreCurrent(s), true);
  assert.deepEqual(finalUsage(s), { c: { occurrences: 16, paragraphs: 16 } });
});
test("resuming after externally edited guidance validates batches in stable source order", async () => {
  const s = fixture(16);
  await assert.rejects(testCompleteEntry(s, { run: translations, ask: async (q, data) => {
    if (q.startsWith("Assess")) return choices(data, data.assignments[0].paragraphId === "p15" ? "selection" : "");
    throw new Error("paused at repair checkpoint");
  } }), /paused at repair checkpoint/);
  s.candidates[0].note = "Revised selection guidance.";
  s.rounds["9:15"] = 1;
  const batches = [];
  await testCompleteEntry(s, { run: async (k, p) => { batches.push(p.rows.length); return translations(k, p); },
    ask: async (_question, data) => choices(data) });
  assert.deepEqual([...batches].sort((a, b) => a - b), [1, 15]);
  assert.equal(entryTrialsAreCurrent(s), true);
  assert.deepEqual(finalUsage(s), { c: { occurrences: 16, paragraphs: 16 } });
});
test("one target span cannot count as two independently translated source occurrences", async () => {
  const s = fixture();
  s.passages = deduplicatePassages([{ id: "p0", text: "caminar y caminar" }], ["caminar"]);
  const assignments = [s.assignments[0], { ...s.assignments[0], occurrenceId: "o1" }];
  const result = await assessTrial(s, { ask: async (_question, data) => {
    assert.deepEqual(data.assignments.map((a) => [a.sourceStart, a.sourceEnd, a.sourceText]), [[0, 7, "caminar"], [10, 17, "caminar"]]);
    return choices(data);
  } },
    [{ paragraphId: "p0", translation: "walk" }], assignments, s.candidates, "test");
  assert.equal(result.passed, false);
  assert.equal(result.choices.filter((c) => c.passed).length, 1);
});

test("Vietnamese lexical phrase spans allow surrounding quantifiers and choose the longest confirmed form", async () => {
  const s = fixture(); s.scope.targetLanguage = { code: "vi", name: "Vietnamese" };
  s.forms = [{ text: "vanidades del mundo" }, { text: "vanidades de este mundo" }];
  s.passages = deduplicatePassages([{ id: "p0", text: "vanidades del mundo y vanidades de este mundo" }], s.forms.map((f) => f.text), "es");
  s.assignments = s.passages[0].occurrences.map((o) => ({ paragraphId: "p0", occurrenceId: o.id, meaningId: "m" }));
  const candidates = [
    { id: "plain", text: "điều phù hoa của thế gian", meaningIds: ["m"] },
    { id: "this", text: "điều phù hoa của thế gian này", meaningIds: ["m"] },
  ];
  const translation = "Mọi điều phù hoa của thế gian và tất cả những điều phù hoa của thế gian này.";
  const tools = { ask: async (_question, data) => ({ choices: data.assignments.map((a, i) => ({ ...a,
    candidateId: candidates[i].id, rendered: candidates[i].text, problem: "" })) }) };
  const assessed = await assessTrial(s, tools, [{ paragraphId: "p0", source: s.passages[0].text, translation }], s.assignments, candidates, "9:0");
  assert.equal(assessed.passed, true);
  assert.equal(assessed.choices.length, 2);
  assert(assessed.choices[0].targetEnd < assessed.choices[1].targetStart);
  for (const [i, choice] of assessed.choices.entries()) assert.equal(translation.slice(choice.targetStart, choice.targetEnd), candidates[i].text);
  const prefixed = candidates.map((c) => ({ ...c, text: `những ${c.text}` }));
  const strictTools = { ask: async (_question, data) => ({ choices: data.assignments.map((a, i) => ({ ...a,
    candidateId: prefixed[i].id, rendered: i ? prefixed[i].text : `Mọi ${candidates[i].text}`, problem: "" })) }) };
  const strict = await assessTrial(s, strictTools, [{ paragraphId: "p0", source: s.passages[0].text, translation }], s.assignments, prefixed, "9:0");
  assert.equal(strict.passed, false, "a detached quantifier must not silently replace words inside the confirmed form");
  assert.equal(strict.choices[0].passed, false);
  assert.equal(strict.choices[1].passed, true);
});

test("human selection defaults reach assessment and repair in both phases and invalidate focused trials", async () => {
  const s = fixture(); s.generalNote = "Prefer planet whenever plausible.";
  let fail = true; let translated = 0; const questions = [];
  const tools = { run: async (k, payload) => { translated++; return translations(k, payload); },
    ask: async (q, data) => {
      questions.push(q); assert.equal(data.generalNote, s.generalNote);
      if (q.startsWith("Assess")) { const result = choices(data, fail ? "Violates the human default" : ""); fail = false; return result; }
      return q.startsWith("Repair selection") ? { order: ["c"], notes: [] } : { confirmIds: [], notes: [] };
    } };
  await testMeanings(s, tools);
  assert(questions.some((q) => q.startsWith("Repair failed") && q.includes("do not weaken")));
  const before = translated;
  s.generalNote = "Updated human guidance.";
  await testMeanings(s, tools);
  assert.equal(translated, before + 1);
  fail = true;
  await testCompleteEntry(s, tools);
  assert(questions.some((q) => q.startsWith("Repair selection") && q.includes("do not weaken")));
});

test("focused retries receive paragraph feedback while complete-entry tests keep production hints", async () => {
  const s = fixture(); const payloads = []; let first = true;
  const tools = { run: async (k, p) => { payloads.push(p); return translations(k, p); }, ask: async (q, data) => {
    if (q.startsWith("Assess")) {
      assert(q.includes(data.attempt.startsWith("9:") ? "Unrelated wording elsewhere" : "whole paragraph"));
      const problem = first ? "Repair the sentence fragment around the occurrence." : "";
      first = false; return choices(data, problem);
    }
    return { confirmIds: [], notes: [] };
  } };
  await testMeanings(s, tools);
  assert(!JSON.stringify(payloads[0]).includes("Repair the sentence fragment"));
  assert(JSON.stringify(payloads[1]).includes("Repair the sentence fragment"));
  await testCompleteEntry(s, tools);
  assert(!JSON.stringify(payloads.at(-1)).includes("Repair the sentence fragment"));
  assert(!JSON.stringify(payloads.at(-1)).includes("move by foot"));
});


test("focused guidance identifies the exact occurrence in numbered translation rows", async () => {
  const s = fixture(); s.generalNote = "Use world for fixed birth idioms; otherwise prefer planet.";
  s.passages = deduplicatePassages([{ id: "p0", text: "caminar y caminar" }], ["caminar"]);
  let payload;
  await translateTrial(s, { run: async (kind, value) => { payload = value; return translations(kind, value); } },
    s.passages, s.candidates, "8:m:0", [{ paragraphId: "p0", occurrenceId: "o1", meaningId: "m", preserveSourceSpelling: true }]);
  const note = payload.glossaryHints.flatMap((hint) => hint.globalNotes).find((value) => value.includes("exact source occurrences"));
  assert(note.includes('"rowId":"1"'));
  assert(note.includes('"sourceStart":10'));
  assert(note.includes('"sourceEnd":17'));
  assert(note.includes('"sourceText":"caminar"'));
  assert(note.includes('"definition":"move by foot"'));
  assert(note.includes('"preserveSourceSpelling":true'));
  assert(note.includes("The restricted candidate list applies only to these listed occurrences"));
  assert(note.includes("Other occurrences of the same source form"));
  assert(!note.includes('"paragraphId"'));
  assert(note.includes("explicit usage exceptions take precedence"));
  assert(JSON.stringify(payload.glossaryHints).includes(s.generalNote));
  await translateTrial(s, { run: async (kind, value) => { payload = value; return translations(kind, value); } },
    s.passages, s.candidates, "9:0");
  assert(!JSON.stringify(payload).includes("restricted candidate list"));
  assert(!JSON.stringify(payload).includes("move by foot"));
});


test("meaning corrections invalidate passing assessments even when the saved entry text is unchanged", async () => {
  const s = fixture(); s.meanings.push({ id: "other", definition: "Another valid meaning" });
  s.candidates[0].meaningIds.push("other"); let translated = 0;
  const tools = { run: async (kind, payload) => { translated++; return translations(kind, payload); },
    ask: async (_question, data) => choices(data) };
  await testCompleteEntry(s, tools);
  const draft = buildStudioDraft(s);
  assert.equal(finalUsage(s).c.occurrences, 1);
  await reviseAssignment(s, "p0", "o0", "other");
  assert.deepEqual(buildStudioDraft(s), draft);
  assert.equal(finalUsage(s).c.occurrences, 0);
  await testCompleteEntry(s, tools);
  assert.equal(translated, 2); assert.equal(finalUsage(s).c.occurrences, 1);
  assert.equal(s.tests["9:0"].assignmentRevision, 1);
});

test("adding a recovered example invalidates a passing batch even when its glossary entry is unchanged", async () => {
  const s = fixture(); const batches = [];
  const tools = { run: async (kind, payload) => { batches.push(payload.rows.length); return translations(kind, payload); },
    ask: async (_question, data) => choices(data) };
  await testCompleteEntry(s, tools);
  const draft = buildStudioDraft(s);
  s.passages.push(...deduplicatePassages([{ id: "p1", text: "caminar de nuevo", recovered: true }], ["caminar"]));
  s.assignments.push({ paragraphId: "p1", occurrenceId: "o0", meaningId: "m" });
  assert.deepEqual(buildStudioDraft(s), draft);
  assert.equal(finalUsage(s).c.occurrences, 0);
  const result = await testCompleteEntry(s, tools);
  assert.deepEqual(batches, [1, 2]);
  assert.equal(result.occurrences, 2); assert.equal(s.tests["9:0"].choices.length, 2);
  assert.equal(finalUsage(s).c.occurrences, 2);
});

test("editing a meaning definition invalidates focused trials without changing candidate notes", async () => {
  const s = fixture(); let translated = 0;
  const tools = { run: async (kind, payload) => { translated++; return translations(kind, payload); },
    ask: async (_question, data) => choices(data) };
  await testMeanings(s, tools);
  s.meanings[0].definition = "Move leisurely on foot";
  await testMeanings(s, tools);
  assert.equal(translated, 2);
});


test("trial glossary hints exactly match the saved entry's combined variant notes and footnotes", async () => {
  const { buildEditorGlossaryModel, buildEditorAiTranslationGlossaryHints } = await import("./editor-glossary-highlighting.js");
  const s = fixture(); s.generalNote = "Shared guidance"; s.footnote = "Verified source citation";
  s.candidates[0].note = "First condition";
  s.candidates.push({ ...s.candidates[0], id: "duplicate", note: "Second condition" });
  const saved = buildEditorGlossaryModel({ ...s.scope, terms: [{ termId: "original", ...buildStudioDraft(s) }] });
  const trial = trialGlossary(s, s.candidates);
  const hints = (model) => buildEditorAiTranslationGlossaryHints(s.passages[0].text, "es", "en", model);
  assert.deepEqual(hints(trial), hints(saved));
  assert(JSON.stringify(hints(trial)).includes("Verified source citation"));
  assert(JSON.stringify(hints(trial)).includes("First condition; Second condition"));
});

test("a translator upgrade rechecks complete-entry results and changes translation cache inputs", async () => {
  const s = fixture(); s.translationRuntimeVersion = "0.8.116"; const payloads = [];
  const tools = { run: async (kind, payload) => { payloads.push(payload); return translations(kind, payload); },
    ask: async (_question, data) => choices(data) };
  await testCompleteEntry(s, tools);
  const draft = buildStudioDraft(s);
  assert.equal(finalUsage(s).c.occurrences, 1);
  s.translationRuntimeVersion = "0.8.125";
  assert.deepEqual(buildStudioDraft(s), draft);
  assert.equal(finalUsage(s).c.occurrences, 0);
  await testCompleteEntry(s, tools);
  assert.equal(payloads.length, 2);
  assert.equal(payloads[0].researchRuntimeVersion, "0.8.116");
  assert.equal(payloads[1].researchRuntimeVersion, "0.8.125");
  assert.equal(payloads[1].researchContractVersion, 3);
  assert.equal(finalUsage(s).c.occurrences, 1);
});

test("focused assessment batches full paragraphs and repairs only complete failed contexts without internal signatures", async () => {
  const s = fixture(16); let first = true; let repair;
  s.passages[0].text += " complete original context".repeat(1000);
  await testMeanings(s, { run: translations, ask: async (question, data) => {
    if (question.startsWith("Assess")) {
      assert(data.translations.length <= 15);
      return { choices: choices(data).choices.map((choice) => ({ ...choice,
        problem: first && choice.paragraphId === "p0" ? "Fix number agreement" : "" })) };
    }
    repair = data; first = false; return { confirmIds: [], notes: [] };
  } });
  assert.equal(repair.trial.signature, undefined);
  assert.deepEqual(repair.trial.translations.map((p) => p.paragraphId), ["p0"]);
  assert.equal(repair.trial.translations[0].source, s.passages[0].text);
  assert.deepEqual(repair.trial.summary, { occurrences: 16, paragraphs: 16, passed: 15, failed: 1 });
  assert.equal(s.testHistory[0].translations.length, 16);
});

test("only a human-approved source-spelling mention can pass without a target candidate and it is not target usage", async () => {
  const s = fixture();
  s.passages = deduplicatePassages([{ id: "p0", text: "caminar, escrito caminar" }], ["caminar"]);
  s.assignments.push({ ...s.assignments[0], occurrenceId: "o1" });
  s.steps["4.6"] = { approved: structuredClone({ meanings: s.meanings, assignments: s.assignments }) };
  const tools = { run: async (_kind, payload) => {
    assert(!JSON.stringify(payload).includes("preserveSourceSpelling"), "complete-entry translators receive only production hints");
    return { rows: payload.rows.map((r) => ({ rowId: r.rowId, translatedText: "walk, spelled caminar" })) };
  },
    ask: async (_question, data) => ({ choices: data.assignments.map((a) => ({ ...a, candidateId: a.occurrenceId === "o0" ? "c" : null,
      rendered: a.occurrenceId === "o0" ? "walk" : "caminar", preservedSourceSpelling: true, problem: "" })) }) };
  const unapproved = await assessTrial(s, tools, [{ paragraphId: "p0", translation: "walk, spelled caminar" }], s.assignments, s.candidates, "9:0");
  assert.equal(unapproved.passed, false);
  assert.equal(unapproved.choices[1].preservedSourceSpelling, false);
  await reviseAssignment(s, "p0", "o1", "m", true);
  assert.equal(s.steps["4.6"].approved.assignments[1].preserveSourceSpelling, true);
  await testCompleteEntry(s, tools);
  assert.equal(s.tests["9:0"].passed, true);
  assert.deepEqual(finalUsage(s).c, { occurrences: 1, paragraphs: 1 });
  await reviseAssignment(s, "p0", "o1", "m", false);
  assert.equal(finalUsage(s).c.occurrences, 0);
});

test("a retained source spelling requires an exact distinct span and cannot excuse a mistranslation", async () => {
  const s = fixture(); s.assignments[0].preserveSourceSpelling = true;
  const check = (translation, rendered = "caminar", problem = "") => assessTrial(s,
    { ask: async (_q, data) => ({ choices: data.assignments.map((a) => ({ ...a, candidateId: null, rendered, problem })) }) },
    [{ paragraphId: "p0", translation }], s.assignments, s.candidates, "9:0");
  assert.equal((await check("walk")).passed, false);
  assert.equal((await check("CAMINAR")).passed, false);
  assert.equal((await check("caminar", "caminar", "Wrong explanation of the spelling")).passed, false);
  assert.equal((await check("caminar")).passed, true);
  s.assignments.push({ ...s.assignments[0], occurrenceId: "o1" });
  s.passages = deduplicatePassages([{ id: "p0", text: "caminar caminar" }], ["caminar"]);
  const duplicate = await check("caminar");
  assert.equal(duplicate.passed, false);
  assert.equal(duplicate.choices.filter((c) => c.passed).length, 1);
});

test("focused retries retain fully passing paragraphs only while all research inputs stay unchanged", async () => {
  const s = fixture(16); const batches = []; const activities = []; let fail = true;
  const tools = { run: async (kind, payload) => { batches.push(payload.rows.length); return translations(kind, payload); },
    ask: async (q, data, _shape, activity) => {
      if (q.startsWith("Assess")) {
        activities.push(activity);
        assert(q.includes("Do not reconstruct missing source context"));
        return { choices: choices(data).choices.map((choice) => ({ ...choice,
          problem: fail && choice.paragraphId === "p0" ? "Fix this paragraph's agreement" : "" })) };
      }
      fail = false; return { confirmIds: [], notes: [] };
    } };
  await testMeanings(s, tools);
  assert.deepEqual(batches, [15, 1, 1]);
  assert(activities[0].includes("paragraphs 1–15 of 16"));
  assert(activities[1].includes("paragraphs 16–16 of 16"));
  assert.equal(s.tests["8:m"].translations.length, 16);
  assert.equal(s.tests["8:m"].choices.length, 16);
  assert.equal(s.tests["8:m"].retainedPassingParagraphs, 15);
  assert.equal(s.testHistory[0].passed, false);
  s.candidates[0].note = "Changed selection condition";
  await testMeanings(s, tools);
  assert.deepEqual(batches.slice(-2).sort((a, b) => a - b), [1, 15]);
  assert.equal(s.tests["8:m"].retainedPassingParagraphs, 0);
  s.translationRuntimeVersion = "0.8.125";
  await testMeanings(s, tools);
  assert.deepEqual(batches.slice(-2).sort((a, b) => a - b), [1, 15]);
});

test("nested Vietnamese target forms use the shared longest-match policy and cannot count one phrase twice", async () => {
  const s = fixture(); s.scope.targetLanguage = { code: "vi", name: "Vietnamese" };
  s.passages = deduplicatePassages([{ id: "p0", text: "caminar y caminar" }], ["caminar"]);
  s.assignments.push({ ...s.assignments[0], occurrenceId: "o1" });
  s.candidates = [{ id: "short", text: "cõi", meaningIds: ["m"], confirmed: true },
    { id: "long", text: "cõi giới", meaningIds: ["m"], confirmed: true }];
  const tools = { ask: async (_q, data) => ({ choices: data.assignments.map((a, i) => ({ ...a,
    candidateId: i ? "long" : "short", rendered: i ? "cõi giới" : "cõi", problem: "" })) }) };
  const check = (translation) => assessTrial(s, tools, [{ paragraphId: "p0", translation }], s.assignments, s.candidates, "9:0");
  const one = await check("cõi giới");
  assert.equal(one.passed, false);
  assert.equal(one.choices[0].passed, false);
  assert.equal(one.choices[1].passed, true);
  assert.equal((await check("cõi giới và cõi")).passed, true);
});

test("a retained source mention cannot overlap a translated target phrase", async () => {
  const s = fixture(); s.forms = [{ text: "Hasnamuss" }];
  s.passages = deduplicatePassages([{ id: "p0", text: "Hasnamuss Hasnamuss" }], ["Hasnamuss"]);
  s.assignments = [{ paragraphId: "p0", occurrenceId: "o0", meaningId: "m", preserveSourceSpelling: true },
    { paragraphId: "p0", occurrenceId: "o1", meaningId: "m" }];
  s.candidates[0].text = "Hasnamuss element";
  const result = await assessTrial(s, { ask: async (_q, data) => ({ choices: data.assignments.map((a, i) => ({ ...a,
    candidateId: i ? "c" : null, rendered: i ? "Hasnamuss element" : "Hasnamuss", problem: "" })) }) },
  [{ paragraphId: "p0", translation: "Hasnamuss element" }], s.assignments, s.candidates, "9:0");
  assert.equal(result.passed, false);
  assert.equal(result.choices.filter((choice) => choice.passed).length, 1);
});

test("several failing batches are repaired together without intermediate entry versions or repeated repair calls", async () => {
  const s = fixture(31); const notesSeen = []; const repairInputs = []; const rows = [];
  s.candidates[0].note = "Initial guidance";
  s.passages[15].contextBefore = ["Source evidence for the second usage"];
  await testCompleteEntry(s, {
    run: async (kind, payload) => { notesSeen.push(s.candidates[0].note); rows.push(payload.rows.length); return translations(kind, payload); },
    ask: async (question, data) => {
      if (question.startsWith("Assess")) return { choices: choices(data).choices.map((choice) => ({ ...choice,
        problem: s.candidates[0].note === "Initial guidance" && ["p15", "p30"].includes(choice.paragraphId) ? "Selection condition missing" : "",
      })) };
      repairInputs.push(data);
      assert.equal(s.candidates[0].note, "Initial guidance", "shared notes stay frozen throughout the first pass");
      assert.deepEqual(data.trial.translations.map((p) => p.paragraphId), ["p15", "p30"]);
      assert.deepEqual(data.failedBatches.map((batch) => batch.batch), [2, 3]);
      assert.deepEqual(data.trial.sourceContexts, [{ paragraphId: "p15", before: ["Source evidence for the second usage"], after: [] }]);
      return { order: ["c"], notes: [{ candidateId: "c", note: "Guidance coordinated for both usages" }] };
    },
  });
  assert.equal(repairInputs.length, 1);
  assert.deepEqual(rows, [15, 15, 1, 15, 15, 1]);
  assert.deepEqual(notesSeen, ["Initial guidance", "Initial guidance", "Initial guidance", ...Array(3).fill("Guidance coordinated for both usages")]);
  assert.equal(s.rounds["9:0"] ?? 0, 0); assert.equal(s.rounds["9:15"], 1); assert.equal(s.rounds["9:30"], 1);
  assert.equal(entryTrialsAreCurrent(s), true);
  assert.equal(new Set(Object.values(s.tests).filter((trial) => trial.phase === "9").map((trial) => trial.signature)).size, 1);
  assert.equal(finalUsage(s).c.occurrences, 31);
});

test("resume before coordinated repair reuses completed failures as well as completed passes", async () => {
  const s = fixture(16); let translationsMade = 0; let shouldPause = true;
  const tools = { run: async (...args) => { translationsMade++; return translations(...args); },
    ask: async (question, data) => {
      if (question.startsWith("Assess")) return choices(data, data.assignments[0].paragraphId === "p15" && !s.candidates[0].note ? "Needs note" : "");
      if (shouldPause) throw new Error("Stopped before repair");
      return { order: ["c"], notes: [{ candidateId: "c", note: "Improved selection" }] };
    } };
  await assert.rejects(testCompleteEntry(s, tools), /Stopped before repair/);
  assert.equal(translationsMade, 2);
  shouldPause = false;
  await testCompleteEntry(s, tools);
  assert.equal(translationsMade, 4, "only the updated-entry pass translates again");
  assert.equal(entryTrialsAreCurrent(s), true);
});

test("a local occurrence correction does not invalidate other unchanged batches via the global revision", async () => {
  const s = fixture(31); const batches = [];
  Object.assign(s.meanings[0], { unused: false, splitOff: false });
  s.meanings.push({ id: "other", definition: "Another valid meaning", unused: false, splitOff: false });
  for (const assignment of s.assignments) assignment.entryId = "original";
  s.assignments[1].meaningId = "other"; s.candidates[0].meaningIds.push("other");
  const tools = { run: async (kind, payload) => { batches.push(payload.rows.length); return translations(kind, payload); }, ask: async (_q, data) => choices(data) };
  await testCompleteEntry(s, tools);
  await reviseAssignment(s, "p30", "o0", "other");
  assert.equal(entryTrialsAreCurrent(s), false);
  assert.equal(finalUsage(s).c.occurrences, 30, "only the corrected batch loses its verdict");
  await testCompleteEntry(s, tools);
  assert.deepEqual(batches, [15, 15, 1, 1]);
  assert.equal(finalUsage(s).c.occurrences, 31);
  s.assignmentRevision++;
  assert.equal(entryTrialsAreCurrent(s), true, "the counter itself is provenance, not changed research input");
  await testCompleteEntry(s, tools); assert.equal(batches.length, 4);
});

test("coordinated repair evidence uses whole bounded paragraphs and applies no partial edits after a failed group", async () => {
  const s = fixture(16); s.entryValidation = { pass: 0, bootstrapPending: false };
  for (const p of s.passages) p.text += " full source context".repeat(7000);
  let groups = 0;
  await assert.rejects(testCompleteEntry(s, {
    run: translations,
    ask: async (question, data) => {
      if (question.startsWith("Assess")) return choices(data, "Missing guidance");
      groups++;
      assert(JSON.stringify(data).length < 400000);
      assert(data.trial.translations.every((p) => p.source === s.passages.find((source) => source.id === p.paragraphId).text));
      if (groups === 2) throw new Error("Second repair group failed");
      return { order: ["c"], notes: [{ candidateId: "c", note: "Staged condition" }], researchSummary: "Staged report explanation" };
    },
  }), /Second repair group failed/);
  assert.equal(groups, 2);
  assert.equal(s.candidates[0].note, undefined);
  assert.deepEqual(s.reports, {}, "a failed repair group must not commit partial report explanations");
  assert.equal(s.rounds["9:0"] ?? 0, 0);
  assert.equal(s.rounds["9:15"] ?? 0, 0);
});

test("a first-batch smoke failure stops for review before spending calls on the remaining sample", async () => {
  const s = fixture(31); const batches = [];
  const result = await testCompleteEntry(s, { run: async (kind, payload) => { batches.push(payload.rows.length); return translations(kind, payload); },
    ask: async (question, data) => question.startsWith("Assess") ? choices(data, "Systemic selection failure") : { order: ["c"], notes: [] } });
  assert.equal(result.pending, true);
  assert.deepEqual(batches, [15, 15, 15, 15]);
  assert.deepEqual(s.pendingDecision.keys, ["9:0"]);
  assert.equal(s.rounds["9:0"], 3);
  assert.equal(s.tests["9:15"], undefined);
});

test("a stable pass pauses together for failed batches at their three-round limit without another repair call", async () => {
  const s = fixture(31); s.entryValidation = { pass: 0, bootstrapPending: false };
  s.rounds["9:15"] = 3; s.rounds["9:30"] = 3;
  let repairs = 0;
  const result = await testCompleteEntry(s, { run: translations, ask: async (question, data) => {
    if (question.startsWith("Assess")) return choices(data, data.assignments[0].paragraphId === "p0" ? "" : "Selection problem");
    repairs++; return { order: ["c"], notes: [] };
  } });
  assert.equal(result.pending, true);
  assert.deepEqual(s.pendingDecision.keys, ["9:15", "9:30"]);
  assert.match(s.pendingDecision.report, /Batches 2, 3/);
  assert.equal(repairs, 0);
  assert.equal(s.entryValidation.phase, "awaiting-review");
});

// Each repair writes the next note version; the assessment fails more occurrences for worse versions.
const worseningRepairs = (failuresByNote) => {
  let version = 0;
  return { run: translations, ask: async (question, data) => {
    if (!question.startsWith("Assess")) return { order: ["c"], notes: [{ candidateId: "c", note: `v${++version}` }] };
    const failed = failuresByNote[data.candidates[0].note ?? ""];
    return { choices: data.assignments.map((a, i) => ({ ...a, candidateId: "c", rendered: "walk", problem: i < failed ? "wrong meaning" : "" })) };
  } };
};

test("when repairs make the entry worse, the repair limit restores the best tested entry and its results", async () => {
  const s = fixture(3);
  const result = await testCompleteEntry(s, worseningRepairs({ "": 2, v1: 1, v2: 2, v3: 3 }));
  assert.equal(result.pending, true); assert.equal(s.rounds["9:0"], 3);
  assert.equal(s.candidates[0].note, "v1");
  assert.equal(s.tests["9:0"].choices.filter((choice) => !choice.passed).length, 1);
  assert.equal(s.tests["9:0"].signature, stableSignature(buildStudioDraft(s)), "the restored results belong to the restored entry");
  assert.match(s.pendingDecision.report, /^Repairs after validation pass 2 made the results worse, so the entry from that pass has been restored \(2 of 3 occurrences passed\)\. Batch 1 still has failures/u);
  assert.deepEqual(s.pendingDecision.keys, ["9:0"]);
  assert.equal(s.testHistory.length, 4, "every tested version stays in the history");
});

test("the latest entry stays when no earlier version did better, and a human edit resets the comparison", async () => {
  const s = fixture(3);
  await testCompleteEntry(s, worseningRepairs({ "": 3, v1: 2, v2: 2, v3: 1 }));
  assert.equal(s.candidates[0].note, "v3");
  assert.doesNotMatch(s.pendingDecision.report, /restored/u);
  const edited = fixture(3);
  await assert.rejects(testCompleteEntry(edited, { run: translations, ask: async (question, data) => {
    if (question.startsWith("Assess")) return { choices: data.assignments.map((a, i) => ({ ...a, candidateId: "c", rendered: "walk", problem: i < 1 ? "wrong meaning" : "" })) };
    throw new Error("paused before repair");
  } }), /paused before repair/);
  assert.equal(edited.entryValidation.best.failed, 1);
  edited.candidates[0].note = "Human guidance";
  await testCompleteEntry(edited, worseningRepairs({ "Human guidance": 3, v1: 3, v2: 3, v3: 3 }));
  assert.equal(edited.candidates[0].note, "v3", "the pre-edit entry is never restored over the human edit");
});

test("a coordinated repair replaces shared target notes consistently instead of appending obsolete duplicate guidance", async () => {
  const s = fixture(); s.candidates[0].note = "Older first condition";
  s.candidates.push({ ...s.candidates[0], id: "duplicate", note: "Obsolete conflicting condition" });
  await testCompleteEntry(s, { run: translations, ask: async (question, data) => {
    if (question.startsWith("Assess")) return choices(data, s.candidates.some((candidate) => candidate.note.includes("Obsolete")) ? "Conflicting target guidance" : "");
    return { order: ["c", "duplicate"], notes: [{ candidateId: "c", note: "Complete shared condition for walking" }] };
  } });
  assert(s.candidates.every((candidate) => candidate.note === "Complete shared condition for walking"));
  assert.deepEqual(buildStudioDraft(s).targetVariantNotes, ["Complete shared condition for walking"]);
  assert.equal(s.rounds["9:0"], 1);
});
test("approved candidate previews are assessed once without retranslating unchanged input", async () => {
  for (const edit of ["none", "notes", "source context", "replacement"]) {
    const s = fixture(); let translated = 0; let assessed = 0;
    const tools = {
      run: async (_kind, payload) => { translated += 1; return { rows: payload.rows.map((row) => ({ rowId: row.rowId, translatedText: translated === 1 ? "walk" : "walked" })) }; },
      ask: async (question, data) => {
        if (question.startsWith("Assess")) {
          assessed += 1;
          return { choices: data.assignments.map((a) => ({ ...a, candidateId: assessed === 1 ? "c" : s.candidates.find((c) => c.text === "walked").id,
            rendered: assessed === 1 ? "walk" : "walked", problem: assessed === 1 ? "A past-tense form is needed." : "" })) };
        }
        return { newForms: [{ text: "walked", note: "Past tense." }] };
      },
    };
    assert.equal((await testMeanings(s, tools)).pending, true);
    assert.equal(translated, 2);
    for (const c of s.candidates) if (c.temporary) c.temporary = false;
    if (edit === "notes") s.generalNote = "New selection instruction.";
    if (edit === "source context") s.passages[0].contextBefore = ["A new neighboring paragraph."];
    if (edit === "replacement") s.candidates.at(-1).note = "Human-supplied replacement usage.";
    s.pendingDecision = null;
    assert.equal((await testMeanings(s, tools)).complete, true);
    assert.equal(assessed, 2, "preview must receive an independent assessment");
    assert.equal(translated, edit === "none" ? 2 : 3, edit);
    assert.equal(s.tests["8:m"].reusedPreviewParagraphs, edit === "none" ? 1 : 0);
  }
});

test("focused batches run at most two at once and keep all source and occurrence ordering", async () => {
  const s = fixture(31); let translating = 0; let reviewing = 0; let peakTranslation = 0; let peakReview = 0;
  await testMeanings(s, {
    run: async (kind, payload) => {
      translating += 1; peakTranslation = Math.max(peakTranslation, translating);
      await Promise.resolve(); await Promise.resolve(); translating -= 1;
      return translations(kind, payload);
    },
    ask: async (_question, data) => {
      reviewing += 1; peakReview = Math.max(peakReview, reviewing);
      await Promise.resolve(); await Promise.resolve(); reviewing -= 1;
      return choices(data);
    },
  });
  assert.equal(peakTranslation, 2); assert.equal(peakReview, 2);
  assert.equal(s.tests["8:m"].passed, true);
  assert.deepEqual(s.tests["8:m"].translations.map((p) => p.paragraphId), s.passages.map((p) => p.id));
  assert.deepEqual(s.tests["8:m"].choices.map((p) => p.paragraphId), s.assignments.map((p) => p.paragraphId));
});

test("a failed focused batch waits for its sibling, stops new paid work and retains the correct Retry signature", async () => {
  const s = fixture(46); let calls = 0; let releaseSibling; let signalBoth;
  const both = new Promise((resolve) => { signalBoth = resolve; });
  const sibling = new Promise((resolve) => { releaseSibling = resolve; });
  let settled = false;
  const running = testMeanings(s, {
    run: async (kind, payload) => {
      calls += 1;
      if (calls === 1) {
        await both;
        const error = new Error("First batch failed"); error.studioToolSignature = "sha256:failed-batch"; throw error;
      }
      signalBoth(); await sibling; return translations(kind, payload);
    }, ask: async (_question, data) => choices(data),
  }).finally(() => { settled = true; });
  const rejected = assert.rejects(running, /First batch failed/);
  await both; await Promise.resolve(); await Promise.resolve();
  assert.equal(settled, false, "in-flight work must settle before stage exits");
  releaseSibling(); await rejected;
  assert.equal(calls, 2, "later batches must not start after a failure");
  assert.equal(s.lastToolSignature, "sha256:failed-batch");
});

test("entry smoke test finishes before two independent stable-entry batches overlap", async () => {
  const s = fixture(46); let smokeReviewed = false; let active = 0; let peak = 0;
  await testCompleteEntry(s, {
    run: async (kind, payload) => {
      if (payload.rows[0].sourceText !== "caminar 0") assert.equal(smokeReviewed, true);
      active += 1; peak = Math.max(peak, active);
      await Promise.resolve(); await Promise.resolve(); active -= 1;
      return translations(kind, payload);
    },
    ask: async (_question, data) => {
      await Promise.resolve();
      if (data.assignments[0].paragraphId === "p0") smokeReviewed = true;
      return choices(data);
    },
  });
  assert.equal(peak, 2);
  assert.equal(entryTrialsAreCurrent(s), true);
  assert.equal(finalUsage(s).c.occurrences, 46);
});

test("entry assessment receives decision fields and compact attempt metadata while preserved trials keep the full draft", async () => {
  const s = fixture(); s.generalNote = "Human selection guidance ".repeat(30);
  s.meanings[0].grammar = "verb"; s.meanings[0].evidence = "Archived source proof ".repeat(1000);
  s.candidates[0].spellingEvidence = "Archived spelling proof ".repeat(1000);
  let request; let review;
  await testCompleteEntry(s, {
    run: async (kind, payload) => { request = payload; return translations(kind, payload); },
    ask: async (question, data) => { assert.match(question, /Unrelated wording elsewhere/); review = data; return choices(data); },
  });
  assert.match(request.researchAttempt, /^9:sha256:[a-f0-9]{64}$/u);
  assert.equal(request.researchAttempt, review.attempt);
  assert.deepEqual(review.meanings, [{ id: "m", definition: "move by foot", grammar: "verb" }]);
  assert.equal(review.candidates[0].note, s.candidates[0].note);
  assert.equal(review.generalNote, s.generalNote);
  assert(!JSON.stringify(review).includes("Archived source proof"));
  assert(!JSON.stringify(review).includes("Archived spelling proof"));
  assert(s.tests["9:0"].signature.includes(s.generalNote.trim()));
  assert.equal(s.meanings[0].evidence.length, "Archived source proof ".repeat(1000).length);
});

test("focused repairs retain report explanations while sending only the repaired shared usage rule", async () => {
  const s = fixture();
  s.candidates.push({ ...s.candidates[0], id: "duplicate", note: "Obsolete essay" });
  let assessments = 0; const payloads = [];
  await testMeanings(s, { run: async (_kind, payload) => { payloads.push(payload); return translations(_kind, payload); },
    ask: async (question, data, shape) => {
      if (question.startsWith("Assess")) return choices(data, assessments++ === 0 ? "Wrong referent" : "");
      assert(question.includes("longer note ONLY"));
      assert(question.includes("replace or simplify"));
      assert(shape.includes("researchSummary"));
      return { confirmIds: [], notes: [{ candidateId: "c", note: "Use for movement on foot." }],
        researchSummary: "Report-only explanation of the wrong referent and its evidence." };
    } });
  assert(s.candidates.every((c) => c.note === "Use for movement on foot."));
  assert.match(s.reports["8:m:1:usage-notes"].summary, /Report-only explanation/);
  assert(payloads.length >= 2);
  assert(!JSON.stringify(payloads).includes("Report-only explanation"));
  assert(!JSON.stringify(payloads.at(-1)).includes("Obsolete essay"));
});

test("complete-entry repairs keep their rationale in the report rather than the translation payload", async () => {
  const s = fixture(); let assessments = 0; const payloads = [];
  await testCompleteEntry(s, { run: async (_kind, payload) => { payloads.push(payload); return translations(_kind, payload); },
    ask: async (question, data, shape) => {
      if (question.startsWith("Assess")) return choices(data, assessments++ === 0 ? "Wrong sense" : "");
      assert(question.includes("longer note ONLY"));
      assert(shape.includes("longNoteReason"));
      return { order: ["c"], notes: [{ candidateId: "c", note: "Use for movement on foot." }],
        researchSummary: "Report-only evidence for the corrected sense selection." };
    } });
  assert.equal(s.candidates[0].note, "Use for movement on foot.");
  assert(Object.values(s.reports).some((r) => r.kind === "usage-notes" && r.summary.includes("Report-only evidence")));
  assert(!JSON.stringify(payloads).includes("Report-only evidence"));
});

test("focused shortening sees and preserves other meanings that share the same visible target", async () => {
  const s = fixture(); s.meanings.push({ id: "other", definition: "A separate figurative sense" });
  s.candidates.push({ ...s.candidates[0], id: "other-c", meaningIds: ["other"], note: "Also allowed for the figurative sense." });
  let requests = 0;
  await assert.rejects(testMeanings(s, {
    run: async (...args) => { if (requests++) throw new Error("Stop after checking repair input"); return translations(...args); },
    ask: async (question, data) => {
      if (question.startsWith("Assess")) return choices(data, "Wrong selection");
      assert.deepEqual(data.sharedUsage.meanings.map((m) => m.id), ["other"]);
      assert.equal(data.sharedUsage.candidates[0].note, "Also allowed for the figurative sense.");
      assert(question.includes("Preserve the other meanings and selection conditions in sharedUsage"));
      return { notes: [{ candidateId: "c", note: "Movement on foot; also the established figurative sense." }],
        researchSummary: "Both meanings need the same shared target rule." };
    },
  }), /Stop after checking repair input/);
  assert(s.candidates.every((c) => c.note === "Movement on foot; also the established figurative sense."));
});

test("accepted translations and ignored paragraphs settle an entry batch without a repair round", async () => {
  const s = fixture(2);
  s.acceptedTranslations = { "p0:o0": ["walk"] };
  s.ignoredTestParagraphIds = ["p1"];
  let asks = 0;
  const result = await testCompleteEntry(s, { run: translations, ask: async (_q, data) => { asks += 1; return choices(data, "The reviewer disagrees"); } });
  assert.equal(result.complete, true);
  assert.equal(asks, 1, "only the assessment ran");
  assert.deepEqual(s.tests["9:0"].choices.map((c) => [c.override, c.reviewerPassed, c.problem]),
    [["accepted", false, "The reviewer disagrees"], ["ignored", false, "The reviewer disagrees"]]);
  assert.deepEqual(finalUsage(s), { c: { occurrences: 1, paragraphs: 1 } });
});
