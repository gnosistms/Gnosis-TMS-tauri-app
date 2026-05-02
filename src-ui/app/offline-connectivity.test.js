import test from "node:test";
import assert from "node:assert/strict";

const localStorageState = new Map();
let invokeHandler = async () => true;

const fakeApp = {
  addEventListener() {},
  firstElementChild: null,
  innerHTML: "",
};

const fakeDocument = {
  querySelector(selector) {
    return selector === "#app" ? fakeApp : null;
  },
  querySelectorAll() {
    return [];
  },
  addEventListener() {},
  body: {
    append() {},
  },
  documentElement: {
    classList: {
      remove() {},
      toggle() {},
    },
  },
  hidden: false,
};

const fakeLocalStorage = {
  getItem(key) {
    return localStorageState.has(key) ? localStorageState.get(key) : null;
  },
  setItem(key, value) {
    localStorageState.set(key, String(value));
  },
  removeItem(key) {
    localStorageState.delete(key);
  },
  clear() {
    localStorageState.clear();
  },
};

globalThis.document = fakeDocument;
globalThis.navigator = {
  onLine: true,
  platform: "Win32",
  userAgentData: null,
};
globalThis.window = {
  __TAURI__: {
    core: {
      invoke(command, payload = {}) {
        return invokeHandler(command, payload);
      },
    },
  },
  localStorage: fakeLocalStorage,
  navigator: globalThis.navigator,
  requestAnimationFrame(callback) {
    callback();
    return 1;
  },
  setTimeout() {
    return 1;
  },
  clearTimeout() {},
};

const { restoreStoredBrokerSession } = await import("./auth-flow.js");
const { reconnectFromConnectionFailure } = await import("./connection-failure.js");
const { enableOfflineMode, reconnectOnlineMode } = await import("./offline-connectivity.js");
const { renderConnectionFailureModal } = await import("../screens/connection-failure-modal.js");
const { handleSyncFailure } = await import("./sync-recovery.js");
const { resetSessionState, state } = await import("./state.js");
const { saveStoredTeamRecords, setActiveStorageLogin } = await import("./team-storage.js");

test.afterEach(() => {
  invokeHandler = async () => true;
  globalThis.navigator.onLine = true;
  localStorageState.clear();
  resetSessionState();
});

test("enableOfflineMode keeps the current editor screen", () => {
  state.screen = "translate";
  state.selectedTeamId = "team-1";
  state.teams = [{ id: "team-1", accountType: "Organization", githubOrg: "org" }];

  let renderCount = 0;
  enableOfflineMode(() => {
    renderCount += 1;
  });

  assert.equal(state.offline.isEnabled, true);
  assert.equal(state.screen, "translate");
  assert.equal(state.selectedTeamId, "team-1");
  assert.equal(renderCount, 1);
});

test("enableOfflineMode opens teams from the startup screen", () => {
  state.screen = "start";
  state.teams = [{ id: "team-1", accountType: "Organization", githubOrg: "org" }];

  enableOfflineMode(() => {});

  assert.equal(state.offline.isEnabled, true);
  assert.equal(state.screen, "teams");
  assert.equal(state.selectedTeamId, "team-1");
});

test("reconnectOnlineMode asks session restore to preserve the current screen", async () => {
  state.screen = "translate";
  state.offline.isEnabled = true;

  let receivedOptions = null;
  await reconnectOnlineMode(() => {}, async (options) => {
    receivedOptions = options;
  });

  assert.equal(state.offline.isEnabled, false);
  assert.deepEqual(receivedOptions, { preserveCurrentScreen: true });
});

test("restoreStoredBrokerSession preserves editor navigation state when requested", async () => {
  const storedSession = {
    sessionToken: "session-1",
    login: "hans",
  };
  const team = {
    id: "team-1",
    name: "Team One",
    githubOrg: "org",
    accountType: "Organization",
  };
  setActiveStorageLogin(storedSession.login);
  saveStoredTeamRecords([team], storedSession.login);
  state.screen = "translate";
  state.selectedTeamId = team.id;
  state.selectedProjectId = "project-1";
  state.selectedChapterId = "chapter-1";
  state.projects = [{ id: "project-1" }];

  invokeHandler = async (command) => {
    assert.equal(command, "inspect_broker_auth_session");
    return {
      login: storedSession.login,
      name: "Hans",
      avatarUrl: null,
    };
  };
  let loadedTeams = false;
  await restoreStoredBrokerSession(
    () => {},
    () => {
      loadedTeams = true;
    },
    storedSession,
    { preserveCurrentScreen: true },
  );

  assert.equal(state.screen, "translate");
  assert.equal(state.selectedTeamId, team.id);
  assert.equal(state.selectedProjectId, "project-1");
  assert.equal(state.selectedChapterId, "chapter-1");
  assert.deepEqual(state.projects, [{ id: "project-1" }]);
  assert.equal(state.auth.pendingAutoOpenSingleTeam, false);
  assert.equal(loadedTeams, true);
});

