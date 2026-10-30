import { focusedSample } from "./glossary-research-studio-sampling.js";
import { buildEditorGlossaryModel, findGlossaryTargetFormOccurrences, findLongestGlossaryMatches, glossaryTermWithoutGaps } from "./editor-glossary-highlighting.js";

export const STUDIO_TRANSLATION_CONTRACT_VERSION = 3;
export const STUDIO_DICTIONARY_REVIEW_VERSION = 3;
// Step 2b preselects researching the term together with the related entries.
export const STUDIO_DEFAULT_BRANCH = "research";

export function studioSourceContext(paragraph) {
  const texts = (camel, snake) => (Array.isArray(camel) ? camel : Array.isArray(snake) ? snake : [])
    .filter((text) => typeof text === "string" && text.trim());
  return { before: texts(paragraph?.contextBefore, paragraph?.context_before),
    after: texts(paragraph?.contextAfter, paragraph?.context_after) };
}

export function studioContextRequest(paragraph) {
  const reference = paragraph?.reference ?? paragraph?.representative ?? paragraph?.references?.[0];
  const lineId = reference?.line_id;
  if (!Number.isSafeInteger(lineId) || lineId <= 0
    || !/^\/api\/sample\/context\?/u.test(reference?.context_url ?? "")) return null;
  return { path: "/api/sample/context", params: { line_id: lineId, context: 3 } };
}

export function applyStudioContext(study, paragraphId, result) {
  const paragraph = study.passages.find((p) => p.id === paragraphId);
  const request = studioContextRequest(paragraph);
  const reference = paragraph?.reference ?? paragraph?.representative ?? paragraph?.references?.[0];
  const before = result?.contextBefore ?? result?.context_before;
  const after = result?.contextAfter ?? result?.context_after;
  if (!request || result?.line_id !== request.params.line_id || result?.text !== paragraph.text
    || (reference.doc_id && result?.doc_id !== reference.doc_id)
    || ![before, after].every((texts) => Array.isArray(texts) && texts.every((text) => typeof text === "string"))) {
    throw new Error("The returned context does not match this source paragraph. Existing evidence was kept.");
  }
  const changed = stableSignature(studioSourceContext(paragraph)) !== stableSignature(studioSourceContext(result));
  if (changed) {
    const updated = { ...paragraph, contextBefore: [...before], contextAfter: [...after] };
    if ("context_before" in paragraph) updated.context_before = [...before];
    if ("context_after" in paragraph) updated.context_after = [...after];
    study.passages = study.passages.map((item) => item.id === paragraphId ? updated : item);
  }
  study.expandedContextIds ??= [];
  if (!study.expandedContextIds.includes(paragraphId)) study.expandedContextIds.push(paragraphId);
  if (changed && study.assignments.some((a) => a.paragraphId === paragraphId)) {
    study.assignmentReviewPending = true;
    study.retentionReviewed = false;
    delete study.usage; delete study.usageByText;
    for (const step of ["8", "9"]) if (study.steps[step]) study.steps[step].status = "stale";
  }
  return changed;
}

export function studioMatches(text, terms, languageCode = "es") {
  return studioModelMatches(text, studioMatchModel(terms, languageCode));
}

const studioMatchModel = (terms, languageCode) => buildEditorGlossaryModel({ sourceLanguage: { code: languageCode },
  targetLanguage: { code: "en" }, terms });

function studioModelMatches(text, model) {
  const { tokens, matches } = findLongestGlossaryMatches(text, model?.sourceMatcher);
  const offsets = [0];
  for (const token of tokens) offsets.push(offsets.at(-1) + token.value.length);
  return matches.map((m) => ({ start: offsets[m.startTokenIndex],
    end: offsets[m.endTokenIndex + 1], termIds: m.candidate.termIdsOrdered }));
}

export const STUDIO_STEPS = [
  ["1", "Scope"], ["2a", "List other forms and spellings", true], ["2b", "Existing entries"],
  ["3", "Research sample"], ["4.1", "Dictionary", true], ["4.2", "Corpus meanings"],
  ["4.3", "Word parts", true], ["4.4.1", "Bibliographical sources", true],
  ["4.4.2", "Internet sources", true], ["4.4.4", "Source summary"],
  ["4.5", "Review meanings"], ["4.6", "Assign meanings"], ["4.7", "Split entries"],
  ["5", "Compounds and phrases", true], ["6", "Translation candidates"],
  ["7", "Standardize spelling"], ["8", "Test each meaning"],
  ["9", "Test complete entry"], ["10a", "Review usage"], ["10b", "Resolve collisions"],
  ["11", "Save glossary entry"], ["12", "Split-entry queue"],
].map(([id, label, optional = false]) => ({ id, label, optional }));

// Stable storage IDs preserve saved evidence and validation signatures. The
// former 4.4.3 was a rule, not an operation; present a consecutive user list.
export const studioStepNumber = (id) => id === "4.4.4" ? "4.4.3" : id;

export function studioStepStatusLabel(record) {
  if (record?.status === "undone") return "undone";
  if (record?.status === "stale") return record.approved?.skipped
    ? "previously skipped; needs review" : "needs review";
  if (record?.status === "awaiting-review") return record.value?.pending
    ? "needs input" : "ready for review";
  return ({ complete: "✓", skipped: "skipped", running: "in progress", failed: "needs attention" })[record?.status] ?? "";
}

// Checkpoint signatures currently include every earlier approved step. Keep
// revision clearing consistent with that dependency contract.
export function studioDependentSteps(study, step) {
  const index = STUDIO_STEPS.findIndex((item) => item.id === step);
  if (index < 0) return [];
  return STUDIO_STEPS.slice(index + 1).filter(({ id }) => {
    const record = study.steps[id];
    return record && record.status !== "undone" || study.skipRecommendations?.[id];
  }).map(({ id }) => id);
}

