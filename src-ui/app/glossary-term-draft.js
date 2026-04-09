import { invoke } from "./runtime.js";
import { resetGlossaryTermEditor, state } from "./state.js";
import { loadSelectedGlossaryEditorData } from "./glossary-editor-flow.js";
import { showNoticeBadge } from "./status-feedback.js";
import {
  canManageGlossaries,
  normalizeEditableTerms,
  sanitizeEditableTargetTerms,
  sanitizeEditableTerms,
  selectedGlossaryRepoName,
  selectedTeam,
  updateGlossaryTermArray,
} from "./glossary-shared.js";

export function openGlossaryTermEditor(render, termId = null) {
  if (!canManageGlossaries()) {
    showNoticeBadge("You do not have permission to edit glossary terms in this team.", render);
    return;
  }

  const term = termId
    ? state.glossaryEditor.terms.find((item) => item.termId === termId) ?? null
    : null;

  state.glossaryTermEditor = {
    ...state.glossaryTermEditor,
    isOpen: true,
    status: "idle",
    error: "",
    glossaryId: state.glossaryEditor.glossaryId,
    termId: term?.termId ?? null,
    sourceTerms: normalizeEditableTerms(term?.sourceTerms ?? []),
    targetTerms: normalizeEditableTerms(term?.targetTerms ?? []),
    notesToTranslators: term?.notesToTranslators ?? "",
    footnote: term?.footnote ?? "",
    untranslated: term?.untranslated === true,
  };
  render();
}

export function cancelGlossaryTermEditor(render) {
  resetGlossaryTermEditor();
  render();
}

export function updateGlossaryTermDraftField(field, value) {
  if (!state.glossaryTermEditor?.isOpen) {
    return;
  }
  state.glossaryTermEditor[field] = value;
  if (state.glossaryTermEditor.error) {
    state.glossaryTermEditor.error = "";
  }
}

export function updateGlossaryTermVariant(side, index, value) {
  if (!Number.isInteger(index) || index < 0) {
    return;
  }

  updateGlossaryTermArray(side, (terms) =>
    terms.map((term, termIndex) => (termIndex === index ? String(value ?? "") : term)),
  );
}

export function addGlossaryTermVariant(side) {
  updateGlossaryTermArray(side, (terms) => [...terms, ""]);
}

export function removeGlossaryTermVariant(side, index) {
  if (!Number.isInteger(index) || index < 0) {
    return;
  }

  updateGlossaryTermArray(side, (terms) => {
    if (terms.length <= 1) {
      return [""];
    }

    return terms.filter((_, termIndex) => termIndex !== index);
  });
}

export function moveGlossaryTermVariantToIndex(side, fromIndex, toIndex) {
  if (
    !Number.isInteger(fromIndex)
    || fromIndex < 0
    || !Number.isInteger(toIndex)
    || toIndex < 0
  ) {
    return;
  }

  updateGlossaryTermArray(side, (terms) => {
    if (fromIndex >= terms.length) {
      return terms;
    }

    const boundedIndex = Math.min(toIndex, terms.length);
    const adjustedIndex = boundedIndex > fromIndex ? boundedIndex - 1 : boundedIndex;
    if (adjustedIndex === fromIndex) {
      return terms;
    }

    const nextTerms = [...terms];
    const [movedTerm] = nextTerms.splice(fromIndex, 1);
    nextTerms.splice(Math.min(adjustedIndex, nextTerms.length), 0, movedTerm);
    return nextTerms;
  });
}

export async function submitGlossaryTermEditor(render) {
  const team = selectedTeam();
  const repoName = selectedGlossaryRepoName();
  const draft = state.glossaryTermEditor;
  if (!draft?.isOpen || !Number.isFinite(team?.installationId) || !repoName) {
    return;
  }

  if (!canManageGlossaries(team)) {
    state.glossaryTermEditor.error = "You do not have permission to edit glossary terms in this team.";
    render();
    return;
  }

  const sourceTerms = sanitizeEditableTerms(draft.sourceTerms);
  if (sourceTerms.length === 0) {
    state.glossaryTermEditor.error = "Enter at least one source term.";
    render();
    return;
  }

  const targetTerms = sanitizeEditableTargetTerms(draft.targetTerms);

  state.glossaryTermEditor.status = "loading";
  state.glossaryTermEditor.error = "";
  render();

  try {
    await invoke("upsert_gtms_glossary_term", {
      input: {
        installationId: team.installationId,
        repoName,
        termId: draft.termId || null,
        sourceTerms,
        targetTerms,
        notesToTranslators: draft.notesToTranslators,
        footnote: draft.footnote,
        untranslated: draft.untranslated === true,
      },
    });
    resetGlossaryTermEditor();
    await loadSelectedGlossaryEditorData(render);
  } catch (error) {
    state.glossaryTermEditor.status = "idle";
    state.glossaryTermEditor.error = error?.message ?? String(error);
    render();
  }
}
