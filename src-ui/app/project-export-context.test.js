import test from "node:test";
import assert from "node:assert/strict";

globalThis.document = { querySelector: () => null, querySelectorAll: () => [] };
globalThis.window = { addEventListener() {}, removeEventListener() {} };
const { state, createEditorChapterState, createEditorExportModalState, resetSessionState } = await import("./state.js");
const { loadProjectExportBlocks } = await import("./project-export-context.js");
const { serializeEditorPreviewHtml } = await import("./editor-preview.js");

function fixture(includeH1Headings) {
  resetSessionState();
  state.selectedTeamId = "team";
  state.teams = [{ id: "team", installationId: 42 }];
  const chapters = ["first", "interlude", "last"].map((id) => ({ id, name: id, languages: [{ code: "en" }] }));
  state.projects = [{ id: "project", name: "repo", chapters }];
  const items = [
    { id: "contents", kind: "contents", title: "Contents", includeH1Headings },
    { id: "dedication", kind: "dedication", title: "Dedication", text: "For everyone" },
    ...chapters.map((chapter) => ({ ...chapter, kind: "chapter", chapterId: chapter.id, numbered: chapter.id !== "interlude" })),
    { id: "excluded", kind: "chapter", chapterId: "excluded", title: "Excluded", excluded: true },
    { id: "image", kind: "image", title: "Image page" },
  ];
  const modal = { ...createEditorExportModalState(), isOpen: true, projectId: "project", chapterIds: chapters.map(({ id }) => id), languageCode: "en", book: { items } };
  state.editorChapter = { ...createEditorChapterState(), exportModal: modal };
  return modal;
}

const operations = {
  waitForRepoQueue: async () => {},
  invoke: async (_command, { input }) => ({ languages: [{ code: "en" }], rows: [
    { rowId: `${input.chapterId}-title`, textStyle: "heading1", fields: { en: `Title ${input.chapterId}` } },
    { rowId: `${input.chapterId}-body`, fields: { en: "Body [1]" }, footnotes: { en: "Note" } },
    { rowId: `${input.chapterId}-heading`, textStyle: "heading1", fields: { en: `Inside ${input.chapterId}` } },
  ] }),
};

test("project document exports share chapter numbering and optional H1 contents with the preview", async () => {
  for (const includeH1 of [false, true]) {
    const modal = fixture(includeH1);
    modal.book.items.find((item) => item.id === "first").title = "Edited First";
    const blocks = await loadProjectExportBlocks(modal, operations);
    const contents = blocks.filter((block) => block.bookItemId === "contents");
    assert.deepEqual(contents.map((block) => block.text), ["Contents", "1. Edited First", ...(includeH1 ? ["Inside first"] : []), "Title interlude", ...(includeH1 ? ["Inside interlude"] : []), "2. Title last", ...(includeH1 ? ["Inside last"] : [])]);
    assert.ok(contents.filter((block) => block.text.startsWith("Inside")).every((block) => block.textStyle === "indented"));
    assert.equal(blocks.find((block) => block.bookItemId === "first").text, "1. Edited First");
    assert.equal(blocks.find((block) => block.bookItemId === "interlude").text, "Title interlude");
    assert.equal(blocks.find((block) => block.bookItemId === "last").text, "2. Title last");
    assert.match(serializeEditorPreviewHtml(blocks), /Note/);
    assert.equal(modal.book.items.find((item) => item.id === "first").title, "Edited First");
  }
});

test("Vellum keeps chapter titles unprefixed for its native element numbering", async () => {
  const modal = fixture(true);
  const blocks = await loadProjectExportBlocks(modal, operations, { numberChapters: false });
  assert.equal(blocks.find((block) => block.bookItemId === "first").text, "Title first");
  assert.equal(blocks.find((block) => block.bookItemId === "last").text, "Title last");
  assert.ok(blocks.filter((block) => block.bookItemId === "contents").some((block) => block.text === "2. Title last"));
});
