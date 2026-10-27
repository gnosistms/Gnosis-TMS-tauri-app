import { STUDIO_STEPS, stableSignature, studioToolSignature, studioStepNumber, uniqueTexts } from "./glossary-research-studio-workflow.js";

// Recommendations inspect a small preview, never the saved evidence ledger.
const VERSION = 1;
const clip = (value, limit) => typeof value === "string" ? value.length > limit ? `${value.slice(0, limit)}…` : value : "";
export const STUDIO_SKIP_PROMPTS = {
  "2a": "Decide whether to search for additional forms and spellings beyond the user's list. Run if inflections, orthographic variants, transliterations or uncertain form identity could change corpus coverage. Skip only when there is positive reason to believe the supplied forms already cover this lexeme. A familiar word or an empty list is not evidence of completeness.",
  "4.1": "Decide whether source-language dictionary research would add needed definitions, grammatical distinctions or reliable etymology. Run for ordinary words without adequate cited dictionary evidence, ambiguous parts of speech, uncertain borrowing or disputed meanings. Skip only when adequate reliable lexical evidence is already supplied, or the term is demonstrably a corpus-specific coinage for which dictionary lookup would add no useful information. Do not assume dictionary absence from unfamiliarity.",
  "4.3": "Decide whether analyzing meaningful word components would improve interpretation. Run for plausible productive compounds, prefixes or suffixes whose contribution remains unresolved. Skip for an established simple lexeme or where reliable dictionary evidence already resolves the relevant formation. Do not invent word parts from superficial letter resemblance; remote etymology alone does not justify decomposition.",
  "4.4.1": "Decide whether comparing the author's bibliographical sources could resolve a material question about specialized meaning, borrowing or original terminology. Run when corpus usage departs from established ordinary senses, a specific source attribution needs checking, or competing source traditions affect interpretation. Skip when dictionary and corpus findings adequately cover the attested uses and there is no unresolved source question. Ordinary use of a word by multiple authors does not establish borrowing. This branch is available only for the Samael Aun Weor corpus.",
  "4.4.2": "Decide whether an additional web search for possible sources would resolve a material question left open by dictionary, corpus and any bibliographical findings. Run for an unresolved specialized use, original-language term, chronology or borrowing claim that could affect the glossary. Skip if existing evidence adequately covers the uses and no material source question remains; do not repeat established searches or pursue a remote first attestation for its own sake. Unknown evidence is not evidence of absence.",
  "4.4.4": "Decide whether to keep source research and run its source-summary operation. Run if either completed source branch contributes supported meanings, useful provenance, relevant uncertainty or conflicting findings that must reach the meaning inventory. A locally assembled summary still counts as Run even if it needs no further AI synthesis. Skip only if the user can safely discard ALL contributions from BOTH source branches without affecting the glossary. Skipping this step discards the entire parent source-research branch, not merely the cost of summarizing it. If both branches were explicitly skipped, the workflow handles this automatically without this recommendation call.",
  "5": "Decide whether further compounds-and-phrases research is useful after split-entry review. Run if the supplied evidence suggests recurring fixed expressions, or even one expression with a special meaning not readily understood from its parts, that previous review has not adequately handled. Skip if the completed review already handles such expressions and remaining combinations are ordinary grammar. An empty proposal list or a small excerpt sample alone does not establish that no compounds exist.",
};

const reportsFor = {
  "2a": [], "4.1": [], "4.3": ["4.1", "4.2"],
  "4.4.1": ["4.1", "4.2", "4.3"], "4.4.2": ["4.1", "4.2", "4.4.1"],
  "4.4.4": ["4.4.1", "4.4.2"], "5": ["4.5", "4.6", "4.7"],
};
export const studioCanRecommendSkip = (step) => Object.hasOwn(STUDIO_SKIP_PROMPTS, step);

export function sourceSummaryMustBeSkipped(study) {
  return ["4.4.1", "4.4.2"].every((id) => study.steps[id]?.status === "skipped"
    && study.steps[id]?.approved?.skipped === true);
}

