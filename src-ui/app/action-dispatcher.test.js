import test from "node:test";
import assert from "node:assert/strict";

const localStorageState = new Map();
let invokeHandler = async () => null;
const invokeLog = [];

class FakeElement {}
class FakeHTMLElement extends FakeElement {}

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
  key(index) {
    return [...localStorageState.keys()][index] ?? null;
  },
  get length() {
    return localStorageState.size;
  },
};

globalThis.Element = FakeElement;
globalThis.HTMLElement = FakeHTMLElement;
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
        invokeLog.push({
          command,
          payload,
        });
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
  setInterval() {
    return 1;
  },
  clearInterval() {},
  requestAnimationFrame(callback) {
    callback();
    return 1;
  },
  cancelAnimationFrame() {},
  addEventListener() {},
  removeEventListener() {},
  open() {},
};

const { createActionDispatcher } = await import("./action-dispatcher.js");
const { resetSessionState, state } = await import("./state.js");

test.afterEach(() => {
  invokeHandler = async () => null;
  invokeLog.length = 0;
  localStorageState.clear();
  resetSessionState();
});

test("required updates block non-update actions at dispatch time", async () => {
  state.connectionFailure = {
    isOpen: true,
    message: "Connection lost.",
    canGoOffline: true,
  };
  state.appUpdate = {
    ...state.appUpdate,
    required: true,
    available: true,
    version: "0.1.36",
    currentVersion: "0.1.35",
    promptVisible: true,
  };

  let renderCount = 0;
  const dispatchAction = createActionDispatcher(() => {
    renderCount += 1;
  });

  const handled = await dispatchAction("dismiss-connection-failure");

  assert.equal(handled, true);
  assert.equal(state.connectionFailure.isOpen, true);
  assert.equal(renderCount, 0);
  assert.deepEqual(invokeLog, []);
});

test("required updates still allow explicit update checks", async () => {
  state.appUpdate = {
    ...state.appUpdate,
    required: true,
    available: true,
    version: "0.1.36",
    currentVersion: "0.1.35",
    message: "A newer version is required.",
    promptVisible: true,
  };
  invokeHandler = async (command) => {
    assert.equal(command, "check_for_app_update");
    return {
      available: false,
      version: null,
      currentVersion: "0.1.35",
      body: null,
      message: "",
    };
  };

  const dispatchAction = createActionDispatcher(() => {});
  const handled = await dispatchAction("check-for-updates");

  assert.equal(handled, true);
  assert.deepEqual(
    invokeLog.map((entry) => entry.command),
    ["check_for_app_update"],
  );
  assert.equal(state.appUpdate.required, true);
  assert.equal(state.appUpdate.available, true);
  assert.equal(state.appUpdate.promptVisible, true);
  assert.equal(state.appUpdate.version, "0.1.36");
  assert.equal(state.appUpdate.currentVersion, "0.1.35");
  assert.equal(state.appUpdate.message, "A newer version is required.");
});
