# HNHH footnote layout proof

1. Inventory the Gnosis VN working copy in book and row order. Reconcile structured, legacy, caption, and language-specific notes against the source and record their original locations.
2. Collect every note and link. Identify real examples of short notes, links without surrounding prose, different link captions, long passages, and several links attached to one note.
3. Make a reading proof with a case index. Set consecutive short notes together and allow longer prose to use the space below the QR codes.
4. Check the extracted totals, destinations, case references, pagination, and rendered pages before delivering the collection.

## Result

The local copy and the team repository pointed to `25d9d37a`. The 35 chapters contain 549 authored footnotes across 2,091 active rows. Vietnamese has 434, English has 112, and Spanish has three. Two Vietnamese recording captions generate additional PDF notes.

The 103-page A5 proof and searchable HTML collection include all 551 entries. Seven are link-only, ten contain multiple destinations, and chapter 8 note 2 has the maximum of three. The proof gives codes to 59 addresses pasted into prose in addition to the 169 destinations recognized by the exporter.

All 549 authored bodies were independently matched to their language, row, and marker. All 551 printed number links lead to their original source rows. Each of the 228 codes is on the page where its note begins and decoded to its exact original URL at both 300 and 600 dpi. The ten case-index destinations and printed page numbers matched. Chapter 3 note 43 and chapter 12 note 16 both recover the full text measure below their codes.

## Justification revision

1. Justify ordinary and standalone QR-note prose. Apply start alignment to compact single-link notes sharing a QR row and to link-only captions. Preserve authored breaks and the alignment of paragraph endings.
2. Regenerate the A5 PDF and its searchable companion from the same HNHH snapshot. Recalculate the case index after pagination.
3. Measure the printed right edges beside and beneath the codes in chapter 3 note 43 and chapter 12 note 16. Verify the source rows, QR payloads, and case destinations in the new PDF.

The revised proof justifies 483 entries. The 61 short single-link entries sharing a QR row and seven link-only captions use start alignment. On page 16, the first three lines of chapter 3 note 43 end at 339.54 pt and the next ten at 371.22 pt. On page 44, chapter 12 note 16 reaches 316.21 pt beside its two codes and 371.22 pt below them. The ten index destinations match their printed pages, and all 228 QR payloads decoded at 300 and 600 dpi.

## Footnote paragraph revision

1. Check chapter 1 notes 1 and 2 against their saved project rows and the Gnosis TMS line and paragraph break rules.
2. Render each footnote paragraph at normal line spacing, indent subsequent paragraphs, and preserve forced line breaks, inline formatting, and link captions. Repaginate the proof and update its case index.
3. Measure the two references and the five list items in print. Check verse, justified wrapping, the complete collection, and the printed QR destinations.

The current proof is 95 A5 pages. Its 551 entries contain 833 paragraphs and 30 forced line breaks within paragraphs. The original 549 authored notes match the current Gnosis VN project rows. The two audio notes are included in the total.

Both chapter 1 examples use ordinary paragraph breaks. The bundled Typst exporter places successive paragraphs one line apart and indents their opening lines by 1.5em. On pages 3 and 4 of the proof, the references and the numbered items now start at the same 15pt indent, with 14.25–15pt between baselines. The earlier proof had 28.5–29.25pt between them.

All 12 case-index entries point to the printed example. Each of the 228 QR codes begins on its note's page and decodes to its original destination at both 300 and 600 dpi.

## QR alignment revision

1. Align the outermost printed modules in each QR row with the right edge of the footnote text. Center each caption on its own symbol and allow the caption and quiet zone to extend into the margin.
2. Apply the placement to the paired preview and HNHH reading proof, including single codes and partially filled rows. Rebuild the PDF and its case index.
3. Measure the symbol edges and caption positions in the PDF and at narrow screen widths. Check the printed destinations, paragraph spacing, and text wrapping.

