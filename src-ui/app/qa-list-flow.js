import {
  createQaListCreationState,
  createQaListDiscoveryState,
  createQaListEditorState,
  createQaListPermanentDeletionState,
  createQaListRenameState,
  createQaTermEditorState,
  state,
} from "./state.js";
import { requireBrokerSession } from "./auth-flow.js";
import { findIsoLanguageOption } from "../lib/language-options.js";
import { saveStoredQaListsForTeam } from "./qa-list-cache.js";
import {
  applyQaListsQuerySnapshotToState,
  createQaListPermanentDeleteMutationOptions,
  createQaListRenameMutationOptions,
  createQaListRestoreMutationOptions,
  createQaListSoftDeleteMutationOptions,
  createQaListsQueryOptions,
  createQaListsQuerySnapshot,
  ensureQaListsQueryObserver,
  patchQaListQueryData,
  persistQaListsQueryDataForTeam,
  seedQaListsQueryFromCache,
  upsertQaListQueryData,
} from "./qa-list-query.js";
import {
  createRemoteQaListRepo,
  deleteRemoteQaListRepo,
  getQaListSyncIssueMessage,
  prepareLocalQaListRepo,
  qaListRepoDescriptor,
  syncSingleQaListForTeam,
  syncQaListReposForTeam,
  teamSupportsQaListRepos,
} from "./qa-list-repo-flow.js";
import {
  normalizeQaList,
  normalizeQaTerm,
  selectedQaList,
  selectedTeam,
} from "./qa-list-shared.js";
import {
  makeQaListDefaultIfFirst,
  updateDefaultQaListAfterDeletion,
} from "./qa-list-default-flow.js";
import { invoke } from "./runtime.js";
import { createMutationObserver, qaListKeys, queryClient } from "./query-client.js";
import { setResourcePageRefreshing } from "./resource-page-controller.js";

export { makeQaListDefault } from "./qa-list-default-flow.js";

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function currentTeam() {
  return selectedTeam();
}

function selectedTeamMatches(team) {
  const selected = currentTeam();
  return Boolean(
    team
      && selected
      && selected.id === team.id
      && selected.installationId === team.installationId,
  );
}

function selectedQaListEditorMatches(team, qaList) {
  return Boolean(
    selectedTeamMatches(team)
      && qaList?.id
      && state.screen === "qaListEditor"
      && state.selectedQaListId === qaList.id
      && state.qaListEditor?.qaListId === qaList.id,
  );
}

function ensureQaListsQueryDataForTeam(team) {
  if (!team?.id) {
    return null;
  }
  const queryKey = qaListKeys.byTeam(team.id);
  let queryData = queryClient.getQueryData(queryKey);
  if (!queryData) {
    queryData = createQaListsQuerySnapshot({
      qaLists: state.qaLists,
      discovery: state.qaListDiscovery,
    });
    queryClient.setQueryData(queryKey, queryData);
  }
  return queryData;
}

function applyQaListsQueryDataForTeam(team, queryData, render, { isFetching = false } = {}) {
  if (!team?.id || !queryData) {
    return null;
  }
  queryClient.setQueryData(qaListKeys.byTeam(team.id), queryData);
  applyQaListsQuerySnapshotToState(queryData, {
    teamId: team.id,
    isFetching,
  });
  persistQaListsQueryDataForTeam(team, queryData);
  render?.();
  return queryData;
}

function upsertQaListForTeam(team, qaList, render, options = {}) {
  const currentQueryData = ensureQaListsQueryDataForTeam(team);
  const existingQaLists = Array.isArray(currentQueryData?.qaLists) ? currentQueryData.qaLists : [];
  const shouldPreserveCreate =
    options.preserveCreate === true
    && !existingQaLists.some((item) => item?.id === qaList?.id);
  const nextQueryData = upsertQaListQueryData(currentQueryData, {
    ...qaList,
    ...(shouldPreserveCreate
      ? {
          localLifecycleIntent: "create",
          pendingMutation: null,
        }
      : {}),
  });
  return applyQaListsQueryDataForTeam(team, nextQueryData, render);
}

function saveCurrentTeamQaLists() {
  const team = currentTeam();
  if (team) {
    saveStoredQaListsForTeam(team, state.qaLists);
  }
}

