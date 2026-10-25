import test from "node:test";
import assert from "node:assert/strict";

import {
  closeEditorGlossaryEntry,
  openEditorGlossaryEntry,
  sourceTextOccurrence,
  updateEditorGlossaryEntryField,
} from "./editor-glossary-entry-flow.js";
import { state } from "./state.js";
import { createEditorGlossaryEntryState } from "./glossary-research-state.js";
import { renderEditorGlossaryEntryModal } from "../screens/editor-glossary-entry-modal.js";

const LANGUAGES = [
  { code: "es", name: "Spanish", role: "source" },
  { code: "vi", name: "Vietnamese", role: "target" },
  { code: "en", name: "English", role: "target" },
];

function withChapter(callback, { linkedGlossary = { glossaryId: "g1", repoName: "team/g1" }, research = false } = {}) {
  const saved = {
    projects: state.projects, selectedChapterId: state.selectedChapterId, glossaries: state.glossaries,
    editorChapter: state.editorChapter, entry: state.editorGlossaryEntry, actionConfig: state.aiSettings.actionConfig,
  };
  state.projects = [{ id: "p1", chapters: [{ id: "c1", linkedGlossary }] }];
  state.selectedChapterId = "c1";
  state.glossaries = [{ id: "g1", glossaryId: "g1", repoName: "team/g1",
    sourceLanguage: { code: "es", name: "Spanish" }, targetLanguage: { code: "vi", name: "Vietnamese" } }];
  state.editorChapter = {
    chapterId: "c1", projectId: "p1", languages: LANGUAGES, glossary: { status: "loading" },
    rows: [{ rowId: "r1", fields: { es: "El <em>Ser interior</em> es la parte más elevada.", vi: "Đấng Nội Tại là phần cao nhất.", en: "The Inner Being is the highest part." } }],
  };
  state.aiSettings.actionConfig = research
    ? { detailedConfiguration: false, unified: { providerId: "claude", modelId: "claude-opus-5-5" } }
    : { detailedConfiguration: false, unified: { providerId: "gemini", modelId: "gemini-model" } }; // not a research provider
  return Promise.resolve(callback()).finally(() => {
    state.projects = saved.projects; state.selectedChapterId = saved.selectedChapterId; state.glossaries = saved.glossaries;
    state.editorChapter = saved.editorChapter; state.editorGlossaryEntry = saved.entry; state.aiSettings.actionConfig = saved.actionConfig;
  });
}

test("the AI's source text is accepted only as the row writes it", () => {
  const row = "El Ser   interior es la parte más elevada. Almacén del alma: el Alma.";
  assert.equal(sourceTextOccurrence("ser interior", row), "Ser   interior");
  assert.equal(sourceTextOccurrence("  la parte  más ", row), "la parte más");
  assert.equal(sourceTextOccurrence("alma", row), "alma", "a whole word is preferred to the start of “Almacén”");
  assert.equal(sourceTextOccurrence("ALMACÉN", row), "Almacén");
  assert.equal(sourceTextOccurrence("Ser exterior", row), "", "text the row does not hold is refused");
  assert.equal(sourceTextOccurrence("", row), "");
  assert.equal(sourceTextOccurrence(null, row), "");
  assert.equal(sourceTextOccurrence("Äther", "Präsenz und Äther"), "Äther", "composed and decomposed accents match");
});

test("text highlighted in the source language goes straight to the source box", () => withChapter(async () => {
  let renders = 0;
  await openEditorGlossaryEntry(() => { renders += 1; }, { rowId: "r1", languageCode: "es", text: "Ser interior" });
  const entry = state.editorGlossaryEntry;
  assert.equal(renders, 1);
  assert.equal(entry.isOpen, true);
  assert.equal(entry.step, "entry");
  assert.equal(entry.selectionRole, "source");
  assert.equal(entry.sourceTerm, "Ser interior");
  assert.equal(entry.targetTerm, "");
  assert.deepEqual(entry.targetLanguage, { code: "vi", name: "Vietnamese" });
  const html = renderEditorGlossaryEntryModal(state);
  assert.match(html, /Source term \(Spanish\)/);
  assert.match(html, /value="Ser interior"/);
  assert.match(html, /data-editor-glossary-entry-field="targetTerm"\s+data-modal-initial-focus/, "the empty translation box gets focus");
  for (const label of ["Cancel", "Save to glossary", "Research meanings"]) assert.match(html, new RegExp(`>${label}<`));
  assert.match(html, /data-tooltip="Use AI to investigate the meaning of the source term and suggest target language translations"/);
}));

