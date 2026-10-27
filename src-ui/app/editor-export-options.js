export const DEFAULT_PDF_PAPER_SIZE = "a4";

export const PDF_PAPER_SIZES = [
  { value: "us-letter", widthMm: 215.9, heightMm: 279.4, label: "US Letter (8.5 × 11 in)" },
  { value: "us-legal", widthMm: 215.9, heightMm: 355.6, label: "US Legal (8.5 × 14 in)" },
  { value: "us-executive", widthMm: 184.15, heightMm: 266.7, label: "US Executive (7.25 × 10.5 in)" },
  { value: "us-tabloid", widthMm: 279.4, heightMm: 431.8, label: "US Tabloid (11 × 17 in)" },
  { value: "a3", widthMm: 297, heightMm: 420, label: "A3 (297 × 420 mm)" },
  { value: "a4", widthMm: 210, heightMm: 297, label: "A4 (210 × 297 mm)" },
  { value: "a5", widthMm: 148, heightMm: 210, label: "A5 (148 × 210 mm)" },
  { value: "iso-b5", widthMm: 176, heightMm: 250, label: "B5 / ISO (176 × 250 mm)" },
];

export function isSupportedPdfPaperSize(value) {
  return PDF_PAPER_SIZES.some((entry) => entry.value === value);
}
