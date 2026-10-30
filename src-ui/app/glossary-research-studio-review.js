import { witnessedSplitForms, sourceCollisions, meaningTrialsAreCurrent, entryTrialsAreCurrent, STUDIO_DICTIONARY_REVIEW_VERSION } from "./glossary-research-studio-workflow.js";

function retrievalFailed(value) {
  if (!value || typeof value !== "object") return false;
  if (["unreachable", "failed", "error", "incomplete"].includes(value.status)) return true;
  return Object.values(value).some(retrievalFailed);
}

// Steps that only report findings continue on their own; the translator can
// reopen them from the outline. Steps wait only for a decision. Missing/old
// payloads and failed retrievals cannot silently become approval to continue.
export function studioStepNeedsReview(study, step, result, entries = []) {
  if (study.pendingDecision || study.error || result?.pending || retrievalFailed(result)) return true;
  if (step === "10b") return sourceCollisions(study, entries).length > 0;
  if (!result || result._studioArtifact) return true;
  if (result.skipped === true) return !["2a", "4.1", "4.3", "4.4.1", "4.4.2", "4.4.4", "5"].includes(step);
  switch (step) {
    case "2b": return !Array.isArray(result.entries) || result.entries.length > 0 || (study.relatedEntries?.length ?? 0) > 0;
    case "3": return !Number.isInteger(result.paragraphs) || result.paragraphs <= 0;
    case "4.1": return result.dictionaryVersion !== STUDIO_DICTIONARY_REVIEW_VERSION || !Array.isArray(result.meanings);
    case "4.2": case "4.4.1": case "4.4.2": case "4.4.4": return !Array.isArray(result.meanings);
    case "4.3": return !Array.isArray(result.parts);
    case "4.7": {
      if (!Array.isArray(result.proposals)) return true;
      return result.proposals.some((proposal) => witnessedSplitForms(study, proposal).length > 0);
    }
    case "5": return !Array.isArray(result.compounds);
    case "7": return !Array.isArray(result.decisions);
    case "8": case "9": return result.complete !== true || study.assignmentReviewPending
      || Object.entries(study.rounds ?? {}).some(([key, rounds]) => key.startsWith(`${step}:`) && rounds > 0)
      || Object.values(study.reports ?? {}).some((report) => report.kind === "usage-notes" && report.step === step)
      || !(step === "8" ? meaningTrialsAreCurrent(study) : entryTrialsAreCurrent(study));
    default: return true;
  }
}
