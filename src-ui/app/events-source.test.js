import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("events routes sync shortcuts and sync-with-server through the action dispatcher", async () => {
  const source = await readFile(new URL("./events.js", import.meta.url), "utf8");

  assert.match(source, /dispatchAction\("refresh-page", event\)/);
  assert.match(source, /listen\(SYNC_WITH_SERVER_EVENT, \(\) => \{\s*void dispatchAction\("refresh-page"\);/);
  assert.doesNotMatch(source, /void refreshCurrentScreen\(render\);/);
});
