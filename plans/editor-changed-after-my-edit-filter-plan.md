# Editor filter: "Changed after my last edit"

Branch: `claude/changed-after-my-edit-filter` (from `origin/main` 16fe92e9).

## What the filter shows

A new option in the editor's Filters dropdown, **Changed after my last edit**. It shows the
rows whose content someone else changed after the signed-in user's last edit of that row.

Rules (Hans, 2026-09-27):

1. Who made an edit = the git commit author. Every app commit is authored by the signed-in
   user who started it (`git_commit.rs::signed_in_git_author`), including AI edits, so:
   - my own AI edits are my edits;
   - AI edits another person started are that person's edits.
2. If I never edited a row, any edit by someone else qualifies it.
3. The original import counts as an edit (by whoever imported).
4. Marking reviewed / please check, and comments, are **not** edits — neither mine nor
   anyone else's.
5. A change to **any** language in the row counts, not only the target.
6. Changing the row's text style counts as an edit.
7. Once shown, a row stays on screen until the filter is changed, even after I edit it.

"After my last edit" is taken in git terms: another person's edit counts when it is not
already contained in my last edit of that row (`<my last edit>..HEAD`). That handles
commits that arrive later by sync but were made earlier by the clock.

## What an edit is (per commit, per row file)

A commit is an edit of a row when the row's **content signature** differs from the
row's previous version: for every language, the plain text, footnote, image caption and
image; plus the row text style. Editor flags (reviewed, please check) and comment data
are left out of the signature, so marker-only and comment-only commits are not edits.
The first commit that creates the row file (import, insert, split, copy) is an edit.

Content comparison rather than the `GTMS-Operation` trailer, so commits made outside
the app (or older app versions without trailers) are judged the same way.

## Backend (Rust)

New command `load_gtms_editor_changed_after_my_edit` (`chapter_editor/changed_after_my_edit.rs`), called lazily when the filter is
selected (not on every chapter load):

- input: installation/project/repo/chapter ids (same shape as chapter load);
- one `git log --raw --no-abbrev` pass over the chapter's `rows/` directory gives, per
  row file, its commits newest-first with author and old/new blob ids;
- per row, walk newest → oldest: skip commits whose blob content signature equals the
  previous version's (blobs read in one `cat-file --batch`); stop at my newest edit;
- a row qualifies when at least one edit by someone else is found before stopping;
- for each qualifying row, return the **baseline** row content: the row at my last
  edit, or — if I never edited it — the oldest version (the import/creation), so the
  diff shows everything that changed since the row appeared.

Response per qualifying row: `rowId`, `baselineCommitSha`, baseline fields per language
(`plainText`, `footnote`, `imageCaption`, `image`), baseline `textStyle`, and the list
of other editors (login + time) for the tooltip.

"Me" = the signed-in GitHub login, matched against the commit author email
`<login>@users.noreply.github.com` (same rule as `author_login_from_email`).

## Frontend

### Filter

- `editor-filters.js`: new mode `changed-after-my-edit`, label "Changed after my last edit".
- `rowMatchesFilterMode` reads a row-id set from editor state (`changedAfterMyEdit`), the same
  way the unread-comments filter reads `commentSeenRevisions`.
- State `editorChapter.changedAfterMyEdit = { status, rowIds, baselinesByRowId }`, loaded
  when the mode is selected, dropped when the filter changes or the chapter changes.
- Sticky rows (rule 7): the row-id set is a snapshot taken when the filter is turned on;
  my later edits don't remove rows. After a background sync pulls new commits, the set
  is re-fetched and **merged** (new rows added, none removed) while the filter stays on.

### Diff display — keeps formatting

Only the static (not-being-edited) field display changes. Clicking a field opens the
normal editor with the plain current text; the editor code does not see diff markup.

