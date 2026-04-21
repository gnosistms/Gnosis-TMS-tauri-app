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
