# QA List Context for AI Review

## Goal

Send matching default QA-list entries to single-row and batch AI Review in both
grammar and meaning modes. Literal terms use language-aware boundaries; regex terms
use Rust's safe regex engine. Matches are advisory context, and the model relies on
each entry's notes to decide whether anything is wrong.

## Implementation

1. Extend QA terms with backward-compatible `isRegularExpression` and
   `isCaseSensitive` booleans, expose both checkboxes in the term editor, reject
   invalid checked regexes, and preserve the flags through native JSON and TMX.
2. Add a Rust QA matcher command that resolves the selected/default local QA list,
   caches compiled patterns by repository revision, scans main text, footnotes, and
   image captions separately, and returns at most 100 matched terms per row with
   notes and concrete matched text.
3. Resolve and load the target language's active/default QA list before AI Review.
   Match a single row once, or all pending batch rows once, then add per-row QA hints
   to the AI request payloads.
4. Render matched QA data as structured `<qa_info>` prompt context in both grammar
   and meaning prompts. Explicitly tell the model that entries are advisory and that
   their notes determine whether a correction is needed.

## Verification

- Unit-test term normalization, duplicate handling, checkbox rendering/input,
  invalid regex rejection, JSON/TMX compatibility, literal boundary/case behavior,
  regex behavior, match limits, and cache-safe matching.
- Test single and batch request construction and Rust prompt output in both review
  modes, including no-list/no-match behavior.
- Run focused frontend tests, Rust tests, then the full frontend suite and Cargo
  checks where practical.
