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
import { retestConsistency } from "./glossary-research-engine.js";
import { researchRequestClient } from "./glossary-research-flow.js";

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
/** What the consistency test did to a translation, in words, or "". */
function consistencyNote(run, variantId) {
  const consistency = run.consistency;
  const names = new Map((run.frozen?.entries ?? []).flatMap((entry) => entry.variants.map((variant) => [variant.id, variant.target])));
  if ((consistency?.dropped ?? []).includes(variantId)) {
    const set = (consistency.standardised ?? []).find((item) => item.variantIds.includes(variantId) && item.keep !== variantId);
    return `Removed by the consistency test: no meaning uses it any more${set ? `; the translator standardised on “${names.get(set.keep) ?? set.keep}”` : ""}.`;
  }
  const narrowed = (consistency?.narrowed ?? []).find((item) => item.variantId === variantId);
  return narrowed ? `Still used for ${narrowed.kept.map((m) => `“${m}”`).join(", ")}, but no longer for ${narrowed.removed.map((m) => `“${m}”`).join(", ")}: check that its note does not send the translator there.` : "";
}

/**
 * The consistency conflicts of an entry, for the person to decide: the
 * translations the translator took turns between, with the test sentences and
 * each translated sentence, and the notes as they were at the test.
 */
function consistencyConflicts(run, entry, variants) {
  const flips = new Map((run.consistency?.flips ?? []).map((flip) => [flip.occId, flip]));
  const byOcc = new Map((run.counting?.occurrences ?? []).map((occurrence) => [occurrence.occId, occurrence]));
  return (run.consistency?.conflicts ?? [])
    .filter((conflict) => conflict.entryId === entry.id && conflict.variantIds.filter((id) => variants.some((v) => v.id === id)).length > 1)
    .map((conflict) => ({
      kind: conflict.kind, variantIds: conflict.variantIds, occIds: conflict.occIds,
      sentences: conflict.occIds.map((occId) => {
        const occurrence = byOcc.get(occId);
        const item = run.sample?.items?.[occurrence?.itemId];
        const flip = flips.get(occId);
        return {
          occId, source: item && occurrence ? item.text.slice(occurrence.sentenceStart ?? 0, occurrence.sentenceEnd ?? item.text.length).trim() : "",
          surface: occurrence?.surface ?? "",
          translations: (flip?.variantIds ?? []).map((id) => ({ variantId: id, times: flip.choices[id], text: flip.translations[id] ?? "" })),
          reason: flip?.reason ?? "",
        };
      }),
      notesAtTest: Object.fromEntries(variants.filter((v) => conflict.variantIds.includes(v.id)).map((v) => [v.id, v.note])),
      retest: null,
    }));
}

/**
 * A conflict is settled when at most one of its translations is still ticked, or
 * when "Test again" found the translator no longer takes turns (after the notes
 * were edited to tell the translations apart).
 */
export function unresolvedConflicts(draft) {
  return (draft?.conflicts ?? []).filter((conflict) => {
    const ticked = draft.variants.filter((variant) => variant.include && conflict.variantIds.includes(variant.id));
    return ticked.length > 1 && conflict.retest?.status !== "consistent";
  });
}

/** True when the notes of the conflict's ticked translations changed since the test. */
export function conflictNotesEdited(draft, conflict) {
  return draft.variants.some((variant) => variant.include && conflict.variantIds.includes(variant.id)
    && (variant.note ?? "") !== (conflict.notesAtTest?.[variant.id] ?? ""));
}

/** "Test again": the conflict's sentences translated five times with the entry as edited. */
export async function retestResearchConflict(render, draftId, index) {
  const report = state.glossaryResearchReport;
  const draft = report?.entryDrafts?.[draftId];
  const conflict = draft?.conflicts?.[index];
  const run = report?.run;
  if (!conflict || !run) return;
  conflict.retest = { status: "running" };
  render();
  try {
    const client = researchRequestClient({
      installationId: installationId(), providerId: run.meta?.providerId, modelId: run.meta?.modelId, limitUsd: 1,
    });
    const variants = draft.variants.filter((variant) => variant.include && variant.target.trim())
      .map((variant) => ({ id: variant.id, target: variant.target.trim(), note: variant.note ?? "", ...(variant.partOfSpeech ? { partOfSpeech: variant.partOfSpeech } : {}) }));
    const entry = { id: draft.entryId, kind: draft.kind, sourceTerms: draft.sourceTerms, generalNote: draft.generalNote ?? "", variants };
    const result = await retestConsistency({ client, run, entry, occIds: conflict.occIds });
    conflict.retest = !result.answered
      ? { status: "failed", message: "No translation came back. Try again." }
      : result.flips.length
        ? { status: "flips", flips: result.flips.length, of: conflict.occIds.length }
        : { status: "consistent" };
  } catch (error) {
    conflict.retest = { status: "failed", message: error?.message ?? String(error) };
  }
  render();
}

