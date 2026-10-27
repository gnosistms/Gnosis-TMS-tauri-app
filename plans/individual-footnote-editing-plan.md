# Individual footnote editing surfaces

## Goal and decision

Show each footnote as an independent click-to-edit entry, with one note open at a
time. Keep the existing per-marker editing and saving behavior. The enclosing
footnote collection must not look like another editable field.

## Cause

The collection and the active note's text column both use `field-stack`. The
shared `:focus-within` rule draws a focus border, background, and ring on both,
creating the nested editing surfaces shown in the screenshot.

## Implementation and verification

1. Exclude the footnote collection from shared field focus decoration. Preserve
   the active note's existing field-stack decoration and layout, and retain a
   visible keyboard focus outline on each closed note's edit button.
2. Exercise two notes through the real browser editor: only the clicked note
   opens, focus decorates only that note, and switching notes preserves edits.
3. Inspect the browser screenshot, run relevant footnote/search/layout tests,
   then the frontend suite, build, and unused-code audit.

Earlier read-only fixes in this workspace are a separate task and remain intact.

## Result

The shared focus rule now excludes the collection wrapper. The active note keeps
its existing single editing outline; closed notes have an individual keyboard
focus outline. No renderer, editor-state, save, or storage changes were needed.

Verified visually in `/tmp/gnosis-individual-footnote-editing.png`. The new browser
regression checks Tab focus, one open note at a time, no collection outline or
background, and retaining edits when opening another note. It passed along with
10 related browser regressions for footnote saves/history, empty notes, fixed
typography, spacing at two font sizes, search highlights, and scroll preservation.
Used installed Chrome because the pinned Playwright browser was unavailable.

The 3,019 frontend tests and 25 workflow tests pass. Final focused footnote/render
checks (33) and production web build pass. The unused-code audit has no changes
against the existing HEAD baseline. `git diff --check` passes.

The installed desktop app will pick up this change in a rebuilt version.
