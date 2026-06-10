import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  findConfirmedMissingProjectRecords,
  mergeMetadataDiscoveryProjects,
} from "./project-discovery.js";

let invokeHandler = async () => null;

globalThis.document = globalThis.document ?? {
  querySelector: () => null,
  querySelectorAll: () => [],
};
globalThis.window = globalThis.window ?? {
  __TAURI__: {
    core: {
      invoke: (command, payload) => invokeHandler(command, payload),
    },
  },
  requestAnimationFrame: (callback) => setTimeout(callback, 0),
  setTimeout,
  clearTimeout,
};
globalThis.window.__TAURI__ = globalThis.window.__TAURI__ ?? {};
globalThis.window.__TAURI__.core = {
  invoke: (command, payload) => invokeHandler(command, payload),
};

const { resetSessionState, state } = await import("./state.js");
const { queryClient } = await import("./query-client.js");
const {
  applyProjectSnapshotToState,
} = await import("./project-top-level-state.js");
const {
  loadProjectSnapshotForTeam,
} = await import("./project-discovery-flow.js");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function projectMetadataRecord(overrides = {}) {
  return {
    id: "project-1",
    title: "Local Project",
    repoName: "project-repo",
    fullName: "team/project-repo",
    lifecycleState: "active",
    remoteState: "linked",
    recordState: "live",
    defaultBranch: "main",
    chapterCount: 1,
    ...overrides,
  };
}

function renderSnapshot() {
  return {
    status: state.projectDiscovery.status,
    projects: state.projects.map((project) => project.title),
    deletedProjects: state.deletedProjects.map((project) => project.title),
  };
}

function setupProjectDiscoveryFlowTest() {
  resetSessionState();
  state.screen = "projects";
  state.selectedTeamId = "team-1";
  state.teams = [{
    id: "team-1",
    name: "Team",
    githubOrg: "team",
    installationId: 1,
  }];
  state.auth.session = { sessionToken: "token" };
  state.offline.isEnabled = false;
}

function projectDiscoveryOptions(overrides = {}) {
  const options = {
    loadStoredProjectsForTeam: () => ({ exists: false, projects: [], deletedProjects: [] }),
    setProjectDiscoveryState: (status, error = "", glossaryWarning = "", recoveryMessage = "") => {
      state.projectDiscovery = { status, error, glossaryWarning, recoveryMessage };
    },
    setProjectUiDebug: () => {},
    clearProjectUiDebug: () => {},
    persistProjectsForTeam: () => {},
    applyChapterPendingMutation: (snapshot) => snapshot,
    normalizeListedChapter: (chapter) => chapter,
    projectMetadataRecordIsTombstone: (record) =>
      record?.recordState === "tombstone" || record?.remoteState === "deleted",
    projectMatchesMetadataRecord: (project, record) => project?.id === record?.id,
    purgeLocalProjectRepo: async () => {},
    removeVisibleProject: () => {},
    clearSelectedProjectState: () => {},
    dropProjectMutationsForProject: () => {},
    upsertProjectMetadataRecord: async () => {},
    reconcileExpandedDeletedFiles: () => {},
    ...overrides,
  };
  if (typeof options.publishProjectLoadSnapshot !== "function") {
    options.publishProjectLoadSnapshot = ({
      render,
      selectedTeam,
      snapshot,
      discovery,
      glossaries,
      pendingChapterMutations,
      repoSyncByProjectId,
      persist = false,
    } = {}) => {
      applyProjectSnapshotToState(snapshot, {
        reconcileExpandedDeletedFiles: options.reconcileExpandedDeletedFiles,
      });
      if (discovery) {
        options.setProjectDiscoveryState(
          discovery.status ?? "ready",
          discovery.error ?? "",
          discovery.glossaryWarning ?? "",
          discovery.recoveryMessage ?? "",
        );
      }
      if (Array.isArray(glossaries)) {
        state.glossaries = glossaries;
      }
      if (Array.isArray(pendingChapterMutations)) {
        state.pendingChapterMutations = pendingChapterMutations;
      }
      if (repoSyncByProjectId && typeof repoSyncByProjectId === "object") {
        state.projectRepoSyncByProjectId = repoSyncByProjectId;
      }
      if (persist) {
        options.persistProjectsForTeam(selectedTeam);
      }
      render?.();
    };
  }
  if (typeof options.publishProjectDiscoveryState !== "function") {
    options.publishProjectDiscoveryState = ({
      render,
      discovery,
    } = {}) => {
      if (discovery) {
        options.setProjectDiscoveryState(
          discovery.status ?? "ready",
          discovery.error ?? "",
          discovery.glossaryWarning ?? "",
          discovery.recoveryMessage ?? "",
        );
      }
      render?.();
    };
  }
  return options;
}