function repoBackedQaListInput(team, qaList) {
  return {
    installationId: team.installationId,
    repoName: qaList.repoName,
    qaListId: qaList.id,
  };
}

function repoBackedQaTermRollbackInput(team, qaList, previousHeadSha) {
  return {
    ...repoBackedQaListInput(team, qaList),
    previousHeadSha,
  };
}

function triggerQaListRepoSync(team, qaListOrRepo) {
  if (!teamSupportsQaListRepos(team)) {
    return;
  }

  const repo = qaListOrRepo?.fullName
    ? {
        qaListId: qaListOrRepo.id ?? qaListOrRepo.qaListId ?? null,
        name: qaListOrRepo.repoName ?? qaListOrRepo.name,
        fullName: qaListOrRepo.fullName,
        repoId: Number.isFinite(qaListOrRepo.repoId) ? qaListOrRepo.repoId : null,
        defaultBranchName: qaListOrRepo.defaultBranchName || "main",
        defaultBranchHeadOid: qaListOrRepo.defaultBranchHeadOid || null,
      }
    : null;
  if (!repo?.name || !repo.fullName) {
    return;
  }

  void syncQaListReposForTeam(team, [repo]).catch(() => null);
}

async function commitQaListLifecycleMutation(team, mutation) {
  const qaList = state.qaLists.find((item) => item.id === mutation.qaListId);
  if (!qaList) {
    throw new Error("Could not find the selected QA list.");
  }

  if (teamSupportsQaListRepos(team) && qaList.repoName) {
    if (mutation.type === "rename") {
      const summary = await invoke("rename_gtms_qa_list", {
        input: {
          ...repoBackedQaListInput(team, qaList),
          title: mutation.title,
        },
      });
      triggerQaListRepoSync(team, qaList);
      return summary;
    }

    if (mutation.type === "softDelete") {
      const summary = await invoke("soft_delete_gtms_qa_list", {
        input: repoBackedQaListInput(team, qaList),
      });
      triggerQaListRepoSync(team, qaList);
      return summary;
    }

    if (mutation.type === "restore") {
      const summary = await invoke("restore_gtms_qa_list", {
        input: repoBackedQaListInput(team, qaList),
      });
      triggerQaListRepoSync(team, qaList);
      return summary;
    }
  }

  const updatedAt = new Date().toISOString();
  if (mutation.type === "rename") {
    return { title: mutation.title, updatedAt };
  }
  if (mutation.type === "softDelete") {
    return { lifecycleState: "deleted", updatedAt };
  }
  if (mutation.type === "restore") {
    return { lifecycleState: "active", updatedAt };
  }
  return {};
}

async function syncSingleQaListOrThrow(team, qaList) {
  const syncIssue = getQaListSyncIssueMessage(await syncSingleQaListForTeam(team, qaList));
  if (syncIssue.message) {
    throw new Error(syncIssue.message);
  }
}

function qaTermRecordsMatch(left, right) {
  return (
    String(left?.termId ?? "") === String(right?.termId ?? "")
    && String(left?.text ?? "") === String(right?.text ?? "")
    && String(left?.notes ?? "") === String(right?.notes ?? "")
    && String(left?.lifecycleState ?? "active") === String(right?.lifecycleState ?? "active")
  );
}

async function loadRepoBackedQaListEditorSnapshot(team, qaList) {
  const response = await invoke("load_gtms_qa_list_editor_data", {
    input: repoBackedQaListInput(team, qaList),
  });
  return normalizeQaList({ ...qaList, ...response });
}

function applyQaListEditorSnapshot(team, qaList, normalized) {
  if (!selectedQaListEditorMatches(team, qaList)) {
    return false;
  }

  state.qaListEditor = {
    ...state.qaListEditor,
    status: "ready",
    qaListId: normalized.id,
    title: normalized.title,
    lifecycleState: normalized.lifecycleState,
    language: normalized.language,
    termCount: normalized.termCount,
    repoName: normalized.repoName,
    fullName: normalized.fullName,
    repoId: normalized.repoId,
    defaultBranchName: normalized.defaultBranchName,
    defaultBranchHeadOid: normalized.defaultBranchHeadOid,
    terms: normalized.terms ?? [],
    error: "",
  };
  upsertQaListForTeam(team, normalized);
  return true;
}

