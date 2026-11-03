# WordPress caption search spinner

## Goal

When an image URL from a WordPress media library is inserted, the backend looks
up the image's caption ("image footnote") in the background. Today the editor
shows nothing while that lookup runs. Show a spinner with the text
"Searching WordPress for an image footnote." in the caption slot next to the
image until the lookup finishes.

## Backend (`src-tauri/src/project_import/chapter_editor/images.rs`)

- `start_wordpress_caption_enrichment` emits
  `editor-image-caption-search-started` (`chapterId`, `rowId`, `languageCode`,
  `imageUrl`) right before it spawns the lookup.
- The spawned lookup always emits `editor-image-caption-search-finished` with
  the same payload when it ends, found or not, after any
  `editor-image-caption-enriched` event.

## Frontend

- `state.editorChapter.wordpressCaptionSearches`: `{ "<rowId>:<languageCode>": imageUrl }`,
  reset with the chapter state.
- `editor-image-flow.js` listens to both events: started adds the entry for the
  current chapter; finished removes it only when the image URL still matches, so
  an older lookup cannot clear a newer one's spinner. Both re-render the row.
- `editor-screen-model.js` derives `isSearchingWordPressCaption` when the entry
  matches the row's saved URL image.
- `editor-row-render.js` renders the spinner status in the caption shell in place
  of the "+ caption" button (or under an existing caption). An open caption
  editor still wins.

## Tests

- `editor-image-flow.test.js`: started/finished handling, stale finish ignored.
- `editor-screen-model.test.js` / `editor-row-render.test.js`: flag and markup.
