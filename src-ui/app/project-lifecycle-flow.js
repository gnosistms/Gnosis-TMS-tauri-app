import { invoke } from "./runtime.js";
import { requireBrokerSession } from "./auth-flow.js";
import { state } from "./state.js";
import { showProjectsStatus } from "./project-chapter-flow.js";
import { upsertProjectMetadataRecord } from "./team-metadata-flow.js";
import { commitMetadataFirstTopLevelMutation } from "./resource-lifecycle-engine.js";
import { enqueueRepoWrite, projectRepoScope } from "./repo-write-queue.js";

export function projectMetadataRecordFromVisibleProject(project, overrides = {}) {
  const isDeletedLifecycleState =
    project?.lifecycleState === "deleted"
    || project?.lifecycleState === "softDeleted"
    || project?.status === "deleted";
  return {
    projectId: project.id,
    title: overrides.title ?? project.title,
    repoName: overrides.repoName ?? project.name,
    githubRepoId:
      Number.isFinite(overrides.githubRepoId)
        ? overrides.githubRepoId
        : Number.isFinite(project.repoId)
          ? project.repoId
          : null,
    githubNodeId:
      typeof overrides.githubNodeId === "string" && overrides.githubNodeId.trim()
        ? overrides.githubNodeId.trim()
        : typeof project.nodeId === "string" && project.nodeId.trim()
        ? project.nodeId.trim()
        : null,
    fullName:
      typeof overrides.fullName === "string" && overrides.fullName.trim()
        ? overrides.fullName.trim()
        : typeof project.fullName === "string" && project.fullName.trim()
        ? project.fullName.trim()
        : null,
    defaultBranch:
      typeof overrides.defaultBranch === "string" && overrides.defaultBranch.trim()
        ? overrides.defaultBranch.trim()
        : typeof project.defaultBranchName === "string" && project.defaultBranchName.trim()
        ? project.defaultBranchName.trim()
        : "main",
    lifecycleState:
      overrides.lifecycleState
      ?? (isDeletedLifecycleState ? "softDeleted" : "active"),
    remoteState:
      overrides.remoteState
      ?? (project.remoteState ?? "linked"),
    recordState: overrides.recordState ?? project.recordState ?? "live",
    deletedAt:
      typeof overrides.deletedAt === "string" && overrides.deletedAt.trim()
        ? overrides.deletedAt.trim()
        : typeof project.deletedAt === "string" && project.deletedAt.trim()
        ? project.deletedAt.trim()
        : null,
    chapterCount:
      Number.isFinite(overrides.chapterCount)
        ? overrides.chapterCount
        : Array.isArray(project.chapters)
          ? project.chapters.length
          : 0,
  };
}

export async function commitProjectMutationStrict(selectedTeam, mutation, options = {}) {
  const project =
    state.projects.find((item) => item.id === mutation.projectId) ??
    state.deletedProjects.find((item) => item.id === mutation.projectId);

  if (!selectedTeam?.installationId || !project) {
    return;
  }

  await enqueueRepoWrite({
    scope: projectRepoScope({ team: selectedTeam, project }),
    kind: `projectLifecycle:${mutation.type ?? "unknown"}`,
    sourceScreen: "projects",
    errorTarget: {
      projectId: project.id,
      kind: `projectLifecycle:${mutation.type ?? "unknown"}`,
    },
    run: () => commitMetadataFirstTopLevelMutation({
      mutation,
      resource: project,
      resourceLabel: "project",
      writeMetadata: (record) => {
        if (options.statusLabels?.metadata) {
          showProjectsStatus(options.render, options.statusLabels.metadata);
        }
        return upsertProjectMetadataRecord(selectedTeam, record, { requirePushSuccess: true });
      },
      buildRecord: (currentProject, overrides = {}) =>
        projectMetadataRecordFromVisibleProject(currentProject, overrides),
      applyLocalMutation: (currentProject, currentMutation) => {
        if (options.statusLabels?.local) {
          showProjectsStatus(options.render, options.statusLabels.local);
        }
        if (currentMutation.type === "rename") {
          return invoke("rename_gnosis_project_repo", {
            input: {
              installationId: selectedTeam.installationId,
              fullName: currentProject.fullName,
              projectTitle: currentMutation.title,
            },
            sessionToken: requireBrokerSession(),
          });
        }

        if (currentMutation.type === "softDelete") {
          return invoke("mark_gnosis_project_repo_deleted", {
            input: {
              installationId: selectedTeam.installationId,
              orgLogin: selectedTeam.githubOrg,
              repoName: currentProject.name,
            },
            sessionToken: requireBrokerSession(),
          });
        }

        if (currentMutation.type === "restore") {
          return invoke("restore_gnosis_project_repo", {
            input: {
              installationId: selectedTeam.installationId,
              orgLogin: selectedTeam.githubOrg,
              repoName: currentProject.name,
            },
            sessionToken: requireBrokerSession(),
          });
        }

        return Promise.resolve();
      },
    }),
  });
}

