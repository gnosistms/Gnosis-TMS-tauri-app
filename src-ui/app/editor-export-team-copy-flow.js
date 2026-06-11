import { formatErrorForDisplay } from "./error-display.js";
import { invoke, listen } from "./runtime.js";
import { requireBrokerSession } from "./auth-flow.js";
import { findChapterContext, selectedProjectsTeam } from "./project-context.js";
import { canWriteChapters } from "./permissions.js";
import {
  createEditorExportModalState,
  createEditorExportTeamCopyState,
  state,
} from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";
import {
  projectRepoScope,
  waitForRepoWriteQueueIdle,
} from "./repo-write-queue.js";

function currentExportModal() {
  return state.editorChapter?.exportModal ?? null;
}

export function currentTeamCopyState() {
  return currentExportModal()?.teamCopy ?? null;
}

function updateExportModal(patch) {
  state.editorChapter = {
    ...state.editorChapter,
    exportModal: {
      ...(currentExportModal() ?? createEditorExportModalState()),
      ...patch,
    },
  };
}

function updateTeamCopyState(patch) {
  updateExportModal({
    teamCopy: {
      ...(currentTeamCopyState() ?? createEditorExportTeamCopyState()),
      ...patch,
    },
  });
}

function failTeamCopyAction(render, error) {
  updateExportModal({ status: "idle", error: formatErrorForDisplay(error) });
  updateTeamCopyState({ copyStage: "" });
  render();
}

