import { findIsoLanguageOption } from "../lib/language-options.js";
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
