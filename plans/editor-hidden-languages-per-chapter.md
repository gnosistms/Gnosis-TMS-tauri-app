# Remember hidden editor languages per chapter

## Problem

Hiding a language in the editor (the chevron on a language panel) only updates
`state.editorChapter.collapsedLanguageCodes` in memory. On restart the set starts
empty, so every hidden language is shown again. Within a session the set is carried
from one chapter to the next, so hiding English in one chapter hides it everywhere.

## Decision

Hidden languages are remembered per chapter, per signed-in user, the same way the
preview language is (`gnosis-tms-editor-preview-language:<login>`, keyed by chapter id).

## Changes

1. `editor-preferences.js` — add a `gnosis-tms-editor-collapsed-languages:<login>` map
   of chapter id → language codes, with `loadStoredEditorCollapsedLanguageCodes`,
   `saveStoredEditorCollapsedLanguageCodes` (an empty set clears the entry), and
   `clearStoredEditorCollapsedLanguageCodes`.
2. `translate-flow.js` — `toggleEditorLanguageCollapsed` saves the new set for the
   open chapter.
3. `editor-state-flow.js` — `applyEditorUiState` keeps the in-memory set for the same
   chapter (refreshes, syncs) and loads the stored set when a different chapter opens,
   instead of carrying the previous chapter's set over.

## Tests

- `editor-state-flow.test.js` — opening a chapter restores its stored hidden languages
  and does not inherit the previous chapter's; same-chapter refresh keeps the set.
- `editor-preferences` round trip: save, load, clear on empty set.
