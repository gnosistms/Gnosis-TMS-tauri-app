import { findIsoLanguageOption } from "../lib/language-options.js";
import {
  canCreateRepoResources,
  canPermanentlyDeleteRepoResources,
} from "./resource-capabilities.js";
import { state } from "./state.js";

function normalizeId(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function createFallbackId() {
  return globalThis.crypto?.randomUUID?.() ?? `qa-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizeLanguage(value) {
  const code = String(value?.code ?? value?.languageCode ?? "").trim();
  const option = findIsoLanguageOption(code);
  if (option) {
    return { code: option.code, name: option.name };
  }

  return code
    ? { code, name: String(value?.name ?? code).trim() || code }
    : null;
}

export function selectedTeam() {
  return state.teams.find((team) => team.id === state.selectedTeamId) ?? state.teams[0] ?? null;
}

export function canManageQaLists(team = selectedTeam()) {
  return team?.canDelete === true;
}

export function canCreateQaLists(team = selectedTeam()) {
  return canCreateRepoResources(team);
}

export function canPermanentlyDeleteQaLists(team = selectedTeam()) {
  return canPermanentlyDeleteRepoResources(team);
}

export function normalizeQaTerm(value) {
  const termId = normalizeId(value?.termId ?? value?.id, createFallbackId());
  const text = String(value?.text ?? value?.term ?? "").trim();
  const notes = String(value?.notes ?? value?.note ?? "").trim();

  if (!text && !notes) {
    return null;
  }

  return {
    termId,
    text,
    notes,
  };
}

export function normalizeQaList(value) {
  const id = normalizeId(value?.id ?? value?.qaListId);
  const title = String(value?.title ?? value?.name ?? "").trim();
  const language = normalizeLanguage(value?.language ?? value);
  if (!id || !title || !language) {
    return null;
  }

  const terms = (Array.isArray(value?.terms) ? value.terms : [])
    .map(normalizeQaTerm)
    .filter(Boolean);
  const lifecycleState = value?.lifecycleState === "deleted" ? "deleted" : "active";
  const termCount = Number.isFinite(value?.termCount) ? value.termCount : terms.length;

  const normalized = {
    id,
    qaListId: id,
    title,
    language,
    lifecycleState,
    termCount,
    repoName: String(value?.repoName ?? value?.name ?? "").trim(),
    repoId: Number.isFinite(value?.repoId) ? value.repoId : null,
    nodeId: String(value?.nodeId ?? "").trim() || null,
    fullName: String(value?.fullName ?? "").trim() || null,
    htmlUrl: String(value?.htmlUrl ?? "").trim() || "",
    remoteState: String(value?.remoteState ?? "linked").trim() || "linked",
    recordState: String(value?.recordState ?? "live").trim() || "live",
    resolutionState: String(value?.resolutionState ?? "").trim(),
    repairIssueType: String(value?.repairIssueType ?? "").trim(),
    repairIssueMessage: String(value?.repairIssueMessage ?? "").trim(),
    defaultBranchName: String(value?.defaultBranchName ?? value?.defaultBranch ?? "main").trim() || "main",
    defaultBranchHeadOid: String(value?.defaultBranchHeadOid ?? "").trim() || null,
    createdAt: String(value?.createdAt ?? "").trim() || new Date().toISOString(),
    updatedAt: String(value?.updatedAt ?? "").trim() || new Date().toISOString(),
    terms,
  };
  if (typeof value?.pendingMutation === "string" || value?.pendingMutation === null) {
    normalized.pendingMutation = value.pendingMutation;
  }
  if (typeof value?.localLifecycleIntent === "string" || value?.localLifecycleIntent === null) {
    normalized.localLifecycleIntent = value.localLifecycleIntent;
  }
  return normalized;
}

export function sortQaLists(qaLists = []) {
  return [...qaLists].sort((left, right) => {
    const stateCompare = String(left.lifecycleState ?? "active").localeCompare(String(right.lifecycleState ?? "active"));
    if (stateCompare !== 0) {
      return stateCompare;
    }

    const languageCompare = String(left.language?.name ?? "").localeCompare(String(right.language?.name ?? ""));
    if (languageCompare !== 0) {
      return languageCompare;
    }

    return String(left.title ?? "").localeCompare(String(right.title ?? ""));
  });
}

export function selectedQaList() {
  return state.qaLists.find((qaList) => qaList.id === state.selectedQaListId) ?? null;
}

export function selectedQaListRepoName() {
  return String(selectedQaList()?.repoName ?? state.qaListEditor?.repoName ?? "").trim();
}

export function applyQaListEditorPayload(payload) {
  const payloadQaListId = payload?.qaListId ?? payload?.id ?? null;
  const existingSummary =
    selectedQaList()
    ?? state.qaLists.find((qaList) =>
      qaList?.id === payloadQaListId
      || qaList?.repoName === (state.qaListEditor?.repoName || selectedQaListRepoName())
    )
    ?? null;
  const repoName = state.qaListEditor?.repoName || existingSummary?.repoName || selectedQaListRepoName();
  const repoId =
    Number.isFinite(state.qaListEditor?.repoId)
      ? state.qaListEditor.repoId
      : Number.isFinite(existingSummary?.repoId)
        ? existingSummary.repoId
        : null;
  const fullName = state.qaListEditor?.fullName || existingSummary?.fullName || "";
  const defaultBranchName =
    state.qaListEditor?.defaultBranchName
    || existingSummary?.defaultBranchName
    || "main";
  const defaultBranchHeadOid =
    state.qaListEditor?.defaultBranchHeadOid
    ?? existingSummary?.defaultBranchHeadOid
    ?? null;
  const normalizedTerms = (Array.isArray(payload?.terms) ? payload.terms : [])
    .map(normalizeQaTerm)
    .filter(Boolean);

  const summary = normalizeQaList({
    qaListId: payloadQaListId,
    repoName,
    repoId,
    fullName,
    defaultBranchName,
    defaultBranchHeadOid,
    title: payload?.title,
    language: payload?.language ?? null,
    lifecycleState: payload?.lifecycleState,
    termCount: Number.isFinite(payload?.termCount) ? payload.termCount : normalizedTerms.length,
    terms: normalizedTerms,
  });

  state.qaListEditor = {
    status: "ready",
    error: "",
    navigationSource: state.qaListEditor?.navigationSource ?? null,
    qaListId: payloadQaListId,
    repoName,
    repoId,
    fullName,
    defaultBranchName,
    defaultBranchHeadOid,
    title: payload.title ?? "",
    lifecycleState:
      payload.lifecycleState === "deleted" || payload.lifecycleState === "softDeleted"
        ? "deleted"
        : "active",
    language: payload.language ?? null,
    termCount: Number.isFinite(payload.termCount) ? payload.termCount : normalizedTerms.length,
    searchQuery: state.qaListEditor?.searchQuery ?? "",
    terms: normalizedTerms,
  };

  if (summary) {
    upsertQaList(summary);
  }
}

export function upsertQaList(qaList) {
  const normalized = normalizeQaList(qaList);
  if (!normalized) {
    return;
  }

  const existingIndex = state.qaLists.findIndex((item) => item.id === normalized.id);
  if (existingIndex >= 0) {
    state.qaLists = sortQaLists(
      state.qaLists.map((item) => (item.id === normalized.id ? normalized : item)),
    );
    return;
  }

  state.qaLists = sortQaLists([...state.qaLists, normalized]);
}
