// Glossary Research engine: dictionary → word forms → sample → discovery →
// proposal → (review pause) → freeze → counting → summary.
//
// Everything the engine touches is injected, so it runs the same in the app
// and in node tests:
//   model.call(request, onDelta)  one streamed request → Rust-style outcome
//   corpus                        forms / counts / seeded sample / neighbours
//   dictionary.lookup(term)       tiered dictionary result
//   store.load(name) / save       checkpoints (a run can resume)
//   log(event)                    research log lines
// Counting is done in code; the model only judges.

import {
  BudgetExceededError,
  createBudget,
  formatUsd,
  usageCost,
  worstCaseCost,
} from "./glossary-research-budget.js";
import {
  buildOccurrences,
  fold,
  markedPassage,
  snippet,
} from "./glossary-research-occurrences.js";
import * as prompts from "./glossary-research-prompts.js";
import { aggregateCounts, mergeJudgeCountings } from "./glossary-research-aggregate.js";
import {
  MIN_SENSE_SAMPLE,
  RESEARCH_DATA_CONTACT,
  combinedZipf,
  dataLanguage,
  describeSense,
  formatZipf,
  senseZipf,
} from "./glossary-research-frequency.js";

export const RESEARCH_DEFAULTS = {
  sampleSize: 100,
  discoverySize: 30,
  spendingLimitUsd: 4,
  seed: "1",
  workers: 6,
  discoveryBatch: 10,
  countBatch: 8,
  effortLight: "low",
  effortProposal: "medium",
  effortStudy: "high",
  pauseForReview: true,
  maxRetries: 2,
  judges: 2,
  frequencyChecks: true,
  senseSample: 100,
  maxSenseChecks: 6,
};

/** Languages whose frequency list counts syllables, or that are written without spaces: count words in the corpus instead. */
const CORPUS_COUNTED = new Set(["vi", "km", "th", "lo", "my"]);
export function corpusCounted(code) {
  return CORPUS_COUNTED.has(dataLanguage(code));
}

