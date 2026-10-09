import test from "node:test";
import assert from "node:assert/strict";

import {
  codePointToUtf16Offset,
  contentNeighbours,
  createSamaelCorpus,
} from "./glossary-research-corpus.js";
import { createDictionary, dleText } from "./glossary-research-dictionary.js";

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test("code-point offsets from the search API become UTF-16 offsets", () => {
  const text = "𝔄 dijo: fatal.";
  const start = codePointToUtf16Offset(text, 8);
  assert.equal(text.slice(start, start + 5), "fatal");
});

test("Samael sample pages are mapped to passages with references", async () => {
  const text = "Fue un resultado fatal.";
  const fetchImpl = async (url) => {
    assert.match(url, /\/api\/sample\?/);
    return jsonResponse({
      corpus_version: "v", population_fingerprint: "p", eligibility: "e", has_more: false, returned: 1,
      items: [{ item_id: "abc", text, copy_count: 1,
        occurrences: [{ start: 17, end: 22, surface: "fatal" }],
        representative: { title: "Libro", chapter_title: "I", n: 4, reader_url: "/doc/book-1?line=9" },
        copies: [], context_before: ["antes"], context_after: [] }],
    });
  };
  const corpus = createSamaelCorpus({ baseUrl: "https://example.test", fetchImpl });
  const { items } = await corpus.sample(["fatal"], 1, "s");
  assert.equal(items[0].reference.url, "https://example.test/doc/book-1?line=9");
  assert.equal(items[0].text.slice(items[0].occurrences[0].start, items[0].occurrences[0].end), "fatal");
});

test("a site without the sampling API gives a clear message", async () => {
  const corpus = createSamaelCorpus({ baseUrl: "https://example.test", fetchImpl: async () => jsonResponse({}, 404) });
  await assert.rejects(corpus.population(["fatal"]), /does not offer research sampling yet/);
});

test("Spanish neighbour tables drop pure function-word pairs", () => {
  const kept = contentNeighbours([
    { phrase: "fatal de", occurrences: 51, paragraphs: 51 },
    { phrase: "rueda fatal", occurrences: 17, paragraphs: 17 },
    { phrase: "fatal del samsara", occurrences: 2, paragraphs: 2 },
  ], ["fatal"], "es");
  assert.deepEqual(kept.map((n) => n.phrase), ["rueda fatal", "fatal del samsara"]);
});

test("verified DLE absence is reported and the lookup continues to Wiktionary", async () => {
  const invoke = async () => ({ status: "not_found", url: "https://dle.rae.es/xyz", neededPerson: false });
  const fetchImpl = async () => jsonResponse({ es: [{ partOfSpeech: "Adjective", definitions: [{ definition: "<b>fatal</b>, deadly" }] }] });
  const result = await createDictionary({ languageCode: "es", invoke, fetchImpl, dleState: { failedAt: 0 } }).lookup("xyz");
  assert.equal(result.status, "found");
  assert.match(result.sourceName, /Wiktionary/);
  assert.deepEqual(result.notes, ["The DLE has no entry for this word (verified)."]);
  assert.match(result.text, /1\. fatal, deadly/);
});

test("an unreachable DLE is never reported as a missing entry", async () => {
  const invoke = async () => ({ status: "unreachable" });
  const fetchImpl = async () => { throw new Error("offline"); };
  const result = await createDictionary({ languageCode: "es", invoke, fetchImpl, dleState: { failedAt: 0 } }).lookup("fatal");
  assert.equal(result.status, "unreachable");
  assert.match(result.notes[0], /not evidence that it has no entry/);
});

test("DLE complex forms are read from their own pages", async () => {
  const calls = [];
  const invoke = async (_command, { path }) => {
    calls.push(path);
    if (path === "fatal") {
      return { status: "found", url: "https://dle.rae.es/fatal", entry: { kind: "articles", articles: [{
        headword: "fatal", etymology: "Del lat.", senses: [{ number: "1", labels: [{ abbr: "adj." }], definition: "inevitable.", examples: [], synonyms: ["forzoso"], antonyms: [] }],
        complexForms: [{ form: "mujer fatal", href: "/?id=Q1#2iT" }] }] } };
    }
    return { status: "found", entry: { kind: "complex", senses: [{ number: "1", labels: [{ abbr: "f." }], definition: "mujer seductora…", examples: [], synonyms: [], antonyms: [] }] } };
  };
  const result = await createDictionary({ languageCode: "es", invoke, fetchImpl: async () => jsonResponse({}), dleState: { failedAt: 0 } }).lookup("fatal");
  assert.deepEqual(calls, ["fatal", "/?id=Q1#2iT"]);
  assert.match(result.text, /Sin\.: forzoso/);
  assert.match(dleText(result.articles), /Forma compleja: mujer fatal\n {4}1\. f\. mujer seductora/);
});

