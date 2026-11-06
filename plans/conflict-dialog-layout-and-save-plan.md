# Conflict dialog layout and save interaction

## Goal

Keep the two conflict versions top-aligned and make Save and finalize respond
to the first click without jumping the dialog to the top.

## Plan

1. Top-align the version columns and verify unequal footnote lengths in a browser.
2. Reproduce the save click after editing a long resolved footnote; trace textarea
   sizing, blur/change handling, and dialog rendering before changing behavior.
3. Fix the demonstrated cause and add a browser regression for the first click,
   immediate loading feedback, and preserved dialog scroll. Run relevant checks.

## Progress

- Added `align-content: start` to the version columns. Browser checks passed with
  either version longer; reverting the rule reproduced the vertical offset.
- Reproduced the first-click failure in a browser with a long edited footnote.
  The change event temporarily shrank the live textarea while measuring it,
  clamping the dialog scroll and moving the button before mouseup. Measure an
  offscreen clone instead. Preserve the mounted dialog's scroll through the
  shared modal render controller, after conflict textarea sizing finishes.
- Added a regression with one physical click, a held backend save, and an error
  response. It verifies the submitted draft, immediate spinner, and stable scroll
  through both loading and failure.
- Validation: 3,477 frontend tests, 26 workflow tests, and four related browser
  tests pass. Workflow tests require local server access outside the sandbox.
  ESLint and `git diff --check` pass. The unused audit reports existing files and
  exports, primarily research scripts; this fix introduces no module graph changes.

## Diff review design proposal

The user requested research, a design, and a mockup on 2026-11-06. The redesign is
a proposal; only the alignment and save interaction fixes above are implemented.

### References

- [VS Code merge editor](https://code.visualstudio.com/docs/sourcecontrol/merge-conflicts):
  per-conflict choices, inputs above an editable result, unresolved counts, and an
  optional shared base. Its documentation explicitly warns that accepting both
  versions can introduce duplicates.
- [JetBrains conflict resolver](https://www.jetbrains.com/help/idea/resolve-conflicts.html):
  local/result/remote panes, applying non-conflicting changes, direct result
  editing, and navigation through remaining conflicts.
- [GitKraken merge tool](https://help.gitkraken.com/gitkraken-desktop/branching-and-merging/):
  select individual changes from either side and inspect the output below.

### Recommended: focused comparison

- Two read-only version panes above one full-width editable result. Preserve the
  Gnosis typography and warm palette. Collapse unchanged translation text and
  unchanged notes; open directly at the changed footnote rather than the top of
  a long identical translation.
- Use a real three-way comparison: shared base to local and shared base to remote.
  Highlight changed words, link labels/destinations, and markup tokens. Keep
  paragraph changes visible as labeled `¶` markers; whitespace cannot be ignored
  because it controls publication layout. Treat footnote labels and inline markup
  as structured boundaries, not strings that can be split at arbitrary positions.
- Name the inputs Local version and GitHub version, with verified authors and
  timestamps. Identify a migration as automatic formatting only when supported
  by operation metadata or a verified deterministic transformation. Fall back to
  neutral labels when provenance is unavailable.
- Choose per changed passage, not per entire row: Use local changes, Use GitHub
  changes, or Combine changes. Only offer combining when the patches are
  demonstrably compatible; otherwise require a side choice or manual editing.
  Combining applies edits to the common base and never concatenates two notes.
- Keep Result visible and editable, with rendered links by default and an optional
  markup view. A suggested combination is not a finalized decision. Save remains
  gated until each conflicting passage is explicitly resolved or manually edited.
- Preserve focus, draft text, and scroll through save/error transitions. Report
  local save completion separately from background GitHub sync. Keep remaining
  row navigation and a stable action footer available in the production dialog.

### Alternative: three-pane workspace

Local on the left, editable result in the middle, GitHub on the right. This keeps
all three versions in view for short notes, but long Vietnamese paragraphs become
too narrow. Offer it as an optional layout rather than the default.

### Mockup and implementation boundaries

The interactive mockup uses the two actual Kundalini conflicts: row 76 / footnote
[2] and row 80 / footnote [4]. It demonstrates version choices, combining changes,
original and markup inspection, manual edits, remaining rows, and simulated save
feedback. It does not save or resolve the user's live chapter.

The imported-conflict journal already retains the original base row. The modal
model currently copies only local and remote content, so a production redesign
must carry the true shared base and trustworthy operation provenance through to
the comparison model. Do not substitute the latest remote save baseline for the
merge ancestor. Missing-base cases need a clearly labeled two-way fallback.

Implementing the diff engine and redesigned dialog is a separate follow-up after
the design has been reviewed.

## Focused comparison implementation (authorized 2026-11-06)

1. Carry the actual shared base into the review model; build bounded, markup-safe
   token diffs and conservative three-way combinations, including the verified
   footnote paragraph migration. Split footnotes by marker for independent choices.
2. Wire passage choices, manual editing, markup display, and conflict-row navigation
   into the existing modal flow and permission-checked save path. Keep unresolved
   decisions gated and retain unrelated fields and languages when saving.
3. Replace the dialog with focused version panes and editable results, collapsed
   unchanged context, provenance when verified, paragraph markers, and a stable
   footer. Preserve the earlier first-click and modal scroll fixes.
4. Add model and browser regressions for combining the real Kundalini pattern,
   overlapping edits, missing-base fallback, markup safety, independent notes,
   first-click saving, and remaining-conflict navigation. Run required checks.

Concurrent history-grouping edits are outside this task and must be preserved.

### Implementation completed

- Added bounded token comparisons using the existing vendored diff engine. Inline
  elements are atomic during three-way combination; overlapping edits remain
  manual choices. Exact footnote paragraph rewrites can be combined with text or
  link edits, with an explicit user acceptance step.
- Retained shared-base availability and images from imported conflict payloads.
  The dialog labels both three-way comparisons explicitly and has a clearly
  labeled two-way fallback when the merge ancestor is missing.
- Added independent footnote choices, rendered and markup views, optional shared
  originals, manual result editing, undo, and navigation with unsaved draft
  preservation. A draft is reused only while local, remote, and base inputs match.
- Replaced the old full-row comparison with focused panes, collapsed unchanged
  content, paragraph markers, and a sticky action footer. Save remains gated until
  every changed passage has a decision. Existing permissions, save serialization,
  and GitHub sync behavior remain on the established command path.
- Validation: full `npm test` passes (3,499 frontend tests and 26 workflow tests).
  Six related browser checks pass, covering successful combined saves, independent
  note choices, missing-base fallback, safe rendering, navigation, keyboard focus,
  first-click spinner feedback, and stable scroll. The final Undo control and
  responsive checks at 760px and 320px also pass. ESLint and `git diff --check`
  pass. Unused audit remains at the existing 345 files / 32 exports.
- Browser rendering was visually inspected using mocked content. No live chapter
  content or conflict journal was modified by this implementation.
