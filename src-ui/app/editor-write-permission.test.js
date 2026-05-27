import test from "node:test";
import assert from "node:assert/strict";

import {
  assertCurrentEditorWritePermission,
  assertEditorSessionWritePermission,
  captureEditorWritePermissionSnapshot,
  EDITOR_PERMISSION_DENIED_MESSAGE,
  editorSessionCanWrite,
  getProjectLifecycleWritePolicy,
  invokeEditorWriteCommand,
} from "./editor-write-permission.js";
import { flushDirtyEditorRows } from "./editor-persistence-flow.js";
import { createEditorChapterState, state } from "./state.js";

globalThis.window ??= {
  setTimeout: () => 0,
  clearTimeout: () => {},
};

function writerTeam(overrides = {}) {
  return {
    id: "team-1",
    installationId: 7,
    canManageProjects: true,
    canDelete: true,
    membershipRole: "Translator",
    ...overrides,
  };
}

function resetEditorPermissionFixture(team = writerTeam()) {
  const project = {
    id: "project-1",
    name: "project-repo",
    lifecycleState: "active",
    chapters: [
      { id: "chapter-1", lifecycleState: "active", status: "active" },
    ],
  };
  const chapter = project.chapters[0];
  state.teams = [team];
  state.selectedTeamId = team.id;
  state.projects = [project];
  state.deletedProjects = [];
  state.selectedProjectId = project.id;
  state.selectedChapterId = chapter.id;
  state.editorChapter = {
    ...createEditorChapterState(),
    projectId: project.id,
    chapterId: chapter.id,
    rows: [
      { id: "row-1", rowId: "row-1", lifecycleState: "active", saveStatus: "idle", saveError: "" },
    ],
    writePermissionSnapshot: captureEditorWritePermissionSnapshot({ team, project, chapter }),
  };
  return { team, project, chapter };
}

test("editor session write permission stays stable after a background role refresh", () => {
  resetEditorPermissionFixture();
  state.teams = [
    writerTeam({
      membershipRole: "viewer",
      canManageProjects: true,
    }),
  ];

  assert.equal(editorSessionCanWrite(state.editorChapter), true);
  assert.doesNotThrow(() => assertEditorSessionWritePermission({ rowId: "row-1" }));
  assert.throws(() => assertCurrentEditorWritePermission({ rowId: "row-1" }), /Cannot save changes/);
});

test("current viewer role blocks the next editor write and locks pending rows", async () => {
  resetEditorPermissionFixture();
  state.teams = [
    writerTeam({
      membershipRole: "viewer",
      canManageProjects: true,
    }),
  ];
  state.editorChapter = {
    ...state.editorChapter,
    rows: [
      { id: "row-1", rowId: "row-1", lifecycleState: "active", saveStatus: "saving", saveError: "" },
    ],
  };

  await assert.rejects(
    () => invokeEditorWriteCommand("update_gtms_editor_row_fields", { input: {} }, { rowId: "row-1" }),
    /Cannot save changes/,
  );

  assert.equal(state.editorChapter.writeLock.status, "locked");
  assert.equal(state.editorChapter.writeLock.message, EDITOR_PERMISSION_DENIED_MESSAGE);
  assert.equal(state.editorChapter.rows[0].saveStatus, "error");
  assert.equal(state.editorChapter.rows[0].saveError, EDITOR_PERMISSION_DENIED_MESSAGE);
  assert.equal(editorSessionCanWrite(state.editorChapter), false);
});

test("permission lock lets dirty rows stop blocking editor navigation flushes", async () => {
  resetEditorPermissionFixture();
  state.teams = [
    writerTeam({
      membershipRole: "viewer",
      canManageProjects: true,
    }),
  ];
  state.editorChapter = {
    ...state.editorChapter,
    dirtyRowIds: new Set(["row-1"]),
    rows: [
      {
        id: "row-1",
        rowId: "row-1",
        lifecycleState: "active",
        fields: { es: "changed" },
        persistedFields: { es: "old" },
        footnotes: {},
        persistedFootnotes: {},
        imageCaptions: {},
        persistedImageCaptions: {},
        saveStatus: "saving",
        saveError: "",
      },
    ],
  };

  await assert.rejects(
    () => invokeEditorWriteCommand("update_gtms_editor_row_fields", { input: {} }, { rowId: "row-1" }),
    /Cannot save changes/,
  );

  assert.equal(await flushDirtyEditorRows(() => {}, {}), true);
});

test("soft-deleted lifecycle state still blocks a writable editor session", () => {
  const { team, chapter } = resetEditorPermissionFixture();
  const policy = getProjectLifecycleWritePolicy({
    team,
    project: { id: "project-1", lifecycleState: "deleted" },
    chapter,
    row: { rowId: "row-1", lifecycleState: "active" },
  });

  assert.equal(policy.allowed, false);
  assert.equal(policy.reason, "parentSoftDeleted");
});
