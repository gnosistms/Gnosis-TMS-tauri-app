import test from "node:test";
import assert from "node:assert/strict";

import {
  indexProjectSearchResults,
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
  assert.equal(projectsSearchResultCountLabel({ total: 500, totalCapped: true }), "500+ results");
  assert.equal(projectsSearchResultCountLabel({ total: 1, totalCapped: false }), "1 result");
});

test("indexProjectSearchResults builds a result-id lookup", () => {
  const lookup = indexProjectSearchResults([
    { resultId: "a", snippet: "one" },
    { resultId: "b", snippet: "two" },
  ]);

  assert.deepEqual(Object.keys(lookup), ["a", "b"]);
  assert.equal(lookup.a.snippet, "one");
  assert.equal(lookup.b.snippet, "two");
});
