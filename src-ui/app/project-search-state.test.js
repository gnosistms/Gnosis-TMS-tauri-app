import test from "node:test";
import assert from "node:assert/strict";

import {
  buildProjectSearchTree,
  projectSearchVisibleResults,
  projectSearchWeakerToggleLabel,
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

test("projectsSearchResultCountLabel distinguishes strong and revealed result counts", () => {
  assert.equal(
    projectsSearchResultCountLabel({ strongTotal: 42, totalCapped: true }),
    "42 strong matching rows shown",
  );
  assert.equal(
    projectsSearchResultCountLabel({ total: 317, totalCapped: true, includeWeakerMatches: true }),
    "317 matching rows shown",
  );
  assert.equal(projectsSearchResultCountLabel({ strongTotal: 1 }), "1 strong matching row");
});

test("projectSearchVisibleResults hides weaker rows until requested", () => {
  const results = [
    { rowId: "strong", qualityTier: "strong" },
    { rowId: "weaker", qualityTier: "weaker" },
  ];
  assert.deepEqual(
    projectSearchVisibleResults({ results }).map((row) => row.rowId),
    ["strong"],
  );
  assert.deepEqual(
    projectSearchVisibleResults({ results, includeWeakerMatches: true }).map((row) => row.rowId),
    ["strong", "weaker"],
  );
  assert.equal(
    projectSearchWeakerToggleLabel({ weakerTotal: 4 }),
    "Show more results (4)",
  );
  assert.equal(
    projectSearchWeakerToggleLabel({ weakerTotal: 4, totalCapped: true }),
    "Show more results (4)",
  );
  assert.equal(
    projectSearchWeakerToggleLabel({ weakerTotal: 4, includeWeakerMatches: true }),
    "Show fewer results",
  );
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

test("visible leaf selection controls branch presence and recursive maximum scores", () => {
  const results = [
    {
      projectId: "project-a", projectTitle: "Alpha", chapterId: "chapter-a",
      chapterTitle: "First", rowId: "row-a", rowOrderKey: "a0", score: 50,
      qualityTier: "strong",
    },
    {
      projectId: "project-b", projectTitle: "Beta", chapterId: "chapter-b",
      chapterTitle: "Second", rowId: "row-b", rowOrderKey: "b0", score: 20,
      qualityTier: "weaker",
    },
  ];
  const strongTree = buildProjectSearchTree(projectSearchVisibleResults({ results }));
  const allTree = buildProjectSearchTree(projectSearchVisibleResults({
    results,
    includeWeakerMatches: true,
  }));

  assert.deepEqual(strongTree.map((project) => project.id), ["project-a"]);
  assert.equal(strongTree[0].score, 50);
  assert.equal(strongTree[0].chapters[0].score, 50);
  assert.deepEqual(allTree.map((project) => project.id), ["project-a", "project-b"]);
});
