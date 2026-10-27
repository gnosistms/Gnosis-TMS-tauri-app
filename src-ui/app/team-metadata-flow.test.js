import test from "node:test";
import assert from "node:assert/strict";

globalThis.document = globalThis.document ?? {
  querySelector: () => null,
};

const invokeEvents = [];
const invokePayloads = [];
let releaseProjectWrite = null;
let invokeHandler = null;

globalThis.window = {
  __TAURI__: {
    core: {
      invoke: async (command, payload) => {
        invokeEvents.push(command);
        invokePayloads.push({ command, payload });
        if (typeof invokeHandler === "function") {
          return invokeHandler(command, payload);
        }
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
const { queryClient } = await import("./query-client.js");
const {
  listProjectMetadataRecords,
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
  invokePayloads.length = 0;
  releaseProjectWrite = null;
  invokeHandler = null;
  resetSessionState();
  state.auth.session = { sessionToken: "session-token" };
});

test.afterEach(() => {
  queryClient.clear();
});

test("shared metadata sync handles an early rejection while the local read is pending", async () => {
  let releaseLocalRead = null;
  invokeHandler = async (command) => {
    if (command === "sync_local_team_metadata_repo") {
      throw new Error("metadata sync failed");
    }
    if (command === "list_local_gnosis_project_metadata_records") {
      return new Promise((resolve) => {
        releaseLocalRead = resolve;
      });
    }
    return null;
  };

  const unhandled = [];
  const onUnhandledRejection = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandledRejection);
  try {
    const recordsPromise = listProjectMetadataRecords(team({ installationId: 77 }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, []);

    releaseLocalRead([]);
    assert.deepEqual(await recordsPromise, []);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandledRejection);
  }
});

test("project metadata writes forward an authoritative chapter count", async () => {
  const projectWrite = upsertProjectMetadataRecord(
    team(),
    projectRecord({ chapterCount: 7 }),
    { requirePushSuccess: true },
  );

  await waitFor(() => releaseProjectWrite instanceof Function);
  const event = invokePayloads.find(
    ({ command }) => command === "upsert_local_gnosis_project_metadata_record",
  );
  assert.equal(event.payload.input.chapterCount, 7);

  releaseProjectWrite({ commitCreated: true });
  await projectWrite;
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
