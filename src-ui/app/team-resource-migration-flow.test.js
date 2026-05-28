import test from "node:test";
import assert from "node:assert/strict";

let invokeHandler = async () => null;

globalThis.document = globalThis.document ?? {
  querySelector: () => null,
  querySelectorAll: () => [],
};
globalThis.window = globalThis.window ?? {};
globalThis.window.__TAURI__ = {
  core: {
    invoke: (command, payload) => invokeHandler(command, payload),
  },
};
globalThis.window.requestAnimationFrame = (callback) => {
  callback();
  return 1;
};

const { resetSessionState, state } = await import("./state.js");
const {
  runTeamResourceMigrationSync,
} = await import("./team-resource-migration-flow.js");

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

test("team resource migration keeps one modal open across follow-up pending scans", async () => {
  setupTeamMigrationTest();

  const commands = [];
  let pendingScanCount = 0;
  invokeHandler = async (command, payload = {}) => {
    commands.push(command);
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
