# QR links in PDF footnotes

1. Default chapter and book PDF exports to QR codes. Restore explicit PDF choices and the legacy opt-out from printed URLs. Use the same selection for the dropdown, font inspection, page previews, and export.
2. Generate standard QR symbols offline from full destinations. Derive captions and prose from linked footnotes and captioned media, preserving paragraph breaks, inline styling, and native footnote anchors.
3. Use the compact A5 proof's 0.254 mm QR modules, four-module quiet zones, and 7.5 pt captions. Exercise the export UI and native chapter/book paths, compile an A5 PDF, and decode its codes.

## Verification

The browser export test used the default QR selection and checked both font inspection and export. The native chapter and book fixtures compiled with the bundled Typst binary. In the A5 sample, the media-only note aligned left, the seven-link note filled rows of two, four, and one, and each of the eight codes decoded to its full destination at both 300 and 600 dpi. The quoted question appeared in the prose and its caption, and the independent linked sentences appeared only in their captions.
