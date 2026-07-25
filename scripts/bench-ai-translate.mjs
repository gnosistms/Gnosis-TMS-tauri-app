// End-to-end benchmark for AI Translate All: measures JOB completion time
// (all rows applied + run finished) and DURABLE completion time (simulated
// commit queue drained), for a given batch count and pool concurrency.
//
// Usage: node bench-ai-translate.mjs <batches> <concurrency> <aiMs> <commitMs>

globalThis.document = {
  querySelector() { return null; },
  querySelectorAll() { return []; },
};
globalThis.window = {
  __TAURI__: {
    core: { invoke: async () => null },
    event: { listen: async () => () => {} },
  },
  setTimeout(callback, ms) {
    const timer = setTimeout(callback, ms);
    timer.unref?.();
    return timer;
  },
  clearTimeout(timer) { clearTimeout(timer); },
};

const APP = new URL("../src-ui/app", import.meta.url).pathname;
const { confirmEditorAiTranslateAll, editorAiTranslateAllTestApi } = await import(`${APP}/editor-ai-translate-all-flow.js`);
const { createEditorAiTranslateAllModalState, createEditorChapterState, resetSessionState, state } = await import(`${APP}/state.js`);

const [, , batchesArg, concurrencyArg, aiMsArg, commitMsArg, providerLimitArg] = process.argv;
const N_BATCHES = Number(batchesArg ?? 5);
const CONCURRENCY = Number(concurrencyArg ?? 3);
const AI_MS = Number(aiMsArg ?? 1000);
const COMMIT_MS = Number(commitMsArg ?? 150);
// Optional: provider rejects calls above this many concurrent with a 429.
const PROVIDER_LIMIT = Number(providerLimitArg ?? 0);
const ROWS = N_BATCHES * 15;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function buildChapter() {
  return {
    ...createEditorChapterState(),
    chapterId: "chapter-1",
    selectedSourceLanguageCode: "es",
    languages: [
      { code: "es", name: "Spanish", role: "source" },
      { code: "vi", name: "Vietnamese", role: "target" },
    ],
    rows: Array.from({ length: ROWS }, (_, index) => ({
      rowId: `row-${String(index + 1).padStart(3, "0")}`,
      lifecycleState: "active",
      // Short text keeps token estimates far below AI_BATCH_TOKEN_TARGET so
      // chunking is row-count-bound at 15.
      fields: { es: `Hola ${index + 1}`, vi: "" },
    })),
    aiTranslateAllModal: {
      ...createEditorAiTranslateAllModalState(),
      isOpen: true,
      selectedLanguageCodes: ["vi"],
    },
  };
}

resetSessionState();
editorAiTranslateAllTestApi.resetActiveBatchRunId();
state.editorChapter = buildChapter();

let commitChain = Promise.resolve();
let commitsEnqueued = 0;
let commitsDone = 0;
let batchAiCalls = 0;
let maxInFlight = 0;
let inFlight = 0;
let singleRowCalls = 0;
let rateLimited429s = 0;

const t0 = performance.now();
await confirmEditorAiTranslateAll(
  () => {},
  {
    aiBatchConcurrency: CONCURRENCY,
    ensureEditorAiTranslateProviderReady: async () => ({ ok: true, providerId: "openai", modelId: "bench" }),
    updateEditorRowFieldValue: (rowId, languageCode, value) => {
      const row = state.editorChapter.rows.find((candidate) => candidate.rowId === rowId);
      if (row) {
        row.fields[languageCode] = value;
      }
    },
    persistEditorRowOnBlur: async () => { singleRowCalls += 1; },
    runAiTranslationBatch: async (request) => {
      batchAiCalls += 1;
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      if (PROVIDER_LIMIT > 0 && inFlight > PROVIDER_LIMIT) {
        await sleep(50);
        inFlight -= 1;
        rateLimited429s += 1;
        throw new Error("OpenAI rate limited this request. Wait a moment and try again.");
      }
      await sleep(AI_MS);
      inFlight -= 1;
      return {
        rows: request.rows.map((row) => ({ rowId: row.rowId, translatedText: `vi:${row.sourceText}` })),
        promptText: "P",
      };
    },
    // Mirrors the real persistEditorRowsBatch contract: enqueue a serialized
    // commit and return immediately; the queue drains in the background.
    persistEditorRowsBatch: async () => {
      commitsEnqueued += 1;
      commitChain = commitChain.then(async () => {
        await sleep(COMMIT_MS);
        commitsDone += 1;
      });
      return true;
    },
  },
);
const tApplied = performance.now();
await commitChain;
const tDurable = performance.now();

const untranslated = state.editorChapter.rows.filter((row) => !row.fields.vi).length;
console.log(JSON.stringify({
  batches: N_BATCHES,
  concurrency: CONCURRENCY,
  aiMs: AI_MS,
  commitMs: COMMIT_MS,
  rows: ROWS,
  untranslated,
  batchAiCalls,
  maxInFlight,
  singleRowCalls,
  rateLimited429s,
  commitsEnqueued,
  commitsDone,
  jobMs: Math.round(tApplied - t0),
  durableMs: Math.round(tDurable - t0),
}));
