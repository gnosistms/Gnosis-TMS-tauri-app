import test from "node:test";
import assert from "node:assert/strict";

const { createQaListEditorState, resetSessionState, state } = await import("../app/state.js");
const { renderQaListEditorScreen } = await import("./qa-list-editor.js");
const { beginQaTermWrite, endQaTermWrite, resetQaTermWriteCoordinator } = await import("../app/qa-term-write-coordinator.js");

function installQaListEditorFixture({ canManageProjects = true } = {}) {
  resetSessionState();
  state.selectedTeamId = "team-1";
  state.selectedQaListId = "qa-list-1";
  state.teams = [
    {
      id: "team-1",
      canManageProjects,
      canDelete: canManageProjects,
      githubOrg: "fixture-org",
    },
  ];
  state.qaListEditor = {
    ...createQaListEditorState(),
    status: "ready",
    qaListId: "qa-list-1",
    title: "Fixture QA List",
    language: { code: "vi", name: "Vietnamese" },
    searchQuery: "",
    terms: [
      {
        termId: "term-1",
        text: "alpha",
        notes: "beta",
      },
    ],
  };
}

test.afterEach(() => {
  resetQaTermWriteCoordinator();
  resetSessionState();
});

test("QA list editor keeps search in left tools and term creation on the right", () => {
  installQaListEditorFixture();

  const html = renderQaListEditorScreen(state);
  const leftToolsIndex = html.indexOf("page-header__left-tools");
  const searchIndex = html.indexOf("data-qa-term-search-input");
  const rightToolsIndex = html.indexOf("page-header__tools");
  const newTermIndex = html.indexOf('data-action="open-new-qa-term"');

  assert.ok(leftToolsIndex >= 0);
  assert.ok(searchIndex > leftToolsIndex);
  assert.ok(rightToolsIndex >= 0);
  assert.ok(newTermIndex > rightToolsIndex);
  assert.ok(searchIndex < rightToolsIndex);
});

test("QA list editor spins refresh while page sync is active", () => {
  installQaListEditorFixture();
  state.pageSync = {
    status: "syncing",
    startedAt: performance.now(),
  };

  const html = renderQaListEditorScreen(state);

  assert.match(html, /title-icon-button[^"]*\bis-spinning\b/);
  assert.match(html, /data-action="refresh-page"[^>]*aria-disabled="true"/);
});

test("QA list editor spins refresh while a QA term write is active", () => {
  installQaListEditorFixture();
  beginQaTermWrite();

  const html = renderQaListEditorScreen(state);

  assert.match(html, /title-icon-button[^"]*\bis-spinning\b/);
  assert.match(html, /data-action="refresh-page"[^>]*aria-disabled="true"/);
  endQaTermWrite();
});
