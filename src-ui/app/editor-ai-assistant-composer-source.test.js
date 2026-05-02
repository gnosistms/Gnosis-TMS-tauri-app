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

test("assistant source context uses token-budget expansion", () => {
  assert.equal(
    editorAiAssistantFlowSource.includes("ASSISTANT_SOURCE_CONTEXT_PREVIOUS_TOKEN_TARGET = 75"),
    true,
  );
  assert.equal(
    editorAiAssistantFlowSource.includes("ASSISTANT_SOURCE_CONTEXT_NEXT_TOKEN_TARGET = 25"),
    true,
  );
  assert.equal(
    editorAiAssistantFlowSource.includes("estimateAssistantContextTokens"),
    true,
  );
  assert.equal(
    editorAiAssistantFlowSource.includes("previousTokenCount < ASSISTANT_SOURCE_CONTEXT_PREVIOUS_TOKEN_TARGET"),
    true,
  );
  assert.equal(
    editorAiAssistantFlowSource.includes("nextTokenCount < ASSISTANT_SOURCE_CONTEXT_NEXT_TOKEN_TARGET"),
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

test("assistant sidebar renders schedule the transcript to scroll down", () => {
  assert.equal(
    translateFlowSource.includes("export function scheduleAssistantTranscriptScrollToBottomAfterRender()"),
    true,
  );
  assert.equal(
    mainSource.includes("state.editorChapter?.sidebarTab === \"assistant\""),
    true,
  );
  assert.ok(
    (mainSource.match(/scheduleAssistantTranscriptScrollToBottomAfterRender\(\);/g) ?? []).length >= 2,
  );
});
