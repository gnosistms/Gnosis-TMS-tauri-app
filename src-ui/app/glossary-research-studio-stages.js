import { STUDIO_USAGE_NOTE_POLICY, usageNoteResearch } from "./glossary-research-studio-notes.js";
import { exploratoryContext, rankRecoveryParagraphs } from "./glossary-research-studio-sampling.js";
import { studioStageActivities } from "./glossary-research-studio-activity.js";
import { activeMeanings, selectedForms, uniqueTexts, exactOccurrences, deduplicatePassages,
  researchSample, shuffled, validateAssignments, applySplitReview, rankResearchFormEvidence,
  sourceFormKey, uniqueSourceTexts, deduplicateSourceForms, reviewCompoundReport, stableSignature, studioToolSignature, STUDIO_DICTIONARY_REVIEW_VERSION } from "./glossary-research-studio-workflow.js";

const array = (value, label) => {
  if (!Array.isArray(value)) throw new Error(`${label} was incomplete. Retry this operation.`);
  return value;
};
const branch = (tools, id) => tools.forActivity?.(id) ?? tools;
const params = (forms, kind = "samael") => ({ forms: forms.join(","), kind, mode: "exact", seed: "1" });

const decisionMeanings = (meanings) => meanings.map(({ id, definition, grammar }) => ({ id, definition, grammar }));
function decisionParagraphs(passages, study = {}) {
  return passages.map((p) => ({ id: p.id, text: p.text, occurrences: p.occurrences,
    ...exploratoryContext(study, p), reference: { title: p.reference?.title ?? p.reference?.projectTitle, chapter: p.reference?.chapter_title ?? p.reference?.chapterTitle } }));
}

function annotatedParagraphs(s, assignments, selected = s.passages) {
  const byParagraph = new Map();
  for (const a of assignments) { const members = byParagraph.get(a.paragraphId) ?? new Map(); members.set(a.occurrenceId, a); byParagraph.set(a.paragraphId, members); }
  return decisionParagraphs(selected.filter((p) => byParagraph.has(p.id)), s).map((p) => ({ ...p,
    occurrences: p.occurrences.filter((o) => byParagraph.get(p.id).has(o.id)).map((o) => {
      const a = byParagraph.get(p.id).get(o.id); return { ...o, meaningId: a.meaningId, ...(a.preserveSourceSpelling ? { preserveSourceSpelling: true } : {}) };
    }) }));
}

function candidateExampleView(s, meanings) {
  const assignments = s.assignments.filter((a) => !a.entryId || a.entryId === "original");
  const all = new Map(s.passages.map((p) => [p.id, p])); const chosen = new Set(); const samples = [];
  for (const [index, meaning] of meanings.entries()) {
    const members = assignments.filter((a) => a.meaningId === meaning.id);
    const pool = shuffled([...new Set(members.map((a) => a.paragraphId))].map((id) => all.get(id)).filter(Boolean), s.scope.seed + index);
    const picked = []; const docs = new Set();
    const add = (p) => { if (!p || picked.includes(p) || picked.length >= 8) return; picked.push(p); docs.add(p.reference?.doc_id ?? p.reference?.docId ?? p.reference?.title); };
    const anchors = (Array.isArray(meaning.evidence) ? meaning.evidence : []).map((e) => typeof e === "string" ? e : e.id ?? e.paragraphId)
      .map((id) => pool.find((p) => p.id === id)).filter(Boolean);
    anchors.slice(0, 2).forEach(add);
    const hasForm = (p, form) => p.occurrences.some((o) => sourceFormKey(o.surface ?? p.text.slice(o.start, o.end), s.scope.sourceLanguage.code) === sourceFormKey(form, s.scope.sourceLanguage.code)
      && members.some((a) => a.paragraphId === p.id && a.occurrenceId === o.id));
    for (const form of selectedForms(s)) if (!picked.some((p) => hasForm(p, form))) add(pool.find((p) => hasForm(p, form)));
    anchors.forEach(add);
    for (const p of pool) if (!docs.has(p.reference?.doc_id ?? p.reference?.docId ?? p.reference?.title)) add(p);
    pool.forEach(add); picked.forEach((p) => chosen.add(p.id));
    samples.push({ meaningId: meaning.id, totalOccurrences: members.length, totalParagraphs: pool.length, paragraphIds: picked.map((p) => p.id) });
  }
  return { samples, paragraphs: annotatedParagraphs(s, assignments, s.passages.filter((p) => chosen.has(p.id))) };
}

function candidateSourceReports(s) {
  const consolidated = s.steps["4.4.4"]?.approved ?? s.steps["4.4.4"]?.value;
  const ids = consolidated && !consolidated.skipped ? ["4.1", "4.4.4"] : ["4.1", "4.4.1", "4.4.2"];
  return ids.map((step) => s.steps[step]?.approved ?? s.steps[step]?.value).filter((r) => r && !r.skipped).map((r) => ({
    summary: r.summary ?? "", originals: (r.meanings ?? []).filter((m) => m.originalTerm).map(({ originalTerm, author, definition, evidence }) => ({ originalTerm, author, definition, evidence })),
    references: uniqueTexts((r.meanings ?? []).flatMap((m) => (Array.isArray(m.evidence) ? m.evidence : []).map((e) => e?.url)).filter(Boolean)),
  }));
}

function corpusParagraphs(s, data, forms) {
  return deduplicatePassages(array(data.items, "Corpus results").map((p) => ({ ...p,
    reference: p.reference ?? p.representative, references: p.copies ?? p.references,
    contextBefore: p.contextBefore ?? p.context_before, contextAfter: p.contextAfter ?? p.context_after,
  })), forms, s.scope.sourceLanguage.code);
}

async function boundedResearchSample(s, tools, forms) {
  const seed = String(s.scope.seed ?? 1);
  const data = await tools.run("corpus", { path: "/api/sample", params: { ...params(forms), seed, n: "100", offset: "0" }, researchSamplingVersion: 2 }, "Selecting 100 seeded corpus paragraphs");
  if (!Number.isInteger(data.population_distinct) || data.population_distinct < 0
    || typeof data.population_fingerprint !== "string" || typeof data.has_more !== "boolean") throw new Error("The corpus returned incomplete sampling metadata.");
  const pool = corpusParagraphs(s, data, forms);
  let sample = researchSample(pool, forms, s.scope.seed, 100, s.scope.sourceLanguage.code);
  for (const form of sample.missing) {
    const witness = await tools.run("corpus", { path: "/api/sample", params: { ...params([form]), seed, n: "1", offset: "0" }, researchSamplingVersion: 2 }, `Ensuring sample coverage of ${form}`);
    pool.push(...corpusParagraphs(s, witness, forms));
  }
  sample = researchSample(pool, forms, s.scope.seed, 100, s.scope.sourceLanguage.code);
  if (!sample.passages.length) throw new Error("No exact matches were found. Go Back and edit the term, forms, or corpus.");
  s.population = pool; s.populationCount = data.population_distinct; s.populationFingerprint = data.population_fingerprint;
  s.sampling = { version: 2, seed, fingerprint: data.population_fingerprint, offset: data.items.length, hasMore: data.has_more, recoveryReady: false };
  s.passages = sample.passages;
  return sample;
}

async function prepareRecoveryPopulation(s, tools) {
  await tools.evidence?.("population");
  if (s.sampling.recoveryReady) return;
  const selected = new Set(s.passages.map((p) => p.id));
  const pool = new Map((s.population ?? []).map((p) => [p.id, p]));
  const additional = () => [...pool.keys()].filter((id) => !selected.has(id)).length;
  while (additional() < 500 && s.sampling.hasMore) {
    const data = await tools.run("corpus", { path: "/api/sample", params: { ...params(selectedForms(s)), seed: s.sampling.seed,
      n: String(500 - additional()), offset: String(s.sampling.offset) }, researchSamplingVersion: 2, researchCorpusVersion: s.sampling.fingerprint }, "Retrieving additional paragraphs for missing meanings");
    if (data.population_fingerprint !== s.sampling.fingerprint || typeof data.has_more !== "boolean"
      || (!data.items?.length && data.has_more)) throw new Error("The corpus changed or returned incomplete recovery evidence. Restart sampling before continuing.");
    for (const paragraph of corpusParagraphs(s, data, selectedForms(s))) pool.set(paragraph.id, paragraph);
    s.sampling.offset += data.items.length; s.sampling.hasMore = data.has_more;
    s.population = [...pool.values()];
  }
  s.population = [...pool.values()]; s.sampling.recoveryReady = true;
}

// Identity review needs the candidate spelling and its relationship to the query,
// not repeated per-book frequency tables. Retain every candidate and every distinct
// query relationship; raw search receipts remain in the study cache.
function formIdentityEvidence(evidence, language) {
  const candidates = new Map();
  for (const row of evidence) for (const candidate of row.recall?.candidates ?? []) {
    const key = sourceFormKey(candidate.form, language);
    const item = candidates.get(key) ?? { form: candidate.form, relationships: [], witnesses: [] };
    const { books: _books, examples = [], ...relationship } = candidate;
    const relation = { query: row.form, ...relationship };
    item.relationships.push(relation);
    for (const witness of examples) if (!item.witnesses.some((old) => stableSignature(old) === stableSignature(witness))) item.witnesses.push(witness);
    candidates.set(key, item);
  }
  return { candidates: [...candidates.values()],
    exactWitnesses: evidence.map(({ recall: _recall, ...row }) => row) };
}

function dictionaryLexemeExamples(s, forms) {
  const examples = [];
  for (const form of forms) {
    const paragraph = s.passages.find((p) => exactOccurrences(p.text, [form], s.scope.sourceLanguage.code).length);
    if (paragraph && !examples.some((p) => p.id === paragraph.id)) examples.push(paragraph);
    if (examples.length === 6) break;
  }
  return examples.length ? examples : s.passages.slice(0, 3);
}

function corpusMeaningEvidence(s, forms) {
  const paragraphs = new Map(); const groups = [];
  for (const form of forms) {
    const pool = shuffled(s.passages.filter((p) => exactOccurrences(p.text, [form], s.scope.sourceLanguage.code).length), s.scope.seed);
    const selected = []; const documents = new Set();
    // Spread examples over documents before taking a second from a document.
    for (const diverse of [true, false]) for (const p of pool) {
      if (selected.length === 8) break;
      const document = p.reference?.doc_id ?? p.reference?.docId ?? p.reference?.title ?? p.reference?.projectTitle;
      if (selected.includes(p.id) || (diverse && documents.has(document))) continue;
      selected.push(p.id); documents.add(document);
      paragraphs.set(p.id, { id: p.id, text: p.text, reference: p.reference ?? p.references?.[0] });
    }
    groups.push({ form, paragraphIds: selected });
  }
  return { forms: groups, paragraphs: [...paragraphs.values()], sampleParagraphs: s.passages.length,
    scope: "Up to eight complete exact paragraphs per form, spread over source documents; shared paragraphs occur once. A bounded discovery sample cannot establish absence from the corpus. Full assignment and missing-meaning recovery follow later." };
}