async function syncAndRefreshQaListEditorSnapshot(team, qaList) {
  await syncSingleQaListOrThrow(team, qaList);
  const normalized = await loadRepoBackedQaListEditorSnapshot(team, qaList);
  applyQaListEditorSnapshot(team, qaList, normalized);
  return normalized;
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

function qaListCreationRollbackMessage(error, rollbackError) {
  return `${error?.message ?? String(error)} Automatic QA list create rollback also failed: ${
    rollbackError?.message ?? String(rollbackError)
  }`;
}

export function primeQaListsLoadingState(teamId, options = {}) {
  const team = state.teams.find((item) => item.id === teamId) ?? currentTeam();
  if (!team) {
    state.qaLists = [];
    setResourcePageRefreshing(state.qaListsPage, false);
    state.qaListDiscovery = {
      ...createQaListDiscoveryState(),
      status: "ready",
    };
    return;
  }

  const seededSnapshot = seedQaListsQueryFromCache(team, {
    teamId: team.id,
  });
  if (seededSnapshot) {
    return;
  }

  if (options.preserveVisibleData === true && state.qaLists.length > 0) {
    setResourcePageRefreshing(state.qaListsPage, true);
    state.qaListDiscovery = {
      status: "loading",
      error: "",
      recoveryMessage: "",
    };
    return;
  }

  state.qaLists = [];
  setResourcePageRefreshing(state.qaListsPage, true);
  state.qaListDiscovery = {
    status: "loading",
    error: "",
    recoveryMessage: "",
  };
}

export async function loadTeamQaLists(render, teamId) {
  const team = state.teams.find((item) => item.id === teamId) ?? currentTeam();
  if (!team) {
    state.qaLists = [];
    setResourcePageRefreshing(state.qaListsPage, false);
    state.qaListDiscovery = {
      status: "ready",
      error: "",
      recoveryMessage: "",
    };
    render();
    return;
  }

  primeQaListsLoadingState(team.id, { preserveVisibleData: true });
  setResourcePageRefreshing(state.qaListsPage, true);
  render();

  try {
    ensureQaListsQueryObserver(render, team, { teamId: team.id });
    const querySnapshot = await queryClient.fetchQuery(createQaListsQueryOptions(team, {
      teamId: team.id,
    }));
    if (!selectedTeamMatches(team)) {
      return;
    }
    applyQaListsQueryDataForTeam(team, querySnapshot, null);
  } catch (error) {
    if (!selectedTeamMatches(team)) {
      return;
    }
    if (state.qaLists.length === 0) {
      state.qaListDiscovery = {
        status: "error",
        error: error?.message ?? "Could not load QA lists.",
        recoveryMessage: "",
      };
    }
  } finally {
    if (selectedTeamMatches(team)) {
      setResourcePageRefreshing(state.qaListsPage, false);
    }
  }
  render();
}

export function openQaListCreation(render) {
  state.qaListCreation = {
    ...createQaListCreationState(),
    isOpen: true,
  };
  render();
}

export function cancelQaListCreation(render) {
  state.qaListCreation = createQaListCreationState();
  render();
}

export function updateQaListCreationField(field, value) {
  if (field !== "title" && field !== "languageCode") {
    return;
  }

  state.qaListCreation = {
    ...state.qaListCreation,
    [field]: value,
    error: "",
  };
}

export async function submitQaListCreation(render) {
  const creation = state.qaListCreation;
  const title = String(creation.title ?? "").trim();
  const language = findIsoLanguageOption(creation.languageCode);
  if (!title) {
    state.qaListCreation = { ...creation, error: "Enter a QA list name." };
    render();
    return;
  }
  if (!language) {
    state.qaListCreation = { ...creation, error: "Choose a language." };
    render();
    return;
  }

  const team = currentTeam();
  let createdRemoteRepo = null;
  let localRepoInitialized = false;
  let createdQaListId = null;
  try {
    if (teamSupportsQaListRepos(team)) {
      const qaListId = globalThis.crypto?.randomUUID?.() ?? createId("qa-list");
      createdQaListId = qaListId;
      const remoteRepo = await createRemoteQaListRepo(team, title);
      createdRemoteRepo = remoteRepo;
      await prepareLocalQaListRepo(team, remoteRepo, qaListId);
      localRepoInitialized = true;
      const summary = await invoke("initialize_gtms_qa_list_repo", {
        input: {
          installationId: team.installationId,
          repoName: remoteRepo.name,
          qaListId,
          title,
          languageCode: language.code,
          languageName: language.name,
        },
      });
      if (!selectedTeamMatches(team)) {
        throw new Error("The selected team changed before the QA list could be created.");
      }
      const qaList = normalizeQaList({
        ...summary,
        repoId: remoteRepo.repoId ?? null,
        nodeId: remoteRepo.nodeId ?? null,
        fullName: remoteRepo.fullName ?? null,
        htmlUrl: remoteRepo.htmlUrl ?? "",
        defaultBranchName: remoteRepo.defaultBranchName ?? "main",
        defaultBranchHeadOid: remoteRepo.defaultBranchHeadOid ?? null,
      });
      await syncSingleQaListOrThrow(team, qaList);
      if (!selectedTeamMatches(team)) {
        throw new Error("The selected team changed before the QA list could be created.");
      }
      upsertQaListForTeam(team, qaList, null, { preserveCreate: true });
      makeQaListDefaultIfFirst(team, qaList);
      saveStoredQaListsForTeam(team, state.qaLists);
    } else {
      const now = new Date().toISOString();
      const qaList = {
        id: createId("qa-list"),
        title,
        language,
        lifecycleState: "active",
        createdAt: now,
        updatedAt: now,
        terms: [],
      };
      upsertQaListForTeam(team, qaList, null, { preserveCreate: true });
      makeQaListDefaultIfFirst(team, qaList);
      saveStoredQaListsForTeam(team, state.qaLists);
    }
    state.qaListCreation = createQaListCreationState();
    state.qaListDiscovery = { status: "ready", error: "", recoveryMessage: "" };
  } catch (error) {
    let message = error?.message ?? "Could not create this QA list.";
    if (localRepoInitialized && createdRemoteRepo?.name) {
      try {
        await invoke("purge_local_gtms_qa_list_repo", {
          input: {
            installationId: team.installationId,
            repoName: createdRemoteRepo.name,
            qaListId: createdQaListId,
          },
        });
      } catch {}
    }
    if (createdRemoteRepo?.name) {
      try {
        await deleteRemoteQaListRepo(team, { repoName: createdRemoteRepo.name });
      } catch (rollbackError) {
        message = qaListCreationRollbackMessage(error, rollbackError);
      }
    }
    state.qaListCreation = {
      ...creation,
      error: message,
    };
  }
  render();
}

export function openQaListRename(render, qaListId) {
  const qaList = state.qaLists.find((item) => item.id === qaListId);
  if (!qaList) {
    return;
  }

  state.qaListRename = {
    ...createQaListRenameState(),
    isOpen: true,
    qaListId: qaList.id,
    qaListName: qaList.title,
  };
  render();
}

export function cancelQaListRename(render) {
  state.qaListRename = createQaListRenameState();
  render();
}

export function updateQaListRenameName(value) {
  state.qaListRename = {
    ...state.qaListRename,
    qaListName: value,
    error: "",
  };
}

export async function submitQaListRename(render) {
  const rename = state.qaListRename;
  const title = String(rename.qaListName ?? "").trim();
  if (!title) {
    state.qaListRename = { ...rename, error: "Enter a QA list name." };
    render();
    return;
  }

  const team = currentTeam();
  const qaList = state.qaLists.find((item) => item.id === rename.qaListId);
  if (!team || !qaList) {
    state.qaListRename = {
      ...rename,
      error: "Could not find the selected QA list.",
    };
    render();
    return;
  }
  ensureQaListsQueryDataForTeam(team);
  try {
    await createMutationObserver(createQaListRenameMutationOptions({
      team,
      qaList,
      nextTitle: title,
      commitMutation: commitQaListLifecycleMutation,
      onOptimisticApplied: () => {
        if (state.qaListEditor.qaListId === rename.qaListId) {
          state.qaListEditor = {
            ...state.qaListEditor,
            title,
          };
        }
        state.qaListRename = createQaListRenameState();
      },
      onSuccessApplied: (queryData) => {
        persistQaListsQueryDataForTeam(team, queryData);
      },
      onErrorApplied: (error) => {
        state.qaListRename = {
          ...rename,
          error: error?.message ?? "Could not rename this QA list.",
        };
      },
      render,
    })).mutate();
  } catch (error) {
    state.qaListRename = {
      ...rename,
      error: error?.message ?? "Could not rename this QA list.",
    };
  }
  render();
}

export async function deleteQaList(render, qaListId) {
  const qaList = state.qaLists.find((item) => item.id === qaListId);
  if (!qaList) {
    return;
  }

  const team = currentTeam();
  if (!team) {
    state.qaListDiscovery = {
      status: "error",
      error: "Could not determine the selected team.",
      recoveryMessage: "",
    };
    render();
    return;
  }
  ensureQaListsQueryDataForTeam(team);
  try {
    await createMutationObserver(createQaListSoftDeleteMutationOptions({
      team,
      qaList,
      commitMutation: commitQaListLifecycleMutation,
      onOptimisticApplied: () => {
        state.showDeletedQaLists = true;
      },
      onSuccessApplied: (queryData) => {
        updateDefaultQaListAfterDeletion(team, qaList);
        persistQaListsQueryDataForTeam(team, queryData);
      },
      render,
    })).mutate();
  } catch (error) {
    state.qaListDiscovery = {
      status: "error",
      error: error?.message ?? "Could not delete this QA list.",
      recoveryMessage: "",
    };
  }
  render();
}

export async function restoreQaList(render, qaListId) {
  const restored = state.qaLists.find((item) => item.id === qaListId);
  if (!restored) {
    return;
  }
  const team = currentTeam();
  if (!team) {
    state.qaListDiscovery = {
      status: "error",
      error: "Could not determine the selected team.",
      recoveryMessage: "",
    };
    render();
    return;
  }
  ensureQaListsQueryDataForTeam(team);
  try {
    await createMutationObserver(createQaListRestoreMutationOptions({
      team,
      qaList: restored,
      commitMutation: commitQaListLifecycleMutation,
      onSuccessApplied: (queryData) => {
        makeQaListDefaultIfFirst(team, { ...restored, lifecycleState: "active" });
        persistQaListsQueryDataForTeam(team, queryData);
      },
      render,
    })).mutate();
  } catch (error) {
    state.qaListDiscovery = {
      status: "error",
      error: error?.message ?? "Could not restore this QA list.",
      recoveryMessage: "",
    };
  }
  render();
}

export function openQaListPermanentDeletion(render, qaListId) {
  const qaList = state.qaLists.find((item) => item.id === qaListId);
  if (!qaList) {
    return;
  }

  state.qaListPermanentDeletion = {
    ...createQaListPermanentDeletionState(),
    isOpen: true,
    qaListId: qaList.id,
    qaListName: qaList.title,
  };
  render();
}

export function cancelQaListPermanentDeletion(render) {
  state.qaListPermanentDeletion = createQaListPermanentDeletionState();
  render();
}

export function updateQaListPermanentDeletionConfirmation(value) {
  state.qaListPermanentDeletion = {
    ...state.qaListPermanentDeletion,
    confirmationText: value,
    error: "",
  };
}

export async function confirmQaListPermanentDeletion(render) {
  const deletion = state.qaListPermanentDeletion;
  if (String(deletion.confirmationText ?? "").trim() !== String(deletion.qaListName ?? "").trim()) {
    state.qaListPermanentDeletion = {
      ...deletion,
      error: "Type the QA list name to confirm deletion.",
    };
    render();
    return;
  }

  const team = currentTeam();
  const qaList = state.qaLists.find((item) => item.id === deletion.qaListId);
  if (!team || !qaList) {
    state.qaListPermanentDeletion = {
      ...deletion,
      error: "Could not find the selected QA list.",
    };
    render();
    return;
  }
  ensureQaListsQueryDataForTeam(team);
  try {
    await createMutationObserver(createQaListPermanentDeleteMutationOptions({
      team,
      qaList,
      commitMutation: async () => {
        if (teamSupportsQaListRepos(team) && qaList?.repoName) {
          await deleteRemoteQaListRepo(team, qaList);
          await invoke("purge_local_gtms_qa_list_repo", {
            input: repoBackedQaListInput(team, qaList),
          });
        }
      },
      onSuccessApplied: (queryData) => {
        persistQaListsQueryDataForTeam(team, queryData);
        state.qaListPermanentDeletion = createQaListPermanentDeletionState();
      },
      onErrorApplied: (error) => {
        state.qaListPermanentDeletion = {
          ...deletion,
          error: error?.message ?? "Could not permanently delete this QA list.",
        };
      },
      render,
    })).mutate();
  } catch (error) {
    state.qaListPermanentDeletion = {
      ...deletion,
      error: error?.message ?? "Could not permanently delete this QA list.",
    };
  }
  render();
}

export function toggleDeletedQaLists(render) {
  state.showDeletedQaLists = !state.showDeletedQaLists;
  render();
}

export function openQaListEditor(render, qaListId, options = {}) {
  const qaList = state.qaLists.find((item) => item.id === qaListId);
  if (!qaList) {
    return;
  }

  state.selectedQaListId = qaList.id;
  state.qaListEditor = {
    ...createQaListEditorState(),
    status: "ready",
    navigationSource: options.navigationSource ?? null,
    qaListId: qaList.id,
    title: qaList.title,
    lifecycleState: qaList.lifecycleState,
    language: qaList.language,
    termCount: qaList.termCount,
    repoName: qaList.repoName,
    fullName: qaList.fullName,
    repoId: qaList.repoId,
    defaultBranchName: qaList.defaultBranchName,
    defaultBranchHeadOid: qaList.defaultBranchHeadOid,
    terms: qaList.terms ?? [],
  };
  state.screen = "qaListEditor";
  render();
}

export function primeSelectedQaListEditorLoadingState() {
  state.qaListEditor = {
    ...state.qaListEditor,
    status: state.qaListEditor?.terms?.length ? "ready" : "loading",
    error: "",
  };
}

export async function loadSelectedQaListEditorData(render) {
  const qaList = selectedQaList();
  if (!qaList) {
    state.qaListEditor = {
      ...createQaListEditorState(),
      status: "error",
      error: "Could not find this QA list.",
    };
    render();
    return;
  }

  const team = currentTeam();
  try {
    if (teamSupportsQaListRepos(team) && qaList.repoName) {
      const descriptor = qaListRepoDescriptor(qaList);
      if (descriptor) {
        await invoke("sync_gtms_qa_list_editor_repo", {
          input: {
            installationId: team.installationId,
            ...descriptor,
          },
          sessionToken: requireBrokerSession(),
        });
      }
      const normalized = await loadRepoBackedQaListEditorSnapshot(team, qaList);
      if (applyQaListEditorSnapshot(team, qaList, normalized)) {
        render();
      }
      return;
    }

    if (!selectedQaListEditorMatches(team, qaList)) {
      return;
    }
    state.qaListEditor = {
      ...state.qaListEditor,
      status: "ready",
      qaListId: qaList.id,
      title: qaList.title,
      lifecycleState: qaList.lifecycleState,
      language: qaList.language,
      termCount: qaList.termCount,
      terms: qaList.terms ?? [],
      error: "",
    };
  } catch (error) {
    if (!selectedQaListEditorMatches(team, qaList)) {
      return;
    }
    state.qaListEditor = {
      ...state.qaListEditor,
      status: "error",
      error: error?.message ?? "Could not load this QA list.",
    };
  }
  render();
}

export function updateQaTermSearchQuery(render, query) {
  state.qaListEditor = {
    ...state.qaListEditor,
    searchQuery: query,
  };
  render();
}

export function openQaTermEditor(render, termId = null) {
  const editor = state.qaListEditor;
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
  const team = currentTeam();
  const currentQueryData = ensureQaListsQueryDataForTeam(team);
  const nextQueryData = patchQaListQueryData(currentQueryData, qaListId, {
    terms,
    termCount: terms.length,
    updatedAt: now,
  });
  applyQaListsQueryDataForTeam(team, nextQueryData, null);
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

  const team = currentTeam();
  const qaList = selectedQaList();
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
        termId: editor.termId ?? createId("qa-term"),
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
  }
  render();
}

