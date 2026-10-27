# PDF image cache follows the export target

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

Status: complete. Cache state lasts for the running app process and is repopulated
after an app restart or native development rebuild.
