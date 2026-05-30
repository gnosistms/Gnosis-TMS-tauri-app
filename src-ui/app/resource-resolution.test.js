import test from "node:test";
import assert from "node:assert/strict";

import { deriveGlossaryResolution, deriveProjectResolution, deriveQaListResolution } from "./resource-resolution.js";

test("deleted project resolution blocks lifecycle actions", () => {
  const resolution = deriveProjectResolution({
    resolutionState: "deleted",
    remoteState: "deleted",
    recordState: "tombstone",
  });

  assert.equal(resolution?.key, "deleted");
  assert.equal(resolution?.blockLifecycleActions, true);
  assert.equal(resolution?.blockContentActions, true);
});

test("missing glossary resolution blocks lifecycle actions", () => {
  const resolution = deriveGlossaryResolution({
    resolutionState: "missing",
    remoteState: "missing",
    recordState: "live",
  });

  assert.equal(resolution?.key, "missing");
  assert.equal(resolution?.blockLifecycleActions, true);
  assert.equal(resolution?.blockContentActions, false);
});

test("unregistered local resources block lifecycle actions", () => {
  const projectResolution = deriveProjectResolution({
    resolutionState: "unregisteredLocal",
    remoteState: "linked",
    recordState: "live",
  });
  const glossaryResolution = deriveGlossaryResolution({
    resolutionState: "unregisteredLocal",
    remoteState: "linked",
    recordState: "live",
  });

  assert.equal(projectResolution?.blockLifecycleActions, true);
  assert.equal(glossaryResolution?.blockLifecycleActions, true);
});

test("repair state surfaces a repair warning without blocking content access", () => {
  const resolution = deriveProjectResolution({
    resolutionState: "repair",
    remoteState: "linked",
    recordState: "live",
    repairIssueMessage: "The local repo binding needs repair.",
  });

  assert.equal(resolution?.key, "repair");
  assert.equal(resolution?.blockLifecycleActions, true);
  assert.equal(resolution?.blockContentActions, false);
  assert.match(resolution?.message ?? "", /needs repair/i);
});

test("missing local repo repair state points to rebuild action", () => {
  const resolution = deriveGlossaryResolution({
    id: "glossary-1",
    resolutionState: "repair",
    remoteState: "linked",
    recordState: "live",
    repairIssueType: "missingLocalRepo",
    repairIssueMessage: "Team metadata references this glossary, but its local repo is missing.",
  });

  assert.equal(resolution?.actionLabel, "Rebuild Local Repo");
  assert.equal(resolution?.action, "rebuild-glossary-repo:glossary-1");
});

test("missing local repo repair state can be hidden during refresh", () => {
  const resolution = deriveGlossaryResolution(
    {
      id: "glossary-1",
      resolutionState: "repair",
      remoteState: "linked",
      recordState: "live",
      repairIssueType: "missingLocalRepo",
      repairIssueMessage: "Team metadata references this glossary, but its local repo is missing.",
    },
    null,
    { suppressMissingLocalRepoRepair: true },
  );

  assert.equal(resolution, null);
});

test("non-missing-local repair state stays visible during refresh", () => {
  const resolution = deriveProjectResolution(
    {
      id: "project-1",
      resolutionState: "repair",
      remoteState: "linked",
      recordState: "live",
      repairIssueType: "wrongRemote",
      repairIssueMessage: "The local repo points at the wrong GitHub repo.",
    },
    null,
    { suppressMissingLocalRepoRepair: true },
  );

  assert.equal(resolution?.key, "repair");
  assert.match(resolution?.message ?? "", /wrong GitHub repo/i);
});

test("unresolved conflict state surfaces a sync warning without blocking content access", () => {
  const resolution = deriveProjectResolution(
    { id: "project-1", remoteState: "linked", recordState: "live" },
    {
      status: "unresolvedConflict",
      message: "git status output",
    },
  );

  assert.equal(resolution?.key, "unresolvedConflict");
  assert.equal(resolution?.blockLifecycleActions, false);
  assert.equal(resolution?.blockContentActions, false);
  assert.match(resolution?.help ?? "", /Automatic sync is paused/i);
});

test("imported editor conflicts surface a warning without blocking content access", () => {
  const resolution = deriveProjectResolution(
    { id: "project-1", remoteState: "linked", recordState: "live" },
    {
      status: "importedEditorConflicts",
      message: "Rows still need conflict resolution.",
    },
  );

  assert.equal(resolution?.key, "importedEditorConflicts");
  assert.equal(resolution?.blockLifecycleActions, false);
  assert.equal(resolution?.blockContentActions, false);
  assert.match(resolution?.help ?? "", /conflict resolution in the editor/i);
});

test("update required sync state blocks project lifecycle and content actions", () => {
  const resolution = deriveProjectResolution(
    { id: "project-1", remoteState: "linked", recordState: "live" },
    {
      status: "updateRequired",
      message: "This repo was saved by Gnosis TMS 0.1.36.",
    },
  );

  assert.equal(resolution?.key, "updateRequired");
  assert.equal(resolution?.blockLifecycleActions, true);
  assert.equal(resolution?.blockContentActions, true);
  assert.match(resolution?.help ?? "", /Update Gnosis TMS before continuing/i);
});

test("remote migrated local old-layout changes surface guarded discard action", () => {
  const resolution = deriveProjectResolution(
    { id: "project-1", remoteState: "linked", recordState: "live" },
    {
      projectId: "project-1",
      status: "remoteMigratedLocalChanges",
      message: "The server has migrated this project.",
    },
  );

  assert.equal(resolution?.key, "remoteMigratedLocalChanges");
  assert.equal(resolution?.blockLifecycleActions, true);
  assert.equal(resolution?.blockContentActions, true);
  assert.equal(resolution?.actionLabel, "Discard local changes and sync");
  assert.equal(resolution?.action, "open-project-old-layout-discard:project-1");
});

test("remote migrated glossary and QA list states surface resource-specific discard actions", () => {
  const glossaryResolution = deriveGlossaryResolution(
    { id: "glossary-1", remoteState: "linked", recordState: "live" },
    {
      repoName: "glossary-repo",
      status: "remoteMigratedLocalChanges",
    },
  );
  const qaListResolution = deriveQaListResolution(
    { id: "qa-1", remoteState: "linked", recordState: "live" },
    {
      repoName: "qa-repo",
      status: "remoteMigratedLocalChanges",
    },
  );

  assert.equal(glossaryResolution?.action, "open-glossary-old-layout-discard:glossary-1");
  assert.equal(qaListResolution?.action, "open-qa-list-old-layout-discard:qa-1");
});

test("linked resources do not surface a top-level resolution banner", () => {
  const projectResolution = deriveProjectResolution({
    id: "project-1",
    remoteState: "linked",
    recordState: "live",
  });
  const glossaryResolution = deriveGlossaryResolution({
    id: "glossary-1",
    remoteState: "linked",
    recordState: "live",
  });

  assert.equal(projectResolution, null);
  assert.equal(glossaryResolution, null);
});
