import test from "node:test";
import assert from "node:assert/strict";

import {
  customHtmlToPlainText,
  sanitizeCustomHtmlForDisplay,
} from "./editor-custom-html.js";

// The Node test runner has no DOM, so sanitizeCustomHtmlForDisplay falls back to
// escaping the input — which is still safe (renders as inert text). The DOM-based
// stripping of <script>/on*/javascript: is exercised by the browser preview.
test("sanitizeCustomHtmlForDisplay escapes input when no DOM is available", () => {
  assert.equal(
    sanitizeCustomHtmlForDisplay("<b>hi</b><script>alert(1)</script>"),
    "&lt;b&gt;hi&lt;/b&gt;&lt;script&gt;alert(1)&lt;/script&gt;",
  );
});

test("sanitizeCustomHtmlForDisplay returns empty for blank input", () => {
  assert.equal(sanitizeCustomHtmlForDisplay(""), "");
  assert.equal(sanitizeCustomHtmlForDisplay("   "), "");
  assert.equal(sanitizeCustomHtmlForDisplay(null), "");
});

test("customHtmlToPlainText strips tags, decodes entities, and collapses whitespace", () => {
  assert.equal(
    customHtmlToPlainText("<p>Hi&nbsp;<a href=\"x\">there</a>\n  &amp; more</p>"),
    "Hi there & more",
  );
  assert.equal(customHtmlToPlainText("<br>"), "");
  assert.equal(customHtmlToPlainText(""), "");
});
