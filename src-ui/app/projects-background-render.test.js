import test from "node:test";
import assert from "node:assert/strict";
import { exportProjectFingerprint, projectBackgroundRender, projectRefreshInProgress } from "./projects-background-render.js";

const stateFor = () => ({
  selectedTeamId: "team", projects: [{ id: "p", title: "Book", fileLoadState: "ready", chapters: [{ id: "c", name: "Chapter", languages: [{ code: "en" }] }] }],
  editorChapter: { exportModal: { isOpen: true, projectId: "p" } },
});

test("project load renders retain explicit partial scopes and mark full background renders", () => {
  const calls = [];
  const render = projectBackgroundRender(projectBackgroundRender((options) => calls.push(options)));
  render();
  render({ scope: "status-surface" });
  assert.deepEqual(calls, [{ scope: "projects-background" }, { scope: "status-surface" }]);
});

test("refresh completion requires discovery, query and page sync to settle", () => {
  for (const state of [{ projectsPage: { isRefreshing: true } }, { projectDiscovery: { status: "loading" } }, { projectsPageSync: { status: "syncing" } }]) {
    assert.equal(projectRefreshInProgress(state), true);
  }
  assert.equal(projectRefreshInProgress({ projectsPageSync: { status: "upToDate" } }), false);
});

test("export fingerprint ignores unrelated projects, object key order and discovery progress", () => {
  const state = stateFor();
  const before = exportProjectFingerprint(state);
  state.projects.push({ id: "other", title: "Another book" });
  state.projects[0].fileLoadState = "loading";
  state.projects[0].chapters[0] = { languages: [{ code: "en" }], name: "Chapter", id: "c" };
  state.projectRepoSyncByProjectId = { p: { status: "syncing" } };
  assert.equal(exportProjectFingerprint(state), before);
  state.projects[0].chapters[0].languages.push({ code: "vi" });
  assert.notEqual(exportProjectFingerprint(state), before);
});

test("fingerprint detects exported project changes and single-chapter project context", () => {
  const state = stateFor();
  state.editorChapter.exportModal = { isOpen: true, chapterId: "c" };
  const before = exportProjectFingerprint(state);
  state.projects[0].title = "Changed";
  assert.notEqual(exportProjectFingerprint(state), before);
  state.projects = [];
  assert.notEqual(exportProjectFingerprint(state), before);
  state.editorChapter.exportModal.isOpen = false;
  assert.equal(exportProjectFingerprint(state), "");
});
