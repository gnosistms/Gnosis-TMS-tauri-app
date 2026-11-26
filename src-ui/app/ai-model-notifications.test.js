import assert from "node:assert/strict";
import test from "node:test";

const calls = [];
let invokeHandler;
globalThis.window = {
  __TAURI__: { core: { invoke: async (command, payload) => {
    calls.push({ command, ...payload });
    return invokeHandler(command, payload);
  } } },
  addEventListener() {},
};
const { state, invalidateAuthSession } = await import("./state.js");
const { checkForNewAiModels, currentAiModelNotice, dismissAiModelNotice, syncAiModelNotice } =
  await import("./ai-model-notifications.js");
const { aiModelHistory, recordAiModelList } = await import("./ai-model-history.js");
const { saveStoredAiActionPreferences } = await import("./ai-action-preferences.js");
const { readPersistentValue } = await import("./persistent-store.js");
const { encryptTeamAiPlaintext } = await import("./team-ai-crypto.js");

const week = 7 * 24 * 60 * 60 * 1000;
const team = (installationId, membershipRole = "owner") =>
  ({ id: String(installationId), githubOrg: `org-${installationId}`, installationId, membershipRole });
const unified = (providerId) => ({ unified: { providerId } });
const models = (...ids) => ids.map((id) => ({ id, label: id }));

function signIn(login, teams) {
  invalidateAuthSession();
  dismissAiModelNotice();
  state.auth = { status: "success", session: { login, sessionToken: "test-session" } };
  state.orgDiscovery.status = "ready";
  state.offline.isEnabled = false;
  state.teamsPage.isRefreshing = false;
  state.teams = teams;
  state.selectedTeamId = teams[0].id;
  state.screen = "projects";
  calls.length = 0;
}

function mockProviders(preferences, catalog) {
  invokeHandler = async (command, { installationId, providerId, noticeKnownIds }) => {
    if (command === "load_team_ai_settings") return { actionPreferences: preferences[installationId] };
    if (command === "load_team_ai_secrets_metadata") return { providers: {} };
    if (command === "load_team_ai_provider_cache") return { apiKey: "test", keyVersion: null };
    if (command === "list_ai_provider_models") {
      const available = await catalog(providerId, installationId);
      return available.filter(({ id }) => !noticeKnownIds.includes(id));
    }
    assert.fail(`Unexpected command ${command}`);
  };
}

function noticeSurface() {
  let mounted = null;
  const doc = { hasFocus: () => true, querySelector: () => mounted };
  const root = { ownerDocument: doc, querySelector: () => mounted };
  return {
    doc,
    sync: () => syncAiModelNotice(root, (notice) => { mounted = notice; }),
    ignore: () => { dismissAiModelNotice(); mounted = null; },
    notice: () => mounted,
  };
}

test("weekly checks use only effective selections of owned teams, once per provider and account", async () => {
  const login = "weekly-owner";
  signIn(login, [team(1), team(2), team(3, "admin"), team(4, "viewer"), { ...team(5), syncState: "unconfirmed" }]);
  let available = models("first");
  mockProviders({
    1: unified("openai"),
    2: { detailedConfiguration: true, unified: { providerId: "deepseek" }, actions: {
      review: { providerId: "claude" }, translate1: { providerId: "openai" }, discuss: { providerId: "claude" },
    } },
    3: unified("gemini"),
  }, () => available);
  await Promise.all([checkForNewAiModels(null, week), checkForNewAiModels(null, week)]);
  assert.deepEqual(calls.filter((c) => c.command === "load_team_ai_settings").map((c) => c.installationId), [1, 2]);
  assert.ok(calls.filter((c) => c.command === "load_team_ai_settings").every((c) => c.ownerOnly === true));
  assert.deepEqual(calls.filter((c) => c.command === "list_ai_provider_models").map((c) => c.providerId), ["openai", "claude"]);
  assert.deepEqual(aiModelHistory(login).providers.claude.pending, []);
  calls.length = 0;
  await checkForNewAiModels(null, 2 * week - 1);
  assert.equal(calls.length, 0);

  available = models("first", "new");
  await checkForNewAiModels(null, 2 * week);
  const surface = noticeSurface();
  state.selectedTeamId = "3";
  surface.sync();
  assert.equal(surface.notice(), null);
  state.selectedTeamId = "1";
  state.screen = "teams";
  surface.sync();
  assert.equal(surface.notice(), null);
  state.screen = "projects";
  surface.doc.hidden = true;
  surface.sync();
  assert.equal(surface.notice(), null);
  surface.doc.hidden = false;
  surface.sync();
  assert.equal(surface.notice().providerId, "openai");
  assert.deepEqual(surface.notice().models, models("new"));
  surface.ignore();
  surface.sync();
  assert.equal(surface.notice().providerId, "claude"); // Selected only by the other owned team.
  assert.deepEqual(surface.notice().models, models("new"));
  assert.deepEqual(readPersistentValue("gnosis-tms-ai-model-history:weekly-owner").providers.claude.pending, []);
  state.selectedTeamId = "4";
  assert.equal(currentAiModelNotice(), null);
  surface.sync();
  assert.equal(surface.notice(), null);
  state.selectedTeamId = "2";
  await checkForNewAiModels(null, 3 * week);
  surface.sync();
  assert.equal(surface.notice(), null);
  assert.equal(aiModelHistory("another-login").providers.claude, undefined);
});

