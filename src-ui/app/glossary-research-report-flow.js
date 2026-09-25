// Glossary Research report page: loading a saved run, the editable entry
// cards (update / keep existing / add), per-entry Save through the normal
// glossary term save path, and the Markdown export for other AI tools.

import { state, createGlossaryTermEditorState, resetGlossaryTermEditor } from "./state.js";
import { invoke } from "./runtime.js";
import { selectedTeam } from "./glossary-shared.js";
import { selectedProjectsTeamInstallationId } from "./project-context.js";
import { submitGlossaryTermEditor } from "./glossary-term-draft.js";
import { createGlossaryResearchReportState, createGlossaryResearchState } from "./glossary-research-state.js";
import { fold } from "./glossary-research-occurrences.js";

function installationId() {
  return selectedProjectsTeamInstallationId() ?? selectedTeam()?.installationId;
}

function overlaps(a, b) {
  const set = new Set(a.map((value) => fold(value).trim()));
  return b.some((value) => set.has(fold(value).trim()));
}

/** Editable draft per frozen entry, compared with the existing glossary. */
export function buildEntryDrafts(run, glossaryTerms) {
  const frozen = run.frozen;
  const counts = run.aggregate?.entries ?? {};
  const drafts = {};
  for (const entry of frozen.entries) {
    const existing = glossaryTerms.find((term) => overlaps(term.sourceTerms ?? [], entry.sourceTerms)) ?? null;
    const entryCounts = counts[entry.id] ?? { variants: {}, occurrences: 0 };
    const proposalEntry = (run.confirmedProposal ?? run.proposal)?.entries?.find((e) => e.id === entry.id);
    const variants = entry.variants.map((variant) => {
      const count = entryCounts.variants?.[variant.id]?.occurrences ?? 0;
      const fromExisting = proposalEntry?.variants?.find((v) => v.id === variant.id)?.fromExisting === true
        || (existing?.targetTerms ?? []).some((target) => fold(target).trim() === fold(variant.target).trim());
      return {
        id: variant.id, target: variant.target, note: variant.note, count,
        fromExisting,
        // Never chosen in the sample: proposed for removal (the user can keep it).
        include: count > 0 || entryCounts.occurrences === 0,
      };
    }).sort((a, b) => b.count - a.count);
    drafts[entry.id] = {
      entryId: entry.id,
      kind: entry.kind,
      decision: existing ? "update" : "add",
      existingTermId: existing?.termId ?? null,
      existing: existing
        ? { sourceTerms: existing.sourceTerms ?? [], targetTerms: existing.targetTerms ?? [], targetVariantNotes: existing.targetVariantNotes ?? [], notesToTranslators: existing.notesToTranslators ?? "", footnote: existing.footnote ?? "" }
        : null,
      sourceTerms: [...entry.sourceTerms],
      generalNote: entry.generalNote,
      variants,
      saveStatus: "idle",
      saveError: "",
    };
  }
  return drafts;
}

export async function openResearchReport(render, runId) {
  const glossaryId = state.glossaryEditor?.glossaryId;
  const previousScreen = state.screen;
  state.glossaryResearchReport = {
    ...createGlossaryResearchReportState(), glossaryId, runId, status: "loading",
    returnScreen: previousScreen === "glossaryResearchReport" ? "glossaryEditor" : previousScreen,
  };
  state.glossaryResearch = createGlossaryResearchState();
  state.screen = "glossaryResearchReport";
  render();
  try {
    const run = await invoke("load_glossary_research_run", { installationId: installationId(), glossaryId, runId });
    if (!run?.frozen || !run?.counting) throw new Error("This research run has no finished counts.");
    const report = state.glossaryResearchReport;
    if (report.runId !== runId) return;
    report.run = run;
    report.entryDrafts = buildEntryDrafts(run, state.glossaryEditor?.terms ?? []);
    report.status = "ready";
  } catch (error) {
    state.glossaryResearchReport.status = "error";
    state.glossaryResearchReport.error = error.message ?? String(error);
  }
  render();
}

export function closeResearchReport(render) {
  const target = state.glossaryResearchReport.returnScreen || "glossaryEditor";
  state.glossaryResearchReport = createGlossaryResearchReportState();
  state.screen = target;
  render();
}

