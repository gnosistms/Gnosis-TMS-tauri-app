import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("editor virtual list skips image-load row resize when preview size is unchanged", async () => {
  const source = await readFile(new URL("./editor-virtual-list.js", import.meta.url), "utf8");

  assert.match(source, /takeEditorImagePreviewFrameSyncResult\(image\)[\s\S]*syncEditorImagePreviewFrameWithResult\(image\)/);
  assert.match(source, /if \(syncResult\.sizeChanged !== true\) \{\s*return;\s*\}/);
  assert.match(source, /notifyRowHeightMayHaveChanged\("", image, \{\s*reason: "image-load",\s*\}\)/);
});
