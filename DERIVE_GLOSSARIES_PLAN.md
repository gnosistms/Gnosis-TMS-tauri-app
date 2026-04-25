# Derive Glossaries Plan

## Context

AI Translate All already has toolbar wiring, modal state, per-language progress helpers, and a batch loop. Derived glossaries already exist, but only inside `runEditorAiTranslateForContext` when the active translation source language differs from the linked glossary source language.

The safest implementation is to extract row-level derived-glossary preparation into a shared helper, then call it from both AI Translate and the new Derive glossaries batch command.

## Plan

1. Rename the toolbar text.
   - In `src-ui/screens/translate-toolbar.js`, change `AI Translate all` to `AI translate all`.
   - Keep the existing action id `open-editor-ai-translate-all`.

2. Add the Derive glossaries toolbar button.
   - Add a button immediately before `AI translate all`.
   - Label: `Derive glossaries`.
   - Tooltip: `Use this to automatically generate glossaries for the languages that don't have a glossary.`
   - Show it only when:
     - the chapter has at least 3 languages
     - a linked glossary is loaded
     - the glossary source language exists in the chapter languages
     - the glossary target language exists in the chapter languages
     - there is at least one derivable source language: not glossary source and not glossary target

3. Add a derivable-language resolver.
   - Read chapter languages from `editorChapter.languages`.
   - Read glossary source and target languages from `editorChapter.glossary`.
   - Return all chapter languages except glossary source and glossary target.
   - Do not use collapsed-language filtering unless explicitly requested; the requirement says “languages in the file.”
   - These returned languages define eligible language pairs: each derivable source language to the glossary target language.

4. Add the Derive glossaries confirmation modal.
   - Add new modal state, probably `editorChapter.deriveGlossariesModal`, in `src-ui/app/state.js`.
   - Render:
     - Eyebrow: `DERIVE GLOSSARIES`
     - Title: `Automatically generate glossaries`
     - Message with glossary source/target names
     - List: `[language] to [glossary target language]`
     - Buttons: `Cancel | Continue`
   - If no derivable languages remain, do not open the modal.

5. Reuse AI Translate All progress UI.
   - Extract shared progress rendering from `src-ui/screens/editor-ai-translate-all-modal.js` into a reusable helper, or let the Derive glossaries modal use the same CSS classes:
     - `ai-translate-all-modal__progress-list`
     - `ai-translate-all-modal__progress-row`
     - `ai-translate-all-modal__progress-track`
     - `ai-translate-all-modal__progress-fill`
   - The derive modal progress phase should show one progress bar per derivable source language.

6. Extract shared derived-glossary preparation.
   - Move the derivation-specific code out of `src-ui/app/editor-ai-translate-flow.js` into a focused module, for example `src-ui/app/editor-derived-glossary-flow.js`.
   - Shared helper should handle:
     - building glossary term inputs
     - resolving existing glossary source text vs generated source text
     - calling `prepare_editor_ai_translated_glossary`
     - building the derived glossary state
     - applying it to `derivedGlossariesByRowId`
     - saving it through `saveStoredEditorDerivedGlossaryEntryForChapter`
   - Update `runEditorAiTranslateForContext` to call this helper so future changes affect both paths.

7. Implement the Derive glossaries batch flow.
   - Add a flow file such as `src-ui/app/editor-derive-glossaries-flow.js`.
   - On Continue:
     - build work items across rows and derivable source languages
     - skip deleted rows
     - skip the whole row when the glossary target language text is empty or the editor source language text is empty
     - skip only a specific row-language-pair work item when that derivable source language text is empty
     - if the selected glossary source language text is empty, translate from the editor source language to the glossary source language and save the translation in the row file before computing the derived glossary
     - use the same derived-glossary helper as AI Translate
     - update language progress after each row-language item
     - support Cancel/Stop by using an active run id, matching AI Translate All’s cancellation pattern
   - On completion:
     - close modal
     - show notice badge with count, e.g. `Derived glossaries for 12 rows.`

8. Clarify storage behavior.
   - Store derived glossary entries in the existing per-row derived glossary cache.
   - If the selected glossary source language text is empty, translate from the editor source language to the glossary source language and save the translation in the row file before computing the derived glossary.
   - Otherwise, do not overwrite existing row text.
   - Preserve existing stale/dirty safeguards from the shared helper.

9. Wire actions and input handlers.
   - Add actions:
     - `open-editor-derive-glossaries`
     - `cancel-editor-derive-glossaries`
     - `confirm-editor-derive-glossaries`
   - Add input/update handlers if the modal needs any controls.
   - Include the new modal renderer in the editor page render path next to AI Translate All.

10. Add tests.
    - Toolbar renders `AI translate all`.
    - Derive glossaries button appears only when glossary source and target languages are present and there are at least 3 languages.
    - Confirmation modal lists `[language] to [glossary target language]` pairs correctly.
    - Continue starts progress bars using the same progress classes as AI Translate All.
    - Batch flow skips deleted rows and rows missing glossary target or editor source language text.
    - Batch flow skips only the affected row-language-pair work item when a derivable source language text is empty.
    - Batch flow generates and saves missing selected glossary source text before deriving glossary entries.
    - Batch flow calls the shared derived-glossary helper.
    - AI Translate still derives glossary hints through the shared helper.
    - Cancel/Stop ends the active derive run cleanly.

11. Verify.
    - Run focused tests for:
      - editor AI translate flow
      - AI Translate All modal/flow
      - new Derive glossaries flow/modal
    - Run `npm test`.
    - Because derived glossary rendering affects visible editor rows, manually check one editor page with a linked glossary and 3+ languages for stable scrolling and no blank virtualization gaps.
