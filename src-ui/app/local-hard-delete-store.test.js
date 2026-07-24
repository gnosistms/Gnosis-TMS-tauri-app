import assert from "node:assert/strict";
import test from "node:test";

const { setActiveStorageLogin } = await import("./team-storage.js");
const {
  addLocalHardDeleteTombstone,
  clearRestoredLocalHardDeleteTombstones,
  filterLocalHardDeletedResources,
  isLocalHardDeletedResource,
} = await import("./local-hard-delete-store.js");

const team = { id: "team-1", installationId: 1 };

test("an active chapter with the same title does not resurrect a hard-deleted twin", () => {
  // Regression: re-importing a file creates an active chapter whose title
  // matches the hard-deleted original. Chapter tombstones must match by id
  // only — a title-based match let the active twin clear the tombstone on
  // every refresh, bringing the deleted file back.
  setActiveStorageLogin("hard-delete-title-twin-test");
  const deletedChapter = { id: "chapter-old", name: "Episode One", status: "deleted" };
  const activeTwin = { id: "chapter-new", name: "Episode One", status: "active" };

  addLocalHardDeleteTombstone(team, "chapter", deletedChapter);

  // The refresh path clears tombstones whose resource became active again.
  clearRestoredLocalHardDeleteTombstones(team, "chapter", [activeTwin, deletedChapter], {
    isActive: (chapter) => chapter.status === "active",
  });

  assert.equal(isLocalHardDeletedResource(team, "chapter", deletedChapter), true);
  assert.equal(isLocalHardDeletedResource(team, "chapter", activeTwin), false);
  const filtered = filterLocalHardDeletedResources(
    team,
    "chapter",
    [activeTwin, deletedChapter],
    { isDeleted: (chapter) => chapter.status === "deleted" },
  );
  assert.deepEqual(filtered.map((chapter) => chapter.id), ["chapter-new"]);
});

test("restoring the tombstoned chapter itself still clears its tombstone", () => {
  setActiveStorageLogin("hard-delete-restore-test");
  const chapter = { id: "chapter-1", name: "Episode One", status: "deleted" };

  addLocalHardDeleteTombstone(team, "chapter", chapter);
  clearRestoredLocalHardDeleteTombstones(
    team,
    "chapter",
    [{ ...chapter, status: "active" }],
    { isActive: (candidate) => candidate.status === "active" },
  );

  assert.equal(isLocalHardDeletedResource(team, "chapter", chapter), false);
});

test("project tombstones still match by repo name when ids are unavailable", () => {
  // Guard: the id-only rule is chapter/row specific — projects keep the
  // repo-name fallback because a repo name is a unique identity for them.
  setActiveStorageLogin("hard-delete-project-fallback-test");
  const project = { id: "project-1", name: "subtitles", status: "deleted" };

  addLocalHardDeleteTombstone(team, "project", project);

  assert.equal(
    isLocalHardDeletedResource(team, "project", { name: "subtitles", status: "deleted" }),
    true,
  );
});
