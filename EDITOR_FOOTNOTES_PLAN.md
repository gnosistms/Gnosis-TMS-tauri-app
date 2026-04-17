# Editor Footnotes

## Summary

Add one plain-text footnote per language, stored separately from the main translation text. A saved non-empty footnote is always shown beneath that language's main field. An empty footnote renders nothing at all: no box, no placeholder, and no reserved space, so the UI remains exactly as it is today until a footnote exists or the active empty language shows the add-footnote control.

The add-footnote control lives in the same action row as `P / H1 / H2 / Q / I`, with a small separator between the style buttons and the footnote button to show a separate function group.

## Key Changes

### 1. Storage and row-save API

- Extend stored row data to add `fields.<language>.footnote`, defaulting to `""` when missing.
- Extend `EditorRow` to return a separate `footnotes` map.
- Extend the generic row-save input to include `footnotes` and `baseFootnotes` alongside `fields` and `baseFields`.
- Extend history entries and restore responses to include the footnote for the active language.
- Keep footnotes on the existing `update_gtms_editor_row_fields` path; do not create a separate command or commit type.
- Treat footnotes as part of row persistence for dirty tracking, save reconciliation, conflicts, stale reload, and revision-token generation.

### 2. Editor UI and interaction

- Add a footnote area under each language editor:
  - non-empty footnote: always render a footnote textarea below the main field
  - empty footnote + active language: render no footnote box, but show the `*` add-footnote button in the action row
  - empty footnote + inactive language: render nothing
- Keep the existing style action row under the active editor cluster and extend it to:
  - show the `P / H1 / H2 / Q / I` group first
  - then a small visual separator
  - then the `*` add-footnote button, styled like the review / please-check buttons, with tooltip `Add footnote`
- Clicking `*` replaces that control with a footnote textarea beneath the main field and focuses it.
- Once a footnote exists, the `*` button no longer shows for that language; the visible footnote textarea is the editing surface.
- The footnote textarea uses the editor font family, italic styling, and placeholder `Enter footnote text here.`
- Focusing a footnote textarea activates that row/language just like focusing the main textarea.
- Main textarea + footnote textarea for the same row/language form one focus cluster: moving between them must not trigger an intermediate save.
- Blurring outside that cluster saves through the normal row-save pipeline. Blurring with empty content persists `""`.
- Add footnote textareas to autosize, scroll-anchor, focus-restore, and virtualization row-height syncing so layout remains stable.

### 3. Search, history, and restore

- Editor search:
  - search all visible rendered text, including visible footnotes
  - do not search hidden text, including languages that are collapsed and footnotes that are empty/not rendered
  - highlight matches in both main text and footnotes
  - add `contentKind` to local search match keys so main-text and footnote matches do not collide
- Project-wide search:
  - index saved non-empty footnotes in addition to main text
  - return footnote hits with `snippetSource: "footnote"` and label them `Footnote:` in results
- History and Review > Last update:
  - include footnotes in entry equality/current-entry matching so footnote-only commits remain visible
  - keep the main diff for translation text
  - add a separate `Footnote` diff note when the footnote changed
- Restore:
  - restoring a history entry restores that language's main text, footnote, markers, and row text style together

## Test Plan

- Rust:
  - missing `footnote` defaults to empty
  - inserted rows initialize empty footnotes
  - row saves persist footnotes and conflict on base-footnote mismatch
  - history builder keeps footnote-only commits
  - restore returns and reapplies footnotes
  - project search indexing/snippets include non-empty footnotes
- JS/unit:
  - row normalization, dirty tracking, and save reconciliation include footnotes
  - main-field/footnote focus transitions do not force early save
  - history matching and footnote diff-note rendering work
  - editor search includes visible footnotes and excludes hidden/empty ones
- Browser:
  - active empty language shows style buttons, separator, and `*` in one action row
  - inactive empty language shows no footnote UI and takes no extra space
  - non-empty footnotes are visible beneath all languages
  - clicking `*` opens and focuses the italic footnote textarea
  - clearing a footnote removes it from inactive UI
  - editor search finds/highlights visible footnotes only
  - footnote-only edits appear in History and Last update and can be restored
  - project search returns footnote hits with footnote labeling

## Assumptions

- One plain-text footnote per language; no rich text and no multiple footnotes per language in v1.
- Source word counts, glossary matching, and AI translation/review prompts continue to use only the main translation text.
- The separator is a dedicated visual divider in the shared action row, not a separate line or block below the style buttons.