test("Chinese research terms match inside text; Spanish ones only as whole words", async () => {
  const { buildOccurrences } = await import("./glossary-research-occurrences.js");
  const text = "這是存在層次的教義。存在就是存在。";
  const start = text.indexOf("存在層次");
  const occurrences = buildOccurrences(
    [{ itemId: "z", text, occurrences: [{ start, end: start + 2, surface: "存在" }] }],
    [{ id: "x", kind: "expression", sourceTerms: ["存在層次"], match: ["存在層次"], variants: [] },
      { id: "w", kind: "word", sourceTerms: ["存在"], variants: [] }],
    "o",
    "zh-Hant",
  );
  assert.equal(occurrences[0].entryId, "x");
  assert.equal(occurrences[0].marked, "存在層次");
  const spanish = buildOccurrences(
    [{ itemId: "s", text: "La ruedafatal y la rueda fatal.", occurrences: [{ start: 24, end: 29, surface: "fatal" }] }],
    [{ id: "x", kind: "expression", sourceTerms: ["rueda fatal"], match: ["rueda fatal"], variants: [] },
      { id: "w", kind: "word", sourceTerms: ["fatal"], variants: [] }],
    "o",
    "es",
  );
  assert.equal(spanish[0].entryId, "x");
});

test("Chinese dictionary lookups use Wiktionary's zh section", async () => {
  const fetchImpl = async () => jsonResponse({ zh: [{ partOfSpeech: "Verb", definitions: [{ definition: "to exist" }] }] });
  const result = await createDictionary({ languageCode: "zh-Hant", invoke: async () => ({}), fetchImpl }).lookup("存在");
  assert.equal(result.status, "found");
  assert.match(result.text, /to exist/);
});

test("after the DLE fails to answer, later lookups skip it for a while", async () => {
  let dleCalls = 0;
  const invoke = async () => { dleCalls += 1; return { status: "unreachable", message: "The DLE page did not show an entry in time." }; };
  const fetchImpl = async () => jsonResponse({});
  const dleState = { failedAt: 0 };
  let clock = 1_000_000;
  const dictionary = createDictionary({ languageCode: "es", invoke, fetchImpl, dleState, now: () => clock });
  await dictionary.lookup("uno");
  const second = await dictionary.lookup("dos");
  assert.equal(dleCalls, 1);
  assert.match(second.notes[0], /could not be reached/);
  clock += 31 * 60 * 1000;
  await dictionary.lookup("tres");
  assert.equal(dleCalls, 2, "it is tried again after a while");
});

test("citations next to the term: the server filters when it can, the app filters otherwise", async () => {
  const item = (text) => ({ item_id: text.slice(0, 6), text, copy_count: 1, occurrences: [{ start: 0, end: 5, surface: text.slice(0, 5) }],
    representative: { title: "EL FALSO SENTIMIENTO DEL YO", n: 1, year: 1977 }, copies: [], context_before: [], context_after: [] });
  const page = (filtered) => ({ require: filtered ? ["íntimo"] : undefined, items: [item("Dioses Atómicos dice: alabaron al Íntimo."), item("Dioses Atómicos desprecia el cuerpo astral.")] });
  const urls = [];
  const old = createSamaelCorpus({ baseUrl: "https://example.test", fetchImpl: async (url) => { urls.push(url); return jsonResponse(page(false)); } });
  const found = await old.authorCitations(["Dioses Atómicos"], ["íntimo"], "s");
  assert.match(urls[0], /require=%C3%ADntimo/);
  assert.equal(found.length, 1, "an older server: only the paragraph that also has the term");
  assert.equal(found[0].reference.year, 1977);
  const fresh = createSamaelCorpus({ baseUrl: "https://example.test", fetchImpl: async () => jsonResponse(page(true)) });
  assert.equal((await fresh.authorCitations(["Dioses Atómicos"], ["íntimo"], "s")).length, 2, "the server already filtered");
  const none = createSamaelCorpus({ baseUrl: "https://example.test", fetchImpl: async () => jsonResponse({}, 404) });
  assert.equal(await none.earliestUses(["íntimo"]), null, "no dates from a server without them; the study goes on");
});

test("pairs of the term with a book's original word, with their basis; an older site gives none", async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    return jsonResponse({ pairs: [
      { doc_id: "source-blavatsky_isis", book_id: "blavatsky_isis", title: "Isis sin velo — H. P. Blavatsky", original_language: "en",
        original_title: "Isis Unveiled", original_author: "H. P. Blavatsky", spanish_term: "Daimón", original_term: "demon", also: [],
        original_forms: ["demon", "daimonion"], renderings: [{ form: "demons", count: 83 }], original_count: 134, status: "equivalent_found", basis: "aligned_translation" },
      { doc_id: "source-dioses_atomicos", spanish_term: "Íntimo", original_term: "Innermost", basis: "printed_glossaries" },
      { doc_id: "source-x", spanish_term: "Nada", original_term: null, basis: "aligned_translation" },
    ] });
  };
  const corpus = createSamaelCorpus({ baseUrl: "https://example.test", fetchImpl });
  const pairs = await corpus.originalTerms(["daimón", "daimones"]);
  assert.match(urls[0], /\/api\/sample\/original-terms\?forms=daim%C3%B3n%2Cdaimones$/);
  assert.deepEqual(pairs.map((p) => [p.docId, p.source, p.original, p.basis]), [
    ["source-blavatsky_isis", "Daimón", "demon", "aligned"], ["source-dioses_atomicos", "Íntimo", "Innermost", "printed"],
  ]);
  assert.equal(pairs[0].originalCount, 134);
  assert.deepEqual(pairs[0].originalForms, ["demon", "daimonion"]);
  const old = createSamaelCorpus({ baseUrl: "https://example.test", fetchImpl: async () => jsonResponse({}, 404) });
  assert.equal(await old.originalTerms(["daimón"]), null);
});
