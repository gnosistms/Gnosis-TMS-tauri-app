# Glossary entry from highlighted editor text

Requested by Hans, 2026-10-25. Replaces the editor's "Research glossary terms"
preparation window (language picker + typed word).

## Behaviour

- The book-with-A button on each language panel is greyed out (but still shows
  its tooltip) until text is highlighted in that row and language.
- Tooltip in the glossary's source and target languages: "Highlight any word or
  group of words, then click here to make a glossary entry for it."
  In any other language: "Identify the source language term that corresponds to
  this word and research its meaning."
- Clicked in the target language: a window opens with the highlighted text as
  the translation, shows a spinner while the AI finds the matching source text,
  then shows both boxes.
- Clicked in the source language: the highlighted text goes in the source box,
  the translation box is left empty.
- Clicked in another language: spinner while the AI finds the source term; if
  none, say so with only Cancel; if found, continue as from the source language.
- Window buttons: Cancel (back to the editor), Save to glossary (opens the
  glossary and its usual New Term window, prefilled), Research meanings (opens
  the Research Studio with a new study for the source term).

## Choices not covered by the request

- Target language, no match found (or no Research model chosen): the window
  still opens with the translation filled and an empty source box plus a short
  note, so the translator can type the source text.
- The AI must copy the source text exactly; the app accepts its answer only if
  that text really occurs in the row's source text (after stripping markup and
  ignoring case/spacing), and uses the row's own spelling.
- Save to glossary behaves like "+ New Term" afterwards: the person stays on
  the glossary page (its Back button returns to the editor), as with the
  existing double-click "edit term" route.
- Research meanings pre-selects the chapter's project as the corpus when the
  study uses project texts (non-Spanish glossaries).

## Files

- `src-ui/app/editor-glossary-entry-selection.js` (new): read the highlighted
  editor text, keep the buttons' enabled state in step, language roles, tooltips.
- `src-ui/app/editor-glossary-entry-flow.js` (replaces
  `glossary-research-prep-flow.js`), `src-ui/screens/editor-glossary-entry-modal.js`
  (replaces `glossary-research-prep-modal.js`).
- Prompt + schema in `glossary-research-prompts.js`; state in
  `glossary-research-state.js` / `state.js`.
- Button render (`editor-row-render.js`), role per section
  (`editor-screen-model.js`), events (`events.js`), actions, input, focus
  restore, research modal host.
- `glossary-term-draft.js`: `openGlossaryTermEditor` takes an optional prefill.
- `glossary-research-studio-flow.js`: `openStudioForTerm`.

## Verification

- Unit tests for selection reading, roles, the flow (mocked AI) and the modal.
- Browser fixture (no Tauri): highlight → button enables, tooltip, each
  language's path through the window with a stubbed AI response.

## Status

Implemented, not yet committed or tried in the native app with a live AI model.

- Unit: `editor-glossary-entry-selection.test.js` (7), `editor-glossary-entry-flow.test.js`
  (8, incl. the window's HTML); full `npm test` 3,034 pass.
- Browser (`tests/browser/editor-glossary-entry.spec.js`, 5 tests, stubbed native side):
  greyed-out button and both tooltips; source path + Cancel; target path with the
  spinner, AI match, row spelling, then Save to glossary → prefilled New Term on the
  glossary page; other-language path → Research meanings → Studio step 1 with the
  term; other-language no-match → only Cancel.
- Also: a failed AI request says the search went wrong (not "not found"); closing
  the window while searching cancels the AI request; a prefilled source term that
  already exists is marked at once in New Term.

## Source lookup model and connectivity (2026-11-22)

1. Read the team's effective AI selection for Research. Use the shared model in
   simplified settings and the Research selection in detailed settings.
2. Run this single source lookup with the selected provider, independently of
   the full research pipeline's price table. Keep source-text verification and
   dismissal of in-flight lookups.
3. Give offline and interrupted requests actionable connection guidance.
   Preserve the highlighted translation for manual entry and show specific
   provider errors when a request reaches the provider.
4. Verify model selection, connection loss and manual entry in the editor flow,
   along with native provider routing and the existing glossary entry tests.

The editor now sends one source lookup using the effective AI selection. The
native command accepts OpenAI, Claude, Gemini and DeepSeek and validates the
answer before the editor checks it against the row. Offline mode, loss of the
provider connection and a genuine empty model selection have separate messages.

Verification covered the saved unified model, the detailed Research override,
an interrupted lookup, provider rejection, manual entry and dismissal. The
browser tests used simulated provider replies. Native tests covered all four
provider routes and invalid answers.
