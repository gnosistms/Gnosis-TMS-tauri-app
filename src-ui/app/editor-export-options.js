export const DEFAULT_PDF_PAPER_SIZE = "a4";

export const PDF_PAPER_SIZES = [
  { value: "us-letter", label: "US Letter (8.5 × 11 in)" },
  { value: "us-legal", label: "US Legal (8.5 × 14 in)" },
  { value: "us-executive", label: "US Executive (7.25 × 10.5 in)" },
  { value: "us-tabloid", label: "US Tabloid (11 × 17 in)" },
  { value: "a3", label: "A3 (297 × 420 mm)" },
  { value: "a4", label: "A4 (210 × 297 mm)" },
  { value: "a5", label: "A5 (148 × 210 mm)" },
  { value: "iso-b5", label: "B5 / ISO (176 × 250 mm)" },
];

export function isSupportedPdfPaperSize(value) {
  return PDF_PAPER_SIZES.some((entry) => entry.value === value);
}
