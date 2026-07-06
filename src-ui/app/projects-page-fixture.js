// Browser-test fixture for the projects page, mirroring the editor
// regression fixture pattern: it writes visible state directly (bypassing the
// query path) so Playwright and manual browser sessions can render a
// deterministic projects list without a Tauri backend.

import { getActiveStorageLogin, setActiveStorageLogin } from "./team-storage.js";

const FIXTURE_TEAM_ID = "fixture-projects-team";
const FIXTURE_STORAGE_LOGIN = "fixture-login";

function fixtureChapter(projectIndex, fileIndex, options = {}) {
  const deleted = options.deleted === true;
  return {
    id: `fixture-chapter-${projectIndex}-${fileIndex}${deleted ? "-deleted" : ""}`,
    name: deleted
      ? `Deleted file ${String(fileIndex + 1).padStart(3, "0")}`
      : `File ${String(fileIndex + 1).padStart(3, "0")}`,
    status: deleted ? "deleted" : "active",
    linkedGlossary: null,
    sourceWordCount: 120 + ((projectIndex * 31 + fileIndex * 7) % 400),
  };
}

function buildProjectsPageFixtureProjects(options = {}) {
  const projectCount = Number.isInteger(options.projectCount) ? options.projectCount : 8;
  const filesPerProject = Number.isInteger(options.filesPerProject) ? options.filesPerProject : 6;
  const deletedFilesPerProject = Number.isInteger(options.deletedFilesPerProject)
    ? options.deletedFilesPerProject
    : 0;

  return Array.from({ length: projectCount }, (_unused, projectIndex) => ({
    id: `fixture-project-${String(projectIndex + 1).padStart(3, "0")}`,
    title: `Fixture Project ${String(projectIndex + 1).padStart(3, "0")}`,
    name: `fixture-project-${projectIndex + 1}`,
    status: "active",
    chapters: [
      ...Array.from({ length: filesPerProject }, (_alsoUnused, fileIndex) =>
        fixtureChapter(projectIndex, fileIndex),
      ),
      ...Array.from({ length: deletedFilesPerProject }, (_alsoUnused, fileIndex) =>
        fixtureChapter(projectIndex, fileIndex, { deleted: true }),
      ),
    ],
  }));
}

export function applyProjectsPageFixture(appState, options = {}) {
  // Per-login persistence (scroll positions) needs an active storage login,
  // which the browser harness has no auth flow to establish.
  if (!getActiveStorageLogin()) {
    setActiveStorageLogin(FIXTURE_STORAGE_LOGIN);
  }
  const projects = buildProjectsPageFixtureProjects(options);
  const expandedProjectIds = Array.isArray(options.expandedProjectIds)
    ? options.expandedProjectIds
    : options.expandAll === true
      ? projects.map((project) => project.id)
      : [];
  const teamId = typeof options.teamId === "string" && options.teamId ? options.teamId : FIXTURE_TEAM_ID;

  const fixtureTeam = {
    id: teamId,
    name: options.teamName ?? "Fixture Team",
    membershipRole: "owner",
    // Write guards require a concrete installation; any finite id works
    // against the browser harness's mocked invoke.
    installationId: 424242,
    canManageProjects: true,
    canDelete: true,
  };
  appState.teams = [
    ...appState.teams.filter((team) => team.id !== teamId),
    fixtureTeam,
  ];
  appState.selectedTeamId = teamId;
  appState.projects = projects;
  appState.deletedProjects = [];
  appState.glossaries = Array.from(
    { length: Number.isInteger(options.glossaryCount) ? options.glossaryCount : 0 },
    (_unused, index) => ({
      id: `fixture-glossary-${index + 1}`,
      title: `Fixture Glossary ${index + 1}`,
      repoName: `fixture-glossary-repo-${index + 1}`,
      lifecycleState: "active",
    }),
  );
  appState.expandedProjects = new Set(expandedProjectIds);
  appState.expandedDeletedFiles = new Set(
    Array.isArray(options.expandedDeletedFileProjectIds) ? options.expandedDeletedFileProjectIds : [],
  );
  appState.showDeletedProjects = false;
  appState.projectDiscovery = {
    status: "ready",
    error: "",
    glossaryWarning: "",
    recoveryMessage: "",
  };
  appState.projectsPage = {
    isRefreshing: false,
    writeState: "idle",
  };
  appState.projectsPageSync = { status: "idle" };
  appState.projectRepoSyncByProjectId = {};
  appState.projectsSearch = { query: "", results: [], loading: false };
  appState.screen = "projects";

  return {
    teamId,
    projectIds: projects.map((project) => project.id),
    itemCounts: {
      projects: projects.length,
      expanded: expandedProjectIds.length,
    },
  };
}
