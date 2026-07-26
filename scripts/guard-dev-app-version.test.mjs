import assert from "node:assert/strict";
import test from "node:test";

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
