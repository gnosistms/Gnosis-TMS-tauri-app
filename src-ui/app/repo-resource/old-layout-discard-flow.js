import { invoke } from "../runtime.js";
import { requireBrokerSession } from "../auth-flow.js";
import { state, createRepoOldLayoutDiscardState } from "../state.js";
import { showNoticeBadge, showScopedSyncBadge, clearScopedSyncBadge } from "../status-feedback.js";
import { enqueueRepoWrite, projectRepoScope } from "../repo-write-queue.js";
import { resourceId, selectedTeam } from "./resource-descriptor.js";

function findResource(id, config) {
  return (Array.isArray(state[config.collectionField]) ? state[config.collectionField] : [])
    .find((resource) => resourceId(resource, config) === id) ?? null;
}

function syncDescriptor(resource, config) {
  return {
    [config.resourceIdField]: resourceId(resource, config),
    repoName: resource.repoName,
    fullName: resource.fullName,
    repoId: Number.isFinite(resource.repoId) ? resource.repoId : null,
    defaultBranchName: resource.defaultBranchName || "main",
    defaultBranchHeadOid: resource.defaultBranchHeadOid || null,
    lifecycleState: resource.lifecycleState || "",
    recordState: resource.recordState || "",
    remoteState: resource.remoteState || "",
    status: resource.status || "",
  };
}

export function createRepoResourceOldLayoutDiscardFlow(config) {
  function setModal(value) {
    state[config.stateField] = value;
  }

  function open(render, id) {
    const team = selectedTeam();
    const resource = findResource(id, config);
    if (!team?.id || !resource) {
      showNoticeBadge(config.notFoundMessage, render, 2600);
      return;
    }

    setModal({
      isOpen: true,
      teamId: team.id,
      resourceId: resourceId(resource, config),
      resourceName: resource.title || resource.repoName || config.defaultResourceName,
      status: "idle",
      error: "",
    });
    render?.();
  }

  function close(render) {
    if (state[config.stateField]?.status === "loading") {
      return;
    }
    setModal(createRepoOldLayoutDiscardState());
    render?.();
  }

  async function confirm(render) {
    const modal = state[config.stateField] ?? {};
    if (modal.isOpen !== true || modal.status === "loading") {
      return;
    }

    const team = selectedTeam();
    const resource = findResource(modal.resourceId, config);
    if (!Number.isFinite(team?.installationId) || team.id !== modal.teamId || !resource) {
      setModal({
        ...modal,
        status: "idle",
        error: config.notFoundMessage,
      });
      render?.();
      return;
    }

    if (state.offline?.isEnabled === true || state.pageSync?.status === "syncing") {
      setModal({
        ...modal,
        status: "idle",
        error: "Wait until the app is online and the current refresh is finished before discarding local changes.",
      });
      render?.();
      return;
    }

    const descriptor = syncDescriptor(resource, config);
    if (!descriptor.repoName || !descriptor.fullName) {
      setModal({
        ...modal,
        status: "idle",
        error: config.prepareErrorMessage,
      });
      render?.();
      return;
    }

    setModal({ ...modal, status: "loading", error: "" });
    render?.();

    try {
      showScopedSyncBadge(config.badgeScope, "Discarding old-format local changes...", render);
      const response = await enqueueRepoWrite({
        scope: projectRepoScope({ team, repoName: descriptor.repoName }),
        kind: config.queueKind,
        sourceScreen: config.sourceScreen,
        errorTarget: {
          kind: config.errorKind,
          [config.resourceIdField]: resourceId(resource, config),
        },
        run: () => invoke(config.command, {
          input: {
            installationId: team.installationId,
            [config.collectionField]: [descriptor],
          },
          sessionToken: requireBrokerSession(),
        }),
      });
      const resolvedCount = Array.isArray(response?.resolvedRepoNames)
        ? response.resolvedRepoNames.length
        : 1;
      setModal(createRepoOldLayoutDiscardState());
      showScopedSyncBadge(config.badgeScope, config.refreshingMessage, render);
      await config.reload(render, team.id, { preserveVisibleData: true });
      clearScopedSyncBadge(config.badgeScope, render);
      showNoticeBadge(
        resolvedCount > 0 ? config.successMessage : config.noOpMessage,
        render,
        3600,
      );
    } catch (error) {
      clearScopedSyncBadge(config.badgeScope, render);
      setModal({
        ...modal,
        status: "idle",
        error: error?.message ?? String(error),
      });
      render?.();
    }
  }

  return { open, close, confirm };
}
