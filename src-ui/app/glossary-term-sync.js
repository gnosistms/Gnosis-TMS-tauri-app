import { normalizeGlossaryTerm, selectedGlossaryRepoName, selectedTeam } from "./glossary-shared.js";
import { createRepoResourceTermSync } from "./repo-resource/term-sync.js";

const glossaryTermSync = createRepoResourceTermSync({
  editorField: "glossaryEditor",
  normalizeTerm: normalizeGlossaryTerm,
  selectedRepoName: selectedGlossaryRepoName,
  selectedTeam,
  loadTermCommand: "load_gtms_glossary_term",
  buildTermFields(draftSnapshot) {
    return {
      sourceTerms: Array.isArray(draftSnapshot?.sourceTerms) ? draftSnapshot.sourceTerms : [],
      targetTerms: Array.isArray(draftSnapshot?.targetTerms) ? draftSnapshot.targetTerms : [],
      targetVariantNotes: Array.isArray(draftSnapshot?.targetVariantNotes)
        ? draftSnapshot.targetVariantNotes
        : [],
      notesToTranslators:
        typeof draftSnapshot?.notesToTranslators === "string"
          ? draftSnapshot.notesToTranslators
          : "",
      footnote: typeof draftSnapshot?.footnote === "string" ? draftSnapshot.footnote : "",
      untranslated: draftSnapshot?.untranslated === true,
    };
  },
  termNoun: "term",
});

export const findGlossaryTermById = glossaryTermSync.findTermById;
export const buildGlossaryTermFromDraft = glossaryTermSync.buildTermFromDraft;
export const upsertVisibleGlossaryTerm = glossaryTermSync.upsertVisibleTerm;
export const replaceOptimisticGlossaryTerm = glossaryTermSync.replaceOptimisticTerm;
export const markVisibleGlossaryTermConfirmed = glossaryTermSync.markVisibleTermConfirmed;
export const markVisibleGlossaryTermFailed = glossaryTermSync.markVisibleTermFailed;
export const removeVisibleGlossaryTerm = glossaryTermSync.removeVisibleTerm;
export const applyGlossaryTermsStale = glossaryTermSync.applyTermsStale;
export const markGlossaryTermsStale = glossaryTermSync.markTermsStale;
export const loadGlossaryTermFromDisk = glossaryTermSync.loadTermFromDisk;
export const ensureGlossaryTermReadyForEdit = glossaryTermSync.ensureTermReadyForEdit;
