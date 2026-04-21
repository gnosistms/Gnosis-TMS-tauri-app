import test from "node:test";
import assert from "node:assert/strict";

const localStorageState = new Map();
let invokeHandler = async () => null;

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
  platform: "Win32",
  userAgentData: null,
};
globalThis.performance = {
  now() {
    return 0;
  },
};
globalThis.window = {
  __TAURI__: {
    core: {
      invoke(command, payload = {}) {
        return invokeHandler(command, payload);
      },
    },
    event: {
      listen: async () => () => {},
    },
    opener: {
      openUrl() {},
    },
  },
  localStorage: fakeLocalStorage,
  navigator: globalThis.navigator,
  setTimeout() {
    return 1;
  },
  clearTimeout() {},
  requestAnimationFrame(callback) {
    callback();
    return 1;
  },
  cancelAnimationFrame() {},
  open() {},
};

const { resetSessionState, state } = await import("./state.js");
const {
  checkForAppUpdate,
  dismissAppUpdatePrompt,
  installAppUpdate,
} = await import("./updater-flow.js");

test.afterEach(() => {
  invokeHandler = async () => null;
  localStorageState.clear();
  resetSessionState();
});

test("startup update check opens the global prompt when an update is available", async () => {
  invokeHandler = async (command) => {
    assert.equal(command, "check_for_app_update");
    return {
      available: true,
      version: "0.1.16",
      currentVersion: "0.1.15",
      body: null,
    };
  };

  let renderCount = 0;
  await checkForAppUpdate(() => {
    renderCount += 1;
  }, { silent: true });

  assert.equal(state.appUpdate.available, true);
  assert.equal(state.appUpdate.status, "available");
  assert.equal(state.appUpdate.promptVisible, true);
  assert.equal(state.appUpdate.dismissedVersion, null);
  assert.ok(renderCount >= 2);
});

test("manual update checks show immediate checking feedback before the result arrives", async () => {
  let resolveUpdate = null;
  invokeHandler = async (command) => {
    assert.equal(command, "check_for_app_update");
    return await new Promise((resolve) => {
      resolveUpdate = resolve;
    });
  };

  let renderCount = 0;
  const pendingCheck = checkForAppUpdate(() => {
    renderCount += 1;
  }, { silent: false });

  assert.equal(state.appUpdate.status, "checking");
  assert.equal(state.statusBadges.left.visible, true);
  assert.equal(state.statusBadges.left.text, "Checking for updates...");

  resolveUpdate({
    available: false,
    version: null,
    currentVersion: "0.1.22",
    body: null,
  });
  await pendingCheck;

  assert.equal(state.appUpdate.status, "idle");
  assert.equal(state.appUpdate.message, "");
  assert.equal(state.statusBadges.left.text, "Gnosis TMS 0.1.22 is up to date");
  assert.ok(renderCount >= 3);
});

test("manual update checks surface a platform availability message when no compatible update is ready", async () => {
  invokeHandler = async () => ({
    available: false,
    version: null,
    currentVersion: "0.1.33",
    body: null,
    message: "A newer Gnosis TMS release exists, but it is not available for Windows yet.",
  });

  await checkForAppUpdate(() => {}, { silent: false });

  assert.equal(state.appUpdate.status, "idle");
  assert.equal(
    state.appUpdate.message,
    "A newer Gnosis TMS release exists, but it is not available for Windows yet.",
  );
  assert.equal(
    state.statusBadges.left.text,
    "A newer Gnosis TMS release exists, but it is not available for Windows yet.",
  );
});

test("Later suppresses the same version for silent checks but manual checks reopen it", async () => {
  invokeHandler = async () => ({
    available: true,
    version: "0.1.16",
    currentVersion: "0.1.15",
    body: null,
  });

  await checkForAppUpdate(() => {}, { silent: true });
  dismissAppUpdatePrompt(() => {});

  assert.equal(state.appUpdate.promptVisible, false);
  assert.equal(state.appUpdate.dismissedVersion, "0.1.16");

  await checkForAppUpdate(() => {}, { silent: true });
  assert.equal(state.appUpdate.promptVisible, false);
  assert.equal(state.appUpdate.dismissedVersion, "0.1.16");

  await checkForAppUpdate(() => {}, { silent: false });
  assert.equal(state.appUpdate.promptVisible, true);
  assert.equal(state.appUpdate.dismissedVersion, null);
});

test("installing an update keeps the prompt open until restart", async () => {
  state.appUpdate = {
    ...state.appUpdate,
    status: "available",
    available: true,
    version: "0.1.16",
    currentVersion: "0.1.15",
    promptVisible: true,
  };

  invokeHandler = async (command) => {
    assert.equal(command, "install_app_update");
    return null;
  };

  await installAppUpdate(() => {});

  assert.equal(state.appUpdate.status, "restarting");
  assert.equal(state.appUpdate.promptVisible, true);
  assert.equal(state.appUpdate.error, "");
});

test("install failures return to the available state and keep the prompt visible", async () => {
  state.appUpdate = {
    ...state.appUpdate,
    status: "available",
    available: true,
    version: "0.1.16",
    currentVersion: "0.1.15",
    promptVisible: true,
  };

  invokeHandler = async () => {
    throw new Error("Installer failed");
  };

  await installAppUpdate(() => {});

  assert.equal(state.appUpdate.status, "available");
  assert.equal(state.appUpdate.promptVisible, true);
  assert.equal(state.appUpdate.error, "Installer failed");
});

test("manual update check failures surface a visible error message", async () => {
  invokeHandler = async () => {
    throw new Error("Could not check for updates: timeout");
  };

  let renderCount = 0;
  await checkForAppUpdate(() => {
    renderCount += 1;
  }, { silent: false });

  assert.equal(state.appUpdate.status, "error");
  assert.equal(state.appUpdate.error, "Could not check for updates: timeout");
  assert.equal(state.statusBadges.left.visible, true);
  assert.equal(state.statusBadges.left.text, "Could not check for updates: timeout");
  assert.ok(renderCount >= 3);
});