function installProjectDiscoveryInvokeMock({
  localMetadata = [projectMetadataRecord()],
  remoteMetadata = localMetadata,
  remoteProjectsPromise = Promise.resolve([]),
  localProjectFiles = [{
    projectId: "project-1",
    repoName: "project-repo",
    chapters: [{ id: "chapter-1", name: "Chapter", status: "active" }],
  }],
  localProjectFilesResults = null,
  repairResults = [{ issues: [], autoRepairedCount: 0 }],
  repoSyncSnapshots = [],
  failFirstProjectMetadataRead = false,
} = {}) {
  let projectMetadataReads = 0;
  let localProjectFileReads = 0;
  let repairReads = 0;
  invokeHandler = async (command) => {
    if (command === "list_local_gnosis_project_metadata_records") {
      projectMetadataReads += 1;
      if (failFirstProjectMetadataRead && projectMetadataReads === 1) {
        throw new Error("local scan failed");
      }
      return projectMetadataReads === 1 ? localMetadata : remoteMetadata;
    }
    if (command === "list_local_gtms_project_files") {
      if (Array.isArray(localProjectFilesResults)) {
        const index = Math.min(localProjectFileReads, localProjectFilesResults.length - 1);
        localProjectFileReads += 1;
        return localProjectFilesResults[index] ?? [];
      }
      return localProjectFiles;
    }
    if (command === "list_gnosis_projects_for_installation") {
      return remoteProjectsPromise;
    }
    if (command === "list_gnosis_resources_for_installation") {
      // The combined listing carries the same projects payload (and failure) the
      // legacy per-type commands did.
      const projects = await remoteProjectsPromise;
      return {
        projects: Array.isArray(projects) ? projects : [],
        glossaries: [],
        qaLists: [],
        digest: "",
      };
    }
    if (command === "sync_local_team_metadata_repo" || command === "ensure_local_team_metadata_repo") {
      return null;
    }
    if (command === "inspect_and_migrate_local_repo_bindings") {
      const index = Math.min(repairReads, repairResults.length - 1);
      repairReads += 1;
      return repairResults[index] ?? { issues: [], autoRepairedCount: 0 };
    }
    if (command === "list_local_gtms_glossaries") {
      return [];
    }
    if (command === "list_local_gnosis_glossary_metadata_records") {
      return [];
    }
    if (command === "list_gnosis_glossaries_for_installation") {
      return [];
    }
    if (command === "sync_gtms_glossary_repos") {
      return [];
    }
    if (command === "reconcile_project_repo_sync_states" || command === "list_project_repo_sync_states") {
      return repoSyncSnapshots;
    }
    return null;
  };
}

test.afterEach(() => {
  invokeHandler = async () => null;
  resetSessionState();
  queryClient.clear();
});

