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
  const operations = { listen: async (_name, callback) => { deliver = callback; }, waitForRepoQueue: async () => {}, applyAiPreferences: () => {}, resolveModel: () => ({ providerId: "openai", modelId: "configured" }),
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

test("migrated unchecked choices are saved after fresh detection and reload", async () => {
  const { calls, operations, result } = setup();
  await startBookRedundancy(() => {}, operations);
  const started = calls.find((call) => call.name === "start_book_redundancy");
  const migratedResult = { ...result, footnotes: [{ occurrences: [{ id: "current", choiceAliases: ["saved"] }] }] };
  deliver({ payload: { requestId: started.args.input.requestId, complete: true, result: migratedResult } });
  await flushBookRedundancyChoices();
  assert.equal(state.editorChapter.exportModal.book.redundancy.choices.current, false);
  assert.equal(calls.find((call) => call.args?.input?.choices)?.args.input.choices.current, false);
  // Aliases remain in the native snapshot if the app exits before the migration
  // write completes; reopening can perform the same migration without paid work.
  const normalInvoke = operations.invoke;
  operations.invoke = async (name, args) => name === "book_redundancy_cache" && !args.input.choices
    ? { result: migratedResult, choices: { saved: false } } : normalInvoke(name, args);
  await startBookRedundancy(() => {}, operations);await flushBookRedundancyChoices();
  assert.equal(state.editorChapter.exportModal.book.redundancy.choices.current, false);
});

test("flushing waits for checkbox writes queued after Next was clicked", async () => {
  const { calls, operations, result } = setup();
  await startBookRedundancy(() => {}, operations);
  const started = calls.find((call) => call.name === "start_book_redundancy");
  deliver({ payload: { requestId: started.args.input.requestId, complete: true, result } });
  const releases = [];
  const save = { invoke: async () => new Promise((resolve) => releases.push(resolve)) };
  setBookRedundancyChoice("first", true, save);await tick();
  let finished = false;
  const flushed = flushBookRedundancyChoices().then(() => { finished = true; });
  setBookRedundancyChoice("second", true, save);
  releases[0]();await tick();
  const finishedBeforeLatestSave = finished;
  releases[1]();await flushed;
  assert.equal(finishedBeforeLatestSave, false);
});
test("Next cannot advance after its pending review was cancelled or replaced", async () => {
  const { calls, operations, result } = setup();
  await startBookRedundancy(() => {}, operations);
  const started = calls.find((call) => call.name === "start_book_redundancy");
  deliver({ payload: { requestId: started.args.input.requestId, complete: true, result } });
  let release;
  setBookRedundancyChoice("saved", true, { invoke: async () => new Promise((resolve) => { release = resolve; }) });
  await tick();
  const { handleProjectBookAction } = await import("./project-book-flow.js");
  const next = handleProjectBookAction("book-next", () => {});
  cancelBookRedundancy();
  const modal = state.editorChapter.exportModal;
  state.editorChapter.exportModal = { ...modal, page: 1, book: { ...modal.book, previewCache: new Map() } };
  release();await next;
  assert.equal(state.editorChapter.exportModal.page, 1);
});


test("images publish and save independently before footnotes finish or fail", async () => {
  const { calls, operations } = setup();
  let filters;
  operations.waitForRepoQueue = async (_scope, options) => { filters = options; };
  operations.loadAiConfiguration = () => { throw new Error("Network settings must not gate local checks"); };
  await startBookRedundancy(() => {}, operations);
  assert.deepEqual(filters, { operationTypes: ["localEditorWrite"] });
  const requestId = calls.find((call) => call.name === "start_book_redundancy").args.input.requestId;
  const images = [{ id: "picture", occurrences: [{ id: "original", itemId: "a", imageSrc: "thumbnail" }, { id: "repeat", itemId: "b", imageSrc: "thumbnail" }] }];
  const result = { images, footnotes: [], warnings: [], imageWarnings: [], revisions: { a: "source" } };
  deliver({ payload: { requestId, phase: "images", result } });
  let review = state.editorChapter.exportModal.book.redundancy;
  assert.equal(review.status, "loading");
  assert.equal(review.imagesStatus, "ready");
  assert.equal(review.footnotesStatus, "loading");
  setBookRedundancyChoice("image:picture:b", true);
  setBookRedundancyChoice("unverified-note", false);
  await flushBookRedundancyChoices();
  assert.equal(calls.at(-1).args.input.choices["image:picture:b"], true);
  assert.equal(calls.at(-1).args.input.choices["unverified-note"], undefined);
  deliver({ payload: { requestId, complete: true, error: "Footnote check failed" } });
  review = state.editorChapter.exportModal.book.redundancy;
  assert.equal(review.imagesStatus, "ready");
  assert.equal(review.footnotesStatus, "error");
  assert.deepEqual(review.result.images, images);
  assert.deepEqual(review.result.footnotes, []);
  assert.equal(review.choices["image:picture:b"], true);
  retryBookRedundancyChoiceSave();await flushBookRedundancyChoices();
  assert.equal(state.editorChapter.exportModal.book.redundancy.error, "Footnote check failed");
});

test("footnote completion preserves pending image choice save failures", async () => {
  const { calls, operations, result } = setup();
  await startBookRedundancy(() => {}, operations);
  const requestId = calls.find((call) => call.name === "start_book_redundancy").args.input.requestId;
  deliver({ payload: { requestId, phase: "images", result } });
  setBookRedundancyChoice("image:picture:a", false, { invoke: async () => { throw new Error("Disk failure"); } });
  await assert.rejects(flushBookRedundancyChoices(), /Disk failure/);
  deliver({ payload: { requestId, complete: true, result } });
  assert.match(state.editorChapter.exportModal.book.redundancy.choiceSaveError, /Disk failure/);
  await assert.rejects(flushBookRedundancyChoices(), /Disk failure/);
  retryBookRedundancyChoiceSave();await flushBookRedundancyChoices();
  assert.equal(state.editorChapter.exportModal.book.redundancy.choiceSaveError, "");
});
