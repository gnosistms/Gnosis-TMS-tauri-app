import test from "node:test";
import assert from "node:assert/strict";

import {
  PROJECT_REPO_SYNC_STATUS_UNRESOLVED_CONFLICT,
  buildProjectRepoFallbackConflictRecoveryInput,
  buildProjectRepoSyncInput,
  listProjectRepoFallbackConflictEntries,
  mapProjectToProjectRepoSyncDescriptor,
  projectRepoSyncNeedsFallbackConflictRecovery,
} from "./project-repo-sync-shared.js";

test("mapProjectToProjectRepoSyncDescriptor ignores missing and tombstoned projects", () => {
  assert.equal(mapProjectToProjectRepoSyncDescriptor({
    id: "project-1",
    name: "repo-one",
    fullName: "org/repo-one",
    remoteState: "missing",
  }), null);

  assert.equal(mapProjectToProjectRepoSyncDescriptor({
    id: "project-2",
    name: "repo-two",
    fullName: "org/repo-two",
    recordState: "tombstone",
  }), null);
});

test("buildProjectRepoSyncInput only includes syncable projects", () => {
  assert.deepEqual(
    buildProjectRepoSyncInput(
      { installationId: 77 },
      [
        {
          id: "project-1",
          name: "repo-one",
          fullName: "org/repo-one",
          repoId: 12,
          defaultBranchName: "main",
          defaultBranchHeadOid: "abc",
        },
        {
          id: "project-2",
          name: "repo-two",
          fullName: "org/repo-two",
          remoteState: "deleted",
        },
      ],
    ),
    {
      installationId: 77,
      projects: [
        {
          projectId: "project-1",
          repoName: "repo-one",
          fullName: "org/repo-one",
          repoId: 12,
          defaultBranchName: "main",
          defaultBranchHeadOid: "abc",
        },
      ],
    },
  );
});

test("listProjectRepoFallbackConflictEntries only returns unresolved conflict snapshots", () => {
  const entries = listProjectRepoFallbackConflictEntries(
    [
      {
        id: "project-1",
        title: "Alpha",
        name: "repo-alpha",
        fullName: "org/repo-alpha",
      },
    ],
    [
      {
        id: "project-2",
        title: "Beta",
        name: "repo-beta",
        fullName: "org/repo-beta",
      },
    ],
    {
      "project-1": {
        status: PROJECT_REPO_SYNC_STATUS_UNRESOLVED_CONFLICT,
        message: "git status output",
        repoName: "repo-alpha",
      },
      "project-2": {
        status: "syncError",
        message: "other error",
        repoName: "repo-beta",
      },
    },
  );

  assert.deepEqual(entries.map((entry) => entry.projectId), ["project-1"]);
  assert.equal(entries[0]?.title, "Alpha");
  assert.equal(entries[0]?.snapshot?.message, "git status output");
});

test("buildProjectRepoFallbackConflictRecoveryInput scopes overwrite input to conflicted projects", () => {
  const input = buildProjectRepoFallbackConflictRecoveryInput(
    { installationId: 55 },
    [
      {
        id: "project-1",
        name: "repo-alpha",
        fullName: "org/repo-alpha",
      },
      {
        id: "project-2",
        name: "repo-beta",
        fullName: "org/repo-beta",
      },
    ],
    [],
    {
      "project-1": { status: PROJECT_REPO_SYNC_STATUS_UNRESOLVED_CONFLICT },
      "project-2": { status: "dirtyLocal" },
    },
  );

  assert.deepEqual(input, {
    installationId: 55,
    projects: [
      {
        projectId: "project-1",
        repoName: "repo-alpha",
        fullName: "org/repo-alpha",
        repoId: null,
        defaultBranchName: null,
        defaultBranchHeadOid: null,
      },
    ],
  });
});

test("projectRepoSyncNeedsFallbackConflictRecovery only matches the fallback status", () => {
  assert.equal(projectRepoSyncNeedsFallbackConflictRecovery({
    status: PROJECT_REPO_SYNC_STATUS_UNRESOLVED_CONFLICT,
  }), true);
  assert.equal(projectRepoSyncNeedsFallbackConflictRecovery({ status: "syncError" }), false);
});
