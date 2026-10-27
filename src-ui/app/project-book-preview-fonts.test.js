import test from "node:test";
import assert from "node:assert/strict";
import { state } from "./state.js";
import { requestBookPreviewFonts } from "./project-book-preview-fonts.js";

let deliver;
const pause = () => new Promise((resolve) => setTimeout(resolve, 10));
function setup() {
  state.selectedTeamId = "team";
  state.editorChapter = { exportModal: { isOpen: true, page: 1, projectId: "project", languageCode: "vi",
    book: { previewCache: new Map(), items: [{ title: "A title" }], previewBlocks: [] },
  } };
  const calls = [], faces = [], renders = [];
  const operations = { force: true, delay: 0,
    listen: async (_name, callback) => { deliver = callback; },
    invoke: async (_name, args) => { calls.push(args.input); },
    convertLocalFileSrc: (path) => `asset:${path}`,
    FontFace: class {
      constructor(family, source, options) { Object.assign(this, { family, source, options }); }
      async load() { return this; }
    }, fonts: { add(face) { faces.push(face); } },
  };
  const request = () => requestBookPreviewFonts((scope) => renders.push(scope), operations);
  const emit = (index, patch = {}) => deliver({ payload: { requestId: calls[index].requestId, fonts: [], profile: {
    bodyFamilies: ["Crimson Pro"], bodySizePt: 11.5,
  }, error: "", ...patch } });
  return { calls, faces, renders, operations, request, emit };
}

test("preview fonts load before applying print metrics and cached faces survive reopening", async () => {
  const { calls, faces, renders, operations, request, emit } = setup();
  request();
  request();
  await pause();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].texts, ["A title"]);
  await emit(0, { fonts: [{ family: "Crimson Pro", filePath: "/cache/crimson.ttf", style: "normal", weight: "100 900" }] });
  assert.equal(faces.length, 1);
  assert.equal(faces[0].source, 'url("asset:/cache/crimson.ttf")');
  assert.equal(state.editorChapter.exportModal.book.previewFonts.status, "ready");
  assert.deepEqual(renders.at(-1), { scope: "project-book-preview" });
  state.editorChapter.exportModal.book.previewCache = new Map();
  requestBookPreviewFonts(() => {}, { ...operations, force: false });
  await pause();
  assert.equal(calls.length, 1);
  assert.equal(state.editorChapter.exportModal.book.previewFonts.status, "ready");
});

test("stale font completions cannot change another language, project, team, or modal session", async () => {
  for (const change of [
    () => { state.editorChapter.exportModal.languageCode = "ja"; },
    () => { state.editorChapter.exportModal.projectId = "other"; },
    () => { state.selectedTeamId = "other"; },
    () => { state.editorChapter.exportModal.book.previewCache = new Map(); },
    () => { state.editorChapter.exportModal.isOpen = false; },
    () => { state.editorChapter.exportModal.page = 2; },
  ]) {
    const { request, emit } = setup();
    request(); await pause();
    change();
    await emit(0);
    assert.equal(state.editorChapter.exportModal.book.previewFonts.status, "loading");
  }
});

test("font failures can retry and new script coverage requests supplemental fonts", async () => {
  const { request, calls, emit, operations } = setup();
  request(); await pause();
  await emit(0, { error: "Font download unavailable" });
  assert.equal(state.editorChapter.exportModal.book.previewFonts.status, "error");
  request(); await pause();
  await emit(1);
  state.editorChapter.exportModal.book.previewBlocks = [{ text: "A Hebrew quotation: שלום" }];
  requestBookPreviewFonts(() => {}, { ...operations, force: false });
  await pause();
  assert.equal(calls.length, 3);
  assert.ok(calls[2].texts.includes("A Hebrew quotation: שלום"));
  await emit(2);
  assert.equal(state.editorChapter.exportModal.book.previewFonts.status, "ready");
});
