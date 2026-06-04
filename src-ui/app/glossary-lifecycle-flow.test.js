import test from "node:test";
import assert from "node:assert/strict";

let invokeHandler = async () => null;

globalThis.document = {
  querySelector() {
    return null;
  },
};

globalThis.window = {
  __TAURI__: {
    core: {
      invoke: (command, payload) => invokeHandler(command, payload),
    },
  },
  addEventListener() {},
  removeEventListener() {},
  requestAnimationFrame(callback) {
    return setTimeout(callback, 0);
  },
  setTimeout,
  clearTimeout,
};

const { createResourcePageState } = await import("./resource-page-controller.js");
const { deleteGlossary } = await import("./glossary-lifecycle-flow.js");
const {
  createGlossariesQuerySnapshot,
  resetGlossariesQueryObserver,
} = await import("./glossary-query.js");
const { glossaryKeys, queryClient } = await import("./query-client.js");
const { resetSessionState, state } = await import("./state.js");

function flushAsyncWork() {
  return new Promise((resolve) => setImmediate(resolve));
}

function setupGlossaryLifecycleState({ showDeletedGlossaries = false, includeDeletedGlossary = false } = {}) {
  resetSessionState();
  const team = {
    id: "team-1",
    name: "Team 1",
    githubOrg: "team-1",
    installationId: 1,
    canManageProjects: true,
    canDelete: true,
  };
  const glossary = {
    id: "glossary-1",
    repoName: "gnosis-es-vi",
    title: "Gnosis ES-VI",
    lifecycleState: "active",
    sourceLanguage: { code: "es", name: "Spanish" },
    targetLanguage: { code: "vi", name: "Vietnamese" },
    termCount: 1,
  };

  state.teams = [team];
  state.selectedTeamId = team.id;
  state.auth.session = { sessionToken: "token" };
  state.glossariesPage = createResourcePageState();
  state.glossaries = [
    glossary,
    ...(includeDeletedGlossary
      ? [{
          ...glossary,
          id: "deleted-glossary",
          repoName: "deleted-glossary",
          title: "Deleted Glossary",
          lifecycleState: "deleted",
        }]
      : []),
  ];
  state.showDeletedGlossaries = showDeletedGlossaries;
  queryClient.setQueryData(
    glossaryKeys.byTeam(team.id),
    createGlossariesQuerySnapshot({ glossaries: state.glossaries }),
  );
}

test.afterEach(() => {
  resetGlossariesQueryObserver();
  queryClient.clear();
  invokeHandler = async () => null;
  resetSessionState();
});

test("soft-deleting a glossary does not open a closed deleted glossaries section", async () => {
  setupGlossaryLifecycleState({ showDeletedGlossaries: false });

  await deleteGlossary(() => {}, "glossary-1");
  await flushAsyncWork();

  assert.equal(state.glossaries[0].lifecycleState, "deleted");
  assert.equal(state.showDeletedGlossaries, false);
});

test("soft-deleting a glossary preserves a visible and already-open deleted glossaries section", async () => {
  setupGlossaryLifecycleState({ showDeletedGlossaries: true, includeDeletedGlossary: true });

  await deleteGlossary(() => {}, "glossary-1");
  await flushAsyncWork();

  assert.equal(state.glossaries.find((item) => item.id === "glossary-1").lifecycleState, "deleted");
  assert.equal(state.showDeletedGlossaries, true);
});

test("soft-deleting a glossary closes a stale open flag when the deleted section is not visible", async () => {
  setupGlossaryLifecycleState({ showDeletedGlossaries: true });

  await deleteGlossary(() => {}, "glossary-1");
  await flushAsyncWork();

  assert.equal(state.glossaries[0].lifecycleState, "deleted");
  assert.equal(state.showDeletedGlossaries, false);
});

test("soft-deleting a glossary writes deleted lifecycle metadata", async () => {
  setupGlossaryLifecycleState();
  const metadataWrites = [];
  invokeHandler = async (command, payload) => {
    if (command === "upsert_local_gnosis_glossary_metadata_record") {
      metadataWrites.push(payload.input);
      return { commitCreated: true };
    }
    if (command === "lookup_local_team_metadata_tombstone") {
      return null;
    }
    return {};
  };

  await deleteGlossary(() => {}, "glossary-1");
  await flushAsyncWork();

  assert.equal(metadataWrites.length, 1);
  assert.equal(metadataWrites[0].glossaryId, "glossary-1");
  assert.equal(metadataWrites[0].lifecycleState, "deleted");
});

test("soft-deleting a repo-backed glossary triggers a repo sync", async () => {
  setupGlossaryLifecycleState();
  state.glossaries[0] = {
    ...state.glossaries[0],
    fullName: "team-1/gnosis-es-vi",
    repoId: 123,
    defaultBranchName: "main",
    defaultBranchHeadOid: "abc123",
  };
  queryClient.setQueryData(
    glossaryKeys.byTeam(state.selectedTeamId),
    createGlossariesQuerySnapshot({ glossaries: state.glossaries }),
  );
  const syncInputs = [];
  invokeHandler = async (command, payload) => {
    if (command === "lookup_local_team_metadata_tombstone") {
      return null;
    }
    if (command === "sync_gtms_glossary_repos") {
      syncInputs.push(payload.input);
      return [];
    }
    if (command === "soft_delete_gtms_glossary") {
      return {
        ...state.glossaries[0],
        lifecycleState: "deleted",
      };
    }
    return { commitCreated: true };
  };

  await deleteGlossary(() => {}, "glossary-1");
  await flushAsyncWork();

  assert.equal(syncInputs.length, 1);
  assert.equal(syncInputs[0].installationId, 1);
  assert.equal(syncInputs[0].glossaries.length, 1);
  assert.equal(syncInputs[0].glossaries[0].glossaryId, "glossary-1");
  assert.equal(syncInputs[0].glossaries[0].repoName, "gnosis-es-vi");
  assert.equal(syncInputs[0].glossaries[0].fullName, "team-1/gnosis-es-vi");
  assert.equal(syncInputs[0].glossaries[0].repoId, 123);
  assert.equal(syncInputs[0].glossaries[0].defaultBranchName, "main");
  assert.equal(syncInputs[0].glossaries[0].defaultBranchHeadOid, "abc123");
});
