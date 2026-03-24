import { loadStoredGithubAppTeams } from "./team-storage.js";

export const state = {
  screen: "start",
  expandedProjects: new Set(["p2"]),
  selectedTeamId: null,
  selectedProjectId: "p2",
  selectedGlossaryId: "g1",
  selectedChapterId: "c2",
  teams: loadStoredGithubAppTeams(),
  projects: [],
  auth: {
    status: "idle",
    message: "",
    session: null,
  },
  orgDiscovery: {
    status: "idle",
    error: "",
  },
  projectDiscovery: {
    status: "idle",
    error: "",
  },
  teamSetup: createTeamSetupState(),
};

export function createTeamSetupState() {
  return {
    isOpen: false,
    step: "guide",
    error: "",
    githubAppInstallationId: null,
    githubAppInstallation: null,
  };
}

export function resetTeamSetup() {
  state.teamSetup = createTeamSetupState();
}

export function resetSessionState() {
  state.auth = {
    status: "idle",
    message: "",
    session: null,
  };
  state.teams = [];
  state.projects = [];
  state.orgDiscovery = { status: "idle", error: "" };
  state.projectDiscovery = { status: "idle", error: "" };
  resetTeamSetup();
}
