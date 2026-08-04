# AI Review Footnote Marker Integrity Plan

## Implementation Status

Implemented on 2026-08-03. The review contract now carries marker-keyed
footnotes, both frontend and Rust write paths reject marker changes, and valid
footnote corrections are merged by marker instead of replacing the complete
footnote field. Post-review hardening also verifies markers after legacy
serialization, preserves marker identity in single-row stale snapshots, and
revalidates the current row immediately before Apply.

Automated verification completed:

- `npm test`: 1,888 frontend tests and 5 workflow tests passed;
- `cargo test --manifest-path src-tauri/Cargo.toml`: 552 passed, 1 ignored;
- focused JavaScript lint: no errors;
- Rust formatting and diff whitespace checks: passed.

`npm run audit:unused` still reports the pre-existing unrelated file
`scripts/bench-ai-translate.mjs`. Strict Rust lint could not run because the
repository's build-cache guard requires 30 GiB free and only 24.7 GiB was
available after clearing the generated Rust target cache. The disposable live
provider field check remains manual because it would write to a project repo.

## Goal

Prevent single-row AI Review and AI Review All from deleting, creating,
renumbering, duplicating, or collapsing footnote markers while still allowing the
AI to correct the text of individual footnotes.

The fix must cover both marker locations:

- inline references such as `[1]`, `[2]`, and `[3]` in the row's main text;
- the marker identity attached to each structured footnote entry.

## Confirmed Failure

HNHH chapter 02 commit `4dc1381` (`AI review 15 rows vi`, 2026-08-03)
removed footnote labels from several shapes in one run:

- a single non-default marker: `[9]`;
- three entries: `[1]`, `[2]`, `[3]`;
- two entries: `[1]`, `[2]`.

For row `019debb4-fbaa-7be0-889a-11226e409621`, the inline references in
`plain_text` survived, but the stored footnote field changed from three labeled
entries to one unlabeled block. Commit `4d309c0` restored the row from the
pre-review revision.

The failure is deterministic in the current data path:

1. `editor-ai-review-request.js` calls `editorFootnotesPlainText`, which removes
   marker identity and joins all footnote bodies into one string.
2. The AI receives and returns one flat `suggestedFootnote` value.
3. The Rust apply commands replace the row's complete stored footnote field with
   that flat value.
4. The frontend batch apply path treats the returned block as marker `1`, so its
   in-memory representation can also disagree with the persisted row until the
   next reload.

## Required Invariants

Treat marker identity as application-owned structure, never AI-editable text.

1. AI Review may edit a footnote entry's `text`, but it may not edit its
   `marker`.
2. Applying a review result must preserve the row's complete ordered footnote
   marker set.
3. A suggested main-text correction must contain exactly the same ordered
   sequence of unescaped footnote markers as the reviewed main text. Marker
   positions may move as wording changes, but markers may not be added, removed,
   duplicated, or reordered.
4. Escaped literal markers such as `\[2\]` are not structural markers and must
   be ignored by integrity checks, matching `parseUnescapedFootnoteMarkers`.
5. A footnote correction may reference only an existing marker and may contain
   each marker at most once.
6. Empty footnote suggestions mean "no footnote correction"; they must never
   create an empty marker-1 note.
7. Invalid AI output fails closed for that row: preserve all original content,
   keep `reviewed` false, set `please_check` true, and expose a concise marker
   integrity message. A malformed row in a batch must not prevent valid rows in
   the same batch from being applied.
8. The same validation and merge rules must be used by single-row review, batch
   review, and batch fallback-to-single review.

## Data Contract

### Request

Replace the review-only flat footnote strings with structured entries:

```json
{
  "footnotes": [
    { "marker": 1, "text": "First note" },
    { "marker": 2, "text": "Second note" }
  ],
  "sourceFootnotes": [
    { "marker": 1, "text": "Source note" }
  ]
}
```

Use the frontend's normalized footnote entries directly. Do not serialize them
through `editorFootnotesPlainText` for AI Review. Meaning review includes
structured source footnotes; grammar review continues to omit source content.

Keep the existing persisted row format unchanged. This is an internal AI request
contract change, not a project-repository migration.

### Response

Replace `suggestedFootnote` with corrections keyed by marker:

```json
{
  "suggestedFootnotes": [
    { "marker": 2, "text": "Corrected second note" }
  ]
}
```

The array contains only changed entries. An empty array means no footnote
changes. The application merges these corrections into the original structured
entries by marker; it never constructs a replacement collection from the model's
array.

