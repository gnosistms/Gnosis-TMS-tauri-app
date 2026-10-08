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
import { groupForms } from "./glossary-research-form-split.js";
import { linkGlossaryTerms } from "./glossary-term-siblings.js";
import { showNoticeBadge } from "./status-feedback.js";

function installationId() {
  return selectedProjectsTeamInstallationId() ?? selectedTeam()?.installationId;
}

function overlaps(a, b) {
  const set = new Set(a.map((value) => fold(value).trim()));
  return b.some((value) => set.has(fold(value).trim()));
}

/** A translation chosen in less than this share of an entry's sampled votes is proposed for removal. */
export const RARELY_CHOSEN_SHARE = 0.02;

const formOf = (occurrence) => String(occurrence.surface ?? "").normalize("NFC").toLowerCase().trim();

/** Every judge's choice for each counted occurrence: [{ occurrence, variantId|null }]. */
function votesOf(run) {
  const out = [];
  for (const counting of [run.counting, run.counting2].filter(Boolean)) {
    for (const occurrence of counting.occurrences ?? run.counting.occurrences ?? []) {
      const judgment = counting.judgments?.[occurrence.occId];
      if (!judgment) continue;
      out.push({ occurrence, variantId: judgment.status === "selected" ? judgment.variantId ?? null : null });
    }
  }
  return out;
}

/** Votes and passages of one group of forms, shaped like an aggregate entry. */
function countsOf(votes, forms) {
  const counts = { occurrences: 0, passages: 0, variants: {}, other: 0, unresolved: {}, failed: 0 };
  const passages = new Set();
  const byVariant = new Map();
  for (const { occurrence, variantId } of votes) {
    if (!forms.has(formOf(occurrence))) continue;
    counts.occurrences += 1;
    passages.add(occurrence.itemId);
    if (!variantId) {
      counts.other += 1;
      continue;
    }
    const seen = byVariant.get(variantId) ?? { occurrences: 0, items: new Set() };
    seen.occurrences += 1;
    seen.items.add(occurrence.itemId);
    byVariant.set(variantId, seen);
  }
  counts.passages = passages.size;
  for (const [id, seen] of byVariant) counts.variants[id] = { occurrences: seen.occurrences, passages: seen.items.size };
  return counts;
}

function existingSummary(existing) {
  return existing
    ? { sourceTerms: existing.sourceTerms ?? [], targetTerms: existing.targetTerms ?? [], targetVariantNotes: existing.targetVariantNotes ?? [], notesToTranslators: existing.notesToTranslators ?? "", footnote: existing.footnote ?? "" }
    : null;
}

/**
 * Editable drafts of the report, compared with the existing glossary: one per
 * frozen entry, or one per group of its forms when the count shows that the forms
 * mostly take different translations (see glossary-research-form-split.js).
 */
export function buildEntryDrafts(run, glossaryTerms) {
  const frozen = run.frozen;
  const aggregate = run.aggregate?.entries ?? {};
  const votes = run.counting ? votesOf(run) : [];
  // Forms the study covered: an existing entry keeps its other forms when it is updated.
  const studied = new Set(frozen.entries.flatMap((entry) => entry.sourceTerms.map((form) => fold(form).trim())));
  const drafts = {};
  for (const entry of frozen.entries) {
    const existing = glossaryTerms.find((term) => overlaps(term.sourceTerms ?? [], entry.sourceTerms)) ?? null;
    const proposalEntry = (run.confirmedProposal ?? run.proposal)?.entries?.find((e) => e.id === entry.id);
    const entryVotes = votes.filter((vote) => vote.occurrence.entryId === entry.id);
    const uses = new Map();
    for (const occurrence of run.counting?.occurrences ?? []) {
      if (occurrence.entryId === entry.id) uses.set(formOf(occurrence), (uses.get(formOf(occurrence)) ?? 0) + 1);
    }
    const groups = entry.kind === "expression" || !entryVotes.length
      ? [{ forms: entry.sourceTerms.map((f) => f.normalize("NFC").toLowerCase().trim()), thin: [] }]
      : groupForms(entry.sourceTerms, entryVotes.map((v) => ({ form: formOf(v.occurrence), variantId: v.variantId })), uses);
    const split = groups.length > 1;
    groups.forEach((group, index) => {
      const forms = new Set(group.forms);
      const counts = split ? countsOf(entryVotes, forms) : aggregate[entry.id] ?? { variants: {}, occurrences: 0 };
      // The existing entry is updated by the group with the most uses; the others are added.
      const mine = index === 0 ? existing : null;
      const variants = entry.variants
        .filter((variant) => !split || (counts.variants[variant.id]?.occurrences ?? 0) > 0)
        .map((variant) => {
          const count = counts.variants?.[variant.id]?.occurrences ?? 0;
          const fromExisting = proposalEntry?.variants?.find((v) => v.id === variant.id)?.fromExisting === true
            || (mine?.targetTerms ?? []).some((target) => fold(target).trim() === fold(variant.target).trim());
          return {
            id: variant.id, target: variant.target, note: variant.note, count,
            fromExisting,
            // Chosen in under 2% of the sample (or never): proposed for removal, since
            // every variant is sent to the translating AI; the user can keep it.
            include: counts.occurrences === 0 || count / counts.occurrences >= RARELY_CHOSEN_SHARE,
          };
        })
        .sort((a, b) => b.count - a.count);
      const id = split ? `${entry.id}~${index + 1}` : entry.id;
      drafts[id] = {
        id,
        entryId: entry.id,
        kind: entry.kind,
        forms: split ? [...forms] : null,
        counts: split ? counts : null,
        splitFrom: split ? { forms: groups.filter((_, k) => k !== index).flatMap((g) => g.forms), thin: group.thin } : null,
        decision: mine ? "update" : "add",
        existingTermId: mine?.termId ?? null,
        existing: existingSummary(mine),
        keepForms: mine ? (mine.sourceTerms ?? []).filter((form) => !studied.has(fold(form).trim())) : [],
        sourceTerms: entry.sourceTerms.filter((form) => forms.has(form.normalize("NFC").toLowerCase().trim())),
        generalNote: entry.generalNote,
        variants,
        saveStatus: "idle",
        saveError: "",
      };
    });
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
    // Forms of the existing entry that this study did not cover stay in it.
    sourceTerms: [...draft.sourceTerms, ...(existing ? draft.keepForms ?? [] : [])],
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

/** Save every entry that is not set to keep the current one, one after another. */
export async function saveResearchReport(render) {
  const drafts = Object.values(state.glossaryResearchReport.entryDrafts ?? {});
  for (const draft of drafts) {
    if (draft.decision === "keep" || draft.saveStatus === "saved") continue;
    await saveResearchEntry(render, draft.id ?? draft.entryId);
  }
  // The entries one study split into (vanidad / vanidades) are linked as related
  // entries, so a later change to one is a reminder to check the other.
  const byStudyEntry = new Map();
  for (const draft of drafts) {
    if (!draft.splitFrom || !draft.existingTermId) continue;
    byStudyEntry.set(draft.entryId, [...(byStudyEntry.get(draft.entryId) ?? []), draft.existingTermId]);
  }
  for (const termIds of byStudyEntry.values()) {
    if (termIds.length < 2) continue;
    try {
      await linkGlossaryTerms(termIds);
    } catch (error) {
      showNoticeBadge(`Saved, but the entries could not be linked as related: ${error?.message ?? error}`, render);
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
