import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildSectionNav } from "../lib/ui.js";

function navTargets(markupItems) {
  return Array.from(
    markupItems.join("").matchAll(/data-nav-target="([^"]+)"/g),
    (match) => match[1],
  );
}

test("shared authenticated navigation places QA after glossary navigation", () => {
  assert.deepEqual(navTargets(buildSectionNav("teams")), ["start"]);
  assert.deepEqual(navTargets(buildSectionNav("projects", { includeAiSettings: true })), [
    "teams",
    "users",
    "glossaries",
    "qa",
    "aiKey",
    "start",
  ]);
  assert.deepEqual(navTargets(buildSectionNav("users", { includeAiSettings: true })), [
    "teams",
    "projects",
    "glossaries",
    "qa",
    "aiKey",
    "start",
  ]);
  assert.deepEqual(navTargets(buildSectionNav("glossaries", { includeAiSettings: true })), [
    "teams",
    "projects",
    "users",
    "qa",
    "aiKey",
    "start",
  ]);
  assert.deepEqual(navTargets(buildSectionNav("aiKey")), [
    "teams",
    "projects",
    "glossaries",
    "qa",
    "users",
    "start",
  ]);
  assert.deepEqual(navTargets(buildSectionNav("glossaryEditor")), ["glossaries", "qa", "projects"]);
  assert.deepEqual(navTargets(buildSectionNav("qaListEditor")), ["qa", "glossaries", "projects"]);
  assert.deepEqual(navTargets(buildSectionNav("translate")), ["projects", "glossaries", "qa"]);
  assert.deepEqual(navTargets(buildSectionNav("qa", { includeAiSettings: true })), [
    "teams",
    "projects",
    "users",
    "glossaries",
    "aiKey",
    "start",
  ]);
});

test("editor navigation includes QA to the right of Glossary", () => {
  const source = readFileSync(new URL("../screens/translate.js", import.meta.url), "utf8");

  assert.match(
    source,
    /actionNavButton\("Glossary", "open-editor-glossary"[\s\S]*?navButton\("QA", "qa"\)/,
  );
});

test("glossary editor return navigation includes QA", () => {
  const source = readFileSync(new URL("../screens/glossary-editor.js", import.meta.url), "utf8");

  assert.match(
    source,
    /navButton\(shortenChapterNavLabel\(chapterTitle\), "translate"[\s\S]*?navButton\("QA", "qa"\)/,
  );
});

test("QA screen is registered as a top-level renderer", () => {
  const source = readFileSync(new URL("../main.js", import.meta.url), "utf8");

  assert.match(source, /import \{ renderQaScreen \} from "\.\/screens\/qa\.js";/);
  assert.match(source, /qa:\s*\(\) => renderQaScreen\(state\)/);
  assert.match(source, /qa:\s*"QA Lists - Gnosis TMS"/);
  assert.match(source, /qaListEditor:\s*\(\) => renderQaListEditorScreen\(state\)/);
  assert.match(source, /qaListEditor:\s*"QA List Editor - Gnosis TMS"/);
});

test("team card QA action opens the selected team's QA page", () => {
  const source = readFileSync(new URL("./actions/navigation-actions.js", import.meta.url), "utf8");

  assert.match(source, /actionSuffix\(action, "open-team-qa:"\)/);
  assert.match(
    source,
    /openTeamQaId[\s\S]*?state\.selectedTeamId = openTeamQaId;[\s\S]*?state\.screen = "qa";[\s\S]*?primeQaListsLoadingState\(state\.selectedTeamId\);[\s\S]*?loadTeamQaLists\(render, state\.selectedTeamId\)/,
  );
});
