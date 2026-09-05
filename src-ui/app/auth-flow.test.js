import test from "node:test";
import assert from "node:assert/strict";

let invokeHandler = async () => null;
globalThis.document = { querySelector: () => null, querySelectorAll: () => [] };
globalThis.window = {
  __TAURI__: { core: { invoke: (command, payload) => invokeHandler(command, payload) } },
  requestAnimationFrame: (callback) => callback(),
  setTimeout: () => 1,
  clearTimeout() {},
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
};

const { applyBrokerAuthResult, restoreStoredBrokerSession } = await import("./auth-flow.js");
const { saveStoredAuthSession, clearStoredAuthSession } = await import("./auth-storage.js");
const { handleNavigation } = await import("./navigation.js");
const { resetSessionState, state } = await import("./state.js");

const session = { sessionToken: "old-token", login: "owner" };
const render = () => {};
function deferred() {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
}
test.beforeEach(() => { resetSessionState(); state.screen = "start"; });
test.afterEach(() => { resetSessionState(); invokeHandler = async () => null; });

test("login storage exposes save and deletion failures", async () => {
  invokeHandler = async () => { throw new Error("Disk unavailable"); };
  await assert.rejects(saveStoredAuthSession(session), /Disk unavailable/);
  await assert.rejects(clearStoredAuthSession(), /Disk unavailable/);
});

test("failed login save shows an error before activating the account", async () => {
  invokeHandler = async () => { throw new Error("Disk full"); };
  let loads = 0;
  await applyBrokerAuthResult({ status: "success", session }, render, () => { loads += 1; });
  assert.equal(state.auth.status, "error");
  assert.match(state.auth.message, /Could not save your GitHub login/);
  assert.equal(state.auth.session, null);
  assert.equal(state.screen, "start");
  assert.equal(loads, 0);
});

test("login becomes active only after its save completes", async () => {
  const save = deferred();
  const started = deferred();
  invokeHandler = async (command) => {
    assert.equal(command, "save_broker_auth_session");
    started.resolve();
    return save.promise;
  };
  let loads = 0;
  const login = applyBrokerAuthResult({ status: "success", session }, render, () => { loads += 1; });
  await started.promise;
  assert.equal(state.auth.session, null);
  save.resolve();
  await login;
  assert.equal(state.auth.session, session);
  assert.equal(state.screen, "teams");
  assert.equal(loads, 1);
  assert.equal(state.statusBadges.left.visible, false);
});

test("failed sign-out keeps the login and shows a deletion error", async () => {
  state.screen = "teams";
  state.auth.session = session;
  invokeHandler = async (command) => {
    assert.equal(command, "clear_broker_auth_session");
    throw new Error("Access denied");
  };
  await handleNavigation("start", render);
  assert.equal(state.screen, "teams");
  assert.equal(state.auth.session, session);
  assert.match(state.statusBadges.left.text, /Could not remove.*still signed in/);
});

test("successful sign-out waits for deletion and then clears the login", async () => {
  state.screen = "teams";
  state.auth.session = session;
  const deletion = deferred();
  const started = deferred();
  invokeHandler = async () => { started.resolve(); return deletion.promise; };
  const signOut = handleNavigation("start", render);
  await started.promise;
  assert.equal(state.auth.session, session);
  deletion.resolve();
  await signOut;
  assert.equal(state.auth.session, null);
  assert.equal(state.screen, "start");
});

test("sign-out during login saving deletes after the save and never activates it", async () => {
  const save = deferred();
  const started = deferred();
  const calls = [];
  let diskSession = null;
  invokeHandler = async (command, payload) => {
    calls.push(command);
    if (command === "save_broker_auth_session") {
      started.resolve();
      await save.promise;
      diskSession = payload.session;
    } else if (command === "clear_broker_auth_session") {
      diskSession = null;
    }
  };
  const login = applyBrokerAuthResult({ status: "success", session }, render, () => assert.fail("must not load teams"));
  await started.promise;
  const signOut = handleNavigation("start", render);
  // Let navigation reach its queued deletion before releasing the save.
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["save_broker_auth_session"]);
  save.resolve();
  await Promise.all([login, signOut]);
  assert.deepEqual(calls, ["save_broker_auth_session", "clear_broker_auth_session"]);
  assert.equal(diskSession, null);
  assert.equal(state.auth.session, null);
  assert.equal(state.screen, "start");
});

test("startup keeps a refreshed token instead of saving the old one again", async () => {
  const saves = [];
  invokeHandler = async (command, payload) => {
    if (command === "refresh_broker_auth_session") return { ...session, sessionToken: "fresh-token" };
    if (command === "save_broker_auth_session") { saves.push(payload); return; }
    assert.equal(command, "inspect_broker_auth_session");
    if (payload.sessionToken === "old-token") throw new Error("GitHub API 401: Bad credentials");
    return { login: "owner", name: "Owner" };
  };
  await restoreStoredBrokerSession(render, () => {}, session);
  assert.equal(state.auth.session.sessionToken, "fresh-token");
  assert.equal(saves.length, 1);
  assert.equal(saves[0].session.sessionToken, "fresh-token");
  assert.equal(saves[0].expectedSessionToken, "old-token");
  assert.equal(state.statusBadges.left.visible, false);
});

test("startup reports a refresh save error without demanding another login", async () => {
  invokeHandler = async (command) => {
    if (command === "refresh_broker_auth_session") return { ...session, sessionToken: "fresh-token" };
    if (command === "save_broker_auth_session") throw new Error("Disk full");
    throw new Error("GitHub API 401: Bad credentials");
  };
  await restoreStoredBrokerSession(render, () => assert.fail("must not retry automatically"), session);
  assert.equal(state.auth.session, session);
  assert.equal(state.screen, "teams");
  assert.match(state.statusBadges.left.text, /Could not save your refreshed GitHub login/);
});

test("startup inspection completing after sign-out cannot restore the old login", async () => {
  const inspection = deferred();
  const started = deferred();
  invokeHandler = async () => { started.resolve(); return inspection.promise; };
  const restore = restoreStoredBrokerSession(render, () => assert.fail("must not load teams"), session);
  await started.promise;
  resetSessionState();
  inspection.resolve({ login: "owner" });
  await restore;
  assert.equal(state.auth.session, null);
  assert.equal(state.screen, "start");
});

test("startup inspection failure after refresh retains the newly saved token", async () => {
  invokeHandler = async (command, payload) => {
    if (command === "refresh_broker_auth_session") return { ...session, sessionToken: "fresh-token" };
    if (command === "save_broker_auth_session") return;
    throw new Error(payload.sessionToken === "old-token" ? "GitHub API 401: Bad credentials" : "Failed to fetch");
  };
  await restoreStoredBrokerSession(render, () => {}, session);
  assert.equal(state.auth.session.sessionToken, "fresh-token");
  assert.equal(state.screen, "teams");
});
