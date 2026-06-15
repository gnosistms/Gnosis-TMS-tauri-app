# Preview Double Click Edit Jump Plan

## Goal

Preview mode stays read-only, but preview text becomes a navigation surface:

- single-clicking editable preview text shows the lower-right notice badge:
  `Double click to edit this text`
- double-clicking a preview paragraph switches to Translate mode and scrolls directly
  to the matching editor row/language
- the jump replaces the saved Translate-mode editor location for the current chapter,
  so later editor opens restore to the double-clicked paragraph instead of the older
  saved scroll position

## Current Integration Points

- `src-ui/app/editor-preview.js`
  - `buildEditorPreviewDocument` keeps `rowId` and `languageCode` on preview blocks.
  - `renderEditorPreviewDocumentHtml` renders text blocks with
    `data-preview-block`, `data-row-id`, and `lang`.
- `src-ui/app/editor-preview-flow.js`
  - owns mode switching and the current in-memory
    `previewModeTranslateScrollSnapshot`.
  - currently restores the old Translate scroll snapshot when switching from Preview
    back to Translate via the toolbar.
- `src-ui/app/scroll-state.js`
  - `queueTranslateRowAnchor` and `restoreTranslateRowAnchor` already support
    row, language panel, language toggle, and field anchors.
- `src-ui/app/editor-location.js`
  - persists/restores the Translate-mode location per chapter.
  - intentionally ignores preview mode during normal restore, so the new jump needs
    an explicit "replace current editor location" path.
- `src-ui/app/translate-editor-dom-events.js`
  - is the right place for preview click/double-click DOM event wiring because it
    already owns editor-specific DOM interactions and preview search key handling.
- `src-ui/lib/ui.js` and `src-ui/app/status-feedback.js`
  - already render notice badges fixed in the lower-right via `.team-ui-debug`, so
    no new badge surface is needed.

## Implementation Steps

1. Add a small preview-block resolver.

   In `translate-editor-dom-events.js`, add a helper that resolves clicks to the
   nearest editable preview text block:

   - target selector: `[data-editor-preview-document] [data-preview-block][data-row-id]`
   - initial scope: text blocks rendered as `p`, `h1`, `h2`, and `blockquote`
   - ignore clicks inside external links so existing link-opening behavior remains
     unchanged

   The helper should return the block element plus:

   - `rowId` from `data-row-id`
   - `languageCode` from `lang` or the current selected preview language
   - `offsetTop` from `block.getBoundingClientRect().top - previewScroll.getBoundingClientRect().top`

2. Wire the single-click hint.

   In the existing `click` listener in `translate-editor-dom-events.js`, after the
   external-link branch:

   - if the click resolves to a preview text block and `event.detail === 1`, call
     `showNoticeBadge("Double click to edit this text", render, 2200)`
   - do not re-render the editor body; only request the existing `status-surface`
     render through `showNoticeBadge`

3. Add the double-click action.

   Add a `dblclick` listener in `translate-editor-dom-events.js`:

   - resolve the preview text block
   - `preventDefault()` and `stopPropagation()`
   - delegate to a new `jumpFromPreviewBlockToTranslateMode(render, blockElement)`
     wrapper in `translate-flow.js`

4. Build a Translate anchor from the preview block.

   In `editor-preview-flow.js`, add an exported function that:

   - validates current mode is Preview and the block has a `rowId`
   - creates a translate anchor:
     - prefer `{ type: "language-panel", rowId, languageCode, offsetTop }`
     - fall back to `{ type: "row", rowId, offsetTop }` when no usable language
       code exists
   - uses the preview block's current viewport offset so the selected paragraph lands
     near the same vertical position after switching to Translate mode

5. Replace the saved Translate location immediately.

   Add an explicit export in `editor-location.js`, for example:

   ```js
   export function replaceCurrentEditorLocation(appState, snapshot) { ... }
   ```

   It should:

   - accept a row anchor while the current chapter is loaded, including when the mode
     is Preview
   - call `saveStoredEditorLocation(chapterId, snapshot)` without preserving any old
     `scrollTop`
   - set the module's restored chapter state so the next render does not overwrite
     the replacement with an older pending restore
   - clear any pending restore snapshot for that chapter

   This is the key requirement: the double-click jump does not just scroll once; it
   replaces the chapter's saved Translate-mode location with the clicked paragraph
   anchor.

6. Teach mode switching about anchor overrides.

   Extend `setEditorMode(render, nextMode, options = {})` in `editor-preview-flow.js`
   with an optional `translateAnchor` override.

   For Preview to Translate with an override:

   - clear or ignore `previewModeTranslateScrollSnapshot`
   - call `queueTranslateRowAnchor(translateAnchor)` before rendering
   - call `replaceCurrentEditorLocation(state, translateAnchor)`
   - switch `state.editorChapter.mode` to Translate as usual
   - render normally, without locking the old raw Translate scroll snapshot

   Keep the current toolbar behavior unchanged when no anchor override is provided.

7. Handle filtered Translate views.

   Preview is built from all previewable rows, while Translate mode may have active
   filters. If the target row would be hidden after switching:

   - reuse the existing show-in-context behavior from `editor-show-context.js` /
     `showEditorRowInContext`
   - clear filter restore state for this jump, as the current `showEditorRowInContext`
     path does
   - queue the preview-derived anchor after clearing filters so virtualization can
     pin and render the clicked row

   This prevents a double-click from switching modes but landing on an empty or
   filtered-out Translate view.

8. Let virtualization do the row mounting.

   Do not manually query rows after rendering. Queuing the anchor before render lets
   `editor-virtual-list.js` see `pendingTranslateAnchorRowId()` and pin the target
   row into the virtual range before `restoreTranslateRowAnchor` runs.

## Tests

Add focused tests before browser coverage:

- `src-ui/app/editor-preview.test.js`
  - preview text blocks keep `data-row-id` and `lang` in rendered HTML.
- `src-ui/app/editor-preview-flow.test.js`
  - a preview block jump switches mode to Translate.
  - the queued anchor uses the clicked preview block row/language and offset.
  - the normal toolbar Preview to Translate path still uses the old saved snapshot.
- `src-ui/app/editor-location.test.js`
  - replacing current editor location works while the loaded chapter is in Preview
    mode.
  - replacement saves an anchor without stale `scrollTop`.
- `src-ui/app/events-source.test.js`
  - `translate-editor-dom-events.js` wires both `click` and `dblclick` preview block
    handling and calls `showNoticeBadge` for the hint.

Add one browser regression if the existing editor fixture supports it:

- open an editor fixture
- switch to Preview
- single-click a preview paragraph and assert the lower-right badge text appears
- double-click a later preview paragraph
- assert mode is Translate and the matching `[data-editor-row-card][data-row-id=...]`
  is visible in `.translate-main-scroll`

## Verification

Run:

```sh
node --test src-ui/app/editor-preview.test.js src-ui/app/editor-preview-flow.test.js src-ui/app/editor-location.test.js src-ui/app/events-source.test.js
npm test
```

If browser coverage is added, also run the focused Playwright editor regression test.

## Non-Goals

- Do not make Preview editable.
- Do not add a new floating badge component.
- Do not change normal toolbar mode switching behavior.
- Do not rewrite the preview renderer beyond the row/language metadata needed for
  reliable navigation.