/** Words of a rendering, lower case, split at anything that is not a letter or digit. */
export function renderingTokens(text) {
  return fold(String(text ?? "")).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** Variants that contain a word whose check failed (or are a failed candidate). */
export function failedVariants(proposal, checks) {
  if (!checks) return [];
  const words = (checks.failedWords ?? []).map((w) => fold(w).trim()).filter(Boolean);
  const targets = new Set((checks.failedTargets ?? []).map((t) => fold(t).trim()));
  const found = [];
  for (const entry of proposal.entries) {
    for (const variant of entry.variants) {
      const key = fold(variant.target).trim();
      const word = words.find((w) => renderingTokens(variant.target).some((token) => token.includes(w)));
      if (targets.has(key) || word) found.push({ entryId: entry.id, variantId: variant.id, target: variant.target, word: word ?? variant.target });
    }
  }
  return found;
}

export class ResearchStop extends Error {
  constructor(message, kind = "stopped") {
    super(message);
    this.name = "ResearchStop";
    this.kind = kind; // "budget" | "cancelled" | "no-texts" | "failed"
  }
}

/**
 * One item per case-insensitive spelling, keeping the lowercase spelling when
 * it is present (so "Íntimo", "ÍNTIMO" and "íntimo" become "íntimo").
 */
export function mergeCaseVariants(items, spelling) {
  const groups = new Map();
  for (const item of items) {
    const text = String(spelling(item) ?? "").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    const current = groups.get(key);
    if (!current || (text === key && String(spelling(current)).trim() !== key)) {
      groups.set(key, { ...item, form: text === key ? text : spelling(current ?? item) });
    }
  }
  return [...groups.values()];
}

export function stripAccents(text) {
  return String(text).normalize("NFD").replace(/\p{Mn}/gu, "").normalize("NFC");
}

/** `form` with the accents `model` has at the same letters (the case of `form` kept). */
export function transferAccents(model, form) {
  const m = [...String(model).normalize("NFC")];
  const f = [...String(form).normalize("NFC")];
  return f.map((letter, index) => {
    const source = m[index];
    const plain = stripAccents(letter);
    if (!source || plain !== letter || stripAccents(source) === source) return letter;
    if (stripAccents(source).toLowerCase() !== plain.toLowerCase()) return letter;
    return letter === letter.toUpperCase() ? source.toUpperCase() : source.toLowerCase();
  }).join("");
}

/**
 * The same spellings with and without accents: each form stripped of its
 * accents, and each form given the accents another form has. The search
 * treats accented and unaccented spellings as different words.
 */
export function accentCounterparts(forms) {
  const known = new Set(forms.map((form) => form.toLowerCase()));
  const found = new Map();
  const add = (form) => {
    const key = form.toLowerCase();
    if (!known.has(key) && !found.has(key)) found.set(key, form);
  };
  for (const a of forms) {
    add(stripAccents(a));
    for (const b of forms) if (a !== b) add(transferAccents(a, b));
  }
  return [...found.values()];
}

/** Stable 53-bit string hash (cyrb53), hex. Used for versions and seeds. */
export function stableHash(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

function seededRandom(seed) {
  let state = Number.parseInt(stableHash(seed).slice(-8), 16) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(values, seed) {
  const random = seededRandom(seed);
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function groupByItem(occurrences) {
  const groups = new Map();
  for (const occurrence of occurrences) {
    if (!groups.has(occurrence.itemId)) groups.set(occurrence.itemId, []);
    groups.get(occurrence.itemId).push(occurrence);
  }
  return groups;
}

/** Occurrences grouped by passage into batches of at most `size`. */
export function batchOccurrences(items, occurrences, size) {
  const byItem = groupByItem(occurrences);
  const batches = [];
  let current = { items: [], occurrences: [] };
  for (const item of items) {
    const group = byItem.get(item.itemId);
    if (!group) continue;
    if (current.occurrences.length && current.occurrences.length + group.length > size) {
      batches.push(current);
      current = { items: [], occurrences: [] };
    }
    current.items.push(item);
    current.occurrences.push(...group);
  }
  if (current.occurrences.length) batches.push(current);
  return batches;
}

function batchContent(batch, entryLabel) {
  const byItem = groupByItem(batch.occurrences);
  const parts = batch.items.map((item) => {
    const group = byItem.get(item.itemId);
    const header = [`### Passage ${group[0].occId.split(".")[0]}`];
    if (entryLabel) {
      for (const occurrence of group) header.push(`${occurrence.occId}: use ${entryLabel(occurrence.entryId)}`);
    }
    return `${header.join("\n")}\n${markedPassage(item, group)}`;
  });
  const ids = batch.occurrences.map((occurrence) => occurrence.occId).join(", ");
  return `${parts.join("\n\n")}\n\nReturn one item for each of: ${ids}`;
}

// --- the budgeted model client ---------------------------------------------------

export function createModelClient({ model, prices, budget, log, isCancelled, maxRetries }) {
  let sequence = 0;
  async function callJson(request) {
    let attempt = 0;
    let maxOutputTokens = request.maxOutputTokens;
    for (;;) {
      if (isCancelled()) throw new ResearchStop("Research was cancelled.", "cancelled");
      const reserve = worstCaseCost(prices, request.instructions, request.content, maxOutputTokens, request.webSearchDomains?.length ? 4 : 0);
      if (!budget.fitsAtAll(reserve)) {
        throw new BudgetExceededError(reserve, budget.spent, budget.reserved, budget.limit);
      }
      budget.reserve(reserve);
      sequence += 1;
      const requestId = `${request.stage}-${sequence}-${Date.now().toString(36)}`;
      log({ type: "request", stage: request.stage, requestId, text: request.content, instructions: request.instructions, purpose: request.purpose, batch: request.batch ?? null });
      const started = Date.now();
      let outcome;
      try {
        outcome = await model.call({ ...request, maxOutputTokens, requestId },
          (kind, delta) => log({ type: kind === "thinking" ? "thinking" : "answer-delta", requestId, text: delta }));
      } catch (error) {
        outcome = { status: "failed", message: String(error?.message ?? error), retryable: false, billedUnknown: true };
      }
      const seconds = (Date.now() - started) / 1000;
      const usage = outcome.usage ?? null;
      const unknown = outcome.status === "cancelled" || (outcome.status === "failed" && outcome.billedUnknown);
      const cost = unknown ? reserve : usage ? usageCost(prices, usage) : 0;
      const record = budget.settle(reserve, cost, {
        stage: request.stage, attempt, status: outcome.status, seconds,
        inputTokens: usage?.inputTokens ?? null, cachedTokens: usage?.cachedTokens ?? null,
        cacheWriteTokens: usage?.cacheWriteTokens ?? null, outputTokens: usage?.outputTokens ?? null,
        reasoningTokens: usage?.reasoningTokens ?? null, costIsEstimate: unknown,
      });
      log({ type: "usage", requestId, record, spent: budget.spent, limit: budget.limit });
      if (outcome.status === "cancelled") throw new ResearchStop("Research was cancelled.", "cancelled");
      if (outcome.status === "ok") {
        try {
          const parsed = JSON.parse(outcome.text);
          log({ type: "answer", requestId, text: outcome.text });
          return parsed;
        } catch {
          outcome = { status: "incomplete", reason: "malformed JSON" };
        }
      }
      const problem = outcome.status === "incomplete" ? outcome.reason : outcome.message;
      log({ type: "problem", requestId, text: problem });
      const retryable = outcome.status === "incomplete"
        ? !String(outcome.reason).startsWith("refusal")
        : outcome.retryable;
      if (!retryable || attempt >= maxRetries) {
        throw new ResearchStop(`${request.stage}: ${problem}`, "failed");
      }
      if (outcome.reason === "max_tokens") maxOutputTokens = Math.ceil(maxOutputTokens * 1.6);
      attempt += 1;
      await new Promise((resolve) => setTimeout(resolve, Math.min(15000, 1000 * 2 ** attempt)));
    }
  }

  /** Run requests concurrently inside the budget; returns results by key. */
  async function callMany(keyed, workers) {
    const results = new Map();
    // Requests of one call run side by side; the log groups them by this key.
    const batchKey = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const pending = keyed.map(([key, request], index) => [key, {
      ...request, batch: { key: batchKey, number: index + 1, total: keyed.length },
    }]);
    const running = new Set();
    let stop = null;
    const launch = ([key, request]) => {
      const promise = callJson(request)
        .then((value) => results.set(key, value))
        .catch((error) => {
          results.set(key, error);
          if (error instanceof BudgetExceededError || error?.kind === "cancelled") stop = error;
        })
        .finally(() => running.delete(promise));
      running.add(promise);
    };
    while (pending.length || running.size) {
      while (pending.length && running.size < workers && !stop) {
        const [, request] = pending[0];
        const need = worstCaseCost(prices, request.instructions, request.content, request.maxOutputTokens, request.webSearchDomains?.length ? 4 : 0);
        if (!budget.fitsAtAll(need)) {
          stop = new BudgetExceededError(need, budget.spent, budget.reserved, budget.limit);
          break;
        }
        if (!budget.fitsNow(need)) break; // wait for in-flight work to settle
        launch(pending.shift());
      }
      if (!running.size) break;
      await Promise.race(running);
    }
    if (stop && (pending.length || stop.kind === "cancelled")) {
      throw stop instanceof BudgetExceededError
        ? new ResearchStop(stop.message, "budget")
        : stop;
    }
    return results;
  }

  return { callJson, callMany };
}

// --- the engine ------------------------------------------------------------

export function createResearchEngine(deps) {
  const settings = { ...RESEARCH_DEFAULTS, ...deps.settings };
  const { corpus, dictionary, store, log } = deps;
  const languageData = deps.languageData ?? null;
  const glossaryTerms = deps.glossaryTerms ?? [];
  const languageStatus = {};
  const budget = createBudget(settings.spendingLimitUsd, store.load("usage") ?? []);
  let cancelled = false;
  const client = createModelClient({
    model: deps.model, prices: deps.prices, budget, log,
    isCancelled: () => cancelled, maxRetries: settings.maxRetries,
  });
  const saveUsage = () => store.save("usage", budget.records);
  const heading = (text) => log({ type: "heading", text });
  const fact = (text) => log({ type: "fact", text });
  const info = (text) => log({ type: "info", text });

  /** The language's frequency data is on this computer (downloaded the first time), or the run goes on without it. */
  async function frequencyReady(code, name) {
    if (!settings.frequencyChecks || !languageData) return false;
    const key = dataLanguage(code);
    if (!(key in languageStatus)) {
      info(`Preparing the ${name} frequency data (downloaded once, the first time).`);
      const status = await languageData.ensure(code);
      languageStatus[key] = status.available === true;
      if (status.available) {
        info(`${name} frequency data ready: ${status.corpus ?? "general corpus"}, ${status.sentences ?? "?"} sentences.`);
      } else {
        log({ type: "problem", text: `Frequency data for ${name} is not available${status.error ? ` (${status.error})` : ""}. To ask for it to be added, write to ${RESEARCH_DATA_CONTACT}. The research continues without Zipf scores.` });
      }
    }
    return languageStatus[key];
  }

  /**
   * Sort a seeded sample of general-corpus sentences containing the forms by sense.
   * The word's own score comes from the frequency list, or, for languages where a
   * search also matches letters inside other words, from the corpus matches that
   * really are the word.
   */
  async function measureSenses({ code, name, forms, senses, purpose, listZipf }) {
    const general = await languageData.sentences(code, forms, settings.senseSample, `${settings.seed}:${dataLanguage(code)}:${forms.join("|")}`);
    const result = {
      forms, hits: general.hits, tokens: general.corpusTokens ?? null, corpus: general.corpus ?? null,
      classified: 0, notWord: 0, other: 0, instances: 0, counts: {}, wordZipf: listZipf > 0 ? listZipf : 0, wordZipfSource: "list", senses: {},
    };
    if (general.sample.length) {
      const answer = await client.callJson({
        stage: "frequency", purpose,
        instructions: prompts.senseClassifyInstructions({ languageName: name, word: forms[0], senses }),
        content: general.sample.map((text, index) => `${index + 1}. ${text.length > 400 ? `${text.slice(0, 400)}…` : text}`).join("\n"),
        schema: prompts.senseClassifySchema(senses.map((sense) => sense.id)), schemaName: "senses",
        maxOutputTokens: 800 + 16 * general.sample.length, effort: settings.effortLight,
      });
      const seen = new Set();
      for (const item of answer.items) {
        if (!(item.n >= 1 && item.n <= general.sample.length) || seen.has(item.n)) continue;
        seen.add(item.n);
        result.classified += 1;
        if (item.sense === "not_this_word") result.notWord += 1;
        else if (item.sense === "other") result.other += 1;
        else result.counts[item.sense] = (result.counts[item.sense] ?? 0) + 1;
      }
    }
    result.instances = result.classified - result.notWord;
    if ((corpusCounted(code) || !(listZipf > 0)) && general.corpusTokens) {
      const realHits = result.classified ? general.hits * (result.instances / result.classified) : 0;
      result.wordZipf = realHits > 0 ? Math.log10((realHits / general.corpusTokens) * 1e9) : 0;
      result.wordZipfSource = "corpus";
    }
    for (const sense of senses) result.senses[sense.id] = senseZipf(result.wordZipf, result.counts[sense.id] ?? 0, result.instances);
    return result;
  }

  const ctx = (extra = {}) => ({
    headword: settings.term,
    sourceName: settings.sourceLanguageName,
    targetName: settings.targetLanguageName,
    reportName: settings.reportLanguageName,
    corpusDescription: corpus.description,
    dictionaryText: store.load("dictionary")?.text ?? "",
    forms: store.load("forms")?.confirmed ?? [settings.term],
    targetCode: settings.targetLanguageCode,
    reportCode: settings.reportLanguageCode ?? "",
    authorName: corpus.authorName ?? "the author",
    ...extra,
  });

  async function stage(name, fn) {
    const found = store.load(name);
    if (found !== undefined && found !== null) return found;
    const value = await fn();
    store.save(name, value);
    saveUsage();
    return value;
  }

  async function lookUpDictionary() {
    return stage("dictionary", async () => {
      heading("Dictionary");
      let result = await dictionary.lookup(settings.term, (line) => info(line));
      if (result.status !== "found" && settings.webDictionaryDomains?.length) {
        info("No dictionary entry yet; asking the AI to search dictionary sites.");
        const found = await client.callJson({
          stage: "dictionary", purpose: "search dictionary sites for definitions",
          instructions: `You look up the ${settings.sourceLanguageName} word “${settings.term}” in published dictionaries using web search, only on dictionary sites. Copy each sense's definition faithfully (in the dictionary's own language), with its number and grammatical labels, and give the page address. Never write definitions from memory: if the search finds no dictionary entry for this exact word, return found=false and no entries.`,
          content: `Word: ${settings.term}\nLanguage: ${settings.sourceLanguageName}`,
          schema: prompts.WEB_DICTIONARY_SCHEMA, schemaName: "web_dictionary",
          maxOutputTokens: 6000, effort: settings.effortLight,
          webSearchDomains: settings.webDictionaryDomains,
        }).catch((error) => {
          info(`dictionary search failed: ${error.message}`);
          return null;
        });
        if (found?.found && found.entries.some((entry) => entry.senses.length)) {
          const lines = [];
          for (const entry of found.entries) {
            lines.push(`${entry.sourceName} (${entry.url}):`);
            for (const sense of entry.senses) lines.push(`  ${sense.number}. ${sense.labels} ${sense.definition}`.trimEnd());
          }
          result = {
            status: "found", sourceName: found.entries.map((entry) => entry.sourceName).join("; "),
            url: found.entries[0].url, text: lines.join("\n"),
            senseCount: found.entries.reduce((sum, entry) => sum + entry.senses.length, 0),
            complexFormCount: 0, tried: [...result.tried, "AI web search"], notes: result.notes,
            webEntries: found.entries,
          };
        } else {
          result = { ...result, tried: [...result.tried, "AI web search"] };
        }
      }
      for (const note of result.notes ?? []) fact(note);
      fact(result.status === "found"
        ? `${result.sourceName}: found (${result.senseCount} senses${result.complexFormCount ? `, ${result.complexFormCount} complex forms` : ""})`
        : result.status === "not_found"
          ? `No dictionary entry found (${result.tried.join(", ")})`
          : `Dictionary unreachable (${result.tried.join(", ")}) — continuing without it`);
      return result;
    });
  }

  async function findForms() {
    return stage("forms", async () => {
      heading("Word forms");
      const hint = corpus.formsHint ? await corpus.formsHint(settings.term) : null;
      if (hint?.forms?.length) {
        info(`Word list of the texts: ${hint.forms.map((f) => `${f.form} (${f.rows})`).join(", ")}`);
      }
      const proposeCtx = ctx({
        userVariants: settings.variants,
        existingSourceTerms: settings.existingEntries.flatMap((entry) => entry.sourceTerms),
        corpusForms: (hint?.forms ?? []).map((f) => f.form),
      });
      const proposed = await client.callJson({
        stage: "forms", purpose: "propose word forms",
        instructions: prompts.formsProposeInstructions(proposeCtx),
        content: prompts.formsProposeContent(proposeCtx),
        schema: prompts.FORMS_PROPOSE_SCHEMA, schemaName: "forms",
        maxOutputTokens: 3000, effort: settings.effortLight,
      });
      // Matching ignores case, so forms differing only in capitals are one
      // form (the lowercase spelling is kept); accent variants stay separate.
      const proposedForms = mergeCaseVariants(
        [{ form: settings.term, kind: "user", confidence: "high" }, ...proposed.forms],
        (f) => f.form,
      );
      // The AI can overlook spellings, so every form in the texts' word list
      // and every accented/unaccented counterpart is checked too; the confirm
      // step decides whether each is the same word.
      const extra = mergeCaseVariants([
        ...(hint?.forms ?? []).map((f) => ({ form: f.form, kind: "text", confidence: "medium" })),
        ...accentCounterparts(proposedForms.map((f) => f.form)).map((form) => ({ form, kind: "spelling", confidence: "medium" })),
      ], (f) => f.form).filter((f) => !proposedForms.some((p) => p.form.toLowerCase() === f.form.toLowerCase()));
      const counted = [];
      for (const candidate of [...proposedForms, ...extra]) {
        const count = await corpus.countForm(candidate.form);
        const added = !proposedForms.includes(candidate);
        if (added && !count.rows) continue;
        counted.push({ ...candidate, rows: count.rows, examples: count.examples });
        info(`search “${candidate.form}”: ${count.rows} passages${added ? " (added: word list or accent spelling)" : ""}`);
      }
      const confirmCtx = ctx();
      const content = counted.map((c) => [
        `“${c.form}” (${c.kind}, confidence ${c.confidence}): ${c.rows} passages`,
        ...c.examples.slice(0, 2).map((e) => `   ${snippet(e.text, e.start, e.end, 90)}`),
      ].join("\n")).join("\n");
      const confirmed = await client.callJson({
        stage: "forms", purpose: "confirm word forms against the texts",
        instructions: prompts.formsConfirmInstructions(confirmCtx), content,
        schema: prompts.FORMS_CONFIRM_SCHEMA, schemaName: "forms_confirm",
        maxOutputTokens: 3000, effort: settings.effortLight,
      });
      const keep = new Set(confirmed.forms.filter((f) => f.keep).map((f) => f.form.trim().toLowerCase()));
      keep.add(settings.term.trim().toLowerCase());
      const forms = counted.filter((c) => keep.has(c.form.trim().toLowerCase()));
      const inTexts = forms.filter((f) => f.rows > 0).map((f) => f.form);
      const notFound = forms.filter((f) => f.rows === 0).map((f) => f.form);
      fact(`Forms: ${inTexts.join(", ") || "none found"}${notFound.length ? `; kept though not in the texts: ${notFound.join(", ")}` : ""}`);
      const dropped = confirmed.forms.filter((f) => !f.keep);
      if (dropped.length) info(`dropped: ${dropped.map((f) => `${f.form} (${f.reason})`).join("; ")}`);
      return { confirmed: forms.map((f) => f.form), searched: inTexts, notFound, candidates: counted.map((c) => ({ form: c.form, kind: c.kind, confidence: c.confidence, rows: c.rows })), decisions: confirmed.forms, related: hint?.related ?? [] };
    });
  }

  /** Words built on the headword (prefixed, suffixed, compounds, phrases) that occur in the texts. */
  async function findFamily() {
    return stage("family", async () => {
      heading("Word family");
      const forms = store.load("forms");
      const known = new Set((forms.candidates ?? []).map((c) => fold(c.form).trim()));
      const proposed = await client.callJson({
        stage: "family", purpose: "list words built on the term",
        instructions: prompts.familyInstructions(ctx()),
        content: [
          `Headword: ${settings.term}`,
          `Forms in the study: ${forms.confirmed.join(", ")}`,
          `Words of the texts that extend the stem: ${(forms.related ?? []).map((r) => r.form).join(", ") || "none"}`,
          dictionaryText(),
        ].join("\n"),
        schema: prompts.FAMILY_SCHEMA, schemaName: "family",
        maxOutputTokens: 3000, effort: settings.effortLight,
      }).catch((error) => {
        info(`word family not listed: ${error.message}`);
        return { words: [] };
      });
      const candidates = mergeCaseVariants([
        ...(forms.related ?? []).map((r) => ({ form: r.form, kind: "suffixed" })),
        ...proposed.words,
      ], (w) => w.form).filter((w) => !known.has(fold(w.form).trim())).slice(0, 45);
      const members = [];
      for (const candidate of candidates) {
        const count = await corpus.countForm(candidate.form).catch(() => ({ rows: 0 }));
        if (count.rows) members.push({ form: candidate.form, kind: candidate.kind, rows: count.rows });
      }
      members.sort((a, b) => b.rows - a.rows);
      fact(members.length
        ? `Word family in the texts: ${members.map((m) => `${m.form} (${m.rows})`).join(", ")}`
        : "No other words built on the term occur in the texts.");
      return { members, searched: candidates.length };
    });
  }

  function dictionaryText() {
    const text = ctx().dictionaryText;
    return text ? `Dictionary entry:\n${text}` : "Dictionary entry: none found";
  }

  async function drawSample() {
    return stage("sample", async () => {
      heading("Sampling");
      const forms = store.load("forms").searched;
      if (!forms.length) {
        throw new ResearchStop(`“${settings.term}” does not occur in the selected texts.`, "no-texts");
      }
      const population = await corpus.population(forms);
      const n = Math.min(settings.sampleSize, population.distinct);
      const poolSize = Math.min(population.distinct, n + settings.discoverySize);
      const pool = await corpus.sample(forms, poolSize, settings.seed);
      const measured = pool.items.slice(0, n);
      let discovery = pool.items.slice(n, n + settings.discoverySize);
      let overlap = 0;
      if (discovery.length < Math.min(settings.discoverySize, 12)) {
        const extra = measured.slice().reverse().slice(0, Math.min(settings.discoverySize, pool.items.length) - discovery.length);
        overlap = extra.length;
        discovery = [...discovery, ...extra];
      }
      const neighbours = corpus.collocations ? await corpus.collocations(forms) : [];
      fact(`${population.rows} matching passages, ${population.distinct} distinct (${population.duplicateGroups} duplicate groups); measuring ${n}, discovery ${discovery.length}${overlap ? ` (overlap ${overlap})` : ""}`);
      return {
        meta: { ...pool.meta, populationRows: population.rows, populationDistinct: population.distinct, duplicateGroups: population.duplicateGroups },
        nRequested: settings.sampleSize, nActual: n, overlap,
        measuredIds: measured.map((i) => i.itemId), discoveryIds: discovery.map((i) => i.itemId),
        items: Object.fromEntries(pool.items.map((i) => [i.itemId, i])),
        neighbours,
      };
    });
  }

  function passageSnippet(item, radius = 380) {
    const first = item.occurrences[0];
    const body = first ? snippet(item.text, first.start, first.end, radius) : item.text.slice(0, 2 * radius);
    return `[${item.reference?.title ?? ""}]\n${body}`;
  }

  function authorPassages() {
    const sample = store.load("sample");
    return sample.discoveryIds.map((id) => passageSnippet(sample.items[id]));
  }

  /** Where the term comes from: the reference books the author read. */
  async function traceSources() {
    return stage("sources", async () => {
      heading("Where the term comes from");
      if (!corpus.sourceUsage) {
        info("The selected texts have no reference books to trace the term in.");
        return { skipped: true };
      }
      const forms = store.load("forms").searched;
      const usage = await corpus.sourceUsage(forms, settings.seed);
      if (!usage.length) {
        fact("None of the reference books uses the term.");
        return { skipped: true, counts: [] };
      }
      const byBook = new Map();
      for (const item of usage) {
        const title = item.reference?.title ?? "";
        const book = byBook.get(title) ?? { title, occurrences: 0, passages: 0, items: [] };
        book.occurrences += item.occurrences.length;
        book.passages += 1;
        book.items.push(item);
        byBook.set(title, book);
      }
      const ranked = [...byBook.values()].sort((a, b) => b.occurrences - a.occurrences);
      const total = ranked.reduce((sum, book) => sum + book.occurrences, 0) || 1;
      const top = ranked.filter((book) => book.occurrences / total >= 0.1).slice(0, 3);
      if (!top.length) top.push(ranked[0]);
      const others = ranked.filter((book) => !top.includes(book)).slice(0, 8);
      const mentions = [];
      for (const book of top) {
        const name = book.title.split(" — ")[0];
        const phrases = new Set([name.replace(/\s*\([^)]*\)\s*/g, " ").trim(), ...[...name.matchAll(/\(([^)]+)\)/g)].map((m) => m[1].trim())]);
        for (const phrase of [...phrases].filter((p) => p.length > 3)) {
          const found = corpus.authorMentions ? await corpus.authorMentions(phrase, settings.seed) : [];
          mentions.push(...found.map((item) => passageSnippet(item, 900)));
        }
      }
      const records = (corpus.sourceBooks ? await corpus.sourceBooks() : [])
        .filter((record) => ranked.slice(0, 11).some((book) => book.title === record.title));
      const recordLines = records.map((record) => {
        const parts = [record.title];
        if (record.translated) {
          parts.push(`translated from ${record.originalLanguage ?? "another language"}${record.originalTitle ? `: “${record.originalTitle}”${record.originalAuthor ? ` by ${record.originalAuthor}` : ""}` : ""}`);
          if (record.originalFirstPrinting) parts.push(`original first printed ${record.originalFirstPrinting}`);
          if (record.firstSpanishTranslation) parts.push(`first Spanish translation ${record.firstSpanishTranslation}`);
        } else {
          parts.push("written in Spanish");
        }
        const pairs = record.headwordPairs.length
          ? `\n  The book's own glossary pairs (${settings.sourceLanguageName} = original): ${record.headwordPairs.map((pair) => `${pair.source} = ${pair.original}`).join("; ")}`
          : "";
        return `- ${parts.join("; ")}${pairs}`;
      });
      const section = (title, lines) => `## ${title}\n${lines.length ? lines.join("\n\n") : "(none)"}`;
      // Where a book's own glossary pairs name the term's original word, read
      // that word in the book's original text before writing the study.
      const formKeys = new Set(forms.map((form) => fold(form).trim()));
      const originalSections = [];
      const searched = new Set();
      for (const book of top) {
        const record = records.find((item) => item.title === book.title);
        if (!record?.originalBookId || !corpus.originalSample) continue;
        const originals = [...new Set(record.headwordPairs
          .filter((pair) => formKeys.has(fold(pair.source).trim()))
          .map((pair) => pair.original))];
        if (!originals.length) continue;
        const found = await corpus.originalSample(record.originalBookId, originals, settings.seed);
        searched.add(`${record.originalBookId}:${fold(originals.join(",")).trim()}`);
        const name = record.originalTitle ?? book.title;
        info(`original text of ${name}: ${found.occurrences} occurrences of ${originals.map((o) => `“${o}”`).join(", ")} in ${found.paragraphs} passages`);
        originalSections.push(section(
          `The original text of ${name}: ${found.occurrences} occurrences of ${originals.map((o) => `“${o}”`).join(", ")} in ${found.paragraphs} passages (a sample)`,
          found.items.map((item) => passageSnippet({ ...item, reference: { title: name } })),
        ));
      }
      const content = [
        `# Term: ${settings.term}\nSpellings searched: ${forms.join(", ")}`,
        section("Dictionary entry", [ctx().dictionaryText || "(none found)"]),
        section("Occurrences in the reference books", [ranked.map((book) => `- ${book.title}: ${book.occurrences} occurrences in ${book.passages} passages`).join("\n")]),
        section("Records of the reference books", [recordLines.join("\n") || "(no records)"]),
        section(`Passages from the books that use it most (${top.map((book) => book.title).join("; ")})`, top.flatMap((book) => book.items.slice(0, 14).map((item) => passageSnippet(item)))),
        ...originalSections,
        section("One passage from each of the other books", others.map((book) => passageSnippet(book.items[0]))),
        section("Where the author names those books", mentions),
        section("A sample of the author's own uses", authorPassages()),
      ].join("\n\n");
      const study = await client.callJson({
        stage: "sources", purpose: "trace where the term comes from",
        instructions: prompts.sourcesInstructions(ctx()), content,
        schema: prompts.SOURCES_SCHEMA, schemaName: "sources",
        maxOutputTokens: 16000, effort: settings.effortStudy,
      });
      await checkOriginalTerms(study, top, records, searched);
      for (const sense of study.senses.filter((item) => !item.inDictionary)) {
        fact(`${sense.sense}${sense.sourceBook ? ` — from ${sense.sourceBook}` : ""}${sense.originalTerm ? ` (original ${sense.originalLanguage ?? ""} term “${sense.originalTerm}”)` : ""}`);
      }
      return {
        counts: ranked.map((book) => ({ title: book.title, occurrences: book.occurrences, passages: book.passages })),
        topBooks: top.map((book) => book.title),
        study,
      };
    });
  }

  /**
   * When the study only believes it knows the original word of a sense from a
   * translated book, check that word against the book's original text.
   */
  async function checkOriginalTerms(study, top, records, searched) {
    if (!corpus.originalSample) return;
    for (const sense of study.senses) {
      if (sense.inDictionary || !sense.originalTerm || !sense.sourceBook) continue;
      const book = top.find((item) => {
        const name = item.title.split(" — ")[0].replace(/\s*\([^)]*\)\s*/g, " ").trim().toLowerCase();
        return name && sense.sourceBook.toLowerCase().includes(name);
      });
      const record = book && records.find((item) => item.title === book.title);
      if (!record?.originalBookId || searched.has(`${record.originalBookId}:${fold(sense.originalTerm).trim()}`)) continue;
      const found = await corpus.originalSample(record.originalBookId, [sense.originalTerm], settings.seed, 10);
      const name = record.originalTitle ?? book.title;
      info(`original text of ${name}: ${found.occurrences} occurrences of “${sense.originalTerm}” in ${found.paragraphs} passages`);
      const content = [
        `Term: ${settings.term}. Proposed original word: “${sense.originalTerm}” (${sense.originalTermBasis}).`,
        `## The original text (${name}): ${found.occurrences} occurrences in ${found.paragraphs} passages (a sample)`,
        found.items.map((item) => passageSnippet({ ...item, reference: { title: name } })).join("\n\n") || "(no passage contains the proposed word)",
        `## The ${settings.sourceLanguageName} edition (${book.title})`,
        book.items.slice(0, 8).map((item) => passageSnippet(item)).join("\n\n"),
      ].join("\n\n");
      const check = await client.callJson({
        stage: "sources", purpose: `check the original word “${sense.originalTerm}”`,
        instructions: prompts.originalCheckInstructions(ctx()), content,
        schema: prompts.ORIGINAL_CHECK_SCHEMA, schemaName: "original_check",
        maxOutputTokens: 4000, effort: settings.effortProposal,
      });
      sense.originalCheck = { ...check, occurrences: found.occurrences, paragraphs: found.paragraphs };
      if (check.confirmed) {
        sense.originalTermBasis = `${check.basis} (checked in the original text)`;
      } else if (check.originalTerm) {
        sense.originalTerm = check.originalTerm;
        sense.originalTermBasis = `${check.basis} (corrected from the original text)`;
      } else {
        sense.originalTermBasis = `${sense.originalTermBasis}; not confirmed by the original text: ${check.basis}`;
      }
      if (check.meaningInOriginal) sense.meaningInOriginal = check.meaningInOriginal;
    }
  }

  /** Candidate translations for the term as a whole, before any passage-by-passage reading. */
  async function proposeCandidates() {
    return stage("candidates", async () => {
      heading("Candidate translations");
      const sources = store.load("sources");
      const content = [
        `# Term: ${settings.term}`,
        `## Dictionary entry\n${ctx().dictionaryText || "(none found)"}`,
        sources?.study ? `## Study of where the term comes from\n${JSON.stringify(sources.study, null, 1)}` : "",
        partsText(),
        `## Passages from the texts\n${authorPassages().join("\n\n")}`,
      ].filter(Boolean).join("\n\n");
      const result = await client.callJson({
        stage: "candidates", purpose: "propose candidate translations for the whole term",
        instructions: prompts.candidatesInstructions(ctx()), content,
        schema: prompts.CANDIDATES_SCHEMA, schemaName: "candidates",
        maxOutputTokens: 16000, effort: settings.effortStudy,
      });
      for (const sense of result.senses) {
        const recommended = sense.candidates.find((c) => c.recommended);
        fact(`${sense.sense}: ${recommended ? `${recommended.target} (recommended)` : "no recommendation"}${sense.candidates.filter((c) => !c.recommended).length ? `; also ${sense.candidates.filter((c) => !c.recommended).map((c) => c.target).join(", ")}` : ""}`);
      }
      return result;
    });
  }

  /** Take the term apart; score it and, sense by sense, the words it is built from. */
  async function studyParts() {
    return stage("parts", async () => {
      heading("Parts and frequency");
      const forms = store.load("forms").searched;
      const family = store.load("family")?.members ?? [];
      const sources = store.load("sources")?.study;
      const content = [
        `# Term: ${settings.term}\nForms in the texts: ${forms.join(", ")}`,
        `## Word family in the texts\n${family.map((m) => `- ${m.form} (${m.kind}, ${m.rows} passages)`).join("\n") || "(none found)"}`,
        `## ${dictionaryText()}`,
        sources?.summary ? `## Where the term comes from\n${sources.summary}` : "",
        `## Passages from the texts\n${authorPassages().slice(0, 15).join("\n\n")}`,
      ].filter(Boolean).join("\n\n");
      const study = await client.callJson({
        stage: "parts", purpose: "take the term apart and list its senses",
        instructions: prompts.partsInstructions(ctx()), content,
        schema: prompts.PARTS_SCHEMA, schemaName: "parts",
        maxOutputTokens: 6000, effort: settings.effortProposal,
      });
      fact(`Parts: ${study.parts.map((part) => `${part.part} (${part.meaning})`).join(" + ")}`);
      const result = { study, source: null };
      const code = settings.sourceLanguageCode;
      const name = settings.sourceLanguageName;
      if (!(await frequencyReady(code, name))) return result;
      const formZipfs = await languageData.zipf(code, forms);
      const listZipf = combinedZipf(formZipfs);
      const term = await measureSenses({
        code, name, forms, listZipf,
        senses: study.senses.map(({ id, gloss }) => ({ id, gloss })),
        purpose: `sort general ${name} sentences with “${settings.term}” by sense`,
      });
      const inDictionary = store.load("dictionary")?.status === "found";
      const invented = !inDictionary && !(term.wordZipf >= 1);
      const bases = [];
      if (study.isCompound) {
        for (const base of study.bases.slice(0, 3)) {
          const baseForms = [...new Set([base.word, ...base.forms].map((f) => f.trim()).filter(Boolean))];
          const baseList = combinedZipf(await languageData.zipf(code, baseForms));
          const measure = await measureSenses({
            code, name, forms: baseForms, listZipf: baseList,
            senses: [{ id: "needed", gloss: base.neededSense }, ...base.otherSenses.slice(0, 5).map((gloss, i) => ({ id: `o${i + 1}`, gloss }))],
            purpose: `sort general ${name} sentences with “${base.word}” by sense`,
          });
          bases.push({ word: base.word, neededSense: base.neededSense, measure, needed: measure.senses.needed ?? null });
          fact(`${name} “${base.word}”: Zipf ${formatZipf(measure.wordZipf)}; in the sense “${base.neededSense}”: ${describeSense(measure.senses.needed)}`);
        }
      }
      const familyZipfs = family.length ? await languageData.zipf(code, family.map((m) => m.form)) : [];
      result.source = {
        forms: forms.map((form, i) => ({ form, zipf: formZipfs[i] ?? 0 })),
        listZipf, wordZipf: term.wordZipf, inDictionary, invented, term, bases,
        family: family.map((m, i) => ({ ...m, zipf: familyZipfs[i] ?? 0 })),
      };
      const used = study.senses.filter((sense) => sense.usedByAuthor);
      fact(`${name} “${settings.term}”: Zipf ${formatZipf(term.wordZipf)}${invented ? " — not in the dictionary and practically absent from general use: the author's own word" : ""}${used.length ? `; senses the author uses, in general ${name}: ${used.map((sense) => `${sense.gloss} ${describeSense(term.senses[sense.id])}`).join("; ")}` : ""}`);
      return result;
    });
  }

  /** The source measurement a look-alike target word is compared with. */
  function sourceReference(resembles) {
    const parts = store.load("parts");
    const source = parts?.source;
    if (!source) return null;
    const key = fold(resembles ?? "").trim();
    const base = key && source.bases.find((b) => {
      const word = fold(b.word).trim();
      return word && (word === key || key.includes(word) || word.includes(key));
    });
    if (base?.needed) return { label: base.word, measure: base.needed };
    if (source.invented) return { label: settings.term, invented: true };
    const used = parts.study.senses.filter((sense) => sense.usedByAuthor)
      .map((sense) => source.term.senses[sense.id]).filter(Boolean)
      .sort((a, b) => (b.inSense ?? 0) - (a.inSense ?? 0));
    return used[0] ? { label: settings.term, measure: used[0] } : null;
  }

  /** Glossary entries for other terms that already use this translation. */
  function findClashes(target) {
    const key = fold(target).trim();
    const own = new Set([...(store.load("forms")?.confirmed ?? []), ...((store.load("family")?.members ?? []).map((m) => m.form))].map((f) => fold(f).trim()));
    return glossaryTerms
      .filter((term) => (term.targetTerms ?? []).some((t) => fold(t).trim() === key))
      .filter((term) => !(term.sourceTerms ?? []).some((t) => own.has(fold(t).trim())))
      .slice(0, 3)
      .map((term) => ({ sourceTerms: term.sourceTerms ?? [], targetTerms: term.targetTerms ?? [] }));
  }

  /** Every candidate against general target-language usage: whole words, and look-alike words sense by sense. */
  async function checkCandidates() {
    return stage("checks", async () => {
      heading("Candidate checks");
      const seen = new Set();
      const list = [];
      for (const sense of store.load("candidates")?.senses ?? []) {
        for (const candidate of sense.candidates) {
          const key = fold(candidate.target).trim();
          if (!key || seen.has(key)) continue;
          seen.add(key);
          list.push({ target: candidate.target, sense: sense.sense });
        }
      }
      if (!list.length) return { available: false, candidates: [], failedWords: [], failedTargets: [] };
      const parts = store.load("parts");
      const sources = store.load("sources")?.study;
      const analysis = await client.callJson({
        stage: "checks", purpose: "name each candidate's words and the senses they need",
        instructions: prompts.checkInstructions(ctx()),
        content: [
          `# Term: ${settings.term}`,
          `## Candidates\n${list.map((c) => `- ${c.target} (for: ${c.sense})`).join("\n")}`,
          parts?.study ? `## Parts of the term\n${parts.study.parts.map((p) => `- ${p.part}: ${p.meaning}`).join("\n")}` : "",
          sources ? `## Where the term comes from\n${JSON.stringify(sources.senses.map((x) => ({ sense: x.sense, sourceBook: x.sourceBook, originalLanguage: x.originalLanguage, originalTerm: x.originalTerm })), null, 1)}` : "",
        ].filter(Boolean).join("\n\n"),
        schema: prompts.CHECK_SCHEMA, schemaName: "checks",
        maxOutputTokens: 1500 + 350 * list.length, effort: settings.effortLight,
      });
      const code = settings.targetLanguageCode;
      const name = settings.targetLanguageName;
      const sourceName = settings.sourceLanguageName;
      const ready = await frequencyReady(code, name);
      const byTarget = new Map(analysis.candidates.map((c) => [fold(c.target).trim(), c]));
      const words = [...new Map(analysis.candidates.flatMap((c) => c.words).map((w) => [fold(w.word).trim(), w])).values()];
      const listZipfs = ready ? await languageData.zipf(code, words.map((w) => w.word)) : [];
      const zipfOf = new Map(words.map((w, i) => [fold(w.word).trim(), listZipfs[i] ?? null]));
      const measured = new Map();
      if (ready) {
        // Look-alikes are measured sense by sense; where a search also matches
        // letters inside other words, the other words get an instance check.
        const queue = [
          ...words.filter((w) => w.lookalike),
          ...(corpusCounted(code) ? words.filter((w) => !w.lookalike) : []),
        ].slice(0, settings.maxSenseChecks + (corpusCounted(code) ? 4 : 0));
        for (const w of queue) {
          const senses = w.lookalike
            ? [{ id: "needed", gloss: w.neededSense }, ...w.otherSenses.slice(0, 5).map((gloss, i) => ({ id: `o${i + 1}`, gloss }))]
            : [{ id: "needed", gloss: w.neededSense }];
          measured.set(fold(w.word).trim(), await measureSenses({
            code, name, forms: [w.word], senses, listZipf: zipfOf.get(fold(w.word).trim()),
            purpose: `sort general ${name} sentences with “${w.word}” by sense`,
          }));
        }
      }
      const source = parts?.source ?? null;
      const failedWords = [];
      const failedTargets = [];
      const candidates = list.map((c) => {
        const found = byTarget.get(fold(c.target).trim());
        const reasons = [];
        const notes = [];
        let verdict = ready ? "pass" : "unchecked";
        const items = (found?.words ?? []).map((w) => {
          const m = measured.get(fold(w.word).trim());
          return {
            word: w.word, neededSense: w.neededSense, lookalike: w.lookalike, resembles: w.resembles,
            zipf: m ? m.wordZipf : zipfOf.get(fold(w.word).trim()) ?? null,
            measure: m ? { hits: m.hits, classified: m.classified, instances: m.instances, notWord: m.notWord, needed: m.senses.needed ?? null } : null,
          };
        });
        if (ready) {
          for (const w of items.filter((item) => item.lookalike && item.measure)) {
            const needed = w.measure.needed;
            const ref = sourceReference(w.resembles);
            if (!needed || w.measure.instances < MIN_SENSE_SAMPLE) {
              notes.push(`“${w.word}”: too few sentences of general ${name} to measure (${w.measure.instances})`);
              if (verdict === "pass") verdict = "unclear";
              continue;
            }
            if (needed.inSense === 0) {
              if (ref?.measure && !ref.measure.inSense) {
                notes.push(`“${w.word}”: the needed sense is rare in both languages`);
                continue;
              }
              verdict = "fail";
              failedWords.push(w.word);
              reasons.push(`“${w.word}” is not used in general ${name} in the sense needed (${w.neededSense}): 0 of ${needed.classified} sentences${ref?.measure ? `; ${sourceName} “${ref.label}” in that sense: ${describeSense(ref.measure)}` : ""}`);
            } else if (ref?.measure?.zipf != null && needed.zipf != null && needed.zipf < ref.measure.zipf - 1) {
              verdict = "fail";
              failedWords.push(w.word);
              reasons.push(`“${w.word}” is much less used in the sense needed than ${sourceName} “${ref.label}”: ${formatZipf(needed.zipf)} against ${formatZipf(ref.measure.zipf)}`);
            }
          }
          const single = !/\s/.test(c.target.trim());
          const z = single ? (items.length === 1 ? items[0].zipf : zipfOf.get(fold(c.target).trim()) ?? null) : null;
          if (single && source && !source.invented && !found?.establishedUsage && z != null && source.wordZipf > 0 && z < source.wordZipf - 1) {
            verdict = "fail";
            reasons.push(`much less known than the ${sourceName} term: Zipf ${formatZipf(z)} against ${formatZipf(source.wordZipf)}`);
          }
        }
        if (verdict === "fail") failedTargets.push(c.target);
        return {
          target: c.target, sense: c.sense, words: items, verdict, reasons, notes,
          established: found?.establishedUsage ?? false, establishedBasis: found?.establishedBasis ?? "",
          clashes: findClashes(c.target),
        };
      });
      for (const c of candidates) {
        const extra = [...c.reasons, ...c.notes, ...c.clashes.map((x) => `already used for ${x.sourceTerms.join(" / ")}`)];
        fact(`${c.target}: ${c.verdict}${extra.length ? ` — ${extra.join("; ")}` : ""}`);
      }
      return { available: ready, candidates, failedWords: [...new Set(failedWords)], failedTargets };
    });
  }

  function partsText() {
    const parts = store.load("parts");
    if (!parts?.study) return "";
    const lines = [`## Parts of the term\n${parts.study.parts.map((p) => `- ${p.part}: ${p.meaning}`).join("\n")}`];
    const source = parts.source;
    if (source) {
      lines.push(`Frequency in general ${settings.sourceLanguageName} (Zipf: 0 = not in ordinary use, 3 = everyday word, 5+ = very common): “${settings.term}” ${formatZipf(source.wordZipf)}${source.invented ? " (not in the dictionary; practically absent from general use)" : ""}.`);
      for (const base of source.bases) lines.push(`“${base.word}” ${formatZipf(base.measure.wordZipf)}; in the sense “${base.neededSense}”: ${describeSense(base.needed)}.`);
    }
    return lines.join("\n");
  }

  function checksText() {
    const checks = store.load("checks");
    if (!checks?.candidates?.length) return "(no checks)";
    return checks.candidates.map((c) => {
      const words = c.words.map((w) => `${w.word} ${formatZipf(w.zipf)}${w.measure?.needed ? `, needed sense ${describeSense(w.measure.needed)}` : ""}`).join("; ");
      return `- ${c.target}: ${c.verdict.toUpperCase()}${c.reasons.length ? ` (${c.reasons.join("; ")})` : ""}${words ? ` [${words}]` : ""}${c.clashes.length ? ` [already used for: ${c.clashes.map((x) => x.sourceTerms.join(" / ")).join("; ")}]` : ""}`;
    }).join("\n");
  }

  async function discover() {
    return stage("discovery", async () => {
      heading("Discovery");
      const sample = store.load("sample");
      const items = sample.discoveryIds.map((id) => sample.items[id]);
      const occurrences = buildOccurrences(items, [], "d", settings.sourceLanguageCode);
      const instructions = prompts.discoveryInstructions(ctx());
      const keyed = batchOccurrences(items, occurrences, settings.discoveryBatch).map((batch, index) => [index, {
        stage: "discovery", purpose: `open reading of ${batch.occurrences.length} occurrences`,
        instructions, content: batchContent(batch, null),
        schema: prompts.DISCOVERY_SCHEMA, schemaName: "discovery",
        maxOutputTokens: 900 + 260 * batch.occurrences.length, effort: settings.effortLight,
      }]);
      const results = await client.callMany(keyed, settings.workers);
      const byId = new Set(occurrences.map((o) => o.occId));
      const readings = {};
      for (const value of results.values()) {
        if (value instanceof Error) continue;
        for (const row of value.items) if (byId.has(row.occId)) readings[row.occId] = row;
      }
      const tally = {};
      for (const row of Object.values(readings)) tally[row.rendering.toLowerCase()] = (tally[row.rendering.toLowerCase()] ?? 0) + 1;
      const top = Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 6);
      fact(`${Object.keys(readings).length} of ${occurrences.length} occurrences read; ${Object.keys(tally).length} different renderings; most common: ${top.map(([k, v]) => `${k} (${v})`).join(", ")}`);
      return { occurrences, readings };
    });
  }

  function proposalContent() {
    const sample = store.load("sample");
    const forms = store.load("forms");
    const disc = store.load("discovery");
    const lines = [
      `Headword: ${settings.term}. Confirmed forms: ${forms.confirmed.join(", ")}${forms.notFound.length ? ` (not in the texts: ${forms.notFound.join(", ")})` : ""}.`,
      `Derived words sharing the stem (not in this study): ${forms.related.map((r) => `${r.form} (${r.rows})`).join(", ") || "none listed"}`,
      `Population: ${sample.meta.populationDistinct} distinct passages.`,
      "",
      "Recurring neighbours across the whole population (occurrences / passages):",
      ...(sample.neighbours ?? []).slice(0, 40).map((n) => `- ${n.phrase}: ${n.occurrences} / ${n.paragraphs}`),
      "",
      "Study of where the term comes from:",
      store.load("sources")?.study ? JSON.stringify(store.load("sources").study, null, 1) : "(not available for these texts)",
      "",
      "Candidate study (translations proposed for the term as a whole):",
      JSON.stringify(store.load("candidates") ?? {}, null, 1),
      "",
      "Candidate checks against general usage (Zipf: 0 = not in ordinary use, 3 = everyday word, 5+ = very common):",
      checksText(),
      "",
      "Existing translations seen in the texts (hints only):",
      ...Object.values(sample.items).filter((i) => i.existingTranslation).slice(0, 12)
        .map((i) => `- ${i.existingTranslation.slice(0, 200)}`),
      "",
      "Discovery readings (sense | rendering | phrase | expression? | reason):",
    ];
    const tally = {};
    for (const occurrence of disc.occurrences) {
      const reading = disc.readings[occurrence.occId];
      if (!reading) continue;
      tally[reading.rendering.toLowerCase()] = (tally[reading.rendering.toLowerCase()] ?? 0) + 1;
      const text = sample.items[occurrence.itemId].text;
      lines.push(`[${occurrence.occId}] ${snippet(text, occurrence.start, occurrence.end)}\n    → ${reading.sense}${reading.corpusSense ? ` (${reading.corpusSense})` : ""} | ${reading.rendering} | ${reading.phraseTranslation}${reading.expressionCandidate ? ` | expr: ${reading.expressionCandidate}` : ""} | ${reading.reason}`);
    }
    lines.push("", `Rendering tally: ${Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}`);
    return lines.join("\n");
  }

  async function propose() {
    return stage("proposal", async () => {
      heading("Proposal");
      const proposal = await client.callJson({
        stage: "proposal", purpose: "consolidate variants, notes and entries",
        instructions: prompts.proposalInstructions(ctx()), content: proposalContent(),
        schema: prompts.PROPOSAL_SCHEMA, schemaName: "proposal",
        maxOutputTokens: 24000, effort: settings.effortProposal,
      });
      for (const entry of proposal.entries) {
        // Matching ignores case: one spelling per word.
        entry.sourceTerms = mergeCaseVariants(entry.sourceTerms.map((form) => ({ form })), (f) => f.form).map((f) => f.form);
      }
      const existingTargets = settings.existingEntries.flatMap((entry) => entry.targetTerms);
      for (const entry of proposal.entries) {
        for (const variant of entry.variants) {
          variant.fromExisting = existingTargets.some((target) => fold(target).trim() === fold(variant.target).trim());
        }
      }
      // A rendering whose check failed never reaches counting; the review pause can put it back.
      for (const removed of failedVariants(proposal, store.load("checks"))) {
        const entry = proposal.entries.find((e) => e.id === removed.entryId);
        entry.variants = entry.variants.filter((v) => v.id !== removed.variantId);
        (proposal.removedByChecks ??= []).push(removed);
        log({ type: "problem", text: `Removed “${removed.target}” from entry ${removed.entryId}: it contains “${removed.word}”, whose frequency check failed.` });
      }
      const problems = validateProposal(proposal, store.load("forms").confirmed);
      problems.push(...unmeasuredRenderings(proposal, store.load("discovery")));
      if (problems.length) info(`proposal notes: ${problems.join("; ")}`);
      fact(`${proposal.entries.length} proposed entr${proposal.entries.length === 1 ? "y" : "ies"}: ${proposal.entries.map((e) => `${e.sourceTerms.join("/")} → ${e.variants.map((v) => v.target).join(", ")}`).join(" | ")}`);
      for (const item of proposal.leftOutRenderings ?? []) info(`not measured: ${item.rendering} (${item.count}) — ${item.reason}`);
      proposal.existingComparison = await compareWithExisting(proposal);
      return proposal;
    });
  }

  /** The existing glossary entry, compared only after the proposal was made without it. */
  async function compareWithExisting(proposal) {
    const existing = settings.existingEntries.flatMap((entry) => entry.targetTerms.map((target, index) => ({
      target, note: entry.targetVariantNotes?.[index] ?? "",
    })));
    if (!existing.length) return [];
    heading("Existing glossary entry");
    const variants = proposal.entries.flatMap((entry) => entry.variants.map((v) => `[${v.id}] ${v.target} — ${v.note}`));
    const result = await client.callJson({
      stage: "comparison", purpose: "compare with the existing glossary entry",
      instructions: prompts.compareInstructions(ctx()),
      content: [
        "Proposal (variant id, translation, note):", ...variants, "",
        "Senses and synonyms found:", JSON.stringify({ sensesOutsideDictionary: proposal.sensesOutsideDictionary, leftOutRenderings: proposal.leftOutRenderings, sources: store.load("sources")?.study?.senses?.map((sense) => ({ sense: sense.sense, equivalences: sense.equivalences })) ?? [] }, null, 1), "",
        "Existing glossary translations:", ...existing.map((item) => `- ${item.target}${item.note ? ` (${item.note})` : ""}`),
      ].join("\n"),
      schema: prompts.COMPARE_SCHEMA, schemaName: "comparison",
      maxOutputTokens: 4000, effort: settings.effortLight,
    });
    const byId = Object.fromEntries(proposal.entries.flatMap((entry) => entry.variants.map((v) => [v.id, v.target])));
    const items = result.items.map((item) => ({
      existing: item.existing,
      verdict: item.verdict,
      proposed: item.proposedVariantId ? byId[item.proposedVariantId] ?? null : null,
      reason: item.reason,
    }));
    const leftOut = items.filter((item) => item.verdict === "left_out");
    fact(leftOut.length
      ? `Existing translations not in the proposal: ${leftOut.map((item) => item.existing).join(", ")}`
      : "Every existing translation is in the proposal.");
    return items;
  }

  /** Research up to the proposal (the review pause, when asked for). */
  async function runToReview() {
    try {
      await lookUpDictionary();
      await findForms();
      const fresh = store.load("proposal") == null;
      if (fresh) await findFamily();
      await drawSample();
      // Runs saved before these steps existed already have a proposal: the
      // studies would feed nothing, so they are not run for them.
      if (fresh) {
        await traceSources();
        await studyParts();
        await proposeCandidates();
        await checkCandidates();
      }
      await discover();
      const proposal = await propose();
      if (fresh && settings.pauseForReview) {
        heading("Review");
        fact("Waiting for you to review the proposed translations before counting.");
      }
      return { status: "review", proposal, spent: budget.spent };
    } finally {
      saveUsage();
    }
  }

  function freeze(proposal) {
    const body = {
      term: settings.term,
      target: settings.targetLanguageCode,
      entries: proposal.entries.map((entry) => ({
        id: entry.id, kind: entry.kind,
        sourceTerms: entry.sourceTerms.map((t) => t.trim()).filter(Boolean),
        generalNote: entry.generalNote,
        variants: entry.variants.map(({ id, target, note }) => ({ id, target, note })),
      })),
    };
    const version = stableHash(body).slice(0, 12);
    const entries = body.entries.map((entry) => ({
      ...entry,
      match: entry.sourceTerms.map((t) => t.toLowerCase()),
      displayOrder: shuffled(entry.variants, `${settings.seed}:${version}:${entry.id}`),
    }));
    return { ...body, entries, version };
  }

  /** Continue after the user confirmed (possibly edited) the proposal. */
  async function runCounting(confirmedProposal) {
    try {
      const problems = validateProposal(confirmedProposal, store.load("forms").confirmed, { strict: true });
      if (problems.length) throw new ResearchStop(`The proposal cannot be counted: ${problems.join("; ")}`, "failed");
      const frozen = freeze(confirmedProposal);
      const previous = store.load("frozen");
      if (previous && previous.version !== frozen.version) {
        store.save("counting", null);
        info(`proposal edited: new version ${frozen.version}; earlier counts discarded`);
      }
      store.save("frozen", frozen);
      store.save("confirmedProposal", confirmedProposal);
      const counting = await stage("counting", () => count(frozen, 1));
      let aggregate = aggregateCounts(counting, frozen, store.load("sample"));
      if (settings.judges >= 2) {
        const second = await stage("counting2", () => count(frozen, 2));
        const merged = mergeJudgeCountings(counting, second);
        const combined = aggregateCounts(merged.counting, frozen, store.load("sample"));
        combined.totals.occurrencesSampled = counting.occurrences.length;
        combined.totals.judges = 2;
        combined.totals.votes = merged.counting.occurrences.length;
        combined.totals.agreement = merged.agreement;
        aggregate = combined;
        fact(`Two judges agreed on ${merged.agreement.agreed} of ${merged.agreement.compared} occurrences.`);
      }
      store.save("aggregate", aggregate);
      const footnotes = await stage("footnotes", () => rareWinners(frozen, aggregate).catch((error) => {
        info(`rare translations not checked: ${error.message}`);
        return [];
      }));
      heading("Summary");
      const prose = await summarize(frozen, confirmedProposal, aggregate, footnotes).catch((error) => {
        info(`summary not written: ${error.message}`);
        return null;
      });
      store.save("prose", prose);
      heading("Done");
      fact(`Spent ${formatUsd(budget.spent)} of ${formatUsd(budget.limit)}.`);
      return { status: "done", frozen, aggregate, prose, spent: budget.spent };
    } finally {
      saveUsage();
    }
  }

  /** Winning translations that are rare in general use and not clear from their parts get a translator's note. */
  async function rareWinners(frozen, aggregate) {
    const code = settings.targetLanguageCode;
    const name = settings.targetLanguageName;
    if (!(await frequencyReady(code, name))) return [];
    heading("Rare translations");
    const winners = [];
    for (const entry of frozen.entries) {
      for (const variant of entry.variants) {
        if ((aggregate.entries[entry.id]?.variants?.[variant.id]?.occurrences ?? 0) > 0) winners.push(variant.target);
      }
    }
    const checks = store.load("checks");
    const scored = [];
    for (const target of [...new Set(winners)]) {
      const checked = checks?.candidates?.find((c) => fold(c.target).trim() === fold(target).trim());
      let zipf = null;
      if (checked?.words?.length) {
        const values = checked.words.map((w) => w.zipf).filter((z) => z != null);
        zipf = values.length ? Math.min(...values) : null;
      } else if (!corpusCounted(code)) {
        const tokens = renderingTokens(target).filter((t) => t.length > 3);
        const values = tokens.length ? await languageData.zipf(code, tokens) : [];
        zipf = values.length ? Math.min(...values) : null;
      }
      if (zipf != null && zipf < 2) scored.push({ target, zipf });
    }
    if (!scored.length) {
      fact("No chosen translation is rare in general use.");
      return [];
    }
    const answer = await client.callJson({
      stage: "footnotes", purpose: "notes for rare translations",
      instructions: prompts.footnoteInstructions(ctx()),
      content: scored.map((item) => `- ${item.target} (Zipf ${formatZipf(item.zipf)})`).join("\n"),
      schema: prompts.FOOTNOTE_SCHEMA, schemaName: "footnotes",
      maxOutputTokens: 1500 + 300 * scored.length, effort: settings.effortLight,
    });
    const notes = answer.items.filter((item) => !item.understandableFromParts && item.note.trim())
      .map((item) => ({ ...item, zipf: scored.find((s) => fold(s.target).trim() === fold(item.target).trim())?.zipf ?? null }));
    fact(notes.length
      ? `Translator's note proposed for: ${notes.map((n) => n.target).join(", ")}`
      : `Rare but clear from their parts: ${scored.map((s) => s.target).join(", ")}`);
    return notes;
  }

  async function count(frozen, judge = 1) {
    heading(judge === 1 ? "Counting" : "Counting (second judge)");
    if (judge !== 1) {
      // The second judge sees the same translations in another order.
      frozen = {
        ...frozen,
        entries: frozen.entries.map((entry) => ({ ...entry, displayOrder: shuffled(entry.variants, `${settings.seed}:${frozen.version}:${entry.id}:judge${judge}`) })),
      };
    }
    const sample = store.load("sample");
    const items = sample.measuredIds.map((id) => sample.items[id]);
    const occurrences = buildOccurrences(items, frozen.entries, "o", settings.sourceLanguageCode);
    const unassigned = occurrences.filter((o) => o.entryId === "unassigned");
    if (unassigned.length) info(`${unassigned.length} occurrences match no entry's forms: ${[...new Set(unassigned.map((o) => o.surface))].join(", ")}`);
    const entryById = Object.fromEntries(frozen.entries.map((e) => [e.id, e]));
    const label = (entryId) => entryById[entryId]
      ? `${entryById[entryId].kind === "expression" ? "expression " : ""}entry [${entryId}] “${entryById[entryId].sourceTerms.join(" / ")}”`
      : "no entry (report status unresolved/not_this_word if it is not the headword)";
    const instructions = prompts.translateInstructions(ctx(), prompts.frozenEntryText(frozen, settings.targetLanguageName));
    const judgments = {};
    let todo = occurrences.filter((o) => o.entryId !== "unassigned");
    for (let attempt = 0; attempt < 2 && todo.length; attempt += 1) {
      const size = attempt === 0 ? settings.countBatch : Math.max(2, Math.floor(settings.countBatch / 2));
      const batches = batchOccurrences(items, todo, size);
      const keyed = batches.map((batch, index) => [index, {
        stage: "counting", purpose: `translate and choose for ${batch.occurrences.length} occurrences`,
        instructions, content: batchContent(batch, label),
        schema: prompts.TRANSLATE_SCHEMA, schemaName: "counting",
        maxOutputTokens: 1200 + 330 * batch.occurrences.length, effort: settings.effortLight,
      }]);
      const results = await client.callMany(keyed, settings.workers);
      const retry = [];
      batches.forEach((batch, index) => {
        const value = results.get(index);
        const rows = new Map();
        if (value && !(value instanceof Error)) for (const row of value.items) if (!rows.has(row.occId)) rows.set(row.occId, row);
        for (const occurrence of batch.occurrences) {
          const row = rows.get(occurrence.occId);
          const problem = validateJudgment(row, occurrence, entryById);
          if (!problem) {
            judgments[occurrence.occId] = row;
          } else {
            retry.push({ ...occurrence, problem });
          }
        }
      });
      todo = retry;
      const done = Object.keys(judgments).length;
      info(`judged ${done} of ${occurrences.length} occurrences${retry.length ? `; ${retry.length} to retry` : ""}`);
    }
    for (const occurrence of todo) {
      judgments[occurrence.occId] = { occId: occurrence.occId, status: "failed", variantId: null, note: occurrence.problem };
    }
    for (const occurrence of unassigned) {
      judgments[occurrence.occId] = { occId: occurrence.occId, status: "unresolved", unresolvedReason: "no_entry", variantId: null, note: `form “${occurrence.surface}” is in no entry` };
    }
    return { frozenVersion: frozen.version, occurrences, judgments };
  }

  async function summarize(frozen, proposal, aggregate, footnotes = []) {
    return client.callJson({
      stage: "summary", purpose: "report summary",
      instructions: prompts.proseInstructions(ctx()),
      content: JSON.stringify({
        entries: frozen.entries.map((entry) => ({ id: entry.id, kind: entry.kind, sourceTerms: entry.sourceTerms, generalNote: entry.generalNote, variants: entry.variants })),
        counts: aggregate.entries, totals: aggregate.totals,
        otherRenderings: aggregate.otherRenderings.slice(0, 15),
        unresolved: aggregate.unresolvedNotes.slice(0, 12),
        existingComparison: proposal.existingComparison,
        derivativeStudies: proposal.derivativeStudies,
        openQuestions: proposal.openQuestions,
        failedChecks: (store.load("checks")?.candidates ?? []).filter((c) => c.verdict === "fail").map((c) => ({ target: c.target, reasons: c.reasons })),
        translatorsNotes: footnotes,
      }),
      schema: prompts.PROSE_SCHEMA, schemaName: "summary",
      maxOutputTokens: 5000, effort: settings.effortLight,
    });
  }

  return {
    runToReview,
    runCounting,
    cancel() {
      cancelled = true;
    },
    budget,
    freeze,
  };
}