function createTeamCopyJobId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `team-copy-job-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

// Teams the open chapter can be copied to: writable via the derived capability
// and not the team the chapter already lives in. Accepts an explicit app state
// so screen renderers can stay pure over their state argument.
export function eligibleTeamCopyTargets(appState = state) {
  const teams = Array.isArray(appState?.teams) ? appState.teams : [];
  return teams.filter((team) => team?.id !== appState?.selectedTeamId && canWriteChapters(team));
}

function eligibleTeamCopyTarget(teamId) {
  return eligibleTeamCopyTargets().find((team) => team.id === teamId) ?? null;
}

export function selectTeamCopyTargetTeam(render, teamId, operations = {}) {
  const modal = currentExportModal();
  if (!modal?.isOpen || modal.status === "exporting") {
    return;
  }

  const team = eligibleTeamCopyTarget(teamId);
  updateTeamCopyState({
    targetTeamId: team?.id ?? "",
    targetProjectId: "",
    projects: [],
    projectsStatus: team ? "loading" : "idle",
  });
  updateExportModal({ error: "" });
  render();

  if (team) {
    void loadTeamCopyProjects(render, team, operations);
  }
}

async function loadTeamCopyProjects(render, team, operations = {}) {
  const invokeCommand = operations.invoke ?? invoke;
  const requireSession = operations.requireBrokerSession ?? requireBrokerSession;
  if (!invokeCommand) {
    updateTeamCopyState({ projectsStatus: "error" });
    updateExportModal({ error: "Copying to another team requires the desktop app runtime." });
    render();
    return;
  }

  try {
    const projects = await invokeCommand("list_gnosis_projects_for_installation", {
      installationId: team.installationId,
      sessionToken: requireSession(),
    });
    // The load is async; the user may have picked a different team meanwhile.
    if (currentTeamCopyState()?.targetTeamId !== team.id) {
      return;
    }
    updateTeamCopyState({
      projectsStatus: "done",
      projects: (Array.isArray(projects) ? projects : []).filter(
        (project) => String(project?.status ?? "").toLowerCase() !== "deleted",
      ),
    });
    render();
  } catch (error) {
    if (currentTeamCopyState()?.targetTeamId !== team.id) {
      return;
    }
    updateTeamCopyState({ projectsStatus: "error", projects: [] });
    updateExportModal({ error: formatErrorForDisplay(error) });
    render();
  }
}

export function selectTeamCopyTargetProject(render, projectId) {
  const modal = currentExportModal();
  const teamCopy = currentTeamCopyState();
  if (!modal?.isOpen || modal.status === "exporting" || !teamCopy) {
    return;
  }

  const project = teamCopy.projects.find((entry) => entry.id === projectId) ?? null;
  updateTeamCopyState({ targetProjectId: project?.id ?? "" });
  updateExportModal({ error: "" });
  render();
}

export function selectedTeamCopyProject(teamCopy) {
  if (!teamCopy?.targetProjectId) {
    return null;
  }
  return teamCopy.projects.find((project) => project.id === teamCopy.targetProjectId) ?? null;
}

export async function submitTeamChapterCopy(render, operations = {}) {
  const invokeCommand = operations.invoke ?? invoke;
  const requireSession = operations.requireBrokerSession ?? requireBrokerSession;
  const waitForRepoQueue = operations.waitForRepoQueue ?? waitForRepoWriteQueueIdle;
  const modal = currentExportModal();
  const teamCopy = currentTeamCopyState();
  if (!modal?.isOpen || modal.status === "exporting" || !teamCopy) {
    return;
  }
  if (!invokeCommand) {
    failTeamCopyAction(render, "Copying to another team requires the desktop app runtime.");
    return;
  }

  const targetTeam = eligibleTeamCopyTarget(teamCopy.targetTeamId);
  const targetProject = selectedTeamCopyProject(teamCopy);
  if (!targetTeam || !targetProject) {
    failTeamCopyAction(render, "Choose the destination team and project first.");
    return;
  }

  const sourceTeam = selectedProjectsTeam();
  const context = findChapterContext(state.editorChapter?.chapterId);
  if (!Number.isFinite(sourceTeam?.installationId) || !context?.project || !context?.chapter) {
    failTeamCopyAction(render, "Could not find the open file.");
    return;
  }

  let sessionToken = "";
  try {
    sessionToken = requireSession();
  } catch (error) {
    failTeamCopyAction(render, error);
    return;
  }

  const jobId = createTeamCopyJobId();
  updateExportModal({ status: "exporting", error: "" });
  updateTeamCopyState({ jobId, copyStage: "Starting the copy..." });
  render();

  try {
    // Let queued editor writes land in the source repo so the copy reads the
    // latest committed content.
    await waitForRepoQueue(projectRepoScope({ team: sourceTeam, project: context.project }));
    await invokeCommand("copy_gtms_chapter_to_team", {
      input: {
        jobId,
        source: {
          installationId: sourceTeam.installationId,
          projectId: context.project.id ?? null,
          repoName: context.project.name,
          chapterId: context.chapter.id,
          projectTitle: context.project.title ?? "",
        },
        target: {
          installationId: targetTeam.installationId,
          projectId: targetProject.id,
          repoName: targetProject.name,
          fullName: targetProject.fullName,
          repoId: targetProject.repoId ?? null,
          defaultBranchName: targetProject.defaultBranchName ?? null,
          defaultBranchHeadOid: targetProject.defaultBranchHeadOid ?? null,
          status: targetProject.status ?? null,
          projectTitle: targetProject.title ?? "",
        },
      },
      sessionToken,
    });
  } catch (error) {
    failTeamCopyAction(render, error);
  }
}

export function handleTeamChapterCopyProgressEvent(payload, render) {
  const teamCopy = currentTeamCopyState();
  if (!teamCopy || !payload?.jobId || payload.jobId !== teamCopy.jobId) {
    return;
  }

  if (payload.status === "progress") {
    updateTeamCopyState({ copyStage: String(payload.message ?? "") });
    render();
    return;
  }

  if (payload.status === "success") {
    updateTeamCopyState({ copyStage: "", jobId: "" });
    updateExportModal({ isOpen: false, status: "idle", error: "" });
    // Full render to remove the modal; showNoticeBadge only repaints the
    // badge surface. The copied chapter appears through the normal TanStack
    // snapshot path when the destination team is viewed.
    render();
    const targetProjectTitle = String(payload.targetProjectTitle ?? "").trim();
    showNoticeBadge(
      targetProjectTitle
        ? `${payload.message ?? "Copied the chapter."} It is now in ${targetProjectTitle}.`
        : payload.message || "Copied the chapter to the other team.",
      render,
      2600,
    );
    return;
  }

  updateTeamCopyState({ copyStage: "", jobId: "" });
  updateExportModal({
    status: "idle",
    error: formatErrorForDisplay(payload.message ?? "The chapter copy failed."),
  });
  render();
}

export async function registerTeamChapterCopyListeners(render) {
  if (!listen) {
    return;
  }

  await listen("team-chapter-copy-progress", (event) => {
    handleTeamChapterCopyProgressEvent(event.payload, render);
  });
}
