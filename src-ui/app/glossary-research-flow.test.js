import test from "node:test";
import assert from "node:assert/strict";

import { interruptedRunMeta } from "./glossary-research-flow.js";

test("a run still marked running that this app is not running is marked stopped", () => {
  const meta = { runId: "2026-10-09T11-19-41_cohabitar", term: "Cohabitar", status: "running" };
  const fixed = interruptedRunMeta(meta, null);
  assert.equal(fixed.status, "stopped");
  assert.equal(fixed.interruptedDuring, "running");
  assert.match(fixed.error, /closed or reloaded/);
  assert.equal(meta.status, "running", "the record read is not changed in place");
  assert.equal(interruptedRunMeta({ ...meta, status: "counting" }).interruptedDuring, "counting", "a resume goes on counting");
  assert.equal(interruptedRunMeta(meta, meta.runId), null, "the run this app is running is left alone");
  for (const status of ["review", "done", "stopped", "failed"]) assert.equal(interruptedRunMeta({ ...meta, status }), null, status);
  assert.equal(interruptedRunMeta(null), null);
});
