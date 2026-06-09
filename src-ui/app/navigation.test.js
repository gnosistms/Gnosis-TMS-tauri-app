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

test("resolveNavigationLeaveLoading returns the QA list leave modal copy", () => {
  assert.deepEqual(
    resolveNavigationLeaveLoading("qaListEditor", "qa", {
      qaListNeedsExitSync: true,
    }),
    {
      title: "Saving and syncing...",
      message: "Please wait before leaving the QA list.",
    },
  );
});

test("resolveNavigationLeaveLoading stays inactive when not leaving an editing screen", () => {
  assert.equal(resolveNavigationLeaveLoading("glossaryEditor", "glossaryEditor"), null);
  assert.equal(resolveNavigationLeaveLoading("glossaryEditor", "glossaries"), null);
  assert.equal(resolveNavigationLeaveLoading("qaListEditor", "qa"), null);
  assert.equal(resolveNavigationLeaveLoading("projects", "glossaries"), null);
});

test("team-scoped screen refreshes update team access before loading page data", async () => {
  const source = await readFile(new URL("./navigation.js", import.meta.url), "utf8");

  assert.match(source, /primeProjectsLoadingState/);
  assert.match(source, /if \(navTarget === "projects" && state\.selectedTeamId\) \{\s*primeProjectsLoadingState\(state\.selectedTeamId\);\s*showScopedSyncBadge\("projects", "Refreshing project list\.\.\.", null\);\s*\}\s*render\(\);/);
  assert.match(source, /import \{ refreshCurrentUserTeamAccess \} from "\.\/team-query\.js";/);
  assert.match(source, /beginRefreshButtonFeedback\(screen, render\);\s*await waitForNextPaint\(\);/);
  assert.match(source, /if \(screen === "projects"\) \{[\s\S]*?await refreshVisibleTeamAccess\(render\);[\s\S]*?await loadTeamProjects/);
  assert.match(source, /if \(screen === "projects"\) \{[\s\S]*?await loadTeamProjects\(render, state\.selectedTeamId\);[\s\S]*?setResourcePageRefreshing\(state\.projectsPage, false\);[\s\S]*?clearScopedSyncBadge\("projects", render\);/);
  assert.match(source, /if \(screen === "glossaries"\) \{[\s\S]*?await refreshVisibleTeamAccess\(render\);[\s\S]*?await loadTeamGlossaries/);
  assert.match(source, /if \(screen === "glossaryEditor"\) \{[\s\S]*?await refreshVisibleTeamAccess\(render\);[\s\S]*?await maybeStartGlossaryBackgroundSync/);
  assert.match(source, /if \(screen === "qaListEditor"\) \{[\s\S]*?await refreshVisibleTeamAccess\(render\);[\s\S]*?await maybeStartQaListBackgroundSync/);
  assert.match(source, /if \(screen === "users"\) \{[\s\S]*?await refreshVisibleTeamAccess\(render\);[\s\S]*?await loadTeamUsers/);
  assert.match(source, /if \(screen === "translate"\) \{[\s\S]*?await refreshVisibleTeamAccess\(render\);[\s\S]*?startEditorBackgroundSyncSession/);
});

test("projects navigation clears the page refresh flag after project data loads", async () => {
  const source = await readFile(new URL("./navigation.js", import.meta.url), "utf8");

  assert.match(
    source,
    /if \(navTarget === "projects" && state\.selectedTeamId\) \{[\s\S]*?try \{[\s\S]*?await loadTeamProjects\(render, state\.selectedTeamId\);[\s\S]*?\} finally \{[\s\S]*?setResourcePageRefreshing\(state\.projectsPage, false\);[\s\S]*?clearScopedSyncBadge\("projects", render\);[\s\S]*?render\(\);[\s\S]*?\}[\s\S]*?return null;/,
  );
});

test("projects navigation does not wait for stopped editor background sync", async () => {
  const source = await readFile(new URL("./navigation.js", import.meta.url), "utf8");
  const projectsExitStart = source.indexOf('if (navTarget === "projects") {');
  const projectsLoadStart = source.indexOf('if (navTarget === "projects" && state.selectedTeamId) {', projectsExitStart);
  const projectsLoadBlock = source.slice(projectsLoadStart, source.indexOf('if (navTarget === "teams")', projectsLoadStart));

  assert.match(source, /void stopEditorBackgroundSyncSession\(\)\?\.catch\(\(\) => null\);/);
  assert.doesNotMatch(projectsLoadBlock, /await pendingEditorProjectSync/);
});

test("refresh feedback is rendered before team access refreshes", async () => {
  const source = await readFile(new URL("./navigation.js", import.meta.url), "utf8");
  const refreshBodyStart = source.indexOf("export async function refreshCurrentScreen");
  const feedbackIndex = source.indexOf("beginRefreshButtonFeedback(screen, render);", refreshBodyStart);
  const projectsAccessIndex = source.indexOf("await refreshVisibleTeamAccess(render);", source.indexOf('if (screen === "projects")', refreshBodyStart));
  const glossariesAccessIndex = source.indexOf("await refreshVisibleTeamAccess(render);", source.indexOf('if (screen === "glossaries")', refreshBodyStart));
  const qaAccessIndex = source.indexOf("await refreshVisibleTeamAccess(render);", source.indexOf('if (screen === "qa")', refreshBodyStart));

  assert.ok(feedbackIndex > -1);
  assert.ok(projectsAccessIndex > feedbackIndex);
  assert.ok(glossariesAccessIndex > feedbackIndex);
  assert.ok(qaAccessIndex > feedbackIndex);
  assert.match(source, /if \(screen === "projects"\) \{\s*setResourcePageRefreshing\(state\.projectsPage, true\);/);
  assert.match(source, /showScopedSyncBadge\("projects", "Refreshing project list\.\.\.", render\);/);
  assert.match(source, /if \(screen === "glossaries"\) \{\s*state\.glossariesPage\.isRefreshing = true;/);
  assert.match(source, /showScopedSyncBadge\("glossaries", "Refreshing glossary list\.\.\.", render\);/);
  assert.match(source, /if \(screen === "qa"\) \{\s*setResourcePageRefreshing\(state\.qaListsPage, true\);/);
  assert.match(source, /showScopedSyncBadge\("qa", "Refreshing QA lists\.\.\.", render\);/);
  assert.match(source, /if \(screen === "teams"\) \{\s*state\.teamsPage\.isRefreshing = true;/);
  assert.match(source, /showScopedSyncBadge\("teams", "Refreshing teams\.\.\.", render\);/);
  assert.match(source, /if \(screen === "users"\) \{\s*state\.membersPage\.isRefreshing = true;/);
  assert.match(source, /showScopedSyncBadge\("members", "Refreshing member list\.\.\.", render\);/);
  assert.match(source, /if \(screen === "users"\) \{[\s\S]*?showScopedSyncBadge\("members", "Refreshing member list\.\.\.", render\);[\s\S]*?render\(\);[\s\S]*?return;/);
});

test("translate refresh reloads local editor data before optional background sync", async () => {
  const source = await readFile(new URL("./navigation.js", import.meta.url), "utf8");
  const refreshBodyStart = source.indexOf("export async function refreshCurrentScreen");
  const sourceSyncIndex = source.indexOf("const syncResult = await syncEditorBackgroundNowWithSummary", refreshBodyStart);
  const translateStart = source.lastIndexOf('if (screen === "translate") {', sourceSyncIndex);
  const translateBlock = source.slice(translateStart, source.indexOf("await completePageSync(render);", translateStart));
  const firstReloadIndex = translateBlock.indexOf("await loadSelectedChapterEditorData(render, { preserveVisibleRows: true });");
  const syncIndex = translateBlock.indexOf("const syncResult = await syncEditorBackgroundNowWithSummary");
  const conditionalReloadIndex = translateBlock.indexOf("if (syncSummaryNeedsLocalEditorReload(syncResult))");

  assert.ok(firstReloadIndex > -1);
  assert.ok(syncIndex > firstReloadIndex);
  assert.ok(conditionalReloadIndex > syncIndex);
});

test("members refresh uses the active TanStack query observer", async () => {
  const source = await readFile(new URL("./team-members-flow.js", import.meta.url), "utf8");

  assert.match(source, /const membersQuerySubscription = ensureMembersQueryObserver\(render, selectedTeam, \{ teamId, render \}\);/);
  assert.match(source, /await membersQueryObserver\.refetch\(\{\s*throwOnError: true,\s*cancelRefetch: false,\s*\}\);[\s\S]*?await completePageSync\(render\);[\s\S]*?render\(\);/);
  assert.doesNotMatch(source, /queryClient\.fetchQuery\(\s*createMembersQueryOptions/);
});
