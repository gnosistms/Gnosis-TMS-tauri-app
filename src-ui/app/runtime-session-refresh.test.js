import test from "node:test";
import assert from "node:assert/strict";

let invokeHandler = async () => null;

globalThis.document = globalThis.document ?? {
  querySelector: () => null,
  querySelectorAll: () => [],
};
globalThis.window = globalThis.window ?? {
  requestAnimationFrame: (callback) => setTimeout(callback, 0),
  setTimeout,
  clearTimeout,
};
globalThis.window.__TAURI__ = {
  core: {
    invoke: (command, payload) => invokeHandler(command, payload),
  },
};

const { invoke } = await import("./runtime.js");
const { resetSessionState, state } = await import("./state.js");

test.beforeEach(() => {
  state.auth.session = { sessionToken: "stale-token", login: "owner" };
  state.credentialStorage = { mode: "persistent", message: "" };
});

test.afterEach(() => {
  resetSessionState();
  invokeHandler = async () => null;
});

test("a connectivity-failed refresh rethrows the original error, not AUTH_REQUIRED", async () => {
  invokeHandler = async (command) => {
    if (command === "refresh_broker_auth_session") {
      throw new Error("Failed to fetch");
    }
    throw new Error("GitHub API 401: Bad credentials");
  };

  await assert.rejects(
    () => invoke("list_gnosis_resources_for_installation", { installationId: 1, sessionToken: "tok" }),
    /Bad credentials/,
  );
});

test("a rejected refresh raises AUTH_REQUIRED", async () => {
  invokeHandler = async (command) => {
    if (command === "refresh_broker_auth_session") {
      throw new Error("Unauthorized");
    }
    throw new Error("GitHub API 401: Bad credentials");
  };

  await assert.rejects(
    () => invoke("list_gnosis_resources_for_installation", { installationId: 1, sessionToken: "tok" }),
    /^Error: AUTH_REQUIRED:/,
  );
});

test("a successful refresh retries the command with the new session token", async () => {
  const calls = [];
  invokeHandler = async (command, payload) => {
    calls.push({ command, payload });
    if (command === "refresh_broker_auth_session") {
      return { sessionToken: "fresh-token", login: "owner" };
    }
    if (command === "save_broker_auth_session") {
      return null;
    }
    if (payload?.sessionToken === "stale-token") {
      throw new Error("GitHub API 401: Bad credentials");
    }
    return { ok: true };
  };

  const result = await invoke("list_gnosis_resources_for_installation", {
    installationId: 1,
    sessionToken: "stale-token",
  });

  assert.deepEqual(result, { ok: true });
  const retried = calls.at(-1);
  assert.equal(retried.command, "list_gnosis_resources_for_installation");
  assert.equal(retried.payload.sessionToken, "fresh-token");
});

test("a Git transport credential rejection refreshes the broker session and retries", async () => {
  const calls = [];
  invokeHandler = async (command, payload) => {
    calls.push({ command, payload });
    if (command === "refresh_broker_auth_session") {
      return { sessionToken: "fresh-token", login: "owner" };
    }
    if (command === "save_broker_auth_session") {
      return null;
    }
    if (payload?.sessionToken === "stale-token") {
      throw new Error(
        "git fetch origin main failed: fatal: could not read Username for 'https://github.com': terminal prompts disabled",
      );
    }
    return { ok: true };
  };

  const result = await invoke("sync_gtms_project_editor_repo", {
    input: { projectId: "project" },
    sessionToken: "stale-token",
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(calls.filter((entry) => entry.command === "refresh_broker_auth_session").length, 1);
  const retried = calls.at(-1);
  assert.equal(retried.command, "sync_gtms_project_editor_repo");
  assert.equal(retried.payload.sessionToken, "fresh-token");
});

test("a failed command retry stops after one refresh and surfaces the final error", async () => {
  const calls = [];
  invokeHandler = async (command, payload) => {
    calls.push({ command, payload });
    if (command === "refresh_broker_auth_session") {
      return { sessionToken: "fresh-token", login: "owner" };
    }
    if (command === "save_broker_auth_session") {
      return null;
    }
    throw new Error(
      payload?.sessionToken === "fresh-token"
        ? "git fetch origin main failed: fatal: Authentication failed for 'https://github.com/org/repo.git/'"
        : "git fetch origin main failed: fatal: could not read Username for 'https://github.com': terminal prompts disabled",
    );
  };

  await assert.rejects(
    () => invoke("sync_gtms_project_editor_repo", {
      input: { projectId: "project" },
      sessionToken: "stale-token",
    }),
    /Authentication failed/,
  );

  assert.equal(calls.filter((entry) => entry.command === "refresh_broker_auth_session").length, 1);
  assert.equal(calls.filter((entry) => entry.command === "sync_gtms_project_editor_repo").length, 2);
});


test("a refresh arriving after sign-out never saves or restores the session", async () => {
  let resolveRefresh;
  const deferred = new Promise((resolve) => { resolveRefresh = resolve; });
  const calls = [];
  invokeHandler = async (command) => {
    calls.push(command);
    if (command === "refresh_broker_auth_session") return deferred;
    throw new Error("GitHub API 401: Bad credentials");
  };
  const request = invoke("list_gnosis_resources_for_installation", { sessionToken: "stale-token" });
  await new Promise((resolve) => setImmediate(resolve));
  state.auth.session = null;
  resolveRefresh({ sessionToken: "late-token", login: "owner" });
  await assert.rejects(request, /AUTH_REQUIRED/);
  assert.equal(state.auth.session, null);
  assert.equal(calls.includes("save_broker_auth_session"), false);
});

test("a failed refresh save stays visible and does not activate an unsaved token", async () => {
  invokeHandler = async (command, payload) => {
    if (command === "refresh_broker_auth_session") return { sessionToken: "new-token", login: "owner" };
    if (command === "save_broker_auth_session") {
      assert.equal(payload.expectedSessionToken, "stale-token");
      throw new Error("Could not write encrypted credentials.");
    }
    throw new Error("GitHub API 401: Bad credentials");
  };
  await assert.rejects(invoke("list_gnosis_resources_for_installation", { sessionToken: "stale-token" }), /Could not write encrypted/);
  assert.equal(state.auth.session.sessionToken, "stale-token");
  assert.equal(state.credentialStorage.mode, "locked");
});
