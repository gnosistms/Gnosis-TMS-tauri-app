import test from "node:test";
import assert from "node:assert/strict";

const { readDevRuntimeFlags } = await import("./dev-runtime-flags.js");

test("readDevRuntimeFlags returns disabled defaults outside dev mode", () => {
  assert.deepEqual(
    readDevRuntimeFlags({
      isDev: false,
      search: "?platform=windows&fixture=editor&rows=320",
    }),
    {
      platformOverride: null,
      editorFixture: null,
    },
  );
});

test("readDevRuntimeFlags parses a Windows editor fixture URL", () => {
  assert.deepEqual(
    readDevRuntimeFlags({
      isDev: true,
      search: "?platform=windows&fixture=editor&rows=320",
    }),
    {
      platformOverride: "windows",
      editorFixture: {
        rowCount: 320,
      },
    },
  );
});

test("readDevRuntimeFlags normalizes aliases and falls back on invalid row counts", () => {
  assert.deepEqual(
    readDevRuntimeFlags({
      isDev: true,
      search: "?platform=macos&editorFixture=true&rowCount=0",
    }),
    {
      platformOverride: "mac",
      editorFixture: {
        rowCount: 200,
      },
    },
  );
});