Update both the single-row and batch JSON contracts, the Rust response models,
and OpenAI's strict JSON schemas. The prompt contracts used by Claude, Gemini,
and DeepSeek must describe the same shape even where the provider does not use a
separate strict schema.

## Implementation

### 1. Share marker-safe footnote helpers

In `src-ui/app/editor-footnotes.js`:

- add or expose a helper that clones normalized structured entries for an AI
  request;
- add a helper that returns the ordered unescaped marker sequence from main
  text;
- add a pure merge/validation helper that accepts original entries and proposed
  `{ marker, text }` corrections, rejects unknown or duplicate markers, and
  returns a collection with the original marker order and identities;
- keep `editorFootnotesPlainText` for display/search/legacy callers, but remove
  it from AI Review request and result application paths.

In the Rust chapter editor:

- promote the existing labeled-footnote parser, legacy serializer, and
  unescaped-marker scanning logic into narrowly shared helpers usable by row
  merge/export and AI Review writes;
- preserve the current legacy serialization rule: a single marker-1 entry may
  be stored as bare text, while multiple entries or a non-default marker retain
  explicit `[n]` labels;
- avoid introducing a second parser whose escaping or whitespace behavior can
  drift from the editor.

Likely files:

- `src-ui/app/editor-footnotes.js`
- `src-ui/app/editor-footnotes.test.js`
- `src-tauri/src/project_import/chapter_editor/row_fields.rs`
- `src-tauri/src/project_import/chapter_editor/row_merge.rs`
- `src-tauri/src/project_import/chapter_editor/chapter_export.rs` only if helper
  visibility/imports move

### 2. Carry structured footnotes through AI Review

Update the frontend request builders so single and batch requests send normalized
`footnotes` and `sourceFootnotes` arrays without losing markers.

Update Rust AI types, prompt formatting, structured-response parsing, and provider
schemas:

- add one shared marker/text type for request and response entries;
- render footnotes in prompts as JSON or clearly delimited marker/text records;
- explicitly tell the model that markers are immutable identifiers and that
  `suggestedFootnotes` may contain only changed existing entries;
- parse responses into structured corrections;
- reject duplicate, zero, negative, or unknown markers against the corresponding
  request before returning the response to JavaScript;
- when `reviewed` is true, clear all suggested fields, including
  `suggestedFootnotes`, as today;
- preserve prompt text/debug output behavior.

Likely files:

- `src-ui/app/editor-ai-review-request.js`
- `src-ui/app/editor-ai-review-request.test.js`
- `src-tauri/src/ai/types.rs`
- `src-tauri/src/ai/mod.rs`
- `src-tauri/src/ai/providers/openai.rs`
- provider-specific tests only where their response parsing depends on the exact
  review JSON shape

### 3. Validate main-text markers before any write

When `suggestedText` is non-empty, compare its ordered unescaped marker sequence
with the sequence in the exact target text that was reviewed.

- Single-row review validates against the request snapshot before showing or
  applying a suggestion.
- Batch review validates each returned row against the captured
  `latestTranslation` used for that request.
- Existing mid-flight state checks continue to rerun a changed row rather than
  applying an old result.
- The Rust write boundary repeats marker validation against the current stored
  row so a stale or bypassed frontend cannot persist marker loss.

Do not silently repair a malformed main-text suggestion by re-inserting markers:
the application cannot reliably infer their intended linguistic positions.

### 4. Merge footnote corrections instead of replacing the field

Update the single and batch apply payloads to carry `suggestedFootnotes`.

At the Rust write boundary, for each row:

1. parse the current stored footnote field into marker/text entries;
2. validate every proposed marker against that current collection;
3. replace only the matching entry's text;
4. serialize the complete merged collection back to the existing row format;
5. verify that the serialized/reparsed marker set is unchanged before preparing
   the file write.

Update frontend state from the structured merged result returned by Rust, rather
than applying a flat string to marker `1`. Prefer returning structured `footnotes`
from the AI Review apply commands while retaining the legacy string only if an
existing caller still requires it.

For batch writes, return a per-row validation outcome. Invalid rows are omitted
from the prepared write set, remain unreviewed/Please Check in the editor, and
include a stable reason such as `footnote-marker-integrity`; valid rows are still
committed together. If no row remains valid, do not create an empty commit.

Likely files:

