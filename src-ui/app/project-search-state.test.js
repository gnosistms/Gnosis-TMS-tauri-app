import test from "node:test";
import assert from "node:assert/strict";

import {
  buildProjectSearchTree,
  projectsSearchModeIsActive,
  projectsSearchModeIsActiveForState,
  projectsSearchResultCountLabel,
} from "./project-search-state.js";

test("projectsSearchModeIsActive uses a trimmed query", () => {
  assert.equal(projectsSearchModeIsActive({ query: "" }), false);
  assert.equal(projectsSearchModeIsActive({ query: "   " }), false);
  assert.equal(projectsSearchModeIsActive({ query: " dogs " }), true);
});

test("projectsSearchModeIsActiveForState reads state.projectsSearch", () => {
  assert.equal(projectsSearchModeIsActiveForState({}), false);
  assert.equal(
    projectsSearchModeIsActiveForState({
      query: "should be ignored",
      projectsSearch: { query: " distinct " },
    }),
    true,
  );
});

test("projectsSearchResultCountLabel shows 500+ when the backend capped the search", () => {
  assert.equal(projectsSearchResultCountLabel({ total: 317, totalCapped: true }), "317+ matching rows");
  assert.equal(projectsSearchResultCountLabel({ total: 1, totalCapped: false }), "1 matching row");
});

test("buildProjectSearchTree counts rows and sorts hierarchy deterministically", () => {
  const tree = buildProjectSearchTree([
    {
      projectId: "project-b",
      projectTitle: "Beta",
      chapterId: "chapter-b",
      chapterTitle: "Second",
      rowId: "row-2",
      rowOrderKey: "b0",
      score: 5,
    },
    {
      projectId: "project-a",
      projectTitle: "Alpha",
      chapterId: "chapter-low",
      chapterTitle: "Low",
      rowId: "row-3",
      rowOrderKey: "c0",
      score: 2,
    },
    {
      projectId: "project-a",
      projectTitle: "Alpha",
      chapterId: "chapter-high",
      chapterTitle: "High",
      rowId: "row-4",
      rowOrderKey: "d0",
      score: 10,
    },
    {
      projectId: "project-a",
      projectTitle: "Alpha",
      chapterId: "chapter-high",
      chapterTitle: "High",
      rowId: "row-1",
      rowOrderKey: "a0",
      score: 8,
    },
  ]);

  assert.deepEqual(tree.map((project) => project.id), ["project-a", "project-b"]);
  assert.equal(tree[0].rowCount, 3);
  assert.deepEqual(tree[0].chapters.map((chapter) => chapter.id), ["chapter-high", "chapter-low"]);
  assert.equal(tree[0].chapters[0].rowCount, 2);
  assert.deepEqual(tree[0].chapters[0].rows.map((row) => row.rowId), ["row-1", "row-4"]);
});
