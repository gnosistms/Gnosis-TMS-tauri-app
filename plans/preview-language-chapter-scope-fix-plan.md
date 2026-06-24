# Preview Language Chapter Scope Fix Plan

## Goal

Prevent preview mode from carrying a preview language from one chapter into a
different chapter when both chapters share that language code.

## Issue

The chapter loader temporarily writes the new `chapterId` into
`state.editorChapter` before applying the loaded payload. That made
`applyEditorUiState` treat a different chapter as a same-chapter refresh and
preserve the previous chapter's `previewLanguageCode`.

## Fix

1. Capture the real pre-load editor chapter state before the loading placeholder
   is written.
2. Pass that state into final payload normalization so same-chapter detection is
   based on the actual previous chapter.
3. Preserve explicit initial filters, such as imported-conflict filters, in the
   final normalized chapter state.
4. Add a regression test for the Spanish/English/Vietnamese -> English-only ->
   Spanish/English/Vietnamese sequence.
