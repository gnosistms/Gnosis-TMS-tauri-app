import test from "node:test";
import assert from "node:assert/strict";
globalThis.window = { addEventListener() {}, removeEventListener() {} };
globalThis.document = { querySelector: () => null, querySelectorAll: () => [] };
const { state } = await import("./state.js");
const { startBookRedundancy, cancelBookRedundancy, setBookRedundancyChoice, flushBookRedundancyChoices, retryBookRedundancyChoiceSave } = await import("./project-book-redundancy-flow.js");
const { setActiveStorageLogin } = await import("./team-storage.js");
let deliver;
function setup() {
  cancelBookRedundancy();
  setActiveStorageLogin("alice");
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
  assert.equal(started.args.input.login, "alice");
  assert.equal(calls.find((call) => call.name === "book_redundancy_cache").args.input.login, "alice");
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

const tick = () => new Promise((resolve) => setImmediate(resolve));
test("queued choice saves never dispatch after switching accounts", async () => {
  const { calls, operations, result } = setup();
  await startBookRedundancy(() => {}, operations);
  const started = calls.find((c) => c.name === "start_book_redundancy");
  deliver({ payload: { requestId: started.args.input.requestId, complete: true, result } });
  const writes = []; let release;
  const save = { invoke: async (_name, { input }) => {
    writes.push(input);
    if (writes.length === 1) await new Promise((resolve) => { release = resolve; });
  } };
  setBookRedundancyChoice("first", true, save);
  await tick();
  setBookRedundancyChoice("second", true, save);
  setActiveStorageLogin("bob");
  release();await flushBookRedundancyChoices();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].login, "alice");
});
test("a successful latest full-state save supersedes an older failure", async () => {
  const { calls, operations, result } = setup();
  await startBookRedundancy(() => {}, operations);
  const started = calls.find((c) => c.name === "start_book_redundancy");
  deliver({ payload: { requestId: started.args.input.requestId, complete: true, result } });
  let rejectFirst; const writes = [];
  const save = { invoke: async (_name, { input }) => {
    writes.push(input);
    if (writes.length === 1) await new Promise((_resolve, reject) => { rejectFirst = reject; });
  } };
  setBookRedundancyChoice("first", true, save);await tick();
  setBookRedundancyChoice("second", true, save);
  rejectFirst(new Error("Temporary disk failure"));
  await assert.doesNotReject(flushBookRedundancyChoices());
  assert.deepEqual(writes.at(-1).choices, { saved: false, first: true, second: true });
});

test("a latest save failure blocks Next and can be retried without changing choices", async () => {
  const { calls, operations, result } = setup();
  const normalInvoke = operations.invoke; let fail = true;
  operations.invoke = async (name, args) => {
    if (args?.input?.choices && fail) throw new Error("Disk unavailable");
    return normalInvoke(name, args);
  };
  await startBookRedundancy(() => {}, operations);
  const started = calls.find((call) => call.name === "start_book_redundancy");
  deliver({ payload: { requestId: started.args.input.requestId, complete: true, result } });
  setBookRedundancyChoice("saved", true);
  await assert.rejects(flushBookRedundancyChoices(), /Disk unavailable/);
  fail = false;retryBookRedundancyChoiceSave();await assert.doesNotReject(flushBookRedundancyChoices());
  assert.equal(state.editorChapter.exportModal.book.redundancy.error, "");
  assert.equal(calls.at(-1).args.input.choices.saved, true);
});
