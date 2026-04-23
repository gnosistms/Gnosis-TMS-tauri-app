import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./translate.js", import.meta.url), "utf8");

test("translate header only wires Add / Remove into both language dropdowns for teams that can manage projects", () => {
  assert.match(source, /selectedProjectsTeam\(\)\?\.canManageProjects === true/);
  assert.match(source, /sourceLanguageExtraOptions:\s*chapterLanguageManagerOptions/);
  assert.match(source, /targetLanguageExtraOptions:\s*chapterLanguageManagerOptions/);
  assert.match(source, /label:\s*"Add \/ Remove"/);
});
