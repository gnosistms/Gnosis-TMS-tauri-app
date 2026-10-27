import { bookPrintProfile, bookPrintVariables } from "./project-book-print-profile.js";
import { DEFAULT_PDF_PAPER_SIZE, PDF_PAPER_SIZES } from "./editor-export-options.js";

// Mirror typst_preamble's print geometry. cqw scales all measurements with the
// actual paper canvas, so a narrow pane never changes the relative text width.
export function bookPaperStyle(modal, kind) {
  const paper = PDF_PAPER_SIZES.find((paper) => paper.value === modal.pdfPaperSize)
    || PDF_PAPER_SIZES.find((paper) => paper.value === DEFAULT_PDF_PAPER_SIZE);
  const a5 = paper.value === "a5";
  const left = a5 ? (kind === "copyright" ? 19 : 22) : 21.59;
  const right = a5 ? (kind === "copyright" ? 22 : 19) : 21.59;
  const vertical = a5 ? 20 : 20.32;
  const basePt = bookPrintProfile(modal).bodySizePt;
  const fontMm = basePt * (kind === "copyright" ? .8 : 1) * 25.4 / 72;
  const unit = (mm) => `${(100 * mm / paper.widthMm).toFixed(6)}cqw`;
  return `--book-paper-mm:${unit(1)};--book-paper-width:${(paper.widthMm * 96 / 25.4).toFixed(6)}px;--book-paper-height:${unit(paper.heightMm)};--book-paper-top:${unit(vertical)};--book-paper-bottom:${unit(vertical)};--book-paper-left:${unit(left)};--book-paper-right:${unit(right)};--book-paper-font:${unit(fontMm)};${bookPrintVariables(modal, kind)}`;
}
