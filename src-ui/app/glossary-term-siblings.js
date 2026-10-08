// Related ("sibling") glossary entries: entries kept apart because they take
// different translations, but linked so that a change to one is a reminder to
// check the others (Hans, 2026-10-08). The link is stored in both entries' files.

import { invoke } from "./runtime.js";
import { state } from "./state.js";
import { selectedGlossary, selectedTeam } from "./glossary-shared.js";
import { syncSingleGlossaryForTeam } from "./glossary-repo-flow.js";
import { showNoticeBadge } from "./status-feedback.js";

const fold = (text) => String(text ?? "").normalize("NFC").toLowerCase().trim();

/** The linked entries of a term that still exist, each with a short label. */
export function siblingSummaries(siblingTermIds, terms) {
  const byId = new Map((terms ?? []).map((term) => [term.termId, term]));
  return (siblingTermIds ?? [])
    .map((id) => byId.get(id))
    .filter((term) => term && term.lifecycleState !== "deleted")
    .map((term) => ({
      termId: term.termId,
      label: (term.sourceTerms ?? []).join(", "),
      targets: (term.targetTerms ?? []).filter(Boolean).slice(0, 3).join(", "),
    }));
}

/** The entry one of whose source forms is exactly `text` (not `exceptTermId`), or null. */
export function findTermBySourceForm(text, terms, exceptTermId = null) {
  const key = fold(text);
  if (!key) return null;
  return (terms ?? []).find((term) => term.termId !== exceptTermId
    && term.lifecycleState !== "deleted"
    && (term.sourceTerms ?? []).some((form) => fold(form) === key)) ?? null;
}

/** Reminder after saving an entry that has related entries, or "". */
export function siblingReminder(term, terms) {
  const siblings = siblingSummaries(term?.siblingTermIds, terms);
  if (!siblings.length) return "";
  return `Check its related ${siblings.length === 1 ? "entry" : "entries"} too: ${siblings.map((s) => s.label).join("; ")}.`;
}

/**
 * Link (or unlink) every pair of the given terms, then sync the glossary. The
 * visible terms take the new links. Returns the backend's answer.
 */
export async function linkGlossaryTerms(termIds, { linked = true, team = selectedTeam(), glossary = selectedGlossary() } = {}) {
  const editor = state.glossaryEditor;
  const result = await invoke("link_gtms_glossary_terms", {
    input: {
      installationId: team?.installationId,
      repoName: editor?.repoName ?? glossary?.repoName ?? "",
      glossaryId: editor?.glossaryId ?? glossary?.id ?? null,
      termIds,
      linked,
    },
  });
  for (const updated of result?.terms ?? []) {
    const visible = (editor?.terms ?? []).find((term) => term.termId === updated.termId);
    if (visible) visible.siblingTermIds = updated.siblingTermIds ?? [];
  }
  if (result?.changed) {
    try {
      await syncSingleGlossaryForTeam(team, glossary);
    } catch {
      // The link is committed locally; the next glossary sync sends it.
    }
  }
  return result;
}

/** Edit Term: link the entry named in the "related entry" field. */
export async function addSiblingFromTermEditor(render) {
  const editor = state.glossaryTermEditor;
  if (!editor?.termId) return;
  const terms = state.glossaryEditor?.terms ?? [];
  const other = findTermBySourceForm(editor.siblingInput, terms, editor.termId);
  if (!other) {
    editor.siblingError = "No other entry of this glossary has that source term.";
    render();
    return;
  }
  editor.siblingError = "";
  try {
    const result = await linkGlossaryTerms([editor.termId, other.termId]);
    const mine = result?.terms?.find((term) => term.termId === editor.termId);
    editor.siblingTermIds = mine?.siblingTermIds ?? [...new Set([...(editor.siblingTermIds ?? []), other.termId])];
    editor.siblingInput = "";
  } catch (error) {
    editor.siblingError = String(error?.message ?? error);
  }
  render();
}

/** Edit Term: remove the link to one related entry. */
export async function removeSiblingFromTermEditor(render, otherTermId) {
  const editor = state.glossaryTermEditor;
  if (!editor?.termId || !otherTermId) return;
  try {
    const result = await linkGlossaryTerms([editor.termId, otherTermId], { linked: false });
    const mine = result?.terms?.find((term) => term.termId === editor.termId);
    editor.siblingTermIds = mine?.siblingTermIds ?? (editor.siblingTermIds ?? []).filter((id) => id !== otherTermId);
    editor.siblingError = "";
  } catch (error) {
    editor.siblingError = String(error?.message ?? error);
  }
  render();
}

/** After a save: remind the person of the entry's related entries. */
export function remindOfSiblings(term, render) {
  const reminder = siblingReminder(term, state.glossaryEditor?.terms ?? []);
  if (reminder) showNoticeBadge(`Glossary term saved. ${reminder}`, render, 6000);
  return Boolean(reminder);
}