export async function acquirePopulation(s, tools, forms = selectedForms(s)) {
  const data = s.scope.corpus === "samael"
    ? await tools.run("corpus", { path: "/api/sample", params: params(forms), all: true }, "Finding all exact corpus matches")
    : await tools.run("projects", { projectIds: s.scope.projectIds, language: s.scope.sourceLanguage.code }, "Reading selected project texts");
  if (s.step === "3") s.populationFingerprint = data.populationFingerprint ?? null;
  return corpusParagraphs(s, data, forms);
}

async function topEvidence(s, tools, form, limit = 15, fuzzy = false) {
  if (s.scope.corpus !== "samael") {
    if (fuzzy) {
      const data = await tools.run("projects", { projectIds: s.scope.projectIds, language: s.scope.sourceLanguage.code }, "Finding approximate project witnesses");
      return rankResearchFormEvidence(array(data.items, "Project evidence"), form, s.scope.sourceLanguage.code).slice(0, limit);
    }
    const population = await acquirePopulation(s, tools, fuzzy ? uniqueTexts([form, ...selectedForms(s)]) : [form]);
    return population.slice(0, limit);
  }
  const data = await tools.run("corpus", { path: "/api/search", params: { q: form,
    kind: "samael", mode: fuzzy ? "lemma" : "exact" } }, `Reading usage of ${form}`);
  const rows = [];
  function collect(value, ref) {
    if (!value || typeof value !== "object") return;
    const html = value.full_html ?? value.html;
    const text = value.text ?? (typeof html === "string" ? html.replace(/<[^>]*>/gu, "")
      .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/gu, (entity) => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " })[entity]) : null);
    if (typeof text === "string" && (fuzzy || exactOccurrences(text, [form], s.scope.sourceLanguage.code).length)) {
      rows.push({ id: String(value.line_id ?? rows.length), text, reference: ref });
      return;
    }
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) child.forEach((v) => collect(v, ref));
      else if (child && typeof child === "object") collect(child, ref);
    }
  }
  for (const doc of data.docs ?? []) collect(doc.excerpts, { docId: doc.doc_id, title: doc.title });
  return rows.slice(0, limit);
}

async function dictionary(s, tools, term, language = s.scope.sourceLanguage.code) {
  language = String(language).toLowerCase().split(/[-_]/u)[0];
  let primary = null;
  if (language === "es") {
    primary = await tools.run("dle", { path: term }, `Looking up ${term} in DLE`);
    if (primary.status === "found") return primary;
  }
  const native = await tools.run("dictionary", { term, language }, `Looking up ${term} in Wiktionary`);
  const lowercase = term.toLocaleLowerCase(language);
  const caseVariants = lowercase === term ? [] : [await tools.run("dictionary", { term: lowercase, language }, `Checking the lowercase dictionary entry for ${lowercase}`)];
  if ([native, ...caseVariants].some((entry) => entry.status === "found")) return { primary, native, caseVariants };
  const englishChecked = language === "en" || native.edition === "en";
  const englishEdition = englishChecked ? null : await tools.run("dictionary", { term, language: "en" }, `Checking the English Wiktionary edition for ${term}`);
  const englishCaseVariants = englishChecked || lowercase === term ? [] : [await tools.run("dictionary", { term: lowercase, language: "en" }, `Checking the lowercase English dictionary entry for ${lowercase}`)];
  const fallback = [englishEdition, ...englishCaseVariants].some((entry) => entry?.status === "found") ? null : await tools.run("web", {
    query: `${term} ${language} dictionary definition etymology`,
  }, `Finding a dictionary source for ${term}`);
  return { primary, native, caseVariants, englishEdition, englishCaseVariants, fallback };
}

// The published index owns reference verification. Research needs its compact
// counts/status, not the complete, unchanged witness ledger for every author.
function referenceSummary(author) {
  const { witnesses: _witnesses, judgments: _judgments, ...summary } = author;
  return summary;
}

function validReferenceSummary(a) {
  return a?.schema_version === 2 && typeof a.author_id === "string" && a.author_id
    && typeof a.fingerprint === "string" && a.fingerprint && ["verified", "reviewed"].includes(a.review_status)
    && a.pending_witnesses === 0 && a.count_unit === "distinct_paragraph_texts"
    && ["confirmed_paragraphs", "confirmed_copies", "confirmed_occurrences", "unresolved_witnesses"].every((key) => Number.isInteger(a[key]) && a[key] >= 0)
    && a.verified_mentions === (a.unresolved_witnesses ? null : a.confirmed_paragraphs);
}

function referenceSnapshot(books) {
  return { state: books.author_references, books: books.books, authors: books.authors?.map(referenceSummary) };
}

function bibliographySample(group, seed, limit = 3) {
  const documents = new Set(group.books.map((book) => book.doc_id));
  const paragraphs = shuffled(group.passages, seed).map((p) => {
    const references = (p.copies ?? p.references ?? [p.representative]).filter((ref) => documents.has(ref?.doc_id));
    return { id: p.item_id, text: p.text, reference: references[0], references };
  });
  const cues = /significa|se denomina|se llama|se entiende|defin|tamomaya|t[âáa]masa|contrapart|antag[oó]nic|sabidur[ií]a|inconsciente/giu;
  const score = (p) => (/^\*?[^\n]{1,100}\([^)]{1,35}\)\s*[–—-]/u.test(p.text) ? 100 : 0)
    + Math.min(10, [...p.text.matchAll(cues)].length);
  paragraphs.sort((a, b) => score(b) - score(a));
  const selected = []; const covered = new Set();
  for (const diverse of [true, false]) for (const p of paragraphs) {
    if (selected.length >= limit) break;
    const doc = p.reference?.doc_id;
    if (selected.includes(p) || (diverse && covered.has(doc))) continue;
    selected.push(p); covered.add(doc);
  }
  return selected;
}

function bibliographyOriginals(originals) {
  const rows = new Map();
  for (const row of originals.pairs ?? []) {
    const { spanish_forms: forms = [], spanish_term: term, term_id: _termId, ...rest } = row;
    const key = stableSignature(rest); const old = rows.get(key);
    rows.set(key, { ...rest, spanish_forms: uniqueTexts([...(old?.spanish_forms ?? []), ...forms, ...(term ? [term] : [])]) });
  }
  return { bases: originals.bases, pairs: [...rows.values()] };
}

// Preserve complete selected paragraphs, but do not repeat copies, neighboring
// context or the author ledger in every comparison prompt. Raw receipts stay local.
function bibliographyBatches(authors, originals, corpusExamples, sourceMeanings) {
  const base = { originals: bibliographyOriginals(originals), corpusExamples, sourceMeanings };
  const size = (rows) => JSON.stringify({ ...base, authors: rows }).length;
  const pieces = [];
  for (const author of authors) {
    const { mentionEvidence: a, passages } = author;
    const metadata = { author: author.author, books: author.books.map(({ doc_id, title, original_language, original_first_printing, first_spanish_translation, original_access }) =>
      ({ doc_id, title, original_language, original_first_printing, first_spanish_translation, original_access })),
      verifiedMentions: author.verifiedMentions, termCounts: author.termCounts,
      mentionAudit: { confirmedParagraphs: a.confirmed_paragraphs, unresolved: a.unresolved_witnesses, reviewStatus: a.review_status },
      sampleParagraphs: passages.length, matchingParagraphs: author.matchingParagraphs };
    let piece = { ...metadata, passages: [] };
    for (const paragraph of passages) {
      if (piece.passages.length && size([{ ...piece, passages: [...piece.passages, paragraph] }]) > 300000) {
        pieces.push(piece); piece = { ...metadata, passages: [] };
      }
      piece.passages.push({ id: paragraph.id, text: paragraph.text, reference: paragraph.reference });
    }
    pieces.push(piece);
  }
  const batches = []; let batch = [];
  for (const piece of pieces) {
    if (batch.length && size([...batch, piece]) > 300000) { batches.push({ ...base, authors: batch }); batch = []; }
    batch.push(piece);
  }
  if (batch.length || !batches.length) batches.push({ ...base, authors: batch });
  return batches;
}

function attachBibliographyCitations(findings, authors, corpus) {
  const citations = new Map([...authors.flatMap((a) => a.passages), ...corpus].map((p) => [p.id, p.reference]));
  return { ...findings, meanings: (findings.meanings ?? []).map((meaning) => ({ ...meaning,
    evidence: (meaning.evidence ?? []).map((item) => {
      if (!item?.id) return item;
      if (!citations.has(item.id)) throw new Error("A source finding cited an unknown paragraph. Review the bibliography comparison before continuing.");
      return { ...item, reference: citations.get(item.id) };
    }) })) };
}

function normalizeMeanings(meanings, prefix) {
  return array(meanings, "Definitions").map((m, i) => {
    if (!m.definition?.trim()) throw new Error("A proposed meaning has no definition.");
    return { ...m, id: m.id || `${prefix}-${i}`, enabled: true };
  });
}

