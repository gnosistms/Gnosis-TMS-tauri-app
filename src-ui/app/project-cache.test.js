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

  const loaded = loadStoredProjectsForTeam(team);
  assert.equal(loaded.cacheKey, "installation:42");
  assert.equal(typeof loaded.updatedAt, "string");
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
  assert.equal(loaded.cacheKey, "installation:42");
  assert.equal(loaded.updatedAt, null);
  assert.equal(loaded.deletedProjects.length, 1);
  assert.equal(Object.hasOwn(loaded.deletedProjects[0], "pendingMutation"), false);
  assert.equal(Object.hasOwn(loaded.deletedProjects[0], "localLifecycleIntent"), false);

  removeStoredProjectDataForTeam(team);
});

test("project cache does not persist chapter lifecycle UI intent fields", () => {
  setActiveStorageLogin("tester");

  saveStoredProjectsForTeam(team, {
    projects: [
      project({
        chapters: [
          {
            id: "chapter-1",
            name: "Chapter",
            status: "deleted",
            pendingMutation: "softDelete",
            localLifecycleIntent: "softDelete",
            pendingGlossaryMutation: true,
            glossaryMutationError: "failed",
          },
        ],
      }),
    ],
    deletedProjects: [],
  });

  const stored = readPersistentValue(STORAGE_KEY, {});
  const storedChapter = stored["installation:42"].projects[0].chapters[0];
  assert.equal(Object.hasOwn(storedChapter, "pendingMutation"), false);
  assert.equal(Object.hasOwn(storedChapter, "localLifecycleIntent"), false);
  assert.equal(Object.hasOwn(storedChapter, "pendingGlossaryMutation"), false);
  assert.equal(Object.hasOwn(storedChapter, "glossaryMutationError"), false);
});

test("project cache strips legacy persisted chapter lifecycle UI intent fields on load", () => {
  setActiveStorageLogin("tester");
  writePersistentValue(STORAGE_KEY, {
    "installation:42": {
      projects: [
        project({
          chapters: [
            {
              id: "chapter-1",
              name: "Chapter",
              status: "deleted",
              pendingMutation: "softDelete",
              localLifecycleIntent: "softDelete",
              pendingGlossaryMutation: true,
              glossaryMutationError: "failed",
            },
          ],
        }),
      ],
      deletedProjects: [],
    },
  });

  const loaded = loadStoredProjectsForTeam(team);
  const loadedChapter = loaded.projects[0].chapters[0];
  assert.equal(Object.hasOwn(loadedChapter, "pendingMutation"), false);
  assert.equal(Object.hasOwn(loadedChapter, "localLifecycleIntent"), false);
  assert.equal(Object.hasOwn(loadedChapter, "pendingGlossaryMutation"), false);
  assert.equal(Object.hasOwn(loadedChapter, "glossaryMutationError"), false);

  removeStoredProjectDataForTeam(team);
});
