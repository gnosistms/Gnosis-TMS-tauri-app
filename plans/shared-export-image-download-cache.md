# Share downloaded export images across formats

Exporting a book as EPUB and then as PDF downloads every remote image twice.
PDF, EPUB and DOCX (and the WordPress image measuring) all fetch through
`download_public_image_bytes_detailed`, but nothing keeps what it downloads. The
PDF's prepared-image cache holds converted bytes in memory for one PDF target
only, and EPUB has no cache at all.

Keep the downloaded originals on disk and reuse them from that one function, so
every format shares them. Each format still converts the bytes its own way.

1. New `export_image_cache` module in `chapter_editor/`: files in the app cache
   folder (`export-images/`), named by the SHA-256 of the URL, written to a
   temporary file and renamed into place.
   - A copy is used for 7 days, so an image replaced at the same address shows
     up within a week.
   - The folder is capped at 512 MB; the oldest copies go first.
   - Only bytes that look like an image are kept, so a sign-in or error page
     served in place of an image is fetched again next time. Failed downloads
     are never kept.
   - A cached copy over the 25 MB download cap is ignored.
2. `download_public_image_bytes_detailed` returns a fresh cached copy before
   making a request and remembers each successful image download.
3. App setup sets the cache folder. Without it (tests), nothing is cached.
4. Test reuse, expiry, the size cap, eviction order and the image check; run the
   native export tests, strict Clippy and rustfmt.

## Implemented

`export_image_cache.rs` keeps the originals in `<app cache>/export-images/`
(on macOS `~/Library/Caches/com.gnosis.tms/export-images/`).
`download_public_image_bytes_detailed` reads it before any request and fills it
after each successful download, so PDF, EPUB, DOCX and WordPress image
measuring share it. The PDF's in-memory cache of converted images is unchanged
and still checked first.

Validation: 93 export tests pass, 4 of them new for the cache. A one-off probe
(not committed) downloaded a real 487 KB WebP from gnosisvn.org in 2.4 s and
read it back from the cache in 0.2 ms.
