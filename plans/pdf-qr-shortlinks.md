# Shorter links in PDF QR codes

1. Discover and verify page-published shortlinks for WordPress and use the MediaWiki URL Shortener API for Wikimedia and compatible MediaWiki sites. Deduplicate lookups within a PDF workspace and fall back to the original URL when discovery is unavailable.
2. Choose the smallest standard QR version at Low error correction. Within that version, choose the strongest error correction and restore the URL scheme when it fits at the chosen level. Preserve the original clickable PDF links and editor content.
3. Exercise WordPress and MediaWiki discovery, section anchors, media footnotes, and QR version and error-correction selection.
4. If MediaWiki’s shortener is unavailable, try its built-in page-ID link. Verify that it opens the same article and preserves any section before giving it to the existing QR selector and local cache.
5. Compare equivalent URL spellings using the QR encoder. Reparse changes to scheme case, hostname case, and escaped UTF-8 to confirm the destination before considering them. Rank candidates by symbol size, error correction, and explicit scheme.

## Verification

The native PDF tests ran with bundled Typst and the cached print fonts. The live WordPress lookup verified both the advertised `wp.me` destination and the same-site post-ID link. The encoder chose the 21 × 21 Low symbol for the `wp.me` link. Wikimedia denied the live API request from the test network. Response fixtures cover successful shortening and fallback when the API blocks or rate-limits the request.

The live Wikipedia page-ID fallback produced a 29 × 29 QR for the Minh thần section. The corresponding PDF tests exercised the same payload selection, URL equivalence, escaped delimiters, error correction, and scheme preference.

## WordPress links to individual sections

1. Decode HNHH notes 32 and 33 and identify the live headings for Geburah and Chesed. Verify the published WordPress shortlink and its behavior with each fragment.
2. For each section, verify that its compact address opens the intended heading before making it available to the PDF encoder. Cover existing cached article links and independent section destinations.
3. Render the Vietnamese book from the same snapshot, decode both printed symbols, and check the other printed links and footnote layout.

Both photographed symbols decoded as 29 × 29. WordPress gives both sections the article shortlink `wp.me/p6Zr2M-3b6`. On the current page, the original heading fragments `Geburah_Phien_am_Go-vu-ra` and `Chesed_Phien_am_Khe-sed` leave a browser at the top of the article. The published fragments `Go-vu-ra` and `Khe-sed` take the reader to the corresponding headings.

The WordPress-only proof uses those current fragments for scanning and clicking. The two symbols are 25 × 25 on PDF page 33 (printed page 29). All 229 QR codes in the 543-page book decoded at 300 and 600 dpi. A 21 × 21 version requires a separate persistent short address for each heading.

## Self-service compact PDF codes

1. Offer a compact QR export mode that identifies the public shortening service. Prefer an original address or a verified publisher link that already fits a 21 × 21 symbol. Request any remaining short addresses from the desktop, with the full section and without an account or a per-book redirect list.
2. Verify the public destination and the service's redirect, cache accepted results by exact URL, and handle offline exports, service limits, and previously cached publisher links. Preserve the ordinary QR export and the digital PDF links.
3. Exercise chapter and book exports, mode selection, and unsuccessful lookups. Run the new path on the corrected HNHH headings and decode the printed book.

The PDF export option **Print compact QR codes using is.gd** accepts verified sections on public HTTPS pages. The desktop checks the published heading, requests a persistent address, follows its redirect, and caches it by the complete source URL. It skips URLs with credentials or query strings and pages marked noindex. An offline first export or an unavailable service falls back to the publisher or original link. The service receives only the section URL. [is.gd desktop API](https://is.gd/apishorteningreference.php)

In the corrected HNHH book, notes 32 and 33 each printed at 21 × 21 and opened the headings Gơ-vu-ra and Khe-seđ. Across 543 pages, all 229 symbols decoded at both 300 and 600 dpi, and 216 were 21 × 21. Nine printed codes became smaller.
