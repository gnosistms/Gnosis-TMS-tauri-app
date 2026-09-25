// Text sources for Glossary Research. Both adapters give the engine the same
// shape: every passage is { itemId, text, occurrences[{start,end,surface}],
// copyCount, reference, copies, contextBefore, contextAfter,
// existingTranslation }, with UTF-16 offsets.

export const SAMAEL_CORPUS_URL = "https://glosario.gnosis-tms.com";
const SAMAEL_OVERRIDE_KEY = "gnosis.research.samaelCorpusUrl";

/** Base URL of the Samael search API (a developer override is honoured). */
export function samaelCorpusUrl() {
  try {
    const override = globalThis.localStorage?.getItem(SAMAEL_OVERRIDE_KEY);
    if (override && /^https?:\/\//.test(override)) return override.replace(/\/$/, "");
  } catch {
    // storage unavailable: use the public site
  }
  return SAMAEL_CORPUS_URL;
}

/** Python code-point offsets → JavaScript UTF-16 offsets. */
export function codePointToUtf16Offset(text, codePointOffset) {
  let units = 0;
  let points = 0;
  for (const character of text) {
    if (points >= codePointOffset) break;
    units += character.length;
    points += 1;
  }
  return units;
}

// Function words are removed from neighbour tables for Spanish, the language
// of the Samael corpus; other languages keep every neighbour.
const SPANISH_FUNCTION_WORDS = new Set(`a al algo algún alguna algunas alguno algunos ante antes aquel aquella
aquellas aquello aquellos así aun aún cada como con contra cual cuales cuando de del desde donde dos el él ella
ellas ello ellos en entre era eran es esa esas ese eso esos esta está están estas este esto estos fue fueron ha
había han hasta hay la las le les lo los más me mi mis mucho muy ni no nos nuestra nuestro o os otra otras otro
otros para pero poco por porque que qué se sea ser si sí sin sino sobre son su sus también tan tanto te todo todos
tu tus un una unas uno unos y ya yo`.split(/\s+/));

export function contentNeighbours(neighbours, forms, languageCode) {
  const formSet = new Set(forms.map((form) => form.toLowerCase()));
  return neighbours.filter((neighbour) => {
    const extra = neighbour.phrase.split(" ").filter((word) => !formSet.has(word));
    if (!extra.length) return false;
    if (languageCode === "es" && extra.every((word) => SPANISH_FUNCTION_WORDS.has(word))) return false;
    return neighbour.occurrences >= 3 || extra.length >= 2;
  });
}

export function createSamaelCorpus({ baseUrl = samaelCorpusUrl(), fetchImpl = globalThis.fetch } = {}) {
  async function get(path, params) {
    const query = new URLSearchParams(params).toString();
    const url = `${baseUrl}${path}?${query}`;
    let lastError;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      let response;
      try {
        response = await fetchImpl(url, { headers: { Accept: "application/json" } });
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
        continue;
      }
      if (response.status === 503) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
        continue;
      }
      if (response.status === 404 && path.startsWith("/api/sample")) {
        throw new Error("The Samael Aun Weor search site does not offer research sampling yet.");
      }
      if (!response.ok) throw new Error(`The Samael Aun Weor search site returned HTTP ${response.status}.`);
      return response.json();
    }
    throw new Error(`The Samael Aun Weor search site could not be reached${lastError ? `: ${lastError.message}` : "."}`);
  }

  function toPassage(raw) {
    const representative = raw.representative ?? raw.copies?.[0] ?? {};
    return {
      itemId: raw.item_id,
      text: raw.text,
      occurrences: raw.occurrences.map((o) => {
        const start = codePointToUtf16Offset(raw.text, o.start);
        const end = codePointToUtf16Offset(raw.text, o.end);
        return { start, end, surface: raw.text.slice(start, end) };
      }),
      copyCount: raw.copy_count ?? 1,
      reference: {
        title: representative.title,
        chapter: representative.chapter_title ?? "",
        paragraph: representative.n,
        url: representative.reader_url ? `${baseUrl}${representative.reader_url}` : null,
      },
      copies: (raw.copies ?? []).map((copy) => ({
        title: copy.title, chapter: copy.chapter_title ?? "", paragraph: copy.n,
        url: copy.reader_url ? `${baseUrl}${copy.reader_url}` : null,
      })),
      contextBefore: raw.context_before ?? [],
      contextAfter: raw.context_after ?? [],
      contextsDiffer: raw.contexts_differ === true,
      existingTranslation: null,
    };
  }

  return {
    description: "the complete works of Samael Aun Weor (Spanish books and lectures)",
    sourceLabel: "Complete works of Samael Aun Weor",
    async formsHint(term) {
      const word = term.trim().split(/\s+/).length === 1 ? term.trim() : null;
      if (!word) return null;
      const result = await get("/api/sample/forms", { q: word, kind: "samael" });
      return { forms: result.forms, related: result.related_forms ?? [] };
    },
    async countForm(form) {
      const result = await get("/api/sample", { forms: form, n: 2, seed: "forms", kind: "samael", context: 0 });
      return {
        rows: result.population_distinct,
        examples: result.items.map(toPassage).map((p) => ({ text: p.text, start: p.occurrences[0]?.start ?? 0, end: p.occurrences[0]?.end ?? 0 })),
      };
    },
    async population(forms) {
      const result = await get("/api/sample", { forms: forms.join(","), n: 0, kind: "samael" });
      return { rows: result.population_rows, distinct: result.population_distinct, duplicateGroups: result.duplicate_groups };
    },
    async sample(forms, n, seed) {
      const items = [];
      let meta = null;
      let offset = 0;
      while (items.length < n) {
        const page = await get("/api/sample", {
          forms: forms.join(","), n: Math.min(1000, n - items.length), seed, offset,
          kind: "samael", context: 1, context_chars: 600,
        });
        meta = { corpusVersion: page.corpus_version, populationFingerprint: page.population_fingerprint, eligibility: page.eligibility, seed };
        items.push(...page.items.map(toPassage));
        offset += page.returned;
        if (!page.has_more || !page.returned) break;
      }
      return { meta, items };
    },
    async collocations(forms) {
      const result = await get("/api/sample/collocations", { forms: forms.join(","), kind: "samael", min_count: 2 });
      return contentNeighbours(result.collocations ?? [], forms, "es").slice(0, 60);
    },
    authorName: "Samael Aun Weor",
    /** The reference books the author read, with what is known of their originals. */
    async sourceBooks() {
      try {
        const result = await get("/api/sample/source-books", {});
        return (result.books ?? []).map((book) => ({
          title: book.title,
          translated: book.translated === true,
          originalLanguage: book.original_language ?? null,
          originalTitle: book.original_title ?? null,
          originalAuthor: book.original_author ?? null,
          originalFirstPrinting: book.original_first_printing ?? null,
          firstSpanishTranslation: book.first_spanish_translation ?? null,
          headwordPairs: book.headword_pairs ?? [],
        }));
      } catch {
        return []; // an older site without book records: the study works from the passages alone
      }
    },
    /** Every passage of the reference books that uses the forms, in seeded random order. */
    async sourceUsage(forms, seed) {
      const result = await get("/api/sample", { forms: forms.join(","), n: 2000, seed, kind: "source", context: 0 });
      return result.items.map(toPassage);
    },
    /** A seeded random sample of the author's passages containing a phrase (e.g. a book title). */
    async authorMentions(phrase, seed, n = 8) {
      const result = await get("/api/sample", { forms: phrase, n, seed, kind: "samael", context: 0 });
      return result.items.map(toPassage);
    },
  };
}

