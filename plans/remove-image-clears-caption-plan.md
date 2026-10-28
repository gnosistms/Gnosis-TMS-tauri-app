# Removing an image removes its caption

Reported 2026-10-28 in HNHH chapter 2: searching for "nước" listed a Revelation 3:12 quote whose visible text has no "nước". The row's Vietnamese field kept the caption of a Kanō Genshun painting whose image had been moved to a new row on 2026-08-03. The editor shows a caption only next to its image, but chapter search and project search still read it.

1. When an image is removed, clear that language's caption in the same commit. Replacing or duplicating an image keeps captions, as before. History restore already brings image and caption back together.
2. Chapter search matches a caption only when the language has an image.
3. Project search indexes a caption only when the language has an image. Raise the index content version so existing indexes drop the hidden captions.
4. Test the removal helper, both searches, and run the Rust and frontend suites.

Existing caption-without-image rows were handled separately as a data cleanup (six Gnosis VN rows cleared and pushed on 2026-10-28). Translated captions of images that exist only in another language were left as they are.

## Completed

- `remove_gtms_editor_language_image_sync` now clears the caption with the image (`apply_editor_field_image_removal`).
- `buildRowSearchMatches` skips captions of sections without an image; `row_search_documents_from_value` does the same, and `PROJECT_SEARCH_CONTENT_VERSION` is 3.

## Verification

- Rust: 990 passed, 15 ignored, including the new removal test and the updated index test.
- Frontend: 3,226 passed; workflow tests: 25 passed.
