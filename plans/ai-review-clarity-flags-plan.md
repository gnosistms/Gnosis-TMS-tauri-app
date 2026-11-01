# AI Review: identify parts that are difficult to understand

## Goal

Add a second option to the AI Review modal, "Identify parts that are difficult
to understand". The AI reads each unreviewed translation the way a reader of
the translation would, without the source. When the meaning of part of a
row is unclear, the AI sets the row's red "please check" (?) status for that
language and writes a row comment explaining the problem. It never changes the
text.

## Decisions (agreed with Hans, 2026-11-01)

- **Flag only.** This option makes no text, footnote, or caption edits. The
  existing two options are unchanged.
- **Input.** The target-language sections (text, footnotes, image caption)
  plus neighbouring target-language rows as read-only context. No source text,
  glossary, QA hints, history, or reference translations.
- **Clear rows are untouched.** No reviewed mark, no please-check change, no
  commit. They were not checked for spelling or grammar, so marking them
  reviewed would hide them from later reviews.
- **Comment language.** The target language.
- **Comment author.** Stored under the login of the person who ran the review
  with the display name "AI Review", so the existing author-only delete rule
  lets that person delete it.
- **Reviewed rows are skipped**, like the other options (the existing
  preflight warning applies).
- **Reruns.** A row is skipped when it already has an AI clarity comment for
  that language and its text, footnotes, and caption are unchanged since. If
  someone edits the row, or deletes the AI comment, it is checked again.
- **Threshold.** Flag only when a fluent reader cannot work out what is meant,
  or a passage has more than one plausible reading that the context does not
  settle. Dense, formal, technical, or literary text that is clear on a careful
  read is not flagged; nor are headings, list items, or sentences that continue
  in a neighbouring row.

## Design

### Review mode

A third review mode value, `"clarity"`, alongside `"grammar"` and
`"meaning"`. `normalizeEditorAiReviewMode` accepts it; the single-row Review
button never passes it.

### Rust: prompts and responses (`src-tauri/src/ai/`)

- `normalize_review_mode` accepts `"clarity"`.
- `build_review_prompt` / `build_review_batch_prompt` get a clarity branch:
  task, flag threshold, comment rule (target language, quote the unclear
  words, name competing readings, never rewrite), target-only context, and the
  rows. Batch context comes from `context_before` / `context_after` target
  text; single-row context comes from `row_window`, split at the new
  `AiReviewRequest.row_id`.
- Responses use `AiPromptOutputFormat::JsonSchema` (strict schemas: single
  `{comment}`, batch `{rows:[{rowId, comment}]}`), so no new enum variant.
- `AiReviewResponse` and `AiReviewBatchRowResult` gain `comment` (serde
  default). In clarity mode suggested fields are always empty and `reviewed`
  is false; the frontend acts on `comment` alone.

### Rust: storing the comment (`project_import/`)

- `StoredEditorComment` gains an optional `ai_review` object
  (`kind: "clarity"`, `language_code`, `content_fingerprint`), omitted when
  absent so existing comments are byte-identical.
- `chapter_editor_comments.rs` gets `append_ai_review_clarity_comment` (author =
  signed-in login, name "AI Review") and `ai_clarity_fingerprints` (latest
  fingerprint per language).
- `apply_gtms_editor_ai_review_result(s_batch)` inputs gain optional `comment`
  and `commentFingerprint`. A non-empty comment is appended to the row file in
  the same commit as the please-check flag. Responses gain the row's
  `commentCount`, `commentsRevision`, and `aiClarityFingerprints`.
- `EditorRow` gains `aiClarityFingerprints` (omitted when empty).

### Frontend

- Modal: three radios; the new one is second.
- Flow (`editor-ai-review-all-flow.js`), clarity mode:
  - Work list skips rows whose `aiClarityFingerprints[lang]` matches the
    current content fingerprint.
  - Batches only join rows that are adjacent in the chapter, so each batch is
    continuous text and its context rows are its true neighbours.
  - No history or QA-hint loading.
  - Rows with an empty comment are counted as done with no write. Rows with a
    comment are applied with `pleaseCheck: true`, `reviewed: false`, empty
    suggestions, and the comment + fingerprint.
  - Applying updates the row's comment summary and fingerprints.
- Finished dialog: clarity-specific copy pointing to the Comments tab instead
  of History.
- Content fingerprint: a small deterministic string hash of the row's
  target text, footnotes, and caption, computed only in JS (Rust stores and
  echoes it).

## Tests

- Rust: clarity prompt content (single + batch), response parsing, comment
  append + fingerprint map, apply with comment (single + batch).
- JS: work-list skipping, adjacency batching, apply payloads, modal radios,
  finished copy.

## Out of scope

- Using the source text to explain what was meant.
- A language tag on comments in the comments pane.
