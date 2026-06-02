import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("editor persistence uses the shared queued write helper", async () => {
  const source = await readFile(new URL("./editor-persistence-flow.js", import.meta.url), "utf8");

  assert.match(
    source,
    /import\s*\{[\s\S]*\binvokeQueuedEditorWriteCommand\b[\s\S]*\}\s*from "\.\/editor-queued-write\.js";/,
  );
  assert.doesNotMatch(
    source,
    /\b(?:async\s+)?function\s+invokeQueuedEditorWriteCommand\s*\(/,
  );
});