The 95-page proof contains 183 QR rows and 228 codes. In the PDF, the outermost black module in every row meets the text margin at 371.25 pt, including the four groups with a partially filled row. All 75 captions extending past the margin are fully printed. The caption for chapter 1 note 2 reaches 7.8 mm into the margin on page 4.

The searchable proof retains all 551 notes and their original QR destinations. At screen widths from 320 to 920 px the outer code edges met the text margin and captions stayed centered and visible. All 228 printed codes decoded at 300 and 600 dpi.

## Native implementation

1. Use the shared chapter and book PDF renderer to align the black edge of each QR row, allow centered captions to hang, and restore the full paragraph width below the codes.
2. Pair consecutive short notes on the same page with their numbered codes. Support shared and mixed captions, embedded sources, link-only notes, and multiple destinations. Keep native callouts and backlinks, and use the existing paragraph, line break, and justification rules.
3. Exercise chapter exports, book exports, and the book page preview. Check the printed geometry, text, links, and QR payloads with the HNHH examples and native regression fixtures.

The native chapter exporter, book exporter, and contents pagination now use the approved layout in Print QR codes mode. The typesetter measures the selected paper and fonts, groups consecutive short notes, and verifies that their callouts and printed numbers land on the same page.

All 551 HNHH entries were checked through the project export reader. In the Vietnamese collection, all 228 symbols decoded to the intended destinations at 300 and 600 dpi. The outer black edge of every one of the 184 QR rows met its physical text margin within 0.01 pt, and all 82 hanging captions stayed on the page. All 108 grouped notes had working forward and return PDF links, including groups that share one code with a plain-text note.

In the seven-page native chapter 1 export, page 2 shows the two linked references beneath the pillars note. Page 4 shows the five list items on successive 10.49 pt baselines. Its centered caption extends 7.8 mm into the margin. The chapter PDF and a four-note example are in `output/pdf/hnhh-chapter-01-native-qr-footnotes.pdf` and `output/pdf/hnhh-native-grouped-footnotes.png`.

## Whole-book shortlink verification

1. Export the current Vietnamese HNHH project in its saved A5 book order using the Gnosis TMS shortlink cache, verified discovery, and native QR renderer.
2. Check the complete book, including front matter, chapter text, illustrations, and footnotes. Decode the printed symbols, compare their sizes with the earlier full-URL samples, and account for larger codes.
3. Refresh the examples with verified shortlinks and cover the shortlink path in a representative rendering test.

The earlier native HNHH samples passed an empty shortlink map and printed the authored URLs. The final proof uses the native book export with the verified Gnosis TMS shortlink cache and live discovery. The second pass obtained the four remaining official Wikimedia short links and picked up the newly saved chapter 14 footnote in HNHH revision `314f5df3`.

The complete Vietnamese A5 book has 543 pages, including the saved title and copyright pages, contents, introduction, and 34 numbered chapters. All 437 footnotes and 229 printed codes matched the project inventory. The 229 codes point to 143 distinct destinations. Of the printed symbols, 207 measure 21×21 modules, six measure 25×25, twelve measure 29×29, and four measure 33×33. Ten larger symbols preserve article section identifiers and twelve encode direct addresses. All 229 decoded at both 300 and 600 dpi, with the digital PDF links retaining the authored destinations.

All 190 code rows met the outside text edge within 0.001 pt, all 95 hanging captions stayed on the page, and all 82 grouped footnotes passed forward and return link checks. PDF pages 22, 24, and 50 show the two-code pillars note, the five-item list, and four consecutive short notes. The corrected searchable collection and its 94-page companion include all 552 notes across Vietnamese, English, and Spanish. The chapter and book rendering regression checks both a verified 21×21 WordPress shortlink and a 29×29 direct audio link.

## Group codes only to prevent extra spacing

