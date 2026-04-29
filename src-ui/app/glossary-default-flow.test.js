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
  defaultGlossaryCandidateAfterDeletion,
  makeGlossaryDefault,
  makeGlossaryDefaultIfFirst,
  updateDefaultGlossaryAfterDeletion,
} = await import("./glossary-default-flow.js");
const { setActiveStorageLogin } = await import("./team-storage.js");
const { saveStoredDefaultGlossaryIdForTeam } = await import("./glossary-default-cache.js");

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

test("makeGlossaryDefault persists the selected active glossary for the team", () => {
  setupDefaultGlossaryTest();
  let renderCount = 0;

  makeGlossaryDefault(() => {
    renderCount += 1;
  }, "glossary-1");

  assert.equal(activeDefaultGlossaryIdForTeam(state.teams[0]), "glossary-1");
  assert.equal(renderCount, 1);
});

test("activeDefaultGlossaryIdForTeam ignores deleted default glossaries", () => {
  setupDefaultGlossaryTest("glossary-default-deleted-test");
  saveStoredDefaultGlossaryIdForTeam(state.teams[0], "glossary-1");
  state.glossaries = state.glossaries.map((glossary) => ({
    ...glossary,
    lifecycleState: "deleted",
  }));

  assert.equal(activeDefaultGlossaryIdForTeam(state.teams[0]), null);
});

test("makeGlossaryDefaultIfFirst defaults the team's first active glossary", () => {
  setupDefaultGlossaryTest("glossary-default-first-test");

  assert.equal(makeGlossaryDefaultIfFirst(state.teams[0], "glossary-1"), true);

  assert.equal(activeDefaultGlossaryIdForTeam(state.teams[0]), "glossary-1");
});

test("makeGlossaryDefaultIfFirst leaves later glossaries unchanged", () => {
  setupDefaultGlossaryTest("glossary-default-not-first-test");
  state.glossaries = [
    ...state.glossaries,
    {
      id: "glossary-2",
      repoName: "glossary-repo-2",
      title: "Second Glossary",
      lifecycleState: "active",
    },
  ];

  assert.equal(makeGlossaryDefaultIfFirst(state.teams[0], "glossary-2"), false);

  assert.equal(activeDefaultGlossaryIdForTeam(state.teams[0]), null);
});

test("defaultGlossaryCandidateAfterDeletion chooses the active glossary with the most terms", () => {
  setupDefaultGlossaryTest("glossary-default-candidate-test");
  state.glossaries = [
    {
      id: "glossary-1",
      repoName: "glossary-repo",
      title: "Current Default",
      lifecycleState: "deleted",
      termCount: 99,
    },
    {
      id: "glossary-2",
      repoName: "small",
      title: "Small",
      lifecycleState: "active",
      termCount: 5,
    },
    {
      id: "glossary-3",
      repoName: "large",
      title: "Large",
      lifecycleState: "active",
      termCount: 20,
    },
  ];

  assert.equal(defaultGlossaryCandidateAfterDeletion("glossary-1")?.id, "glossary-3");
});

test("updateDefaultGlossaryAfterDeletion promotes the largest remaining glossary", () => {
  setupDefaultGlossaryTest("glossary-default-promote-test");
  state.glossaries = [
    {
      id: "glossary-1",
      repoName: "glossary-repo",
      title: "Current Default",
      lifecycleState: "deleted",
      termCount: 10,
    },
    {
      id: "glossary-2",
      repoName: "small",
      title: "Small",
      lifecycleState: "active",
      termCount: 4,
    },
    {
      id: "glossary-3",
      repoName: "large",
      title: "Large",
      lifecycleState: "active",
      termCount: 12,
    },
  ];
  saveStoredDefaultGlossaryIdForTeam(state.teams[0], "glossary-1");

  const nextDefault = updateDefaultGlossaryAfterDeletion(state.teams[0], "glossary-1");

  assert.equal(nextDefault?.id, "glossary-3");
  assert.equal(activeDefaultGlossaryIdForTeam(state.teams[0]), "glossary-3");
});
