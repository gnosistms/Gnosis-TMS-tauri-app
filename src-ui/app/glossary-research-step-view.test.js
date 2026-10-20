import test from "node:test";
import assert from "node:assert/strict";

import { stepExplanation, stepTitle } from "./glossary-research-step-view.js";

test("focused research's paragraph selection reads as what it does, not as free translation", () => {
  assert.equal(stepTitle("Coverage"), "Choose paragraphs that cover every meaning");
  assert.match(stepExplanation("Coverage", { term: "étnico", texts: "the books" }), /picks up to 12 from the books that together show every meaning of “étnico”/);
  assert.equal(stepTitle("Discovery"), "Free translation", "the full procedure's step keeps its name");
});
