import assert from "node:assert/strict";
import test from "node:test";

import {
  parseLsofPaths,
  pathIsWithin,
  targetUsedByLiveProcess,
} from "./guard-rust-build-cache.mjs";

test("pathIsWithin distinguishes target contents from sibling paths", () => {
  const target = "/work/project/src-tauri/target";

  assert.equal(pathIsWithin(target, `${target}/debug/gnosis-tms`), true);
  assert.equal(pathIsWithin(target, `${target}-old/debug/gnosis-tms`), false);
  assert.equal(pathIsWithin(target, "/work/other/target/debug/gnosis-tms"), false);
});

test("pathIsWithin compares Windows paths case-insensitively", () => {
  assert.equal(
    pathIsWithin(
      "C:\\Work\\Gnosis\\src-tauri\\target",
      "c:\\work\\gnosis\\src-tauri\\target\\debug\\gnosis-tms.exe",
      "win32",
    ),
    true,
  );
});

test("targetUsedByLiveProcess protects a cache containing a running binary", () => {
  const target = "/work/project/src-tauri/target";
  const executablePaths = [
    "/usr/bin/node",
    "/work/project/src-tauri/target/debug/gnosis-tms",
  ];

  assert.equal(targetUsedByLiveProcess(target, executablePaths), true);
  assert.equal(
    targetUsedByLiveProcess("/work/other/src-tauri/target", executablePaths),
    false,
  );
});

test("parseLsofPaths extracts executable paths from field output", () => {
  assert.deepEqual(
    parseLsofPaths([
      "p123",
      "ftxt",
      "n/work/project/src-tauri/target/debug/gnosis-tms",
      "ftxt",
      "n/usr/lib/dyld",
    ].join("\n")),
    [
      "/work/project/src-tauri/target/debug/gnosis-tms",
      "/usr/lib/dyld",
    ],
  );
});
