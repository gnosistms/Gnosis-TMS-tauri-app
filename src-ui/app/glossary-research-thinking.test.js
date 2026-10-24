import test from "node:test";
import assert from "node:assert/strict";

import { formatThinkingLive, thinkingSteps } from "./glossary-research-stream-format.js";

test("thinking reads as its steps; live, the earlier steps are one line and the current one shows its text", () => {
  const text = "intro line\n**Reading the origin**\nIt is a noun.\n\n**Grouping**\nTwo groups so far";
  assert.deepEqual(thinkingSteps(text).map((s) => s.title), ["", "Reading the origin", "Grouping"]);
  const html = formatThinkingLive(text);
  assert.match(html, /<ol class="research-thought__done"><li>Reading the origin<\/li><\/ol>/);
  assert.match(html, /research-thought__title">Grouping<\/div><p>Two groups so far<\/p>/);
  assert.doesNotMatch(html, /It is a noun/, "earlier steps keep only their titles");
  assert.equal(formatThinkingLive(""), "");
});