export function toggleResearchVariantExamples(render, key) {
  const expanded = state.glossaryResearchReport.expandedVariants;
  expanded[key] = !expanded[key];
  render();
}

export function showAllResearchExamples(render, key) {
  state.glossaryResearchReport.showAllExamples[key] = true;
  render();
}

export function setResearchEntryDecision(render, entryId, decision) {
  const draft = state.glossaryResearchReport.entryDrafts[entryId];
  if (!draft) return;
  draft.decision = decision;
  render();
}

export function updateResearchEntryField(entryId, field, value, variantIndex = null) {
  const draft = state.glossaryResearchReport.entryDrafts?.[entryId];
  if (!draft) return;
  if (field === "sourceTerms") draft.sourceTerms = value.split(/[,;\n]/).map((v) => v.trim()).filter(Boolean);
  else if (field === "generalNote") draft.generalNote = value;
  else if (field === "target" || field === "note") draft.variants[variantIndex][field] = value;
  else if (field === "include") draft.variants[variantIndex].include = value === true;
  if (draft.saveStatus === "saved") draft.saveStatus = "idle";
  draft.saveError = "";
}

export function addResearchEntryVariant(render, entryId) {
  const draft = state.glossaryResearchReport.entryDrafts[entryId];
  draft.variants.push({ id: `${entryId}new${draft.variants.length}`, target: "", note: "", count: 0, fromExisting: false, include: true, added: true });
  render();
}

/** Save one entry through the glossary term editor's normal save path. */
export async function saveResearchEntry(render, entryId) {
  const report = state.glossaryResearchReport;
  const draft = report.entryDrafts[entryId];
  if (!draft || draft.decision === "keep") return;
  const variants = draft.variants.filter((variant) => variant.include && variant.target.trim());
  if (!draft.sourceTerms.length || !variants.length) {
    draft.saveError = "An entry needs at least one source term and one translation.";
    render();
    return;
  }
  const team = selectedTeam();
  const existing = draft.decision === "update" && draft.existingTermId
    ? (state.glossaryEditor?.terms ?? []).find((term) => term.termId === draft.existingTermId)
    : null;
  draft.saveStatus = "saving";
  render();
  state.glossaryTermEditor = {
    ...createGlossaryTermEditorState(),
    isOpen: true,
    glossaryId: state.glossaryEditor?.glossaryId ?? null,
    teamId: state.selectedTeamId,
    installationId: team?.installationId ?? null,
    repoName: state.glossaryEditor?.repoName ?? "",
    termId: existing?.termId ?? null,
    sourceTerms: [...draft.sourceTerms],
    targetTerms: variants.map((variant) => variant.target.trim()),
    targetVariantNotes: variants.map((variant) => variant.note.trim()),
    notesToTranslators: draft.generalNote.trim(),
    footnote: existing?.footnote ?? "",
    untranslated: false,
  };
  await submitGlossaryTermEditor(render);
  const editor = state.glossaryTermEditor;
  if (editor?.isOpen && editor.error) {
    draft.saveStatus = "idle";
    draft.saveError = editor.error;
    resetGlossaryTermEditor();
  } else if (editor?.isOpen) {
    draft.saveStatus = "idle";
    draft.saveError = "The entry could not be saved right now. Try again.";
    resetGlossaryTermEditor();
  } else {
    draft.saveStatus = "saved";
    if (!existing) {
      const created = (state.glossaryEditor?.terms ?? []).find((term) => overlaps(term.sourceTerms ?? [], draft.sourceTerms));
      if (created) {
        draft.existingTermId = created.termId;
        draft.decision = "update";
      }
    }
  }
  render();
}

// --- Markdown export for discussion with any AI ----------------------------------

