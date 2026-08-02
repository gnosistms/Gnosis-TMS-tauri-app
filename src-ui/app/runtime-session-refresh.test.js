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
const { resetSessionState } = await import("./state.js");

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
