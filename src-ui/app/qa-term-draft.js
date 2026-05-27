import { invoke } from "./runtime.js";
import {
  createQaTermEditorState,
  state,
} from "./state.js";
import { extractGlossaryRubyBaseText } from "./glossary-ruby.js";
import { normalizeQaTerm, selectedQaList } from "./qa-list-shared.js";
import {
  applyQaListsQueryDataForTeam,
  createQaResourceId,
  currentQaListTeam,
  ensureQaListsQueryDataForTeam,
  repoBackedQaListInput,
  repoBackedQaTermRollbackInput,
  saveCurrentTeamQaLists,
  syncSingleQaListOrThrow,
} from "./qa-list-top-level-state.js";
import { patchQaListQueryData } from "./qa-list-query.js";
import { removeQaListEditorQuery } from "./qa-list-editor-query.js";
import { selectedQaListEditorMatches, syncAndRefreshQaListEditorSnapshot } from "./qa-list-editor-flow.js";
import { teamSupportsQaListRepos } from "./qa-list-repo-flow.js";
import { getQaListWritePolicy } from "./resource-write-policy.js";
import {
  beginQaTermWrite,
  endQaTermWrite,
  qaListTermWriteIsActive,
} from "./qa-term-write-coordinator.js";

const QA_TERM_DUPLICATE_WARNING =
  "This QA term is redundant with another QA term in this QA list. Please change it before saving.";

function qaTermRecordsMatch(left, right) {
  return (
    String(left?.termId ?? "") === String(right?.termId ?? "")
    && String(left?.text ?? "") === String(right?.text ?? "")
    && String(left?.notes ?? "") === String(right?.notes ?? "")
    && String(left?.lifecycleState ?? "active") === String(right?.lifecycleState ?? "active")
  );
}

function normalizeQaTermTextForDuplicateDetection(value) {
  return extractGlossaryRubyBaseText(value).trim();
}

function qaTermTextDuplicatesExistingTerm(text, terms, termId = null) {
  const normalizedText = normalizeQaTermTextForDuplicateDetection(text);
  if (!normalizedText) {
    return false;
  }

  return (Array.isArray(terms) ? terms : []).some((term) =>
    term
      && term.lifecycleState !== "deleted"
      && term.termId !== termId
      && normalizeQaTermTextForDuplicateDetection(term.text) === normalizedText,
  );
}

function qaTermDuplicateErrorState(editor) {
  return {
    ...editor,
    error: QA_TERM_DUPLICATE_WARNING,
  };
}

async function rollbackQaTermSave(team, qaList, previousHeadSha, failureMessage) {
  if (!previousHeadSha) {
    return failureMessage;
  }

  try {
    await invoke("rollback_gtms_qa_list_term_upsert", {
      input: repoBackedQaTermRollbackInput(team, qaList, previousHeadSha),
    });
    return `${failureMessage} The local QA term change was rolled back.`;
  } catch (rollbackError) {
    const rollbackMessage = rollbackError instanceof Error
      ? rollbackError.message
      : String(rollbackError);
    return `${failureMessage} Rolling back the local QA term change also failed: ${rollbackMessage}`;
  }
}

export function openQaTermEditor(render, termId = null) {
  const editor = state.qaListEditor;
  const policy = getQaListWritePolicy({
    team: currentQaListTeam(),
    qaList: selectedQaList(),
  });
  if (!policy.allowed) {
    state.qaListEditor = {
      ...state.qaListEditor,
      status: "error",
      error: policy.message,
    };
    render();
    return;
  }
  const existing = termId
    ? (editor.terms ?? []).find((term) => term.termId === termId)
    : null;

  state.qaTermEditor = {
    ...createQaTermEditorState(),
    isOpen: true,
    qaListId: editor.qaListId,
    termId: existing?.termId ?? null,
    text: existing?.text ?? "",
    notes: existing?.notes ?? "",
  };
  render();
}

export function cancelQaTermEditor(render) {
  state.qaTermEditor = createQaTermEditorState();
  render();
}

export function updateQaTermDraftField(field, value) {
  if (field !== "text" && field !== "notes") {
    return;
  }

  state.qaTermEditor = {
    ...state.qaTermEditor,
    [field]: value,
    error: "",
  };
}

function persistQaListEditorTerms(terms) {
  const qaListId = state.qaListEditor.qaListId;
  const now = new Date().toISOString();
  const team = currentQaListTeam();
  const currentQueryData = ensureQaListsQueryDataForTeam(team);
  const nextQueryData = patchQaListQueryData(currentQueryData, qaListId, {
    terms,
    termCount: terms.length,
    updatedAt: now,
  });
  applyQaListsQueryDataForTeam(team, nextQueryData, null);
  removeQaListEditorQuery(team, state.qaListEditor);
  state.qaListEditor = {
    ...state.qaListEditor,
    terms,
    termCount: terms.length,
  };
  saveCurrentTeamQaLists();
}

