import test from "node:test";
import assert from "node:assert/strict";

globalThis.document = globalThis.document ?? {
  querySelector: () => null,
  querySelectorAll: () => [],
};
globalThis.window = globalThis.window ?? {
  __TAURI__: {},
  requestAnimationFrame: (callback) => setTimeout(callback, 0),
  setTimeout,
  clearTimeout,
};

const {
  applyChapterPendingMutation,
  preserveChapterLifecyclePatchesInProjectSnapshot,
} = await import("./project-chapter-flow.js");

function project(overrides = {}) {
  return {
    id: "project-1",
    name: "project-repo",
    title: "Project",
    chapters: [],
    ...overrides,
  };
}

function chapter(overrides = {}) {
  return {
    id: "chapter-1",
    name: "Chapter",
    status: "active",
    ...overrides,
  };
}

test("chapter pending mutations mark lifecycle intent on refreshed snapshots", () => {
  const snapshot = {
    items: [project({ chapters: [chapter()] })],
    deletedItems: [],
  };

  const renamed = applyChapterPendingMutation(snapshot, {
    type: "rename",
    projectId: "project-1",
    chapterId: "chapter-1",
    title: "Renamed Chapter",
  });
  const deleted = applyChapterPendingMutation(snapshot, {
    type: "softDelete",
    projectId: "project-1",
    chapterId: "chapter-1",
  });
  const restored = applyChapterPendingMutation({
    items: [project({ chapters: [chapter({ status: "deleted" })] })],
    deletedItems: [],
  }, {
    type: "restore",
    projectId: "project-1",
    chapterId: "chapter-1",
  });

  assert.equal(renamed.items[0].chapters[0].name, "Renamed Chapter");
  assert.equal(renamed.items[0].chapters[0].pendingMutation, "rename");
  assert.equal(deleted.items[0].chapters[0].status, "deleted");
  assert.equal(deleted.items[0].chapters[0].pendingMutation, "softDelete");
  assert.equal(restored.items[0].chapters[0].status, "active");
  assert.equal(restored.items[0].chapters[0].pendingMutation, "restore");
});

test("chapter lifecycle intent survives stale project refresh snapshots", () => {
  const previousSnapshot = {
    items: [
      project({
        chapters: [
          chapter({ id: "rename-chapter", name: "Local Rename", localLifecycleIntent: "rename" }),
          chapter({ id: "delete-chapter", status: "deleted", localLifecycleIntent: "softDelete" }),
          chapter({ id: "restore-chapter", status: "active", localLifecycleIntent: "restore" }),
        ],
      }),
    ],
    deletedItems: [],
  };
  const staleSnapshot = {
    items: [
      project({
        chapters: [
          chapter({ id: "rename-chapter", name: "Server Name" }),
          chapter({ id: "delete-chapter", status: "active" }),
          chapter({ id: "restore-chapter", status: "deleted" }),
        ],
      }),
    ],
    deletedItems: [],
  };

  const merged = preserveChapterLifecyclePatchesInProjectSnapshot(staleSnapshot, previousSnapshot);
  const chapters = merged.items[0].chapters;

  assert.equal(chapters.find((item) => item.id === "rename-chapter").name, "Local Rename");
  assert.equal(chapters.find((item) => item.id === "rename-chapter").localLifecycleIntent, "rename");
  assert.equal(chapters.find((item) => item.id === "delete-chapter").status, "deleted");
  assert.equal(chapters.find((item) => item.id === "delete-chapter").localLifecycleIntent, "softDelete");
  assert.equal(chapters.find((item) => item.id === "restore-chapter").status, "active");
  assert.equal(chapters.find((item) => item.id === "restore-chapter").localLifecycleIntent, "restore");
});

test("chapter lifecycle intent clears after refreshed state agrees", () => {
  const previousSnapshot = {
    items: [
      project({
        chapters: [
          chapter({ id: "rename-chapter", name: "Local Rename", localLifecycleIntent: "rename" }),
          chapter({ id: "delete-chapter", status: "deleted", localLifecycleIntent: "softDelete" }),
          chapter({ id: "restore-chapter", status: "active", localLifecycleIntent: "restore" }),
        ],
      }),
    ],
    deletedItems: [],
  };
  const settledSnapshot = {
    items: [
      project({
        chapters: [
          chapter({ id: "rename-chapter", name: "Local Rename" }),
          chapter({ id: "delete-chapter", status: "deleted" }),
          chapter({ id: "restore-chapter", status: "active" }),
        ],
      }),
    ],
    deletedItems: [],
  };

  const merged = preserveChapterLifecyclePatchesInProjectSnapshot(settledSnapshot, previousSnapshot);
  const chapters = merged.items[0].chapters;

  assert.equal(chapters.find((item) => item.id === "rename-chapter").localLifecycleIntent, undefined);
  assert.equal(chapters.find((item) => item.id === "delete-chapter").localLifecycleIntent, undefined);
  assert.equal(chapters.find((item) => item.id === "restore-chapter").localLifecycleIntent, undefined);
});
