import test from "node:test";
import assert from "node:assert/strict";

const invokeCalls = [];
let invokeHandler = async () => null;

globalThis.document = {
  querySelector() {
    return null;
  },
  querySelectorAll() {
    return [];
  },
};

globalThis.window = {
  __TAURI__: {
    core: {
      invoke(command, payload) {
        invokeCalls.push({ command, payload });
        return invokeHandler(command, payload);
      },
    },
  },
  addEventListener() {},
  removeEventListener() {},
  requestAnimationFrame(callback) {
    return setTimeout(callback, 0);
  },
  setTimeout,
  clearTimeout,
};

const { createResourcePageState } = await import("./resource-page-controller.js");
const {
  confirmProjectPermanentDeletion,
} = await import("./project-flow.js");
const { queryClient } = await import("./query-client.js");
const { removePersistentValue } = await import("./persistent-store.js");
const { resetSessionState, state } = await import("./state.js");
const { setActiveStorageLogin } = await import("./team-storage.js");

const STORAGE_LOGIN = "project-flow-local-delete-test";
const LOCAL_HARD_DELETE_STORAGE_KEY = `gnosis-tms-local-hard-delete-tombstones:${STORAGE_LOGIN}`;
const PROJECT_CACHE_STORAGE_KEY = `gnosis-tms-project-cache:${STORAGE_LOGIN}`;

function deletedProject(overrides = {}) {
  return {
    id: "project-1",
    name: "project-repo",
    title: "Project",
    fullName: "team-1/project-repo",
    lifecycleState: "deleted",
    chapters: [],
    ...overrides,
  };
}

function setupProjectPermanentDeletionState() {
  resetSessionState();
  invokeCalls.length = 0;
  setActiveStorageLogin(STORAGE_LOGIN);

  const team = {
    id: "team-1",
    name: "Team 1",
    githubOrg: "team-1",
    installationId: 42,
    canLocalHardDelete: true,
  };
  const project = deletedProject();

  state.auth.session = { sessionToken: "token" };
  state.teams = [team];
  state.selectedTeamId = team.id;
  state.projectsPage = createResourcePageState();
  state.deletedProjects = [project];
  state.projectPermanentDeletion = {
    isOpen: true,
    status: "idle",
    error: "",
    projectId: project.id,
    projectName: project.title,
    confirmationText: project.title,
  };

  return { project, team };
}

test.afterEach(() => {
  queryClient.clear();
  invokeCalls.length = 0;
  invokeHandler = async () => null;
  removePersistentValue(LOCAL_HARD_DELETE_STORAGE_KEY);
  removePersistentValue(PROJECT_CACHE_STORAGE_KEY);
  setActiveStorageLogin(null);
  resetSessionState();
});

test("successful project local delete closes the modal with a full render", async () => {
  const { project, team } = setupProjectPermanentDeletionState();
  const renderCalls = [];
  const render = (options) => {
    renderCalls.push(options ?? null);
  };

  await confirmProjectPermanentDeletion(render);

  assert.deepEqual(
    invokeCalls.find((call) => call.command === "purge_local_gtms_project_repo"),
    {
      command: "purge_local_gtms_project_repo",
      payload: {
        input: {
          installationId: team.installationId,
          projectId: project.id,
          repoName: project.name,
        },
      },
    },
  );
  assert.equal(state.projectPermanentDeletion.isOpen, false);
  assert.equal(state.projectPermanentDeletion.status, "idle");
  assert.equal(state.deletedProjects.some((item) => item.id === project.id), false);
  assert.equal(renderCalls.at(-1), null);
  assert.ok(
    renderCalls.some((options) => options?.scope === "status-surface"),
    "expected the notice/status badge to request its scoped render",
  );
});
