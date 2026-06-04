import { invoke } from "../runtime.js";
import { queryClient } from "../query-client.js";

function resourceId(resource, config) {
  if (typeof config.resourceId === "function") {
    return config.resourceId(resource);
  }
  for (const field of config.resourceIdFields ?? ["id"]) {
    if (resource?.[field] != null) {
      return resource[field];
    }
  }
  return null;
}

function repoName(resource) {
  return String(resource?.repoName ?? "").trim();
}

function payloadResourceId(payload, resource, config) {
  for (const field of config.contextIdFields ?? [config.inputResourceIdField]) {
    if (payload?.[field] != null) {
      return payload[field];
    }
  }
  return resourceId(resource, config);
}

export function createRepoResourceEditorQuery(config) {
  function editorQueryKey(team, resource) {
    return config.queryKey(
      team?.installationId ?? null,
      resourceId(resource, config),
      repoName(resource),
    );
  }

  function withSnapshotContext(payload, team, resource) {
    const resolvedResourceId = payloadResourceId(payload, resource, config);
    const context = {
      ...(payload ?? {}),
      repoName: payload?.repoName ?? repoName(resource),
      repoId: Number.isFinite(payload?.repoId)
        ? payload.repoId
        : Number.isFinite(resource?.repoId)
          ? resource.repoId
          : null,
      fullName: payload?.fullName ?? resource?.fullName ?? "",
      defaultBranchName: payload?.defaultBranchName ?? resource?.defaultBranchName ?? "main",
      defaultBranchHeadOid: payload?.defaultBranchHeadOid ?? resource?.defaultBranchHeadOid ?? null,
      installationId: team?.installationId ?? null,
    };

    for (const field of config.contextIdFields ?? [config.inputResourceIdField]) {
      context[field] = payload?.[field] ?? resolvedResourceId;
    }
    return context;
  }

  function createEditorQueryOptions(team, resource) {
    const key = editorQueryKey(team, resource);
    return {
      queryKey: key,
      queryFn: async () => {
        const payload = await invoke(config.command, {
          input: {
            installationId: team.installationId,
            [config.inputResourceIdField]: resourceId(resource, config),
            repoName: repoName(resource),
          },
        });
        return withSnapshotContext(payload, team, resource);
      },
    };
  }

  function getCachedEditorPayload(team, resource) {
    return queryClient.getQueryData(editorQueryKey(team, resource)) ?? null;
  }

  function setCachedEditorPayload(team, resource, payload) {
    queryClient.setQueryData(
      editorQueryKey(team, resource),
      withSnapshotContext(payload, team, resource),
    );
  }

  function removeEditorQuery(team, resource) {
    return queryClient.removeQueries({
      queryKey: editorQueryKey(team, resource),
      exact: true,
    });
  }

  return {
    editorQueryKey,
    createEditorQueryOptions,
    getCachedEditorPayload,
    setCachedEditorPayload,
    removeEditorQuery,
  };
}