export function clearStudioDependents(study, step) {
  const index = STUDIO_STEPS.findIndex((item) => item.id === step);
  if (index < 0) throw new Error("Unknown research step.");
  const later = new Set(STUDIO_STEPS.slice(index + 1).map(({ id }) => id));
  for (const id of later) {
    if (study.steps[id]) study.steps[id] = { status: "undone" };
    for (const key of ["activitySteps", "skipRecommendations", "comparisonStarts", "comparisonStartSignatures"]) {
      if (study[key]) delete study[key][id];
    }
  }
  const reset = (owner, values) => { if (later.has(owner)) Object.assign(study, values); };
  reset("2a", { forms: [], formDiscovery: null, origin: null });
  reset("2b", { relatedEntries: [], carriedTargets: [], branch: STUDIO_DEFAULT_BRANCH, mergeDestinations: {}, reResearchStarted: false });
  reset("3", { population: [], populationCount: null, populationFingerprint: null, passages: [], sampling: null });
  reset("4.5", { meanings: [] });
  reset("4.6", { assignments: [], displayTranslations: {}, recoveryScanned: [], recoveryConsidered: 0,
    recoveryUnconfirmed: [], recoveryProfiles: null, excludedParagraphIds: [], contextIncludedIds: [], expandedContextIds: [] });
  reset("4.7", { splitProposals: [], queue: [] });
  reset("6", { candidates: [], generalNote: "", footnote: "" });
  for (const phase of ["8", "9"]) if (later.has(phase)) {
    for (const key of ["tests", "rounds", "reports", "retryAllowances"]) {
      study[key] = Object.fromEntries(Object.entries(study[key] ?? {}).filter(([id]) => !id.startsWith(`${phase}:`)));
    }
  }
  if (later.has("8")) {
    for (const candidate of study.candidates) { candidate.confirmed = false; candidate.retained = true; }
    study.focusedSamples = {}; study.focusedSampleLimits = {};
    study.reports = {};
  }
  if (later.has("9")) study.entryValidation = null;
  if (later.has("10a")) {
    study.retentionReviewed = false;
    delete study.usage; delete study.usageByText;
  }
  if (later.has("10b")) study.collisions = {};
  if (later.has("11")) study.draft = null;
  if (later.has("4.7")) for (const meaning of study.meanings) meaning.splitOff = false;
  if (later.has("4.6")) for (const meaning of study.meanings) meaning.unused = false;
  study.assignmentReviewPending = false;
  study.pendingDecision = null; study.decisionInput = {};
  study.status = "active"; study.error = "";
  if (study.steps[step]) study.steps[step].status = "awaiting-review";
}

// Re-research adds the related entries' forms and reruns 2a. Clearing 2b onward
// first keeps 2a from offering a redo that would forget this choice and loop.
export function startStudioReResearch(study) {
  const forms = uniqueSourceTexts([...study.scope.forms, ...study.relatedEntries.flatMap((e) => e.sourceTerms)], study.scope.sourceLanguage.code);
  const carriedTargets = study.relatedEntries.flatMap((e) => e.targetTerms.map((text, i) => ({ text, note: e.targetVariantNotes?.[i] ?? "", originTermId: e.termId })));
  const rerunForms = stableSignature(forms) !== stableSignature(study.scope.forms) || !study.reResearchStarted;
  if (rerunForms) { clearStudioDependents(study, "2a"); delete study.steps["2a"]; }
  Object.assign(study, { carriedTargets, branch: "research", reResearchStarted: true });
  study.scope.forms = forms;
  return rerunForms;
}

