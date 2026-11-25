# Shorter links in PDF QR codes

1. Discover and verify page-published shortlinks for WordPress and use the MediaWiki URL Shortener API for Wikimedia and compatible MediaWiki sites. Deduplicate lookups within a PDF workspace and fall back to the original URL when discovery is unavailable.
2. Choose the smallest standard QR version at Low error correction. Within that version, choose the strongest error correction and restore the URL scheme when it fits at the chosen level. Preserve the original clickable PDF links and editor content.
3. Exercise WordPress and MediaWiki discovery, section anchors, media footnotes, and QR version and error-correction selection.
4. If MediaWiki’s shortener is unavailable, try its built-in page-ID link. Verify that it opens the same article and preserves any section before giving it to the existing QR selector and local cache.
5. Compare equivalent URL spellings using the QR encoder. Reparse changes to scheme case, hostname case, and escaped UTF-8 to confirm the destination before considering them. Rank candidates by symbol size, error correction, and explicit scheme.

## Verification

The native PDF tests ran with bundled Typst and the cached print fonts. The live WordPress lookup verified both the advertised `wp.me` destination and the same-site post-ID link. The encoder chose the 21 × 21 Low symbol for the `wp.me` link. Wikimedia denied the live API request from the test network. Response fixtures cover successful shortening and fallback when the API blocks or rate-limits the request.

The live Wikipedia page-ID fallback produced a 29 × 29 QR for the Minh thần section. The corresponding PDF tests exercised the same payload selection, URL equivalence, escaped delimiters, error correction, and scheme preference.
