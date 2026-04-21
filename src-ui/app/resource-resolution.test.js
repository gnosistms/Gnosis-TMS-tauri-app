import test from "node:test";
import assert from "node:assert/strict";

import { deriveGlossaryResolution, deriveProjectResolution } from "./resource-resolution.js";

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
