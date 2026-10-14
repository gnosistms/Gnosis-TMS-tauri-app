// Tiered dictionary lookup for Glossary Research.
//   1. A trusted dictionary for the language where we have one (Spanish: DLE).
//   2. Wiktionary (every language; CC BY-SA, attributed in the report).
//   3. AI web search limited to dictionary sites (done by the engine, since it
//      spends money).
// A dictionary that cannot be reached is "unreachable", never "no entry".
// When the DLE verifiably has no entry, that absence is reported and the
// lookup continues with the next tier.

export const DICTIONARY_DOMAINS = [
  "wiktionary.org", "rae.es", "merriam-webster.com", "dictionary.cambridge.org",
  "collinsdictionary.com", "oed.com", "larousse.fr", "cnrtl.fr", "dictionnaire-academie.fr",
  "duden.de", "dwds.de", "treccani.it", "priberam.org", "infopedia.pt", "dicio.com.br",
  "kotobank.jp", "weblio.jp", "jisho.org", "dict.naver.com", "zdic.net", "moedict.tw",
  "vdict.com", "tratu.soha.vn", "svenska.se", "saob.se", "ordnet.dk", "naob.no",
  "vandale.nl", "sjp.pwn.pl", "gramota.ru", "tdk.gov.tr", "fundeu.es", "wordreference.com",
];

function clean(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function stripHtml(html) {
  return clean(String(html ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'"));
}

/** Plain-text sense inventory for prompts (source text kept verbatim). */
export function dleText(articles) {
  const lines = [];
  articles.forEach((article, index) => {
    lines.push(`DLE article ${index + 1}: ${article.headword ?? ""}${article.etymology ? ` (${article.etymology})` : ""}`);
    for (const sense of article.senses) {
      const labels = sense.labels.map((label) => label.abbr).join(" ");
      let line = `  ${sense.number}. ${labels} ${sense.definition}`.trimEnd();
      if (sense.examples.length) line += ` Ej.: ${sense.examples.join(" | ")}`;
      if (sense.synonyms.length) line += ` Sin.: ${sense.synonyms.join(", ")}`;
      if (sense.antonyms.length) line += ` Ant.: ${sense.antonyms.join(", ")}`;
      lines.push(line);
    }
    for (const form of article.complexForms ?? []) {
      lines.push(`  Forma compleja: ${form.form}`);
      for (const sense of form.senses ?? []) {
        lines.push(`    ${sense.number}. ${sense.labels.map((label) => label.abbr).join(" ")} ${sense.definition}`);
      }
    }
  });
  return lines.join("\n");
}

async function lookUpDle(term, { invoke, log }) {
  const first = await invoke("glossary_research_fetch_dle", { path: term });
  if (first.neededPerson) log("The DLE asked for a human check; the page was shown to you.");
  if (first.status !== "found") return first;
  const articles = first.entry?.articles ?? [];
  for (const article of articles) {
    for (const form of (article.complexForms ?? []).slice(0, 10)) {
      if (!form.href) continue;
      const sub = await invoke("glossary_research_fetch_dle", { path: form.href });
      form.senses = sub.status === "found" && sub.entry?.kind === "complex" ? sub.entry.senses : [];
      form.retrieval = sub.status === "found" ? "found" : sub.status;
    }
  }
  return { ...first, articles };
}

async function lookUpWiktionary(term, languageCode, { fetchImpl }) {
  const url = `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(term)}`;
  let response;
  try {
    response = await fetchImpl(url, { headers: { Accept: "application/json" } });
  } catch (error) {
    return { status: "unreachable", url, message: error.message };
  }
  if (response.status === 404) return { status: "not_found", url };
  if (!response.ok) return { status: "unreachable", url, message: `HTTP ${response.status}` };
  const data = await response.json();
  // Wiktionary groups entries by base language: Chinese is "zh" for both
  // zh-Hans and zh-Hant.
  const baseCode = String(languageCode ?? "").split(/[-_]/)[0].toLowerCase();
  const sections = data[languageCode] ?? data[baseCode] ?? [];
  if (!sections.length) return { status: "not_found", url };
  let number = 0;
  const lines = [`Wiktionary (English edition, CC BY-SA 4.0): ${term}`];
  for (const section of sections) {
    lines.push(`  [${section.partOfSpeech}]`);
    for (const definition of section.definitions ?? []) {
      const text = stripHtml(definition.definition);
      if (!text) continue;
      number += 1;
      lines.push(`  ${number}. ${text}`);
    }
  }
  return {
    status: number ? "found" : "not_found",
    url: `https://en.wiktionary.org/wiki/${encodeURIComponent(term)}`,
    senseCount: number,
    text: lines.join("\n"),
  };
}

/** After the DLE page did not answer, it is not tried again for this long. */
const DLE_RETRY_MS = 30 * 60 * 1000;
const sharedDleState = { failedAt: 0 };

/**
 * The dictionary used by the engine. `languageCode` is the research (source)
 * language. Returns { status, sourceName, url, text, senseCount,
 * complexFormCount, tried[], notes[], articles? }.
 */
export function createDictionary({ languageCode, invoke, fetchImpl = globalThis.fetch, dleState = sharedDleState, now = () => Date.now() }) {
  return {
    async lookup(term, log = () => {}) {
      const tried = [];
      const notes = [];
      if (languageCode === "es") {
        tried.push("DLE (RAE/ASALE)");
        let dle;
        if (dleState.failedAt && now() - dleState.failedAt < DLE_RETRY_MS) {
          // Each attempt waits up to 25 s; one failure in a session is enough to know.
          dle = { status: "unreachable", message: "it did not answer a short while ago, so it is not tried again yet" };
        } else {
          try {
            dle = await lookUpDle(term, { invoke, log });
          } catch (error) {
            dle = { status: "unreachable", message: error.message };
          }
          dleState.failedAt = dle.status === "unreachable" ? now() : 0;
        }
        log(`DLE (the Spanish Academy's dictionary): ${{ found: "found", not_found: "no entry", unreachable: "could not be reached" }[dle.status] ?? dle.status}${dle.message ? ` — ${dle.message}` : ""}`);
        if (dle.status === "found") {
          const articles = dle.articles;
          return {
            status: "found", sourceName: "the Spanish Academy's dictionary (DLE)", url: dle.url,
            text: dleText(articles), articles, tried, notes,
            senseCount: articles.reduce((sum, a) => sum + a.senses.length, 0),
            complexFormCount: articles.reduce((sum, a) => sum + (a.complexForms?.length ?? 0), 0),
          };
        }
        notes.push(dle.status === "not_found"
          ? "The DLE has no entry for this word (verified)."
          : "The DLE could not be reached; this is not evidence that it has no entry.");
      }
      tried.push("Wiktionary");
      const wiki = await lookUpWiktionary(term, languageCode, { fetchImpl });
      log(`Wiktionary: ${{ found: "found", not_found: "no entry", unreachable: "could not be reached" }[wiki.status] ?? wiki.status}${wiki.message ? ` — ${wiki.message}` : ""}`);
      if (wiki.status === "found") {
        return { status: "found", sourceName: "Wiktionary (CC BY-SA 4.0)", url: wiki.url, text: wiki.text, senseCount: wiki.senseCount, complexFormCount: 0, tried, notes };
      }
      const anyReachable = wiki.status === "not_found" || notes.some((n) => n.includes("verified"));
      return { status: anyReachable ? "not_found" : "unreachable", sourceName: null, url: null, text: "", senseCount: 0, complexFormCount: 0, tried, notes };
    },
  };
}
