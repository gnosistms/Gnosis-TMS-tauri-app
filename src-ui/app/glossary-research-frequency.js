// Word and sense frequencies for Glossary Research.
//
// Whole-word Zipf scores come from a per-language frequency list; per-sense
// scores come from classifying a seeded sample of general-corpus sentences:
//   per-sense Zipf = whole-word Zipf + log10(share of sentences using the sense).
// The data is downloaded per language on first use (Rust:
// glossary_research_language_data.rs); see plans/glossary-research-procedure-2026-10.md.

export const RESEARCH_DATA_CONTACT = "gnosistms@gmail.com";

/** Smallest sample for which "the sense never occurs" counts as evidence. */
export const MIN_SENSE_SAMPLE = 30;

/**
 * The language code sent to the data commands: the base code ("pt-BR" → "pt"),
 * except Traditional Chinese, which keeps its script so the Simplified-script
 * data is searched with converted words.
 */
export function dataLanguage(code) {
  const lower = String(code ?? "").toLowerCase();
  if (["zh-hant", "zh-tw", "zh-hk", "zh-mo"].includes(lower)) return "zh-hant";
  const base = lower.split("-")[0];
  return base === "no" || base === "nn" ? "nb" : base;
}

/** Zipf of several forms of one word together (their frequencies added). */
export function combinedZipf(values) {
  const total = values.filter((z) => z > 0).reduce((sum, z) => sum + 10 ** (z - 9), 0);
  return total > 0 ? Math.log10(total) + 9 : 0;
}

/**
 * Per-sense score from a classified sample. With no sentence in the sense, an
 * upper bound (about 3/n of the word's use) is reported instead of an estimate.
 */
export function senseZipf(wordZipf, inSense, classified) {
  if (!classified || !(wordZipf > 0)) return { zipf: null, upperBound: null, share: null, inSense, classified };
  if (!inSense) {
    return { zipf: null, upperBound: wordZipf + Math.log10(3 / classified), share: 0, inSense, classified };
  }
  const share = inSense / classified;
  return { zipf: wordZipf + Math.log10(share), upperBound: null, share, inSense, classified };
}

export function formatZipf(value) {
  return value == null ? "—" : value.toFixed(2);
}

/** "2.31", "< 1.80 (0 of 64)", or "—". */
export function describeSense(measure) {
  if (!measure) return "—";
  if (measure.zipf != null) return `${formatZipf(measure.zipf)} (${measure.inSense} of ${measure.classified})`;
  if (measure.upperBound != null) return `< ${formatZipf(measure.upperBound)} (0 of ${measure.classified})`;
  return "—";
}

/** The app's access to the downloaded language data (injected into the engine). */
export function createLanguageData({ invoke, onProgress = null }) {
  const ready = new Map();
  return {
    async ensure(languageCode) {
      const code = dataLanguage(languageCode);
      if (!ready.has(code)) {
        ready.set(code, invoke("glossary_research_language_data", { language: code })
          .then((result) => ({ ...result, code }))
          .catch((error) => ({ code, available: false, error: String(error?.message ?? error) })));
      }
      return ready.get(code);
    },
    async zipf(languageCode, words) {
      if (!words.length) return [];
      return invoke("glossary_research_zipf", { language: dataLanguage(languageCode), words });
    },
    /** Each phrase counted as a whole in the general corpus: [{ phrase, hits, zipf }]. */
    async corpusZipf(languageCode, phrases) {
      if (!phrases.length) return [];
      return invoke("glossary_research_corpus_zipf", { language: dataLanguage(languageCode), phrases });
    },
    async sentences(languageCode, forms, limit, seed) {
      return invoke("glossary_research_general_sentences", {
        input: { language: dataLanguage(languageCode), forms, limit, seed },
      });
    },
    onProgress,
  };
}
