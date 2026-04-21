import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./projects.js", import.meta.url), "utf8");

test("projects screen includes the conflicted repo overwrite recovery copy and action", () => {
  assert.match(source, /overwrite-conflicted-project-repos/);
  assert.match(source, /Overwrite and resolve/);
  assert.match(
    source,
    /We can resolve this problem by overwriting all changes on saved on this computer with the latest data from the server\./,
  );
});
