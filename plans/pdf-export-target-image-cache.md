# PDF export image caching

## Original in-memory cache

The existing cache uses repository/project/anchor-chapter identity. Book images are
already prepared from one flattened document, but a book has no distinct cache
identity. The required lifecycle is one active target: either a single chapter or
a whole book in a project. Repeated exports and text/layout revisions reuse matching
image fingerprints; switching targets evicts the previous target's entries.

1. Identify chapter and book targets explicitly. Book identity must remain stable
   when chapter order, inclusion, language, or front matter changes.
2. Activate the cache once per export job; retain stale-job guards so an older job
   cannot switch back to or repopulate an evicted target. Keep the cache process-local.
3. Exercise the actual preparation pipeline with an isolated cache: repeated book
   exports, multiple chapter images/front matter, one changed image, and chapter →
   book → chapter transitions. Check scope identity and stale concurrent jobs too.
4. Run focused native cache/PDF tests and relevant existing export checks.

Implemented: explicit chapter/book target identity, request-time cache activation,
generation guards for stale jobs, stable book identity across layout changes, and
a distinct "Reusing prepared images" message on entirely warm exports. The cache
remains process-local; fresh per-job workspace files reuse the cached prepared bytes.

The isolated pipeline regression uses two chapter WebP images and a publisher PNG.
It verifies actual JPEG optimization, duplicate-image deduplication, exact Arc reuse
on warm exports, selective invalidation of one changed file, reorder/title changes,
and chapter -> book -> chapter -> book eviction. Other tests cover stable scope
classification and stale-worker rejection after switching away and back.

Validation complete:
- Four focused cache tests passed, including the actual image-preparation pipeline.
- All 57 native PDF-module tests and 44 frontend export-flow tests passed.
- The composed-book smoke test compiled successfully with the bundled offline
  Typst binary and cached fonts.
- Strict library Clippy (-D warnings), Rust formatting, and diff whitespace passed.

## Reusing print-ready images between exports

1. Trace URL, upload, chapter, book, preview, and restart behavior through the native export pipeline. Measure the preparation stage against the HNHH images.
2. Reuse conversions on disk by source contents and print settings, within a bounded local cache. Keep source freshness, changed uploads, unsupported images, cancellation, and concurrent exports correct. Make the progress message distinguish reuse from conversion.
3. Test cold and warm exports, simulated restarts, target switches, invalidation, and workspace materialization. Rebuild the local app and check the HNHH proof.

The native exporter stores converted images in `export-images/pdf-prepared` under
the app cache directory. Its key includes the source content hash, maximum dimensions,
JPEG quality, and conversion revision. Downloaded originals refresh after seven days.
Prepared images can be reused across chapters, books, previews, and app restarts.
They have a separate 512 MiB budget, with the least recently used copies evicted first.
Images already suitable for print pass through without a second disk copy.

On macOS the HNHH book used 135 downloaded originals and one uploaded cover. A
fresh process converted 124 images. A second process reused all 124 conversions
from disk. The bytes written to the export workspace matched for all 136 images.
