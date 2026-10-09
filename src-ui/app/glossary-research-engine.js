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
import { coOccurrence, convergenceContent, sharedRenderings } from "./glossary-research-convergence.js";
import { aggregateCounts, mergeJudgeCountings } from "./glossary-research-aggregate.js";
import {
  bookName, borrowingStrength, borrowingText, enforceOriginalWords, noteNamesTheBook, originalFor, originalWordOf, originalWordsText, pairFact, pairWords, placeOriginalWords, requiredOriginalWords, signedOnly, termPairsOf,
} from "./glossary-research-original-word.js";
import {
  MIN_SENSE_SAMPLE,
  RESEARCH_DATA_CONTACT,
  combinedZipf,
  commonness,
  dataLanguage,
  describeSense,
  formatZipf,
  senseZipf,
} from "./glossary-research-frequency.js";

/**
 * A token with a digit is not a word: in the texts it is usually a word with its
 * footnote number attached ("cohabitaremos1").
 */
/**
 * How the texts write the term: its most common capitalization away from the
 * start of a sentence (where a capital says nothing), among the passages given.
 * The typed term when the passages do not show it.
 */
export function writtenForm(term, items) {
  const key = String(term ?? "").normalize("NFC").toLowerCase().trim();
  const counts = new Map();
  for (const item of items ?? []) {
    for (const occurrence of item.occurrences ?? []) {
      const surface = String(occurrence.surface ?? "").normalize("NFC");
      if (surface.toLowerCase().trim() !== key) continue;
      const before = String(item.text ?? "").slice(0, occurrence.start).trimEnd();
      // Start of a passage or after a sentence's end, an opening mark or a quotation mark.
      if (!before || /[.!?¡¿:;…"“”«»„'‘’(\[\u3002\uff01\uff1f\u0964\u061f\u06d4-]$/u.test(before)) continue;
      counts.set(surface, (counts.get(surface) ?? 0) + 1);
    }
  }
  let best = null;
  for (const [surface, count] of counts) if (!best || count > best.count) best = { surface, count };
  return best && best.count > (counts.get(String(term).normalize("NFC")) ?? 0) ? best.surface : term;
}

export const isWord = (form) => !/\p{N}/u.test(String(form ?? ""));

/** How many words of the texts that begin with the term's letters are checked as its possible forms. */
const MAX_STEM_EXTENSIONS = 25;

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
  maxSenseChecks: 10,
  // Words that set a passing translation's score, sorted by meaning (see checks).
  maxDecidingChecks: 15,
};

/**
 * The sense measurements of a finished run, for runs after it to reuse: the
 * base words of the term (source language) and the look-alikes of its
 * candidates (target language). General-usage measurements do not depend on
 * the term being studied.
 */
export function collectMeasurements(stages, sourceCode, targetCode) {
  const out = [];
  const seen = new Set();
  const add = (language, word, sense, zipf, measure) => {
    if (!word || !sense || !measure?.needed || !(measure.classified > 0)) return;
    const key = `${language}\u0000${textKey(word)}\u0000${textKey(sense)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      language, word, sense, wordZipf: zipf ?? 0, needed: measure.needed,
      hits: measure.hits ?? null, classified: measure.classified, instances: measure.instances, notWord: measure.notWord ?? 0,
    });
  };
  for (const base of stages?.parts?.source?.bases ?? []) add(sourceCode, base.word, base.neededSense, base.measure?.wordZipf, { ...base.measure, needed: base.needed });
  for (const candidate of stages?.checks?.candidates ?? []) {
    for (const w of candidate.words ?? []) if (w.lookalike && w.measure) add(targetCode, w.word, w.neededSense, w.zipf, w.measure);
  }
  return out;
}

/** Earlier measurements merged with new ones (the first one of a word and sense is kept). */
export function mergeMeasurements(existing, added) {
  const key = (m) => `${m.language}\u0000${textKey(m.word)}\u0000${textKey(m.sense)}`;
  const seen = new Set(existing.map(key));
  return [...existing, ...added.filter((m) => !seen.has(key(m)))];
}

/**
 * How a language's words relate to its frequency data (see
 * plans/language-frequency-handling.md):
 * - CORPUS_COUNTED: the list does not hold words (Thai lists space-separated
 *   chunks; Khmer, Lao, Burmese have no list): count every word in the corpus.
 * - NOT_SPACE_SPLIT: spaces do not separate words (Vietnamese puts them between
 *   syllables; Chinese, Japanese… use none): a rendering is never split at spaces
 *   or into characters.
 * - JOINER_SCRIPTS: compounds are written with a zero-width non-joiner, a space,
 *   or joined; the data has them joined.
 */
const CORPUS_COUNTED = new Set(["th", "km", "lo", "my"]);
const NOT_SPACE_SPLIT = new Set(["vi", "zh", "ja", "th", "km", "lo", "my"]);
const JOINER_SCRIPTS = new Set(["fa", "ur", "ps", "ckb"]);
const baseLanguage = (code) => dataLanguage(code).split("-")[0];
export function corpusCounted(code) {
  return CORPUS_COUNTED.has(baseLanguage(code));
}

/**
 * A target-language word as it is looked up and compared: lower case, Unicode
 * NFC, accents and tone marks kept (in Vietnamese they make the word). Joiners
 * are dropped in scripts whose data writes compounds joined.
 */
export function textKey(text, code = "") {
  let value = String(text ?? "").normalize("NFC").toLowerCase().trim();
  if (code && JOINER_SCRIPTS.has(baseLanguage(code))) value = value.replace(/[\u200c\u200d]/g, "");
  return value;
}

/**
 * General-usage score of target-language words: the frequencies of each word's
 * surface forms added up (inflections, forms with attached particles), looked
 * up exactly as written. A word the list does not hold as a unit is counted
 * whole in the general corpus, never split into syllables or characters.
 * items: [{ word, forms? }]. Returns a Map from textKey(word) to the score.
 */
export async function scoreWords(languageData, code, items, onCounting = null) {
  const scores = new Map();
  const wanted = [];
  for (const item of items) {
    const key = textKey(item.word, code);
    if (!key || scores.has(key)) continue;
    const forms = new Set([key, ...(item.forms ?? []).map((form) => textKey(form, code)).filter(Boolean)]);
    if (JOINER_SCRIPTS.has(baseLanguage(code))) {
      for (const form of [...forms]) if (/\s/.test(form)) forms.add(form.replace(/\s+/g, ""));
    }
    scores.set(key, 0);
    wanted.push({ key, forms: [...forms] });
  }
  if (!wanted.length) return scores;
  const allForms = [...new Set(wanted.flatMap((w) => w.forms))];
  const listed = corpusCounted(code) ? [] : await languageData.zipf(code, allForms);
  const listScore = new Map(allForms.map((form, i) => [form, listed[i] ?? 0]));
  const toCount = [];
  for (const w of wanted) {
    const score = combinedZipf(w.forms.map((form) => listScore.get(form) ?? 0));
    scores.set(w.key, score);
    if (!(score > 0)) toCount.push(w);
  }
  if (toCount.length && languageData.corpusZipf) {
    onCounting?.(toCount.map((w) => w.key));
    const counted = await languageData.corpusZipf(code, [...new Set(toCount.flatMap((w) => w.forms))]).catch(() => []);
    const corpusScore = new Map(counted.map((c) => [textKey(c.phrase, code), c.zipf]));
    for (const w of toCount) scores.set(w.key, combinedZipf(w.forms.map((form) => corpusScore.get(form) ?? 0)));
  }
  return scores;
}

/**
 * Neighbouring words of a candidate that the frequency list holds as one unit
 * (a compound in its own right, like Vietnamese "khoe của") become one word: the
 * unit is listed as the candidate's own word and the words it joins as its parts.
 * Free combinations of ordinary words are not in the list and keep their words.
 * Lists that only hold single tokens never match, so nothing changes there.
 */
export async function joinListedUnits(languageData, code, candidates, senseOf = null) {
  if (corpusCounted(code)) return;
  const runsOf = (candidate) => {
    const target = textKey(candidate.target, code);
    const placed = candidate.words
      .filter((w) => !w.partOf)
      .map((w) => ({ w, at: target.indexOf(textKey(w.word, code)), key: textKey(w.word, code) }))
      .filter((p) => p.at >= 0 && p.key)
      .sort((a, b) => a.at - b.at);
    const runs = [];
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = placed.length - 1; j > i; j -= 1) {
        const span = target.slice(placed[i].at, placed[j].at + placed[j].key.length);
        // Only words that stand next to each other, separated by spaces at most.
        const gaps = placed.slice(i, j).every((p, k) => /^\s*$/.test(target.slice(p.at + p.key.length, placed[i + k + 1].at)));
        if (gaps) runs.push({ span, members: placed.slice(i, j + 1).map((p) => p.w) });
      }
    }
    return runs.sort((a, b) => b.members.length - a.members.length);
  };
  const all = candidates.map((candidate) => ({ candidate, runs: runsOf(candidate) }));
  const spans = [...new Set(all.flatMap((c) => c.runs.map((r) => r.span)))];
  if (!spans.length) return;
  const listed = await languageData.zipf(code, spans);
  const inList = new Set(spans.filter((_, i) => listed[i] > 0));
  for (const { candidate, runs } of all) {
    const used = new Set();
    for (const run of runs) {
      if (!inList.has(run.span) || run.members.some((w) => used.has(w))) continue;
      run.members.forEach((w) => used.add(w));
      candidate.words.push({
        // The unit carries the meaning the whole translation expresses.
        word: run.span, partOf: null, forms: [],
        neededSense: senseOf?.(candidate) || run.members.map((w) => w.neededSense).filter(Boolean).join("; "),
        lookalike: false, resembles: null, otherSenses: [], joinedFromList: true,
      });
      for (const w of run.members) w.partOf = run.span;
    }
  }
}

/**
 * A rendering's score: that of its rarest own word, as the check step listed the
 * words (parts listed for the decomposition check do not count). Before the
 * check, the whole rendering as one unit, or (where spaces separate words) its
 * rarest longer word.
 */
export function scoreRendering(code, rendering, scoreOf, words = null) {
  const own = (words ?? []).filter((w) => !w.partOf);
  if (own.length) {
    const values = own.map((w) => scoreOf.get(textKey(w.word, code))).filter((z) => z != null);
    if (values.length) return Math.min(...values);
  }
  const whole = scoreOf.get(textKey(rendering, code));
  if (whole != null && (whole > 0 || NOT_SPACE_SPLIT.has(baseLanguage(code)))) return whole;
  const tokens = renderingTokens(rendering).filter((t) => t.length > 2);
  const values = tokens.map((t) => scoreOf.get(textKey(t, code))).filter((z) => z != null);
  return values.length ? Math.min(...values) : whole ?? null;
}

/**
 * The member of a group of interchangeable renderings that represents it: the one
 * whose general-usage score best fits the source sense (similar, or better known,
 * never much less known). With no source score to match, the best-known member.
 */
export function pickRepresentative(members, scoreOf, target) {
  const scored = members.map((member, index) => ({ member, index, zipf: scoreOf(member) }));
  const known = scored.filter((s) => s.zipf != null);
  if (!known.length) return members[0];
  if (target == null) return known.reduce((a, b) => (b.zipf > a.zipf ? b : a)).member;
  const close = known.filter((s) => s.zipf >= target - 0.5);
  const pool = close.length ? close : known;
  return pool.reduce((a, b) => {
    const da = Math.abs(a.zipf - target);
    const db = Math.abs(b.zipf - target);
    return db < da || (db === da && b.zipf > a.zipf) ? b : a;
  }).member;
}

/**
 * A rendering with a word that may be a cognate or calque of a source word: it
 * contains the source word, or shares a start of at least 3 letters that covers
 * at least half of the shorter of the two words. Only decides what gets checked.
 */
export function looksLike(rendering, sourceWords) {
  // Spelling across two languages: accents do not count.
  const folded = (text) => fold(String(text ?? "")).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const words = sourceWords.flatMap((w) => folded(w)).filter((w) => w.length >= 3);
  return folded(rendering).some((token) => words.some((word) => {
    if (word.length >= 5 && token.includes(word)) return true;
    let shared = 0;
    while (shared < token.length && shared < word.length && token[shared] === word[shared]) shared += 1;
    return shared >= 3 && shared >= Math.min(token.length, word.length) / 2;
  }));
}

/** Words of a rendering, lower case with accents kept, split at anything that is not a letter, mark or digit. */
export function renderingTokens(text) {
  return textKey(text).split(/[^\p{L}\p{M}\p{N}\u200c\u200d]+/u).filter(Boolean);
}

/** Variants that contain a word whose check failed (or are a failed candidate). */
export function failedVariants(proposal, checks) {
  if (!checks) return [];
  const words = (checks.failedWords ?? []).map((w) => textKey(w)).filter(Boolean);
  const targets = new Set((checks.failedTargets ?? []).map((t) => textKey(t)));
  const found = [];
  for (const entry of proposal.entries) {
    for (const variant of entry.variants) {
      const key = textKey(variant.target);
      const word = words.find((w) => renderingTokens(variant.target).some((token) => token.includes(w)));
      if (targets.has(key) || word) found.push({ entryId: entry.id, variantId: variant.id, target: variant.target, word: word ?? variant.target });
    }
  }
  return found;
}

/**
 * Family members grouped by word (a member found through another member's
 * inflections belongs to it). Prefixed words and compounds are
 * suggested for study; suffixed words usually belong to their own studies.
 */
export function familyGroups(members) {
  const groups = new Map();
  // Runs saved before phrases were left out may still list them.
  members = members.filter((m) => m.kind !== "phrase");
  for (const member of members.filter((m) => !m.of)) {
    groups.set(fold(member.form).trim(), { form: member.form, kind: member.kind, rows: member.rows, forms: [member.form] });
  }
  for (const member of members.filter((m) => m.of)) {
    const group = groups.get(fold(member.of).trim());
    if (group) {
      group.forms.push(member.form);
      group.rows += member.rows;
    } else {
      groups.set(fold(member.form).trim(), { form: member.form, kind: member.kind, rows: member.rows, forms: [member.form] });
    }
  }
  return [...groups.values()]
    .map((group) => ({ ...group, suggested: ["prefixed", "compound"].includes(group.kind) }))
    .sort((a, b) => b.rows - a.rows);
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

export function createModelClient({ model, prices, budget, log, isCancelled, maxRetries, prepare = (request) => request }) {
  let sequence = 0;
  // `prepare` adds what every request carries (the writing rule); applied once per request.
  const done = new WeakSet();
  const prepared = (request) => {
    if (done.has(request)) return request;
    const ready = prepare(request);
    done.add(ready);
    return ready;
  };
  async function callJson(request) {
    request = prepared(request);
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
      log({ type: "request", stage: request.stage, requestId, text: request.content, instructions: request.instructions, purpose: request.purpose, batch: request.batch ?? null, progress: request.progress ?? null });
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
    const pending = keyed.map(([key, request], index) => {
      const batched = { ...prepared(request), batch: { key: batchKey, number: index + 1, total: keyed.length } };
      done.add(batched);
      return [key, batched];
    });
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
    // Sorting sentences by meaning only returns numbers: no writing rule needed.
    prepare: (request) => (request.stage === "frequency" ? request : { ...request, instructions: `${request.instructions}\n\n${prompts.writingRule(ctx())}` }),
  });
  const saveUsage = () => store.save("usage", budget.records);
  const heading = (text) => log({ type: "heading", text });
  const fact = (text) => log({ type: "fact", text });
  const info = (text) => log({ type: "info", text });
  /** A finding with its data for display; text is the same line a fact would log. */
  const logResult = (kind, data, text) => log({ type: "result", kind, data, text });

  /**
   * The language's frequency data is on this computer (downloaded the first time,
   * with its own progress lines), or the run goes on without it.
   */
  async function frequencyReady(code, name) {
    if (!settings.frequencyChecks || !languageData) return false;
    const key = dataLanguage(code);
    if (!(key in languageStatus)) {
      const status = await languageData.ensure(code);
      languageStatus[key] = status.available === true;
      if (status.available) {
        info(`Looking up how common the words are in everyday ${name} (${Number(status.sentences) ? `${(Number(status.sentences) / 1e6).toLocaleString("en-US")} million` : "a corpus of"} sentences of ${name} news text)…`);
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
        // The answer lists one item per sentence; "n" opens each item. The live
        // panel charts the sentences per meaning, so it gets the meanings' names.
        progress: {
          key: "n", total: general.sample.length, unit: "sentence", view: "senses",
          word: forms[0], language: name, senses: senses.map((sense) => ({ id: sense.id, gloss: sense.gloss, partOfSpeech: sense.partOfSpeech ?? null })),
        },
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
    if ((corpusCounted(code) || !(listZipf > 0)) && (general.zipfOffset != null || general.corpusTokens)) {
      const realHits = result.classified ? general.hits * (result.instances / result.classified) : 0;
      result.wordZipf = realHits <= 0 ? 0
        : general.zipfOffset != null ? Math.log10(realHits) + general.zipfOffset
          : Math.log10((realHits / general.corpusTokens) * 1e9);
      result.wordZipfSource = "corpus";
    }
    // A frequency list counts every occurrence (names and other words spelled the
    // same included), so a sense's share is taken over all matches; a corpus count
    // already left out the matches that are not the word.
    const base = result.wordZipfSource === "list" ? result.classified : result.instances;
    for (const sense of senses) result.senses[sense.id] = senseZipf(result.wordZipf, result.counts[sense.id] ?? 0, base);
    return result;
  }

  /** Earlier measurements in one language, numbered for the model to cite. */
  function priorMeasurements(code) {
    const list = (settings.priorMeasurements ?? []).filter((m) => m.language === code);
    return list.map((m, index) => ({ ...m, id: `m${index + 1}` }));
  }

  function priorsText(priors) {
    if (!priors.length) return "";
    return `## Measurements already made (general usage, by sense)\n${priors.map((m) => `${m.id}. “${m.word}” — ${m.sense} — ${describeSense(m.needed)}`).join("\n")}`;
  }

  /** A cited earlier measurement of the same word, as a measurement of this run. */
  function reusedMeasure(priors, id, word) {
    const prior = id ? priors.find((m) => m.id === id) : null;
    if (!prior || textKey(prior.word) !== textKey(word)) return null;
    return {
      forms: [prior.word], hits: prior.hits, classified: prior.classified, instances: prior.instances, notWord: prior.notWord,
      wordZipf: prior.wordZipf, wordZipfSource: "earlier run", senses: { needed: prior.needed }, reused: true,
    };
  }

  const wordScores = (code, items) => scoreWords(languageData, code, items, (words) => {
    const shown = words.slice(0, 8).map((w) => `“${w}”`).join(", ");
    info(`Counting ${words.length === 1 ? "a word" : `${words.length} words`} the ${settings.targetLanguageName} frequency list does not hold as a unit, whole, in the general ${settings.targetLanguageName} corpus: ${shown}${words.length > 8 ? "…" : ""}`);
  });
  const renderingScore = (rendering, scoreOf, words = null) => scoreRendering(settings.targetLanguageCode, rendering, scoreOf, words);

  // The term as the texts write it ("íntimo", typed "Íntimo"): the studies use it,
  // so a capital typed for the glossary does not suggest one meaning.
  const headword = () => store.load("forms")?.headword ?? settings.term;

  const ctx = (extra = {}) => ({
    headword: headword(),
    sourceName: settings.sourceLanguageName,
    targetName: settings.targetLanguageName,
    reportName: settings.reportLanguageName,
    corpusDescription: corpus.description,
    dictionaryText: store.load("dictionary")?.text ?? "",
    forms: store.load("forms")?.confirmed ?? [headword()],
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
      // Lookups can take a while (the DLE up to two minutes): say what is happening.
      info(`Looking up “${settings.term}” in a ${settings.sourceLanguageName} dictionary…`);
      let result = await dictionary.lookup(settings.term, (line) => info(line));
      if (result.status !== "found" && settings.webDictionaryDomains?.length) {
        info("No dictionary entry yet; asking the AI to search dictionary sites.");
        const found = await client.callJson({
          stage: "dictionary", purpose: "look the word up on dictionary websites",
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
      // A note on why a dictionary failed only matters when no entry was found at all.
      if (result.status !== "found") for (const note of result.notes ?? []) fact(note);
      const phrases = (result.articles ?? []).flatMap((article) => (article.complexForms ?? []).map((form) => `«${form.form}»`));
      if (result.status === "found" && result.text) logResult("dictionary", [{ sourceName: result.sourceName, url: result.url ?? "", text: result.text }], `${result.sourceName}: entry`);
      fact(result.status === "found"
        ? `${result.sourceName}: ${result.senseCount} ${result.senseCount === 1 ? "meaning" : "meanings"}${phrases.length ? `, and the ${phrases.length === 1 ? "phrase" : "phrases"} ${phrases.join(", ")}` : result.complexFormCount ? `, and ${result.complexFormCount} ${result.complexFormCount === 1 ? "phrase" : "phrases"} with the word` : ""}`
        : result.status === "not_found"
          ? `No dictionary entry found (${result.tried.join(", ")})`
          : `Dictionary unreachable (${result.tried.join(", ")}) — continuing without it`);
      return result;
    });
  }

  async function findForms() {
    return stage("forms", async () => {
      heading("Word forms");
      info(`Collecting the spellings of “${settings.term}” that occur in the texts…`);
      const written = corpus.sample
        ? writtenForm(settings.term, (await corpus.sample([settings.term], 60, settings.seed).catch(() => null))?.items ?? [])
        : settings.term;
      const hint = corpus.formsHint ? await corpus.formsHint(settings.term) : null;
      const proposeCtx0 = { headword: written };
      const proposeCtx = ctx({
        ...proposeCtx0,
        userVariants: settings.variants,
        existingSourceTerms: settings.existingEntries.flatMap((entry) => entry.sourceTerms),
        corpusForms: (hint?.forms ?? []).map((f) => f.form),
      });
      const proposed = await client.callJson({
        stage: "forms", purpose: `complete the list of spellings of “${written}” to search for (plural, feminine, without accents…)`,
        progress: { key: "form", total: null, unit: "spelling" },
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
      // Words of the texts that begin with the term's letters may be its forms
      // ("cohabitaremos" for "cohabitar") or other words ("intimidad" for
      // "íntimo"); the confirm step decides, and the rest go to the word family.
      const extensions = (hint?.related ?? []).filter((f) => isWord(f.form))
        .sort((a, b) => (b.rows ?? 0) - (a.rows ?? 0)).slice(0, MAX_STEM_EXTENSIONS)
        .map((f) => ({ form: f.form, kind: "extension", confidence: "low" }));
      const extra = mergeCaseVariants([
        ...(hint?.forms ?? []).filter((f) => isWord(f.form)).map((f) => ({ form: f.form, kind: "text", confidence: "medium" })),
        ...accentCounterparts(proposedForms.map((f) => f.form)).map((form) => ({ form, kind: "spelling", confidence: "medium" })),
        ...extensions,
      ], (f) => f.form).filter((f) => !proposedForms.some((p) => p.form.toLowerCase() === f.form.toLowerCase()));
      const counted = [];
      info("Counting how many paragraphs use each spelling…");
      for (const candidate of [...proposedForms, ...extra]) {
        const count = await corpus.countForm(candidate.form);
        const added = !proposedForms.includes(candidate);
        if (added && !count.rows) continue;
        counted.push({ ...candidate, rows: count.rows, examples: count.examples });
        // Lands in the spellings display, next to its spelling.
        logResult("formCount", [{ form: candidate.form, rows: count.rows, added, kind: candidate.kind }],
          `“${candidate.form}” appears in ${count.rows} ${count.rows === 1 ? "paragraph" : "paragraphs"}${added ? " (added: found in the texts or spelled without accents)" : ""}`);
      }
      const confirmCtx = ctx({ headword: written });
      const content = counted.map((c) => [
        c.kind === "extension"
          ? `“${c.form}” (a word of the texts that begins with the same letters): ${c.rows} passages`
          : `“${c.form}” (${c.kind}, confidence ${c.confidence}): ${c.rows} passages`,
        ...c.examples.slice(0, c.kind === "extension" ? 1 : 2).map((e) => `   ${snippet(e.text, e.start, e.end, 90)}`),
      ].join("\n")).join("\n");
      const confirmed = await client.callJson({
        stage: "forms", purpose: `check in example paragraphs that each spelling is “${written}”, not another word spelled the same (such as a verb form)`,
        progress: { key: "form", total: counted.length, unit: "spelling", verb: "checked" },
        instructions: prompts.formsConfirmInstructions(confirmCtx), content,
        schema: prompts.FORMS_CONFIRM_SCHEMA, schemaName: "forms_confirm",
        maxOutputTokens: 3000, effort: settings.effortLight,
      });
      const keep = new Set(confirmed.forms.filter((f) => f.keep).map((f) => f.form.trim().toLowerCase()));
      keep.add(settings.term.trim().toLowerCase());
      const forms = counted.filter((c) => keep.has(c.form.trim().toLowerCase()));
      const inTexts = forms.filter((f) => f.rows > 0).map((f) => f.form);
      const notFound = forms.filter((f) => f.rows === 0).map((f) => f.form);
      fact(`${inTexts.length} ${inTexts.length === 1 ? "spelling" : "spellings"} found in the texts: ${inTexts.join(", ") || "none"}${notFound.length ? `; also kept, though not in the texts: ${notFound.join(", ")}` : ""}`);
      const isExtension = new Set(counted.filter((c) => c.kind === "extension").map((c) => c.form.trim().toLowerCase()));
      const dropped = confirmed.forms.filter((f) => !f.keep && !isExtension.has(f.form.trim().toLowerCase()));
      if (dropped.length) info(`dropped: ${dropped.map((f) => `${f.form} (${f.reason})`).join("; ")}`);
      // The words that begin like the term but are not its forms: candidates for its word family.
      const related = (hint?.related ?? []).filter((f) => isWord(f.form) && !keep.has(f.form.trim().toLowerCase()));
      return { headword: written, confirmed: forms.map((f) => f.form), searched: inTexts, notFound, candidates: counted.filter((c) => c.kind !== "extension" || keep.has(c.form.trim().toLowerCase())).map((c) => ({ form: c.form, kind: c.kind, confidence: c.confidence, rows: c.rows })), decisions: confirmed.forms, related };
    });
  }

  /** Words built on the headword (prefixed, suffixed, compounds, phrases) that occur in the texts. */
  async function findFamily() {
    return stage("family", async () => {
      heading("Word family");
      const forms = store.load("forms");
      const known = new Set((forms.candidates ?? []).map((c) => fold(c.form).trim()));
      const proposed = await client.callJson({
        stage: "family", purpose: `find related words built on “${headword()}”`,
        progress: { key: "form", total: null, unit: "word" },
        instructions: prompts.familyInstructions(ctx()),
        content: [
          `Headword: ${headword()}`,
          `Forms in the study: ${forms.confirmed.join(", ")}`,
          `Words of the texts that begin with the headword's letters and are not its forms: ${(forms.related ?? []).filter((r) => isWord(r.form)).map((r) => r.form).join(", ") || "none"}`,
          dictionaryText(),
        ].join("\n"),
        schema: prompts.FAMILY_SCHEMA, schemaName: "family",
        maxOutputTokens: 3000, effort: settings.effortLight,
      }).catch((error) => {
        info(`word family not listed: ${error.message}`);
        return { words: [] };
      });
      // Only the words the AI lists: a word that merely begins with the same
      // letters ("intimidado" next to "íntimo") is not related.
      const candidates = mergeCaseVariants(
        // Phrases are not related words: the study of the word gives one an entry
        // only when its words' own translations do not compose it.
        proposed.words.filter((w) => w.kind !== "phrase" && isWord(w.form)),
        (w) => w.form,
      ).filter((w) => !known.has(fold(w.form).trim())).slice(0, 45);
      const members = [];
      const examples = new Map(); // a related word's possible form → example passages
      const found = new Set(known);
      const add = async (form, kind, of = null) => {
        const key = fold(form).trim();
        if (!key || found.has(key)) return false;
        found.add(key);
        const count = await corpus.countForm(form).catch(() => ({ rows: 0 }));
        if (count.rows) members.push({ form, kind, rows: count.rows, ...(of ? { of } : {}) });
        if (count.rows && of) examples.set(key, count.examples ?? []);
        // Lands in the related-words display, next to its word.
        logResult("familyCount", [{ form, rows: count.rows, of }], `“${form}”: ${count.rows} passages`);
        return count.rows > 0;
      };
      // Counting takes up to a minute: say so.
      if (candidates.length) info("Counting how many paragraphs use each related word…");
      for (const candidate of candidates) {
        const present = await add(candidate.form, candidate.kind);
        // A member found in the texts brings its own inflections from the texts' word list.
        if (present && corpus.formsHint && !/\s/.test(candidate.form.trim())) {
          const hint = await corpus.formsHint(candidate.form).catch(() => null);
          // Rare words may have no inflection links in the word list; their plurals
          // then appear among the words that extend their stem.
          for (const f of [...(hint?.forms ?? []), ...(hint?.related ?? [])]) if (isWord(f.form)) await add(f.form, candidate.kind, candidate.form);
        }
      }
      // The word list links forms loosely and words that begin alike are not forms
      // ("intimidado" is not a form of "intimidad"): the AI checks each one.
      const possible = members.filter((m) => m.of);
      if (possible.length) {
        const checked = await client.callJson({
          stage: "family", purpose: "check that each word found as a form of a related word is that word",
          progress: { key: "form", total: possible.length, unit: "form", verb: "checked" },
          instructions: prompts.familyFormsInstructions(ctx()),
          content: possible.map((m) => [
            `“${m.form}” as a form of “${m.of}”: ${m.rows} passages`,
            ...(examples.get(fold(m.form).trim()) ?? []).slice(0, 1).map((e) => `   ${snippet(e.text, e.start, e.end, 90)}`),
          ].join("\n")).join("\n"),
          schema: prompts.FORMS_CONFIRM_SCHEMA, schemaName: "family_forms",
          maxOutputTokens: 2000, effort: settings.effortLight,
        }).catch((error) => {
          info(`forms of the related words not checked: ${error.message}`);
          return null;
        });
        const notForms = new Set((checked?.forms ?? []).filter((f) => f.keep === false).map((f) => fold(f.form).trim()));
        for (let i = members.length - 1; i >= 0; i -= 1) {
          if (members[i].of && notForms.has(fold(members[i].form).trim())) members.splice(i, 1);
        }
      }
      members.sort((a, b) => b.rows - a.rows);
      fact(members.length
        ? `Related words in the texts (paragraphs): ${members.map((m) => `${m.form} (${m.rows})`).join(", ")}`
        : "No other words built on the term occur in the texts.");
      return { members, searched: candidates.length };
    });
  }

  /** The person ticks the related words to research after this one, each as its own entry. */
  async function chooseFamily() {
    return stage("familyChoice", async () => {
      if (!deps.chooseFamily || settings.familyBatch) return { words: [] };
      const groups = familyGroups(store.load("family")?.members ?? []);
      if (!groups.length) return { words: [] };
      // The person may take a while to choose: the now line says the research waits for them.
      info("Waiting for you to choose which related words to research next (or none).");
      const words = await deps.chooseFamily({ term: settings.term, groups });
      if (cancelled || words == null) throw new ResearchStop("Research was cancelled.", "cancelled");
      fact(words.length
        ? `Related words to research next, one after another: ${words.map((w) => w.form).join(", ")}`
        : "You chose no related words to research next.");
      return { words };
    });
  }

  function dictionaryText() {
    const text = ctx().dictionaryText;
    return text ? `Dictionary entry:\n${text}` : "Dictionary entry: none found";
  }

  async function drawSample() {
    return stage("sample", async () => {
      heading("Sampling");
      info("Finding every paragraph that uses the word, to pick a random sample…");
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
      logResult("sampling", [{ rows: population.rows, distinct: population.distinct, duplicateGroups: population.duplicateGroups, measuring: n, discovery: discovery.length, overlap }],
        `${population.rows} matching passages, ${population.distinct} distinct (${population.duplicateGroups} duplicate groups); measuring ${n}, discovery ${discovery.length}${overlap ? ` (overlap ${overlap})` : ""}`);
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

  /**
   * The words of the reference books one letter away from the forms that are the
   * term spelled differently, judged by the AI from examples: [{ form, rows, books }].
   */
  async function nearSpellings(forms) {
    const near = corpus.nearForms ? await corpus.nearForms(forms) : null;
    const candidates = (near ?? []).filter((item) => isWord(item.form) && !forms.some((form) => fold(form) === fold(item.form)));
    if (!candidates.length) return [];
    const checked = await client.callJson({
      stage: "sources", purpose: `check which words of the books ${corpus.authorName ?? "the author"} read, one letter away from “${headword()}”, are the same word spelled differently`,
      progress: { key: "form", total: candidates.length, unit: "word", verb: "checked" },
      instructions: prompts.nearFormsInstructions(ctx()),
      content: candidates.map((item) => [
        `“${item.form}” (near “${item.near}”): ${item.rows} ${item.rows === 1 ? "passage" : "passages"}`,
        ...item.examples.slice(0, 2).map((e) => `   [${e.title}] ${snippet(e.text, e.start, e.end, 90)}`),
      ].join("\n")).join("\n"),
      schema: prompts.FORMS_CONFIRM_SCHEMA, schemaName: "near_forms",
      maxOutputTokens: 1500, effort: settings.effortLight,
    }).catch((error) => {
      info(`other spellings in the books not checked: ${error.message}`);
      return null;
    });
    const same = new Set((checked?.forms ?? []).filter((f) => f.keep === true).map((f) => fold(f.form)));
    const kept = candidates.filter((item) => same.has(fold(item.form)));
    if (kept.length) {
      const where = (item) => {
        const titles = item.books.slice(0, 2).map((book) => book.title.split(" — ")[0]);
        return `${item.rows} ${item.rows === 1 ? "passage" : "passages"}, in ${titles.join(" and ")}${item.books.length > 2 ? ` and ${item.books.length - 2} more` : ""}`;
      };
      fact(`Searched too, as other spellings of “${headword()}” in the books ${corpus.authorName ?? "the author"} read: ${kept.map((item) => `“${item.form}” (${where(item)})`).join("; ")}.`);
    }
    return kept.map((item) => ({ form: item.form, rows: item.rows, books: item.books.map((book) => book.title) }));
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
      const author = corpus.authorName ?? "the author";
      info(`Searching the books ${author} read for “${headword()}”…`);
      // The books may spell the term differently ("Akasa", "Hooltanpanas"): words
      // one letter away are checked, and those that are the term are searched too.
      const spellings = await nearSpellings(forms);
      const usage = await corpus.sourceUsage([...forms, ...spellings.map((item) => item.form)], settings.seed);
      if (!usage.length) {
        const held = corpus.sourceBooks ? (await corpus.sourceBooks()).length : 0;
        fact(held > 1
          ? `None of the ${held} books the search site holds of those ${author} read uses “${headword()}”.`
          : held === 1 ? `The one book the search site holds of those ${author} read does not use “${headword()}”.`
            : "None of the reference books uses the term.");
        return { skipped: true, counts: [], spellings };
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
      // Where the author names each of these books: first the paragraphs that name it next
      // to the term (the strongest evidence of borrowing), then a sample of the others.
      const mentions = [];
      const citations = [];
      const citationsByBook = new Map();
      for (const book of top) {
        const name = book.title.split(" — ")[0];
        const phrases = [...new Set([name.replace(/\s*\([^)]*\)\s*/g, " ").trim(), ...[...name.matchAll(/\(([^)]+)\)/g)].map((m) => m[1].trim())])].filter((p) => p.length > 3);
        if (corpus.authorCitations && phrases.length) {
          info(`Looking for places where ${corpus.authorName ?? "the author"} names ${name} next to “${headword()}”…`);
          const found = await corpus.authorCitations(phrases, forms, settings.seed).catch(() => []);
          citationsByBook.set(book.title, found.length);
          citations.push(...found.map((item) => passageSnippet(item, 900)));
        }
        for (const phrase of phrases) {
          const found = corpus.authorMentions ? await corpus.authorMentions(phrase, settings.seed, 6) : [];
          mentions.push(...found.map((item) => passageSnippet(item, 900)));
        }
      }
      // When the author first used the term, for comparing with when each book appeared in Spanish.
      const earliest = corpus.earliestUses ? await corpus.earliestUses(forms) : null;
      const records = (corpus.sourceBooks ? await corpus.sourceBooks() : [])
        .filter((record) => ranked.slice(0, 11).some((book) => book.title === record.title));
      // Pairs of the term with each book's original word, from the search site: the
      // book's own glossaries, or the site's comparison of the translation with its
      // original. A site without them leaves each book's own glossary pairs.
      const sitePairs = records.length && corpus.originalTerms ? await corpus.originalTerms(forms) : null;
      if (sitePairs) {
        for (const record of records) {
          const own = sitePairs.filter((pair) => (record.docId ? pair.docId === record.docId : pair.title === record.title));
          const printed = termPairsOf({ headwordPairs: record.headwordPairs }, forms)
            .filter((pair) => !own.some((item) => item.basis === "printed" && fold(item.original) === fold(pair.original)));
          record.termPairs = [...own, ...printed];
          const named = own.find((pair) => pair.originalTitle || pair.originalAuthor);
          if (named) {
            record.originalTitle ??= named.originalTitle;
            record.originalAuthor ??= named.originalAuthor;
          }
        }
      }
      const pairText = (pair) => `${pair.source} = ${pairWords(pair).join(" / ")}${pair.status === "passthrough" ? " (the original keeps the word)" : ""}${pair.renderings?.length ? ` (the original uses ${pair.renderings.map((r) => `${r.form} ${r.count} times`).join(", ")})` : ""}`;
      const recordLines = records.map((record) => {
        const parts = [record.title];
        if (record.translated) {
          parts.push(`translated from ${record.originalLanguage ?? "another language"}${record.originalTitle ? `: “${record.originalTitle}”${record.originalAuthor ? (signedOnly(record.originalAuthor) ? ` (the author signs only “${record.originalAuthor.trim()}”)` : ` by ${record.originalAuthor}`) : ""}` : ""}`);
          if (record.originalFirstPrinting) parts.push(`original first printed ${record.originalFirstPrinting}`);
          if (record.firstSpanishTranslation) parts.push(`first Spanish translation ${record.firstSpanishTranslation}`);
        } else {
          parts.push("written in Spanish");
        }
        const pairs = record.headwordPairs.length
          ? `\n  The book's own glossary pairs (${settings.sourceLanguageName} = original): ${record.headwordPairs.map((pair) => `${pair.source} = ${pair.original}`).join("; ")}`
          : "";
        const aligned = (record.termPairs ?? []).filter((pair) => pair.basis === "aligned");
        const alignedLine = aligned.length
          ? `\n  The term paired with the original's word by the search site's comparison of this translation with its original (an AI matched the words; a program then confirmed that each original word appears in the matching passages of the original) (${settings.sourceLanguageName} = original): ${aligned.map(pairText).join("; ")}`
          : "";
        return `- ${parts.join("; ")}${pairs}${alignedLine}`;
      });
      const section = (title, lines) => `## ${title}\n${lines.length ? lines.join("\n\n") : "(none)"}`;
      // Where a pair names the term's original word in a book (its own glossaries,
      // or the search site's comparison with the original), read that word in the
      // book's original text before writing the study.
      const originalSections = [];
      const searched = new Set();
      const pairReads = new Map(); // original book id → occurrences of its paired words
      const pairedBooks = []; // books that already pair the term with an original word
      for (const book of top) {
        const record = records.find((item) => item.title === book.title);
        if (!record?.originalBookId || !corpus.originalSample) continue;
        const pairs = termPairsOf(record, forms);
        // One reading per kind of pair, so each fact names its own source.
        for (const group of [pairs.filter((pair) => pair.basis !== "aligned"), pairs.filter((pair) => pair.basis === "aligned")]) {
          if (!group.length) continue;
          const originals = [...new Set(group.flatMap(pairWords))];
          // The forms of the words the original uses ("demons" for "demon"), at most 20.
          const lookFor = [];
          for (const form of [...originals, ...group.flatMap((pair) => pair.originalForms ?? []), ...group.flatMap((pair) => (pair.renderings ?? []).map((r) => r.form))]) {
            if (form && !lookFor.some((seen) => fold(seen) === fold(form))) lookFor.push(form);
          }
          const found = await corpus.originalSample(record.originalBookId, lookFor.slice(0, 20), settings.seed);
          searched.add(`${record.originalBookId}:${fold(originals.join(",")).trim()}`);
          for (const word of originals) searched.add(`${record.originalBookId}:${fold(word).trim()}`);
          pairReads.set(record.originalBookId, (pairReads.get(record.originalBookId) ?? 0) + (found.occurrences ?? 0));
          const name = record.originalTitle ?? book.title;
          if (!pairedBooks.includes(book.title.split(" — ")[0])) pairedBooks.push(book.title.split(" — ")[0]);
          fact(pairFact({
            site: corpus.authorName ?? "author's", author: corpus.authorName ?? "the author",
            shortTitle: book.title.split(" — ")[0], record, term: headword(), pairs: group,
            occurrences: found.occurrences, searched: lookFor.slice(0, 20),
          }));
          originalSections.push(section(
            `The original text of ${name}: ${found.occurrences} occurrences of ${lookFor.slice(0, 20).map((o) => `“${o}”`).join(", ")} in ${found.paragraphs} passages (a sample)`,
            found.items.map((item) => passageSnippet({ ...item, reference: { title: name } })),
          ));
        }
      }
      const content = [
        `# Term: ${headword()}\nSpellings searched: ${forms.join(", ")}${spellings.length ? `\nAlso searched in the reference books, which spell it differently: ${spellings.map((item) => item.form).join(", ")}` : ""}`,
        section("Dictionary entry", [ctx().dictionaryText || "(none found)"]),
        section("Occurrences in the reference books (books the author read)", [ranked.map((book) => {
          const length = records.find((record) => record.title === book.title)?.paragraphs;
          return `- ${book.title}: ${book.occurrences} occurrences in ${book.passages} paragraphs${length ? ` (the book has ${length} paragraphs: ${((1000 * book.occurrences) / length).toFixed(1)} per 1,000)` : ""}`;
        }).join("\n")]),
        section("Records of the reference books", [recordLines.join("\n") || "(no records)"]),
        section(`Passages from the books that use it most (${top.map((book) => book.title).join("; ")})`, top.flatMap((book) => book.items.slice(0, 14).map((item) => passageSnippet(item)))),
        ...originalSections,
        section("One passage from each of the other books", others.map((book) => passageSnippet(book.items[0]))),
        section("Where the author names those books next to the term", citations),
        section("Where the author names those books (a sample)", mentions),
        ...(earliest ? [section("The author's earliest dated uses of the term (year: work)", earliest.map((item) => `[${item.year ?? "undated"}: ${item.reference?.title ?? ""}]\n${snippet(item.text, item.occurrences[0]?.start ?? 0, item.occurrences[0]?.end ?? 0, 300)}`))] : []),
        section("A sample of the author's own uses", authorPassages()),
      ].join("\n\n");
      const study = await client.callJson({
        stage: "sources", purpose: sourcesPurpose(corpus.authorName ?? "the author", headword(), pairedBooks),
        progress: { key: "sense", total: null, unit: "meaning" },
        instructions: prompts.sourcesInstructions(ctx()), content,
        schema: prompts.SOURCES_SCHEMA, schemaName: "sources",
        maxOutputTokens: 16000, effort: settings.effortStudy,
      });
      await checkOriginalTerms(study, top, records, searched);
      for (const sense of study.senses) {
        const book = bookOfSense(sense, top);
        const record = book && records.find((item) => item.title === book.title);
        const word = originalWordOf(sense, record, { forms, pairReads });
        if (!sense.inDictionary && record) {
          sense.borrowing = borrowingStrength(sense, record, {
            citations: citationsByBook.get(book.title) ?? 0,
            pair: word?.verified ? word.pairBasis ?? null : null,
          });
          const line = borrowingText(sense, sense.borrowing, { author: corpus.authorName ?? "The author", term: headword(), translationTitle: record.title.split(" — ")[0].replace(/\s*\([^)]*\)\s*$/, "") });
          if (line) fact(line);
        }
        if (!word) continue;
        sense.originalWord = word;
        if (word.verified && requiredOriginalWords({ senses: [sense] }, settings.targetLanguageCode).length) {
          fact(`“${word.term}” is the original ${settings.targetLanguageName} word of ${bookName(word)} for “${sense.sense}” (${word.basis}): it will be the translation for that meaning, whatever its frequency.`);
        }
      }
      // Every sense, borrowed ones with their book and original word, so the step's
      // one-line summary can lead with where the author took the term from.
      for (const sense of study.senses) {
        const verified = sense.originalWord?.verified === true;
        logResult("senses", [{
          sense: sense.sense, label: sense.label ?? "", partOfSpeech: sense.partOfSpeech ?? sense.wordClass ?? "", inDictionary: sense.inDictionary === true,
          sourceBook: sense.sourceBook ?? null, originalTerm: sense.originalTerm ?? null, originalLanguage: sense.originalLanguage ?? null,
          verified, term: headword(), language: settings.sourceLanguageName,
          originalTitle: sense.originalWord?.originalTitle ?? null, originalAuthor: sense.originalWord?.originalAuthor ?? null,
          translationTitle: sense.originalWord?.translationTitle ? sense.originalWord.translationTitle.split(" — ")[0].replace(/\s*\([^)]*\)\s*$/, "") : null,
        }], `${sense.sense}${sense.sourceBook ? ` — from ${sense.sourceBook}` : ""}${sense.originalTerm ? ` (original ${sense.originalLanguage ?? ""} term “${sense.originalTerm}”)` : ""}`);
      }
      return {
        counts: ranked.map((book) => ({ title: book.title, occurrences: book.occurrences, passages: book.passages })),
        topBooks: top.map((book) => book.title),
        study,
      };
    });
  }

  /** The reference book (of the most-used ones) a study sense names as its source. */
  function bookOfSense(sense, top) {
    if (!sense?.sourceBook) return null;
    return top.find((item) => {
      const name = item.title.split(" — ")[0].replace(/\s*\([^)]*\)\s*/g, " ").trim().toLowerCase();
      return name && sense.sourceBook.toLowerCase().includes(name);
    }) ?? null;
  }

  /** Original words this glossary must use (see glossary-research-original-word.js). */
  function requiredOriginals() {
    return requiredOriginalWords(store.load("sources")?.study, settings.targetLanguageCode);
  }

  /**
   * When the study only believes it knows the original word of a sense from a
   * translated book, check that word against the book's original text.
   */
  async function checkOriginalTerms(study, top, records, searched) {
    if (!corpus.originalSample) return;
    for (const sense of study.senses) {
      if (sense.inDictionary || !sense.originalTerm || !sense.sourceBook) continue;
      const book = bookOfSense(sense, top);
      const record = book && records.find((item) => item.title === book.title);
      if (!record?.originalBookId || searched.has(`${record.originalBookId}:${fold(sense.originalTerm).trim()}`)) continue;
      const name = record.originalTitle ?? book.title;
      info(`Reading the original book, ${name}, to check “${sense.originalTerm}”…`);
      const found = await corpus.originalSample(record.originalBookId, [sense.originalTerm], settings.seed, 10);
      info(`Reading the original book, ${name}: “${sense.originalTerm}” appears ${found.occurrences} times`);
      const content = [
        `Term: ${headword()}. Proposed original word: “${sense.originalTerm}” (${sense.originalTermBasis}).`,
        `## The original text (${name}): ${found.occurrences} occurrences in ${found.paragraphs} passages (a sample)`,
        found.items.map((item) => passageSnippet({ ...item, reference: { title: name } })).join("\n\n") || "(no passage contains the proposed word)",
        `## The ${settings.sourceLanguageName} edition (${book.title})`,
        book.items.slice(0, 8).map((item) => passageSnippet(item)).join("\n\n"),
      ].join("\n\n");
      const check = await client.callJson({
        stage: "sources", purpose: `confirm in the original book that “${sense.originalTerm}” is the word behind “${headword()}”`,
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
      const originals = requiredOriginals();
      const content = [
        `# Term: ${headword()}`,
        `## Dictionary entry\n${ctx().dictionaryText || "(none found)"}`,
        sources?.study ? `## Study of where the term comes from\n${JSON.stringify(sources.study, null, 1)}` : "",
        originals.length ? `## Original words (required)\n${originalWordsText(originals, settings.targetLanguageName)}` : "",
        partsText(),
        `## Passages from the texts\n${authorPassages().join("\n\n")}`,
      ].filter(Boolean).join("\n\n");
      const result = await client.callJson({
        stage: "candidates", purpose: `propose ${settings.targetLanguageName} translations for each meaning`,
        // One block per meaning; the model may leave some meanings out, so no total.
        progress: { key: "senseId", total: null, unit: "meaning" },
        instructions: prompts.candidatesInstructions(ctx()), content,
        schema: prompts.CANDIDATES_SCHEMA, schemaName: "candidates",
        maxOutputTokens: 16000, effort: settings.effortStudy,
      });
      result.originalWords = placeOriginalWords(result, originals);
      for (const word of result.originalWords) {
        info(`“${word.term}” is the recommended translation of “${word.senseText}”: the original word of ${bookName(word)}${word.added ? " (added: the candidates had left it out)" : ""}.`);
      }
      for (const sense of result.senses) {
        logResult("candidates",
          [{ sense: sense.sense, groups: sense.groups.map((g) => ({ recommended: Boolean(g.recommended), members: g.members })) }],
          `${sense.sense}: ${sense.groups.map((g) => `${g.recommended ? "★ " : ""}${g.members.join(" / ")}`).join("; ")}`);
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
        `# Term: ${headword()}\nForms in the texts: ${forms.join(", ")}`,
        `## Word family in the texts\n${family.map((m) => `- ${m.form} (${m.kind}, ${m.rows} passages)`).join("\n") || "(none found)"}`,
        `## ${dictionaryText()}`,
        sources?.summary ? `## Where the term comes from\n${sources.summary}` : "",
        priorsText(priorMeasurements(settings.sourceLanguageCode)),
        `## Passages from the texts\n${authorPassages().slice(0, 15).join("\n\n")}`,
      ].filter(Boolean).join("\n\n");
      const study = await client.callJson({
        stage: "parts", purpose: `list the meanings of “${headword()}”`,
        progress: { key: "gloss", total: null, unit: "meaning" },
        instructions: prompts.partsInstructions(ctx()), content,
        schema: prompts.PARTS_SCHEMA, schemaName: "parts",
        maxOutputTokens: 6000, effort: settings.effortProposal,
      });
      logResult("frequency", [{ kind: "parts", parts: study.parts.map(({ part, meaning }) => ({ part, meaning })) }],
        `Parts: ${study.parts.map((part) => `${part.part} (${part.meaning})`).join(" + ")}`);
      const result = { study, source: null };
      const code = settings.sourceLanguageCode;
      const name = settings.sourceLanguageName;
      if (!(await frequencyReady(code, name))) return result;
      const formZipfs = await languageData.zipf(code, forms);
      const listZipf = combinedZipf(formZipfs);
      info(`Finding everyday ${name} sentences that use “${headword()}”, to see how common each meaning is…`);
      const term = await measureSenses({
        code, name, forms, listZipf,
        senses: study.senses.map(({ id, gloss, partOfSpeech }) => ({ id, gloss, partOfSpeech })),
        purpose: `sort everyday ${name} sentences with “${headword()}” by meaning`,
      });
      const inDictionary = store.load("dictionary")?.status === "found";
      const invented = !inDictionary && !(term.wordZipf >= 1);
      const bases = [];
      if (study.isCompound) {
        for (const base of study.bases.slice(0, 3)) {
          const baseForms = [...new Set([base.word, ...base.forms].map((f) => f.trim()).filter(Boolean))];
          const baseList = combinedZipf(await languageData.zipf(code, baseForms));
          info(`The part “${base.word}”: finding everyday ${name} sentences that use it, to see how often it has the meaning it has in the term…`);
          const measure = reusedMeasure(priorMeasurements(code), base.reuse, base.word) ?? await measureSenses({
            code, name, forms: baseForms, listZipf: baseList,
            senses: [{ id: "needed", gloss: base.neededSense }, ...base.otherSenses.slice(0, 5).map((gloss, i) => ({ id: `o${i + 1}`, gloss }))],
            purpose: `sort everyday ${name} sentences with “${base.word}” by meaning`,
          });
          bases.push({ word: base.word, neededSense: base.neededSense, measure, needed: measure.senses.needed ?? null });
          logResult("frequency", [{ kind: "measure", language: name, word: base.word, zipf: measure.wordZipf, neededSense: base.neededSense, senseText: describeSense(measure.senses.needed) }],
            `${name} “${base.word}”: Zipf ${formatZipf(measure.wordZipf)}; in the sense “${base.neededSense}”: ${describeSense(measure.senses.needed)}`);
        }
      }
      const familyZipfs = family.length ? await languageData.zipf(code, family.map((m) => m.form)) : [];
      result.source = {
        forms: forms.map((form, i) => ({ form, zipf: formZipfs[i] ?? 0 })),
        listZipf, wordZipf: term.wordZipf, inDictionary, invented, term, bases,
        family: family.map((m, i) => ({ ...m, zipf: familyZipfs[i] ?? 0 })),
      };
      const used = study.senses.filter((sense) => sense.usedByAuthor);
      logResult("frequency", [{
        kind: "term", language: name, word: headword(), zipf: term.wordZipf, invented,
        senses: used.map((sense) => ({ gloss: sense.gloss, senseText: describeSense(term.senses[sense.id]) })),
      }], `${name} “${headword()}”: Zipf ${formatZipf(term.wordZipf)}${invented ? " — not in the dictionary and practically absent from general use: the author's own word" : ""}${used.length ? `; senses the author uses, in general ${name}: ${used.map((sense) => `${sense.gloss} ${describeSense(term.senses[sense.id])}`).join("; ")}` : ""}`);
      return result;
    });
  }

  /**
   * The source measurement a target word is compared with: a base word of a compound
   * when the target word resembles it, else the term itself in the sense the
   * candidate renders.
   */
  function sourceReference(resembles, senseId) {
    const parts = store.load("parts");
    const source = parts?.source;
    if (!source) return null;
    const key = fold(resembles ?? "").trim();
    const base = key && source.bases.find((b) => {
      const word = fold(b.word).trim();
      return word && (word === key || key.includes(word) || word.includes(key));
    });
    if (base?.needed) return { label: base.word, measure: base.needed };
    if (source.invented) return { label: headword(), invented: true };
    const measure = senseId && source.term.senses[senseId];
    return measure ? { label: `${headword()} (${parts.study.senses.find((x) => x.id === senseId)?.gloss ?? senseId})`, measure } : null;
  }

  /** Glossary entries for other terms that already use this translation. */
  function findClashes(target) {
    const key = textKey(target, settings.targetLanguageCode);
    const own = new Set([...(store.load("forms")?.confirmed ?? []), ...((store.load("family")?.members ?? []).map((m) => m.form))].map((f) => fold(f).trim()));
    return glossaryTerms
      .filter((term) => (term.targetTerms ?? []).some((t) => textKey(t, settings.targetLanguageCode) === key))
      .filter((term) => !(term.sourceTerms ?? []).some((t) => own.has(fold(t).trim())))
      .slice(0, 3)
      .map((term) => ({ sourceTerms: term.sourceTerms ?? [], targetTerms: term.targetTerms ?? [] }));
  }

  /**
   * Every candidate group against general target-language usage. Each group is
   * represented by the member whose score best fits the source sense; that member
   * and every look-alike member are checked, look-alikes sense by sense.
   */
  async function checkCandidates() {
    return stage("checks", async () => {
      heading("Candidate checks");
      const groups = [];
      for (const sense of store.load("candidates")?.senses ?? []) {
        for (const group of sense.groups ?? []) {
          const members = [...new Set(group.members.map((m) => m.trim()).filter(Boolean))];
          if (members.length) groups.push({ senseId: sense.senseId, sense: sense.sense, members, recommended: group.recommended, note: group.note, ...(group.original ? { original: true } : {}) });
        }
      }
      if (!groups.length) return { available: false, groups: [], candidates: [], failedWords: [], failedTargets: [] };
      const code = settings.targetLanguageCode;
      const name = settings.targetLanguageName;
      const sourceName = settings.sourceLanguageName;
      const parts = store.load("parts");
      const source = parts?.source ?? null;
      const ready = await frequencyReady(code, name);
      // Scores of every member as a unit and, where spaces separate words, of its words (no AI tokens).
      const splitAtSpaces = !NOT_SPACE_SPLIT.has(baseLanguage(code));
      const lookups = groups.flatMap((g) => g.members.flatMap((m) => [m, ...(splitAtSpaces ? renderingTokens(m) : [])]));
      const zipfOf = ready ? await wordScores(code, lookups.map((word) => ({ word }))) : new Map();
      const sourceWords = [...(store.load("forms")?.confirmed ?? []), ...(parts?.study?.parts ?? []).map((p) => p.part)];
      for (const group of groups) {
        const ref = source && !source.invented ? source.term.senses[group.senseId] : null;
        const target = ref?.zipf ?? null;
        group.representative = group.original ? group.members[0] : pickRepresentative(group.members, (m) => (ready ? renderingScore(m, zipfOf) : null), target);
        group.lookalikes = group.members.filter((m) => m !== group.representative && looksLike(m, sourceWords));
      }
      // One check per rendering and sense: a word can carry one sense and lack another.
      const toCheck = [];
      const seen = new Set();
      for (const group of groups) {
        for (const target of [group.representative, ...group.lookalikes]) {
          const key = `${textKey(target, code)}\u0000${group.senseId}`;
          if (seen.has(key)) continue;
          seen.add(key);
          toCheck.push({ n: toCheck.length + 1, target, sense: group.sense, senseId: group.senseId });
        }
      }
      const sources = store.load("sources")?.study;
      const analysis = await client.callJson({
        stage: "checks", purpose: "take each candidate apart into its words, and say which meaning each word needs",
        progress: { key: "n", total: toCheck.length, unit: "translation" },
        instructions: prompts.checkInstructions(ctx()),
        content: [
          `# Term: ${headword()}`,
          `## Candidates (number. rendering — the sense it must render)\n${toCheck.map((c) => `${c.n}. ${c.target} — ${c.sense}`).join("\n")}`,
          parts?.study ? `## Parts of the term\n${parts.study.parts.map((p) => `- ${p.part}: ${p.meaning}`).join("\n")}` : "",
          sources ? `## Where the term comes from\n${JSON.stringify(sources.senses.map((x) => ({ sense: x.sense, sourceBook: x.sourceBook, originalLanguage: x.originalLanguage, originalTerm: x.originalTerm })), null, 1)}` : "",
          priorsText(priorMeasurements(code)),
        ].filter(Boolean).join("\n\n"),
        schema: prompts.CHECK_SCHEMA, schemaName: "checks",
        maxOutputTokens: 1500 + 300 * toCheck.length, effort: settings.effortLight,
      });
      // Safety net: a candidate word that contains the spelling of a base word of the
      // source term (a calque built on it) has that base measured too, in the sense it
      // needs, even when the model did not split the word.
      const sourceBases = (parts?.study?.bases ?? []).filter((b) => fold(b.word).trim().length >= 4);
      for (const candidate of analysis.candidates) {
        for (const w of [...candidate.words]) {
          const word = fold(w.word).trim();
          for (const b of sourceBases) {
            const base = fold(b.word).trim();
            if (word === base || !word.includes(base)) continue;
            if (candidate.words.some((x) => fold(x.word).trim() === base)) continue;
            candidate.words.push({ word: b.word, partOf: w.word, forms: [], neededSense: b.neededSense, lookalike: true, resembles: b.word, otherSenses: b.otherSenses ?? [], addedFromBase: true });
          }
        }
      }
      if (ready) {
        for (const candidate of analysis.candidates) {
          candidate.target ??= toCheck.find((c) => c.n === candidate.n)?.target ?? "";
        }
        info(`Looking up how common each candidate's words are in everyday ${name}…`);
        await joinListedUnits(languageData, code, analysis.candidates, (candidate) => toCheck.find((c) => c.n === candidate.n)?.sense);
      }
      const byNumber = new Map(analysis.candidates.map((c) => [c.n, c]));
      // A word is measured once for each distinct sense it must carry.
      const measureKey = (w) => `${textKey(w.word, code)}\u0000${textKey(w.neededSense)}`;
      const words = [...new Map(analysis.candidates.flatMap((c) => c.words).map((w) => [measureKey(w), w])).values()];
      // Every listed word scored with its forms added up (this replaces the unit scores above).
      if (ready) {
        const byWord = new Map();
        for (const w of analysis.candidates.flatMap((c) => c.words)) {
          const key = textKey(w.word, code);
          byWord.set(key, { word: w.word, forms: [...new Set([...(byWord.get(key)?.forms ?? []), ...(w.forms ?? [])])] });
        }
        for (const [key, score] of await wordScores(code, [...byWord.values()])) zipfOf.set(key, score);
      }
      const measured = new Map();
      if (ready) {
        // Look-alikes are measured sense by sense; where a search also matches
        // letters inside other words, the other words get an instance check.
        // The likeliest false friends first: a word spelled like the term, one of its
        // forms or parts; then a look-alike that is a whole candidate; then the rest
        // by how much of its spelling it shares with the source words.
        const exact = new Set([...sourceWords, ...(store.load("family")?.members ?? []).map((m) => m.form)].map((w) => fold(w).trim()));
        const wholeCandidates = new Set(toCheck.map((c) => fold(c.target).trim())); // compared with fold() below
        const rank = (w) => {
          const key = fold(w.word).trim();
          if (exact.has(key)) return 0;
          if (wholeCandidates.has(key)) return 1;
          return 2 + (looksLike(w.word, sourceWords) ? 0 : 1);
        };
        const lookalikes = words.filter((w) => w.lookalike).sort((a, b) => rank(a) - rank(b));
        const measure = (w) => measureSenses({
          code, name, forms: [...new Set([w.word, ...(w.forms ?? [])])], listZipf: zipfOf.get(textKey(w.word, code)),
          senses: w.lookalike
            ? [{ id: "needed", gloss: w.neededSense }, ...w.otherSenses.slice(0, 5).map((gloss, i) => ({ id: `o${i + 1}`, gloss }))]
            : [{ id: "needed", gloss: w.neededSense }],
          purpose: `sort everyday ${name} sentences with “${w.word}” by meaning`,
        });
        // Only measurements that had sentences to sort count against the limit: a
        // word absent from the general corpus costs nothing and must not crowd out
        // the words whose senses can be measured.
        // Words measured in an earlier run of the batch, in the same sense, are not measured again.
        const priors = priorMeasurements(code);
        for (const w of lookalikes) {
          const reused = reusedMeasure(priors, w.reuse, w.word);
          if (reused) {
            measured.set(measureKey(w), reused);
            info(`“${w.word}” was measured in an earlier run in this sense; reused.`);
          }
        }
        const toMeasure = lookalikes.filter((x) => !measured.has(measureKey(x)));
        if (toMeasure.length) info(`${toMeasure.length === 1 ? "One candidate word looks" : `${toMeasure.length} candidate words look`} like the ${sourceName} word, so ${toMeasure.length === 1 ? "it might be a false friend: its meanings" : "they might be false friends: their meanings"} in everyday ${name} are checked.`);
        let sorted = 0;
        for (const [index, w] of toMeasure.entries()) {
          if (sorted >= settings.maxSenseChecks) {
            info(`Measurement limit reached (${settings.maxSenseChecks} words with sentences to sort); ${toMeasure.length - index} left unmeasured.`);
            break;
          }
          info(`“${w.word}” looks like the ${sourceName} word: finding everyday ${name} sentences that use it, to see which meanings it has…`);
          const m = await measure(w);
          measured.set(measureKey(w), m);
          if (m.classified) sorted += 1;
          else info(`“${w.word}” does not occur in the general ${name} corpus.`);
        }
        if (corpusCounted(code)) {
          const unspaced = words.filter((x) => !x.lookalike).slice(0, 4);
          for (const [index, w] of unspaced.entries()) {
            info(`Word ${index + 1} of ${unspaced.length}, “${w.word}”: finding everyday ${name} sentences that really contain it (in ${name}, a search also matches parts of other words)…`);
            measured.set(measureKey(w), await measure(w));
          }
        }
        // A whole-word score counts every meaning of the word; a translation is
        // used in one. So the word that sets a translation's score is sorted by
        // meaning too, where it can change the outcome: the translation passes on
        // the whole word (sorting can only lower a score) in a meaning with a minimum.
        if (source && !source.invented) {
          const deciding = [];
          for (const c of toCheck) {
            const ref = source.term.senses[c.senseId];
            if (ref?.zipf == null) continue;
            const scored = (byNumber.get(c.n)?.words ?? [])
              .filter((w) => !w.partOf)
              .map((w) => ({ w, z: zipfOf.get(textKey(w.word, code)) }))
              .filter((x) => x.z != null && x.z > 0);
            if (!scored.length) continue;
            const rarest = scored.reduce((a, b) => (b.z < a.z ? b : a));
            if (rarest.z < ref.zipf - 1 || measured.has(measureKey(rarest.w))) continue;
            deciding.push(rarest.w);
          }
          const unique = [...new Map(deciding.map((w) => [measureKey(w), w])).values()];
          for (const w of unique) {
            const reused = reusedMeasure(priors, w.reuse, w.word);
            if (reused) measured.set(measureKey(w), reused);
          }
          const todo = unique.filter((w) => !measured.has(measureKey(w)));
          if (todo.length) info(`${todo.length} ${todo.length === 1 ? "word decides" : "words decide"} whether ${todo.length === 1 ? "its candidate passes" : "their candidates pass"}: checking how often each is used in the meaning needed. (Very common words pass without this.)`);
          let sortedDeciding = 0;
          for (const [index, w] of todo.entries()) {
            if (sortedDeciding >= settings.maxDecidingChecks) {
              info(`Limit reached (${settings.maxDecidingChecks} words sorted by meaning); ${todo.length - index} scored on all their uses.`);
              break;
            }
            info(`Word ${index + 1} of ${todo.length}, “${w.word}”: finding everyday ${name} sentences that use it…`);
            const m = await measure(w);
            measured.set(measureKey(w), m);
            if (m.classified) sortedDeciding += 1;
          }
        }
      }
      const failedWords = [];
      const passedWords = new Set();
      const failedTargets = [];
      const passedTargets = new Set();
      const placedOriginals = store.load("candidates")?.originalWords ?? [];
      const candidates = toCheck.map((c) => {
        const found = byNumber.get(c.n);
        const original = originalFor(placedOriginals, c.target, c.senseId);
        const reasons = [];
        const notes = [];
        let verdict = ready ? "pass" : "unchecked";
        const senseRef = source && !source.invented ? source.term.senses[c.senseId] ?? null : null;
        const items = (found?.words ?? []).map((w) => {
          const m = measured.get(measureKey(w));
          return {
            word: w.word, neededSense: w.neededSense, lookalike: w.lookalike, resembles: w.resembles,
            partOf: w.partOf ?? null,
            zipf: m ? m.wordZipf : zipfOf.get(textKey(w.word, code)) ?? null,
            measure: m ? { hits: m.hits, classified: m.classified, instances: m.instances, notWord: m.notWord, needed: m.senses.needed ?? null, ...(m.reused ? { reused: true } : {}) } : null,
          };
        });
        // This translation's own view of its words' scores: a word sorted by
        // meaning (on enough sentences) counts only its uses in the meaning needed.
        const senseScore = new Map(zipfOf);
        if (ready) {
          for (const w of items.filter((item) => !item.partOf && item.measure?.needed)) {
            const needed = w.measure.needed;
            if (w.measure.instances < MIN_SENSE_SAMPLE) {
              if (!w.lookalike) notes.push(`“${w.word}”: only ${w.measure.instances} everyday ${name} ${w.measure.instances === 1 ? "sentence uses" : "sentences use"} it, too few to tell its meanings apart; judged on all its uses`);
              continue;
            }
            senseScore.set(textKey(w.word, code), needed.zipf ?? needed.upperBound ?? 0);
            if (!w.lookalike && needed.inSense === 0 && senseRef?.zipf != null) {
              verdict = "fail";
              reasons.push(`“${w.word}” is never used in everyday ${name} in the meaning needed (${w.neededSense}): 0 of ${needed.classified} sentences`);
            }
          }
          for (const w of items.filter((item) => item.lookalike && item.measure)) {
            const needed = w.measure.needed;
            const ref = sourceReference(w.resembles, c.senseId);
            if (!needed || w.measure.instances < MIN_SENSE_SAMPLE) {
              notes.push(`“${w.word}”: only ${w.measure.instances} everyday ${name} ${w.measure.instances === 1 ? "sentence uses" : "sentences use"} it, too few to measure`);
              if (verdict === "pass") verdict = "unclear";
              continue;
            }
            if (needed.inSense === 0) {
              if (!ref?.measure) {
                notes.push(`“${w.word}”: not used in the sense needed in general ${name} (0 of ${needed.classified}); no ${sourceName} measurement to compare`);
                if (verdict === "pass") verdict = "unclear";
                continue;
              }
              if (!ref.measure.inSense) {
                notes.push(`“${w.word}”: the sense needed is rare in both languages`);
                passedWords.add(textKey(w.word, code));
                continue;
              }
              verdict = "fail";
              if (!original) failedWords.push(w.word);
              reasons.push(`“${w.word}” looks like the ${sourceName} word but is never used in everyday ${name} in the meaning needed (${w.neededSense}): 0 of ${needed.classified} sentences`);
            } else if (ref?.measure?.zipf != null && needed.zipf != null && needed.zipf < ref.measure.zipf - 1) {
              verdict = "fail";
              if (!original) failedWords.push(w.word);
              reasons.push(`“${w.word}” is much rarer in the meaning needed than ${sourceName} “${ref.label}”: ${commonness(needed.zipf)} against ${commonness(ref.measure.zipf)}`);
            } else {
              passedWords.add(textKey(w.word, code));
            }
          }
          // The whole rendering against the source sense it translates (no demand when that sense is rare in the source too).
          const z = renderingScore(c.target, senseScore, found?.words);
          if (senseRef?.zipf != null && !found?.establishedUsage && z != null && z < senseRef.zipf - 1) {
            verdict = "fail";
            reasons.push(`much less familiar to ${name} readers than “${headword()}” is to ${sourceName} readers in this meaning: ${commonness(z)} against ${commonness(senseRef.zipf)}`);
          }
        }
        if (original && verdict !== "unchecked") {
          // The original word of the book the meaning comes from is kept whatever its frequency.
          notes.unshift(`the original word of ${bookName(original)}: the translation for this meaning, whatever its frequency`);
          notes.push(...reasons.map((reason) => `not applied: ${reason}`));
          reasons.length = 0;
          verdict = "pass";
        }
        if (verdict === "fail") failedTargets.push(c.target);
        else passedTargets.add(textKey(c.target, code));
        return {
          target: c.target, sense: c.sense, senseId: c.senseId, words: items, verdict, reasons, notes,
          zipf: ready ? renderingScore(c.target, senseScore, found?.words) : null,
          established: found?.establishedUsage ?? false, establishedBasis: found?.establishedBasis ?? "",
          ...(original ? { original: bookName(original) } : {}),
          clashes: findClashes(c.target),
        };
      });
      for (const c of candidates) {
        const clashes = c.clashes.map((x) => `already used for ${x.sourceTerms.join(" / ")}`);
        const extra = [...c.reasons, ...c.notes, ...clashes];
        logResult("checks",
          [{ target: c.target, verdict: c.verdict, reasons: c.reasons, notes: c.notes, clashes, words: c.words.filter((w) => !w.partOf).map((w) => ({ word: w.word, zipf: w.zipf })) }],
          `${c.target}: ${c.verdict}${extra.length ? ` — ${extra.join("; ")}` : ""}`);
      }
      const outGroups = groups.map((g) => ({
        senseId: g.senseId, sense: g.sense, recommended: g.recommended, note: g.note, representative: g.representative,
        ...(g.original ? { original: true } : {}),
        members: g.members.map((m) => ({
          target: m,
          zipf: ready ? renderingScore(m, zipfOf, analysis.candidates.find((c) => textKey(c.target, code) === textKey(m, code))?.words) : null,
        })),
      }));
      // A word that fails in one sense but passes in another is not banned: only the
      // renderings checked for the failing sense go.
      const banned = [...new Set(failedWords)].filter((w) => !passedWords.has(textKey(w, code)));
      // Likewise a rendering that fails for one sense but passes for another stays:
      // the passages decide where it fits.
      const failedEverywhere = [...new Set(failedTargets)].filter((t) => !passedTargets.has(textKey(t, code)));
      return { available: ready, groups: outGroups, candidates, failedWords: banned, failedTargets: failedEverywhere };
    });
  }

  function partsText() {
    const parts = store.load("parts");
    if (!parts?.study) return "";
    const source = parts.source;
    const lines = [
      `## Parts of the term\n${parts.study.parts.map((p) => `- ${p.part}: ${p.meaning}`).join("\n")}`,
      `## The term's senses\n${parts.study.senses.map((sense) => `- ${sense.id}${sense.partOfSpeech ? ` (${sense.partOfSpeech})` : ""}: ${sense.gloss}${sense.usedByAuthor ? " (used by the author)" : ""}${source ? `; in general ${settings.sourceLanguageName}: ${describeSense(source.term.senses[sense.id])}` : ""}`).join("\n")}`,
    ];
    if (source) {
      lines.push(`Frequency in general ${settings.sourceLanguageName} (Zipf: 0 = not in ordinary use, 3 = everyday word, 5+ = very common): “${headword()}” ${formatZipf(source.wordZipf)}${source.invented ? " (not in the dictionary; practically absent from general use)" : ""}.`);
      for (const base of source.bases) lines.push(`“${base.word}” ${formatZipf(base.measure.wordZipf)}; in the sense “${base.neededSense}”: ${describeSense(base.needed)}.`);
    }
    return lines.join("\n");
  }

  function checksText() {
    const checks = store.load("checks");
    if (!checks?.candidates?.length) return "(no checks)";
    const byTarget = new Map(checks.candidates.map((c) => [textKey(c.target), c]));
    const line = (c) => {
      const words = c.words.map((w) => `${w.word} ${formatZipf(w.zipf)}${w.measure?.needed ? `, sense needed ${describeSense(w.measure.needed)}` : ""}`).join("; ");
      return `${c.target}: ${c.verdict.toUpperCase()}${c.original ? ` (ORIGINAL WORD of ${c.original})` : ""}${c.reasons.length ? ` (${c.reasons.join("; ")})` : ""}${words ? ` [${words}]` : ""}${c.clashes.length ? ` [already used for: ${c.clashes.map((x) => x.sourceTerms.join(" / ")).join("; ")}]` : ""}`;
    };
    if (!checks.groups?.length) return checks.candidates.map((c) => `- ${line(c)}`).join("\n");
    return checks.groups.map((g) => {
      const rep = byTarget.get(textKey(g.representative));
      const others = g.members.filter((m) => m.target !== g.representative).map((m) => {
        const checked = byTarget.get(textKey(m.target));
        return checked ? line(checked) : `${m.target} ${formatZipf(m.zipf)}`;
      });
      return `- [${g.sense}]${g.recommended ? " (recommended)" : ""} ${rep ? line(rep) : g.representative}${others.length ? `\n    also: ${others.join(" | ")}` : ""}`;
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
        stage: "discovery", purpose: `translate ${batch.occurrences.length === 1 ? "1 use" : `${batch.occurrences.length} uses`} of the word freely, without suggestions`,
        progress: { key: "occId", total: batch.occurrences.length, unit: "use", all: occurrences.length },
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
      // One count per wording whatever its capitals, shown as first written ("Innermost" stays capitalised).
      const tally = {};
      const spelled = {};
      for (const row of Object.values(readings)) {
        const key = row.rendering.toLowerCase();
        spelled[key] ??= row.rendering;
        tally[key] = (tally[key] ?? 0) + 1;
      }
      const top = Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([key, n]) => [spelled[key], n]);
      logResult("discovery", [{ read: Object.keys(readings).length, total: occurrences.length, renderings: Object.keys(tally).length, top }],
        `${Object.keys(readings).length} of ${occurrences.length} occurrences read; ${Object.keys(tally).length} different renderings; most common: ${top.map(([k, v]) => `${k} (${v})`).join(", ")}`);
      return { occurrences, readings };
    });
  }

  function proposalContent() {
    const sample = store.load("sample");
    const forms = store.load("forms");
    const disc = store.load("discovery");
    const lines = [
      `Headword: ${headword()}. Confirmed forms: ${forms.confirmed.join(", ")}${forms.notFound.length ? ` (not in the texts: ${forms.notFound.join(", ")})` : ""}.`,
      `Derived words sharing the stem (not in this study): ${forms.related.map((r) => `${r.form} (${r.rows})`).join(", ") || "none listed"}`,
      `Population: ${sample.meta.populationDistinct} distinct passages.`,
      "",
      "Recurring neighbours across the whole population (occurrences / passages):",
      ...(sample.neighbours ?? []).slice(0, 40).map((n) => `- ${n.phrase}: ${n.occurrences} / ${n.paragraphs}`),
      "",
      "Study of where the term comes from:",
      store.load("sources")?.study ? JSON.stringify(store.load("sources").study, null, 1) : "(not available for these texts)",
      "",
      ...(() => {
        const text = originalWordsText(requiredOriginals(), settings.targetLanguageName);
        return text ? ["Original words (required; see the rule on original words):", text, ""] : [];
      })(),
      "Candidate study (translations proposed for the term as a whole, in groups of interchangeable renderings), with the checks against general usage (Zipf: 0 = not in ordinary use, 3 = everyday word, 5+ = very common):",
      checksText(),
      "",
      "Notes of the candidate groups:",
      ...(store.load("candidates")?.senses ?? []).flatMap((sense) => (sense.groups ?? []).map((g) => `- ${g.members[0]}…: ${g.note}`)),
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
      return makeProposal();
    });
  }

  async function makeProposal(extraLines = []) {
    const proposal = await client.callJson({
      stage: "proposal", progress: { key: "target", total: null, unit: "translation" }, purpose: extraLines.length ? "revise the proposal so no translation is shared with a word of different meaning" : "put the findings together into a proposed glossary entry",
      instructions: prompts.proposalInstructions(ctx()), content: [proposalContent(), ...extraLines].join("\n"),
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
        variant.fromExisting = existingTargets.some((target) => textKey(target) === textKey(variant.target));
      }
    }
    // A rendering whose check failed never reaches counting; the review pause can put it back.
    for (const removed of failedVariants(proposal, store.load("checks"))) {
      const entry = proposal.entries.find((e) => e.id === removed.entryId);
      entry.variants = entry.variants.filter((v) => v.id !== removed.variantId);
      (proposal.removedByChecks ??= []).push(removed);
      log({ type: "problem", text: `Removed “${removed.target}” from entry ${removed.entryId}: it contains “${removed.word}”, whose frequency check failed.` });
    }
    await enforceOriginals(proposal);
    const problems = validateProposal(proposal, store.load("forms").confirmed);
    problems.push(...unmeasuredRenderings(proposal, store.load("discovery")));
    if (problems.length) info(`proposal notes: ${problems.join("; ")}`);
    logResult("proposal", proposal.entries.map((e) => ({ sourceTerms: e.sourceTerms, variants: e.variants.map((v) => v.target) })),
      `${proposal.entries.length} proposed entr${proposal.entries.length === 1 ? "y" : "ies"}: ${proposal.entries.map((e) => `${e.sourceTerms.join("/")} → ${e.variants.map((v) => v.target).join(", ")}`).join(" | ")}`);
    proposal.existingComparison = await compareWithExisting(proposal);
    return proposal;
  }

  /**
   * The original word of a borrowed meaning is a variant, the only one for that
   * meaning, and its note tells the translating AI that it is the traditional
   * term (naming the book). A note that does not is rewritten.
   */
  async function enforceOriginals(proposal) {
    const placed = store.load("candidates")?.originalWords ?? [];
    if (!placed.length) return;
    const { added, removed } = enforceOriginalWords(proposal, placed, { headword: settings.term });
    for (const item of added) log({ type: "problem", text: `Added “${item.target}” to entry ${item.entryId}: it is the original word of the book this meaning comes from.` });
    for (const item of removed) info(`left out “${item.target}” (entry ${item.entryId}): same meaning as the original word “${item.original}”`);
    for (const entry of proposal.entries) {
      for (const variant of entry.variants.filter((v) => v.original && !noteNamesTheBook(v))) {
        const answer = await client.callJson({
          stage: "original-note", purpose: `write the glossary note for “${variant.target}”`,
          instructions: prompts.originalNoteInstructions(ctx()),
          content: [
            `Term: ${headword()}. Translation: “${variant.target}”, the original word of ${variant.original.book} for the meaning “${variant.original.sense}”.`,
            `Book title to name exactly: ${variant.original.originalTitle}`,
            `Current note: ${variant.note || "(none)"}`,
            `Other translations of the entry: ${entry.variants.filter((v) => v !== variant).map((v) => `${v.target} (${v.note})`).join("; ") || "(none)"}`,
          ].join("\n"),
          schema: prompts.ORIGINAL_NOTE_SCHEMA, schemaName: "original_note",
          maxOutputTokens: 1500, effort: settings.effortLight,
        });
        if (answer?.note) variant.note = answer.note.trim();
        if (!noteNamesTheBook(variant)) variant.note = `${variant.note} (${variant.original.originalTitle})`.trim();
      }
    }
  }

  /**
   * Renderings this proposal shares with another source word: an entry of the
   * glossary, a related word studied just before, or another entry of the
   * proposal. Sharing is fine when the two mean the same here; when they
   * differ, the proposal is revised once without the shared rendering.
   */
  async function checkConvergence(proposal) {
    return stage("convergence", async () => {
      // Related words researched after this one get new entries: their old ones are not compared.
      const own = new Set([
        ...(store.load("forms")?.confirmed ?? []), ...(settings.familyForms ?? []),
        ...(store.load("familyChoice")?.words ?? []).flatMap((word) => word.forms),
      ].map((f) => fold(f).trim()));
      const others = [
        ...(settings.siblingEntries ?? []).map((entry) => ({ ...entry, origin: "family" })),
        ...glossaryTerms
          .filter((term) => !(term.sourceTerms ?? []).some((t) => own.has(fold(t).trim())))
          .map((term) => ({ ...term, origin: "glossary" })),
      ];
      const pairs = sharedRenderings(proposal, others);
      if (!pairs.length) return { pairs: [], conflicts: [], proposal: null };
      heading("Shared translations");
      const items = Object.values(store.load("sample")?.items ?? {});
      for (const pair of pairs) pair.evidence = coOccurrence(items, pair.sourceTerms, pair.otherSourceTerms, settings.sourceLanguageCode);
      const verdict = await client.callJson({
        stage: "convergence", purpose: "check whether words that share a translation mean the same",
        progress: { key: "n", total: pairs.length, unit: "pair", pairs: pairs.map((pair, index) => ({ n: index + 1, target: pair.target, a: pair.sourceTerms?.[0] ?? "", b: pair.otherSourceTerms?.[0] ?? "" })) },
        instructions: prompts.convergenceInstructions(ctx()),
        content: convergenceContent(pairs, { targetName: settings.targetLanguageName, dictionaryText: dictionaryText() }),
        schema: prompts.CONVERGENCE_SCHEMA, schemaName: "convergence",
        maxOutputTokens: 800 + 200 * pairs.length, effort: settings.effortLight,
      }).catch((error) => {
        info(`shared translations not judged: ${error.message}`);
        return { pairs: [] };
      });
      const byN = new Map(verdict.pairs.map((item) => [item.n, item]));
      pairs.forEach((pair, index) => {
        const item = byN.get(index + 1);
        pair.relation = item?.relation ?? "unknown";
        pair.basis = item?.evidence ?? "";
        pair.reason = item?.reason ?? "";
        const both = `${pair.evidence.passages} sampled passages with both${pair.evidence.sameSentence ? `, ${pair.evidence.sameSentence} in one sentence` : ""}`;
        logResult("shared", [{
          target: pair.target, sourceTerms: pair.sourceTerms, otherSourceTerms: pair.otherSourceTerms, relation: pair.relation,
          reason: pair.reason, passages: pair.evidence.passages, sameSentence: pair.evidence.sameSentence,
        }], `“${pair.target}” for “${pair.sourceTerms[0]}” and “${pair.otherSourceTerms[0]}”: ${pair.relation === "same" ? "same meaning here, sharing is fine" : pair.relation === "different" ? "different meanings" : "not judged"} (${both})${pair.reason ? `. ${pair.reason}` : ""}`);
      });
      const conflicts = pairs.filter((pair) => pair.relation === "different");
      if (!conflicts.length) return { pairs, conflicts, proposal: null };
      const revised = await makeProposal([
        "",
        "SHARED TRANSLATIONS TO AVOID (another source word with a different meaning already has these renderings; do not use them for the entries named; take another rendering from the candidate study):",
        ...conflicts.map((pair) => `- “${pair.target}” for “${pair.sourceTerms.join(" / ")}”: already used for “${pair.otherSourceTerms.join(" / ")}”, which means something different (${pair.reason})`),
      ]);
      // The revision must not bring a merged rendering back.
      for (const pair of conflicts) {
        const entry = revised.entries.find((e) => e.sourceTerms.some((t) => pair.sourceTerms.some((s) => fold(s).trim() === fold(t).trim())));
        const kept = entry?.variants.filter((v) => textKey(v.target) !== textKey(pair.target));
        if (!entry || kept.length === entry.variants.length) continue;
        if (kept.length) {
          entry.variants = kept;
          log({ type: "problem", text: `Removed “${pair.target}” from entry ${entry.id}: “${pair.otherSourceTerms[0]}” already has it and means something different.` });
        } else {
          log({ type: "problem", text: `Entry ${entry.id} has no rendering besides “${pair.target}”, which “${pair.otherSourceTerms[0]}” already has with a different meaning; review it before counting.` });
        }
      }
      return { pairs, conflicts, proposal: revised };
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
      stage: "comparison", purpose: "compare the proposal with the glossary's current entry",
      progress: { key: "existing", total: existing.reduce((n, term) => n + (term.targetTerms?.length ?? 0), 0) || null, unit: "translation" },
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
      if (fresh) {
        await findFamily();
        await chooseFamily();
      }
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
      let proposal = await propose();
      if (fresh || store.load("convergence")) {
        const convergence = await checkConvergence(proposal);
        if (convergence.proposal) proposal = convergence.proposal;
      }
      if (fresh && settings.pauseForReview) {
        heading("Review");
        fact("Waiting for you to review the proposed translations before counting.");
      }
      return { status: "review", proposal, familyWords: store.load("familyChoice")?.words ?? [], spent: budget.spent };
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
        variants: entry.variants.map(({ id, target, note, original, partOfSpeech }) => ({ id, target, note, ...(partOfSpeech ? { partOfSpeech } : {}), ...(original ? { original } : {}) })),
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
        logResult("agreement", [{ agreed: merged.agreement.agreed, compared: merged.agreement.compared }],
          `Two judges agreed on ${merged.agreement.agreed} of ${merged.agreement.compared} occurrences.`);
      }
      const failedWords = (store.load("checks")?.failedWords ?? []).map((w) => textKey(w)).filter(Boolean);
      for (const other of aggregate.otherRenderings) {
        const word = failedWords.find((w) => renderingTokens(other.rendering).some((t) => t.includes(w)));
        if (word) other.failedWord = word;
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
      fact(`Finished. Open the report to check the entry and save it to the glossary. Cost: ${formatUsd(budget.spent)} (limit ${formatUsd(budget.limit)}).`);
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
      const checked = checks?.candidates?.find((c) => textKey(c.target) === textKey(target));
      let zipf = null;
      const own = (checked?.words ?? []).filter((w) => !w.partOf);
      if (own.length) {
        const values = own.map((w) => w.zipf).filter((z) => z != null);
        zipf = values.length ? Math.min(...values) : null;
      } else {
        const scores = await wordScores(code, [{ word: target }]);
        zipf = scores.get(textKey(target, code)) ?? null;
      }
      if (zipf != null && zipf < 2) scored.push({ target, zipf });
    }
    if (!scored.length) {
      fact("No chosen translation is rare in general use.");
      return [];
    }
    const answer = await client.callJson({
      stage: "footnotes", purpose: "write notes for translations that are rare in everyday use",
      progress: { key: "target", total: scored.length, unit: "translation" },
      instructions: prompts.footnoteInstructions(ctx()),
      content: scored.map((item) => `- ${item.target} (Zipf ${formatZipf(item.zipf)})`).join("\n"),
      schema: prompts.FOOTNOTE_SCHEMA, schemaName: "footnotes",
      maxOutputTokens: 1500 + 300 * scored.length, effort: settings.effortLight,
    });
    const notes = answer.items.filter((item) => !item.understandableFromParts && item.note.trim())
      .map((item) => ({ ...item, zipf: scored.find((s) => textKey(s.target) === textKey(item.target))?.zipf ?? null }));
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
    const variantNames = Object.fromEntries(frozen.entries.flatMap((entry) => entry.variants.map((variant) => [variant.id, variant.target])));
    const judgments = {};
    let todo = occurrences.filter((o) => o.entryId !== "unassigned");
    for (let attempt = 0; attempt < 2 && todo.length; attempt += 1) {
      const size = attempt === 0 ? settings.countBatch : Math.max(2, Math.floor(settings.countBatch / 2));
      const batches = batchOccurrences(items, todo, size);
      const keyed = batches.map((batch, index) => [index, {
        stage: "counting", purpose: `translate ${batch.occurrences.length === 1 ? "1 use" : `${batch.occurrences.length} uses`} of the word with the proposed entry, noting which translation fits`,
        // The live view tallies the chosen translations by name.
        progress: { key: "occId", total: batch.occurrences.length, unit: "use", all: occurrences.length, variants: variantNames },
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
      info(`${done} of ${occurrences.length} uses of the word translated${retry.length ? `; ${retry.length} to try again` : ""}`);
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
      stage: "summary", purpose: "write a short summary for the report",
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
    const key = textKey(reading.rendering);
    if (key) tally.set(key, { text: tally.get(key)?.text ?? reading.rendering, count: (tally.get(key)?.count ?? 0) + 1 });
  }
  const targets = new Set(proposal.entries.flatMap((entry) => entry.variants.map((v) => textKey(v.target))));
  const explained = new Set((proposal.leftOutRenderings ?? []).map((item) => textKey(item.rendering)));
  return [...tally.entries()]
    .filter(([key, value]) => value.count >= 2 && !targets.has(key) && !explained.has(key))
    .map(([, value]) => `“${value.text}” (${value.count} readings) is neither measured nor explained`);
}

/** Normalize an answer; returns a problem string or null. */
export function validateJudgment(row, occurrence, entryById) {
  if (!row) return "missing from the answer";
  const entry = entryById[occurrence.entryId];
  if (row.status === "other" && entry) {
    const same = entry.variants.find((v) => textKey(v.target) === textKey(row.otherRendering ?? ""));
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

/**
 * What the AI is asked in the sources step. When a book's glossary already
 * pairs the term with an original word, the step has shown that; the AI then
 * says which of the author's meanings come from that book and which are ordinary.
 */
export function sourcesPurpose(author, term, pairedBooks = []) {
  const books = [...new Set(pairedBooks)];
  if (!books.length) return `study how ${author} uses “${term}”: which of the meanings are ordinary and which come from other books`;
  const list = books.length === 1 ? books[0] : `${books.slice(0, -1).join(", ")} or ${books.at(-1)}`;
  return `check which of ${author}'s meanings of “${term}” come from ${list} and which are ordinary`;
}
