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
const translateFlowSource = readFileSync(
  path.join(currentDir, "translate-flow.js"),
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

test("assistant composer uses the shorter prompt box sizing", () => {
  assert.match(translateCssSource, /\.assistant-composer__field-shell\s*{[\s\S]*height: 71px;/);
  assert.equal(
    inputHandlersSource.includes("syncAutoSizeTextarea(input, { minHeight: 53, maxHeight: 132 });"),
    true,
  );
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
