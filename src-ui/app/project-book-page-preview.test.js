import test from "node:test";
import assert from "node:assert/strict";
import { state } from "./state.js";
import { requestBookPagePreview, cancelBookPagePreview } from "./project-book-page-preview.js";

let deliver;
const pause = () => new Promise((resolve) => setTimeout(resolve, 10));
const setup = () => {
  cancelBookPagePreview();
  state.selectedTeamId = "team";
  state.editorChapter = { exportModal: { isOpen: true, page: 1, projectId: "project", languageCode: "vi", pdfPaperSize: "a5",
    book: { previewCache: new Map(), selectedItemId: "title", items: [{ id: "title", kind: "title", title: "Hôn Nhân Hoàn Hảo", image: { assetId: "logo.svg" } }] },
  } };
  const calls = [];
  const operations = { delay: 0, listen: async (_name, callback) => { deliver = callback; }, invoke: async (_name, payload) => { calls.push(payload.input); } };
  return { calls, operations, modal: state.editorChapter.exportModal };
};
const emit = (request, patch = {}) => deliver({ payload: { requestId: request.requestId, pages: ["data:image/svg+xml;base64,PHN2Zy8+"], error: "", ...patch } });

test("preview debounces edits, uses export fields, and discards superseded completion", async () => {
  const { calls, operations, modal } = setup();
  modal.book.items[0].excluded = true;
  requestBookPagePreview(() => {}, operations);
  modal.book.items[0].title = "Hôn Nhân\nHoàn Hảo";
  requestBookPagePreview(() => {}, operations);
  await pause();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].item.title, "Hôn Nhân\nHoàn Hảo");
  assert.equal(calls[0].item.imageAssetId, "logo.svg");
  assert.equal(calls[0].paperSize, "a5");
  const first = calls[0];
  state.editorChapter.exportModal.book.items[0].title = "Another title";
  requestBookPagePreview(() => {}, operations);
  emit(first);
  assert.equal(state.editorChapter.exportModal.book.pagePreview.status, "loading");
  await pause();
  emit(calls[1]);
  assert.equal(state.editorChapter.exportModal.book.pagePreview.status, "ready");
  requestBookPagePreview(() => {}, operations);
  await pause();
  assert.equal(calls.length, 2);
});

test("paper changes regenerate the preview and failures can recover", async () => {
  const { calls, operations } = setup();
  requestBookPagePreview(() => {}, operations);
  await pause();
  emit(calls[0], { error: "Font unavailable", pages: [] });
  assert.equal(state.editorChapter.exportModal.book.pagePreview.status, "error");
  cancelBookPagePreview();
  state.editorChapter.exportModal.pdfPaperSize = "a4";
  requestBookPagePreview(() => {}, operations);
  await pause();
  assert.equal(calls[1].paperSize, "a4");
  emit(calls[1]);
  assert.equal(state.editorChapter.exportModal.book.pagePreview.error, "");
});

test("completions cannot cross item, language, project, team, or modal sessions", async () => {
  for (const change of [
    () => { state.editorChapter.exportModal.book.selectedItemId = "elsewhere"; },
    () => { state.editorChapter.exportModal.languageCode = "en"; },
    () => { state.editorChapter.exportModal.projectId = "other"; },
    () => { state.selectedTeamId = "other"; },
    () => { state.editorChapter.exportModal.book.previewCache = new Map(); },
    () => { state.editorChapter.exportModal.isOpen = false; },
  ]) {
    const { calls, operations } = setup();
    requestBookPagePreview(() => {}, operations);
    await pause();
    change();
    emit(calls[0]);
    assert.equal(state.editorChapter.exportModal.book.pagePreview.status, "loading");
  }
  cancelBookPagePreview();
});

test("contents previews typeset the saved book scope and ignore review exclusions", async () => {
  const { calls, operations, modal } = setup();
  state.projects = [{ id: "project", name: "perfect-matrimony", fullName: "team/perfect-matrimony" }];
  state.teams = [{ id: "team", installationId: 7 }];
  modal.projectTitle = "Hôn Nhân Hoàn Hảo";
  modal.book.items = [
    { id: "toc", kind: "contents", title: "Mục lục", includeH1Headings: true, excluded: true },
    { id: "c1", kind: "chapter", chapterId: "c1", name: "chapter-01", title: "", numbered: true },
    { id: "c2", kind: "chapter", chapterId: "c2", name: "chapter-02", title: "", excluded: true },
  ];
  modal.book.selectedItemId = "toc";
  modal.book.redundancy = { result: { revisions: { c1: "rev" } } };
  requestBookPagePreview(() => {}, operations);
  await pause();
  assert.equal(calls.length, 1);
  const [input] = calls;
  assert.equal(input.item.kind, "contents");
  assert.equal(input.item.includeH1Headings, true);
  assert.equal(input.book.installationId, 7);
  assert.equal(input.book.repoName, "perfect-matrimony");
  assert.equal(input.book.projectTitle, "Hôn Nhân Hoàn Hảo");
  // The excluded contents itself is still previewed in place; excluded chapters are not.
  assert.deepEqual(input.book.bookItems.map((item) => item.id), ["toc", "c1"]);
  assert.deepEqual(input.book.bookItems.map((item) => item.reviewRevision), ["", ""]);
  emit(input);
  assert.equal(state.editorChapter.exportModal.book.pagePreview.status, "ready");
  // Reordering or renaming chapters asks for new page numbers.
  modal.book.items[1].title = "Renamed";
  requestBookPagePreview(() => {}, operations);
  await pause();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].book.bookItems[1].title, "Renamed");
  cancelBookPagePreview();
});

test("only title and contents pages use the typeset preview", async () => {
  const { calls, operations, modal } = setup();
  for (const kind of ["chapter", "copyright", "dedication", "image"]) {
    modal.book.items = [{ id: "x", kind, chapterId: "x", name: "x" }];
    modal.book.selectedItemId = "x";
    requestBookPagePreview(() => {}, operations);
  }
  await pause();
  assert.equal(calls.length, 0);
});
