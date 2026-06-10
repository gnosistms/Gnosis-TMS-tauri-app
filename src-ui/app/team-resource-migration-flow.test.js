import test from "node:test";
import assert from "node:assert/strict";

let invokeHandler = async () => null;

async function dispatchMockInvoke(command, payload) {
  if (command === "list_gnosis_resources_for_installation") {
    // The migration flow only reads glossaries and QA lists from the combined listing
    // (projects come from options.remoteProjects or its own legacy call), so the
    // fan-out skips the projects handler.
    const legacyList = async (legacyCommand) => {
      const result = await invokeHandler(legacyCommand, payload);
      return Array.isArray(result) ? result : [];
    };
    return {
      projects: [],
      glossaries: await legacyList("list_gnosis_glossaries_for_installation"),
      qaLists: await legacyList("list_gnosis_qa_lists_for_installation"),
      digest: "",
    };
  }
  return invokeHandler(command, payload);
}

globalThis.document = globalThis.document ?? {
  querySelector: () => null,
  querySelectorAll: () => [],
};
globalThis.window = globalThis.window ?? {};
globalThis.window.__TAURI__ = {
  core: {
    invoke: (command, payload) => dispatchMockInvoke(command, payload),
  },
};
globalThis.window.requestAnimationFrame = (callback) => {
  callback();
  return 1;
};

const { resetSessionState, state } = await import("./state.js");
const { queryClient } = await import("./query-client.js");
const {
  runTeamResourceMigrationSync,
} = await import("./team-resource-migration-flow.js");

test.afterEach(() => {
  queryClient.clear();
});

