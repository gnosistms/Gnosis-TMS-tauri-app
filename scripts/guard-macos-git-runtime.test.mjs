import assert from "node:assert/strict";
import test from "node:test";

import { evaluateMacosGitArchive } from "./guard-macos-git-runtime.mjs";

test("macOS Git runtime guard skips other platforms", () => {
  assert.deepEqual(
    evaluateMacosGitArchive({ platform: "win32", archiveExists: false }),
    { ok: true, skipped: true },
  );
});

test("macOS Git runtime guard rejects a missing or empty archive", () => {
  assert.equal(
    evaluateMacosGitArchive({ platform: "darwin", archiveExists: false }).reason,
    "missing",
  );
  assert.equal(
    evaluateMacosGitArchive({
      platform: "darwin",
      archiveExists: true,
      archiveSize: 0,
    }).reason,
    "empty",
  );
});

test("macOS Git runtime guard requires the executable used by the app", () => {
  assert.equal(
    evaluateMacosGitArchive({
      platform: "darwin",
      archiveExists: true,
      archiveSize: 100,
      entries: ["./bin/git", "./share/git-core/"],
    }).reason,
    "incomplete",
  );
});

test("macOS Git runtime guard accepts the release archive layout", () => {
  assert.deepEqual(
    evaluateMacosGitArchive({
      platform: "darwin",
      archiveExists: true,
      archiveSize: 100,
      entries: ["./bin/git", "./libexec/git-core/git", "./share/git-core/"],
    }),
    { ok: true, skipped: false },
  );
});