export async function deleteQaTerm(render, termId) {
  const team = currentTeam();
  const qaList = selectedQaList();
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
  }
  render();
}

function serializeQaListToTmx(qaList) {
  const languageCode = qaList.language?.code ?? "";
  const escapeXml = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  const body = (qaList.terms ?? [])
    .map((term) => `
    <tu>
      <tuv xml:lang="${escapeXml(languageCode)}"><seg>${escapeXml(term.text)}</seg></tuv>
      <prop type="notes">${escapeXml(term.notes)}</prop>
    </tu>`)
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<tmx version="1.4">
  <header creationtool="Gnosis TMS" datatype="plaintext" segtype="sentence" adminlang="en" srclang="${escapeXml(languageCode)}"/>
  <body>${body}
  </body>
</tmx>
`;
}

function sanitizeTmxFileName(value) {
  return String(value ?? "")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/\.+$/g, "")
    .trim() || "qa-list";
}

async function saveTmxFilePath(options) {
  const save = window.__TAURI__?.dialog?.save;
  if (typeof save !== "function") {
    return null;
  }
  return save(options);
}

export async function downloadQaListAsTmx(render, qaListId) {
  const qaList = state.qaLists.find((item) => item.id === qaListId);
  if (!qaList || typeof document === "undefined") {
    return;
  }

  const team = currentTeam();
  if (teamSupportsQaListRepos(team) && qaList.repoName) {
    const defaultFileName = `${sanitizeTmxFileName(qaList.title || qaList.repoName)}.tmx`;
    try {
      const outputPath = await saveTmxFilePath({
        title: "Export QA list as TMX",
        defaultPath: defaultFileName,
        filters: [
          {
            name: "TMX QA list",
            extensions: ["tmx"],
          },
        ],
      });
      if (!outputPath) {
        return;
      }
      await invoke("export_gtms_qa_list_to_tmx", {
        input: {
          ...repoBackedQaListInput(team, qaList),
          outputPath,
        },
      });
      render();
      return;
    } catch (error) {
      state.qaListDiscovery = {
        status: "error",
        error: error?.message ?? "Could not export this QA list.",
        recoveryMessage: "",
      };
      render();
      return;
    }
  }

  const blob = new Blob([serializeQaListToTmx(qaList)], { type: "application/xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${qaList.title.replaceAll(/[^a-z0-9-_]+/gi, "-") || "qa-list"}.tmx`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  render();
}

