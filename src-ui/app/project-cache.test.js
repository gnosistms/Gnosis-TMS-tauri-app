import test from "node:test";
import assert from "node:assert/strict";

const { readPersistentValue, removePersistentValue, writePersistentValue } = await import("./persistent-store.js");
const { setActiveStorageLogin } = await import("./team-storage.js");
const {
  loadStoredProjectsForTeam,
  removeStoredProjectDataForTeam,
  saveStoredProjectsForTeam,
} = await import("./project-cache.js");

const STORAGE_KEY = "gnosis-tms-project-cache:tester";
const team = { installationId: 42 };

function project(overrides = {}) {
  return {
    id: "project-1",
    name: "project-repo",
    title: "Project",
    lifecycleState: "active",
    chapters: [],
    ...overrides,
  };
}

test.afterEach(() => {
  removePersistentValue(STORAGE_KEY);
  setActiveStorageLogin(null);
});

test("project cache does not persist top-level lifecycle UI intent fields", () => {
  setActiveStorageLogin("tester");

  saveStoredProjectsForTeam(team, {
    projects: [
      project({
        pendingMutation: "restore",
        localLifecycleIntent: "restore",
      }),
    ],
    deletedProjects: [
      project({
        id: "deleted-project",
        lifecycleState: "deleted",
        pendingMutation: "softDelete",
        localLifecycleIntent: "softDelete",
      }),
    ],
  });

  const stored = readPersistentValue(STORAGE_KEY, {});
  const storedProject = stored["installation:42"].projects[0];
  const storedDeletedProject = stored["installation:42"].deletedProjects[0];
  assert.equal(Object.hasOwn(storedProject, "pendingMutation"), false);
  assert.equal(Object.hasOwn(storedProject, "localLifecycleIntent"), false);
  assert.equal(Object.hasOwn(storedDeletedProject, "pendingMutation"), false);
  assert.equal(Object.hasOwn(storedDeletedProject, "localLifecycleIntent"), false);
});

test("project cache strips legacy persisted top-level lifecycle UI intent fields on load", () => {
  setActiveStorageLogin("tester");
  writePersistentValue(STORAGE_KEY, {
    "installation:42": {
      projects: [],
      deletedProjects: [
        project({
          lifecycleState: "deleted",
          pendingMutation: "softDelete",
          localLifecycleIntent: "softDelete",
        }),
      ],
    },
  });

  const loaded = loadStoredProjectsForTeam(team);
  assert.equal(loaded.deletedProjects.length, 1);
  assert.equal(Object.hasOwn(loaded.deletedProjects[0], "pendingMutation"), false);
  assert.equal(Object.hasOwn(loaded.deletedProjects[0], "localLifecycleIntent"), false);

  removeStoredProjectDataForTeam(team);
});
