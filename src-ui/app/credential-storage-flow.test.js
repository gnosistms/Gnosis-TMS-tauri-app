import test from "node:test";
import assert from "node:assert/strict";
import { installMockNavigator } from "../test/mock-navigator.mjs";

let handler = async () => null;
const local = new Map();
globalThis.document = { querySelector: () => null, querySelectorAll: () => [], addEventListener() {} };
installMockNavigator({ platform: "MacIntel", onLine: true });
globalThis.window = {
  __TAURI__: { core: { invoke: (command, payload) => handler(command, payload) } },
  localStorage: { getItem: (key) => local.get(key) ?? null, setItem: (key, value) => local.set(key, value), removeItem: (key) => local.delete(key) },
  requestAnimationFrame: (cb) => cb(), setTimeout: () => 1, clearTimeout() {},
};
const { state, resetSessionState } = await import("./state.js");
const { refreshCredentialStorage, useSessionOnlyCredentialStorage } = await import("./credential-storage-flow.js");
const { applyBrokerAuthResult, restoreStoredBrokerSession } = await import("./auth-flow.js");
const { handleNavigation } = await import("./navigation.js");
const { loadStoredAuthSession } = await import("./auth-storage.js");

test.beforeEach(() => {
  resetSessionState(); local.clear();
  state.credentialStorage = { mode: "unknown", message: "" };
});

test("unavailable storage requires explicit session-only selection and never writes browser credentials", async () => {
  const calls = [];
  handler = async (command) => {
    calls.push(command);
    if (command === "load_credential_storage_status") return { mode: "locked", message: "Unlock secure storage." };
    if (command === "use_session_only_credential_storage") return { mode: "session_only", message: "Keys last for this session." };
    throw new Error(`Unexpected command: ${command}`);
  };
  await refreshCredentialStorage();
  assert.equal(state.credentialStorage.mode, "locked");
  assert.equal(await loadStoredAuthSession(), null);
  assert.deepEqual(calls, ["load_credential_storage_status"]);
  await useSessionOnlyCredentialStorage();
  assert.equal(state.credentialStorage.mode, "session_only");
  assert.equal(local.size, 0);
});

test("retry can unlock storage without falling back automatically", async () => {
  let locked = true;
  handler = async (command) => {
    assert.equal(command, "load_credential_storage_status");
    return locked ? { mode: "locked", message: "Unlock secure storage." } : { mode: "persistent", message: "" };
  };
  await refreshCredentialStorage(); locked = false;
  await refreshCredentialStorage();
  assert.equal(state.credentialStorage.mode, "persistent");
});

test("a failed login save is visible and does not activate an unsaved session", async () => {
  handler = async () => { throw new Error("Could not write encrypted credentials."); };
  await applyBrokerAuthResult({ status: "success", session: { sessionToken: "synthetic", login: "tester" } }, () => {}, () => assert.fail("Teams should not load"));
  assert.equal(state.auth.session, null);
  assert.equal(state.auth.status, "error");
  assert.match(state.auth.message, /Could not write/);
  assert.equal(state.credentialStorage.mode, "locked");
});

test("sign-out waits for credential deletion and stays signed in if deletion fails", async () => {
  state.screen = "teams";
  state.auth.session = { sessionToken: "synthetic", login: "tester" };
  let release;
  handler = async (command) => {
    assert.equal(command, "clear_broker_auth_session");
    return new Promise((_, reject) => { release = reject; });
  };
  const navigation = handleNavigation("start", () => {});
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.auth.session.login, "tester");
  release(new Error("Could not delete encrypted credentials."));
  await navigation;
  assert.equal(state.screen, "teams");
  assert.equal(state.auth.session.login, "tester");
  assert.equal(state.credentialStorage.mode, "locked");
  handler = async () => null;
  await handleNavigation("start", () => {});
  assert.equal(state.screen, "start");
  assert.equal(state.auth.session, null);
});

test("a delayed session inspection cannot restore a signed-out account", async () => {
  let release;
  handler = async (command) => {
    assert.equal(command, "inspect_broker_auth_session");
    return new Promise((resolve) => { release = resolve; });
  };
  const restoring = restoreStoredBrokerSession(() => {}, () => assert.fail("Teams should not load"), { sessionToken: "synthetic", login: "tester" });
  await new Promise((resolve) => setImmediate(resolve));
  state.auth.session = null;
  release({ login: "tester" });
  await restoring;
  assert.equal(state.auth.session, null);
});
