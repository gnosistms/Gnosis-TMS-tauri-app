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
  deletedProjects: [],
  users: [],
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
  userDiscovery: {
    status: "idle",
    error: "",
  },
  teamSetup: createTeamSetupState(),
  projectCreation: createProjectCreationState(),
  projectDeletion: createProjectDeletionState(),
  projectPermanentDeletion: createProjectPermanentDeletionState(),
  showDeletedProjects: false,
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

export function createProjectCreationState() {
  return {
    isOpen: false,
    projectName: "",
    status: "idle",
    error: "",
  };
}

export function createProjectDeletionState() {
  return {
    isOpen: false,
    projectId: null,
    projectName: "",
    status: "idle",
    error: "",
  };
}

export function createProjectPermanentDeletionState() {
  return {
    isOpen: false,
    projectId: null,
    projectName: "",
    confirmationText: "",
    status: "idle",
    error: "",
  };
}

export function resetTeamSetup() {
  state.teamSetup = createTeamSetupState();
}

export function resetProjectCreation() {
  state.projectCreation = createProjectCreationState();
}

export function resetProjectDeletion() {
  state.projectDeletion = createProjectDeletionState();
}

export function resetProjectPermanentDeletion() {
  state.projectPermanentDeletion = createProjectPermanentDeletionState();
}

export function resetSessionState() {
  state.auth = {
    status: "idle",
    message: "",
    session: null,
  };
  state.teams = [];
  state.projects = [];
  state.deletedProjects = [];
  state.users = [];
  state.orgDiscovery = { status: "idle", error: "" };
  state.projectDiscovery = { status: "idle", error: "" };
  state.userDiscovery = { status: "idle", error: "" };
  resetTeamSetup();
  resetProjectCreation();
  resetProjectDeletion();
  resetProjectPermanentDeletion();
  state.showDeletedProjects = false;
}