export function createProjectsCorpus({ invoke, installationId, projects, languageCode, targetLanguageCode }) {
  const projectIds = projects.map((project) => project.id);
  let refreshed = false;
  async function passages(forms, mode, n = 0, seed = "") {
    const response = await invoke("glossary_research_project_passages", {
      input: {
        installationId, projectIds, languageCode, targetLanguageCode,
        forms, mode, n, seed, refreshIndex: !refreshed,
      },
    });
    refreshed = true;
    if (!response.matchingChapterCount) {
      const error = new Error("None of the files in the selected projects contain the glossary's source language.");
      error.kind = "no-texts";
      throw error;
    }
    return response;
  }
  const toPassage = (raw) => {
    const first = raw.copies[0] ?? {};
    return {
      itemId: raw.itemId, text: raw.text, occurrences: raw.occurrences, copyCount: raw.copyCount,
      reference: { title: first.projectTitle, chapter: first.chapterTitle, paragraph: null, url: null,
        projectId: first.projectId, chapterId: first.chapterId, rowId: first.rowId },
      copies: raw.copies.map((copy) => ({ title: copy.projectTitle, chapter: copy.chapterTitle, projectId: copy.projectId, chapterId: copy.chapterId, rowId: copy.rowId })),
      contextBefore: raw.contextBefore, contextAfter: raw.contextAfter,
      existingTranslation: raw.existingTranslation ?? null,
    };
  };
  return {
    description: `the team's projects: ${projects.map((project) => project.title).join(", ")}`,
    sourceLabel: projects.map((project) => project.title).join(", "),
    formsHint: null,
    async countForm(form) {
      const response = await passages([form], "count");
      return { rows: response.distinct, examples: response.items.map(toPassage).map((p) => ({ text: p.text, start: p.occurrences[0]?.start ?? 0, end: p.occurrences[0]?.end ?? 0 })) };
    },
    async population(forms) {
      const response = await passages(forms, "count");
      return { rows: response.rows, distinct: response.distinct, duplicateGroups: response.duplicateGroups };
    },
    async sample(forms, n, seed) {
      const response = await passages(forms, "sample", n, seed);
      return { meta: { seed, projects: projectIds }, items: response.items.map(toPassage) };
    },
    async collocations(forms) {
      const response = await passages(forms, "neighbours");
      return contentNeighbours(response.neighbours, forms, languageCode).slice(0, 60);
    },
  };
}
