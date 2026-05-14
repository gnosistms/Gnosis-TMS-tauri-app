import { invoke } from "./runtime.js";
import { qaListEditorKeys, queryClient } from "./query-client.js";

function qaListId(qaList) {
  return qaList?.id ?? qaList?.qaListId ?? null;
}

function qaListRepoName(qaList) {
  return String(qaList?.repoName ?? "").trim();
}

export function qaListEditorQueryKey(team, qaList) {
  return qaListEditorKeys.byQaList(
    team?.installationId ?? null,
    qaListId(qaList),
    qaListRepoName(qaList),
  );
}

function withQaListSnapshotContext(payload, team, qaList) {
  return {
    ...(payload ?? {}),
    qaListId: payload?.qaListId ?? payload?.id ?? qaListId(qaList),
    id: payload?.id ?? payload?.qaListId ?? qaListId(qaList),
    repoName: payload?.repoName ?? qaListRepoName(qaList),
    repoId: Number.isFinite(payload?.repoId)
      ? payload.repoId
      : Number.isFinite(qaList?.repoId)
        ? qaList.repoId
        : null,
    fullName: payload?.fullName ?? qaList?.fullName ?? "",
    defaultBranchName: payload?.defaultBranchName ?? qaList?.defaultBranchName ?? "main",
    defaultBranchHeadOid: payload?.defaultBranchHeadOid ?? qaList?.defaultBranchHeadOid ?? null,
    installationId: team?.installationId ?? null,
  };
}

export function createQaListEditorQueryOptions(team, qaList) {
  const key = qaListEditorQueryKey(team, qaList);
  return {
    queryKey: key,
    queryFn: async () => {
      const payload = await invoke("load_gtms_qa_list_editor_data", {
        input: {
          installationId: team.installationId,
          qaListId: qaListId(qaList),
          repoName: qaListRepoName(qaList),
        },
      });
      return withQaListSnapshotContext(payload, team, qaList);
    },
  };
}

export function getCachedQaListEditorPayload(team, qaList) {
  return queryClient.getQueryData(qaListEditorQueryKey(team, qaList)) ?? null;
}

export function setCachedQaListEditorPayload(team, qaList, payload) {
  queryClient.setQueryData(
    qaListEditorQueryKey(team, qaList),
    withQaListSnapshotContext(payload, team, qaList),
  );
}

export function removeQaListEditorQuery(team, qaList) {
  return queryClient.removeQueries({
    queryKey: qaListEditorQueryKey(team, qaList),
    exact: true,
  });
}
