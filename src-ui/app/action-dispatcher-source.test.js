import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("action dispatcher blocks non-update actions while a required update is active", async () => {
  const source = await readFile(new URL("./action-dispatcher.js", import.meta.url), "utf8");

  assert.match(source, /state\.appUpdate\.required === true/);
  assert.match(source, /install-app-update/);
  assert.match(source, /check-for-updates/);
});
