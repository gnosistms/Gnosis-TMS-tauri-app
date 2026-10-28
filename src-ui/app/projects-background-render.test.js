import test from "node:test";
import assert from "node:assert/strict";
import { exportDialogRenderKey, projectBackgroundRender, projectRefreshInProgress } from "./projects-background-render.js";
import { reconcileBookLayout } from "./project-book-model.js";

const stateFor = () => ({
  selectedTeamId: "team", projects: [{ id: "p", title: "Book", fileLoadState: "ready", chapters: [{ id: "c", name: "Chapter", languages: [{ code: "en" }] }] }],
  editorChapter: { exportModal: { isOpen: true, projectId: "p", page: 1, languageCode: "en", languages: [{ code: "en" }],
    book: { ...reconcileBookLayout([{ id: "c", name: "Chapter", languages: [{ code: "en" }] }], "en"),
      previewStatus: "ready", previewChapterId: "c", previewBlocks: [] },
  } },
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

test("dialog key ignores project summaries and discovery progress when its output is unchanged", () => {
  const state = stateFor();
  const before = exportDialogRenderKey(state);
  state.projects.push({ id: "other", title: "Another book" });
  state.projects[0].fileLoadState = "loading";
  state.projects[0].chapters[0] = { languages: [{ code: "en" }], name: "Chapter", id: "c" };
  state.projectRepoSyncByProjectId = { p: { status: "syncing" } };
  state.projects[0].title = "Refreshed title";
  state.projects[0].chapters[0].wordCounts = { en: 4321 };
  state.projects[0].chapters[0].workflowStatus = "translated";
  assert.equal(exportDialogRenderKey(state), before);
  state.projects[0].chapters[0].languages.push({ code: "vi" });
  assert.equal(exportDialogRenderKey(state), before);
});

test("dialog key detects actual preview, error and team changes", () => {
  const state = stateFor();
  const before = exportDialogRenderKey(state);
  state.editorChapter.exportModal.book.previewBlocks = [{ kind: "text", text: "Chapter text", textStyle: "paragraph" }];
  assert.notEqual(exportDialogRenderKey(state), before);
  const preview = exportDialogRenderKey(state);
  state.editorChapter.exportModal.error = "Preview unavailable";
  assert.notEqual(exportDialogRenderKey(state), preview);
  const error = exportDialogRenderKey(state);
  state.selectedTeamId = "other";
  assert.notEqual(exportDialogRenderKey(state), error);
  state.editorChapter.exportModal.isOpen = false;
  assert.equal(exportDialogRenderKey(state), "");
});
