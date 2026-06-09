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

function metadataRecord(overrides = {}) {
  return {
    id: expectedQaList.qaListId,
    repoName: expectedQaList.remoteRepo.name,
    fullName: expectedQaList.remoteRepo.fullName,
    githubRepoId: expectedQaList.remoteRepo.repoId,
    title: expectedQaList.title,
    recordState: "live",
    language: expectedQaList.language,
    ...overrides,
  };
}

function verifierOperations(overrides = {}) {
  return {
    listLocalQaListsForTeam: async () => [localQaList()],
    listRemoteQaListReposForTeam: async () => [remoteRepo()],
    refreshQaListMetadataRecords: async () => [metadataRecord()],
    inspectAndMigrateLocalRepoBindings: async () => ({ issues: [] }),
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

test("verifyImportedQaListState rejects a remote QA list repo with a mismatched GitHub repo id", async () => {
  await assert.rejects(
    verifyImportedQaListState(team, expectedQaList, verifierOperations({
      listRemoteQaListReposForTeam: async () => [remoteRepo({ repoId: 99999 })],
    })),
    /remote QA list repo id does not match/,
  );
});

test("verifyImportedQaListState rejects a remote QA list repo with a mismatched full name", async () => {
  await assert.rejects(
    verifyImportedQaListState(team, expectedQaList, verifierOperations({
      listRemoteQaListReposForTeam: async () => [remoteRepo({ fullName: "gnosis-vn/other-qa-list" })],
    })),
    /remote QA list repo full name does not match/,
  );
});

test("verifyImportedQaListState rejects a missing team metadata record", async () => {
  await assert.rejects(
    verifyImportedQaListState(team, expectedQaList, verifierOperations({
      refreshQaListMetadataRecords: async () => [],
    })),
    /team metadata record could not be found/,
  );
});

test("verifyImportedQaListState rejects a team metadata record with a mismatched language", async () => {
  await assert.rejects(
    verifyImportedQaListState(team, expectedQaList, verifierOperations({
      refreshQaListMetadataRecords: async () => [metadataRecord({ language: { code: "es", name: "Spanish" } })],
    })),
    /team metadata language does not match/,
  );
});

test("verifyImportedQaListState rejects a team metadata record with a mismatched GitHub repo id", async () => {
  await assert.rejects(
    verifyImportedQaListState(team, expectedQaList, verifierOperations({
      refreshQaListMetadataRecords: async () => [metadataRecord({ githubRepoId: 99999 })],
    })),
    /team metadata record has a different GitHub repo id/,
  );
});

test("verifyImportedQaListState rejects a team metadata record with a mismatched full name", async () => {
  await assert.rejects(
    verifyImportedQaListState(team, expectedQaList, verifierOperations({
      refreshQaListMetadataRecords: async () => [metadataRecord({ fullName: "gnosis-vn/other-qa-list" })],
    })),
    /team metadata record points at a different GitHub repo/,
  );
});

test("verifyImportedQaListState rejects an imported QA list with a matching local repo repair issue", async () => {
  await assert.rejects(
    verifyImportedQaListState(team, expectedQaList, verifierOperations({
      inspectAndMigrateLocalRepoBindings: async () => ({
        issues: [{
          kind: "qaList",
          issueType: "strayLocalRepo",
          resourceId: expectedQaList.qaListId,
          repoName: expectedQaList.repoName,
          message: "This local QA list repo has no matching team-metadata record.",
        }],
      }),
    })),
    /no matching team-metadata record/,
  );
});
