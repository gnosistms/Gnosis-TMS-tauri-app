import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./translate.js", import.meta.url), "utf8");

test("translate header wires the Add / Remove option into both source and target language dropdowns", () => {
  assert.match(source, /sourceLanguageExtraOptions:\s*targetLanguageManageOption/);
  assert.match(source, /targetLanguageExtraOptions:\s*targetLanguageManageOption/);
  assert.match(source, /label:\s*"Add \/ Remove"/);
});
