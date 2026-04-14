import test from "node:test";
import assert from "node:assert/strict";

import { indexProjectSearchResults, projectsSearchModeIsActive } from "./project-search-state.js";

test("projectsSearchModeIsActive uses a trimmed query", () => {
  assert.equal(projectsSearchModeIsActive({ query: "" }), false);
  assert.equal(projectsSearchModeIsActive({ query: "   " }), false);
  assert.equal(projectsSearchModeIsActive({ query: " dogs " }), true);
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
