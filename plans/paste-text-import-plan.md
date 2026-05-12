# Paste Text Import Path Plan

## Summary

Implement the Add file modal's `Paste text` tab by reusing the existing Add translation paste-text code and UI design wherever the behavior overlaps: textarea state, shared `field__textarea` styling, input handler wiring, validation, button enablement, and the next-step language picker pattern. The pasted text will import through the existing TXT import backend as a synthetic `.txt` file.

## Key Changes

- Add `pastedText: ""` to `projectImport` state and clear it when opening, canceling, or switching away from Paste text, mirroring `projectAddTranslation.pastedText`.
- Replace the Paste text coming-soon panel with a textarea using the same structure, classes, and interaction design as the Add translation paste textarea:
  - `class="field__textarea"`
  - `data-project-import-paste-textarea`
  - placeholder: `Paste text here.`
  - hint text: `Paste plain text here. You will choose its source language before importing.`
- Add `updateProjectImportPastedText(render, value)` and wire it in `input-handlers.js`, reusing `updateProjectAddTranslationPaste` as the direct implementation model.
- Add `submitProjectImportPastedText(render)`:
  - no-op while importing or resolving links
  - if pasted text is blank, show `Paste text before continuing.`
  - otherwise create a synthetic import file `{ name: "Pasted text.txt", dataBase64 }`
  - pass it to existing `importProjectFile`, which already opens source-language selection for TXT
- Update modal primary button behavior:
  - Paste text mode uses `data-action="submit-project-import-pasted-text"`
  - Continue disabled until `pastedText.trim()` is non-empty
  - button label follows existing import states: `Continue` or `Importing...`
- Keep backend unchanged. Existing `import_txt_to_gtms` already handles bytes plus `sourceLanguageCode`.

## Tests

- UI tests:
  - Paste text tab renders the textarea and hint text.
  - Continue is disabled for empty/whitespace text.
  - Continue enables when pasted text exists.
  - Paste text controls disable while importing.
- JS flow tests:
  - input handler updates `state.projectImport.pastedText`.
  - switching away from Paste text clears pasted text.
  - submitting blank text shows validation error.
  - submitting text opens existing source-language picker with pending file name `Pasted text.txt`.
  - continuing source-language selection calls `import_txt_to_gtms` with UTF-8 bytes and the selected language.
- Verification:
  - `node --test --loader ./src-ui/test/raw-loader.mjs src-ui/screens/project-import-modal.test.js src-ui/app/project-import-flow.test.js`
  - `npm test`
  - `npm run build`

## Assumptions

- Paste text imports plain text only, not HTML or Markdown.
- The generated file title should be `Pasted text`.
- Source language selection should happen after pasting, matching the Add translation flow.