function textContent(node, selector) {
  return String(node?.querySelector?.(selector)?.textContent ?? "").trim();
}

function normalizeTmxLanguageCode(value) {
  return String(value ?? "").trim().replaceAll("_", "-").toLowerCase();
}

function tmxNodeLanguageCode(node) {
  return normalizeTmxLanguageCode(
    node?.getAttribute?.("xml:lang")
      ?? node?.getAttribute?.("lang")
      ?? "",
  );
}

function parseQaListTmx(text, fileName) {
  if (typeof DOMParser === "undefined") {
    throw new Error("TMX import is not available in this runtime.");
  }

  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("This TMX file could not be parsed.");
  }

  const detectedLanguageCodes = new Set();
  const headerLanguageCode = normalizeTmxLanguageCode(doc.querySelector("header")?.getAttribute("srclang"));
  if (headerLanguageCode) {
    detectedLanguageCodes.add(headerLanguageCode);
  }
  for (const tuv of Array.from(doc.querySelectorAll("tuv"))) {
    const languageCode = tmxNodeLanguageCode(tuv);
    if (languageCode) {
      detectedLanguageCodes.add(languageCode);
    }
  }
  if (detectedLanguageCodes.size > 1) {
    throw new Error("QA list TMX import only supports single-language TMX files.");
  }

  const languageCode = [...detectedLanguageCodes][0] ?? "";
  const language = findIsoLanguageOption(languageCode);
  if (!language) {
    throw new Error("The TMX file does not include a supported language.");
  }

  const terms = Array.from(doc.querySelectorAll("tu"))
    .map((tu) => {
      const segment = Array.from(tu.querySelectorAll("tuv"))
        .find((tuv) => {
          const segmentLanguageCode = tmxNodeLanguageCode(tuv);
          return !segmentLanguageCode || segmentLanguageCode === languageCode;
        })
        ?.querySelector("seg");
      return normalizeQaTerm({
        termId: createId("qa-term"),
        text: String(segment?.textContent ?? textContent(tu, "seg")).trim(),
        notes: textContent(tu, 'prop[type="notes"], note'),
      });
    })
    .filter(Boolean);
  const fileTitle = String(fileName ?? "")
    .replace(/\.[^.]+$/, "")
    .replaceAll(/[-_]+/g, " ")
    .trim();

  return normalizeQaList({
    id: createId("qa-list"),
    title: fileTitle || `QA List (${language.name})`,
    language,
    lifecycleState: "active",
    terms,
  });
}