export function studioRecommendationInput(study, step = study.step) {
  const reports = (reportsFor[step] ?? []).map((id) => {
    const record = study.steps[id]; const report = record?.approved ?? record?.value;
    return { step: studioStepNumber(id), status: record?.status ?? "not run", digest: record?.approvedDigest ?? record?.generatedSignature ?? null,
      skipped: Boolean(report?.skipped), summary: clip(report?.summary, 800),
      meaningCount: report?.meanings?.length ?? 0,
      meanings: (report?.meanings ?? []).slice(0, 6).map((m) => ({ definition: clip(m.definition, 220), grammar: clip(m.grammar, 100), originalTerm: clip(m.originalTerm, 80) })),
      splitCount: id === "4.7" ? study.queue.length : report?.splits?.length ?? report?.proposals?.length ?? 0 };
  });
  const forms = uniqueTexts(step === "2a" ? [study.scope.term, ...study.scope.forms]
    : study.forms.filter((f) => f.selected !== false).map((f) => f.text));
  const useExamples = !["2a", "4.4.4"].includes(step);
  const passages = useExamples && Array.isArray(study.passages) ? study.passages : [];
  // Spread across forms/documents where possible; explicitly mark excerpts and
  // their limits so they cannot be used for a corpus-wide absence claim.
  const examples = []; const seen = new Set();
  for (const p of passages) {
    const form = p.occurrences?.[0]?.surface ?? "";
    const doc = p.reference?.doc_id ?? p.reference?.projectTitle ?? "";
    const key = `${form}:${doc}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const start = Math.max(0, (p.occurrences?.[0]?.start ?? 0) - 200);
    examples.push({ id: p.id, excerpt: clip(p.text?.slice(start), 650) });
    if (examples.length === 4) break;
  }
  return { version: VERSION, step: studioStepNumber(step), term: clip(study.scope.term, 200),
    sourceLanguage: study.scope.sourceLanguage, targetLanguage: study.scope.targetLanguage,
    corpus: study.scope.corpus, projectIds: study.scope.projectIds,
    forms: forms.slice(0, 20).map((f) => clip(f, 100)), totalForms: forms.length,
    reports, examples, totalParagraphs: useExamples ? passages.length || study.passages?.length || 0 : 0,
    ...(step === "5" ? { splitEntryCount: study.queue.length, splitForms: study.queue.slice(0, 8).map((q) => q.forms.slice(0, 4).map((form) => clip(form, 100))) } : {}),
    previewLimit: "At most 20 forms, 6 meanings per report and 4 short paragraph excerpts. Omitted evidence remains saved. This preview cannot establish absence.",
    model: study.model };
}

export function studioRecommendationKey(study, step = study.step) {
  const input = studioRecommendationInput(study, step);
  if (step === "2a") {
    input.term = study.scope.term;
    input.forms = uniqueTexts([study.scope.term, ...study.scope.forms]);
  }
  return stableSignature(input);
}

export function studioResearchStarted(study, step = study.step) {
  // A saved plan alone does not mean the user has run the research.
  const started = (node) => Boolean(node.status && node.status !== "waiting"
    || node.result || node.error || node.children?.some(started));
  const record = study.steps[step];
  return Boolean((step === "2a" && study.formDiscovery) || record?.value || record?.approved
    || ["running", "failed", "awaiting-review", "complete", "skipped"].includes(record?.status)
    || study.activitySteps?.[step]?.items?.some(started));
}
export const studioFormsResearchStarted = (study) => studioResearchStarted(study, "2a");
export function currentStudioRecommendation(study) {
  const record = study.skipRecommendations?.[study.step];
  return record?.contextKey === studioRecommendationKey(study) ? record : null;
}

export async function recommendStudioStep(study, tools, { refresh = false } = {}) {
  const step = study.step;
  if (!studioCanRecommendSkip(step)) throw new Error("This research step cannot be skipped.");
  const input = studioRecommendationInput(study);
  const contextKey = studioRecommendationKey(study);
  const previous = currentStudioRecommendation(study);
  if (previous && !refresh) return previous;
  const number = studioStepNumber(step);
  const question = `Recommend whether the human should Skip or Run step ${number}: ${STUDIO_STEPS.find((s) => s.id === step)?.label}. `
    + "Consider Skip, Run, or not sure internally. If uncertain, missing evidence, or unable to make a recommendation, output Run. Recommend Skip only with positive support that this research is unnecessary for a useful accurate glossary. Do not perform the research, browse, generate definitions, or decide for the user. Return only Skip or Run in the recommendation field, never an uncertainty category. Explain the basis in one short sentence (at most 40 words), in the target language. "
    + STUDIO_SKIP_PROMPTS[step];
  try {
    // Full scope changes must invalidate tool caches even outside the AI preview.
    const inputFingerprint = contextKey !== stableSignature(input) ? await studioToolSignature("recommendation", null, contextKey) : null;
    const result = await tools.ask(question, { ...input, ...(inputFingerprint ? { inputFingerprint } : {}), ...(refresh ? { refresh: crypto.randomUUID() } : {}) },
      '{"recommendation":"Skip or Run","reason":"one short sentence"}', `Recommending Skip or Run for step ${number}`);
    tools.assertCurrent();
    const valid = ["Skip", "Run"].includes(result?.recommendation) && typeof result?.reason === "string" && result.reason.trim();
    return { contextKey, recommendation: valid ? result.recommendation : "Run",
      reason: valid ? clip(result.reason.trim(), 400) : "The AI did not return a clear recommendation. Run this step to avoid skipping useful research.",
      fallback: !valid, createdAt: new Date().toISOString() };
  } catch (error) {
    tools.assertCurrent();
    if (error?.message === "Research paused.") throw error;
    return { contextKey, recommendation: "Run", reason: "The AI recommendation could not be completed. Run this step to avoid skipping useful research.",
      fallback: true, createdAt: new Date().toISOString() };
  }
}
