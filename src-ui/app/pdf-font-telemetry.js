import { scrubString } from "./telemetry-scrub.js";

// Explicitly construct a metadata-only report. Never spread the backend payload:
// review events elsewhere contain document excerpts and must stay on-device.
export function createPdfFontCoverageReport(payload = {}) {
  const names = (values) => (Array.isArray(values) ? values : [])
    .filter((value) => typeof value === "string")
    .slice(0, 16).map((value) => scrubString(value, 100)).join(", ").slice(0, 200);
  return {
    level: "warning",
    fingerprint: ["pdf-font-coverage-gap", names(payload.unicodeBlocks), String(payload.recovered === true)],
    tags: {
      source: "pdf-font-coverage",
      unicode_blocks: names(payload.unicodeBlocks),
      primary_fonts: names(payload.primaryFamilies),
      fallback_fonts: names(payload.fallbackFamilies),
      missing_character_count: String(Math.max(0, Math.min(1_114_112, Number(payload.missingCharacterCount) || 0))),
      recovered: String(payload.recovered === true),
    },
  };
}