export async function importQaListFromTmx(render) {
  if (typeof document === "undefined") {
    return;
  }

  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".tmx,application/xml,text/xml";
  input.hidden = true;
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    let createdRemoteRepo = null;
    let localRepoInitialized = false;
    let createdQaListId = null;
    let importTeam = null;
    try {
      const team = currentTeam();
      importTeam = team;
      if (teamSupportsQaListRepos(team)) {
        const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
        const preview = await invoke("inspect_tmx_qa_list_import", {
          input: {
            fileName: file.name,
            bytes,
          },
        });
        const qaListId = globalThis.crypto?.randomUUID?.() ?? createId("qa-list");
        createdQaListId = qaListId;
        const remoteRepo = await createRemoteQaListRepo(team, preview.title);
        createdRemoteRepo = remoteRepo;
        await prepareLocalQaListRepo(team, remoteRepo, qaListId);
        localRepoInitialized = true;
        const summary = await invoke("import_tmx_to_gtms_qa_list_repo", {
          input: {
            installationId: team.installationId,
            repoName: remoteRepo.name,
            qaListId,
            fileName: file.name,
            bytes,
          },
        });
        if (!selectedTeamMatches(team)) {
          throw new Error("The selected team changed before the QA list could be imported.");
        }
        const qaList = normalizeQaList({
          ...summary,
          repoId: remoteRepo.repoId ?? null,
          nodeId: remoteRepo.nodeId ?? null,
          fullName: remoteRepo.fullName ?? null,
          htmlUrl: remoteRepo.htmlUrl ?? "",
          defaultBranchName: remoteRepo.defaultBranchName ?? "main",
          defaultBranchHeadOid: remoteRepo.defaultBranchHeadOid ?? null,
        });
        await syncSingleQaListOrThrow(team, qaList);
        if (!selectedTeamMatches(team)) {
          throw new Error("The selected team changed before the QA list could be imported.");
        }
        upsertQaListForTeam(team, qaList, null, { preserveCreate: true });
        makeQaListDefaultIfFirst(team, qaList);
        saveStoredQaListsForTeam(team, state.qaLists);
      } else {
        const text = await file.text();
        const qaList = parseQaListTmx(text, file.name);
        upsertQaListForTeam(team, qaList, null, { preserveCreate: true });
        makeQaListDefaultIfFirst(team, qaList);
        saveStoredQaListsForTeam(team, state.qaLists);
      }
      state.qaListDiscovery = { status: "ready", error: "", recoveryMessage: "" };
    } catch (error) {
      const team = importTeam ?? currentTeam();
      let message = error?.message ?? "Could not import this QA list.";
      if (team && localRepoInitialized && createdRemoteRepo?.name) {
        try {
          await invoke("purge_local_gtms_qa_list_repo", {
            input: {
              installationId: team.installationId,
              repoName: createdRemoteRepo.name,
              qaListId: createdQaListId,
            },
          });
        } catch {}
      }
      if (team && createdRemoteRepo?.name) {
        try {
          await deleteRemoteQaListRepo(team, { repoName: createdRemoteRepo.name });
        } catch (rollbackError) {
          message = qaListCreationRollbackMessage(error, rollbackError);
        }
      }
      state.qaListDiscovery = {
        status: "error",
        error: message,
        recoveryMessage: "",
      };
    } finally {
      render();
      input.remove();
    }
  });
  document.body.append(input);
  input.click();
}
