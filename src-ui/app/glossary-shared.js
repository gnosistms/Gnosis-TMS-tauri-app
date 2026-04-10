import { state } from "./state.js";
import {
  canCreateRepoResources,
  canPermanentlyDeleteRepoResources,
} from "./resource-capabilities.js";

export function selectedTeam(teamId = state.selectedTeamId) {
  return state.teams.find((team) => team.id === teamId) ?? null;
}

export function canManageGlossaries(team = selectedTeam()) {
  return team?.canManageProjects === true;
}

export function canCreateGlossaries(team = selectedTeam()) {
  return canCreateRepoResources(team);
}

export function canPermanentlyDeleteGlossaries(team = selectedTeam()) {
  return canPermanentlyDeleteRepoResources(team);
}

export function sortGlossaries(glossaries) {
  return [...(Array.isArray(glossaries) ? glossaries : [])].sort((left, right) =>
    String(left?.title ?? "")
      .toLowerCase()
      .localeCompare(String(right?.title ?? "").toLowerCase())
      || String(left?.repoName ?? "").localeCompare(String(right?.repoName ?? "")),
  );
}

export function selectedGlossary() {
  return state.glossaries.find((glossary) => glossary.id === state.selectedGlossaryId) ?? null;
}

export function selectedGlossaryRepoName() {
  return state.glossaryEditor?.repoName || selectedGlossary()?.repoName || "";
}

export function normalizeGlossarySummary(glossary) {
  if (!glossary || typeof glossary !== "object") {
    return null;
  }

  const id =
    typeof glossary.glossaryId === "string" && glossary.glossaryId.trim()
      ? glossary.glossaryId.trim()
      : typeof glossary.id === "string" && glossary.id.trim()
        ? glossary.id.trim()
      : null;
  const repoName =
    typeof glossary.repoName === "string" && glossary.repoName.trim()
      ? glossary.repoName.trim()
      : null;
  const title =
    typeof glossary.title === "string" && glossary.title.trim()
      ? glossary.title.trim()
      : null;
  if (!id || !repoName || !title) {
    return null;
  }

  const isDeletedLifecycleState =
    glossary.lifecycleState === "deleted" || glossary.lifecycleState === "softDeleted";

  return {
    id,
    repoName,
    title,
    repoId: Number.isFinite(glossary.repoId) ? glossary.repoId : null,
    nodeId:
      typeof glossary.nodeId === "string" && glossary.nodeId.trim()
        ? glossary.nodeId.trim()
        : null,
    sourceLanguage: glossary.sourceLanguage ?? null,
    targetLanguage: glossary.targetLanguage ?? null,
    lifecycleState: isDeletedLifecycleState ? "deleted" : "active",
    remoteState:
      typeof glossary.remoteState === "string" && glossary.remoteState.trim()
        ? glossary.remoteState.trim()
        : "linked",
    recordState:
      typeof glossary.recordState === "string" && glossary.recordState.trim()
        ? glossary.recordState.trim()
        : "live",
    resolutionState:
      typeof glossary.resolutionState === "string" && glossary.resolutionState.trim()
        ? glossary.resolutionState.trim()
        : "",
    repairIssueType:
      typeof glossary.repairIssueType === "string" && glossary.repairIssueType.trim()
        ? glossary.repairIssueType.trim()
        : "",
    repairIssueMessage:
      typeof glossary.repairIssueMessage === "string" && glossary.repairIssueMessage.trim()
        ? glossary.repairIssueMessage.trim()
        : "",
    deletedAt:
      typeof glossary.deletedAt === "string" && glossary.deletedAt.trim()
        ? glossary.deletedAt.trim()
        : null,
    termCount: Number.isFinite(glossary.termCount) ? glossary.termCount : 0,
    fullName:
      typeof glossary.fullName === "string" && glossary.fullName.trim()
        ? glossary.fullName.trim()
        : "",
    htmlUrl:
      typeof glossary.htmlUrl === "string" && glossary.htmlUrl.trim()
        ? glossary.htmlUrl.trim()
        : "",
    defaultBranchName:
      typeof glossary.defaultBranchName === "string" && glossary.defaultBranchName.trim()
        ? glossary.defaultBranchName.trim()
        : "main",
    defaultBranchHeadOid:
      typeof glossary.defaultBranchHeadOid === "string" && glossary.defaultBranchHeadOid.trim()
        ? glossary.defaultBranchHeadOid.trim()
        : null,
  };
}