test("opening the model list during a lookup suppresses only IDs actually viewed", async () => {
  const login = "picker-race";
  signIn(login, [team(1)]);
  recordAiModelList(login, "openai", models("old"));
  const started = Promise.withResolvers();
  const response = Promise.withResolvers();
  mockProviders({ 1: unified("openai") }, () => { started.resolve(); return response.promise; });
  const check = checkForNewAiModels(null, week);
  await started.promise;
  recordAiModelList(login, "openai", models("old", "viewed"), { viewed: true });
  response.resolve(models("old", "viewed", "unseen"));
  await check;
  assert.deepEqual(aiModelHistory(login).providers.openai.pending, models("unseen"));
  recordAiModelList(login, "openai", models("unseen"), { viewed: true });
  assert.deepEqual(aiModelHistory(login).providers.openai.pending, []);
  recordAiModelList(login, "openai", models("returned", "unseen"));
  assert.deepEqual(aiModelHistory(login).providers.openai.pending, models("returned"));
  recordAiModelList(login, "openai", []);
  assert.deepEqual(aiModelHistory(login).providers.openai.pending, []);
});

test("failed credentials fall back to another owned team and failed lists preserve history", async () => {
  const login = "failed-list";
  signIn(login, [team(1), team(2)]);
  const prefs = { 1: unified("gemini"), 2: unified("gemini") };
  mockProviders(prefs, (_provider, installation) => {
    if (installation === 1) throw new Error("No models available for this account");
    return models("baseline");
  });
  await checkForNewAiModels(null, week);
  assert.deepEqual(aiModelHistory(login).providers.gemini.knownIds, ["baseline"]);
  calls.length = 0;
  mockProviders(prefs, () => { throw new Error("Could not reach the provider"); });
  await checkForNewAiModels(null, 2 * week);
  assert.equal(calls.filter((call) => call.command === "list_ai_provider_models").length, 1);
  assert.deepEqual(aiModelHistory(login).providers.gemini, { knownIds: ["baseline"], pending: [] });
});

test("a shared key can be issued for an inactive owned team without selecting that team", async () => {
  const login = "cold-install";
  signIn(login, [team(1), team(2)]);
  let cached = false;
  invokeHandler = async (command, payload) => {
    switch (command) {
    case "load_team_ai_settings":
      return payload.installationId === 2 ? { actionPreferences: unified("claude") } : null;
    case "load_team_ai_provider_cache":
    case "load_team_ai_member_keypair":
    case "save_team_ai_member_keypair":
      return null;
    case "load_team_ai_secrets_metadata":
      return { providers: { claude: { configured: true, keyVersion: 2, algorithm: "rsa-oaep-sha256-v1" } } };
    case "issue_team_ai_provider_secret":
      return { wrappedKey: await encryptTeamAiPlaintext("fixture-key", payload.memberPublicKeyPem), keyVersion: 2 };
    case "save_team_ai_provider_cache":
      cached = payload.installationId === 2 && payload.apiKey === "fixture-key";
      return null;
    case "list_ai_provider_models":
      assert.ok(cached);
      return models("baseline");
    default:
      assert.fail(`Unexpected command ${command}`);
    }
  };
  await checkForNewAiModels(null, week);
  assert.equal(state.selectedTeamId, "1");
  assert.deepEqual(aiModelHistory(login).providers.claude.knownIds, ["baseline"]);
});

test("discard a result if its source team loses ownership, changes provider or signs out", async () => {
  for (const change of ["role", "selection", "login"]) {
    const login = `changed-${change}`;
    signIn(login, [team(7)]);
    recordAiModelList(login, "openai", models("old"));
    const started = Promise.withResolvers();
    const response = Promise.withResolvers();
    mockProviders({ 7: unified("openai") }, () => { started.resolve(); return response.promise; });
    const checking = checkForNewAiModels(null, week);
    await started.promise;
    if (change === "role") state.teams[0].membershipRole = "translator";
    if (change === "selection") saveStoredAiActionPreferences(unified("claude"), login, 7);
    if (change === "login") signIn("different-user", [team(7)]);
    response.resolve(models("new"));
    await checking;
    assert.deepEqual(aiModelHistory(login).providers.openai.pending, []);
  }
});
