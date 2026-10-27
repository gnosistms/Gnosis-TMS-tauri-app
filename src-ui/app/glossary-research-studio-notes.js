// Only selection guidance belongs in a glossary's translation prompt. Research
// explanations stay in the study/report and never enter the saved entry draft.
export const STUDIO_USAGE_NOTE_POLICY = "Usage-note policy: Write the shortest self-contained rule that helps select or interpret this target form. Usually use one short sentence, roughly 10–25 English words or comparable brevity in the target language; an obvious mapping can have an empty note. Treat roughly 40 English words as a soft ceiling, not a truncation rule. Use a longer note ONLY when its additional condition is needed to prevent a meaningful translation error, such as a wrong sense or referent, an invented implication, or substantive omission/addition. Ordinary stylistic preferences, honorific stacking, intelligible metaphors, generic inflection advice and one-off sentence rewrites do not justify longer notes. Never remove a condition needed for accuracy merely to meet a length target. For each exceptional longer note, put the concrete error it prevents in longNoteReason, separate from the note. Apply the brevity target to the final shared note for one target spelling across all meanings; reuse one combined rule rather than accumulating separate essays. Keep generalNote empty unless it adds essential shared selection guidance not already in candidate notes, and keep it equally brief. Put etymology, source provenance, citations, supporting examples, detailed explanations and repair history in researchSummary/explanation fields for the research report, not in translator notes or a footnote used as overflow. Preserve explicit human instructions and verified reader footnotes. Do not invent provenance. When repairing, replace or simplify the reusable rule instead of appending another passage-specific exception; preserve all essential conditions and human selection defaults.";

export function usageNoteResearch(result, candidates = result.candidates ?? []) {
  return {
    summary: result.researchSummary ?? result.explanation ?? "",
    generalNoteReason: result.generalNoteReason ?? "",
    candidates: candidates.map((c) => ({ text: c.text ?? "", explanation: c.explanation ?? "",
      longNoteReason: c.longNoteReason ?? "" })).filter((c) => c.explanation || c.longNoteReason),
  };
}

export function recordUsageNoteRepair(study, key, step, repair) {
  const candidates = [...(repair.notes ?? []).map((note) => ({ ...note,
    text: study.candidates.find((c) => c.id === note.candidateId)?.text ?? "" })), ...(repair.newForms ?? [])];
  const research = usageNoteResearch(repair, candidates);
  if (research.summary || research.candidates.length) {
    study.reports ??= {};
    study.reports[`${key}:usage-notes`] = { kind: "usage-notes", step, ...research };
  }
}

// Repeated meaning records for one visible target must not keep obsolete notes
// after a repair. Replace the complete note, without clipping necessary detail.
export function applyUsageNoteRepairs(study, candidates, notes) {
  const byText = new Map();
  for (const item of notes ?? []) {
    const candidate = candidates.find((c) => c.id === item.candidateId);
    if (!candidate || typeof item.note !== "string") throw new Error("Note repair returned an unknown candidate or incomplete usage note.");
    const values = byText.get(candidate.text) ?? new Set(); values.add(item.note); byText.set(candidate.text, values);
  }
  for (const candidate of study.candidates) if (byText.has(candidate.text)) candidate.note = [...byText.get(candidate.text)].join("; ");
}
