import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("events routes sync shortcuts and sync-with-server through the action dispatcher", async () => {
  const source = await readFile(new URL("./events.js", import.meta.url), "utf8");

  assert.match(source, /dispatchAction\("refresh-page", event\)/);
  assert.match(source, /listen\(SYNC_WITH_SERVER_EVENT, \(\) => \{\s*void dispatchAction\("refresh-page"\);/);
  assert.doesNotMatch(source, /void refreshCurrentScreen\(render\);/);
});

test("events route native project import drops to the visible project import drop target", async () => {
  const source = await readFile(new URL("./events.js", import.meta.url), "utf8");
  const runtimeSource = await readFile(new URL("./runtime.js", import.meta.url), "utf8");

  assert.match(runtimeSource, /getCurrentWebview\(\)/);
  assert.match(runtimeSource, /onDragDropEvent\(handler\)/);
  assert.match(runtimeSource, /"tauri:\/\/drag-enter", "enter"/);
  assert.match(runtimeSource, /"tauri:\/\/drag-over", "over"/);
  assert.match(runtimeSource, /"tauri:\/\/drag-drop", "drop"/);
  assert.match(runtimeSource, /"tauri:\/\/drag-leave", "leave"/);
  assert.match(source, /onCurrentWebviewDragDrop\(\(event\) => \{/);
  assert.match(source, /eventType === "enter" \|\| eventType === "over"/);
  assert.match(source, /setProjectImportDropzoneNativeDragActive/);
  assert.match(source, /setGlossaryImportDropzoneNativeDragActive/);
  assert.match(source, /eventType !== "drop"/);
  assert.match(source, /function projectImportDropzoneFromNativeDropEvent\(event\)/);
  assert.match(source, /function glossaryImportDropzoneFromNativeDropEvent\(event\)/);
  assert.match(source, /function visibleProjectImportDropzone\(\)/);
  assert.match(source, /function visibleGlossaryImportDropzone\(\)/);
  assert.match(source, /function pointIsInsideElement\(element, x, y\)/);
  assert.match(source, /document\.elementFromPoint\(x, y\)/);
  assert.match(source, /position\.x \/ scale/);
  assert.match(source, /return visibleDropzone/);
  assert.match(source, /if \(projectImportDropzoneFromNativeDropEvent\(event\)\) \{/);
  assert.match(source, /if \(glossaryImportDropzoneFromNativeDropEvent\(event\)\) \{/);
  assert.match(source, /void handleDroppedProjectImportPaths\(render, importPaths\)/);
  assert.match(source, /void handleDroppedGlossaryImportPath\(render, droppedPath\)/);
});
