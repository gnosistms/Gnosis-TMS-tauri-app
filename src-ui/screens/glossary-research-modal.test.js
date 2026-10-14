import test from "node:test";
import assert from "node:assert/strict";

globalThis.document = globalThis.document ?? { querySelector: () => null, querySelectorAll: () => [] };
globalThis.window = globalThis.window ?? {};

const { savedMark } = await import("./glossary-research-modal.js");

test("past research saved to the glossary is marked, with when and what on hover", () => {
  assert.equal(savedMark({ status: "done" }), "");
  const html = savedMark({ status: "done", savedToGlossary: { at: "2026-10-12T09:30:00.000Z", entries: [{ sourceTerms: ["regenerar", "regenera"] }, { sourceTerms: ["regenerarse"] }] } });
  assert.match(html, /✓ saved/);
  assert.match(html, /Saved to the glossary on 2026-10-12: regenerar, regenera; regenerarse\./);
});
