import test from "node:test";
import assert from "node:assert/strict";

const {
  buildProjectsListItems,
  calculateProjectsVirtualWindow,
  estimateProjectsListItemHeight,
  parseProjectsListItemProjectId,
  projectHeaderItemKey,
} = await import("./projects-list-model.js");

function project(id, { files = [], deletedFiles = [] } = {}) {
  return {
    id,
    title: `Project ${id}`,
    name: id,
    status: "active",
    chapters: [
      ...files.map((name, index) => ({ id: `${id}-file-${index}`, name, status: "active" })),
      ...deletedFiles.map((name, index) => ({ id: `${id}-deleted-${index}`, name, status: "deleted" })),
    ],
  };
}

test("collapsed projects contribute a single header item that is both card edges", () => {
  const items = buildProjectsListItems({
    projects: [project("p1", { files: ["a", "b"] })],
    expandedProjects: new Set(),
    expandedDeletedFiles: new Set(),
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].type, "project-header");
  assert.equal(items[0].key, "p:p1");
  assert.equal(items[0].isCardStart, true);
  assert.equal(items[0].isCardEnd, true);
});

test("expanded projects flatten into header, sorted file rows, and deleted section", () => {
  const items = buildProjectsListItems(
    {
      projects: [project("p1", { files: ["b", "a"], deletedFiles: ["gone"] })],
      expandedProjects: new Set(["p1"]),
      expandedDeletedFiles: new Set(["p1"]),
    },
    { canPermanentlyDeleteFiles: true },
  );

  assert.deepEqual(
    items.map((item) => item.type),
    ["project-header", "project-file", "project-file", "deleted-toggle", "deleted-clear", "deleted-file"],
  );
  // Files sort by name: "a" before "b".
  assert.equal(items[1].chapter.name, "a");
  assert.equal(items[1].isBodyStart, true);
  assert.equal(items[2].isBodyStart, false);
  assert.equal(items[5].isFirstDeletedFile, true);
  assert.equal(items[5].isCardEnd, true);
  assert.equal(items[0].isCardEnd, false);
});

test("deleted-clear row requires the capability", () => {
  const items = buildProjectsListItems(
    {
      projects: [project("p1", { deletedFiles: ["gone"] })],
      expandedProjects: new Set(["p1"]),
      expandedDeletedFiles: new Set(["p1"]),
    },
    { canPermanentlyDeleteFiles: false },
  );

  assert.ok(!items.some((item) => item.type === "deleted-clear"));
});

test("expanded project with no files gets an empty body segment", () => {
  const items = buildProjectsListItems({
    projects: [project("p1")],
    expandedProjects: new Set(["p1"]),
    expandedDeletedFiles: new Set(),
  });

  assert.deepEqual(
    items.map((item) => item.type),
    ["project-header", "project-empty-body"],
  );
  assert.equal(items[1].isCardEnd, true);
});

test("item keys resolve back to their project id", () => {
  assert.equal(parseProjectsListItemProjectId("p:proj-1"), "proj-1");
  assert.equal(parseProjectsListItemProjectId("f:proj-1:chapter-9"), "proj-1");
  assert.equal(parseProjectsListItemProjectId("df:proj-1:chapter-9"), "proj-1");
  assert.equal(parseProjectsListItemProjectId("dt:proj-1"), "proj-1");
  assert.equal(projectHeaderItemKey("proj-1"), "p:proj-1");
  assert.equal(parseProjectsListItemProjectId("nonsense"), "");
});

test("estimates include card gap and bottom padding on card edges", () => {
  const header = { type: "project-header", isCardStart: true, isCardEnd: true };
  const bodyEnd = { type: "project-file", isCardStart: false, isCardEnd: true };
  const bodyMid = { type: "project-file", isCardStart: false, isCardEnd: false };

  assert.ok(estimateProjectsListItemHeight(header) > estimateProjectsListItemHeight({ ...header, isCardStart: false }));
  assert.ok(estimateProjectsListItemHeight(bodyEnd) > estimateProjectsListItemHeight(bodyMid));
});

test("calculateProjectsVirtualWindow windows around the scroll position", () => {
  const heights = Array.from({ length: 100 }, () => 50); // 5000px total
  const windowState = calculateProjectsVirtualWindow(heights, 2500, 500);

  assert.ok(windowState.startIndex > 0);
  assert.ok(windowState.endIndex < 100);
  // Overscan is 600px on each side: window covers 2500-600 .. 3000+600.
  assert.ok(windowState.startIndex <= Math.floor((2500 - 600) / 50));
  assert.ok(windowState.endIndex >= Math.ceil((3000 + 600) / 50));
  const windowHeight = heights
    .slice(windowState.startIndex, windowState.endIndex)
    .reduce((sum, height) => sum + height, 0);
  assert.equal(windowState.topSpacerHeight + windowHeight + windowState.bottomSpacerHeight, 5000);
});

test("calculateProjectsVirtualWindow clamps to the ends", () => {
  const heights = Array.from({ length: 10 }, () => 50);
  const top = calculateProjectsVirtualWindow(heights, 0, 400);
  assert.equal(top.startIndex, 0);
  assert.equal(top.topSpacerHeight, 0);

  const bottom = calculateProjectsVirtualWindow(heights, 10_000, 400);
  assert.equal(bottom.endIndex, 10);
  assert.equal(bottom.bottomSpacerHeight, 0);

  const empty = calculateProjectsVirtualWindow([], 100, 400);
  assert.deepEqual(empty, { startIndex: 0, endIndex: 0, topSpacerHeight: 0, bottomSpacerHeight: 0 });
});