1. Measure each footnote with its own code and caption at the actual page width. Use a shared row only where separate codes would add vertical space, and only if the shared layout saves height.
2. Keep single-code captions unnumbered beside their own notes. Identify codes in shared groups and multiple links within a note.
3. Test tall and short notes, mixed runs, real captions, and page breaks. Rebuild the complete Vietnamese HNHH proof and compare the three notes in the screenshot with their separate layout.

The exporter now measures the individual code, caption, and wrapped text at the selected paper width. A code that fits within its note and the normal gap always stays beside that note. A shared row must recover height at the same inter-note spacing. It ends as soon as the codes clear the next note, and pagination keeps the row with its callouts.

The Vietnamese A5 proof from HNHH revision `2c7e6e90` has 543 pages and 436 footnotes. On printed pages 10–11, notes 10–12 each have 26.59 pt of text and a 22.69 pt code and caption. All three retain their own 21×21 code, with the normal 8.40 pt gap between notes 11 and 12. On printed page 46, the two one-line notes 44–45 share a numbered row, and note 46 keeps its own code.

Across the book there are 11 shared groups containing 23 notes. Their PDF callouts and return links passed, and all 229 codes decoded at both 300 and 600 dpi. Every outermost code met the text edge within 0.001 pt. The regression covers individual codes on either side of a short run, a genuine three-code row, and page breaks at eight paper sizes.

## Match QR labels to their printed owners

1. Keep every link in a multi-code footnote beside its lettered marker. Print the same identifier under its code, in source order.
2. Check the printed owner numbers for codes sharing a row and for one code spanning a linked note and a plain note. Verify shared caption text appears once and an independent single code keeps its unnumbered caption.
3. Re-render the same full-book HNHH proof and check its labels, destinations, and pagination against the native typesetter and the project snapshot.

The chapter and book exporter keeps each link in a multi-code note and places the same lettered key beside the link and beneath the QR. A shared row prints each code’s owner number. Identical standalone captions appear once above that row. Different captions stay with the links in the notes. A single code beside a linked note and a plain neighbor includes the linked note’s number.

The 543-page proof uses the same HNHH snapshot as the spacing proof. PDF page 22 shows both copies of `15a` and `15b`. Page 50 shows `44` and `45` beneath their shared row, and page 52 shows `49` beside notes 49 and 50. Three previously missing in-text markers now appear in footnotes 234 and 252 on PDF pages 240 and 258.

The full-book check matched all 21 lettered markers to their printed codes and clickable destinations. It also verified all 10 codes sharing rows with other owners, all six owner numbers on single codes spanning notes, and all 192 individually placed codes. All 229 symbols decoded at 300 and 600 dpi. The three page excerpts are in `output/pdf/hnhh-qr-label-examples.png`.

## Pairing a one-line note with a two-line note

1. Reproduce printed page 6 from the same HNHH snapshot. Measure notes 5 and 6 with individual codes and with a shared row, including the normal gap and all caption and text wrapping.
2. Correct candidate selection in the chapter and book exporter. Add a native layout regression for mixed note lengths and for longer notes that already have room for their codes.
3. Refit the full book, verify the printed positions, labels, and destinations, and update the proof and the QR export PR.

The first code triggers the comparison when it would reach the next note at normal spacing. The next note can share the row even when its own code fits. The shared row must save height after wrapping both texts and placing all captions. Candidate groups end at the original page break, and the exporter checks their callouts again after repagination.

On printed page 6 (PDF page 10), note 5 has 5.60 pt of text and a 22.69 pt code and caption. Note 6’s code extends 6.60 pt past its text, within the normal 8.40 pt gap. The two codes now share one “Đọc thêm.” caption with their individual numbers. The distance between the first lines of notes 5 and 6 falls from 31.09 pt to 14.00 pt. Their total height falls from 53.78 pt to 40.58 pt.

Note 4 stays on the preceding page. Notes 9 and 10 also save height as a pair, while 11 and 12 keep their individual codes. The 543-page proof contains 436 notes. All 41 grouped note entries passed the forward and return link checks, and all 229 QR symbols decoded at both 300 and 600 dpi.
