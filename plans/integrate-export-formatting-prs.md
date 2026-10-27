# Integrate export formatting with PRs 382 and 383

## Scope

Open a PR for this chat's export improvements, including the title-page logo at
85%, and merge the branches of PRs 382 and 383 into that work. Do not merge the
combined branch into main. Preserve unrelated unfinished work in the original
checkout.

## Steps

1. Inspect current main, both PR heads, and the working changes. Create an
   isolated integration checkout and retain only changes belonging to this chat.
2. Commit the export changes, merge both PR branches, resolve any overlapping
   book-composer/layout changes, and verify that chapter-title editing and the
   glossary fixes remain intact.
3. Run frontend, native, and browser checks appropriate to the merged changes.
   Push the integration branch, create and attach a PR with the final scope and
   validation results.

## Status

Merge and validation complete on `codex/book-export-formatting-integration`,
based on main at `5b0368ed`. PR 382 (`56bafc63`) and PR 383 (`230ccebd`) are
both ancestors of the integration branch, with explicit merge commits.

Chapter title overrides retain the numbered chapter-opening layout and numbered
contents entries. The H1 contents option remains separate from chapter titles;
front-matter controls retain the attached toolbar. Font-approval previews and
glyph checks use the revised print sizes. The publisher logo is 85% of its prior
width and height. Unrelated local research/editor work was excluded.

Validation:

- 3,072 frontend unit/screen tests and 25 workflow tests passed.
- 924 native tests passed, 13 ignored, with actual offline Typst compilation and
  approved fallback-glyph checks enabled.
- All 17 combined export and glossary-refresh browser workflows passed.
- Strict Clippy for all targets, Rust formatting, JavaScript lint, whitespace
  checks, and the production frontend build passed. Existing JS warnings remain.
- The unused-code audit retains the baseline 41 unused files and 16 exports.
- The integrated A5 proof is 29 pages with numbered, editable chapter titles and
  final-location contents entries, including optional H1 headings.

Publication is the final step; main is not modified by this integration.