- `src-ui/app/editor-ai-review-flow.js`
- `src-ui/app/editor-ai-review-state.js`
- `src-ui/app/editor-ai-review-all-flow.js`
- `src-ui/screens/translate-review-pane.js` if a dedicated integrity message is
  needed
- `src-tauri/src/project_import/chapter_editor/mod.rs`
- `src-tauri/src/project_import/chapter_editor/row_fields.rs`

### 5. User-visible failure behavior and diagnostics

- Single-row review: keep the original content and show that the suggestion was
  not applied because it changed footnote markers.
- AI Review All: continue processing, count the rejected row as completed but
  not reviewed, set Please Check, and include rejected rows in the closing
  summary/filter.
- Add a scrubbed nonfatal diagnostic with a stable operation/reason and no row
  text or footnote contents. Do not report one event per row in a large batch;
  aggregate by batch/run.
- Do not expose raw provider JSON in user-facing errors.

## Tests

### Frontend unit tests

Add focused coverage for:

- request construction preserves `[1]`, `[2]`, `[3]` as three structured
  entries;
- a single non-default `[9]` marker stays marker 9;
- source footnotes are included only in meaning review;
- valid corrections update only the identified footnote text;
- corrections returned out of order still preserve original collection order;
- duplicate and unknown suggested markers are rejected;
- an empty correction array leaves footnotes byte-for-byte equivalent after
  legacy serialization;
- a suggested main text with a missing, added, duplicated, or reordered marker
  is rejected;
- moved markers with the same ordered sequence are accepted;
- escaped markers are ignored;
- AI Review All no longer assigns a flat multi-note result to marker 1;
- rows without footnotes do not acquire an empty note;
- mid-flight row changes still trigger the existing rerun/fallback behavior.

Primary test files:

- `src-ui/app/editor-footnotes.test.js`
- `src-ui/app/editor-ai-review-request.test.js`
- `src-ui/app/editor-ai-review-all-flow.test.js`
- the existing single-row AI Review flow/state tests

### Rust unit tests

Add coverage for:

- prompt contracts contain structured marker/text entries and immutable-marker
  instructions in grammar and meaning modes, single and batch;
- structured response parsing accepts valid marker corrections;
- response parsing rejects marker 0, duplicates, and markers absent from the
  request;
- OpenAI strict schemas require the structured response shape;
- the write boundary preserves `[1]/[2]/[3]`, `[1]/[2]`, and `[9]` while changing
  only note text;
- a main-text suggestion that loses an inline marker produces no content write;
- a batch containing one invalid and one valid row writes only the valid row and
  reports the invalid row without aborting the batch;
- legacy single-marker-1 rows remain stored/readable as bare footnote text;
- multi-paragraph footnote bodies are not split at blank lines unless a valid
  leading marker starts the next entry;
- no-op or entirely rejected batches create no git commit.

Primary test locations:

- tests in `src-tauri/src/ai/mod.rs`
- tests in `src-tauri/src/ai/providers/openai.rs`
- chapter-editor tests in `src-tauri/src/project_import/chapter_editor/mod.rs`
  or `row_fields.rs`

### Verification

Run:

```bash
npm test
cargo test --manifest-path src-tauri/Cargo.toml
npm run audit:unused
```

Then perform a field check in `tauri:dev` with a disposable/restorable chapter:

1. Run single-row grammar and meaning review on rows with `[1]/[2]/[3]` and
   `[9]` footnotes.
2. Run AI Review All across a mixture of no-footnote, one-footnote, and
   multi-footnote rows.
3. Inspect the resulting git diff and confirm marker sequences and labels are
   unchanged while accepted footnote wording corrections are isolated to the
   matching entries.
4. Use a test provider response that drops or invents a marker and confirm the
   row is preserved and routed to Please Check.

## Acceptance Criteria

- Re-running the HNHH chapter 02 scenario cannot reproduce the marker deletion
  from `4dc1381`.
- AI Review never writes a different inline marker sequence or footnote marker
  set than the row it reviewed.
- Footnote wording corrections remain supported for individual entries.
- Single-row, batch, and fallback paths have identical marker behavior.
- Invalid provider output cannot reach the project repository.
- Existing project row files require no migration.
- Rows without footnotes do not gain footnotes.
- Valid rows in a partially malformed batch are still applied and committed.

## Rollout Note

Until this structured contract and the Rust write guard are both present, the
safe temporary mitigation is to ignore AI footnote suggestions for rows with
multiple footnotes or any non-default marker. Prompt-only preservation is not an
acceptable final fix because the model can still omit labels.