export async function submitQaTermEditor(render) {
  const editor = state.qaTermEditor;
  const text = String(editor.text ?? "").trim();
  const notes = String(editor.notes ?? "").trim();
  if (!text) {
    state.qaTermEditor = {
      ...editor,
      error: "Enter QA term text.",
    };
    render();
    return;
  }
  if (qaTermTextDuplicatesExistingTerm(text, state.qaListEditor.terms, editor.termId)) {
    state.qaTermEditor = qaTermDuplicateErrorState(editor);
    render();
    return;
  }

  const team = currentQaListTeam();
  const qaList = selectedQaList();
  const policy = getQaListWritePolicy({ team, qaList });
  if (!policy.allowed) {
    state.qaTermEditor = {
      ...editor,
      error: policy.message,
    };
    render();
    return;
  }
  beginQaTermWrite();
  try {
    if (teamSupportsQaListRepos(team) && qaList?.repoName) {
      const previousTerm = editor.termId
        ? (state.qaListEditor.terms ?? []).find((term) => term.termId === editor.termId)
        : null;
      const latestQaList = await syncAndRefreshQaListEditorSnapshot(team, qaList);
      if (!selectedQaListEditorMatches(team, qaList)) {
        return;
      }
      if (editor.termId) {
        const latestTerm = (latestQaList.terms ?? []).find((term) => term.termId === editor.termId);
        if (!latestTerm) {
          state.qaTermEditor = {
            ...editor,
            error: "This QA term was deleted on GitHub. Review the current QA list before saving.",
          };
          render();
          return;
        }
        if (previousTerm && !qaTermRecordsMatch(previousTerm, latestTerm)) {
          state.qaTermEditor = {
            ...editor,
            error: "This QA term changed on GitHub. Review the latest version before saving.",
          };
          render();
          return;
        }
      }
      if (qaTermTextDuplicatesExistingTerm(text, latestQaList.terms, editor.termId)) {
        state.qaTermEditor = qaTermDuplicateErrorState(editor);
        render();
        return;
      }

      let response = null;
      let previousHeadSha = null;
      try {
        response = await invoke("upsert_gtms_qa_list_term", {
          input: {
            ...repoBackedQaListInput(team, qaList),
            termId: editor.termId,
            text,
            notes,
          },
        });
        previousHeadSha = response?.previousHeadSha ?? null;
        await syncSingleQaListOrThrow(team, qaList);
      } catch (error) {
        const rollbackMessage = await rollbackQaTermSave(
          team,
          qaList,
          previousHeadSha,
          error?.message ?? String(error),
        );
        throw new Error(rollbackMessage);
      }

      if (!selectedQaListEditorMatches(team, qaList)) {
        return;
      }
      const nextTerm = normalizeQaTerm(response.term);
      const terms = Array.isArray(state.qaListEditor.terms) ? state.qaListEditor.terms : [];
      const nextTerms = editor.termId
        ? terms.map((term) => (term.termId === editor.termId ? nextTerm : term))
        : [...terms, nextTerm];
      persistQaListEditorTerms(nextTerms.filter(Boolean));
    } else {
      const nextTerm = normalizeQaTerm({
        termId: editor.termId ?? createQaResourceId("qa-term"),
        text,
        notes,
      });
      const terms = Array.isArray(state.qaListEditor.terms) ? state.qaListEditor.terms : [];
      const nextTerms = editor.termId
        ? terms.map((term) => (term.termId === editor.termId ? nextTerm : term))
        : [...terms, nextTerm];

      persistQaListEditorTerms(nextTerms.filter(Boolean));
    }
    state.qaTermEditor = createQaTermEditorState();
  } catch (error) {
    state.qaTermEditor = {
      ...editor,
      error: error?.message ?? "Could not save this QA term.",
    };
  } finally {
    endQaTermWrite();
  }
  render();
}

export async function deleteQaTerm(render, termId) {
  const team = currentQaListTeam();
  const qaList = selectedQaList();
  const policy = getQaListWritePolicy({ team, qaList });
  if (!policy.allowed) {
    state.qaListEditor = {
      ...state.qaListEditor,
      status: "error",
      error: policy.message,
    };
    render();
    return;
  }
  beginQaTermWrite();
  try {
    if (teamSupportsQaListRepos(team) && qaList?.repoName) {
      await syncAndRefreshQaListEditorSnapshot(team, qaList);
      if (!selectedQaListEditorMatches(team, qaList)) {
        return;
      }

      let response = null;
      let previousHeadSha = null;
      try {
        response = await invoke("delete_gtms_qa_list_term", {
          input: {
            ...repoBackedQaListInput(team, qaList),
            termId,
          },
        });
        previousHeadSha = response?.previousHeadSha ?? null;
        await syncSingleQaListOrThrow(team, qaList);
      } catch (error) {
        const rollbackMessage = await rollbackQaTermSave(
          team,
          qaList,
          previousHeadSha,
          error?.message ?? String(error),
        );
        throw new Error(rollbackMessage);
      }
      if (!selectedQaListEditorMatches(team, qaList)) {
        return;
      }
    }
    const terms = (state.qaListEditor.terms ?? []).filter((term) => term.termId !== termId);
    persistQaListEditorTerms(terms);
  } catch (error) {
    state.qaListEditor = {
      ...state.qaListEditor,
      status: "error",
      error: error?.message ?? "Could not delete this QA term.",
    };
  } finally {
    endQaTermWrite();
  }
  render();
}

export { qaListTermWriteIsActive };
