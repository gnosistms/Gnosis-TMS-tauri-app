import { invoke } from "./runtime.js";
import { glossaryEditorKeys, queryClient } from "./query-client.js";

function glossaryId(glossary) {
  return glossary?.id ?? glossary?.glossaryId ?? null;
}

function glossaryRepoName(glossary) {
  return String(glossary?.repoName ?? "").trim();
}

export function glossaryEditorQueryKey(team, glossary) {
  return glossaryEditorKeys.byGlossary(
    team?.installationId ?? null,
    glossaryId(glossary),
    glossaryRepoName(glossary),
  );
}

function withGlossarySnapshotContext(payload, team, glossary) {
  return {
    ...(payload ?? {}),
    glossaryId: payload?.glossaryId ?? glossaryId(glossary),
    repoName: payload?.repoName ?? glossaryRepoName(glossary),
    repoId: Number.isFinite(payload?.repoId)
      ? payload.repoId
      : Number.isFinite(glossary?.repoId)
        ? glossary.repoId
        : null,
    fullName: payload?.fullName ?? glossary?.fullName ?? "",
    defaultBranchName: payload?.defaultBranchName ?? glossary?.defaultBranchName ?? "main",
    defaultBranchHeadOid: payload?.defaultBranchHeadOid ?? glossary?.defaultBranchHeadOid ?? null,
    installationId: team?.installationId ?? null,
  };
}

export function createGlossaryEditorQueryOptions(team, glossary) {
  const key = glossaryEditorQueryKey(team, glossary);
  return {
    queryKey: key,
    queryFn: async () => {
      const payload = await invoke("load_gtms_glossary_editor_data", {
        input: {
          installationId: team.installationId,
          glossaryId: glossaryId(glossary),
          repoName: glossaryRepoName(glossary),
        },
      });
      return withGlossarySnapshotContext(payload, team, glossary);
    },
  };
}

export function getCachedGlossaryEditorPayload(team, glossary) {
  return queryClient.getQueryData(glossaryEditorQueryKey(team, glossary)) ?? null;
}

export function setCachedGlossaryEditorPayload(team, glossary, payload) {
  queryClient.setQueryData(
    glossaryEditorQueryKey(team, glossary),
    withGlossarySnapshotContext(payload, team, glossary),
  );
}

export function removeGlossaryEditorQuery(team, glossary) {
  return queryClient.removeQueries({
    queryKey: glossaryEditorQueryKey(team, glossary),
    exact: true,
  });
}