function setupTeamMigrationTest() {
  resetSessionState();
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

function isLocalMetadataListCommand(command) {
  return command === "list_local_gnosis_project_metadata_records"
    || command === "list_local_gnosis_glossary_metadata_records"
    || command === "list_local_gnosis_qa_list_metadata_records";
}

test("team resource migration keeps one modal open across follow-up pending scans", async () => {
  setupTeamMigrationTest();

  const commands = [];
  let pendingScanCount = 0;
  invokeHandler = async (command, payload = {}) => {
    commands.push(command);
    if (isLocalMetadataListCommand(command)) {
      return [];
    }
    if (command === "list_gnosis_projects_for_installation") {
      return [];
    }
    if (command === "list_gnosis_glossaries_for_installation") {
      return [{
        glossaryId: "glossary-1",
        name: "glossary-repo",
        fullName: "team/glossary-repo",
        defaultBranchName: "main",
      }];
    }
    if (command === "list_gnosis_qa_lists_for_installation") {
      return [{
        qaListId: "qa-1",
        name: "qa-repo",
        fullName: "team/qa-repo",
        defaultBranchName: "main",
      }];
    }
    if (command === "list_pending_team_repo_layout_migrations") {
      pendingScanCount += 1;
      if (pendingScanCount === 1) {
        return {
          targetVersion: "0.8.10",
          migrations: [{
            resourceType: "glossary",
            resourceId: "glossary-1",
            repoName: "glossary-repo",
            title: "Shared Glossary",
          }],
        };
      }
      if (pendingScanCount === 2) {
        return {
          targetVersion: "0.8.10",
          migrations: [{
            resourceType: "qaList",
            resourceId: "qa-1",
            repoName: "qa-repo",
            title: "QA Terms",
          }],
        };
      }
      return {
        targetVersion: "0.8.10",
        migrations: [],
      };
    }
    if (command === "sync_gtms_glossary_repos") {
      assert.equal(payload.input.glossaries.length, 1);
      return [{ status: "ready", repoName: "glossary-repo" }];
    }
    if (command === "sync_gtms_qa_list_repos") {
      assert.equal(payload.input.qaLists.length, 1);
      return [{ status: "ready", repoName: "qa-repo" }];
    }
    throw new Error(`Unexpected command: ${command}`);
  };

  const visibleModalTokens = [];
  const visibleMessages = [];
  const render = () => {
    if (state.teamResourceMigrationModal.isOpen) {
      visibleModalTokens.push(state.teamResourceMigrationModal.token);
      visibleMessages.push(state.teamResourceMigrationModal.message);
    }
  };

  const migrated = await runTeamResourceMigrationSync(render, state.teams[0]);

  assert.equal(migrated, true);
  assert.equal(state.teamResourceMigrationModal.isOpen, false);
  assert.deepEqual([...new Set(visibleModalTokens)], [visibleModalTokens[0]]);
  assert.equal(commands.filter((command) => command === "sync_gtms_glossary_repos").length, 1);
  assert.equal(commands.filter((command) => command === "sync_gtms_qa_list_repos").length, 1);
  assert.equal(commands.filter((command) => command === "list_pending_team_repo_layout_migrations").length, 3);
  assert.ok(visibleMessages.includes("Migrating glossaries: Shared Glossary"));
  assert.ok(visibleMessages.includes("Migrating QA lists: QA Terms"));
});

test("team resource migration excludes deleted tombstones from pending scan candidates", async () => {
  setupTeamMigrationTest();

  let pendingScanPayload = null;
  invokeHandler = async (command, payload = {}) => {
    if (isLocalMetadataListCommand(command)) {
      return [];
    }
    if (command === "list_gnosis_projects_for_installation") {
      return [{
        projectId: "project-live",
        name: "project-live",
        fullName: "team/project-live",
        lifecycleState: "active",
        recordState: "live",
      }, {
        projectId: "project-deleted",
        name: "project-deleted",
        fullName: "team/project-deleted",
        lifecycleState: "softDeleted",
        recordState: "tombstone",
      }];
    }
    if (command === "list_gnosis_glossaries_for_installation") {
      return [{
        glossaryId: "glossary-deleted",
        name: "glossary-deleted",
        fullName: "team/glossary-deleted",
        lifecycleState: "softDeleted",
        recordState: "tombstone",
        remoteState: "deleted",
      }];
    }
    if (command === "list_gnosis_qa_lists_for_installation") {
      return [{
        qaListId: "qa-deleted",
        name: "qa-deleted",
        fullName: "team/qa-deleted",
        lifecycleState: "deleted",
        recordState: "tombstone",
      }];
    }
    if (command === "list_pending_team_repo_layout_migrations") {
      pendingScanPayload = payload.input;
      return {
        targetVersion: "0.8.10",
        migrations: [],
      };
    }
    throw new Error(`Unexpected command: ${command}`);
  };

  const migrated = await runTeamResourceMigrationSync(() => {}, state.teams[0]);

  assert.equal(migrated, false);
  assert.equal(state.teamResourceMigrationModal.isOpen, false);
  assert.deepEqual(pendingScanPayload.projects.map((project) => project.repoName), [
    "project-live",
  ]);
  assert.deepEqual(pendingScanPayload.glossaries, []);
  assert.deepEqual(pendingScanPayload.qaLists, []);
});

test("team resource migration excludes remote repos deleted in local metadata", async () => {
  setupTeamMigrationTest();

  let pendingScanPayload = null;
  invokeHandler = async (command, payload = {}) => {
    if (command === "list_gnosis_projects_for_installation") {
      return [];
    }
    if (command === "list_gnosis_glossaries_for_installation") {
      return [{
        glossaryId: "glossary-deleted",
        name: "glossary-deleted",
        fullName: "team/glossary-deleted",
        defaultBranchName: "main",
      }];
    }
    if (command === "list_gnosis_qa_lists_for_installation") {
      return [{
        qaListId: "qa-deleted",
        name: "qa-deleted",
        fullName: "team/qa-deleted",
        defaultBranchName: "main",
      }];
    }
    if (command === "list_local_gnosis_project_metadata_records") {
      return [];
    }
    if (command === "list_local_gnosis_glossary_metadata_records") {
      return [{
        id: "glossary-deleted",
        repoName: "glossary-deleted",
        title: "Deleted glossary",
        lifecycleState: "deleted",
        recordState: "live",
        remoteState: "linked",
      }];
    }
    if (command === "list_local_gnosis_qa_list_metadata_records") {
      return [{
        id: "qa-deleted",
        repoName: "qa-deleted",
        title: "Deleted QA",
        lifecycleState: "deleted",
        recordState: "live",
        remoteState: "linked",
      }];
    }
    if (command === "list_pending_team_repo_layout_migrations") {
      pendingScanPayload = payload.input;
      return {
        targetVersion: "0.8.10",
        migrations: [],
      };
    }
    throw new Error(`Unexpected command: ${command}`);
  };

  const migrated = await runTeamResourceMigrationSync(() => {}, state.teams[0]);

  assert.equal(migrated, false);
  assert.deepEqual(pendingScanPayload.glossaries, []);
  assert.deepEqual(pendingScanPayload.qaLists, []);
});

test("team resource migration ignores missing local repos because normal sync downloads them", async () => {
  setupTeamMigrationTest();

  const commands = [];
  invokeHandler = async (command) => {
    commands.push(command);
    if (isLocalMetadataListCommand(command)) {
      return [];
    }
    if (command === "list_gnosis_projects_for_installation") {
      return [{
        id: "project-1",
        name: "project-repo",
        title: "Project",
        fullName: "team/project-repo",
        defaultBranchName: "main",
      }];
    }
    if (
      command === "list_gnosis_glossaries_for_installation"
      || command === "list_gnosis_qa_lists_for_installation"
    ) {
      return [];
    }
    if (command === "list_pending_team_repo_layout_migrations") {
      return {
        targetVersion: "0.8.10",
        migrations: [{
          resourceType: "project",
          resourceId: "project-1",
          repoName: "project-repo",
          title: "Project",
          migrationReason: "missingLocal",
        }],
      };
    }
    throw new Error(`Unexpected command: ${command}`);
  };

  const migrated = await runTeamResourceMigrationSync(() => {}, state.teams[0]);

  assert.equal(migrated, false);
  assert.equal(state.teamResourceMigrationModal.isOpen, false);
  assert.equal(commands.includes("reconcile_project_repo_sync_states"), false);
});

test("team resource migration reports incomplete repeated pending work", async () => {
  setupTeamMigrationTest();

  const project = {
    id: "project-1",
    name: "project-repo",
    title: "Project",
    fullName: "team/project-repo",
    defaultBranchName: "main",
    defaultBranchHeadOid: "remote-head",
  };
  invokeHandler = async (command) => {
    if (isLocalMetadataListCommand(command)) {
      return [];
    }
    if (command === "list_gnosis_projects_for_installation") {
      return [project];
    }
    if (
      command === "list_gnosis_glossaries_for_installation"
      || command === "list_gnosis_qa_lists_for_installation"
    ) {
      return [];
    }
    if (command === "list_pending_team_repo_layout_migrations") {
      return {
        targetVersion: "0.8.10",
        migrations: [{
          resourceType: "project",
          resourceId: "project-1",
          repoName: "project-repo",
          title: "Project",
        }],
      };
    }
    if (command === "reconcile_project_repo_sync_states") {
      return [{
        projectId: "project-1",
        repoName: "project-repo",
        status: "upToDate",
      }];
    }
    throw new Error(`Unexpected command: ${command}`);
  };

  await assert.rejects(
    () => runTeamResourceMigrationSync(() => {}, state.teams[0]),
    /Could not finish the 0\.8\.10 data migration/,
  );
  assert.equal(state.teamResourceMigrationModal.isOpen, false);
});

test("team resource migration reuses a caller-provided remote project listing", async () => {
  setupTeamMigrationTest();

  let pendingScanPayload = null;
  invokeHandler = async (command, payload = {}) => {
    if (isLocalMetadataListCommand(command)) {
      return [];
    }
    if (command === "list_gnosis_projects_for_installation") {
      throw new Error("Should reuse the caller-provided listing instead of refetching");
    }
    if (command === "list_gnosis_glossaries_for_installation") {
      return [];
    }
    if (command === "list_gnosis_qa_lists_for_installation") {
      return [];
    }
    if (command === "list_pending_team_repo_layout_migrations") {
      pendingScanPayload = payload.input;
      return {
        targetVersion: "0.8.10",
        migrations: [],
      };
    }
    throw new Error(`Unexpected command: ${command}`);
  };

  const migrated = await runTeamResourceMigrationSync(() => {}, state.teams[0], {
    remoteProjects: [{
      projectId: "project-live",
      name: "project-live",
      fullName: "team/project-live",
      lifecycleState: "active",
      recordState: "live",
    }],
  });

  assert.equal(migrated, false);
  assert.deepEqual(pendingScanPayload.projects.map((project) => project.repoName), [
    "project-live",
  ]);
});

const { setActiveStorageLogin } = await import("./team-storage.js");

test("team resource migration skips rescans after a clean verdict", async () => {
  setupTeamMigrationTest();
  state.teams[0].installationId = 71;
  setActiveStorageLogin("verdict-tester");

  const commands = [];
  invokeHandler = async (command) => {
    commands.push(command);
    if (isLocalMetadataListCommand(command)) {
      return [];
    }
    if (
      command === "list_gnosis_projects_for_installation"
      || command === "list_gnosis_glossaries_for_installation"
      || command === "list_gnosis_qa_lists_for_installation"
    ) {
      return [];
    }
    if (command === "list_pending_team_repo_layout_migrations") {
      return { targetVersion: "0.8.10", migrations: [] };
    }
    throw new Error(`Unexpected command: ${command}`);
  };

  try {
    const firstRun = await runTeamResourceMigrationSync(() => {}, state.teams[0]);
    assert.equal(firstRun, false);
    assert.ok(commands.includes("list_pending_team_repo_layout_migrations"));

    commands.length = 0;
    const secondRun = await runTeamResourceMigrationSync(() => {}, state.teams[0]);
    assert.equal(secondRun, false);
    assert.deepEqual(commands, []);
  } finally {
    setActiveStorageLogin(null);
  }
});

test("team resource migration keeps rescanning until a scan comes back clean", async () => {
  setupTeamMigrationTest();
  state.teams[0].installationId = 72;
  setActiveStorageLogin("verdict-tester");

  let pendingScanCount = 0;
  invokeHandler = async (command) => {
    if (isLocalMetadataListCommand(command)) {
      return [];
    }
    if (
      command === "list_gnosis_projects_for_installation"
      || command === "list_gnosis_qa_lists_for_installation"
    ) {
      return [];
    }
    if (command === "list_gnosis_glossaries_for_installation") {
      return [{
        glossaryId: "glossary-1",
        name: "glossary-repo",
        fullName: "team/glossary-repo",
        defaultBranchName: "main",
      }];
    }
    if (command === "list_pending_team_repo_layout_migrations") {
      pendingScanCount += 1;
      return {
        targetVersion: "0.8.10",
        migrations: [{
          resourceType: "glossary",
          resourceId: "glossary-1",
          repoName: "glossary-repo",
          title: "Shared Glossary",
        }],
      };
    }
    if (command === "sync_gtms_glossary_repos") {
      throw new Error("sync failed");
    }
    throw new Error(`Unexpected command: ${command}`);
  };

  try {
    await assert.rejects(() => runTeamResourceMigrationSync(() => {}, state.teams[0]));
    const scansAfterFailure = pendingScanCount;
    assert.ok(scansAfterFailure >= 1);

    // The failed run must not have stored a clean verdict: the next run scans again.
    await assert.rejects(() => runTeamResourceMigrationSync(() => {}, state.teams[0]));
    assert.ok(pendingScanCount > scansAfterFailure);
  } finally {
    setActiveStorageLogin(null);
  }
});