// --- validation ------------------------------------------------------------

export function validateProposal(proposal, confirmedForms, { strict = false } = {}) {
  const problems = [];
  const ids = [];
  const wordEntries = proposal.entries.filter((e) => e.kind !== "expression");
  if (!wordEntries.length) problems.push("no word entry");
  for (const entry of proposal.entries) {
    ids.push(entry.id, ...entry.variants.map((v) => v.id));
    if (!entry.sourceTerms.some((t) => t.trim())) problems.push(`entry ${entry.id} has no source terms`);
    if (!entry.variants.length) problems.push(`entry ${entry.id} has no translations`);
    for (const variant of entry.variants) {
      if (!variant.target.trim()) problems.push(`a translation in entry ${entry.id} is empty`);
    }
  }
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length) problems.push(`duplicate ids ${[...new Set(duplicates)].join(", ")}`);
  const covered = new Map();
  for (const entry of wordEntries) {
    for (const term of entry.sourceTerms) {
      const key = fold(term).trim();
      if (covered.has(key) && covered.get(key) !== entry.id) problems.push(`“${term}” is in entries ${covered.get(key)} and ${entry.id}`);
      covered.set(key, entry.id);
    }
  }
  if (!strict) {
    const missing = confirmedForms.filter((f) => !covered.has(fold(f).trim()));
    if (missing.length) problems.push(`forms in no entry: ${missing.join(", ")}`);
  }
  return problems;
}

