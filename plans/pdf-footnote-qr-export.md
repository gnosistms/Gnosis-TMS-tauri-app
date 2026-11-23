# QR links in PDF footnotes

1. Default chapter and book PDF exports to QR codes. Restore explicit PDF choices and the legacy opt-out from printed URLs. Use the same selection for the dropdown, font inspection, page previews, and export.
2. Generate standard QR symbols offline from full destinations. Derive captions and prose from linked footnotes and captioned media, preserving paragraph breaks, inline styling, and native footnote anchors.
3. Use the compact A5 proof's 0.254 mm QR modules, four-module quiet zones, and 7.5 pt captions. Exercise the export UI and native chapter/book paths, compile an A5 PDF, and decode its codes.
4. Pack consecutive single-link notes on the same page into 23 mm minimum units with 3 mm gutters. Measure short prose in two units and give code-only notes the units their symbol and number need. Keep long, plain, and multi-link notes full width. Verify actual chapter/book output at all supported widths, including mixed rows, navigation, and page boundaries.
5. Move independent linked prompts to the QR caption even when they lack final punctuation. Use the surrounding sentence and paragraph boundaries across scripts. Test standalone prompts, embedded phrases, quotations, and soft line breaks.

## Verification

The browser export test used the default QR selection and checked both font inspection and export. The native chapter and book fixtures compiled with the bundled Typst binary. In the A5 sample, the media-only note aligned left, the seven-link note filled rows of two, four, and one, and each of the eight codes decoded to its full destination at both 300 and 600 dpi. The quoted question appeared in the prose and its caption, and the independent linked sentences appeared only in their captions.

The adaptive layout was checked with the bundled renderer at all eight paper sizes. The A5 book fixture includes paired text notes, four QR-only notes, a mixed row, a media footnote, and a dense code that needs two units. All 14 codes decoded to their complete destinations at 300 and 600 dpi, and all 15 numbered links navigated to their individual notes and back. A separate 48-footnote chapter verified row alignment and callout pages across natural page breaks.

The A5 book fixture renders “Ê-lo-him là thiên thần.” in the footnote and “Đọc thêm” once beneath the QR. Regression tests cover standalone and embedded links across eight languages, including unspaced Japanese text and a Thai prompt separated by a paragraph break.
