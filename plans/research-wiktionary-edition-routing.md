# Wiktionary edition routing

The saved Ancient Greek lookup requested `grc.wiktionary.org`, which has no DNS
record. The English edition returns the exact Ancient Greek entry successfully.
Lexical language codes do not always identify a Wiktionary edition.

## Work

- Route Ancient Greek to English Wiktionary in the native lookup, retaining both
  the requested lexical language and actual edition in the evidence receipt.
- Use accurate progress labels, avoid duplicate English fallback requests, and
  version dictionary tool keys so saved failures do not poison future lookups.
- Verify native URL/response behavior and frontend fallback/cache regressions.
  Preserve existing completed research and immutable historical receipts.

## Validation

- Live diagnostic: `grc.wiktionary.org` does not resolve; English MediaWiki parse
  API returns HTTP 200 and the Ancient Greek entry for `ἱεροφάντης`.
- Implemented native Ancient Greek routing and evidence metadata, accurate activity
  text, English fallback deduplication, and dictionary cache contract version 3.
  Completed study results and earlier receipts remain historical evidence.
- 223 studio/renderer unit tests passed, including routing-aware fallback and
  failed-cache bypass regressions.
- 3 native dictionary unit tests passed. The separately invoked live native
  lookup returned `found` from English Wiktionary for `ἱεροφάντης` (0.85 seconds).
- Targeted ESLint, Rust formatting, and whitespace checks passed.
