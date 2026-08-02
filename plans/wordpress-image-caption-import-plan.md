# WordPress Image Caption Import

## Goal

When an editor image is inserted from a WordPress media URL, copy the media
library caption into the matching Gnosis TMS image caption automatically.

## Behavior

- Recognize standard self-hosted WordPress `/wp-content/uploads/` image URLs and
  WordPress.com `*.files.wordpress.com` media URLs, including Jetpack's `i0`–`i2`
  image CDN wrappers.
- Query the site's public WordPress REST media endpoint by decoded filename search,
  then identify the attachment by matching the inserted URL against `source_url`
  and every generated media-size URL. Do not assume the editable attachment slug
  equals the filename.
- Treat discovery as best-effort: an unavailable or disabled API must not block
  the image insertion.
- Convert WordPress's rendered caption HTML to safe plain text.
- Replace the caption associated with a previous image when a caption is found for
  the newly inserted image, but do not overwrite a caption edited after insertion.
- Save the image URL immediately, then discover and apply the caption in a background
  job guarded by the saved image URL and caption baseline.

## Implementation

1. Reuse the editor export HTTP client's public-host validation, DNS pinning,
   redirect refusal, and bounded response handling inside a detached enrichment
   worker, never in the image-save IPC path.
2. Add pure helpers for deriving the media search endpoint, decoding filenames,
   normalizing original/generated URLs, and selecting a caption from the REST
   response, with focused Rust tests.
3. Emit the enriched row after a guarded background commit and merge that row into
   the open editor without discarding newer local edits.
4. Run focused Rust/frontend tests and the full Rust library suite.
