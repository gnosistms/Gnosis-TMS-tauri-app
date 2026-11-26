# A5 footnote QR proof

1. Make a standalone Typst sample using the PDF exporter's A5 text and footnote settings. Include a linked note, a media citation, a plain note, and a note with two sources.
2. Encode each original URL in the smallest standard QR version that fits at medium error correction. Give each linked note a right-hand column and put the visible link words beneath the code.
3. Compile with the bundled Typst version, inspect the printed layout, and decode the symbols from rendered pages to check their full destinations.
4. Recognize a footnote consisting of one link regardless of punctuation. Print its visible text once beneath the code, fit long captions with an ellipsis, and verify both a titled link and a bare URL.
5. Wrap multiple QR codes left to right within half the available note width. Set a five-link note in the A5 proof, measure the grid in the PDF, and decode the codes in their printed order.
6. Apply the sentence rule in context. Keep a linked question within its enclosing sentence and verify that an independent linked sentence in the same note appears only as a caption.
7. Measure the footnote prose and each QR row with its captions. Keep rows beside the prose within half width, expand rows that start below it, and right-align every row. Verify the transition, the last row, and scan order on A5.
8. When the printed footnote has no prose, start its QR at the ordinary text indent. Check a whole-link title, a bare URL, and a group containing only standalone captions.

## Result

The two-page proof uses 0.34 mm modules, four clear modules on each side, and 7.5 pt captions. It automatically recognizes a single link as the entire note, including a title without punctuation or a bare URL. The link appears once beneath the code and gets an ellipsis if its caption exceeds one line. Footnote 2 shows a short media title in full. Footnote 4 shortens the visible 163-character URL. The PDF link and QR preserve the page fragment.

Within a note containing other prose, a linked sentence appears only beneath the QR when it can be removed as a unit and the surrounding prose still reads naturally. The proof explicitly marks these standalone sentences and otherwise keeps the linked words in both places. In footnote 5, “Where does Paul begin?” is part of the sentence about a reader asking a question and also appears as a caption. The independent instruction “Browse the films.” appears only as a caption.

Footnote 5 places two links beside the prose, four across the next row, and one at the right margin on the last row. The three rows measure 45, 91, and 22 mm including captions and column gaps. Half the space after the number is 50.85 mm. The second row starts 2.7 mm below the final line of prose. A longer test note kept two rows beside the prose before expanding. Individual codes retain their natural pitch unless one alone exceeds its width allowance.

When the note contains only QR captions, each row begins at the ordinary footnote text indent and can use the full width from the outset. The QR quiet zone and its caption both start at the indent in notes 2 and 4. A separate nine-link caption-only test wrapped into left-aligned rows of four, four, and one.

Typst 0.15.1 rendered ten codes in versions 2, 3, 4, 5, and 9. All ten decoded from the 300 dpi page images to their full original URLs in printed order. Paper scanning still needs a print test at actual size.
