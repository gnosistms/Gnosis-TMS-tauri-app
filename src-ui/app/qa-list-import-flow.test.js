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

const { verifyImportedQaListState } = await import("./qa-list-import-flow.js");

const team = {
  id: "team-1",
  installationId: 1,
  githubOrg: "Gnosis VN",
};

const expectedQaList = {
  qaListId: "8e11a58c-57e3-44cd-a2d8-c9ea747044a4",
  repoName: "gnosis-qa-vi",
  remoteRepo: {
    name: "gnosis-qa-vi",
    fullName: "gnosis-vn/gnosis-qa-vi",
    repoId: 12345,
  },
  title: "Gnosis QA VI",
  language: {
    code: "vi",
    name: "Vietnamese",
  },
  termCount: 7,
};

function localQaList(overrides = {}) {
  return {
    qaListId: expectedQaList.qaListId,
    id: expectedQaList.qaListId,
    repoName: expectedQaList.repoName,
    title: expectedQaList.title,
    lifecycleState: "active",
    language: expectedQaList.language,
    termCount: expectedQaList.termCount,
    ...overrides,
  };
}

function remoteRepo(overrides = {}) {
  return {
    name: expectedQaList.remoteRepo.name,
    fullName: expectedQaList.remoteRepo.fullName,
    repoId: expectedQaList.remoteRepo.repoId,
    ...overrides,
  };
}

function verifierOperations(overrides = {}) {
  return {
    listLocalQaListsForTeam: async () => [localQaList()],
    listRemoteQaListReposForTeam: async () => [remoteRepo()],
    ...overrides,
  };
}

test("verifyImportedQaListState accepts a matching local repo and remote repo", async () => {
  await verifyImportedQaListState(team, expectedQaList, verifierOperations());
});

test("verifyImportedQaListState rejects a missing local QA list repo", async () => {
  await assert.rejects(
    verifyImportedQaListState(team, expectedQaList, verifierOperations({
      listLocalQaListsForTeam: async () => [],
    })),
    /local QA list repo could not be found/,
  );
});

test("verifyImportedQaListState rejects a local QA list with a mismatched language", async () => {
  await assert.rejects(
    verifyImportedQaListState(team, expectedQaList, verifierOperations({
      listLocalQaListsForTeam: async () => [
        localQaList({ language: { code: "es", name: "Spanish" } }),
      ],
    })),
    /local QA list language does not match/,
  );
});

test("verifyImportedQaListState rejects a local QA list with a mismatched term count", async () => {
  await assert.rejects(
    verifyImportedQaListState(team, expectedQaList, verifierOperations({
      listLocalQaListsForTeam: async () => [localQaList({ termCount: 999 })],
    })),
    /local QA list term count does not match/,
  );
});

test("verifyImportedQaListState rejects a missing remote QA list repo", async () => {
  await assert.rejects(
    verifyImportedQaListState(team, expectedQaList, verifierOperations({
      listRemoteQaListReposForTeam: async () => [],
    })),
    /remote QA list repo could not be found/,
  );
});

test("verifyImportedQaListState rejects a remote QA list repo with a mismatched name", async () => {
  await assert.rejects(
    verifyImportedQaListState(team, expectedQaList, verifierOperations({
      listRemoteQaListReposForTeam: async () => [remoteRepo({ name: "other-qa-list" })],
    })),
    /remote QA list repo name does not match/,
  );
});