export async function runResearchStage(s, tools, entries) {
  tools.planActivity?.(studioStageActivities(s));
  const ask = tools.ask;
  const term = s.scope.term;
  const forms = selectedForms(s);
  switch (s.step) {
    case "2a": {
      const language = s.scope.sourceLanguage.code;
      const key = (text) => sourceFormKey(text, language);
      const humanSelections = new Map(s.forms.flatMap((form) => {
        const explicit = typeof form.selectionOverride === "boolean";
        const legacy = s.formDiscovery?.phase === "complete" && typeof form.selected === "boolean"
          && Number.isInteger(form.paragraphCount) && form.selected !== (form.paragraphCount > 0);
        return explicit || legacy ? [[key(form.text), explicit ? form.selectionOverride : form.selected]] : [];
      }));
      const selection = (text, fallback) => humanSelections.has(key(text))
        ? { selected: humanSelections.get(key(text)), selectionOverride: humanSelections.get(key(text)) }
        : { selected: fallback };
      const known = uniqueSourceTexts([term, ...s.scope.forms], language);
      s.formDiscovery = { phase: "discovering", version: 3 };
      s.origin = null;
      s.forms = known.map((text) => ({ text, ...selection(text, true),
        discoveryStatus: "Entered by you · Waiting for corpus check" }));
      await tools.checkpoint?.("Looking for additional forms and spellings");
      const proposal = await branch(tools, "discover").ask("List genuine source-language inflections and spelling alternatives of this word. Identify a likely borrowed origin language if known, using its ISO language code, and the verified original term. Distinguish lexical borrowing from historical inheritance: set originLanguage and originTerm to null for ordinary inherited vocabulary. Reserve origin searches for genuine borrowings whose original spelling matters to this research. Do not merge derivatives or unrelated homographs.",
        { term, userForms: s.scope.forms }, '{"forms":["source form"],"originLanguage":null,"originTerm":null}', "Looking for additional forms and spellings");
      const proposed = uniqueSourceTexts([...known, ...array(proposal.forms, "Forms")], language);
      for (const text of proposed) if (!s.forms.some((f) => key(f.text) === key(text))) s.forms.push({ text, ...selection(text, true),
        discoveryStatus: "Suggested by AI · Waiting for corpus check" });
      s.origin = { proposal, evidence: null };
      s.formDiscovery.phase = "checking";
      await tools.checkpoint?.(`Found ${proposed.length} forms to check in the corpus`);
      branch(tools, "discover").finishActivity?.(`${proposed.length} forms proposed: ${proposed.join(", ")}.`);
      const formWork = branch(tools, "forms");
      formWork.planActivity?.(proposed.map((text) => ({ id: key(text), label: text })));
      const originWork = branch(tools, "origin");
      let origin = null;
      if (proposal.originLanguage) {
        originWork.planActivity?.([
          { id: "proposal", label: "Identify the possible origin and spelling" },
          { id: "search", label: "Search cited dictionary and book sources" },
          { id: "findings", label: "Record original-spelling findings" },
        ]);
        branch(originWork, "proposal").finishActivity?.(`Possible origin language: ${proposal.originLanguage}. Proposed original spelling: ${proposal.originTerm || "not established yet"}.`);
      } else originWork.finishActivity?.("No borrowed origin identified; no original-spelling search needed.");
      let evidence = [];
      const discovered = new Map(proposed.map((text) => [key(text), text]));
      const attested = new Map();
      let projectTexts; let projectWork;
      // Share failure state across both research branches and their form pools.
      // Drain in-flight work before returning, so retries cannot race old jobs.
      let failed = false; let failure;
      function assertActive() {
        tools.assertCurrent?.();
        if (failed) throw failure;
      }
      async function parallel(items, action) {
        let next = 0;
        const results = new Array(items.length);
        await Promise.allSettled(Array.from({ length: Math.min(2, items.length) }, async () => {
          try {
            while (!failed && next < items.length) {
              assertActive();
              const index = next++;
              results[index] = await action(items[index], index);
            }
          } catch (error) { if (!failed) { failed = true; failure = error; } }
        }));
        if (failed) {
          // A sibling may have started more recently than the failed request.
          if (failure?.studioToolSignature) s.lastToolSignature = failure.studioToolSignature;
          throw failure;
        }
        return results;
      }
      async function attest(form, work = branch(formWork, key(form))) {
        assertActive();
        if (attested.has(key(form))) return attested.get(key(form));
        let examples; let paragraphCount;
        try {
          if (s.scope.corpus === "samael") {
            // Search resolves glossary aliases even in exact mode. Sampling accepts
            // literal forms and supplies counts over the complete corpus population.
            const data = await work.run("corpus", { path: "/api/sample", params: {
              ...params([form]), n: "3", context: "0" } }, `Checking exact matches for ${form}`);
            paragraphCount = data.population_distinct;
            examples = deduplicatePassages(array(data.items, "Exact form witnesses").map((p) => ({ ...p,
              reference: p.representative, references: p.copies })), [form], language);
            if (!Number.isInteger(paragraphCount) || paragraphCount < 0
              || (paragraphCount > 0 && !examples.length) || (paragraphCount === 0 && examples.length)) {
              throw new Error(`The exact corpus check for ${form} was incomplete. Retry the search.`);
            }
          } else {
            // Every form uses the same project snapshot. Share its in-flight read:
            // the native registry coalesces equal requests into one consumable job.
            if (!projectTexts) {
              projectWork = work;
              projectTexts = work.run("projects", { projectIds: s.scope.projectIds, language: s.scope.sourceLanguage.code }, "Reading selected project texts");
            }
            const population = corpusParagraphs(s, await projectTexts, [form]);
            paragraphCount = population.length; examples = population.slice(0, 3);
          }
        } catch (error) {
          // Validation can fail after a successful tool call, while a sibling has
          // changed the study-wide last request. Retry this form's own receipt.
          if (error && typeof error === "object" && !error.studioToolSignature) {
            error.studioToolSignature = (s.scope.corpus === "samael" ? work : projectWork)?.lastToolSignature;
          }
          throw error;
        }
        assertActive();
        const result = { form, paragraphCount, examples };
        attested.set(key(form), result);
        const row = s.forms.find((f) => key(f.text) === key(form));
        if (row) Object.assign(row, { paragraphCount, found: paragraphCount > 0,
          discoveryStatus: `${paragraphCount.toLocaleString()} matching ${paragraphCount === 1 ? "paragraph" : "paragraphs"} · Awaiting identity review` });
        work.finishActivity?.(`${paragraphCount.toLocaleString()} exact matching paragraphs.`);
        return result;
      }
      let originComplete = !proposal.originLanguage;
      await parallel([
        async () => {
          evidence = await parallel(proposed, async (form, index) => {
            const row = s.forms.find((f) => key(f.text) === key(form));
            row.discoveryStatus = "Searching corpus evidence…";
            await tools.checkpoint?.(`Checking ${form} (${index + 1} of ${proposed.length})`);
            assertActive();
            let recall = null;
            if (s.scope.corpus === "samael") {
              recall = await branch(formWork, key(form)).run("corpus", { path: "/api/search/forms", params: { q: form, kind: "samael" } }, `Discovering alternative spellings of ${form}`);
              assertActive();
              await tools.checkpoint?.(`Reading corpus examples for ${form}`);
            }
            const checked = { ...await attest(form), recall };
            await tools.checkpoint?.(`Corpus evidence received for ${form}`);
            return checked;
          });
          // Use proposal order, not completion order, for evidence and AI input.
          for (const { recall } of evidence) for (const candidate of recall?.candidates ?? []) {
            if (typeof candidate.form === "string" && !discovered.has(key(candidate.form))) discovered.set(key(candidate.form), candidate.form);
          }
          s.formDiscovery.corpusResults = evidence.map(({ form, paragraphCount }) => ({ text: form, paragraphCount }));
          formWork.finishActivity?.(`${proposed.length} proposed forms checked.`);
          if (!originComplete) s.formDiscovery.phase = "checking-origin";
          await tools.checkpoint?.(originComplete ? "Corpus checks complete" : "Corpus checks complete · Checking original spelling in cited sources");
        },
        async () => {
          if (!proposal.originLanguage) return;
          origin = await branch(originWork, "search").run("web", { query: `${term} ${proposal.originTerm ?? ""} original spelling ${proposal.originLanguage} transliteration ${s.scope.sourceLanguage.name} ${s.scope.targetLanguage.name}` }, "Checking original spelling");
          s.origin.evidence = origin;
          originComplete = true;
          branch(originWork, "findings").finishActivity?.("Original-spelling evidence and citations received.");
          originWork.finishActivity?.("Original-spelling findings recorded.");
          await tools.checkpoint?.("Original-spelling findings received");
        },
      ], (work) => work());
      s.formDiscovery.phase = "verifying";
      await tools.checkpoint?.(`Verifying which forms are the same word · Checking ${discovered.size} possible forms`);
      const verified = await branch(tools, "identity").ask("Verify all proposed/discovered forms in one response. Decide lexical identity only: include inflections and spelling alternatives of the same word, exclude derivatives and unrelated homographs. Use exact witnesses and origin evidence. Review the supplied candidateForms only; return every proposed form and any accepted corpus alternatives. Do not add words merely quoted in witnesses. Return each source form once, ignoring capitalization differences. Corpus presence is determined separately from exact paragraph counts; never infer absence from a few examples. Explain lexical identity without making corpus-presence claims.",
        { proposed, candidateForms: [...discovered.values()], ...formIdentityEvidence(evidence, language), origin }, '{"forms":[{"text":"form","sameWord":true,"reason":"one concise sentence explaining lexical identity"}]}', `Verifying which forms are the same word · Checking ${discovered.size} possible forms`);
      const decisions = deduplicateSourceForms(array(verified.forms, "Verified forms"), language);
      if (proposed.some((form) => !decisions.some((f) => key(f.text) === key(form)))
        || decisions.some((f) => f.sameWord !== false && !discovered.has(key(f.text)))) throw new Error("Form verification omitted a proposed form or returned an unknown form.");
      const accepted = decisions.filter((f) => discovered.has(key(f.text))
        && (f.sameWord !== false || known.some((text) => key(text) === key(f.text))));
      for (const decision of decisions) {
        const row = s.forms.find((f) => key(f.text) === key(decision.text));
        if (row) Object.assign(row, { sameWord: decision.sameWord, reason: decision.reason });
      }
      branch(tools, "identity").finishActivity?.(`${accepted.length} ${accepted.length === 1 ? "form" : "forms"} accepted as the same word${accepted.length ? `: ${accepted.map((form) => discovered.get(key(form.text))).join(", ")}` : ""}.`);
      const acceptedWork = branch(tools, "accepted");
      acceptedWork.planActivity?.(accepted.map((f) => ({ id: key(f.text), label: f.text })));
      await tools.checkpoint?.("Lexical identity findings received · Checking accepted alternatives");
      // Keep review rows deterministic while their exact counts arrive in parallel.
      for (const decision of accepted) {
        if (!s.forms.some((row) => key(row.text) === key(decision.text))) s.forms.push({
          text: discovered.get(key(decision.text)), ...selection(decision.text, true), reason: decision.reason,
          discoveryStatus: "Same word verified · Checking exact corpus matches" });
      }
      await parallel(accepted, async (decision) => {
        const match = await attest(decision.text, branch(acceptedWork, key(decision.text)));
        branch(acceptedWork, key(decision.text)).finishActivity?.(`${match.paragraphCount} matching paragraphs. ${decision.reason ?? ""}`);
        await tools.checkpoint?.(`Exact corpus check completed for ${decision.text}`);
      });
      s.forms = accepted.map((f) => {
        const match = attested.get(key(f.text));
        return { text: s.forms.find((row) => key(row.text) === key(f.text)).text, reason: f.reason,
          sameWord: f.sameWord, paragraphCount: match.paragraphCount,
          found: match.paragraphCount > 0, ...selection(f.text, match.paragraphCount > 0) };
      });
      s.origin = { proposal, evidence: origin };
      acceptedWork.finishActivity?.(`${accepted.length} verified forms ready for review.`);
      s.formDiscovery.phase = "complete";
      await tools.checkpoint?.("Forms and spellings are ready for your review");
      return { forms: s.forms, origin: s.origin };
    }
    case "2b": {
      const language = s.scope.sourceLanguage.code;
      const keys = new Set(forms.map((form) => sourceFormKey(form, language)));
      const exact = entries.filter((entry) => entry.sourceTerms.some((form) => keys.has(sourceFormKey(form, language))));
      const ids = new Set(exact.map((entry) => entry.termId));
      const segmenter = new Intl.Segmenter(language, { granularity: "word" });
      const words = (text) => [...segmenter.segment(text)].filter((part) => part.isWordLike).length;
      const lengths = new Set(forms.map(words));
      const byText = new Map();
      for (const entry of entries.filter((row) => !ids.has(row.termId))) for (const text of entry.sourceTerms.filter((value) => lengths.has(words(value)))) {
        const row = byText.get(text) ?? { text, termIds: [] };
        row.termIds.push(entry.termId); byText.set(text, row);
      }
      const near = new Map();
      for (const form of forms) for (const match of rankResearchFormEvidence([...byText.values()], form, language)) for (const termId of match.termIds) {
        const row = near.get(termId) ?? { termId, sourceTerms: [] };
        if (!row.sourceTerms.includes(match.text)) row.sourceTerms.push(match.text);
        near.set(termId, row);
      }
      const shortlist = [...near.values()];
      for (let offset = 0; offset < shortlist.length; offset += 40) {
        const batch = shortlist.slice(offset, offset + 40);
        const relationships = await ask("Review only these plausible additional source spellings or inflections from existing entries. Verified exact source-form matches have already been matched deterministically. Exclude derivatives, unrelated homographs and longer expressions; shared letters alone do not establish lexical identity. Return only supplied term IDs.",
          { term, forms, entries: batch }, '{"termIds":["existing term ID"]}', "Reviewing additional existing source forms");
        const matches = array(relationships.termIds, "Existing-entry matches");
        if (matches.some((id) => !batch.some((entry) => entry.termId === id))) throw new Error("Existing-entry check returned an unknown term.");
        matches.forEach((id) => ids.add(id));
      }
      s.relatedEntries = entries.filter((entry) => ids.has(entry.termId));
      return { entries: s.relatedEntries, summary: `${exact.length} entries matched verified source forms; ${shortlist.length} additional plausible entries reviewed.`,
        exactMatches: exact.length, additionalReviewed: shortlist.length };
    }
    case "3": {
      if (s.scope.corpus === "samael") {
        const sample = await boundedResearchSample(s, branch(tools, "population"), forms);
        branch(tools, "population").finishActivity?.(`${s.populationCount} distinct matching paragraphs; ${s.population.length} retrieved for sampling. Additional evidence is loaded only for missing meanings.`);
        branch(tools, "sample").finishActivity?.(`${s.passages.length} research paragraphs selected, with source-form coverage.`);
        return { total: s.populationCount, paragraphs: s.passages.length, missing: sample.missing };
      }
      s.population = await acquirePopulation(s, branch(tools, "population"));
      s.populationCount = s.population.length;
      branch(tools, "population").finishActivity?.(`${s.population.length} distinct matching paragraphs.`);
      const sample = researchSample(s.population, forms, s.scope.seed, 100, s.scope.sourceLanguage.code);
      if (!sample.passages.length) throw new Error("No exact matches were found. Go Back and edit the term, forms, or corpus.");
      s.passages = sample.passages;
      branch(tools, "sample").finishActivity?.(`${s.passages.length} research paragraphs selected.`);
      return { total: s.population.length, paragraphs: s.passages.length, missing: sample.missing };
    }
    case "4.1": {
      const evidence = await dictionary(s, branch(tools, "dictionary"), term);
      const origin = s.origin?.proposal ?? await branch(tools, "origin").ask("Identify whether this source word was borrowed from another language. Return a verified original term and ISO language code when known; otherwise null. Do not invent an etymology.",
        { term, sourceLanguage: s.scope.sourceLanguage }, '{"originLanguage":null,"originTerm":null}');
      branch(tools, "origin").finishActivity?.(origin?.originTerm ? `Original term: ${origin.originTerm}.` : "No borrowed original-language form identified.");
      let original = null;
      if (origin?.originLanguage && origin?.originTerm) original = await dictionary(s, branch(tools, "origin"), origin.originTerm, origin.originLanguage);
      const result = await branch(tools, "analysis").ask("Extract all dictionary senses, grammatical labels, complex forms, linked synonyms/antonyms, with exact citations. Use the small form-diverse corpus sample only to identify the researched lexeme: capitalization can lead to an unrelated surname or proper-name article. Exclude senses of unrelated names, while retaining every dictionary sense of the researched lexeme even if the examples do not attest it. The meanings array must contain only dictionary senses; never add corpus commentary or translation advice as a dictionary meaning. Keep each definition to one concise sentence describing the meaning itself. Put sense numbers, grammatical labels, synonyms and antonyms in their structured fields rather than repeating them inside definitions. Write definitions in the target language. A failed lookup is not no entry. Preserve missing/unreachable findings. The opening summary must be 2–4 short sentences: identify the lexeme, name the dictionaries actually used, give relevant etymology and explain retrieval limitations in ordinary language. Do not repeat the definition list, full URLs, raw field names, technical status codes or implementation details in that summary. Keep quotations and source URLs in the structured evidence.",
        { term, forms, examples: dictionaryLexemeExamples(s, forms), evidence, original }, '{"meanings":[{"definition":"one concise target-language definition","sourceSense":"dictionary sense number","grammar":"grammatical label","synonyms":[],"antonyms":[],"complexForms":[],"evidence":[{"url":"source URL","quotation":"exact source quotation"}]}],"summary":"short findings and limitations"}');
      return { ...result, evidence, original, dictionaryVersion: STUDIO_DICTIONARY_REVIEW_VERSION };
    }
    case "4.2": {
      const evidence = corpusMeaningEvidence(s, forms);
      const examples = branch(tools, "examples");
      examples.planActivity?.(forms.map((form) => ({ id: form, label: `Read usage of ${form}` })));
      for (const group of evidence.forms) branch(examples, group.form).finishActivity?.(`${group.paragraphIds.length} saved exact examples selected across source documents.`);
      examples.finishActivity?.(`${evidence.paragraphs.length} distinct saved paragraphs for ${forms.length} forms; no new corpus searches.`);
      const result = await branch(tools, "analysis").ask("Infer the author's meanings from these complete exact research paragraphs. Keep ordinary and specialized lexical meanings distinct, and state grammatical uses explicitly. Group context-specific applications of one meaning rather than inventing a new sense for each named entity, book setting or modifier. Preserve distinctions explicitly explained by the author: a dark or negative pole, a necessary counterpart, or a cosmic process does not automatically imply immoral intent or hostility. Separate metaphysical function from judgments about practices or agents, and retain psychological referents when witnessed. A substantivized or neuter use can be a grammatical variant unless it changes the meaning. Do not invent grammatical uses absent from the evidence or infer corpus-wide absence from this bounded sample. Define meanings concisely without using target translation candidates as definitions. Cite up to three decisive supplied paragraph references per meaning; retain additional citations only for a genuinely different use. Do not repeat source passages inside definitions.",
        evidence, '{"meanings":[{"definition":"concise target-language definition","grammar":"grammatical uses","evidence":["supplied passage reference"]}],"summary":"brief findings and limitations"}');
      return { ...result, evidence };
    }
    case "4.3": {
      const dictionaryReport = s.steps["4.1"]?.approved ?? s.steps["4.1"]?.value;
      const parts = await branch(tools, "parts").ask("Determine whether researching independently attested component words or productive affixes would resolve an unanswered meaning of this whole source word. Use the existing dictionary findings first. A whole lexeme inherited or borrowed from another language is not automatically a productive compound in the research language. Historical bound roots do not need speculative dictionary or web searches merely to restate a known whole-word meaning. Explain historical morphology briefly in summary instead. Return parts only when their further research can clarify the whole word's use, with that concrete unanswered question. Otherwise return an empty parts list and a concise cited explanation.",
        { term, forms, dictionary: dictionaryReport ? { summary: dictionaryReport.summary,
          meanings: (dictionaryReport.meanings ?? []).map(({ definition, grammar }) => ({ definition, grammar })) } : null,
          examples: dictionaryLexemeExamples(s, forms).slice(0, 3) }, '{"parts":[{"text":"component word or productive affix","inferredMeaning":"target-language explanation","researchQuestion":"unanswered whole-word meaning question"}],"summary":"short formation findings"}');
      const components = array(parts.parts, "Word parts");
      branch(tools, "parts").finishActivity?.(`${components.length} word components identified.`);
      if (!components.length) {
        for (const id of ["components", "analysis"]) branch(tools, id).finishActivity?.("Not needed: no separate word components.");
        return { meanings: [], parts: [], summary: parts.summary || `No separate word components were identified for ${term}.` };
      }
      const componentWork = branch(tools, "components");
      componentWork.planActivity?.(components.map((part) => ({ id: part.text, label: part.text })));
      const evidence = [];
      for (const part of components) evidence.push({ ...part,
        dictionary: await dictionary(s, branch(componentWork, part.text), part.text), glossary: entries.filter((e) => e.sourceTerms.includes(part.text)) });
      componentWork.finishActivity?.(`${components.length} components researched.`);
      return branch(tools, "analysis").ask("Summarize the part analysis, separating guesses from dictionary/glossary evidence; retain citations. Meanings must describe the WHOLE researched term, never the component roots or suffixes themselves. Keep component glosses in summary. Do not repeat already established whole-word meanings; return no new meanings when composition adds none. A noncompound is a not-applicable result.", { term, parts: components, evidence, dictionary: dictionaryReport?.summary ?? null, examples: dictionaryLexemeExamples(s, forms).slice(0, 3) },
        '{"meanings":[{"definition":"new supported whole-word meaning only","evidence":[]}],"summary":"concise component analysis"}');
    }
    case "4.4.1": {
      if (s.scope.corpus !== "samael") return { skipped: true, reason: "Available for Samael Aun Weor only" };
      // Refresh the inexpensive catalog at each attempt; a corpus update must
      // not trap Retry behind a saved summary from an older index snapshot.
      const books = await branch(tools, "metadata").run("corpus", { path: "/api/sample/source-books", params: { author_reference_version: 2 }, referenceSnapshotRequest: crypto.randomUUID() }, "Reading shared source-author references");
      if (books.author_references?.schema_version !== 2 || books.author_references.ready !== true || !Array.isArray(books.authors) || !books.authors.length) {
        throw new Error("Shared author references are unavailable or need corpus maintenance. Prepare and publish the author-reference index in GlossaryGen before retrying this step.");
      }
      const sourceVersion = await studioToolSignature("source-index", referenceSnapshot(books));
      const sourcePopulation = await branch(tools, "sources").run("corpus", { path: "/api/sample", params: params(forms, "source"), all: true, researchCorpusVersion: sourceVersion }, "Searching bibliographical sources");
      const original = await branch(tools, "originals").run("corpus", { path: "/api/sample/original-terms", params: { forms: forms.join(",") }, researchCorpusVersion: sourceVersion }, "Checking original-language terms");
      const byAuthor = new Map();
      for (const book of books.books ?? []) {
        const author = book.original_author || (book.title?.includes(" — ") ? book.title.split(" — ").at(-1) : null);
        const compiled = books.authors?.find((a) => a.books.some((b) => b.doc_id === book.doc_id || `source-${b.book_id}` === book.doc_id));
        const name = compiled?.author ?? author ?? `Unidentified author of ${book.title}`;
        const group = byAuthor.get(name) ?? { author: name, books: (books.books ?? []).filter((b) =>
          compiled ? compiled.books.some((item) => item.doc_id === b.doc_id || `source-${item.book_id}` === b.doc_id)
            : (b.original_author || (b.title?.includes(" — ") ? b.title.split(" — ").at(-1) : `Unidentified author of ${b.title}`)) === name), passages: [], termCounts: [] };
        const matches = (sourcePopulation.items ?? []).filter((p) => (p.copies ?? [p.representative]).some((copy) => copy?.doc_id === book.doc_id));
        if (!matches.length) continue;
        group.termCounts.push({ docId: book.doc_id, paragraphs: matches.length,
          occurrences: matches.reduce((n, p) => n + (p.occurrences?.length ?? 0), 0) });
        for (const p of matches) if (!group.passages.some((other) => other.item_id === p.item_id)) group.passages.push(p);
        group.compiled = compiled; byAuthor.set(name, group);
      }
      const authors = [];
      const authorWork = branch(tools, "authors");
      authorWork.planActivity?.([...byAuthor.values()].map((g) => ({ id: g.author, label: g.author })));
      for (const group of byAuthor.values()) {
        const authorTools = branch(authorWork, group.author);
        const compiled = group.compiled;
        if (!compiled || typeof compiled.author_id !== "string" || !compiled.author_id || typeof compiled.fingerprint !== "string" || !compiled.fingerprint || compiled.schema_version !== 2 || !["verified", "reviewed"].includes(compiled.review_status)) {
          throw new Error(`Shared references for ${group.author} need corpus maintenance in GlossaryGen. No local author-reference checks were started.`);
        }
        const metadata = referenceSummary(compiled);
        if (!validReferenceSummary(metadata)) {
          throw new Error("Shared author-reference evidence changed or is incomplete. Refresh the GlossaryGen index and retry; no local author-reference checks were started.");
        }
        const verifiedMentions = metadata.verified_mentions;
        const review = { source: "shared-corpus-index", fingerprint: metadata.fingerprint, detail: "Published verified summary; full witness ledger remains in GlossaryGen." };
        authorTools.finishActivity?.(`Saved corpus-wide references reused: ${metadata.confirmed_paragraphs} confirmed paragraphs, ${metadata.confirmed_copies} copies, ${metadata.confirmed_occurrences} name/title occurrences; ${metadata.unresolved_witnesses} unresolved reference witnesses. ${group.passages.length} term-matching source paragraphs.`);
        authors.push({ author: group.author, books: group.books, termCounts: group.termCounts,
          verifiedMentions, mentionEvidence: metadata, review,
          matchingParagraphs: group.passages.length, passages: bibliographySample(group, s.scope.seed, s.bibliographyLimit ?? 3) });
      }
      branch(tools, "authors").finishActivity?.(`${authors.length} authors checked. Shared reference counts and unresolved evidence are retained below; author checks were not repeated.`);
      const finalCatalog = await branch(tools, "metadata").run("corpus", { path: "/api/sample/source-books", params: { author_reference_version: 2 }, referenceSnapshotRequest: crypto.randomUUID() }, "Checking source-index snapshot consistency");
      if (await studioToolSignature("source-index", referenceSnapshot(finalCatalog)) !== sourceVersion) throw new Error("Shared author-reference evidence changed or is incomplete. Retry with the current corpus index.");
      const sourceMeanings = ["4.1", "4.2"].map((step) => ({ step, summary: s.steps[step]?.approved?.summary,
        meanings: s.steps[step]?.approved?.meanings?.map(({ definition, grammar }) => ({ definition, grammar })) }));
      const batches = bibliographyBatches(authors, original, dictionaryLexemeExamples(s, forms).slice(0, 4).map(({ id, text, reference }) => ({ id, text, reference })), sourceMeanings);
      const comparisons = branch(tools, "comparisons");
      comparisons.planActivity?.(batches.map((batch, index) => ({ id: `batch-${index}`, label: `Comparison ${index + 1} of ${batches.length} · ${uniqueTexts(batch.authors.map((a) => a.author)).join(", ")}` })));
      const findings = [];
      for (const [index, batch] of batches.entries()) findings.push(await branch(comparisons, `batch-${index}`).ask("Identify possible borrowed-source AUTHORS using these bounded complete source paragraphs and existing whole-word findings. Shared vocabulary or conceptual agreement does not prove borrowing; distinguish genuine lexical senses from different applications of one sense. Group equivalent meanings across authors, retaining every distinct supported sense and grammatical nuance, including non-evil psychological, cosmic-counterpart and esoteric uses. Each meaning needs one concise definition, its author names, a verified original term or null, and one short decisive quotation (up to20 words) with its supplied paragraph ID. Add a second only for a distinct nuance. Do not copy reference objects: the app attaches the original citation from the supplied ID. Use authorAssessments for one sentence of at most30 words per supplied author, without adding authors from another author's quotations on relevance and chronological limitations, not another definition essay. Do not repeat numeric tables, mention counts, complete passages or metadata in prose: the interface already preserves those. Samples contain a small definition-oriented and document-diverse paragraphs per author, not all matching paragraphs; no corpus-wide absence claims. Exact author definitions take priority over inference. A null verified mention total remains uncertain. Original Spanish works need no translation; foreign-language originals require Spanish availability before1977 and before the relevant corpus use. Missing original-language or edition history remains uncertain. Inventory-level aligned equivalents do not establish a quotation-specific alignment. Keep summary below180 words on the main provenance conclusion and limitations; do not restate every author's assessment. Produce only findings that help later meaning/translation decisions.",
        batch, '{"meanings":[{"definition":"concise target-language definition","author":"supporting author names","originalTerm":null,"evidence":[{"id":"supplied paragraph ID","quotation":"short exact quotation"}]}],"authorAssessments":[{"author":"name","summary":"brief relevance and chronology finding"}],"summary":"concise provenance and limitations"}',
        `Comparing bibliographical sources · Batch ${index + 1} of ${batches.length}`));
      comparisons.finishActivity?.(`${batches.length} comparison batches completed; ${findings.reduce((n, f) => n + (f.meanings?.length ?? 0), 0)} source meaning descriptions before consolidation.`);
      const result = findings.length === 1 ? findings[0] : await branch(tools, "consolidate").ask("Consolidate concisely: merge equivalent meanings across authors rather than repeating their applications. Keep one short assessment per author in authorAssessments and summary below180 words. Never repeat numeric tables or full paragraphs. Merge equivalent definitions while retaining distinct source meanings, exact quotations, source URLs, authors, original terms, publication/translation constraints and unresolved findings. Parts of one author's sample may appear in several batches; do not add their repeated mention counts or claim borrowing from shared vocabulary alone. Original Spanish works need no Spanish translation; assess their own publication chronology. Apply the pre-1977 Spanish-translation condition only to foreign-language originals. Do not preserve an inference that translated=false or a missing translation date alone disqualifies an original Spanish source.",
        { findings }, '{"meanings":[{"definition":"concise definition","author":"supporting authors","originalTerm":null,"evidence":[]}],"authorAssessments":[{"author":"name","summary":"brief assessment"}],"summary":"concise conclusion"}',
        "Consolidating bibliographical findings");
      branch(tools, "consolidate").finishActivity?.(result.summary || `${result.meanings?.length ?? 0} consolidated source meanings.`);
      return { ...attachBibliographyCitations(result, authors, s.passages), evidence: { authors, original, findings } };
    }
    case "4.4.2": {
      const known = ["4.1", "4.2", "4.4.1"].map((step) => {
        const r = s.steps[step]?.approved ?? s.steps[step]?.value;
        return r && !r.skipped ? { step, summary: r.summary, meanings: r.meanings?.map(({ definition, grammar }) => ({ definition, grammar })) } : null;
      }).filter(Boolean);
      const query = `Research unresolved provenance or genuinely additional meanings of ${JSON.stringify(term)} (${s.scope.sourceLanguage.name}) in ${s.scope.corpus === "samael" ? "Samael Aun Weor" : s.scope.corpusTitle ?? "the supplied corpus"}. Write findings in ${s.scope.targetLanguage.name}. `
        + "The supplied dictionary and source findings are already established; do not repeat their searches. Research the complete source-language lexeme: foreign glossary headwords and their proper-name senses are background evidence, not automatically meanings of this word. Inspect at most3 relevant primary dictionary/book sources, using at most2 search rounds; stop once the remaining question is answered or record it unresolved. Do not pursue absolute first attestations or complete archival edition histories. Do not select translation candidates or investigate English translations at this stage. Original Spanish works need no Spanish translation; for foreign originals require Spanish availability before1977 and before relevant corpus use when evaluating Samael's borrowing. Shared vocabulary and thematic parallels do not prove borrowing. A bounded search cannot prove absence. Keep distinct grammatical and non-evil esoteric uses; a condemnatory label need not imply consciously evil intent. Return JSON ONLY, no headings or fences, with {\"meanings\":[{\"definition\":\"concise genuinely additional supported meaning\",\"originalTerm\":null,\"evidence\":[{\"url\":\"visited primary source URL\",\"quotation\":\"short exact quotation\"}]}],\"summary\":\"main findings and uncertainties in at most180 words\",\"citations\":[{\"url\":\"visited primary source URL\",\"quotation\":\"short exact quotation\"}]}. Use an empty meanings list when existing findings already cover the uses. Put checkable URLs in the JSON evidence, with short exact quotations; distinguish a dated transcription from an inspected original edition. Do not put provider citation markup inside JSON strings.\nKnown findings: "
        + JSON.stringify(known) + "\nComplete corpus examples: " + JSON.stringify(dictionaryLexemeExamples(s, forms).slice(0, 4).map(({ id, text, reference }) => ({ id, text, reference })));
      const evidence = await branch(tools, "search").run("web", { query }, "Researching unresolved sources with a bounded primary-source search");
      const text = String(evidence.summary ?? "").trim().replace(/^```(?:json)?\s*|\s*```$/gu, "");
      let result;
      try { result = JSON.parse(text); } catch { throw new Error("Internet research did not return a structured report. Your cited web evidence is saved; retry this step."); }
      if (!Array.isArray(result.meanings) || typeof result.summary !== "string" || !Array.isArray(result.citations)) throw new Error("Internet research returned an incomplete report. Your source evidence is saved.");
      const cited = new Set((evidence.citations ?? []).map((c) => c.url).filter(Boolean).map((url) => url.split("#")[0]));
      for (const m of result.meanings) if (!m.definition?.trim() || !Array.isArray(m.evidence) || !m.evidence.length) throw new Error("An internet meaning has no supporting definition or citations.");
      for (const c of [...result.citations, ...result.meanings.flatMap((m) => m.evidence)]) {
        if (typeof c.url !== "string" || !/^https?:\/\//u.test(c.url) || !c.quotation?.trim() || !cited.has(c.url.split("#")[0])) throw new Error("An internet finding has an unverified source citation. Review or retry the cited research.");
      }
      branch(tools, "analysis").finishActivity?.(`${result.meanings.length} additional meanings; structured report and source citations validated locally without a second AI call.`);
      return { ...result, evidence };
    }
    case "4.4.4": {
      const branches = ["4.4.1", "4.4.2"].map((id) => ({ step: id, report: s.steps[id]?.approved ?? s.steps[id]?.value }))
        .filter(({ report }) => report && !report.skipped)
        .map(({ step, report }) => ({ step, summary: report.summary ?? "", meanings: report.meanings ?? [], citations: report.citations ?? [] }));
      if (!branches.length) return { skipped: true, reason: "Both source branches skipped" };
      const contributing = branches.filter((report) => report.meanings.length);
      if (contributing.length <= 1) {
        tools.planActivity?.([{ id: "assembly", label: "Combine approved source findings" }]);
        const result = { meanings: contributing[0]?.meanings ?? [], citations: branches.flatMap((r) => r.citations),
          summary: branches.filter((r) => r.summary).map((r) => `${r.step === "4.4.1" ? "Bibliographical sources" : "Internet sources"}: ${r.summary}`).join("\n\n") };
        branch(tools, "assembly").finishActivity?.(`${result.meanings.length} approved source descriptions retained; no cross-source meaning merge or additional AI call needed.`);
        return result;
      }

      return ask("Summarize provenance and consolidate source-supported definitions, retaining original-language terms, exact evidence, and unresolved findings. For Samael, distinguish original Spanish works from foreign-language originals: Spanish originals need no translation and are judged by their publication chronology; the pre-1977 Spanish-translation requirement applies only to foreign-language originals. Correct any earlier inference that translated=false or a missing translation date disqualifies an original Spanish work, while retaining genuinely unknown original language or publication history as uncertain.", branches,
        '{"meanings":[{"definition":"target-language definition","originalTerm":null,"evidence":[]}],"summary":"summary"}');
    }
    case "4.5": {
      const reports = ["4.1", "4.2", "4.3", "4.4.4"].map((step) => ({ step, result: s.steps[step]?.approved ?? s.steps[step]?.value }))
        .filter(({ result }) => result && !result.skipped);
      const originals = new Map(reports.flatMap(({ step, result }) => (result.meanings ?? []).map((m, i) => [`${step}:${i + 1}`, m])));
      const sourceMeanings = [...originals].map(([sourceId, { definition, grammar, originalTerm, author, sourceSense }]) => ({ sourceId, definition, grammar, originalTerm, author, sourceSense }));
      const result = await ask("Build the meaning inventory from the curated source findings. Combine equivalent descriptions, retaining distinct attested meanings, grammar and minority uses. Define each meaning concisely in the target language. Dictionary senses remain even when not witnessed; occurrence assignment and recovery follow later. Do not resurrect unrelated names excluded upstream. A verified foreign glossary headword, its proper-name senses, etymology or a contextual application is not automatically a separate meaning of this source-language lexeme. No translation candidate selection. Return sourceIds for the findings supporting each meaning instead of copying quotations or citations: the app attaches those exact preserved records. Every supplied sourceId must occur in a meaning's sourceIds or in excludedSources with a brief human-readable reason. Preserve distinctions between non-evil unconsciousness/cosmic function and condemnation when supported; harmful classifications do not always imply consciously malicious intent. Do not reference internal source IDs inside definitions or exclusion reasons.",
        { term, forms, sourceMeanings, reports: reports.map(({ step, result }) => ({ step, summary: result.summary ?? "" })) },
        '{"meanings":[{"id":"m1","definition":"concise target-language definition","grammar":"grammatical uses","sourceIds":["supplied sourceId"]}],"excludedSources":[{"sourceId":"supplied sourceId","reason":"why this does not add a separate meaning"}]}');
      const accounted = new Set();
      const meanings = array(result.meanings, "Meaning inventory").map((m) => {
        const ids = array(m.sourceIds, "Meaning source references");
        if (!ids.length || ids.some((id) => !originals.has(id))) throw new Error("A meaning has missing or unknown source findings. Review the inventory before continuing.");
        const evidence = new Map();
        for (const id of ids) {
          accounted.add(id); const original = originals.get(id).evidence;
          for (const item of (Array.isArray(original) ? original : original ? [original] : [])) evidence.set(stableSignature(item), item);
        }
        return { ...m, evidence: [...evidence.values()] };
      });
      const excludedSources = array(result.excludedSources, "Excluded source findings").map((row) => {
        if (!originals.has(row.sourceId) || !row.reason?.trim()) throw new Error("An excluded source finding has no valid reference or explanation.");
        accounted.add(row.sourceId); return { ...row, definition: originals.get(row.sourceId).definition };
      });
      if ([...originals.keys()].some((id) => !accounted.has(id))) throw new Error("Some source findings were omitted without explanation. Review or retry the meaning inventory.");
      s.meanings = normalizeMeanings(meanings, "meaning");
      return { meanings: s.meanings, excludedSources };
    }
    case "4.6": return assignMeanings(s, tools);
    case "4.7": {
      Object.assign(s, applySplitReview(s, []));
      const result = await ask("Find source expressions that DURABLY ISOLATE a distinct meaning for longest-first glossary matching and materially reduce ambiguity beyond ordinary candidate usage notes. This is not a list of phrases containing the word. Do not split transparent adjective+noun combinations, incidental one-off wording, every inflection, or every context-specific application. Those belong in the later compounds review. A leading article plus adjective is not by itself a complete nominal expression if it can precede a following noun; never propose such a prefix as a guaranteed noun rendering. Keep ordinary adjectival/substantive variants with the parent when candidate grammar notes can handle them. A genuine fixed expression or a set of expressions that uniquely isolates a meaning can qualify; group inflections of the same expression. Review all supplied occurrences for contrary readings, and explain the benefit for every proposal. Use only exact witnessed forms and supplied meaning IDs. Return an empty splits list when ordinary word research suffices, with a short explanation. Provisional targets must be in the glossary target language. Do not create studies merely to collect collocations.",
        { meanings: decisionMeanings(activeMeanings(s)), assignments: s.assignments.map(({ paragraphId, occurrenceId, meaningId }) => ({ paragraphId, occurrenceId, meaningId })), paragraphs: decisionParagraphs(s.passages) },
        '{"splits":[{"forms":["source expression"],"meaningId":"supplied ID","targetTerms":["provisional target"],"rationale":"how the expression isolates a meaning beyond ordinary notes"}],"summary":"brief decision"}');
      const unverifiedSplits = [];
      s.splitProposals = array(result.splits, "Split entries").flatMap((p, i) => {
        if (!p.rationale?.trim()) throw new Error("A proposed split has no explanation of its meaning-isolation benefit.");
        const forms = uniqueSourceTexts(p.forms ?? [], s.scope.sourceLanguage.code).filter((form) => {
          const assignments = s.passages.flatMap((paragraph) => exactOccurrences(paragraph.text, [form], s.scope.sourceLanguage.code).flatMap((span) =>
            s.assignments.filter((a) => a.paragraphId === paragraph.id && paragraph.occurrences.some((o) => o.id === a.occurrenceId && o.start >= span.start && o.end <= span.end))));
          const valid = assignments.length && assignments.every((a) => a.meaningId === p.meaningId);
          if (!valid) unverifiedSplits.push({ forms: [form], reason: assignments.length ? "This expression also matches an occurrence with another meaning." : "No exact research witness with this meaning.", rationale: p.rationale });
          return valid;
        });
        return forms.length ? [{ ...p, id: p.id || `split-${i}`, forms, selected: true }] : [];
      });
      const routed = applySplitReview(s, s.splitProposals);
      Object.assign(s, routed);
      return { splits: s.queue, proposals: s.splitProposals, unverifiedSplits, summary: result.summary ?? "" };
    }
    case "5": {
      const assignments = s.assignments.filter((a) => !a.entryId || a.entryId === "original");
      const paragraphs = annotatedParagraphs(s, assignments);
      const result = await ask("Find repeated compounds or useful lexical/domain collocations for each active meaning using only the supplied research paragraphs and annotated occurrences. Every occurrence carries its assigned meaning; use those annotations rather than neighboring topic words. Return exact observed phrase forms, including attested inflections and intervening modifiers in forms. Do not list a grammatical article-plus-adjective prefix as a complete compound. Never count bibliography quotations, neighboring context paragraphs or split-child occurrences as research witnesses. Require at least two distinct research paragraphs, unless a single example has a special meaning not understandable from its words; set specialMeaning=true only for that exception and explain it. Do not label an ordinary compositional phrase special just to pass the one-example rule. Preserve research paragraph IDs; the app verifies counts and attaches full evidence. Give one concise explanation per compound without copying source paragraphs or repeating frequency tables. Do not open new studies.",
        { term, forms, meanings: decisionMeanings(activeMeanings(s)), paragraphs },
        '{"compounds":[{"phrase":"observed source phrase","forms":["exact observed forms"],"meaningId":"ID","paragraphIds":["research witness ID"],"specialMeaning":false,"explanation":"concise target-language explanation"}]}');
      array(result.compounds, "Compounds");
      return reviewCompoundReport(s, result);
    }
    case "6": {
      const proposalView = candidateExampleView(s, activeMeanings(s));
      tools.planActivity?.([{ id: "examples", label: "Select representative proposal examples" }, { id: "candidates", label: "Propose translations and usage notes" }]);
      const exampleWork = branch(tools, "examples");
      exampleWork.planActivity?.(proposalView.samples.map((row) => ({ id: row.meaningId, label: `Meaning ${s.meanings.findIndex((m) => m.id === row.meaningId) + 1}` })));
      for (const row of proposalView.samples) branch(exampleWork, row.meaningId).finishActivity?.(`${row.paragraphIds.length} complete examples from ${row.totalParagraphs} paragraphs / ${row.totalOccurrences} occurrences.`);
      exampleWork.finishActivity?.(`${proposalView.paragraphs.length} distinct representative paragraphs; full research sample retained for tests.`);
      const result = await branch(tools, "candidates").ask("Propose a concise, nonredundant set of translations of the complete supplied source term and its selected forms for each active meaning, using its definition and representative complete occurrences, originals and compound findings. Preserve every required grammatical rendering, including substantive uses and inflections, but do not enumerate thesaurus alternatives without a useful contextual distinction. Prefer idiomatic lexical equivalents, including natural multiword equivalents. Do not mechanically glue definition adjectives together with and to invent a target variant; context and usage notes can carry nuances that need not all be spelled out inside the equivalent. Reuse an appropriate broad equivalent across meanings rather than force a different explanatory phrase for every definition. Exact full-sample counts accompany each meaning; representative examples are not frequency estimates. All research occurrences are tested later. Keep any warranted reader footnote under40 words. For split expressions, inherited parent definitions supply context; do not propose translations of the parent word alone. Prefer complete lexical forms without detachable articles or quantifiers that vary with the surrounding sentence; preserve those grammatical requirements in usage notes. Keep articles or quantifiers that are fixed parts of an expression, and preserve all lexical content. Include every supplied existing target variant as a candidate for appropriate meanings. Inflections of one target word may share a group; lexical synonyms have separate groups. Usage notes must be self-contained selection conditions in the target language: never reference meaning IDs or candidate IDs, because translators will not see those IDs. Retain verified borrowed-source authors, original terms, spelling provenance, evidence and uncertainty in researchSummary and candidate explanation fields for the research report. Include provenance in a translator note only if that particular fact is essential to prevent a meaningful translation error. Keep the footnote empty unless verified source information warrants a reader footnote. Never drop a carried target without showing it for human review. " + STUDIO_USAGE_NOTE_POLICY,
        { term, forms, meanings: decisionMeanings(activeMeanings(s)), paragraphs: proposalView.paragraphs, meaningSamples: proposalView.samples,
          compounds: s.steps["5"]?.approved?.compounds ?? [], carriedTargets: s.carriedTargets, existingGeneralNote: s.generalNote ?? "", existingFootnote: s.footnote ?? "",
          sourceReports: candidateSourceReports(s) },
        '{"candidates":[{"id":"c1","text":"target form","meaningIds":["m1"],"groupId":"g1","note":"brief target-language selection rule, or empty","explanation":"report-only evidence and translation rationale","longNoteReason":"specific meaningful error prevented by exceptional length, or empty"}],"generalNote":"essential nonduplicated shared rule, or empty","generalNoteReason":"report-only justification if a longer shared rule is essential","researchSummary":"report-only provenance, citations, decisions and uncertainty","footnote":"optional verified reader footnote"}');
      const ids = activeMeanings(s).map((m) => m.id);
      const research = usageNoteResearch(result, array(result.candidates, "Translation candidates"));
      s.candidates = result.candidates.map(({ explanation: _explanation, longNoteReason: _longNoteReason, ...c }, i) => {
        if (!c.text?.trim() || !c.meaningIds?.length || c.meaningIds.some((id) => !ids.includes(id))) throw new Error("A candidate has missing or unknown meaning applicability.");
        return { ...c, id: c.id || `candidate-${i}`, selected: true, confirmed: false, retained: true };
      });
      for (const old of s.carriedTargets) if (!s.candidates.some((c) => c.text === old.text)) s.candidates.push({ ...old, id: `carried-${s.candidates.length}`, meaningIds: ids, selected: true, confirmed: false, retained: true });
      if (!s.generalNote?.trim() && typeof result.generalNote === "string") s.generalNote = result.generalNote;
      if (!s.footnote?.trim() && typeof result.footnote === "string") s.footnote = result.footnote;
      return { candidates: s.candidates, generalNote: s.generalNote ?? "", footnote: s.footnote ?? "", proposalSample: proposalView.samples, research };
    }
    case "7": {
      const unique = [...new Map(s.candidates.filter((c) => c.selected !== false).map((c) => [c.text, c])).values()];
      const uncertain = await branch(tools, "identify").ask("Which supplied target forms have genuinely uncertain spelling, especially borrowed names or nonstandard words? Identify uncertainty from the spelling, target language and known source origin; do not change forms here. Return only supplied candidate IDs; ordinary clearly spelled words need no further search.",
        { candidates: unique.map(({ id, text }) => ({ id, text })), targetLanguage: s.scope.targetLanguage, origin: s.origin?.proposal ?? null }, '{"candidateIds":["ID"]}');
      const ids = uniqueTexts(array(uncertain.candidateIds, "Spelling questions"));
      if (ids.some((id) => !unique.some((c) => c.id === id))) throw new Error("Spelling check named an unknown candidate.");
      const spellings = branch(tools, "spellings");
      spellings.planActivity?.(ids.map((id) => ({ id, label: s.candidates.find((c) => c.id === id)?.text ?? "Spelling question" })));
      const decisions = [];
      for (const id of ids) {
        const spellingTools = branch(spellings, id);
        const c = s.candidates.find((c) => c.id === id);
        if (!c) throw new Error("Spelling check named an unknown candidate.");
        const evidence = await spellingTools.run("web", { query: `${c.text} standard spelling ${s.scope.targetLanguage.name} origin original language` }, `Verifying spelling of ${c.text}`);
        const corpus = await topEvidence(s, spellingTools, c.text, 20, true);
        const decision = await spellingTools.ask("Classify this term as borrowed from corpus sources, elsewhere, or corpus-original/unknown. For source borrowings verify original-language spelling from original books, for others verify target-language convention; otherwise decide source spelling versus target-language phonetic adaptation. Retain evidence and uncertainty; do not substitute a definition for a name.",
          { candidate: c, corpus, evidence, origin: s.origin }, '{"spelling":"target form","classification":"origin category","reason":"explanation","evidence":[]}');
        const old = c.text;
        for (const candidate of s.candidates) if (candidate.text === old) { candidate.text = decision.spelling || old; candidate.spelling = decision; }
        decisions.push({ candidateId: id, ...decision });
      }
      spellings.finishActivity?.(ids.length ? `${ids.length} spellings investigated.` : "No spellings need further investigation.");
      return { decisions, candidates: s.candidates };
    }
    default: return {};
  }
}

export async function assignMeanings(s, tools) {
  tools.planActivity?.(studioStageActivities({ ...s, step: "4.6" }));
  const meanings = s.meanings.filter((m) => m.enabled !== false);
  if (!meanings.length) throw new Error("Select at least one meaning before continuing.");
  const meaningViews = decisionMeanings(meanings);
  const wordMeaningRule = "Judge what the researched word itself contributes, not merely the topic of neighboring words. An adjective modifying something unconscious does not automatically mean unconscious; a harmful agent is not automatically evidence of secrecy. Preserve full context and explicit sense conditions.";
  // Answers from the "Choose a meaning" dialog guide every later classification.
  const reviewedRule = " reviewedExamples are occurrences the human researcher assigned; give the same meaning to occurrences that use the word the same way.";
  function reviewedExamples() {
    return s.assignments.filter((a) => a.humanChoice && a.meaningId).flatMap((a) => {
      const p = s.passages.find((p) => p.id === a.paragraphId); const o = p?.occurrences.find((o) => o.id === a.occurrenceId);
      return o ? [{ text: p.text, occurrence: { start: o.start, end: o.end, surface: o.surface }, meaningId: a.meaningId }] : [];
    });
  }
  async function classify(passages, purpose = `Assigning meanings in ${passages.length} research paragraphs`, work = branch(tools, "assign"), expanded = false) {
    const examples = reviewedExamples();
    const result = await work.ask("Assign a meaning to EACH occurrence separately in source order. Apply human-edited applicability conditions and preference rules in the definitions; a broad sense must not override a more specific human rule. Use only supplied meaning IDs; null means unmatched. Return each paragraph once with one meaningIds entry for every supplied occurrence in its original order. Do not copy occurrence IDs, offsets, source text or citations into the response. If a paragraph cannot be disambiguated without its neighbors, include its ID in contextParagraphIds. " + wordMeaningRule + (examples.length ? reviewedRule : ""),
      { meanings: meaningViews, paragraphs: decisionParagraphs(passages, s), ...(examples.length ? { reviewedExamples: examples } : {}) }, '{"paragraphMeanings":[{"paragraphId":"supplied ID","meaningIds":[null]}],"contextParagraphIds":[]}', purpose);
    const rows = array(result.paragraphMeanings, "Paragraph meaning assignments");
    if (rows.length !== passages.length || new Set(rows.map((r) => r.paragraphId)).size !== rows.length) throw new Error("Paragraph assignments were incomplete or duplicated.");
    const assigned = [];
    for (const row of rows) {
      const p = passages.find((p) => p.id === row.paragraphId);
      if (!p || !Array.isArray(row.meaningIds) || row.meaningIds.length !== p.occurrences.length) throw new Error("A paragraph has missing or unknown occurrence assignments.");
      assigned.push(...p.occurrences.map((o, i) => ({ paragraphId: p.id, occurrenceId: o.id, meaningId: row.meaningIds[i] })));
    }
    const validated = validateAssignments(passages, assigned, meanings.map((m) => m.id));
    const requested = result.contextParagraphIds ?? [];
    if (!Array.isArray(requested) || requested.some((id) => !passages.some((p) => p.id === id))) throw new Error("Unknown paragraph requested for context review.");
    if (!expanded && requested.length) {
      s.contextIncludedIds = [...new Set([...(s.contextIncludedIds ?? []), ...requested])];
      const clarified = await classify(passages.filter((p) => requested.includes(p.id)), "Reviewing ambiguous occurrences with neighboring source context", work, true);
      return validated.map((a) => clarified.find((c) => c.paragraphId === a.paragraphId && c.occurrenceId === a.occurrenceId) ?? a);
    }
    return validated;
  }
  if (!s.assignments.length) { delete s.unmatchedRecheck; s.assignments = await classify(s.passages); }
  // An answer can settle other unmatched occurrences, so after each new one the
  // paragraphs that still have them are classified again with the answers.
  const open = s.passages.filter((p) => s.assignments.some((a) => a.paragraphId === p.id && !a.meaningId));
  const answered = s.assignments.filter((a) => a.humanChoice && a.meaningId).map(({ paragraphId, occurrenceId, meaningId }) => ({ paragraphId, occurrenceId, meaningId }));
  const recheck = stableSignature({ meaningIds: meanings.map((m) => m.id), answered });
  if (open.length && answered.length && s.unmatchedRecheck !== recheck) {
    const rechecked = await classify(open, `Re-checking ${open.length} paragraphs with unmatched occurrences against your answers`);
    for (const a of s.assignments) if (!a.meaningId) a.meaningId = rechecked.find((r) => r.paragraphId === a.paragraphId && r.occurrenceId === a.occurrenceId)?.meaningId ?? null;
    s.unmatchedRecheck = recheck;
  }
  async function reviewUnmatched() {
    const unmatched = s.assignments.find((a) => !a.meaningId);
    if (!unmatched) return false;
    const paragraph = s.passages.find((p) => p.id === unmatched.paragraphId);
    const examples = reviewedExamples();
    const recommendation = await tools.ask("Explain this occurrence and recommend a self-contained definition in the target language. Do not put internal IDs, workflow instructions, or discussion of existing-meaning IDs into the definition. If an existing meaning fits, return its ID as meaningId and repeat its definition without inventing a duplicate sense; otherwise meaningId is null." + (examples.length ? reviewedRule : ""),
      { paragraph, occurrenceId: unmatched.occurrenceId, existingMeanings: meaningViews, ...(examples.length ? { reviewedExamples: examples } : {}) },
      '{"meaningId":"ID of the existing meaning that fits, or null","definition":"suggested definition","translation":"whole paragraph in target language"}');
    const meaningId = meanings.some((m) => m.id === recommendation.meaningId) ? recommendation.meaningId : null;
    s.pendingDecision = { kind: "unmatched", ...unmatched, paragraph, recommendation: { ...recommendation, meaningId } };
    return true;
  }
  branch(tools, "assign").finishActivity?.(`${s.assignments.length} sampled occurrences assigned.`);
  if (await reviewUnmatched()) return { pending: true };
  let missing = meanings.filter((m) => !s.assignments.some((a) => a.meaningId === m.id));
  const scanned = new Set(s.recoveryScanned ?? []);
  const considered = new Set([...s.passages.map((p) => p.id), ...scanned, ...(s.excludedParagraphIds ?? [])]);
  const needsRecovery = meanings.some((m) => !s.assignments.some((a) => a.meaningId === m.id));
  if (needsRecovery) {
    if (s.sampling?.version === 2) await prepareRecoveryPopulation(s, tools);
    else await tools.evidence?.("population");
  }
  const budget = Math.min(500, s.recoveryBudget ?? 100);
  const pool = needsRecovery ? shuffled(s.population ?? [], s.scope.seed + 1).filter((p) => !considered.has(p.id)) : [];
  if (pool.length && !s.recoveryProfiles) {
    const profile = await branch(tools, "recovery").ask("Suggest source-language context clues for finding EACH missing meaning. Use up to six short words or phrases per meaning, including natural synonyms and contrasting contexts. Do not include the researched word itself, generic stop words or claims that any occurrence exists. These clues only rank saved paragraphs; they never prove a match.",
      { sourceLanguage: s.scope.sourceLanguage, meanings: missing.map(({ id, definition }) => ({ id, definition })) },
      '{"profiles":[{"meaningId":"supplied ID","clues":["source-language clue"]}]}', "Planning targeted missing-meaning searches");
    const profiles = array(profile.profiles, "Recovery search clues");
    if (profiles.length !== missing.length || new Set(profiles.map((p) => p.meaningId)).size !== missing.length
      || profiles.some((p) => !missing.some((m) => m.id === p.meaningId) || !Array.isArray(p.clues) || p.clues.length > 6 || p.clues.some((c) => typeof c !== "string"))) throw new Error("Missing-meaning search clues were incomplete.");
    s.recoveryProfiles = profiles;
  }
  const extra = rankRecoveryParagraphs(pool, (s.recoveryProfiles ?? []).filter((p) => missing.some((m) => m.id === p.meaningId)), s.scope.seed)
    .slice(0, Math.max(0, budget - scanned.size));
  for (let offset = 0; missing.length && offset < extra.length; offset += 50) {
    const batch = extra.slice(offset, offset + 50);
    const recovery = branch(tools, "recovery");
    const id = `batch-${scanned.size}`;
    recovery.planActivity?.([{ id, label: `Check additional paragraphs ${scanned.size + 1}–${scanned.size + batch.length} for ${missing.length} missing meanings` }]);
    const batchTools = branch(recovery, id);
    const before = s.passages.length;
    const result = await batchTools.ask("Find at most ONE exact witness for EACH supplied missing meaning in this batch, checking all missing meanings. Compare with all definitions to avoid misclassifying a broad or merely related use. Return matches only for clearly supported occurrences; omit a meaning when no witness fits. Do not classify unrelated occurrences or copy passages. " + wordMeaningRule,
      { meanings: meaningViews, missingMeaningIds: missing.map((m) => m.id), paragraphs: decisionParagraphs(batch, s) },
      '{"matches":[{"meaningId":"missing ID","paragraphId":"supplied ID","occurrenceId":"supplied occurrence ID"}]}',
      `Checking missing meanings: paragraphs ${scanned.size + 1}–${scanned.size + batch.length} of ${budget}`);
    const matches = array(result.matches, "Missing-meaning witnesses").map(({ meaningId, paragraphId, occurrenceId }) => ({ meaningId, paragraphId, occurrenceId }));
    if (new Set(matches.map((m) => m.meaningId)).size !== matches.length
      || new Set(matches.map((m) => `${m.paragraphId}:${m.occurrenceId}`)).size !== matches.length
      || matches.some((m) => !missing.some((known) => known.id === m.meaningId)
        || !batch.find((p) => p.id === m.paragraphId)?.occurrences.some((o) => o.id === m.occurrenceId))) throw new Error("A recovery witness has a missing, duplicated or unknown meaning/occurrence.");
    const retained = batch.filter((p) => matches.some((m) => m.paragraphId === p.id)).map((p) => ({ ...p, recovered: true }));
    const singles = retained.filter((p) => p.occurrences.length === 1).map((p) => ({ ...matches.find((m) => m.paragraphId === p.id) }));
    const multiple = retained.filter((p) => p.occurrences.length > 1);
    const assigned = [...singles, ...(multiple.length ? await classify(multiple, "Assigning every occurrence in recovered paragraphs", batchTools) : [])];
    const unconfirmed = matches.filter((m) => !assigned.some((a) => a.paragraphId === m.paragraphId && a.occurrenceId === m.occurrenceId && a.meaningId === m.meaningId));
    if (unconfirmed.length) s.recoveryUnconfirmed = [...(s.recoveryUnconfirmed ?? []), ...unconfirmed];
    for (const p of batch) scanned.add(p.id);
    s.recoveryScanned = [...scanned];
    for (const meaning of missing) {
      const first = assigned.find((a) => a.meaningId === meaning.id);
      if (!first) continue;
      const paragraph = batch.find((p) => p.id === first.paragraphId);
      if (!s.passages.some((p) => p.id === paragraph.id)) {
        s.passages = [...s.passages, { ...paragraph, recovered: true }];
        s.assignments.push(...assigned.filter((a) => a.paragraphId === paragraph.id));
      }
    }
    missing = missing.filter((m) => !s.assignments.some((a) => a.meaningId === m.id));
    batchTools.finishActivity?.(`${batch.length} paragraphs checked; ${s.passages.length - before} examples added; ${missing.length} meanings still without examples.${unconfirmed.length ? ` ${unconfirmed.length} potential witnesses were not confirmed by full occurrence assignment.` : ""}`);
    s.recoveryConsidered = scanned.size;
    await tools.checkpoint?.(`Checked ${scanned.size} additional paragraphs · ${missing.length} meanings still without examples`);
  }
  branch(tools, "recovery").finishActivity?.(`${scanned.size} additional paragraphs checked; ${missing.length} meanings remain without corpus examples.`);
  for (const m of meanings) m.unused = missing.some((missing) => missing.id === m.id);
  if (await reviewUnmatched()) return { pending: true };
  s.displayTranslations ??= {};
  branch(tools, "translations").finishActivity?.("Preliminary bilingual reading aids are prepared when requested; source assignments are ready for review.");
  return { meanings: s.meanings, assignments: s.assignments, paragraphs: s.passages.length, recoveryConsidered: s.recoveryConsidered ?? 0, recoveryBudget: budget, recoveryUnconfirmed: s.recoveryUnconfirmed ?? [] };
}

export async function prepareReadingTranslations(s, tools, paragraphIds) {
  s.displayTranslations ??= {};
  const untranslated = s.passages.filter((p) => paragraphIds.includes(p.id) && !s.displayTranslations[p.id]);
  const display = branch(tools, "translations");
  display.planActivity?.(Array.from({ length: Math.ceil(untranslated.length / 15) }, (_, i) => ({ id: `batch-${i * 15}`, label: `Preliminary translations · paragraphs ${i * 15 + 1}–${Math.min(untranslated.length, (i + 1) * 15)} of ${untranslated.length}` })));
  let next = 0; let completed = 0; let failure;
  async function prepareBatch(index) {
    const batch = untranslated.slice(index, index + 15);
    const payload = { ...s.model,
      sourceLanguage: s.scope.sourceLanguage.name, targetLanguage: s.scope.targetLanguage.name,
      sourceLanguageCode: s.scope.sourceLanguage.code, targetLanguageCode: s.scope.targetLanguage.code,
      glossaryHints: [], rows: batch.map((p, i) => ({ rowId: String(i + 1), sourceText: p.text })),
    };
    try {
      const response = await branch(display, `batch-${index}`).run("translate", payload,
        `Preparing preliminary translations without glossary guidance · ${index + 1}–${index + batch.length} of ${untranslated.length} paragraphs`);
      if (!Array.isArray(response.rows) || response.rows.length !== batch.length) throw new Error("Usage-example translations were incomplete.");
      const translated = batch.map((p, i) => {
        const text = response.rows.find((r) => r.rowId === String(i + 1))?.translatedText;
        if (!text) throw new Error("A usage example has no translation.");
        return [p.id, text];
      });
      for (const [id, text] of translated) s.displayTranslations[id] = text;
      completed += batch.length;
      // run() already persisted the complete tool response. Stage completion or
      // Pause saves display fields; a crash can replay the durable cached batch.
      tools.reportProgress?.(`Prepared preliminary translations without glossary guidance · ${completed} of ${untranslated.length} paragraphs`);
    } catch (error) {
      // Set failure before any await, so the other worker cannot dispatch another
      // batch while the failed request's compact signature is being prepared.
      failure ??= { error, payload };
    }
  }
  // These are independent reading aids, after source-only classification and
  // recovery. Research tests/repairs remain sequential and never consume them.
  async function worker() {
    while (!failure && next < untranslated.length) {
      const index = next; next += 15;
      await prepareBatch(index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(2, Math.ceil(untranslated.length / 15)) }, worker));
  tools.assertCurrent?.();
  if (failure) {
    s.lastToolSignature = await studioToolSignature("translate", failure.payload);
    throw failure.error;
  }
  display.finishActivity?.(`${s.passages.length} preliminary bilingual examples ready. These translations are not used as evidence in later tests.`);
  return s.displayTranslations;
}
