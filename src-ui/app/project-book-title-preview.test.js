import test from "node:test";
import assert from "node:assert/strict";
import { state } from "./state.js";
import { requestBookTitlePreview, cancelBookTitlePreview } from "./project-book-title-preview.js";

let deliver;
const pause = () => new Promise((resolve) => setTimeout(resolve, 10));
const setup = () => {
  cancelBookTitlePreview();
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
  requestBookTitlePreview(() => {}, operations);
  modal.book.items[0].title = "Hôn Nhân\nHoàn Hảo";
  requestBookTitlePreview(() => {}, operations);
  await pause();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].item.title, "Hôn Nhân\nHoàn Hảo");
  assert.equal(calls[0].item.imageAssetId, "logo.svg");
  assert.equal(calls[0].paperSize, "a5");
  const first = calls[0];
  state.editorChapter.exportModal.book.items[0].title = "Another title";
  requestBookTitlePreview(() => {}, operations);
  emit(first);
  assert.equal(state.editorChapter.exportModal.book.titlePreview.status, "loading");
  await pause();
  emit(calls[1]);
  assert.equal(state.editorChapter.exportModal.book.titlePreview.status, "ready");
  requestBookTitlePreview(() => {}, operations);
  await pause();
  assert.equal(calls.length, 2);
});

test("paper changes regenerate the preview and failures can recover", async () => {
  const { calls, operations } = setup();
  requestBookTitlePreview(() => {}, operations);
  await pause();
  emit(calls[0], { error: "Font unavailable", pages: [] });
  assert.equal(state.editorChapter.exportModal.book.titlePreview.status, "error");
  cancelBookTitlePreview();
  state.editorChapter.exportModal.pdfPaperSize = "a4";
  requestBookTitlePreview(() => {}, operations);
  await pause();
  assert.equal(calls[1].paperSize, "a4");
  emit(calls[1]);
  assert.equal(state.editorChapter.exportModal.book.titlePreview.error, "");
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
    requestBookTitlePreview(() => {}, operations);
    await pause();
    change();
    emit(calls[0]);
    assert.equal(state.editorChapter.exportModal.book.titlePreview.status, "loading");
  }
  cancelBookTitlePreview();
});