- New pure function in `editor-inline-markup/diff.js`:
  `buildInlineMarkupDiff(previousMarkup, currentMarkup)` →
  `{ markup, ranges }` where `markup` is valid inline markup whose visible text is the
  merged text (kept + inserted + deleted runs) and `ranges` mark each run as
  `insert` / `delete` / `format` over visible offsets.
  - both sides parsed to per-character style runs (bold, italic, underline, link href;
    a ruby element is one unit);
  - visible text diffed with the existing diff-match-patch setup (code-point safe, same
    cleanup as the History pane);
  - kept and inserted runs take their **current** formatting, deleted runs their **old**
    formatting;
  - kept runs whose formatting changed are marked `format` (see open question A).
- Render with the existing `renderSanitizedInlineMarkupWithRanges` + a mark renderer that
  wraps runs in `history-diff__insert` / `history-diff__delete` classes (same green/red
  as the History pane). Bold/italic/underline/ruby/links display as usual inside them.
- `editor-row-render.js::renderEditorLanguageField`: when the filter is on and the row
  has a baseline, the static text HTML comes from the diff instead of
  `renderStaticEditorFieldTextHtml`. Same for footnote and image caption displays.
  Glossary and search highlights are not drawn in diff mode (their offsets don't fit the
  merged text).
- Rows in conflict keep the conflict display; no diff there.

### Text style change

When the baseline text style differs from the current one, the style button that is now
on gets a green icon and the one that was on before gets a red icon (same colour
variables as `history-diff__insert` / `history-diff__delete`). Needs the style buttons
to be visible on those rows even when not active (check during implementation).

## Parity

Glossary and QA list editors have no row filter dropdown, so no parity work.

## Tests

- Rust: signature comparison (marker-only commit not an edit, style-only commit is an
  edit, creation commit is an edit); walk stops at my last edit; never-edited row with
  another importer qualifies; row I imported and nobody touched does not; my AI edit
  does not qualify; another person's AI edit does.
- JS: `buildInlineMarkupDiff` — plain insert/delete, deletion inside bold, insertion
  inside italic, formatting-only change, ruby unit, astral characters, round-trip
  sanitization (deleted text containing `<script>` stays escaped).
- JS: filter mode, sticky row set, merge after sync.

## Rulings on display (Hans, 2026-09-27)

A. Formatting-only changes (bold/italic/underline/ruby/link changed, text unchanged) are
   edits. Marked with a light green **background** (not an underline: insertions are
   already green-underlined and underline is itself one of the formats), with a tooltip
   naming the old formatting ("was: bold"). No clash with glossary marks — they are not
   drawn in diff mode.
B. Image changes are edits. New image: green outline. Old image: shown as well, with a
   red X over it (diff red). Removed image: old image with red X only. Added: green
   outline only.
C. Footnote and image caption changes are edits. Added footnote/caption: whole text
   green (diffed against ""). Deleted footnote/caption: its box still shown, whole text
   red strike-through (diffed against "").

## Status (2026-09-27)

Implemented on the branch; not yet run in the Tauri app against a real project.

- Rust: `changed_after_my_edit.rs` + 10 tests on real git repos (authors, AI trailers,
  marker/comment-only commits, style change, import by someone else, rebased-below-mine
  edit newer by the clock, empty language column).
- JS: `editor-inline-markup/diff.js` (word tokens via `Intl.Segmenter`, per-character
  formatting; tests incl. Persian), `editor-change-view.js`, filter flow, screen-model
  and row-render hooks; browser test in `editor-regression.spec.js` (all 178 pass).
- The glossary/search highlight pass skips fields showing a diff
  (`data-editor-change-diff`), as it skips custom-HTML rows.

Known limits:

- Subtitle timing changes count as edits but have no mark of their own.
- A deleted or added separator (`<hr>`) has zero visible width, so it gets no mark.
- Users without edit rights see no text-style buttons, so a style change is not marked
  for them.
- Glossary and search highlights are not drawn on a field while it shows a diff.
