# QR links in PDF footnotes

1. Default chapter and book PDF exports to QR codes. Restore explicit PDF choices and the legacy opt-out from printed URLs. Use the same selection for the dropdown, font inspection, page previews, and export.
2. Generate standard QR symbols offline from full destinations. Derive captions and prose from linked footnotes and captioned media, preserving paragraph breaks, inline styling, and native footnote anchors.
3. Use the compact A5 proof's 0.254 mm QR modules, four-module quiet zones, and 7.5 pt captions. Exercise the export UI and native chapter/book paths, compile an A5 PDF, and decode its codes.
4. Pack consecutive single-link notes on the same page into 23 mm minimum units with 3 mm gutters. Measure short prose in two units and give code-only notes the units their symbol and number need. Keep long, plain, and multi-link notes full width. Verify actual chapter/book output at all supported widths, including mixed rows, navigation, and page boundaries.
5. Move independent linked prompts to the QR caption even when they lack final punctuation. Use the surrounding sentence and paragraph boundaries across scripts. Test standalone prompts, embedded phrases, quotations, and soft line breaks.
6. Reduce the horizontal layout spacing around QR codes to 55%, including excess caption-column width and gutters. Compare the rendered geometry and decode the exported codes at print resolution.

## Verification

The browser export test used the default QR selection and checked both font inspection and export. The native chapter and book fixtures compiled with the bundled Typst binary. In the A5 sample, the media-only note aligned left, the seven-link note filled rows of two, four, and one, and each of the eight codes decoded to its full destination at both 300 and 600 dpi. The quoted question appeared in the prose and its caption, and the independent linked sentences appeared only in their captions.

The adaptive layout was checked with the bundled renderer at all eight paper sizes. The A5 book fixture includes paired text notes, four QR-only notes, a mixed row, a media footnote, and a dense code that needs two units. All 14 codes decoded to their complete destinations at 300 and 600 dpi, and all 15 numbered links navigated to their individual notes and back. A separate 48-footnote chapter verified row alignment and callout pages across natural page breaks.

The A5 book fixture renders “Ê-lo-him là thiên thần.” in the footnote and “Đọc thêm” once beneath the QR. Regression tests cover standalone and embedded links across eight languages, including unspaced Japanese text and a Thai prompt separated by a paragraph break.

At 55% spacing, the A5 gap between adjacent codes in the multi-link note fell from 12.08 mm to 6.64 mm. In the row of four QR-only notes the gap from a code to the next number column fell from 12.81 mm to 7.05 mm. All 22 codes in the chapter and book samples retained their printed dimensions and decoded to their destinations at 300 and 600 dpi.

The approved module pitch is 25.4 mm × 5 ÷ 600, about 0.212 mm. A 21 × 21 code measures 6.14 mm square including the four-module quiet zone. The native exporter uses this pitch for chapter and book PDFs.

## Compare adjacent QR footnotes by printed height

1. Measure the separate and shared layouts for neighboring linked notes on the same page, including the printed captions, text wrapping, and normal footnote gap. Use the actual height saved to choose among overlapping groups. Keep separate codes on a tie.
2. Retain owner labels, the handling of a code beside an unlinked neighbor, and the final check that a group fits with its callouts after pagination.
3. Check both orders of a short and a long note, equally tall alternatives, and competing groups with the native renderer. Compare printed page 5 in the full Vietnamese HNHH book and verify the QR links.

In the initial A5 height comparison, notes 3 and 4 measured 68.16 pt separately and 54.31 pt together. Notes 5 and 6 also paired, and notes 10–12 kept individual codes. The 543-page proof contained all 436 notes. All 229 codes decoded to their expected destinations at both 300 and 600 dpi, and every grouped note linked to its own callout on the same page.

## Line spacing when a footnote returns to full width

1. Measure the printed baselines around the QR codes in HNHH note 3.
2. Preserve the paragraph’s normal line spacing where its width changes, including when the caption ends between two lines. Keep the full-width text clear of the QR codes and captions.
3. Verify individual and shared codes in native PDF exports, then refit the full HNHH proof and check its links.

On printed page 5, the baseline advance from “dẫn dắt” to “bất kỳ” fell from 13.73 pt to 10.49 pt, matching the preceding lines. The corrected book still has 543 pages. All 229 codes decoded at 300 and 600 dpi, and all 81 grouped note entries had working same-page callouts and backlinks.
