import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("events routes sync shortcuts and sync-with-server through the action dispatcher", async () => {
  const source = await readFile(new URL("./events.js", import.meta.url), "utf8");
  const keyboardSource = await readFile(new URL("./events/keyboard-shortcuts.js", import.meta.url), "utf8");

  assert.match(source, /registerKeyboardShortcutEvents\(dispatchAction\)/);
  assert.match(keyboardSource, /dispatchAction\("refresh-page", event\)/);
  assert.match(source, /listen\(SYNC_WITH_SERVER_EVENT, \(\) => \{\s*void dispatchAction\("refresh-page"\);/);
  assert.match(source, /listen\(ERROR_REPORTING_EVENT, \(\) => \{\s*void dispatchAction\("open-error-reporting-settings"\);/);
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

test("events open export modal selects on the first pointer interaction", async () => {
  const source = await readFile(new URL("./events.js", import.meta.url), "utf8");

  assert.match(source, /EXPORT_MODAL_SELECT_SELECTOR/);
  assert.match(source, /function openExportModalSelectOnFirstPointer\(event\)/);
  assert.match(source, /event\.target\.closest\(EXPORT_MODAL_SELECT_SELECTOR\)/);
  assert.match(source, /showPicker\.call\(select\)/);
  assert.match(source, /event\.preventDefault\(\)/);
  assert.match(source, /if \(openExportModalSelectOnFirstPointer\(event\)\) \{/);
});

test("events route paste events through the add translation paste fallback", async () => {
  const source = await readFile(new URL("./events.js", import.meta.url), "utf8");

  assert.match(source, /import \{ handleInputEvent, handlePasteEvent \} from "\.\/input-handlers\.js";/);
  assert.match(source, /document\.addEventListener\("paste", \(event\) => handlePasteEvent\(event, render\)\);/);
});

test("editor footnote collapse preserves the row viewport anchor", async () => {
  const keyboardSource = await readFile(new URL("./events/keyboard-shortcuts.js", import.meta.url), "utf8");
  const translateEventsSource = await readFile(new URL("./translate-editor-dom-events.js", import.meta.url), "utf8");
  const persistenceSource = await readFile(new URL("./editor-persistence-flow.js", import.meta.url), "utf8");

  // Shift+Return blurs without a snapshot dance: the focusout path collapses
  // via row patching, which preserves the viewport by construction (P5).
  assert.match(keyboardSource, /event\.target\.blur\(\);/);
  assert.doesNotMatch(keyboardSource, /captureTranslateViewport/);
  assert.match(
    translateEventsSource,
    /previouslyFocusedControl instanceof HTMLTextAreaElement[\s\S]*?previouslyFocusedControl\.dataset\.contentKind === "footnote"[\s\S]*?previouslyFocusedRowId === rowId[\s\S]*?previouslyFocusedControl\.dataset\.languageCode === languageCode[\s\S]*?collapseEmptyEditorFootnote\(render, rowId, languageCode\)/,
  );
  // Row-scoped mutations render via row patching (scroll redesign P3), which
  // preserves the viewport by construction.
  assert.match(persistenceSource, /renderEditorRowScoped\(render, rowId, "footnote-collapse"\)/);
});

test("editor image caption open preserves the clicked row viewport", async () => {
  const actionsSource = await readFile(new URL("./actions/translate-actions.js", import.meta.url), "utf8");
  const translateFlowSource = await readFile(new URL("./translate-flow.js", import.meta.url), "utf8");
  const persistenceSource = await readFile(new URL("./editor-persistence-flow.js", import.meta.url), "utf8");

  assert.match(translateFlowSource, /openEditorImageCaption\(render, rowId, languageCode\)/);
  assert.doesNotMatch(translateFlowSource, /resolveEditorMainFieldViewportSnapshot/);
  assert.match(persistenceSource, /export function openEditorImageCaption\(render, rowId, languageCode, options = \{\}\)/);
  // Row patching preserves the viewport by construction (scroll redesign P3).
  assert.match(persistenceSource, /renderEditorRowScoped\(render, rowId, "image-caption-open"\)/);
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

test("editor review marker toggles preserve the clicked row viewport", async () => {
  const actionsSource = await readFile(new URL("./actions/translate-actions.js", import.meta.url), "utf8");
  const translateEventsSource = await readFile(new URL("./translate-editor-dom-events.js", import.meta.url), "utf8");
  const translateFlowSource = await readFile(new URL("./translate-flow.js", import.meta.url), "utf8");
  const persistenceSource = await readFile(new URL("./editor-persistence-flow.js", import.meta.url), "utf8");

  assert.match(translateEventsSource, /toggleEditorRowFieldMarker\(render, rowId, languageCode, kind\)/);
  assert.doesNotMatch(translateFlowSource, /viewportSnapshot/);
  // Row patching preserves the viewport by construction (scroll redesign P3).
  assert.match(persistenceSource, /renderEditorRowScoped\(render, rowId, "marker-optimistic"\)/);
});

test("opening an editor text field does not schedule delayed viewport restores", async () => {
  const translateFlowSource = await readFile(new URL("./translate-flow.js", import.meta.url), "utf8");

  // Activation renders via row patching (scroll redesign P3): no body remount
  // and no delayed viewport restores to fight the user's input.
  assert.match(
    translateFlowSource,
    /renderEditorRowScoped\(\s*render,\s*\[rowId, previousMainFieldRowId, previousActiveRowId\],\s*"main-field-activate",\s*\);/,
  );
  assert.doesNotMatch(translateFlowSource, /renderTranslateBodyPreservingViewport\(/);
});

test("preview text click hints and double-click jumps are wired through translate DOM events", async () => {
  const translateEventsSource = await readFile(new URL("./translate-editor-dom-events.js", import.meta.url), "utf8");

  assert.match(translateEventsSource, /PREVIEW_EDITABLE_TEXT_BLOCK_SELECTOR/);
  assert.match(translateEventsSource, /showNoticeBadge\("Double click to edit this text", render, 2200\)/);
  assert.match(translateEventsSource, /app\.addEventListener\("dblclick", \(event\) => \{/);
  assert.match(translateEventsSource, /jumpFromPreviewBlockToTranslateMode\(render, previewBlock\)/);
});
