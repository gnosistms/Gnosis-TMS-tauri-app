import test from "node:test";
import assert from "node:assert/strict";
import { state } from "./state.js";
import { beginSrtGroupEdit, updateSrtGroupDraft, finishSrtGroupEdits } from "./editor-srt-group-edit-flow.js";
import { combineSrtRows, srtGroupsForChapter } from "./editor-srt-grouping.js";

function chapter() {
  return { chapterId: "srt", srtViewMode: "group-fragments", sourceFormats: ["srt"],
    selectedSourceLanguageCode: "en", languages: [{ code: "en" }, { code: "vi" }],
    mainFieldEditor: { rowId: "a", languageCode: "vi" }, rows: ["a", "b"].map((rowId, index) => ({ rowId,
      fields: { en: "fragment", vi: `old${index}` }, persistedFields: { en: "fragment", vi: `old${index}` },
      srtTiming: { startMs: index * 1000, endMs: (index + 1) * 1000 } })) };
}

test("a stale clean session displays current text and rebases the next edit onto it", () => {
  const previous = state.editorChapter;
  try {
    state.editorChapter = chapter();
    beginSrtGroupEdit("a", "vi");
    state.editorChapter.rows = state.editorChapter.rows.map((row, index) => index ? row : {
      ...row, fields: { ...row.fields, vi: "new⟦1⟧text" }, persistedFields: { ...row.persistedFields, vi: "new⟦1⟧text" },
    });
    const combined = combineSrtRows(state.editorChapter.rows, state.editorChapter.languages, state.editorChapter);
    assert.equal(combined.srtTexts.vi.text, "new⟦1⟧text⟦#1⟧old1");
    updateSrtGroupDraft("a", "vi", "edited⟦#1⟧second");
    const edit = state.editorChapter.srtGroupEdits["a:vi"];
    assert.deepEqual(edit.markers, ["⟦#1⟧"]);
    assert.equal(edit.baseFields.a, "new⟦1⟧text");
    assert.equal(edit.savedDraft, "new⟦1⟧text⟦#1⟧old1");
    assert.equal(edit.draft, "edited⟦#1⟧second");
  } finally { state.editorChapter = previous; }
});

test("dirty and force-save drafts preserve their text, boundaries, and concurrency base across updates", () => {
  const previous = state.editorChapter;
  try {
    for (const forceSave of [false, true]) {
      state.editorChapter = chapter();
      const original = beginSrtGroupEdit("a", "vi");
      const draft = forceSave ? original.draft : "local⟦1⟧draft";
      updateSrtGroupDraft("a", "vi", draft, { forceSave });
      const captured = state.editorChapter.srtGroupEdits["a:vi"];
      state.editorChapter.mainFieldEditor = {};
      state.editorChapter.rows = state.editorChapter.rows.map((row, index) => index ? row : {
        ...row, fields: { en: "New sentence.", vi: "remote" }, persistedFields: { en: "New sentence.", vi: "remote" },
      });
      assert.equal(srtGroupsForChapter(state.editorChapter).length, 1);
      assert.equal(beginSrtGroupEdit("a", "vi"), captured);
      assert.equal(combineSrtRows(state.editorChapter.rows, state.editorChapter.languages, state.editorChapter).srtTexts.vi.text, draft);
      assert.equal(captured.baseFields.a, "old0");
    }
  } finally { state.editorChapter = previous; }
});

test("closing a clean source session allows regrouping after source punctuation changes", () => {
  const previous = state.editorChapter;
  try {
    state.editorChapter = chapter();
    state.editorChapter.mainFieldEditor.languageCode = "en";
    beginSrtGroupEdit("a", "en");
    updateSrtGroupDraft("a", "en", "Sentence.⟦1⟧Next");
    const saving = state.editorChapter.srtGroupEdits["a:en"];
    state.editorChapter.rows = state.editorChapter.rows.map((row, index) => ({ ...row,
      fields: { ...row.fields, en: index ? "Next" : "Sentence." },
      persistedFields: { ...row.persistedFields, en: index ? "Next" : "Sentence." },
    }));
    finishSrtGroupEdits("srt", [{ edit: saving }]);
    assert.equal(srtGroupsForChapter(state.editorChapter).length, 1);
    state.editorChapter.mainFieldEditor = {};
    assert.equal(srtGroupsForChapter(state.editorChapter).length, 2);
  } finally { state.editorChapter = previous; }
});

test("a delayed save preserves newer typing and rebases its next save onto the committed text", () => {
  const previous = state.editorChapter;
  try {
    state.editorChapter = { chapterId: "srt", srtViewMode: "group-fragments", sourceFormats: ["srt"],
      selectedSourceLanguageCode: "en", languages: [{ code: "en" }, { code: "vi" }],
      mainFieldEditor: { rowId: "a", languageCode: "vi" }, rows: ["a", "b"].map((rowId, index) => ({ rowId,
        fields: { en: "fragment", vi: `old${index}` }, persistedFields: { vi: `old${index}` },
        srtTiming: { startMs: index * 1000, endMs: (index + 1) * 1000 } })) };
    beginSrtGroupEdit("a", "vi");
    updateSrtGroupDraft("a", "vi", "saved⟦1⟧text");
    const saving = state.editorChapter.srtGroupEdits["a:vi"];
    updateSrtGroupDraft("a", "vi", "new typing⟦1⟧text");
    state.editorChapter.rows = state.editorChapter.rows.map((row, index) => ({ ...row, persistedFields: { vi: index ? "text" : "saved" } }));
    finishSrtGroupEdits("srt", [{ edit: saving }]);
    const current = state.editorChapter.srtGroupEdits["a:vi"];
    assert.equal(current.draft, "new typing⟦1⟧text");
    assert.equal(current.savedDraft, "saved⟦1⟧text");
    assert.deepEqual(current.baseFields, { a: "saved", b: "text" });
  } finally { state.editorChapter = previous; }
});
