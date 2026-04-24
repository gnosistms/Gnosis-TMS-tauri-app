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

const { verifyImportedGlossaryState } = await import("./glossary-import-flow.js");

const team = {
  id: "team-1",
  installationId: 1,
  githubOrg: "Gnosis VN",
};

const expectedGlossary = {
  glossaryId: "8e11a58c-57e3-44cd-a2d8-c9ea747044a4",
  repoName: "gnosis-es-vi",
  remoteRepo: {
    name: "gnosis-es-vi",
    fullName: "gnosis-vn/gnosis-es-vi",
    repoId: 12345,
  },
  title: "Gnosis ES-VI",
  sourceLanguage: {
    code: "es",
    name: "Spanish",
  },
  targetLanguage: {
    code: "vi",
    name: "Vietnamese",
  },
  termCount: 7,
};

function localSummary(overrides = {}) {
  return {
    glossaryId: expectedGlossary.glossaryId,
    repoName: expectedGlossary.repoName,
    title: expectedGlossary.title,
    lifecycleState: "active",
    sourceLanguage: expectedGlossary.sourceLanguage,
    targetLanguage: expectedGlossary.targetLanguage,
    termCount: expectedGlossary.termCount,
    ...overrides,
  };
}

function remoteRepo(overrides = {}) {
  return {
    name: expectedGlossary.remoteRepo.name,
    fullName: expectedGlossary.remoteRepo.fullName,
    repoId: expectedGlossary.remoteRepo.repoId,
    ...overrides,
  };
}

function metadataRecord(overrides = {}) {
  return {
    id: expectedGlossary.glossaryId,
    repoName: expectedGlossary.remoteRepo.name,
    fullName: expectedGlossary.remoteRepo.fullName,
    githubRepoId: expectedGlossary.remoteRepo.repoId,
    title: expectedGlossary.title,
    recordState: "live",
    sourceLanguage: expectedGlossary.sourceLanguage,
    targetLanguage: expectedGlossary.targetLanguage,
    ...overrides,
  };
}

function verifierOperations(overrides = {}) {
  return {
    listLocalGlossarySummariesForTeam: async () => [localSummary()],
    listRemoteGlossaryReposForTeam: async () => [remoteRepo()],
    refreshGlossaryMetadataRecords: async () => [metadataRecord()],
    inspectAndMigrateLocalRepoBindings: async () => ({ issues: [] }),
    ...overrides,
  };
}

test("verifyImportedGlossaryState accepts a matching local repo, remote repo, metadata record, and clean repair scan", async () => {
  await verifyImportedGlossaryState(team, expectedGlossary, verifierOperations());
});

test("verifyImportedGlossaryState rejects a missing team metadata record", async () => {
  await assert.rejects(
    verifyImportedGlossaryState(team, expectedGlossary, verifierOperations({
      refreshGlossaryMetadataRecords: async () => [],
    })),
    /team metadata record could not be found/,
  );
});

test("verifyImportedGlossaryState rejects a missing remote glossary repo", async () => {
  await assert.rejects(
    verifyImportedGlossaryState(team, expectedGlossary, verifierOperations({
      listRemoteGlossaryReposForTeam: async () => [],
    })),
    /remote glossary repo could not be found/,
  );
});

test("verifyImportedGlossaryState rejects a remote glossary repo with a mismatched GitHub repo id", async () => {
  await assert.rejects(
    verifyImportedGlossaryState(team, expectedGlossary, verifierOperations({
      listRemoteGlossaryReposForTeam: async () => [remoteRepo({ repoId: 99999 })],
    })),
    /remote glossary repo id does not match/,
  );
});

test("verifyImportedGlossaryState rejects an imported glossary with a matching local repo repair issue", async () => {
  await assert.rejects(
    verifyImportedGlossaryState(team, expectedGlossary, verifierOperations({
      inspectAndMigrateLocalRepoBindings: async () => ({
        issues: [{
          kind: "glossary",
          type: "strayLocalRepo",
          resourceId: expectedGlossary.glossaryId,
          repoName: expectedGlossary.repoName,
          message: "This local glossary repo has no matching team-metadata record.",
        }],
      }),
    })),
    /no matching team-metadata record/,
  );
});
