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
  submitProjectCreation,
  deleteProject,
} = await import("./project-flow.js");
const { queryClient, projectKeys } = await import("./query-client.js");
const { removePersistentValue } = await import("./persistent-store.js");
const { resetSessionState, state } = await import("./state.js");
const { setActiveStorageLogin } = await import("./team-storage.js");

const { createProjectsQuerySnapshot } = await import("./project-query.js");
const { renderProjectsScreen } = await import("../screens/projects.js");
const { clearNoticeBadge } = await import("./status-feedback.js");

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
  clearNoticeBadge();
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

function setupActiveProjectState() {
  const { team, project } = setupProjectPermanentDeletionState();
  team.membershipRole = "owner";
  state.screen = "projects";
  project.lifecycleState = "active";
  project.fileLoadState = "ready";
  state.projects = [project];
  state.deletedProjects = [];
  state.projectDiscovery = { status: "ready", error: "" };
  state.projectPermanentDeletion.isOpen = false;
  queryClient.setQueryData(projectKeys.byTeam(team.id), createProjectsQuerySnapshot({ items: [project] }));
  return { team, project };
}

test("a failed deletion retains the project list and reports the operation error", async () => {
  const { project } = setupActiveProjectState();
  invokeHandler = async (command) => {
    if (command === "upsert_local_gnosis_project_metadata_record") throw new Error("Metadata push failed");
    return null;
  };
  await deleteProject(() => {}, project.id);
  assert.ok(invokeCalls.some((call) => call.command === "upsert_local_gnosis_project_metadata_record"));
  assert.equal(state.projectDiscovery.status, "ready");
  assert.equal(state.projects[0]?.id, project.id);
  assert.match(state.statusBadges.left.text, /Could not delete project:.*Metadata push failed/);
  const html = renderProjectsScreen(state);
  assert.doesNotMatch(html, /PROJECT LOAD FAILED/);
  assert.match(html, /data-action="delete-project:project-1"/);
});

test("creation completes locally while its background refresh is still pending", async () => {
  const { team } = setupActiveProjectState();
  state.projectsPage.isRefreshing = true;
  state.projectCreation = { isOpen: true, status: "idle", error: "", projectName: "New project" };
  let resolveListing;
  const listing = new Promise((resolve) => { resolveListing = resolve; });
  let oldSignal;
  const oldDiscovery = queryClient.fetchQuery({
    queryKey: projectKeys.byTeam(team.id),
    queryFn: ({ signal }) => {
      oldSignal = signal;
      return listing;
    },
  }).catch(() => null);
  invokeHandler = async (command, payload) => {
    if (command === "create_gnosis_project_repo") {
      assert.equal(oldSignal.aborted, true, "cancel discovery before creating remote or local metadata");
      return { name: payload.input.repoName, fullName: `team-1/${payload.input.repoName}`, defaultBranchName: "main" };
    }
    if (command === "list_gnosis_resources_for_installation") return listing;
    return null;
  };
  try {
    await submitProjectCreation(() => {});
    assert.ok(invokeCalls.some((call) => call.command === "initialize_gtms_project_repo"));
    assert.equal(state.projectCreation.isOpen, false);
    assert.equal(state.projectsPage.writeState, "idle");
    const created = state.projects.find((project) => project.title === "New project");
    assert.ok(created);
    assert.equal(created.fileLoadState, "ready");
    assert.deepEqual(created.chapters, []);
    const html = renderProjectsScreen(state);
    const addButton = html.match(new RegExp(`<button[^>]*data-action="add-project-files:${created.id}"[^>]*>`))?.[0];
    assert.ok(addButton);
    assert.doesNotMatch(addButton, /disabled/);
  } finally {
    state.screen = "teams";
    resolveListing({ projects: [], glossaries: [], qaLists: [] });
    await oldDiscovery;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
});