test("restoreStoredBrokerSession keeps the saved login when session inspection expires", async () => {
  const storedSession = {
    sessionToken: "session-1",
    login: "hans",
  };
  state.screen = "teams";

  invokeHandler = async (command) => {
    assert.equal(command, "inspect_broker_auth_session");
    throw new Error("AUTH_REQUIRED:Your GitHub session expired.");
  };

  let loadedTeams = false;
  await restoreStoredBrokerSession(
    () => {},
    () => {
      loadedTeams = true;
    },
    storedSession,
  );

  assert.equal(state.screen, "teams");
  assert.deepEqual(state.auth.session, {
    sessionToken: "session-1",
    login: "hans",
  });
  assert.equal(state.auth.status, "success");
  assert.equal(loadedTeams, true);
});

test("handleSyncFailure preserves the local session on auth failures", async () => {
  state.screen = "projects";
  state.auth = {
    status: "success",
    message: "",
    session: {
      sessionToken: "session-1",
      login: "hans",
    },
  };

  let renderCount = 0;
  const handled = await handleSyncFailure(
    {
      type: "auth_invalid",
      message: "AUTH_REQUIRED:Your GitHub session expired.",
    },
    {
      render: () => {
        renderCount += 1;
      },
    },
  );

  assert.equal(handled, true);
  assert.equal(state.screen, "projects");
  assert.deepEqual(state.auth.session, {
    sessionToken: "session-1",
    login: "hans",
  });
  assert.equal(state.auth.status, "expired");
  assert.equal(renderCount, 1);
});

test("connection failure modal uses Reconnect instead of Cancel", () => {
  state.connectionFailure = {
    isOpen: true,
    message: "No internet connection.",
    canGoOffline: true,
    reconnecting: false,
    retryAction: null,
  };

  const html = renderConnectionFailureModal(state);

  assert.match(html, /Reconnect/);
  assert.doesNotMatch(html, /Cancel/);
  assert.match(html, /go-offline-from-connection-failure/);
});

test("connection failure modal shows reconnecting state", () => {
  state.connectionFailure = {
    isOpen: true,
    message: "No internet connection.",
    canGoOffline: true,
    reconnecting: true,
    retryAction: null,
  };

  const html = renderConnectionFailureModal(state);

  assert.match(html, /button__spinner/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /data-action="noop"/);
  assert.match(html, /go-offline-from-connection-failure" disabled/);
});

test("reconnectFromConnectionFailure stays open when the connection is still unavailable", async () => {
  globalThis.navigator.onLine = false;
  invokeHandler = async (command) => {
    assert.equal(command, "check_internet_connection");
    return false;
  };
  state.connectionFailure = {
    isOpen: true,
    message: "Could not connect.",
    canGoOffline: true,
    reconnecting: false,
    retryAction: null,
  };

  let renderCount = 0;
  await reconnectFromConnectionFailure(() => {
    renderCount += 1;
  });

  assert.equal(state.connectionFailure.isOpen, true);
  assert.equal(state.connectionFailure.reconnecting, false);
  assert.equal(state.connectionFailure.message, "No internet connection.");
  assert.equal(renderCount, 2);
});

test("reconnectFromConnectionFailure closes after the retry action succeeds", async () => {
  let retryCount = 0;
  state.connectionFailure = {
    isOpen: true,
    message: "Could not connect.",
    canGoOffline: true,
    reconnecting: false,
    retryAction: async () => {
      retryCount += 1;
    },
  };

  let renderCount = 0;
  await reconnectFromConnectionFailure(() => {
    renderCount += 1;
  });

  assert.equal(retryCount, 1);
  assert.equal(state.connectionFailure.isOpen, false);
  assert.equal(renderCount, 2);
});

test("reconnectFromConnectionFailure keeps the modal open when the retry reopens it", async () => {
  state.connectionFailure = {
    isOpen: true,
    message: "Could not connect.",
    canGoOffline: true,
    reconnecting: false,
    retryAction: async () => {
      state.connectionFailure = {
        isOpen: true,
        message: "Could not connect to GitHub.",
        canGoOffline: true,
        reconnecting: false,
        retryAction: null,
      };
    },
  };

  await reconnectFromConnectionFailure(() => {});

  assert.equal(state.connectionFailure.isOpen, true);
  assert.equal(state.connectionFailure.reconnecting, false);
  assert.equal(state.connectionFailure.message, "Could not connect to GitHub.");
});
