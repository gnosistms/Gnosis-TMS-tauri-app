import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const translateSidebarSource = readFileSync(
  path.join(currentDir, "../screens/translate-sidebar.js"),
  "utf8",
);
const translateEditorDomEventsSource = readFileSync(
  path.join(currentDir, "translate-editor-dom-events.js"),
  "utf8",
);
const editorAiAssistantFlowSource = readFileSync(
  path.join(currentDir, "editor-ai-assistant-flow.js"),
  "utf8",
);
const inputHandlersSource = readFileSync(
  path.join(currentDir, "input-handlers.js"),
  "utf8",
);
const autosizeSource = readFileSync(
  path.join(currentDir, "autosize.js"),
  "utf8",
);
const translateFlowSource = readFileSync(
  path.join(currentDir, "translate-flow.js"),
  "utf8",
);
const mainSource = readFileSync(
  path.join(currentDir, "../main.js"),
  "utf8",
);
const translateCssSource = readFileSync(
  path.join(currentDir, "../styles/translate.css"),
  "utf8",
);

test("assistant composer shows the Shift + Return send hint", () => {
  assert.equal(
    translateSidebarSource.includes("Shift + Return to send"),
    true,
  );
});

test("assistant composer shortcut handling submits on Shift + Return", () => {
  assert.equal(
    translateEditorDomEventsSource.includes("[data-editor-assistant-draft]"),
    true,
  );
  assert.equal(
    translateEditorDomEventsSource.includes("&& event.shiftKey"),
    true,
  );
  assert.equal(
    translateEditorDomEventsSource.includes("void runEditorAiAssistant(render);"),
    true,
  );
});

test("assistant transcript scrolls to the newest message after prompt and reply renders", () => {
  assert.equal(
    editorAiAssistantFlowSource.includes("function renderAssistantSidebarAtBottom(render)"),
    true,
  );
  assert.equal(
    editorAiAssistantFlowSource.includes("waitForNextPaint().then"),
    true,
  );
  assert.ok(
    (editorAiAssistantFlowSource.match(/renderAssistantSidebarAtBottom\(render\);/g) ?? []).length >= 2,
  );
});

test("assistant source context uses the shared token-budget window builder", () => {
  const contextWindowSource = readFileSync(
    path.join(currentDir, "editor-ai-context-window.js"),
    "utf8",
  );
  // The token-budget expansion now lives in the shared context-window module.
  assert.equal(contextWindowSource.includes("AI_CONTEXT_BEFORE_TOKEN_TARGET"), true);
  assert.equal(contextWindowSource.includes("AI_CONTEXT_AFTER_TOKEN_TARGET"), true);
  assert.equal(contextWindowSource.includes("estimateSourceTokens"), true);
  // The assistant flow consumes it rather than owning its own copy.
  assert.equal(
    editorAiAssistantFlowSource.includes("buildRowSourceContextWindow"),
    true,
  );
  assert.equal(
    editorAiAssistantFlowSource.includes("./editor-ai-context-window.js"),
    true,
  );
});

test("assistant composer grows to three times the default prompt box height", () => {
  assert.match(translateCssSource, /\.assistant-composer__field-shell\s*{[\s\S]*min-height: 71px;/);
  assert.equal(
    inputHandlersSource.includes("syncAutoSizeTextarea(input, { minHeight: 71, maxHeight: 213 });"),
    true,
  );
  assert.equal(
    autosizeSource.includes("syncAutoSizeTextarea(element, { minHeight: 71, maxHeight: 213 })"),
    true,
  );
});

test("assistant composer input does not rerender the sidebar on every keystroke", () => {
  const handlerMatch = inputHandlersSource.match(
    /function handleEditorAssistantDraftInput\(event, render\) \{[\s\S]*?\n\}/,
  );
  assert.ok(handlerMatch);
  assert.equal(handlerMatch[0].includes("render?.({ scope: \"translate-sidebar\" });"), false);
  assert.equal(handlerMatch[0].includes("scheduleEditorAssistantTranscriptScrollToBottom();"), true);
});

test("opening the assistant tab schedules the transcript to scroll down", () => {
  assert.equal(
    translateFlowSource.includes("scheduleAssistantTranscriptScrollToBottom"),
    true,
  );
  assert.equal(
    editorAiAssistantFlowSource.includes("export function scheduleAssistantTranscriptScrollToBottom()"),
    true,
  );
});

test("assistant sidebar rerenders preserve the transcript scroll position", () => {
  assert.equal(
    mainSource.includes("function captureAssistantTranscriptScrollTop(root = app)"),
    true,
  );
  assert.equal(
    mainSource.includes("function restoreAssistantTranscriptScrollTop(scrollTop, root = app)"),
    true,
  );
  assert.equal(
    mainSource.includes("const assistantTranscriptScrollTop = captureAssistantTranscriptScrollTop(sidebar);"),
    true,
  );
  assert.equal(
    mainSource.includes("restoreAssistantTranscriptScrollTop(assistantTranscriptScrollTop, sidebar);"),
    true,
  );
  assert.equal(
    mainSource.includes("scheduleAssistantTranscriptScrollToBottomAfterRender"),
    false,
  );
});
