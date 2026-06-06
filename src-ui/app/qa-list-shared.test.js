import test from "node:test";
import assert from "node:assert/strict";

import { normalizeQaTerm } from "./qa-list-shared.js";

test("normalizeQaTerm sanitizes ruby markup in term text (parity with glossary)", () => {
  const normalized = normalizeQaTerm({
    termId: "term-1",
    text: "<ruby>漢字<rt>かんじ</rt></ruby> <strong>bold</strong>",
    notes: "note",
  });

  assert.equal(
    normalized.text,
    "<ruby>漢字<rt>かんじ</rt></ruby> &lt;strong&gt;bold&lt;/strong&gt;",
  );
  assert.equal(normalized.termId, "term-1");
  assert.equal(normalized.notes, "note");
});

test("normalizeQaTerm ruby sanitization is idempotent", () => {
  const sanitized = "<ruby>漢字<rt>かんじ</rt></ruby> &lt;strong&gt;bold&lt;/strong&gt;";
  const normalized = normalizeQaTerm({ termId: "term-1", text: sanitized });
  assert.equal(normalized.text, sanitized);
});

test("normalizeQaTerm trims and drops a term that is empty after sanitizing", () => {
  assert.equal(normalizeQaTerm({ termId: "term-1", text: "   ", notes: "" }), null);
  const trimmed = normalizeQaTerm({ termId: "term-1", text: "  hello  " });
  assert.equal(trimmed.text, "hello");
});

test("normalizeQaTerm preserves a notes-only term and leaves notes unprocessed", () => {
  const normalized = normalizeQaTerm({ termId: "term-1", text: "", notes: "  just a note  " });
  assert.equal(normalized.text, "");
  assert.equal(normalized.notes, "just a note");
});
