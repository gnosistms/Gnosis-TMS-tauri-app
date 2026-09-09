import { invoke } from "../runtime.js";
import { queryClient } from "../query-client.js";
import { resourceId } from "./resource-descriptor.js";

function repoName(resource) {
  return String(resource?.repoName ?? "").trim();
}

function payloadResourceId(payload, resource, config) {
  for (const field of config.contextIdFields ?? [config.resourceIdField]) {
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

    for (const field of config.contextIdFields ?? [config.resourceIdField]) {
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
            [config.resourceIdField]: resourceId(resource, config),
            repoName: repoName(resource),
          },
        });
        let resolvedResource = resource;
        // Chapter links and local content payloads carry no remote identity.
        // Resolve the exact resource in this installation's metadata, never by name alone.
        if (!resource?.fullName && config.listLocalMetadataRecords) {
          const records = await config.listLocalMetadataRecords(team);
          const record = records.find((entry) => entry.id === resourceId(resource, config));
          if (record) {
            if (record.repoName !== repoName(resource)
              || (Number.isFinite(resource?.repoId) && Number.isFinite(record.githubRepoId)
                && resource.repoId !== record.githubRepoId)
              || (record.fullName && (record.fullName.split("/").length !== 2
                || !record.fullName.split("/")[0]
                || record.fullName.split("/")[1] !== record.repoName))) {
              throw new Error("The repository details have changed. Reopen the resource before editing.");
            }
            resolvedResource = {
              ...resource,
              fullName: record.fullName,
              repoId: record.githubRepoId ?? resource.repoId,
              defaultBranchName: record.defaultBranch ?? resource.defaultBranchName,
            };
          }
        }
        return withSnapshotContext(payload, team, resolvedResource);
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
