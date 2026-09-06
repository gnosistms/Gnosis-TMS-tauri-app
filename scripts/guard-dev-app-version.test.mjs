import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  compareStableVersions,
  evaluateDevVersion,
  newestStableTag,
  parseStableVersion,
} from "./guard-dev-app-version.mjs";

const synchronizedVersions = (version) => ({
  "package.json": version,
  "src-tauri/Cargo.toml": version,
  "src-tauri/tauri.conf.json": version,
});

test("local launcher permits an older release label but still rejects inconsistent metadata", (t) => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "gnosis-dev-version-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  mkdirSync(path.join(cwd, "src-tauri"));
  writeFileSync(path.join(cwd, "package.json"), '{"version":"0.8.101"}');
  writeFileSync(path.join(cwd, "src-tauri/tauri.conf.json"), '{"version":"0.8.101"}');
  writeFileSync(path.join(cwd, "src-tauri/Cargo.toml"), '[package]\nversion = "0.8.101"\n');
  const git = (args) => execFileSync("git", args, { cwd, stdio: "ignore" });
  git(["init"]);
  git(["add", "."]);
  git(["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "commit", "-m", "Fixture"]);
  git(["tag", "v0.8.102"]);
  const guard = fileURLToPath(new URL("./guard-dev-app-version.mjs", import.meta.url));
  const run = (allow) => spawnSync(process.execPath, [guard], {
    cwd, encoding: "utf8",
    env: { ...process.env, GNOSIS_ALLOW_STALE_DEV_VERSION: allow ? "1" : "0" },
  });
  assert.equal(run(false).status, 1);
  const allowed = run(true);
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.match(allowed.stderr, /Starting this checkout/);
  assert.doesNotMatch(allowed.stderr, /Merge or rebase/);
  writeFileSync(path.join(cwd, "src-tauri/tauri.conf.json"), '{"version":"0.8.100"}');
  const inconsistent = run(true);
  assert.equal(inconsistent.status, 1);
  assert.match(inconsistent.stderr, /metadata is inconsistent/);
});

test("parseStableVersion accepts stable app versions only", () => {
  assert.deepEqual(parseStableVersion("v0.8.79"), [0, 8, 79]);
  assert.deepEqual(parseStableVersion("0.9.0"), [0, 9, 0]);
  assert.equal(parseStableVersion("0.8.79-beta.1"), null);
  assert.equal(parseStableVersion("release-0.8.79"), null);
});

test("compareStableVersions compares numeric components", () => {
  assert.equal(compareStableVersions("0.8.79", "v0.8.79"), 0);
  assert.equal(compareStableVersions("0.8.80", "0.8.79"), 1);
  assert.equal(compareStableVersions("0.10.0", "0.9.99"), 1);
});

test("newestStableTag ignores unrelated and prerelease tags", () => {
  assert.equal(
    newestStableTag(["v0.8.79", "notes", "v0.9.0-beta.1", "v0.8.80"]),
    "v0.8.80",
  );
});

test("evaluateDevVersion accepts a development version at or above release", () => {
  assert.equal(
    evaluateDevVersion({
      declaredVersions: synchronizedVersions("0.8.79"),
      releaseTag: "v0.8.79",
    }).ok,
    true,
  );
  assert.equal(
    evaluateDevVersion({
      declaredVersions: synchronizedVersions("0.8.80"),
      releaseTag: "v0.8.79",
    }).ok,
    true,
  );
});

test("evaluateDevVersion rejects stale and inconsistent metadata", () => {
  assert.equal(
    evaluateDevVersion({
      declaredVersions: synchronizedVersions("0.8.76"),
      releaseTag: "v0.8.79",
    }).reason,
    "stale",
  );
  assert.equal(
    evaluateDevVersion({
      declaredVersions: {
        ...synchronizedVersions("0.8.79"),
        "src-tauri/Cargo.toml": "0.8.78",
      },
      releaseTag: "v0.8.79",
    }).reason,
    "inconsistent",
  );
});
