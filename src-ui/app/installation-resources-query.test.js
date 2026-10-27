import test from "node:test";
import assert from "node:assert/strict";

const invokeLog = [];
let invokeHandler = async () => ({ projects: [], glossaries: [], qaLists: [] });

globalThis.document = globalThis.document ?? {
  querySelector: () => null,
  querySelectorAll: () => [],
};
globalThis.window = {
  __TAURI__: {
    core: {
      invoke(command, payload = {}) {
        invokeLog.push({ command, payload });
        return invokeHandler(command, payload);
      },
    },
  },
  requestAnimationFrame: (callback) => setTimeout(callback, 0),
  setTimeout,
  clearTimeout,
};

const { resetSessionState, state } = await import("./state.js");
const {
  listRemoteProjectsForInstallation,
} = await import("./installation-resources-query.js");
const { installationResourceKeys, queryClient } = await import("./query-client.js");

test.afterEach(() => {
  queryClient.clear();
  resetSessionState();
  invokeLog.length = 0;
  invokeHandler = async () => ({ projects: [], glossaries: [], qaLists: [] });
});

test("signed-out resource listing follows AUTH_REQUIRED without creating a failed query", async () => {
  resetSessionState();

  await assert.rejects(
    () => listRemoteProjectsForInstallation(42),
    /^Error: AUTH_REQUIRED:Sign in with GitHub/,
  );

  assert.equal(invokeLog.length, 0);
  assert.equal(
    queryClient.getQueryCache().find({
      queryKey: installationResourceKeys.byInstallation(42),
      exact: true,
    }),
    undefined,
  );
});

test("resource listing still passes an active session through the runtime", async () => {
  state.auth = {
    ...state.auth,
    status: "success",
    session: { sessionToken: "broker-session", login: "owner" },
  };
  invokeHandler = async () => ({
    projects: [{ id: "project-1" }],
    glossaries: [],
    qaLists: [],
  });

  const projects = await listRemoteProjectsForInstallation(42);

  assert.deepEqual(projects, [{ id: "project-1" }]);
  assert.deepEqual(invokeLog, [{
    command: "list_gnosis_resources_for_installation",
    payload: { installationId: 42, sessionToken: "broker-session" },
  }]);
});
