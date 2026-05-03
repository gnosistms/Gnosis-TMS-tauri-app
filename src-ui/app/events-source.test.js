import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("events routes sync shortcuts and sync-with-server through the action dispatcher", async () => {
  const source = await readFile(new URL("./events.js", import.meta.url), "utf8");
  const keyboardSource = await readFile(new URL("./events/keyboard-shortcuts.js", import.meta.url), "utf8");

  assert.match(source, /registerKeyboardShortcutEvents\(dispatchAction\)/);
  assert.match(keyboardSource, /dispatchAction\("refresh-page", event\)/);
  assert.match(source, /listen\(SYNC_WITH_SERVER_EVENT, \(\) => \{\s*void dispatchAction\("refresh-page"\);/);
  assert.doesNotMatch(source, /void refreshCurrentScreen\(render\);/);
});

test("events route native project import drops to the visible project import drop target", async () => {
  const source = await readFile(new URL("./events/native-drops.js", import.meta.url), "utf8");
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

test("events open project export selects on the first pointer interaction", async () => {
  const source = await readFile(new URL("./events.js", import.meta.url), "utf8");

  assert.match(source, /PROJECT_EXPORT_SELECT_SELECTOR/);
  assert.match(source, /function openProjectExportSelectOnFirstPointer\(event\)/);
  assert.match(source, /event\.target\.closest\(PROJECT_EXPORT_SELECT_SELECTOR\)/);
  assert.match(source, /showPicker\.call\(select\)/);
  assert.match(source, /event\.preventDefault\(\)/);
  assert.match(source, /if \(openProjectExportSelectOnFirstPointer\(event\)\) \{/);
});

test("editor footnote collapse preserves the row viewport anchor", async () => {
  const keyboardSource = await readFile(new URL("./events/keyboard-shortcuts.js", import.meta.url), "utf8");
  const translateEventsSource = await readFile(new URL("./translate-editor-dom-events.js", import.meta.url), "utf8");
  const persistenceSource = await readFile(new URL("./editor-persistence-flow.js", import.meta.url), "utf8");

  assert.match(keyboardSource, /contentKind === "" \|\| contentKind === "footnote" \|\| contentKind === "image-caption"/);
  assert.match(translateEventsSource, /contentKind === "" \|\| contentKind === "footnote"/);
  assert.match(translateEventsSource, /collapseEmptyEditorFootnote\(render, rowId, languageCode, \{ viewportSnapshot \}\)/);
  assert.match(persistenceSource, /renderTranslateBodyPreservingViewport\(render, options\?\.viewportSnapshot \?\? null\)/);
});

test("editor image caption open preserves the clicked row viewport", async () => {
  const actionsSource = await readFile(new URL("./actions/translate-actions.js", import.meta.url), "utf8");
  const translateFlowSource = await readFile(new URL("./translate-flow.js", import.meta.url), "utf8");
  const persistenceSource = await readFile(new URL("./editor-persistence-flow.js", import.meta.url), "utf8");

  assert.match(actionsSource, /openEditorImageCaption\(render, rowId, languageCode, \{ target: event\?\.target \?\? null \}\)/);
  assert.match(translateFlowSource, /openEditorImageCaption\(render, rowId, languageCode, options = \{\}\)/);
  assert.match(translateFlowSource, /resolveEditorMainFieldViewportSnapshot\(rowId, languageCode, options\)/);
  assert.match(persistenceSource, /export function openEditorImageCaption\(render, rowId, languageCode, options = \{\}\)/);
  assert.match(persistenceSource, /renderTranslateBodyPreservingViewport\(render, options\?\.viewportSnapshot \?\? null\)/);
});

test("editor image URL blur uses the same submit path as Shift Enter", async () => {
  const translateEventsSource = await readFile(new URL("./translate-editor-dom-events.js", import.meta.url), "utf8");

  assert.match(translateEventsSource, /void submitEditorImageUrl\(render, rowId, languageCode\)/);
  assert.doesNotMatch(translateEventsSource, /void persistEditorImageUrlOnBlur\(render, rowId, languageCode\)/);
  assert.match(
    translateEventsSource,
    /if \(imageUrlInput instanceof HTMLInputElement\) \{\s*requestAnimationFrame\(\(\) => \{[\s\S]*?void submitEditorImageUrl\(render, rowId, languageCode\);[\s\S]*?\}\);\s*return;\s*\}\s*if \(textarea instanceof HTMLTextAreaElement && contentKind === "image-caption"\)/,
  );
});