export function normalizeGlossaryTerm(term) {
  if (!term || typeof term !== "object") {
    return null;
  }
  const termId =
    typeof term.termId === "string" && term.termId.trim()
      ? term.termId.trim()
      : null;
  if (!termId) {
    return null;
  }

  const isDeletedLifecycleState =
    term.lifecycleState === "deleted" || term.lifecycleState === "softDeleted";

  return {
    termId,
    sourceTerms: Array.isArray(term.sourceTerms) ? term.sourceTerms : [],
    targetTerms: Array.isArray(term.targetTerms) ? term.targetTerms : [],
    notesToTranslators:
      typeof term.notesToTranslators === "string" ? term.notesToTranslators : "",
    footnote: typeof term.footnote === "string" ? term.footnote : "",
    untranslated: term.untranslated === true,
    lifecycleState: isDeletedLifecycleState ? "deleted" : "active",
  };
}

export function applyGlossaryEditorPayload(payload) {
  const normalizedTerms = (Array.isArray(payload?.terms) ? payload.terms : [])
    .map(normalizeGlossaryTerm)
    .filter(Boolean);

  const summary = normalizeGlossarySummary({
    glossaryId: payload?.glossaryId,
    repoName: state.glossaryEditor?.repoName || selectedGlossaryRepoName(),
    title: payload?.title,
    sourceLanguage: payload?.sourceLanguage ?? null,
    targetLanguage: payload?.targetLanguage ?? null,
    lifecycleState: payload?.lifecycleState,
    termCount: Number.isFinite(payload?.termCount) ? payload.termCount : normalizedTerms.length,
  });

  state.glossaryEditor = {
    status: "ready",
    error: "",
    glossaryId: payload.glossaryId,
    repoName: selectedGlossaryRepoName(),
    title: payload.title ?? "",
    lifecycleState:
      payload.lifecycleState === "deleted" || payload.lifecycleState === "softDeleted"
        ? "deleted"
        : "active",
    sourceLanguage: payload.sourceLanguage ?? null,
    targetLanguage: payload.targetLanguage ?? null,
    termCount: Number.isFinite(payload.termCount) ? payload.termCount : normalizedTerms.length,
    searchQuery: state.glossaryEditor?.searchQuery ?? "",
    terms: normalizedTerms,
  };

  if (summary) {
    upsertGlossarySummary(summary);
  }
}

export function upsertGlossarySummary(glossary) {
  const normalized = normalizeGlossarySummary(glossary);
  if (!normalized) {
    return null;
  }

  let matched = false;
  state.glossaries = sortGlossaries(
    state.glossaries
      .map((item) => {
        if (item?.id !== normalized.id && item?.repoName !== normalized.repoName) {
          return item;
        }

        matched = true;
        return {
          ...item,
          ...normalized,
        };
      })
      .concat(matched ? [] : [normalized]),
  );

  return normalized;
}

export function normalizeEditableTerms(terms) {
  const normalized = (Array.isArray(terms) ? terms : [])
    .map((term) => (typeof term === "string" ? term : ""));

  return normalized.length > 0 ? normalized : [""];
}

export function sanitizeEditableTerms(terms) {
  return (Array.isArray(terms) ? terms : [])
    .map((term) => String(term ?? "").trim())
    .filter(Boolean);
}

export function sanitizeEditableTargetTerms(terms) {
  const sanitized = [];
  const seen = new Set();
  let includedEmptyVariant = false;

  for (const term of Array.isArray(terms) ? terms : []) {
    const trimmed = String(term ?? "").trim();
    if (!trimmed) {
      if (!includedEmptyVariant) {
        sanitized.push("");
        includedEmptyVariant = true;
      }
      continue;
    }

    if (seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    sanitized.push(trimmed);
  }

  return sanitized;
}

export function updateGlossaryTermArray(side, updater) {
  if (!state.glossaryTermEditor?.isOpen) {
    return;
  }

  const field = side === "target" ? "targetTerms" : "sourceTerms";
  const currentTerms = normalizeEditableTerms(state.glossaryTermEditor[field]);
  const nextTerms = normalizeEditableTerms(updater(currentTerms));

  state.glossaryTermEditor[field] = nextTerms;
  if (state.glossaryTermEditor.error) {
    state.glossaryTermEditor.error = "";
  }
}
