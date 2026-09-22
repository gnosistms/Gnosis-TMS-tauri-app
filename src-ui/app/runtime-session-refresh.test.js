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
});

test.afterEach(() => {
  resetSessionState();
  invokeHandler = async () => null;
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

for (const change of ["sign-out", "account-switch", "sign-out-and-same-account"]) {
  test(`a delayed refresh cannot undo ${change}`, async () => {
    const refresh = deferred();
    const started = deferred();
    const calls = [];
    invokeHandler = async (command, payload) => {
      calls.push({ command, payload });
      if (command === "refresh_broker_auth_session") {
        started.resolve();
        return refresh.promise;
      }
      throw new Error("GitHub API 401: Bad credentials");
    };
    const request = invoke("list_gnosis_resources_for_installation", { sessionToken: "stale-token" });
    const rejected = assert.rejects(request, { code: "AUTH_SESSION_CHANGED" });
    await started.promise;
    resetSessionState();
    if (change === "account-switch") {
      state.auth.session = { sessionToken: "bob-token", login: "bob" };
    } else if (change === "sign-out-and-same-account") {
      state.auth.session = { sessionToken: "stale-token", login: "owner" };
    }
    const expectedSession = state.auth.session;
    refresh.resolve({ sessionToken: "fresh-token", login: "owner" });
    await rejected;
    assert.equal(state.auth.session, expectedSession);
    assert.equal(calls.some(({ command }) => command === "save_broker_auth_session"), false);
    assert.equal(calls.filter(({ command }) => command === "list_gnosis_resources_for_installation").length, 1);
  });
}

test("a late refresh rejection cannot expire a different login", async () => {
  const refresh = deferred();
  const started = deferred();
  invokeHandler = async (command) => {
    if (command === "refresh_broker_auth_session") {
      started.resolve();
      return refresh.promise;
    }
    throw new Error("GitHub API 401: Bad credentials");
  };
  const request = invoke("list_gnosis_resources_for_installation", { sessionToken: "stale-token" });
  const rejected = assert.rejects(request, { code: "AUTH_SESSION_CHANGED" });
  await started.promise;
  resetSessionState();
  state.auth.session = { sessionToken: "bob-token", login: "bob" };
  refresh.reject(new Error("Unauthorized"));
  await rejected;
  assert.equal(state.auth.session.login, "bob");
});

test("refresh persistence failure preserves the old session and does not retry or require login", async () => {
  const oldSession = state.auth.session;
  let requestCount = 0;
  invokeHandler = async (command, payload) => {
    if (command === "refresh_broker_auth_session") {
      return { sessionToken: "fresh-token", login: "owner" };
    }
    if (command === "save_broker_auth_session") {
      assert.equal(payload.expectedSessionToken, "stale-token");
      assert.equal(state.auth.session, oldSession);
      throw new Error("Disk full");
    }
    requestCount += 1;
    throw new Error("GitHub API 401: Bad credentials");
  };
  await assert.rejects(
    invoke("list_gnosis_resources_for_installation", { sessionToken: "stale-token" }),
    { code: "AUTH_STORAGE_FAILED", message: /Could not save/ },
  );
  assert.equal(state.auth.session, oldSession);
  assert.equal(requestCount, 1);
});

test("sign-out while a native refresh save is pending cannot restore memory or retry", async () => {
  const save = deferred();
  const started = deferred();
  let requestCount = 0;
  invokeHandler = async (command) => {
    if (command === "refresh_broker_auth_session") {
      return { sessionToken: "fresh-token", login: "owner" };
    }
    if (command === "save_broker_auth_session") {
      started.resolve();
      return save.promise;
    }
    requestCount += 1;
    throw new Error("GitHub API 401: Bad credentials");
  };
  const request = invoke("list_gnosis_resources_for_installation", { sessionToken: "stale-token" });
  const rejected = assert.rejects(request, { code: "AUTH_SESSION_CHANGED" });
  await started.promise;
  resetSessionState();
  save.resolve();
  await rejected;
  assert.equal(state.auth.session, null);
  assert.equal(requestCount, 1);
});

test("a new account never shares the old account's pending refresh", async () => {
  const oldRefresh = deferred();
  const started = deferred();
  const refreshTokens = [];
  invokeHandler = async (command, payload) => {
    if (command === "refresh_broker_auth_session") {
      refreshTokens.push(payload.sessionToken);
      if (payload.sessionToken === "stale-token") {
        started.resolve();
        return oldRefresh.promise;
      }
      return { sessionToken: "bob-fresh", login: "bob" };
    }
    if (command === "save_broker_auth_session" || payload.sessionToken === "bob-fresh") {
      return true;
    }
    throw new Error("GitHub API 401: Bad credentials");
  };
  const oldRequest = invoke("list_gnosis_resources_for_installation", { sessionToken: "stale-token" });
  const rejected = assert.rejects(oldRequest, { code: "AUTH_SESSION_CHANGED" });
  await started.promise;
  resetSessionState();
  state.auth.session = { sessionToken: "bob-token", login: "bob" };
  assert.equal(await invoke("list_gnosis_resources_for_installation", { sessionToken: "bob-token" }), true);
  oldRefresh.resolve({ sessionToken: "old-fresh", login: "owner" });
  await rejected;
  assert.deepEqual(refreshTokens, ["stale-token", "bob-token"]);
  assert.equal(state.auth.session.sessionToken, "bob-fresh");
});

test("concurrent requests for the same login share one refresh", async () => {
  const refresh = deferred();
  const started = deferred();
  let refreshCount = 0;
  let saveCount = 0;
  invokeHandler = async (command, payload) => {
    if (command === "refresh_broker_auth_session") {
      refreshCount += 1;
      started.resolve();
      return refresh.promise;
    }
    if (command === "save_broker_auth_session") { saveCount += 1; return; }
    if (payload.sessionToken === "stale-token") throw new Error("GitHub API 401: Bad credentials");
    return payload.sessionToken;
  };
  const first = invoke("list_gnosis_resources_for_installation", { sessionToken: "stale-token" });
  await started.promise;
  const second = invoke("list_gnosis_resources_for_installation", { sessionToken: "stale-token" });
  await new Promise((resolve) => setImmediate(resolve));
  refresh.resolve({ sessionToken: "fresh-token", login: "owner" });
  assert.deepEqual(await Promise.all([first, second]), ["fresh-token", "fresh-token"]);
  assert.equal(refreshCount, 1);
  assert.equal(saveCount, 1);
  // A slower failure using the old token reuses the completed refresh as well.
  assert.equal(await invoke("list_gnosis_resources_for_installation", { sessionToken: "stale-token" }), "fresh-token");
  assert.equal(refreshCount, 1);
});

test("a request carrying an unrelated token cannot retry under the current account", async () => {
  let calls = 0;
  invokeHandler = async () => { calls += 1; throw new Error("GitHub API 401: Bad credentials"); };
  await assert.rejects(
    invoke("list_gnosis_resources_for_installation", { sessionToken: "other-account-token" }),
    { code: "AUTH_SESSION_CHANGED" },
  );
  assert.equal(calls, 1);
});

test("a connectivity-failed refresh rethrows the original error, not AUTH_REQUIRED", async () => {
  invokeHandler = async (command) => {
    if (command === "refresh_broker_auth_session") {
      throw new Error("Failed to fetch");
    }
    throw new Error("GitHub API 401: Bad credentials");
  };

  await assert.rejects(
    () => invoke("list_gnosis_resources_for_installation", { installationId: 1, sessionToken: "stale-token" }),
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
    () => invoke("list_gnosis_resources_for_installation", { installationId: 1, sessionToken: "stale-token" }),
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

for (const command of ["update_gtms_editor_row_fields", "update_gtms_editor_row_text_style"]) {
  test(`${command} refreshes its native stored session once without a payload token`, async () => {
    let writes = 0;
    let refreshes = 0;
    let nativeToken = "stale-token";
    const payload = { input: { installationId: 42, rowId: "row-1" } };
    invokeHandler = async (name, args) => {
      if (name === "refresh_broker_auth_session") {
        refreshes += 1;
        assert.equal(args.sessionToken, "stale-token");
        return { sessionToken: "fresh-token", login: "owner" };
      }
      if (name === "save_broker_auth_session") {
        nativeToken = args.session.sessionToken;
        return;
      }
      assert.equal(name, command);
      assert.deepEqual(args, payload);
      if (nativeToken === "stale-token") throw new Error("AUTH_REQUIRED:Your GitHub session expired.");
      writes += 1;
      return "saved";
    };
    assert.equal(await invoke(command, payload), "saved");
    assert.equal(refreshes, 1);
    assert.equal(writes, 1);
  });
}

for (const change of ["sign-out", "account-switch", "team-switch"]) {
  test(`native editor recovery cannot replay after ${change}`, async () => {
    const refresh = deferred();
    const started = deferred();
    let attempts = 0;
    state.selectedTeamId = "team-a";
    invokeHandler = async (command) => {
      if (command === "refresh_broker_auth_session") { started.resolve(); return refresh.promise; }
      if (command === "save_broker_auth_session") return;
      attempts += 1;
      throw new Error("AUTH_REQUIRED:Expired");
    };
    const request = invoke("update_gtms_editor_row_fields", { input: { installationId: 42 } });
    const rejected = assert.rejects(request, { code: change === "team-switch" ? "EDITOR_CONTEXT_CHANGED" : "AUTH_SESSION_CHANGED" });
    await started.promise;
    if (change === "team-switch") state.selectedTeamId = "team-b";
    else {
      resetSessionState();
      if (change === "account-switch") state.auth.session = { login: "bob", sessionToken: "bob-token" };
    }
    refresh.resolve({ login: "owner", sessionToken: "fresh-token" });
    await rejected;
    assert.equal(attempts, 1);
  });
}

test("native editor retries stop after one failed recovery attempt", async () => {
  let attempts = 0;
  let refreshes = 0;
  invokeHandler = async (command) => {
    if (command === "refresh_broker_auth_session") { refreshes += 1; return { login: "owner", sessionToken: "fresh-token" }; }
    if (command === "save_broker_auth_session") return;
    attempts += 1;
    throw new Error("AUTH_REQUIRED:Expired");
  };
  await assert.rejects(invoke("update_gtms_editor_row_text_style", { input: {} }), /AUTH_REQUIRED/);
  assert.equal(attempts, 2);
  assert.equal(refreshes, 1);
});

test("unverified access and ambiguous write failures are never blindly retried", async () => {
  for (const message of [
    'ACCESS_VERIFICATION_FAILED:{"category":"snapshot_storage","message":"ignored"}',
    "git commit failed: ambiguous result",
    "Your account type cannot edit shared content.",
  ]) {
    let attempts = 0;
    invokeHandler = async () => { attempts += 1; throw message; };
    await assert.rejects(invoke("update_gtms_editor_row_fields", { input: {} }));
    assert.equal(attempts, 1);
  }
});

test("an unrelated tokenless command cannot acquire editor retry privileges", async () => {
  let attempts = 0;
  invokeHandler = async () => { attempts += 1; throw new Error("AUTH_REQUIRED:Expired"); };
  await assert.rejects(invoke("delete_gnosis_project_repo", {}), /AUTH_REQUIRED/);
  assert.equal(attempts, 1);
});
