import test from "node:test";
import assert from "node:assert/strict";
globalThis.window = { addEventListener() {}, removeEventListener() {} };
globalThis.document = { querySelector: () => null, querySelectorAll: () => [] };
const { state } = await import("./state.js");
const { startBookRedundancy, cancelBookRedundancy, setBookRedundancyChoice, flushBookRedundancyChoices } = await import("./project-book-redundancy-flow.js");
let deliver;
function setup() {
  cancelBookRedundancy();
  state.selectedTeamId = "team";
  state.teams = [{ id: "team", installationId: 7 }];
  state.projects = [{ id: "project", name: "book" }];
  state.editorChapter = { exportModal: { isOpen: true, page: 2, status: "idle", projectId: "project", languageCode: "en", projectTitle: "Book",
    book: { previewCache: new Map(), items: [{ id: "a", chapterId: "a", name: "Chapter A", kind: "chapter" }] },
  } };
  const calls = [];
  const result = { images: [], footnotes: [], warnings: [], cached: true };
  const operations = { listen: async (_name, callback) => { deliver = callback; }, waitForRepoQueue: async () => {}, loadAiConfiguration: async () => {}, resolveModel: () => ({ providerId: "openai", modelId: "configured" }),
    invoke: async (name, args) => { calls.push({ name, args }); if (name === "book_redundancy_cache") return { choices: { saved: false }, result }; },
  };
  return { calls, operations, result };
}
test("cached review seeds locally, native input sees originals, choices save without export", async () => {
  const { calls, operations, result } = setup();
  await startBookRedundancy(() => {}, operations);
  assert.equal(state.editorChapter.exportModal.book.redundancy.choices.saved, false);
  const started = calls.find((c) => c.name === "start_book_redundancy");
  assert.deepEqual(started.args.input.export.bookItems[0].exclusions, []);
  deliver({ payload: { requestId: started.args.input.requestId, complete: true, result } });
  assert.equal(state.editorChapter.exportModal.book.redundancy.status, "ready");
  setBookRedundancyChoice("saved", true);
  await flushBookRedundancyChoices();
  assert.equal(calls.at(-1).args.input.choices.saved, true);
});
test("stale events cannot change another language and cancel the running native job", async () => {
  const { calls, operations, result } = setup();
  await startBookRedundancy(() => {}, operations);
  const started = calls.find((c) => c.name === "start_book_redundancy");
  state.editorChapter.exportModal.languageCode = "vi";
  deliver({ payload: { requestId: started.args.input.requestId, complete: true, result } });
  assert.equal(state.editorChapter.exportModal.book.redundancy.status, "loading");
  assert.equal(calls.at(-1).name, "cancel_book_redundancy");
});
test("fatal detection errors discard unverified cached exclusions", async () => {
  const { calls, operations } = setup();
  await startBookRedundancy(() => {}, operations);
  const started = calls.find((c) => c.name === "start_book_redundancy");
  deliver({ payload: { requestId: started.args.input.requestId, complete: true, error: "Source changed" } });
  assert.equal(state.editorChapter.exportModal.book.redundancy.result, null);
  assert.equal(state.editorChapter.exportModal.book.redundancy.status, "error");
});
