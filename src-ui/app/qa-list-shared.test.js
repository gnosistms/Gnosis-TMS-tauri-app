import test from "node:test";
import assert from "node:assert/strict";

import { normalizeQaTerm, selectedTeam } from "./qa-list-shared.js";
import { state } from "./state.js";

test("selectedTeam returns null when the selected id matches no team (parity with glossary, no teams[0] fallback)", () => {
  state.teams = [{ id: "team-1" }, { id: "team-2" }];
  state.selectedTeamId = "team-1";
  assert.equal(selectedTeam()?.id, "team-1");

  // Stale/cleared selection must NOT silently fall back to teams[0].
  state.selectedTeamId = "missing";
  assert.equal(selectedTeam(), null);

  state.selectedTeamId = null;
  assert.equal(selectedTeam(), null);

  // Explicit teamId arg is honored (matches glossary signature).
  assert.equal(selectedTeam("team-2")?.id, "team-2");

  state.teams = [];
  state.selectedTeamId = null;
});

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
