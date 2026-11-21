import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./projects.js", import.meta.url), "utf8");

test("projects screen explains recovery and shows where previous local copies were saved", () => {
  assert.match(source, /overwrite-conflicted-project-repos/);
  assert.match(source, /Recover from GitHub/);
  assert.match(source, /Saved local project copies/);
  assert.match(source, /escapeHtml\(state.projectRepoSyncByProjectId\[project.id\].savedCheckout\)/);
});