export function buildEntryDrafts(run, glossaryTerms) {
  const frozen = run.frozen;
  const aggregate = run.aggregate?.entries ?? {};
  const votes = run.counting ? votesOf(run) : [];
  // Forms the study covered: an existing entry keeps its other forms when it is updated.
  const studied = new Set(frozen.entries.flatMap((entry) => entry.sourceTerms.map((form) => fold(form).trim())));
  const drafts = {};
  const consistencyDropped = new Set(run.consistency?.dropped ?? []);
  // The forms found in the texts (the spelling step's search), and the typed term.
  // Accents count: "regenero" is not "regeneró" (the search tells them apart).
  const exact = (form) => String(form ?? "").normalize("NFC").toLowerCase().trim();
  const found = Array.isArray(run.forms?.searched) ? new Set(run.forms.searched.map(exact)) : null;
  const typed = exact(run.meta?.term);
  const inTexts = (form, entry) => !found || found.has(exact(form)) || exact(form) === typed
    || exact(form) === exact(entry.sourceTerms[0]) || entry.kind === "expression";
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
            ...(variant.original ? { original: variant.original } : {}),
            ...(variant.partOfSpeech ? { partOfSpeech: variant.partOfSpeech } : {}),
            // Chosen in under 2% of the sample (or never): proposed for removal, since
            // every variant is sent to the translating AI; the user can keep it. The
            // original word of a borrowed meaning always stays. The consistency test
            // removes a translation no meaning uses any more (the user can keep it).
            include: !consistencyDropped.has(variant.id)
              && (Boolean(variant.original) || counts.occurrences === 0 || count / counts.occurrences >= RARELY_CHOSEN_SHARE),
            ...(consistencyNote(run, variant.id) ? { consistency: consistencyNote(run, variant.id) } : {}),
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
        // Only the forms found in the texts go into the glossary, and the typed
        // term (Hans, 2026-10-12: a verb's 70 forms, 54 of them never used, made
        // the entry a mess). Runs without that record keep every form.
        sourceTerms: entry.sourceTerms.filter((form) => forms.has(form.normalize("NFC").toLowerCase().trim()) && inTexts(form, entry)),
        notInTexts: entry.sourceTerms.filter((form) => forms.has(form.normalize("NFC").toLowerCase().trim()) && !inTexts(form, entry)),
        // Uses of each form of the study's entry in the sample, for the heading.
        formUses: Object.fromEntries(entry.sourceTerms.map((form) => [form, uses.get(form.normalize("NFC").toLowerCase().trim()) ?? 0])),
        generalNote: entry.generalNote,
        variants,
        conflicts: consistencyConflicts(run, entry, variants),
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
  if (unresolvedConflicts(draft).length) {
    draft.saveError = "Decide first: the consistency test found translations the translator takes turns between that change the meaning (see below).";
    render();
    return;
  }
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
    await rememberSaved(report, draft);
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

/**
 * Notes in the run's saved record that an entry went into the glossary, so the
 * list of past research can mark the run (Hans, 2026-10-12). Best effort: a
 * failure here does not undo the save.
 */
async function rememberSaved(report, draft) {
  const meta = report.run?.meta;
  if (!meta || !report.runId) return;
  const record = meta.savedToGlossary ?? { entries: [] };
  record.at = new Date().toISOString();
  record.entries = [
    ...(record.entries ?? []).filter((entry) => entry.draftId !== (draft.id ?? draft.entryId)),
    { draftId: draft.id ?? draft.entryId, sourceTerms: draft.sourceTerms, at: record.at },
  ];
  meta.savedToGlossary = record;
  try {
    await invoke("save_glossary_research_stage", {
      input: { installationId: installationId(), glossaryId: report.glossaryId, runId: report.runId, stage: "meta", value: meta },
    });
  } catch {
    // The mark in the list is a convenience; the glossary entry is saved.
  }
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
