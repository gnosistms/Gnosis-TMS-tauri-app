import test from "node:test";
import assert from "node:assert/strict";
import { createPdfFontCoverageReport } from "./pdf-font-telemetry.js";

test("PDF font diagnostics allowlist metadata and exclude document content and font paths", () => {
  const report = createPdfFontCoverageReport({
    unicodeBlocks: ["Egyptian Hieroglyphs"], primaryFamilies: ["Crimson Pro"],
    fallbackFamilies: ["Noto Sans Egyptian Hieroglyphs"], missingCharacterCount: 4, recovered: true,
    documentText: "Confidential text", codepoints: ["U+13153"],
    path: "/Users/example/Library/Fonts/private.ttf", imageDataUrl: "data:image/svg+xml;base64,secret",
  });
  assert.equal(report.level, "warning");
  assert.equal(report.tags.missing_character_count, "4");
  assert.equal(report.tags.fallback_fonts, "Noto Sans Egyptian Hieroglyphs");
  assert.doesNotMatch(JSON.stringify(report), /Confidential|U\+13153|private.ttf|base64|\/Users/);
});