export function researchMarkdown(run) {
  const meta = run.meta;
  const frozen = run.frozen;
  const aggregate = run.aggregate;
  const sample = run.sample;
  const judgments = run.counting.judgments;
  const lines = [
    `# Translation research: “${meta.term}” (${meta.sourceLanguage.name} → ${meta.targetLanguage.name})`, "",
    "A self-contained research record for discussing proposed glossary (TMX) entries with an AI assistant or a colleague. It was produced by Gnosis TMS Glossary Research; nothing here has been written to a glossary unless the user saved it.", "",
    "## How to read the counts", "",
    "Counts show which proposed translation was judged most appropriate in each sampled context: contextual preference, not frequency in the target language or exclusive correctness.",
    `Sample: ${aggregate.totals.passagesSampled} distinct passages drawn uniformly at random (seed ${meta.seed}) from ${aggregate.totals.populationDistinct} distinct passages in ${meta.sourceMode === "samael" ? "the complete works of Samael Aun Weor" : "selected team projects"}; ${aggregate.totals.occurrencesSampled} occurrences judged. Model: ${meta.modelId}.`, "",
    "## Proposed entries (exact TMX fields)", "",
  ];
  for (const entry of frozen.entries) {
    const counts = aggregate.entries[entry.id];
    lines.push(`### ${entry.sourceTerms.join(" / ")}${entry.kind === "expression" ? " (expression)" : ""}`, "",
      `General note (${meta.targetLanguage.name}): ${entry.generalNote}`, "",
      "| translation | chosen (occurrences / passages) | usage note |", "|---|---|---|");
    for (const variant of entry.variants) {
      const c = counts?.variants?.[variant.id] ?? { occurrences: 0, passages: 0 };
      lines.push(`| ${variant.target} | ${c.occurrences} / ${c.passages} | ${variant.note} |`);
    }
    if (counts) lines.push(`| other / none fits | ${counts.other} | |`, `| unresolved | ${Object.values(counts.unresolved).reduce((a, b) => a + b, 0)} | |`);
    lines.push("");
  }
  const proposal = run.confirmedProposal ?? run.proposal;
  if (run.sources?.study) lines.push("## Where the term comes from", "", "```json", JSON.stringify(run.sources.study, null, 1), "```", "");
  if (run.candidates) lines.push("## Candidate translations for the whole term (before the passage readings)", "", "```json", JSON.stringify(run.candidates, null, 1), "```", "");
  for (const [key, label] of [["existingComparison", "Existing entries compared"], ["leftOutRenderings", "Readings not measured"], ["rejectedExpressions", "Recurring combinations without their own entry"], ["derivativeStudies", "Suggested separate studies"], ["sensesOutsideDictionary", "Senses outside the dictionary"], ["openQuestions", "Open questions"]]) {
    if (proposal?.[key]?.length) {
      lines.push(`## ${label}`, "", ...proposal[key].map((item) => `- ${typeof item === "string" ? item : JSON.stringify(item)}`), "");
    }
  }
  if (run.dictionary?.text) lines.push(`## Dictionary (${run.dictionary.sourceName})`, "", "```", run.dictionary.text, "```", "");
  lines.push("## Every judged occurrence", "", `| id | ${meta.sourceLanguage.name} sentence | outcome | translated sentence | note |`, "|---|---|---|---|---|");
  const cell = (value) => String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
  for (const occurrence of run.counting.occurrences) {
    const item = sample.items[occurrence.itemId];
    const text = item.text;
    const sentence = `${text.slice(occurrence.sentenceStart, occurrence.markStart)}⟦${text.slice(occurrence.markStart, occurrence.markEnd)}⟧${text.slice(occurrence.markEnd, occurrence.sentenceEnd)}`;
    const j = judgments[occurrence.occId] ?? { status: "not run" };
    const outcome = j.status === "selected" ? j.variantId : `${j.status}${j.otherRendering ? `: ${j.otherRendering}` : j.unresolvedReason ? `: ${j.unresolvedReason}` : ""}`;
    lines.push(`| ${occurrence.occId} | ${cell(sentence)} | ${cell(outcome)} | ${cell(j.sentenceTranslation)} | ${cell(j.note)} |`);
  }
  lines.push("", "## Questions for discussion", "",
    "1. Do the proposed translations cover the attested meanings without redundant near-synonyms?",
    "2. Are the usage notes clear enough for a translator to choose correctly?",
    "3. Which judged occurrences look wrong, and would they change a translation or a note?",
    "4. Should any expression entry be added, merged or dropped?");
  return `${lines.join("\n")}\n`;
}

export async function copyResearchMarkdown(render) {
  const report = state.glossaryResearchReport;
  if (!report.run) return;
  try {
    await navigator.clipboard.writeText(researchMarkdown(report.run));
    report.copyNotice = "Copied. Paste it into Claude, ChatGPT or another assistant to discuss the findings.";
  } catch {
    report.copyNotice = "Could not copy to the clipboard.";
  }
  render();
}
