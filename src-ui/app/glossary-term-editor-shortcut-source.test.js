import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const eventsSource = readFileSync(
  path.join(currentDir, "events.js"),
  "utf8",
);

test("glossary term editor shortcut handling submits on Shift + Return", () => {
  assert.equal(
    eventsSource.includes("[data-glossary-term-variant-input], [data-glossary-term-notes-input], [data-glossary-term-footnote-input]"),
    true,
  );
  assert.equal(
    eventsSource.includes("&& event.shiftKey"),
    true,
  );
  assert.equal(
    eventsSource.includes('void dispatchAction("submit-glossary-term-editor", event);'),
    true,
  );
});