test("target-language text fills the translation; without a Research model the source is left to type", () => withChapter(async () => {
  await openEditorGlossaryEntry(() => {}, { rowId: "r1", languageCode: "vi", text: "Đấng Nội Tại" });
  const entry = state.editorGlossaryEntry;
  assert.equal(entry.step, "entry");
  assert.equal(entry.selectionRole, "target");
  assert.equal(entry.targetTerm, "Đấng Nội Tại");
  assert.equal(entry.sourceTerm, "");
  assert.match(entry.notice, /choose a Research model in AI Settings/);
  const html = renderEditorGlossaryEntryModal(state);
  assert.match(html, /data-action="save-editor-glossary-entry"[^>]*disabled/, "Save waits for a source term");
  assert.match(html, /data-action="research-editor-glossary-entry"[^>]*disabled/);
}));

test("a failed AI search on target-language text still lets the translator type the source", () => withChapter(async () => {
  const steps = [];
  await openEditorGlossaryEntry(() => steps.push(state.editorGlossaryEntry.step), { rowId: "r1", languageCode: "vi", text: "Đấng Nội Tại" });
  assert.deepEqual(steps, ["finding", "entry"], "the spinner shows while the AI is asked");
  const entry = state.editorGlossaryEntry;
  assert.match(entry.notice, /Something went wrong while finding the Spanish text/);
  assert.ok(entry.error, "the reason is shown");
}, { research: true }));

test("text in another language that cannot be matched ends with only Cancel", () => withChapter(async () => {
  await openEditorGlossaryEntry(() => {}, { rowId: "r1", languageCode: "en", text: "Inner Being" });
  const entry = state.editorGlossaryEntry;
  assert.equal(entry.selectionRole, "other");
  assert.equal(entry.step, "not-found");
  assert.match(entry.notice, /Finding the Spanish term needs a Research model/);
  const html = renderEditorGlossaryEntryModal(state);
  assert.match(html, />Cancel</);
  assert.doesNotMatch(html, /Save to glossary|Research meanings/);
}));

test("the window shows the spinner and the highlighted words while it searches", () => {
  const saved = state.editorGlossaryEntry;
  try {
    state.editorGlossaryEntry = { ...createEditorGlossaryEntryState(), isOpen: true, step: "finding", selectionRole: "other",
      selectionLanguage: { code: "en", name: "English" }, selectedText: "Inner Being", sourceLanguage: { code: "es", name: "Spanish" } };
    const other = renderEditorGlossaryEntryModal(state);
    assert.match(other, /button__spinner/);
    assert.match(other, /Highlighted in English/);
    assert.match(other, /Finding the Spanish term that corresponds to it/);
    state.editorGlossaryEntry = { ...state.editorGlossaryEntry, selectionRole: "target", targetTerm: "Đấng Nội Tại",
      targetLanguage: { code: "vi", name: "Vietnamese" } };
    const target = renderEditorGlossaryEntryModal(state);
    assert.match(target, /Translation \(Vietnamese\)/);
    assert.match(target, /value="Đấng Nội Tại"[\s\S]*disabled/);
    assert.match(target, /Finding the Spanish text that corresponds to it/);
  } finally { state.editorGlossaryEntry = saved; }
});

test("a chapter without a glossary, or with one in another source language, is explained", () => withChapter(async () => {
  await openEditorGlossaryEntry(() => {}, { rowId: "r1", languageCode: "es", text: "Ser" });
  assert.equal(state.editorGlossaryEntry.step, "blocked");
  assert.match(state.editorGlossaryEntry.blockedMessage, /need a glossary linked to this chapter/);
}, { linkedGlossary: null }).then(() => withChapter(async () => {
  state.glossaries = [{ id: "g1", repoName: "team/g1", sourceLanguage: { code: "fr", name: "French" }, targetLanguage: { code: "vi", name: "Vietnamese" } }];
  await openEditorGlossaryEntry(() => {}, { rowId: "r1", languageCode: "es", text: "Ser" });
  assert.equal(state.editorGlossaryEntry.step, "blocked");
  assert.match(state.editorGlossaryEntry.blockedMessage, /French→Vietnamese/);
})));

test("typing a source term updates the entry; Cancel closes it", () => withChapter(async () => {
  await openEditorGlossaryEntry(() => {}, { rowId: "r1", languageCode: "es", text: "Ser" });
  updateEditorGlossaryEntryField("sourceTerm", "Ser interior");
  updateEditorGlossaryEntryField("targetTerm", "Đấng Nội Tại");
  updateEditorGlossaryEntryField("notice", "ignored");
  assert.equal(state.editorGlossaryEntry.sourceTerm, "Ser interior");
  assert.equal(state.editorGlossaryEntry.targetTerm, "Đấng Nội Tại");
  assert.equal(state.editorGlossaryEntry.notice, "");
  let renders = 0;
  closeEditorGlossaryEntry(() => { renders += 1; });
  assert.equal(state.editorGlossaryEntry.isOpen, false);
  assert.equal(renders, 1);
}));
