import test from "node:test";
import assert from "node:assert/strict";

globalThis.document = globalThis.document ?? {
  querySelector: () => null,
};

const invokeEvents = [];
let releaseProjectWrite = null;

globalThis.window = {
  __TAURI__: {
    core: {
      invoke: async (command) => {
        invokeEvents.push(command);
        if (command === "upsert_local_gnosis_project_metadata_record") {
          return new Promise((resolve) => {
            releaseProjectWrite = resolve;
          });
        }
        return { commitCreated: true };
      },
    },
  },
  setTimeout: (callback) => {
    callback();
    return 1;
  },
  clearTimeout() {},
};

const { resetSessionState, state } = await import("./state.js");
const {
  upsertGlossaryMetadataRecord,
  upsertProjectMetadataRecord,
} = await import("./team-metadata-flow.js");

function team(overrides = {}) {
  return {
    id: "team-1",
    installationId: 1,
    githubOrg: "gnosis",
    ...overrides,
  };
}

function projectRecord(overrides = {}) {
  return {
    projectId: "project-1",
    title: "Project",
    repoName: "project",
    ...overrides,
  };
}

function glossaryRecord(overrides = {}) {
  return {
    glossaryId: "glossary-1",
    title: "Glossary",
    repoName: "glossary",
    ...overrides,
  };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

async function waitFor(condition) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
  }
}

test.beforeEach(() => {
  invokeEvents.length = 0;
  releaseProjectWrite = null;
  resetSessionState();
  state.auth.session = { sessionToken: "session-token" };
});

test("team metadata writes for the same installation are serialized across resource types", async () => {
  const currentTeam = team();
  const projectWrite = upsertProjectMetadataRecord(currentTeam, projectRecord(), {
    requirePushSuccess: true,
  });

  await waitFor(() => releaseProjectWrite instanceof Function);
  assert.equal(releaseProjectWrite instanceof Function, true);

  const glossaryWrite = upsertGlossaryMetadataRecord(currentTeam, glossaryRecord(), {
    requirePushSuccess: true,
  });
  await flushMicrotasks();

  assert.equal(
    invokeEvents.includes("upsert_local_gnosis_glossary_metadata_record"),
    false,
  );

  releaseProjectWrite({ commitCreated: true });
  await projectWrite;
  await glossaryWrite;

  assert.deepEqual(
    invokeEvents.filter((command) =>
      command === "upsert_local_gnosis_project_metadata_record"
      || command === "upsert_local_gnosis_glossary_metadata_record"
    ),
    [
      "upsert_local_gnosis_project_metadata_record",
      "upsert_local_gnosis_glossary_metadata_record",
    ],
  );
});
