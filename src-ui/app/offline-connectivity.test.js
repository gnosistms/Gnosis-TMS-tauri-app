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
};

const { restoreStoredBrokerSession } = await import("./auth-flow.js");
const { enableOfflineMode, reconnectOnlineMode } = await import("./offline-connectivity.js");
const { resetSessionState, state } = await import("./state.js");
const { saveStoredTeamRecords, setActiveStorageLogin } = await import("./team-storage.js");

test.afterEach(() => {
  invokeHandler = async () => true;
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
