import { normalizeQaTerm, selectedQaListRepoName, selectedTeam } from "./qa-list-shared.js";
import { createRepoResourceTermSync } from "./repo-resource/term-sync.js";

const qaTermSync = createRepoResourceTermSync({
  editorField: "qaListEditor",
  normalizeTerm: normalizeQaTerm,
  selectedRepoName: selectedQaListRepoName,
  selectedTeam,
  loadTermCommand: "load_gtms_qa_list_term",
  buildTermFields(draftSnapshot) {
    return {
      text: typeof draftSnapshot?.text === "string" ? draftSnapshot.text : "",
      notes: typeof draftSnapshot?.notes === "string" ? draftSnapshot.notes : "",
    };
  },
  termNoun: "QA term",
});

export const findQaTermById = qaTermSync.findTermById;
export const buildQaTermFromDraft = qaTermSync.buildTermFromDraft;
export const upsertVisibleQaTerm = qaTermSync.upsertVisibleTerm;
export const replaceOptimisticQaTerm = qaTermSync.replaceOptimisticTerm;
export const markVisibleQaTermConfirmed = qaTermSync.markVisibleTermConfirmed;
export const markVisibleQaTermFailed = qaTermSync.markVisibleTermFailed;
export const removeVisibleQaTerm = qaTermSync.removeVisibleTerm;
export const applyQaTermsStale = qaTermSync.applyTermsStale;
export const markQaTermsStale = qaTermSync.markTermsStale;
export const loadQaTermFromDisk = qaTermSync.loadTermFromDisk;
export const ensureQaTermReadyForEdit = qaTermSync.ensureTermReadyForEdit;