export function stableSignature(value) {
  if (Array.isArray(value)) return `[${value.map(stableSignature).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${stableSignature(value[key])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}

// Only comparison metadata is compacted; approved reports and evidence stay intact.
async function fingerprint(signature) {
  const bytes = new TextEncoder().encode(signature);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function studioToolSignature(kind, payload, canonical = stableSignature({ version: 1, kind, payload })) {
  return fingerprint(canonical);
}

export async function stepSignature(study, step) {
  return fingerprint(stableSignature(stepInput(study, step)));
}

export async function stepSignatureMatches(study, step, signature) {
  if (typeof signature !== "string") return false;
  const canonical = stableSignature(stepInput(study, step));
  return signature === canonical || signature === await fingerprint(canonical);
}

export async function compactStudioStepSignatures(study) {
  const missing = Object.values(study.steps ?? {}).some((record) => record.approved && !record.approvedDigest && !record.approved._studioArtifact);
  const matching = new Map();
  if (missing) for (const [step, record] of Object.entries(study.steps ?? {})) {
    const canonical = stableSignature(stepInput(study, step));
    const hashed = await fingerprint(canonical);
    matching.set(step, Object.fromEntries(["signature", "generatedSignature"].map((key) => [key,
      record[key] === canonical || record[key] === hashed])));
  }
  for (const record of Object.values(study.steps ?? {})) {
    if (record.approved && !record.approvedDigest) {
      if (!record.approved._studioArtifact) record.approvedDigest = await fingerprint(stableSignature(record.approved));
    }
    for (const key of ["signature", "generatedSignature"]) {
      // Legacy comparison strings are canonical serialized step inputs. Hash the
      // recorded input, not today's input: stale checkpoints must remain stale.
      if (typeof record[key] === "string" && record[key].startsWith("{")) record[key] = await fingerprint(record[key]);
    }
  }
  // Re-express only checkpoints verified against their recorded old inputs.
  // Stale signatures stay stale; preserve originals for the migration audit.
  if (missing) for (const [step, record] of Object.entries(study.steps ?? {})) {
    const signature = await stepSignature(study, step);
    for (const key of ["signature", "generatedSignature"]) if (matching.get(step)?.[key] && record[key] !== signature) {
      record.legacySignatures ??= {};
      record.legacySignatures[key] ??= record[key];
      record[key] = signature;
    }
  }
  return study;
}

export function newStudioStudy(scope, id = globalThis.crypto.randomUUID()) {
  return {
    schemaVersion: 1, id, revision: 0, updatedAt: new Date().toISOString(),
    scope: { term: "", forms: [], corpus: "samael", projectIds: [], seed: 1, ...scope },
    step: "1", status: "active", steps: {}, cache: {}, forms: [], passages: [],
    meanings: [], assignments: [], candidates: [], queue: [], collisions: {},
    carriedTargets: [], relatedEntries: [], tests: {}, rounds: {}, reports: {},
    pendingDecision: null, error: "", draft: null,
  };
}

export const uniqueTexts = (values) => [...new Set(values.map((v) => String(v).trim()).filter(Boolean))];

export function sourceFormKey(text, language = "und") {
  return String(text).trim().normalize("NFC").toLocaleLowerCase(language);
}

// Preserve the researcher's first spelling and selection; accents remain distinct.
export function deduplicateSourceForms(forms, language = "und") {
  const seen = new Set();
  return forms.flatMap((form) => {
    const text = String(form.text).trim(); const key = sourceFormKey(text, language);
    if (!key || seen.has(key)) return [];
    seen.add(key); return [{ ...form, text }];
  });
}

export function uniqueSourceTexts(values, language = "und") {
  return deduplicateSourceForms(values.map((text) => ({ text })), language).map((f) => f.text);
}

// Approximate recall only supplies witnesses to the human/AI identity review.
// Exact research populations and counts always use the production glossary matcher.
export function rankResearchFormEvidence(items, form, language = "en") {
  let segmenter;
  try { segmenter = new Intl.Segmenter(language, { granularity: "word" }); } catch { segmenter = new Intl.Segmenter("en", { granularity: "word" }); }
  const words = (text) => [...segmenter.segment(text)].filter((part) => part.isWordLike)
    .map((part) => part.segment.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase());
  const queryWords = words(form); const query = [...queryWords.join(" ")];
  if (!query.length) return [];
  const maximum = query.length < 4 ? 0 : query.length < 8 ? 1 : 2;
  function distance(text) {
    const chars = [...text];
    if (Math.abs(chars.length - query.length) > maximum) return maximum + 1;
    let previous = Array.from({ length: query.length + 1 }, (_, i) => i);
    for (let i = 0; i < chars.length; i += 1) {
      const next = [i + 1];
      for (let j = 0; j < query.length; j += 1) next.push(Math.min(next[j] + 1,
        previous[j + 1] + 1, previous[j] + (chars[i] === query[j] ? 0 : 1)));
      previous = next;
    }
    return previous.at(-1);
  }
  const seen = new Set(); const results = [];
  for (const item of items) {
    if (seen.has(item.text)) continue;
    seen.add(item.text);
    const tokens = words(item.text);
    let score = maximum + 1;
    for (let i = 0; i <= tokens.length - queryWords.length; i += 1) score = Math.min(score, distance(tokens.slice(i, i + queryWords.length).join(" ")));
    if (score <= maximum) results.push({ ...item, recallDistance: score });
  }
  return results.sort((a, b) => a.recallDistance - b.recallDistance);
}
export const activeMeanings = (study) => study.meanings.filter((m) => m.enabled !== false
  && !m.unused && !m.splitOff);
export const meaningNumber = (study, meaningId) => study.meanings.findIndex((meaning) => meaning.id === meaningId) + 1;
export const studioTrialRoundLabel = (repairs) => repairs === 0 ? "initial test" : `repair round ${repairs}`;

export function temporaryGlossaryTerms(study) {
  return [...(study.temporaryEntries ?? []), ...study.queue.map((q) => ({ termId: q.id,
    sourceTerms: q.forms, targetTerms: q.targetTerms ?? [], targetVariantNotes: [] }))];
}

// Saved glossary entries that match the study's paragraphs. Steps 8 and 9
// translate with them, as production does, and skip occurrences that a longer
// saved entry covers. The study supersedes entries it replaces, merges or shares
// a source form with; step 10b decides those collisions.
export function studioGlossaryContext(study, entries) {
  const language = study.scope.sourceLanguage.code;
  const owned = new Set([...selectedForms(study), ...study.queue.flatMap((q) => q.forms)].map((form) => sourceFormKey(form, language)));
  const related = new Set((study.relatedEntries ?? []).map((entry) => entry.termId));
  const candidates = (Array.isArray(entries) ? entries : []).filter((entry) => entry?.termId && entry.lifecycleState !== "deleted"
    && entry.termId !== study.savedTermId && !related.has(entry.termId) && Array.isArray(entry.sourceTerms)
    && !entry.sourceTerms.some((form) => owned.has(sourceFormKey(form, language))))
    .map(({ termId, sourceTerms, targetTerms, targetVariantNotes, notesToTranslators, footnote }) => ({ termId, sourceTerms,
      targetTerms: targetTerms ?? [], targetVariantNotes: targetVariantNotes ?? [], notesToTranslators: notesToTranslators ?? "", footnote: footnote ?? "" }));
  const model = buildEditorGlossaryModel({ sourceLanguage: { code: language }, targetLanguage: { code: "en" }, terms: candidates });
  const matched = new Set(study.passages.flatMap((paragraph) => findLongestGlossaryMatches(paragraph.text, model?.sourceMatcher).matches
    .flatMap((match) => match.candidate.termIdsOrdered)));
  return candidates.filter((entry) => matched.has(entry.termId));
}

// Signature inputs for the saved entries, omitted when none match so older trials stay current.
const glossaryContextSignature = (study) => study.glossaryContext?.length ? { glossaryContext: study.glossaryContext } : {};

export function selectedForms(study) {
  return deduplicateSourceForms(study.forms, study.scope.sourceLanguage.code)
    .filter((f) => f.selected !== false).map((f) => f.text);
}

export function studyAssignments(study, meaningId) {
  const terms = [{ termId: "original", sourceTerms: buildStudioDraft(study).sourceTerms, targetTerms: [] }, ...temporaryGlossaryTerms(study),
    ...(study.glossaryContext ?? [])];
  // Renders call this several times per meaning, so build the model once and match each paragraph once.
  const model = studioMatchModel(terms, study.scope.sourceLanguage.code);
  const owned = new Map();
  const ownedSpans = (paragraph) => {
    if (!owned.has(paragraph.id)) owned.set(paragraph.id, studioModelMatches(paragraph.text, model).filter((match) => match.termIds.includes("original")));
    return owned.get(paragraph.id);
  };
  return study.assignments.filter((a) => (!a.entryId || a.entryId === "original")
    && (!meaningId || a.meaningId === meaningId)).filter((assignment) => {
    const paragraph = study.passages.find((p) => p.id === assignment.paragraphId);
    const occurrence = paragraph?.occurrences.find((o) => o.id === assignment.occurrenceId);
    return paragraph && occurrence && ownedSpans(paragraph).some((match) => match.start <= occurrence.start && match.end >= occurrence.end);
  });
}

export function meaningTrialSignature(study, meaningId, assignments = focusedSample(study, meaningId, studyAssignments(study, meaningId)).assignments) {
  return stableSignature({ focusedSamplingVersion: 2, candidates: study.candidates.filter((c) => c.confirmed && c.selected !== false && c.meaningIds.includes(meaningId)),
    assignments, paragraphs: study.passages.filter((p) => assignments.some((a) => a.paragraphId === p.id)),
    meaning: study.meanings.find((meaning) => meaning.id === meaningId), model: study.model, generalNote: study.generalNote ?? "",
    sourceLanguage: study.scope.sourceLanguage, targetLanguage: study.scope.targetLanguage,
    translationRuntimeVersion: study.translationRuntimeVersion ?? null,
    translationContractVersion: STUDIO_TRANSLATION_CONTRACT_VERSION, ...glossaryContextSignature(study) });
}

// Step 8 chooses which candidates to confirm for each meaning. With one meaning and
// one candidate word (its inflections share a group) there is nothing to choose, and
// step 9 tests that word in the complete entry.
export function studioSingleWordCandidates(study) {
  const meanings = activeMeanings(study);
  if (meanings.length !== 1) return null;
  const candidates = study.candidates.filter((c) => c.selected !== false && c.meaningIds.includes(meanings[0].id));
  return candidates.length && new Set(candidates.map((c) => c.groupId || c.text)).size === 1 ? candidates : null;
}

export function meaningTrialsAreCurrent(study) {
  const meanings = activeMeanings(study);
  return meanings.length > 0 && meanings.every((meaning) => {
    const trial = study.tests[`8:${meaning.id}`];
    return trial?.passed && trial.signature === meaningTrialSignature(study, meaning.id)
      && trial.rounds === (study.rounds[`8:${meaning.id}`] ?? 0);
  });
}

export function entryBatchSignature(study, paragraphs, assignments) {
  return stableSignature({ paragraphs, assignments, meanings: activeMeanings(study),
    temporaryGlossary: temporaryGlossaryTerms(study), ...glossaryContextSignature(study), model: study.model,
    translationRuntimeVersion: study.translationRuntimeVersion ?? null,
    translationContractVersion: STUDIO_TRANSLATION_CONTRACT_VERSION,
    sourceLanguage: study.scope.sourceLanguage, targetLanguage: study.scope.targetLanguage });
}

export function exactOccurrences(text, forms, languageCode = "es") {
  // The app matcher supplies its lexical boundary and longest-first policy.
  return studioMatches(text, forms.map((sourceTerm, index) => ({
    termId: `form-${index}`, sourceTerms: [sourceTerm], targetTerms: [],
  })), languageCode).filter((match) => forms.some((form) =>
    form.normalize("NFC").toLocaleLowerCase().replace(/\s+/gu, " ")
      === text.slice(match.start, match.end).normalize("NFC").toLocaleLowerCase().replace(/\s+/gu, " ")))
    .map((match, index) => ({
    id: `o${index}`, start: match.start, end: match.end,
    surface: text.slice(match.start, match.end),
  }));
}

// Target forms may contain the editor's "…" gap, which allows words that target
// grammar places inside the form. Pieces keep the exact spelling check.
export function exactTargetOccurrences(text, forms, languageCode) {
  const normal = (value) => value.normalize("NFC").toLocaleLowerCase().replace(/\s+/gu, " ").trim();
  return findGlossaryTargetFormOccurrences(text, forms, languageCode).filter((match) => match.formIndexes.some((index) =>
    normal(glossaryTermWithoutGaps(forms[index])) === normal(match.pieces.map((piece) => text.slice(piece.start, piece.end)).join(" "))))
    .map((match, index) => ({ id: `o${index}`, start: match.start, end: match.end, pieces: match.pieces,
      surface: text.slice(match.start, match.end) }));
}

const isGapWord = (word) => word === "…" || word === "...";
function gapLayout(form) {
  const words = []; const gaps = new Set();
  for (const word of String(form).trim().split(/\s+/u)) isGapWord(word) ? gaps.add(words.length) : words.push(word);
  return { words, gaps };
}
const gapLayoutText = (words, gaps) => words.flatMap((word, i) => gaps.has(i) ? ["…", word] : [word]).join(" ");

// Each way to open one more gap between two words of a target form.
export function studioSplitForms(form) {
  const { words, gaps } = gapLayout(form);
  return words.slice(1).map((_, i) => i + 1).filter((i) => !gaps.has(i)).map((i) => gapLayoutText(words, new Set([...gaps, i])));
}

// A candidate rendered with words inside it keeps one form with every observed gap.
export function mergeStudioGapForms(form, split) {
  const base = gapLayout(form); const added = gapLayout(split);
  if (base.words.join(" ") !== added.words.join(" ")) return form;
  return gapLayoutText(base.words, new Set([...base.gaps, ...added.gaps]));
}

// Steps 8 and 9 pass a rendering split by words that target grammar requires.
// The candidate then gets the gap, so the editor matches such renderings too.
export function applyStudioSplitForms(study, choices) {
  const changes = [];
  for (const choice of choices) {
    if (!choice.passed || !choice.splitForm) continue;
    const candidate = study.candidates.find((c) => c.id === choice.candidateId);
    if (!candidate) continue;
    const from = candidate.text; const to = mergeStudioGapForms(from, choice.splitForm);
    if (to === from) continue;
    for (const c of study.candidates) if (c.text === from) c.text = to;
    changes.push({ from, to, rendered: choice.rendered });
  }
  return changes;
}

export function studioSplitFormReport(changes) {
  return changes.map(({ from, to, rendered }) => `Changed "${from}" to "${to}": target grammar placed words inside it ("${rendered}"), and "…" lets the glossary match them.`).join(" ");
}

export function deduplicatePassages(passages, forms, languageCode = "es") {
  const byText = new Map();
  for (const raw of passages) {
    const text = String(raw.text ?? "");
    const occurrences = exactOccurrences(text, forms, languageCode);
    if (!occurrences.length) continue;
    const previous = byText.get(text);
    const references = raw.references ?? [raw.reference ?? {}];
    if (previous) previous.references.push(...references);
    else byText.set(text, { ...raw, id: String(raw.id ?? raw.itemId ?? raw.item_id
      ?? `p${byText.size}`), text, occurrences, references });
  }
  return [...byText.values()];
}

export function shuffled(values, seed) {
  const result = [...values];
  let n = Number(seed) >>> 0;
  for (let i = result.length - 1; i > 0; i -= 1) {
    n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
    const j = n % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function researchSample(population, forms, seed, maximum = 100, languageCode = "es") {
  const pool = shuffled(population, seed);
  const chosen = new Map();
  const missing = [];
  for (const form of forms) {
    const witness = pool.find((p) => exactOccurrences(p.text, [form], languageCode).length);
    if (witness) chosen.set(witness.id, witness);
    else missing.push(form);
  }
  if (chosen.size > maximum) throw new Error("Form coverage requires more than 100 paragraphs. Reduce the forms before continuing.");
  for (const p of pool) {
    if (chosen.size >= maximum) break;
    chosen.set(p.id, p);
  }
  return { passages: [...chosen.values()], missing };
}

export function validateAssignments(passages, assignments, meaningIds) {
  const expected = new Set(passages.flatMap((p) => p.occurrences.map((o) => `${p.id}:${o.id}`)));
  const seen = new Set();
  for (const a of assignments) {
    const key = `${a.paragraphId}:${a.occurrenceId}`;
    if (!expected.has(key) || seen.has(key)) throw new Error("Meaning assignments contain an unknown or repeated occurrence.");
    if (a.meaningId && !meaningIds.includes(a.meaningId)) throw new Error("An assignment names an unknown meaning.");
    seen.add(key);
  }
  if (seen.size !== expected.size) throw new Error("Some occurrences have not been assigned. Retry this step.");
  return assignments;
}

export function witnessedSplitForms(study, proposal) {
  return uniqueSourceTexts(proposal.forms ?? [], study.scope.sourceLanguage.code).filter((form) =>
    study.passages.some((paragraph) => exactOccurrences(paragraph.text, [form], study.scope.sourceLanguage.code).some((span) =>
      study.assignments.some((assignment) => assignment.paragraphId === paragraph.id && assignment.meaningId === proposal.meaningId
        && paragraph.occurrences.some((occurrence) => occurrence.id === assignment.occurrenceId
          && occurrence.start >= span.start && occurrence.end <= span.end)))));
}

export function reviewCompoundReport(study, report) {
  const research = { ...study, assignments: study.assignments.filter((a) => !a.entryId || a.entryId === "original") };
  const compounds = []; const unverifiedCompounds = [...(report?.unverifiedCompounds ?? [])];
  for (const candidate of Array.isArray(report?.compounds) ? report.compounds : []) {
    const proposal = { forms: candidate.forms ?? [candidate.phrase], meaningId: candidate.meaningId };
    const forms = witnessedSplitForms(research, proposal);
    const paragraphIds = research.passages.filter((paragraph) =>
      witnessedSplitForms({ ...research, passages: [paragraph] }, { ...proposal, forms }).length).map((p) => p.id);
    const special = candidate.specialMeaning === true && typeof candidate.explanation === "string" && candidate.explanation.trim();
    if (paragraphIds.length >= 2 || (paragraphIds.length === 1 && special)) {
      compounds.push({ ...candidate, phrase: forms.includes(candidate.phrase) ? candidate.phrase : forms[0], forms, paragraphIds });
    } else unverifiedCompounds.push({ ...candidate, matchedParagraphIds: paragraphIds,
      reason: !paragraphIds.length ? "No exact occurrence with this meaning in the research sample."
        : "Requires two research paragraphs or a special single-use meaning." });
  }
  return { ...report, compounds, unverifiedCompounds };
}

export function routeSplits(study, proposals) {
  const candidates = proposals.map((p, index) => ({ ...p, id: p.id || `split-${index}`,
    forms: uniqueSourceTexts(p.forms ?? [], study.scope.sourceLanguage.code), assignments: [], passages: [], status: "queued" }));
  if (new Set(candidates.map((q) => q.id)).size !== candidates.length || candidates.some((q) => !q.forms.length
    || !activeMeanings(study).some((m) => m.id === q.meaningId))) throw new Error("A split entry has a missing form, duplicate ID, or unknown meaning.");
  const queue = candidates.map((proposal) => ({ ...proposal, forms: witnessedSplitForms(study, proposal) })).filter((proposal) => proposal.forms.length);
  const entries = [
    ...queue.map((p) => ({ termId: p.id, sourceTerms: p.forms, targetTerms: [] })),
    { termId: "original", sourceTerms: selectedForms(study), targetTerms: [] },
  ];
  const assignments = study.assignments.map((a) => {
    const paragraph = study.passages.find((p) => p.id === a.paragraphId);
    const occurrence = paragraph?.occurrences.find((o) => o.id === a.occurrenceId);
    if (!paragraph || !occurrence) throw new Error("Split routing lost its source occurrence.");
    const match = studioMatches(paragraph.text, entries, study.scope.sourceLanguage.code).find((m) =>
      m.start <= occurrence.start && m.end >= occurrence.end);
    const item = queue.find((q) => match?.termIds.includes(q.id));
    if (!item) return { ...a, entryId: "original" };
    if (item.meaningId !== a.meaningId) throw new Error("A proposed split expression covers another meaning too. Refine the expressions before splitting.");
    const routed = { ...a, entryId: item.id, matchedSource: paragraph.text.slice(match.start, match.end) };
    item.assignments.push(routed);
    if (!item.passages.some((p) => p.id === paragraph.id)) item.passages.push(paragraph);
    return routed;
  });
  for (const item of queue) {
    const originals = item.assignments;
    item.passages = item.passages.map((p) => ({ ...p, occurrences: exactOccurrences(p.text, item.forms, study.scope.sourceLanguage.code) }));
    item.assignments = item.passages.flatMap((p) => p.occurrences.flatMap((o) => {
      const source = study.passages.find((original) => original.id === p.id);
      const origins = originals.filter((a) => a.paragraphId === p.id && source.occurrences.some((original) => original.id === a.occurrenceId && original.start >= o.start && original.end <= o.end));
      return origins.length ? [{ paragraphId: p.id, occurrenceId: o.id, meaningId: item.meaningId,
        entryId: item.id, originOccurrences: origins.map((a) => a.occurrenceId) }] : [];
    }));
  }
  const residual = new Set(assignments.filter((a) => a.entryId === "original").map((a) => a.meaningId));
  return { queue: queue.filter((q) => q.assignments.length), assignments,
    meanings: study.meanings.map((m) => ({ ...m, splitOff: !m.unused && !residual.has(m.id) })) };
}

export function applySplitReview(study, proposals) {
  const approved = study.steps["4.6"]?.approved ?? study.steps["4.6"]?.value;
  const assignments = (approved?.assignments ?? study.assignments)
    .map(({ entryId: _entry, matchedSource: _matched, ...assignment }) => assignment);
  const meanings = (approved?.meanings ?? study.meanings).map((m) => ({ ...m, splitOff: false }));
  const result = routeSplits({ ...study, assignments, meanings }, proposals.filter((p) => p.selected !== false));
  result.queue = result.queue.map((item) => {
    const previous = study.queue.find((q) => q.id === item.id && stableSignature(q.assignments) === stableSignature(item.assignments)
      && item.forms.every((form) => uniqueSourceTexts(q.forms, study.scope.sourceLanguage.code)
        .some((old) => sourceFormKey(old, study.scope.sourceLanguage.code) === sourceFormKey(form, study.scope.sourceLanguage.code))));
    return previous?.studyId ? { ...item, studyId: previous.studyId, status: previous.status, targetTerms: previous.targetTerms } : item;
  });
  return result;
}

export async function reviseAssignment(study, paragraphId, occurrenceId, meaningId, preserveSourceSpelling) {
  const assignment = study.assignments.find((a) => a.paragraphId === paragraphId && a.occurrenceId === occurrenceId);
  if (!assignment || (assignment.entryId && assignment.entryId !== "original")) throw new Error("Review this occurrence in its own study.");
  if (!study.meanings.some((meaning) => meaning.id === meaningId && meaning.enabled !== false)) throw new Error("Choose an enabled meaning.");
  const preserve = preserveSourceSpelling ?? Boolean(assignment.preserveSourceSpelling);
  if (assignment.meaningId === meaningId && Boolean(assignment.preserveSourceSpelling) === preserve) return false;
  const record = study.steps["4.6"];
  const baseline = structuredClone(record?.approved ?? record?.value ?? { meanings: study.meanings, assignments: study.assignments });
  const original = baseline.assignments.find((a) => a.paragraphId === paragraphId && a.occurrenceId === occurrenceId);
  if (!original) throw new Error("The approved research assignment is missing.");
  original.meaningId = meaningId;
  if (preserve) original.preserveSourceSpelling = true;
  else delete original.preserveSourceSpelling;
  for (const meaning of baseline.meanings) meaning.unused = !baseline.assignments.some((a) => a.meaningId === meaning.id);
  await approveStep(study, "4.6", baseline);
  study.steps["4.6"].value = structuredClone(baseline);
  Object.assign(study, applySplitReview(study, study.splitProposals ?? study.queue.map((item) => ({ ...item, selected: true }))));
  study.assignmentRevision = (study.assignmentRevision ?? 0) + 1;
  study.assignmentReviewPending = true;
  study.status = "active";
  study.pendingDecision = null;
  study.retentionReviewed = false;
  delete study.usage;
  delete study.usageByText;
  for (const key of Object.keys(study.rounds)) if (key.startsWith("9:")) delete study.rounds[key];
  for (const key of Object.keys(study.retryAllowances ?? {})) if (key.startsWith("9:")) delete study.retryAllowances[key];
  return true;
}

export function draftCandidates(study) {
  const meanings = new Set(activeMeanings(study).map((m) => m.id));
  return study.candidates.filter((c) => c.confirmed && c.retained !== false
    && c.meaningIds.some((id) => meanings.has(id)));
}

export function preferCandidate(study, index, first = false) {
  const candidate = study.candidates[index];
  if (!candidate?.text?.trim()) return;
  const texts = uniqueTexts(study.candidates.filter((c) => c.selected !== false && c.meaningIds.length).map((c) => c.text));
  const rank = texts.indexOf(candidate.text);
  if (rank <= 0) return;
  const moved = study.candidates.filter((c) => c.text === candidate.text);
  const remaining = study.candidates.filter((c) => c.text !== candidate.text);
  const destination = first ? 0 : remaining.findIndex((c) => c.text === texts[rank - 1]);
  remaining.splice(Math.max(0, destination), 0, ...moved);
  study.candidates = remaining;
}

export function buildStudioDraft(study, candidates = draftCandidates(study)) {
  const variants = uniqueTexts(candidates.map((c) => c.text));
  return {
    sourceTerms: selectedForms(study).filter((form) => study.collisions[form] !== "keep"),
    targetTerms: variants,
    targetVariantNotes: variants.map((text) => uniqueTexts(candidates.filter((c) => c.text === text)
      .map((c) => c.note ?? "")).join("; ")),
    notesToTranslators: study.generalNote ?? "", footnote: study.footnote ?? "", untranslated: false,
  };
}

// Term editor changes to the entry under test, mapped onto the study's candidates.
// Order and notes follow the visible text; changing a text in place renames it; a new
// translation joins the meaning the editor was opened for. Removed translations stay
// in the study unconfirmed, so earlier research still shows them.
export function applyStudioEntryEdit(study, edit, meaningId) {
  const before = buildStudioDraft(study);
  const targets = (edit.targetTerms ?? []).map((text) => String(text ?? "").trim());
  const notes = targets.map((_, index) => String(edit.targetVariantNotes?.[index] ?? "").trim());
  if (!targets.length || targets.some((text) => !text)) throw new Error("Enter at least one translation. An empty translation cannot be tested.");
  const active = new Set(activeMeanings(study).map((m) => m.id));
  const inDraft = (c) => c.confirmed && c.retained !== false && c.meaningIds.some((id) => active.has(id));
  const candidates = structuredClone(study.candidates);
  const drafted = candidates.filter(inDraft);
  const removed = before.targetTerms.filter((text) => !targets.includes(text));
  const renamed = new Map();
  targets.forEach((text, index) => {
    const old = before.targetTerms[index];
    if (!before.targetTerms.includes(text) && removed.includes(old) && ![...renamed.values()].includes(old)) renamed.set(text, old);
  });
  const renamedFrom = new Map([...renamed].map(([text, old]) => [old, text]));
  for (const c of drafted) {
    if (renamedFrom.has(c.text)) c.text = renamedFrom.get(c.text);
    else if (removed.includes(c.text)) c.confirmed = false;
  }
  for (const [index, text] of targets.entries()) {
    const previous = renamed.has(text) ? renamed.get(text) : text;
    const known = before.targetTerms.indexOf(previous);
    if (known < 0) {
      if (!active.has(meaningId)) throw new Error("Choose a finding for an active meaning before adding a translation.");
      const reused = candidates.find((c) => c.text === text && c.meaningIds.includes(meaningId));
      if (reused) Object.assign(reused, { confirmed: true, retained: true, selected: true, note: notes[index] });
      else candidates.push({ id: `human-entry-${globalThis.crypto.randomUUID()}`, text, note: notes[index], meaningIds: [meaningId],
        confirmed: true, selected: true, retained: true });
    } else if (notes[index] !== before.targetVariantNotes[known]) {
      for (const c of candidates) if (inDraft(c) && c.text === text) c.note = notes[index];
    }
  }
  const rank = (c) => targets.indexOf(c.text);
  const ordered = candidates.filter((c) => rank(c) >= 0).sort((a, b) => rank(a) - rank(b));
  let next = 0;
  const reordered = candidates.map((c) => rank(c) >= 0 ? ordered[next++] : c);
  for (const meaning of activeMeanings(study)) {
    if (!reordered.some((c) => inDraft(c) && c.meaningIds.includes(meaning.id))) {
      throw new Error(`Meaning ${meaningNumber(study, meaning.id)} would have no translation. Keep at least one translation for each meaning.`);
    }
  }
  study.candidates = reordered;
  study.generalNote = edit.notesToTranslators ?? "";
  study.footnote = edit.footnote ?? "";
}

function currentEntryBatches(study) {
  const assignments = studyAssignments(study);
  const paragraphs = study.passages.filter((p) => assignments.some((a) => a.paragraphId === p.id));
  const batches = [];
  for (let index = 0; index < paragraphs.length; index += 15) {
    const batch = paragraphs.slice(index, index + 15);
    const members = assignments.filter((a) => batch.some((p) => p.id === a.paragraphId));
    batches.push({ key: `9:${index}`, assignments: members, signature: entryBatchSignature(study, batch, members) });
  }
  return batches;
}

function currentEntryTrial(study, input, signature) {
  const trial = study.tests[input.key];
  return trial?.phase === "9" && trial.passed && trial.signature === signature && trial.batchSignature === input.signature
    && trial.choices?.length === input.assignments.length ? trial : null;
}

export function entryTrialsAreCurrent(study) {
  const batches = currentEntryBatches(study);
  const signature = stableSignature(buildStudioDraft(study));
  return batches.length > 0 && batches.every((input) => currentEntryTrial(study, input, signature));
}

// The human may overrule the reviewer for one exact translation, or stop using a
// paragraph as test evidence. Overrides change verdicts only, never test inputs,
// so saved trials stay current and nothing is translated again.
export function studioReviewOverride(study, paragraphId, occurrenceId, translation) {
  if ((study.ignoredTestParagraphIds ?? []).includes(paragraphId)) return "ignored";
  return (study.acceptedTranslations?.[`${paragraphId}:${occurrenceId}`] ?? []).includes(translation) ? "accepted" : null;
}

export function applyStudioReviewOverrides(study, trial) {
  if (!Array.isArray(trial?.choices)) return trial;
  trial.choices = trial.choices.map(({ override: _override, reviewerPassed, ...choice }) => {
    const passed = reviewerPassed ?? choice.passed;
    const translation = trial.translations?.find((t) => t.paragraphId === choice.paragraphId)?.translation;
    const override = studioReviewOverride(study, choice.paragraphId, choice.occurrenceId, translation);
    return override === "ignored" || (override === "accepted" && !passed)
      ? { ...choice, passed: true, reviewerPassed: passed, override } : { ...choice, passed };
  });
  trial.passed = trial.choices.every((choice) => choice.passed);
  return trial;
}

// A finding in the current step's latest trial. In step 8 that is the meaning's trial for its
// current inputs and repair round; in step 9, a batch tested with the current entry.
export function currentStudioFinding(study, paragraphId, occurrenceId, translation, signature) {
  const phase = study.step === "8" ? "8" : "9";
  const entry = phase === "9" ? signature ?? stableSignature(buildStudioDraft(study)) : null;
  for (const [key, trial] of Object.entries(study.tests ?? {})) {
    if (phase === "9" ? !/^9:\d+$/u.test(key) || trial.signature !== entry : !key.startsWith("8:")) continue;
    const paragraph = trial.translations?.find((t) => t.paragraphId === paragraphId);
    const choice = trial.choices?.find((c) => c.paragraphId === paragraphId && c.occurrenceId === occurrenceId);
    if (!paragraph || !choice || (translation !== undefined && paragraph.translation !== translation)) continue;
    if (phase === "8" && (trial.rounds !== (study.rounds?.[key] ?? 0) || trial.signature !== meaningTrialSignature(study, key.slice(2)))) continue;
    return { key, trial, choice, translation: paragraph.translation };
  }
  return null;
}

export function reviewStudioFinding(study, action, paragraphId, occurrenceId) {
  const finding = currentStudioFinding(study, paragraphId, occurrenceId);
  if (!finding) throw new Error("This finding is no longer part of the current test.");
  const key = `${paragraphId}:${occurrenceId}`;
  const ignored = study.ignoredTestParagraphIds ?? [];
  const accepted = study.acceptedTranslations?.[key] ?? [];
  if (action === "accept") study.acceptedTranslations = { ...study.acceptedTranslations, [key]: [...new Set([...accepted, finding.translation])] };
  else if (action === "ignore") study.ignoredTestParagraphIds = [...new Set([...ignored, paragraphId])];
  else if (action === "undo" && ignored.includes(paragraphId)) study.ignoredTestParagraphIds = ignored.filter((id) => id !== paragraphId);
  else if (action === "undo") {
    study.acceptedTranslations = { ...study.acceptedTranslations, [key]: accepted.filter((text) => text !== finding.translation) };
    if (!study.acceptedTranslations[key].length) delete study.acceptedTranslations[key];
  } else throw new Error("Unknown review action.");
  for (const trial of [...Object.values(study.tests ?? {}), ...Object.values(study.entryValidation?.best?.tests ?? {})]) applyStudioReviewOverrides(study, trial);
  return finding.key;
}

export function finalUsage(study, { groupByText = false } = {}) {
  const signature = stableSignature(buildStudioDraft(study));
  const keys = new Map(study.candidates.map((c) => [c.id, groupByText ? c.text : c.id]));
  const counts = Object.fromEntries([...keys.values()].map((key) => [key, { occurrences: 0, paragraphs: new Set() }]));
  const seen = new Set();
  for (const input of currentEntryBatches(study)) {
    const batch = currentEntryTrial(study, input, signature);
    if (!batch) continue;
    for (const choice of batch.choices) {
      const key = `${choice.paragraphId}:${choice.occurrenceId}`;
      if (seen.has(key)) throw new Error("A research occurrence was counted twice.");
      if (choice.preservedSourceSpelling && input.assignments.some((a) => a.paragraphId === choice.paragraphId
        && a.occurrenceId === choice.occurrenceId && a.preserveSourceSpelling)) { seen.add(key); continue; }
      // Ignored paragraphs are not evidence; an accepted rendering may use no listed candidate.
      if (choice.override === "ignored" || (choice.override === "accepted" && !keys.has(choice.candidateId))) { seen.add(key); continue; }
      if (!keys.has(choice.candidateId)) throw new Error("A test selected an unknown candidate.");
      seen.add(key);
      const count = counts[keys.get(choice.candidateId)];
      count.occurrences += 1;
      count.paragraphs.add(choice.paragraphId);
    }
  }
  return Object.fromEntries(Object.entries(counts).map(([id, count]) => [id, {
    occurrences: count.occurrences, paragraphs: count.paragraphs.size,
  }]));
}

export function stepInput(study, step) {
  const index = STUDIO_STEPS.findIndex((s) => s.id === step);
  const upstream = Object.fromEntries(STUDIO_STEPS.slice(0, index).map(({ id }) =>
    [id, study.steps[id]?.approvedDigest ?? study.steps[id]?.approved ?? null]));
  return { scope: study.scope, upstream, model: study.model,
    ...(step === "2a" ? { operationVersion: 3 } : step === "4.1" ? { operationVersion: STUDIO_DICTIONARY_REVIEW_VERSION } : {}) };
}

export async function approveStep(study, step, value) {
  if (value?._studioArtifact) throw new Error("Reopen this step before saving its report.");
  const approved = structuredClone(value);
  const canonical = stableSignature(stepInput(study, step));
  const signature = await fingerprint(canonical);
  const previous = study.steps[step];
  const approvedDigest = await fingerprint(stableSignature(approved));
  const previousDigest = previous?.approvedDigest ?? (previous?.approved
    ? await fingerprint(stableSignature(previous.approved)) : null);
  const changed = previousDigest !== approvedDigest
    || (previous?.signature !== signature && previous?.signature !== canonical);
  study.steps[step] = { ...previous, approved, signature, approvedDigest,
    status: approved?.skipped ? "skipped" : "complete" };
  if (changed) {
    const index = STUDIO_STEPS.findIndex((s) => s.id === step);
    for (const { id } of STUDIO_STEPS.slice(index + 1)) {
      if (study.steps[id] && study.steps[id].status !== "undone") study.steps[id].status = "stale";
    }
  }
  return changed;
}

export async function stepIsReusable(study, step) {
  const record = study.steps[step];
  return ["complete", "skipped"].includes(record?.status)
    && await stepSignatureMatches(study, step, record.signature);
}

export function sourceCollisions(study, entries) {
  const language = study.scope.sourceLanguage?.code ?? "und";
  return uniqueSourceTexts(selectedForms(study), language).flatMap((form) => {
    const matching = entries.filter((entry) => entry.termId !== study.savedTermId && entry.lifecycleState !== "deleted"
      && entry.sourceTerms.some((old) => sourceFormKey(old, language) === sourceFormKey(form, language)));
    return matching.length ? [{ form, entries: matching }] : [];
  });
}

export function collisionChanges(draft, entries, choices, language = "und") {
  const updates = [];
  const overwritten = new Set(draft.sourceTerms.filter((form) => choices[form] === "overwrite").map((form) => sourceFormKey(form, language)));
  for (const entry of entries) {
    const removed = entry.sourceTerms.filter((form) => overwritten.has(sourceFormKey(form, language)));
    if (removed.length) updates.push({ termId: entry.termId, expected: entry,
      sourceTerms: entry.sourceTerms.filter((form) => !removed.includes(form)) });
  }
  return updates;
}
