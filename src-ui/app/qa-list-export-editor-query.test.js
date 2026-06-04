import test from "node:test";
import assert from "node:assert/strict";

const invokeCalls = [];

globalThis.document = {
  querySelector() {
    return null;
  },
};
globalThis.window = {
  __TAURI__: {
    core: {
      invoke: async (command, payload) => {
        invokeCalls.push([command, payload]);
        return {
          id: "qa-list-from-payload",
          repoName: "server-qa-list",
        };
      },
    },
  },
  __TAURI_INTERNALS__: null,
  addEventListener() {},
  open() {},
  requestAnimationFrame(callback) {
    callback();
  },
  setTimeout() {
    return 1;
  },
  clearTimeout() {},
};

const { resetSessionState, state } = await import("./state.js");
const { downloadQaListAsTmx } = await import("./qa-list-export-flow.js");
const {
  createQaListEditorQueryOptions,
  qaListEditorQueryKey,
  setCachedQaListEditorPayload,
  getCachedQaListEditorPayload,
} = await import("./qa-list-editor-query.js");
const { queryClient } = await import("./query-client.js");

function installQaListFixture() {
  resetSessionState();
  invokeCalls.length = 0;
  state.selectedTeamId = "team-1";
  state.teams = [{
    id: "team-1",
    installationId: 42,
  }];
  state.qaLists = [{
    id: "qa-list-1",
    repoName: "gnosis-qa",
    title: "Gnosis QA/List",
  }];
}

test.afterEach(() => {
  queryClient.clear();
  resetSessionState();
  invokeCalls.length = 0;
});

test("downloadQaListAsTmx saves to a selected path and invokes TMX export", async () => {
  installQaListFixture();
  const calls = [];

  await downloadQaListAsTmx(() => {}, "qa-list-1", {
    saveDialog: async (options) => {
      calls.push(["save", options]);
      return "/tmp/Gnosis QA-List.tmx";
    },
    invoke: async (command, payload) => {
      calls.push(["invoke", command, payload]);
    },
  });

  assert.equal(calls[0][0], "save");
  assert.equal(calls[0][1].defaultPath, "Gnosis QA-List.tmx");
  assert.deepEqual(calls[0][1].filters, [{ name: "TMX QA list", extensions: ["tmx"] }]);
  assert.equal(calls[1][1], "export_gtms_qa_list_to_tmx");
  assert.deepEqual(calls[1][2], {
    input: {
      installationId: 42,
      repoName: "gnosis-qa",
      qaListId: "qa-list-1",
      outputPath: "/tmp/Gnosis QA-List.tmx",
    },
  });
});

test("QA list editor query preserves id aliases in loaded and cached payloads", async () => {
  installQaListFixture();
  const team = state.teams[0];
  const qaList = {
    id: "qa-list-1",
    repoName: "gnosis-qa",
    repoId: 7,
    fullName: "org/gnosis-qa",
    defaultBranchName: "main",
  };

  assert.deepEqual(
    qaListEditorQueryKey(team, qaList),
    ["qaListEditor", 42, "qa-list-1", "gnosis-qa"],
  );

  const options = createQaListEditorQueryOptions(team, qaList);
  const payload = await options.queryFn();

  assert.deepEqual(invokeCalls[0], [
    "load_gtms_qa_list_editor_data",
    {
      input: {
        installationId: 42,
        qaListId: "qa-list-1",
        repoName: "gnosis-qa",
      },
    },
  ]);
  assert.equal(payload.qaListId, "qa-list-from-payload");
  assert.equal(payload.id, "qa-list-from-payload");
  assert.equal(payload.repoName, "server-qa-list");
  assert.equal(payload.installationId, 42);

  setCachedQaListEditorPayload(team, qaList, { qaListId: "cached-qa-list" });
  const cached = getCachedQaListEditorPayload(team, qaList);
  assert.equal(cached.qaListId, "cached-qa-list");
  assert.equal(cached.id, "cached-qa-list");
  assert.equal(cached.repoName, "gnosis-qa");
});
