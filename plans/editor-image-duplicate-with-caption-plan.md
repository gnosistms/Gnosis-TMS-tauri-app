# Editor Image Duplicate With Caption Plan

## Goal

Expand the editor image context menu so every destination language keeps the
existing image-only duplicate action and, when available, also offers an action
that duplicates the image and AI-translates its source caption into the
destination language.

## Behavior

- Rename no existing behavior: the image-only action remains `Duplicate to
  [language]`.
- Add `Duplicate to [language] with caption` immediately after each image-only
  destination action.
- Show the caption action only when:
  - the source language has a non-empty image caption;
  - the selected team translation model has a configured AI provider.
- Preserve the existing occupied-destination confirmation. The confirmation
  remembers whether caption translation was requested.
- Complete the image write before starting caption translation.
- Show a blocking spinner modal while the caption translation is in progress.
- Provide a Cancel button that dismisses the progress modal and prevents an
  eventual AI response from being applied. The completed image duplication is
  retained.
- Translate and persist only the destination image caption; do not replace the
  destination row text or footnotes.

## Implementation

1. Add a pure availability check and conditional menu rendering to
   `editor-image-context-menu.js`.
2. Return an explicit duplicate result from `editor-image-flow.js` and store the
   caption intent in the overwrite modal state.
3. Add progress-modal state and rendering using the editor's existing modal
   conventions.
4. Orchestrate image duplication followed by the existing single-row AI
   translation pipeline in `translate-flow.js`, with cancellation invalidating
   the in-flight translation before it can apply.
5. Wire the new duplicate and cancel actions through
   `actions/translate-actions.js`, including normal editor write-permission
   gating.
6. Extend focused unit tests for menu visibility, ordering, overwrite intent,
   modal rendering/cancellation, and caption-only AI application.

## Verification

- Run the focused image context-menu, image-flow, action, and AI translation
  unit tests.
- Run the full frontend unit test suite if focused verification passes.
