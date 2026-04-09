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
