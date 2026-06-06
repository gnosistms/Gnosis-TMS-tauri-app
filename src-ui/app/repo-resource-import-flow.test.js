import test from "node:test";
import assert from "node:assert/strict";

globalThis.document = {
  querySelector() {
    return null;
  },
  querySelectorAll() {
    return [];
  },
  addEventListener() {},
  documentElement: {
    classList: {
      add() {},
      remove() {},
      toggle() {},
    },
  },
};
globalThis.window = {
  __TAURI__: {
    core: {
      invoke: async () => null,
    },
    event: {
      listen: async () => () => {},
    },
  },
  __TAURI_INTERNALS__: null,
  addEventListener() {},
  open() {},
  requestAnimationFrame(callback) {
    callback();
  },
  setTimeout(callback) {
    callback();
    return 1;
  },
  clearTimeout() {},
};

const {
  createRepoResourceImportFlow,
  importFileBytes,
  importFileName,
} = await import("./repo-resource/import-flow.js");
const { createResourcePageState } = await import("./resource-page-controller.js");

function fileLike(name, bytes, size = bytes.length) {
  return {
    name,
    size,
    async arrayBuffer() {
      return Uint8Array.from(bytes).buffer;
    },
  };
}

function testFlow(overrides = {}) {
  const calls = [];
  let importing = false;
  let importOpen = true;
  const pageState = createResourcePageState();
  const flow = createRepoResourceImportFlow({
    accept: ".tmx",
    pageState: () => pageState,
    syncController: {
      begin: () => calls.push("sync-begin"),
      complete: async () => calls.push("sync-complete"),
      fail: () => calls.push("sync-fail"),
    },
    setProgress: (_render, text) => calls.push(`progress:${text}`),
    clearProgress: () => calls.push("progress-clear"),
    isImportModalOpen: () => importOpen,
    isImporting: () => importing,
    importFile: async (_render, file) => calls.push(`import:${file.name}`),
    setImportError: (_render, message) => calls.push(`error:${message}`),
    selectedTeamMatches: () => true,
    upsertForTeam: (_team, resource, _render, options) =>
      calls.push(`upsert:${resource.id}:${options?.preserveCreate === true}`),
    resultResourceField: "resource",
    openFilePicker: async () => ({ name: "selected.tmx" }),
    readDroppedFile: async () => ({
      name: "dropped.tmx",
      mimeType: "text/xml",
      dataBase64: "YWJj",
    }),
    ...overrides,
  });

  return {
    calls,
    flow,
    pageState,
    setImporting: (value) => {
      importing = value;
    },
    setImportOpen: (value) => {
      importOpen = value;
    },
  };
}

test("importFileName trims file-like names and falls back when missing", () => {
  assert.equal(importFileName({ name: "  terms.tmx  " }), "terms.tmx");
  assert.equal(importFileName({ name: "  " }, "fallback.tmx"), "fallback.tmx");
});

test("importFileBytes reads picker files and enforces the import size limit", async () => {
  assert.deepEqual(await importFileBytes(fileLike("terms.tmx", [1, 2, 3])), [1, 2, 3]);
  await assert.rejects(
    importFileBytes(fileLike("large.tmx", [1], 26 * 1024 * 1024)),
    /maximum file size is 25 MB/,
  );
});

test("importFileBytes decodes dropped-file base64 payloads", async () => {
  assert.deepEqual(await importFileBytes({ dataBase64: "YWJj" }), [97, 98, 99]);
});

test("selectImportFile opens the picker only for an idle open import modal", async () => {
  const { calls, flow, setImporting } = testFlow();
  await flow.selectImportFile(() => {});
  assert.deepEqual(calls, ["import:selected.tmx"]);

  calls.length = 0;
  setImporting(true);
  await flow.selectImportFile(() => {});
  assert.deepEqual(calls, []);
});

test("upsertCreatedResourceForTeam preserves create intent for the result resource", () => {
  const { calls, flow } = testFlow();
  assert.equal(
    flow.upsertCreatedResourceForTeam({ id: "team-1" }, { resource: { id: "resource-1" } }),
    true,
  );
  assert.deepEqual(calls, ["upsert:resource-1:true"]);
});

test("submitImportWrite runs mutation, reloads, clears progress, and calls success", async () => {
  const { calls, flow, pageState } = testFlow();
  const result = { resource: { id: "resource-1" } };
  const succeeded = await flow.submitImportWrite(() => calls.push("render"), {
    runMutation: async () => {
      calls.push("mutate");
      return result;
    },
    refreshProgressText: "Refreshing resources...",
    loadData: async () => {
      calls.push("reload");
      return [{ id: "resource-1" }];
    },
    onSuccess: async (receivedResult) => {
      calls.push(`success:${receivedResult === result}`);
    },
  });

  assert.equal(succeeded, true);
  assert.equal(pageState.writeState, "idle");
  assert.equal(calls[0], "sync-begin");
  assert.ok(calls.indexOf("mutate") < calls.indexOf("reload"));
  assert.ok(calls.includes("progress:Refreshing resources..."));
  assert.ok(calls.indexOf("reload") < calls.indexOf("success:true"));
  assert.ok(calls.indexOf("sync-complete") < calls.indexOf("success:true"));
  assert.ok(calls.filter((call) => call === "progress-clear").length >= 1);
});
