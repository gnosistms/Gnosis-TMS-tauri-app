import test from "node:test";
import assert from "node:assert/strict";

const { readPersistentValue, removePersistentValue } = await import("./persistent-store.js");
const { setActiveStorageLogin } = await import("./team-storage.js");
const {
  loadStoredGlossariesForTeam,
  saveStoredGlossariesForTeam,
} = await import("./glossary-cache.js");

const STORAGE_KEY = "gnosis-tms-glossary-cache:tester";
const team = { installationId: 42 };

test.afterEach(() => {
  removePersistentValue(STORAGE_KEY);
  setActiveStorageLogin(null);
});

test("glossary cache exposes cache key and update time", () => {
  setActiveStorageLogin("tester");

  saveStoredGlossariesForTeam(team, [
    {
      id: "glossary-1",
      repoName: "glossary-repo",
      title: "Glossary",
      lifecycleState: "active",
    },
  ]);

  const stored = readPersistentValue(STORAGE_KEY, {});
  assert.equal(typeof stored["installation:42"].updatedAt, "string");

  const loaded = loadStoredGlossariesForTeam(team);
  assert.equal(loaded.exists, true);
  assert.equal(loaded.cacheKey, "installation:42");
  assert.equal(typeof loaded.updatedAt, "string");
  assert.equal(loaded.glossaries[0].title, "Glossary");
});

test("glossary cache misses include the requested cache key", () => {
  setActiveStorageLogin("tester");

  const loaded = loadStoredGlossariesForTeam(team);

  assert.equal(loaded.exists, false);
  assert.equal(loaded.cacheKey, "installation:42");
  assert.equal(loaded.updatedAt, null);
  assert.deepEqual(loaded.glossaries, []);
});
