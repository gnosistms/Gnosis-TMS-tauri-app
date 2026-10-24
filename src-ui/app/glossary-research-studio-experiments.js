import { newStudioStudy } from "./glossary-research-studio-workflow.js";
import { translateTrial } from "./glossary-research-studio-testing.js";

// Controlled runs copy curated inputs only. They never mutate the source study or
// copy its historical raw request cache into every new checkpoint.
export async function budgetComparison(source, resolve) {
  const passages = structuredClone(await resolve(source.passages));
  if (!Array.isArray(passages) || !source.assignments?.length || !source.comparisonStarts?.["8"]) throw new Error("Complete the reference study before comparing paragraph budgets.");
  const initial = await resolve(source.comparisonStarts["8"]);
  const study = newStudioStudy(structuredClone(source.scope));
  study.model = structuredClone(source.model); study.translationRuntimeVersion = source.translationRuntimeVersion;
  study.forms = structuredClone(source.forms); study.origin = structuredClone(source.origin);
  study.meanings = structuredClone(source.meanings).map((m) => ({ ...m, unused: false }));
  study.passages = passages.filter((p) => !p.recovered); study.populationCount = source.populationCount;
  study.population = structuredClone(await resolve(source.population)); study.sampling = structuredClone(source.sampling);
  study.referenceStudyId = source.id; study.budgetComparisonPhase = "bibliography";
  study.comparisonReference = { sourceStudyId: source.id, paragraphCount: passages.length, occurrenceCount: source.assignments.length,
    passages, assignments: structuredClone(source.assignments), meanings: structuredClone(source.meanings),
    initialTests: structuredClone(initial.fields), finalCandidates: structuredClone(source.candidates), generalNote: source.generalNote,
    timing: structuredClone(source.timing) };
  for (const step of ["1", "2a", "2b", "3", "4.1", "4.2", "4.3", "4.4.1", "4.4.2", "4.4.4", "4.5"]) {
    const old = source.steps[step]; if (!old?.approved) continue;
    const approved = structuredClone(await resolve(old.approved));
    study.steps[step] = { approved, value: structuredClone(approved), signature: old.signature, approvedDigest: old.approvedDigest, status: "complete" };
  }
  study.steps["4.4.1"] = { ...study.steps["4.4.1"], value: null, status: "stale", generatedSignature: null };
  study.step = "4.4.1"; study.comparisonResults = {};
  return study;
}

export function referenceForTranslationTests(study, reference) {
  study.comparisonResults.assignment = { report: structuredClone(study.steps["4.6"].value),
    assignments: structuredClone(study.assignments), meanings: structuredClone(study.meanings), paragraphIds: study.passages.map((p) => p.id),
    recoveryProfiles: structuredClone(study.recoveryProfiles ?? []), recoveryConsidered: study.recoveryConsidered ?? 0 };
  study.passages = structuredClone(reference.passages); study.assignments = structuredClone(reference.assignments);
  study.meanings = structuredClone(reference.meanings);
  for (const [key, value] of Object.entries(reference.initialTests)) study[key] = structuredClone(value);
  study.tests = {}; study.rounds = {}; study.pendingDecision = null;
  study.budgetComparisonPhase = "focused";
}

// This audit measures semantic consequences, independently of coverage labels.
export async function testOmittedInterpretation(study, reference, tools) {
  const paragraph = reference.passages.find((p) => p.recovered);
  if (!paragraph) throw new Error("The reference has no recovered paragraph to audit.");
  const omittedIds = new Set(reference.assignments.filter((a) => a.paragraphId === paragraph.id).map((a) => a.meaningId));
  const meanings = reference.meanings.filter((m) => !omittedIds.has(m.id) && !m.unused);
  const candidates = reference.finalCandidates.filter((c) => c.confirmed && c.meaningIds.some((id) => !omittedIds.has(id)))
    .map((c) => ({ ...c, meaningIds: c.meaningIds.filter((id) => !omittedIds.has(id)) }));
  const draft = await tools.ask("Write concise glossary usage guidance using ONLY the supplied remaining definitions and confirmed forms. Do not invent further interpretations. Return each supplied candidate ID once. This draft will be tested separately; no held-out paragraph is supplied.",
    { term: study.scope.term, sourceLanguage: study.scope.sourceLanguage, targetLanguage: study.scope.targetLanguage,
      meanings: meanings.map(({ id, definition }) => ({ id, definition })), candidates: candidates.map(({ id, text, meaningIds }) => ({ id, text, meaningIds })) },
    '{"generalNote":"shared guidance","notes":[{"candidateId":"supplied ID","note":"usage"}]}', "Preparing a draft without the recovered interpretation");
  if (typeof draft.generalNote !== "string" || !Array.isArray(draft.notes)
    || draft.notes.length !== candidates.length || new Set(draft.notes.map((n) => n.candidateId)).size !== candidates.length
    || draft.notes.some((n) => !candidates.some((c) => c.id === n.candidateId) || typeof n.note !== "string")) throw new Error("Counterfactual glossary guidance was incomplete.");
  const revised = candidates.map((c) => ({ ...c, note: draft.notes.find((n) => n.candidateId === c.id).note }));
  const probe = { ...study, meanings, candidates: revised, generalNote: draft.generalNote, footnote: "", queue: [], tests: {} };
  const translations = await translateTrial(probe, tools, [paragraph], revised, `counterfactual:${crypto.randomUUID()}`);
  const verdict = await tools.ask("Assess the semantic consequences of this translation from the source and its neighboring context. Classify severity as acceptable, nuance_loss, misleading, or material_error. A metaphor may imply a concept without literally naming it; do not require an explicit psychological label when an ordinary darkness metaphor preserves the implication. Distinguish symbolic darkness from unwarranted evil or malice. Explain concrete reader impact, not missing taxonomy labels.",
    { source: paragraph.text, contextBefore: paragraph.contextBefore ?? [], contextAfter: paragraph.contextAfter ?? [], translation: translations[0].translation },
    '{"severity":"acceptable","explanation":"reader impact","preservesImagery":true,"preservesImplication":true}', "Assessing the held-out paragraph without dedicated guidance");
  if (!["acceptable", "nuance_loss", "misleading", "material_error"].includes(verdict.severity) || typeof verdict.explanation !== "string") throw new Error("Counterfactual semantic assessment was incomplete.");
  return { paragraphId: paragraph.id, omittedMeaningIds: [...omittedIds], remainingMeanings: meanings, candidates: revised, generalNote: draft.generalNote, translations, verdict };
}
