import test from "node:test";
import assert from "node:assert/strict";

import { applyEditorRegressionFixture } from "./editor-regression-fixture.js";
import { buildEditorScreenViewModel } from "./editor-screen-model.js";
import { state } from "./state.js";

function snapshotSharedState() {
  return {
    screen: state.screen,
    editorChapter: state.editorChapter,
    projects: state.projects,
    deletedProjects: state.deletedProjects,
    teams: state.teams,
    deletedTeams: state.deletedTeams,
    selectedTeamId: state.selectedTeamId,
    selectedProjectId: state.selectedProjectId,
    selectedChapterId: state.selectedChapterId,
    expandedProjects: state.expandedProjects,
    expandedDeletedFiles: state.expandedDeletedFiles,
    glossaries: state.glossaries,
    users: state.users,
    auth: state.auth,
    offline: state.offline,
  };
}

function restoreSharedState(snapshot) {
  state.screen = snapshot.screen;
  state.editorChapter = snapshot.editorChapter;
  state.projects = snapshot.projects;
  state.deletedProjects = snapshot.deletedProjects;
  state.teams = snapshot.teams;
  state.deletedTeams = snapshot.deletedTeams;
  state.selectedTeamId = snapshot.selectedTeamId;
  state.selectedProjectId = snapshot.selectedProjectId;
  state.selectedChapterId = snapshot.selectedChapterId;
  state.expandedProjects = snapshot.expandedProjects;
  state.expandedDeletedFiles = snapshot.expandedDeletedFiles;
  state.glossaries = snapshot.glossaries;
  state.users = snapshot.users;
  state.auth = snapshot.auth;
  state.offline = snapshot.offline;
}

test("buildEditorScreenViewModel exposes showContextAction only when user filters are active", () => {
  const snapshot = snapshotSharedState();

  try {
    applyEditorRegressionFixture(state, {
      rowCount: 4,
      searchQuery: "alpha",
    });

    let viewModel = buildEditorScreenViewModel(state);
    let firstRow = viewModel.contentRows.find((row) => row?.kind === "row");
    assert.equal(firstRow?.showContextAction, true);

    state.editorChapter = {
      ...state.editorChapter,
      filters: {
        ...state.editorChapter.filters,
        searchQuery: "",
        rowFilterMode: "show-all",
      },
    };

    viewModel = buildEditorScreenViewModel(state);
    firstRow = viewModel.contentRows.find((row) => row?.kind === "row");
    assert.equal(firstRow?.showContextAction, false);
  } finally {
    restoreSharedState(snapshot);
  }
});
