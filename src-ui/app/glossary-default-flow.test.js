import test from "node:test";
import assert from "node:assert/strict";

globalThis.window = {
  setTimeout() {
    return 1;
  },
  clearTimeout() {},
};

const { resetSessionState, state } = await import("./state.js");
const {
  activeDefaultGlossaryIdForTeam,
  cancelGlossaryDefaultModal,
  confirmGlossaryDefault,
  openGlossaryDefaultModal,
} = await import("./glossary-default-flow.js");
const { setActiveStorageLogin } = await import("./team-storage.js");

test.afterEach(() => {
  resetSessionState();
});

function setupDefaultGlossaryTest(login = "glossary-default-flow-test") {
  resetSessionState();
  setActiveStorageLogin(login);
  state.selectedTeamId = "team-1";
  state.teams = [{
    id: "team-1",
    name: "Team",
    installationId: 1,
    canManageProjects: true,
  }];
  state.glossaries = [{
    id: "glossary-1",
    repoName: "glossary-repo",
    title: "Default Glossary",
    lifecycleState: "active",
  }];
}

test("confirmGlossaryDefault persists the selected active glossary for the team", () => {
  setupDefaultGlossaryTest();
  let renderCount = 0;

  openGlossaryDefaultModal(() => {
    renderCount += 1;
  }, "glossary-1");
  confirmGlossaryDefault(() => {
    renderCount += 1;
  });

  assert.equal(activeDefaultGlossaryIdForTeam(state.teams[0]), "glossary-1");
  assert.equal(state.glossaryDefault.isOpen, false);
  assert.equal(renderCount, 2);
});

test("activeDefaultGlossaryIdForTeam ignores deleted default glossaries", () => {
  setupDefaultGlossaryTest("glossary-default-deleted-test");
  openGlossaryDefaultModal(() => {}, "glossary-1");
  confirmGlossaryDefault(() => {});
  state.glossaries = state.glossaries.map((glossary) => ({
    ...glossary,
    lifecycleState: "deleted",
  }));

  assert.equal(activeDefaultGlossaryIdForTeam(state.teams[0]), null);
});

test("cancelGlossaryDefaultModal closes the modal without changing defaults", () => {
  setupDefaultGlossaryTest("glossary-default-cancel-test");

  openGlossaryDefaultModal(() => {}, "glossary-1");
  cancelGlossaryDefaultModal(() => {});

  assert.equal(activeDefaultGlossaryIdForTeam(state.teams[0]), null);
  assert.equal(state.glossaryDefault.isOpen, false);
});