test("local project file listing uses a bounded repo-write wait", async () => {
  const source = await readFile(new URL("./project-discovery-flow.js", import.meta.url), "utf8");

  assert.match(source, /const LOCAL_PROJECT_FILE_LISTING_REPO_WAIT_MS = 1200;/);
  assert.match(source, /const repoWriteWait = Promise\.all\(/);
  assert.match(source, /await Promise\.race\(\[/);
  assert.match(source, /globalThis\.setTimeout\(resolve, LOCAL_PROJECT_FILE_LISTING_REPO_WAIT_MS\);/);
  assert.match(source, /invoke\("list_local_gtms_project_files"/);
});

test("metadata-backed project discovery ignores remote repos that have no metadata record", () => {
  const merged = mergeMetadataDiscoveryProjects({
    metadataRecords: [
      {
        id: "project-1",
        title: "Project 1",
        repoName: "project-1",
        lifecycleState: "active",
        remoteState: "linked",
        recordState: "live",
        fullName: "team/project-1",
      },
    ],
    remoteProjects: [
      {
        id: "project-1",
        name: "project-1",
        title: "Project 1",
        fullName: "team/project-1",
      },
      {
        id: "project-2",
        name: "project-2",
        title: "Project 2",
        fullName: "team/project-2",
      },
    ],
    localProjects: [],
    metadataLoaded: true,
    remoteLoaded: true,
  });

  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, "project-1");
});

test("project discovery still falls back to remote repos when metadata could not be loaded", () => {
  const merged = mergeMetadataDiscoveryProjects({
    metadataRecords: [],
    remoteProjects: [
      {
        id: "project-2",
        name: "project-2",
        title: "Project 2",
        fullName: "team/project-2",
      },
    ],
    localProjects: [],
    metadataLoaded: false,
    remoteLoaded: true,
  });

  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, "project-2");
  assert.equal(merged[0].remoteState, "linked");
});

test("project discovery hides tombstoned metadata records", () => {
  const merged = mergeMetadataDiscoveryProjects({
    metadataRecords: [
      {
        id: "project-1",
        title: "Project 1",
        repoName: "project-1",
        lifecycleState: "softDeleted",
        remoteState: "deleted",
        recordState: "tombstone",
        fullName: "team/project-1",
      },
    ],
    remoteProjects: [],
    localProjects: [
      {
        id: "project-1",
        name: "project-1",
        title: "Project 1",
        fullName: "team/project-1",
        recordState: "tombstone",
      },
    ],
    metadataLoaded: true,
    remoteLoaded: true,
  });

  assert.equal(merged.length, 0);
});

test("project discovery maps softDeleted metadata records into deleted visible projects", () => {
  const merged = mergeMetadataDiscoveryProjects({
    metadataRecords: [
      {
        id: "project-1",
        title: "Project 1",
        repoName: "project-1",
        lifecycleState: "softDeleted",
        remoteState: "deleted",
        recordState: "live",
        fullName: "team/project-1",
      },
    ],
    remoteProjects: [],
    localProjects: [],
    metadataLoaded: true,
    remoteLoaded: true,
  });

  assert.equal(merged.length, 1);
  assert.equal(merged[0].status, "deleted");
  assert.equal(merged[0].lifecycleState, "deleted");
});

test("project discovery surfaces repair issues from local repo scans", () => {
  const merged = mergeMetadataDiscoveryProjects({
    metadataRecords: [
      {
        id: "project-1",
        title: "Project 1",
        repoName: "project-1",
        lifecycleState: "active",
        remoteState: "linked",
        recordState: "live",
        fullName: "team/project-1",
      },
    ],
    remoteProjects: [],
    localProjects: [],
    metadataLoaded: true,
    remoteLoaded: false,
    repairIssues: [
      {
        kind: "project",
        issueType: "missingLocalRepo",
        resourceId: "project-1",
        expectedRepoName: "project-1",
        message: "Team metadata references this project, but its local repo is missing.",
      },
    ],
  });

  assert.equal(merged.length, 1);
  assert.equal(merged[0].resolutionState, "repair");
  assert.match(merged[0].repairIssueMessage, /local repo is missing/i);
});

test("project discovery matches renamed remote repos by stable github repo identity", () => {
  const merged = mergeMetadataDiscoveryProjects({
    metadataRecords: [
      {
        id: "project-1",
        title: "Project 1",
        repoName: "old-project-name",
        lifecycleState: "active",
        remoteState: "linked",
        recordState: "live",
        fullName: "team/old-project-name",
        githubRepoId: 42,
      },
    ],
    remoteProjects: [
      {
        id: "project-remote",
        repoId: 42,
        name: "new-project-name",
        title: "Project 1",
        fullName: "team/new-project-name",
      },
    ],
    localProjects: [],
    metadataLoaded: true,
    remoteLoaded: true,
  });

  assert.equal(merged.length, 1);
  assert.equal(merged[0].remoteState, "linked");
  assert.equal(merged[0].resolutionState, "");
  assert.equal(merged[0].repoId, 42);
  assert.equal(merged[0].fullName, "team/new-project-name");
});

test("project discovery identifies live linked metadata records whose remote repo is gone", () => {
  const missing = findConfirmedMissingProjectRecords(
    [
      {
        id: "project-1",
        title: "Project 1",
        repoName: "project-1",
        lifecycleState: "active",
        remoteState: "linked",
        recordState: "live",
        fullName: "team/project-1",
      },
      {
        id: "project-2",
        title: "Project 2",
        repoName: "old-project-2",
        lifecycleState: "active",
        remoteState: "linked",
        recordState: "live",
        fullName: "team/old-project-2",
        githubRepoId: 42,
      },
    ],
    [
      {
        id: "remote-2",
        repoId: 42,
        name: "new-project-2",
        title: "Project 2",
        fullName: "team/new-project-2",
      },
    ],
  );

  assert.deepEqual(missing.map((record) => record.id), ["project-1"]);
});

test("project discovery drops stale cached local projects once metadata and repo scan are authoritative", () => {
  const merged = mergeMetadataDiscoveryProjects({
    metadataRecords: [],
    remoteProjects: [],
    localProjects: [
      {
        id: "project-1",
        name: "project-1",
        title: "Project 1",
        remoteState: "missing",
        recordState: "live",
      },
    ],
    metadataLoaded: true,
    remoteLoaded: true,
    repairLoaded: true,
    repairIssues: [],
  });

  assert.equal(merged.length, 0);
});

test("project discovery keeps real stray local repos after the repo scan", () => {
  const merged = mergeMetadataDiscoveryProjects({
    metadataRecords: [],
    remoteProjects: [],
    localProjects: [
      {
        id: "project-1",
        name: "project-1",
        title: "Project 1",
        recordState: "live",
      },
    ],
    metadataLoaded: true,
    remoteLoaded: true,
    repairLoaded: true,
    repairIssues: [
      {
        kind: "project",
        issueType: "strayLocalRepo",
        repoName: "project-1",
        message: "This local project repo has no matching team-metadata record and was left as a repair candidate.",
      },
    ],
  });

  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, "project-1");
  assert.equal(merged[0].resolutionState, "repair");
  assert.equal(merged[0].repairIssueType, "strayLocalRepo");
});

test("project loading renders local metadata and files before remote refresh finishes", async () => {
  setupProjectDiscoveryFlowTest();
  const remoteProjects = deferred();
  installProjectDiscoveryInvokeMock({
    localMetadata: [projectMetadataRecord({ title: "Local Project" })],
    remoteMetadata: [projectMetadataRecord({ title: "Remote Project" })],
    remoteProjectsPromise: remoteProjects.promise,
  });
  const renders = [];
  const progressEvents = [];
  const loadPromise = loadProjectSnapshotForTeam(
    () => renders.push(renderSnapshot()),
    "team-1",
    projectDiscoveryOptions({
      onProjectLoadProgress: (event) => progressEvents.push(event),
    }),
  );

  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(state.projectDiscovery.status, "ready");
  assert.deepEqual(state.projects.map((project) => project.title), ["Local Project"]);
  assert.ok(renders.some((snapshot) => snapshot.projects.includes("Local Project")));

  remoteProjects.resolve([{
    id: "project-1",
    name: "project-repo",
    title: "Remote Project",
    fullName: "team/project-repo",
    defaultBranchName: "main",
  }]);
  await loadPromise;

  assert.deepEqual(state.projects.map((project) => project.title), ["Remote Project"]);
  assert.ok(renders.some((snapshot) => snapshot.projects.includes("Remote Project")));
  assert.ok(progressEvents.some((event) =>
    event.type === "localSnapshot"
    && event.snapshot.items.some((project) => project.title === "Local Project")
  ));
  assert.ok(progressEvents.some((event) => event.type === "remoteSyncStarted"));
  assert.ok(progressEvents.some((event) =>
    event.type === "remoteSnapshot"
    && event.snapshot.items.some((project) => project.title === "Remote Project")
  ));
});

test("direct project snapshot loading does not own projects page sync state", async () => {
  setupProjectDiscoveryFlowTest();
  const remoteProjects = deferred();
  installProjectDiscoveryInvokeMock({
    localMetadata: [projectMetadataRecord({ title: "Local Project" })],
    remoteMetadata: [projectMetadataRecord({ title: "Remote Project" })],
    remoteProjectsPromise: remoteProjects.promise,
  });

  const loadPromise = loadProjectSnapshotForTeam(
    () => {},
    "team-1",
    projectDiscoveryOptions(),
  );

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(state.projectsPageSync.status, "idle");

  remoteProjects.resolve([{
    id: "project-1",
    name: "project-repo",
    title: "Remote Project",
    fullName: "team/project-repo",
    defaultBranchName: "main",
  }]);
  await loadPromise;

  assert.equal(state.projectsPageSync.status, "idle");
});

test("direct project snapshot loading without publisher returns data without mutating visible projects", async () => {
  setupProjectDiscoveryFlowTest();
  installProjectDiscoveryInvokeMock({
    localMetadata: [projectMetadataRecord({ title: "Local Project" })],
    remoteMetadata: [projectMetadataRecord({ title: "Remote Project" })],
    remoteProjectsPromise: Promise.resolve([{
      id: "project-1",
      name: "project-repo",
      title: "Remote Project",
      fullName: "team/project-repo",
      defaultBranchName: "main",
    }]),
  });

  const options = projectDiscoveryOptions();
  delete options.publishProjectLoadSnapshot;
  delete options.publishProjectDiscoveryState;
  const beforeDiscovery = { ...state.projectDiscovery };

  const result = await loadProjectSnapshotForTeam(
    () => {},
    "team-1",
    options,
  );

  assert.deepEqual(result.items.map((project) => project.title), ["Remote Project"]);
  assert.deepEqual(state.projects, []);
  assert.deepEqual(state.deletedProjects, []);
  assert.deepEqual(state.projectDiscovery, beforeDiscovery);
});

test("project loading clears stale missing-local-repo repair after repo sync clones files", async () => {
  setupProjectDiscoveryFlowTest();
  const missingLocalRepoIssue = {
    kind: "project",
    issueType: "missingLocalRepo",
    resourceId: "project-1",
    expectedRepoName: "project-repo",
    message: "Team metadata references this project, but its local repo is missing.",
  };
  installProjectDiscoveryInvokeMock({
    localMetadata: [projectMetadataRecord({ title: "Remote Project" })],
    remoteMetadata: [projectMetadataRecord({ title: "Remote Project" })],
    remoteProjectsPromise: Promise.resolve([{
      id: "project-1",
      name: "project-repo",
      title: "Remote Project",
      fullName: "team/project-repo",
      defaultBranchName: "main",
      defaultBranchHeadOid: "remote-head",
    }]),
    localProjectFilesResults: [
      // Initial local scan (before repo sync clones the repo) finds nothing; the post-sync
      // refresh sees the cloned chapters.
      [],
      [{
        projectId: "project-1",
        repoName: "project-repo",
        chapters: [{ id: "chapter-1", name: "Chapter", status: "active" }],
      }],
    ],
    repairResults: [
      { issues: [missingLocalRepoIssue], autoRepairedCount: 0 },
      { issues: [missingLocalRepoIssue], autoRepairedCount: 0 },
      { issues: [], autoRepairedCount: 0 },
    ],
    repoSyncSnapshots: [{
      projectId: "project-1",
      repoName: "project-repo",
      status: "upToDate",
      message: null,
    }],
  });

  await loadProjectSnapshotForTeam(
    () => {},
    "team-1",
    projectDiscoveryOptions(),
  );

  assert.equal(state.projects.length, 1);
  assert.equal(state.projects[0].resolutionState, "");
  assert.equal(state.projects[0].repairIssueType, "");
  assert.equal(state.projects[0].chapters.length, 1);
});

test("project loading stays loading when local metadata is empty and remote is pending", async () => {
  setupProjectDiscoveryFlowTest();
  const remoteProjects = deferred();
  installProjectDiscoveryInvokeMock({
    localMetadata: [],
    remoteMetadata: [],
    remoteProjectsPromise: remoteProjects.promise,
    localProjectFiles: [],
  });
  const renders = [];
  const loadPromise = loadProjectSnapshotForTeam(
    () => renders.push(renderSnapshot()),
    "team-1",
    projectDiscoveryOptions(),
  );

  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(state.projectDiscovery.status, "loading");
  assert.deepEqual(state.projects, []);
  assert.ok(renders.some((snapshot) => snapshot.status === "loading" && snapshot.projects.length === 0));

  remoteProjects.resolve([]);
  await loadPromise;

  assert.equal(state.projectDiscovery.status, "ready");
  assert.deepEqual(state.projects, []);
});

test("online project loading does not render persistent cache when local scan fails", async () => {
  setupProjectDiscoveryFlowTest();
  const remoteProjects = deferred();
  installProjectDiscoveryInvokeMock({
    localMetadata: [],
    remoteMetadata: [projectMetadataRecord({ title: "Remote Project" })],
    remoteProjectsPromise: remoteProjects.promise,
    localProjectFiles: [],
    failFirstProjectMetadataRead: true,
  });
  const renders = [];
  const loadPromise = loadProjectSnapshotForTeam(
    () => renders.push(renderSnapshot()),
    "team-1",
    projectDiscoveryOptions({
      loadStoredProjectsForTeam: () => ({
        exists: true,
        projects: [{
          id: "cached-project",
          name: "cached-project",
          title: "Cached Project",
          chapters: [],
        }],
        deletedProjects: [],
      }),
    }),
  );

  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(state.projectDiscovery.status, "loading");
  assert.deepEqual(state.projects, []);
  assert.ok(!renders.some((snapshot) => snapshot.projects.includes("Cached Project")));

  remoteProjects.resolve([{
    id: "project-1",
    name: "project-repo",
    title: "Remote Project",
    fullName: "team/project-repo",
    defaultBranchName: "main",
  }]);
  await loadPromise;

  assert.deepEqual(state.projects.map((project) => project.title), ["Remote Project"]);
  assert.ok(!renders.some((snapshot) => snapshot.projects.includes("Cached Project")));
});