/**
 * Renderings the open reading used two or more times that are neither a
 * variant nor explained in leftOutRenderings.
 */
export function unmeasuredRenderings(proposal, discovery) {
  if (!discovery) return [];
  const tally = new Map();
  for (const reading of Object.values(discovery.readings ?? {})) {
    const key = fold(reading.rendering).trim();
    if (key) tally.set(key, { text: tally.get(key)?.text ?? reading.rendering, count: (tally.get(key)?.count ?? 0) + 1 });
  }
  const targets = new Set(proposal.entries.flatMap((entry) => entry.variants.map((v) => fold(v.target).trim())));
  const explained = new Set((proposal.leftOutRenderings ?? []).map((item) => fold(item.rendering).trim()));
  return [...tally.entries()]
    .filter(([key, value]) => value.count >= 2 && !targets.has(key) && !explained.has(key))
    .map(([, value]) => `“${value.text}” (${value.count} readings) is neither measured nor explained`);
}

/** Normalize an answer; returns a problem string or null. */
export function validateJudgment(row, occurrence, entryById) {
  if (!row) return "missing from the answer";
  const entry = entryById[occurrence.entryId];
  if (row.status === "other" && entry) {
    const same = entry.variants.find((v) => fold(v.target).trim() === fold(row.otherRendering ?? "").trim());
    if (same) {
      row.normalizedFromOther = row.otherRendering;
      row.status = "selected";
      row.variantId = same.id;
    }
  }
  if (row.status === "selected") {
    if (!entry?.variants.some((v) => v.id === row.variantId)) return `variant ${row.variantId} is not in entry ${occurrence.entryId}`;
  } else if (row.status === "other") {
    if (!String(row.otherRendering ?? "").trim()) return "other without a rendering";
    row.variantId = null;
  } else if (row.status === "unresolved") {
    if (!row.unresolvedReason) return "unresolved without a reason";
    row.variantId = null;
  } else {
    return `unknown status ${row.status}`;
  }
  if (!String(row.sentenceTranslation ?? "").trim()) return "no sentence translation";
  const wording = String(row.chosenWording ?? "").trim();
  row.wordingFound = Boolean(wording) && row.sentenceTranslation.toLowerCase().includes(wording.toLowerCase());
  return null;
}
