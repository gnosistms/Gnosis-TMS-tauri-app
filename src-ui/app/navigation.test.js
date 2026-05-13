import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { resolveNavigationLeaveLoading } from "./navigation-leave-loading.js";

test("resolveNavigationLeaveLoading skips the editor leave modal for projects", () => {
  assert.equal(resolveNavigationLeaveLoading("translate", "projects"), null);
});

test("resolveNavigationLeaveLoading returns the editor leave modal copy for non-project exits", () => {
  assert.deepEqual(
    resolveNavigationLeaveLoading("translate", "glossaries"),
    {
      title: "Saving and syncing...",
      message: "Please wait before leaving the editor.",
    },
  );
});

test("resolveNavigationLeaveLoading returns the glossary leave modal copy", () => {
  assert.deepEqual(
    resolveNavigationLeaveLoading("glossaryEditor", "glossaries", {
      glossaryNeedsExitSync: true,
    }),
    {
      title: "Saving and syncing...",
      message: "Please wait before leaving the glossary.",
    },
  );
});

test("resolveNavigationLeaveLoading stays inactive when not leaving an editing screen", () => {
  assert.equal(resolveNavigationLeaveLoading("glossaryEditor", "glossaryEditor"), null);
  assert.equal(resolveNavigationLeaveLoading("glossaryEditor", "glossaries"), null);
  assert.equal(resolveNavigationLeaveLoading("projects", "glossaries"), null);
});

test("team-scoped screen refreshes update team access before loading page data", async () => {
  const source = await readFile(new URL("./navigation.js", import.meta.url), "utf8");

  assert.match(source, /primeProjectsLoadingState/);
  assert.match(source, /if \(navTarget === "projects" && state\.selectedTeamId\) \{\s*primeProjectsLoadingState\(state\.selectedTeamId\);\s*\}\s*render\(\);/);
  assert.match(source, /import \{ refreshCurrentUserTeamAccess \} from "\.\/team-query\.js";/);
  assert.match(source, /if \(screen === "projects"\) \{\s*await refreshVisibleTeamAccess\(render\);\s*await loadTeamProjects/);
  assert.match(source, /if \(screen === "glossaries"\) \{\s*await refreshVisibleTeamAccess\(render\);\s*await loadTeamGlossaries/);
  assert.match(source, /if \(screen === "glossaryEditor"\) \{\s*await refreshVisibleTeamAccess\(render\);\s*await maybeStartGlossaryBackgroundSync/);
  assert.match(source, /if \(screen === "users"\) \{\s*await refreshVisibleTeamAccess\(render\);\s*await loadTeamUsers/);
  assert.match(source, /if \(screen === "translate"\) \{\s*await refreshVisibleTeamAccess\(render\);\s*startEditorBackgroundSyncSession/);
});
