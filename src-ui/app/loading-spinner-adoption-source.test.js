import assert from "node:assert/strict";
import {
  readdirSync,
  readFileSync,
} from "node:fs";
import {
  dirname,
  join,
  relative,
} from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const srcUiRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    if (!entry.isFile() || !entry.name.endsWith(".js") || entry.name.endsWith(".test.js")) {
      return [];
    }
    return [path];
  });
}

test("raw button spinner renderers stay limited to reviewed shared and custom paths", () => {
  const actual = [
    ...sourceFiles(join(srcUiRoot, "lib")),
    ...sourceFiles(join(srcUiRoot, "screens")),
  ]
    .filter((path) => readFileSync(path, "utf8").includes("button__spinner"))
    .map((path) => relative(srcUiRoot, path))
    .sort();

  assert.deepEqual(actual, [
    "lib/ui.js",
    "screens/translate-history-pane.js",
    "screens/translate-review-pane.js",
    "screens/translate-sidebar.js",
  ]);
});
