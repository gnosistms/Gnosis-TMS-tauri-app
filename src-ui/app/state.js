import { splitStoredTeamRecords } from "./team-storage.js";

const initialStoredTeams = splitStoredTeamRecords();

export const state = {
  screen: "start",
  expandedProjects: new Set(["p2"]),
  selectedTeamId: null,
  selectedProjectId: "p2",
  selectedGlossaryId: "g1",
  selectedChapterId: "c2",
  teams: initialStoredTeams.activeTeams,
  deletedTeams: initialStoredTeams.deletedTeams,
  projects: [],
  deletedProjects: [],
  users: [],
  auth: {
    status: "idle",
    message: "",
    session: null,
  },
  githubAppTest: createGithubAppTestState(),
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
  sync: {
    teams: "idle",
  },
  pageSync: createPageSyncState(),
  teamSetup: createTeamSetupState(),
  teamRename: createTeamRenameState(),
  teamPermanentDeletion: createTeamPermanentDeletionState(),
  teamLeave: createTeamLeaveState(),
  projectCreation: createProjectCreationState(),
  projectRename: createProjectRenameState(),
  projectDeletion: createProjectDeletionState(),
  projectPermanentDeletion: createProjectPermanentDeletionState(),
  showDeletedProjects: false,
  showDeletedTeams: false,
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

export function createGithubAppTestState() {
  return {
    configStatus: "idle",
    status: "idle",
    message: "",
    config: null,
    installationId: null,
    installation: null,
    repositories: [],
  };
}

export function createTeamRenameState() {
  return {
    isOpen: false,
    teamId: null,
    teamName: "",
    status: "idle",
    error: "",
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

export function createTeamPermanentDeletionState() {
  return {
    isOpen: false,
    teamId: null,
    teamName: "",
    confirmationText: "",
    status: "idle",
    error: "",
  };
}

export function createTeamLeaveState() {
  return {
    isOpen: false,
    teamId: null,
    teamName: "",
    status: "idle",
    error: "",
  };
}

export function createProjectRenameState() {
  return {
    isOpen: false,
    projectId: null,
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

export function resetTeamRename() {
  state.teamRename = createTeamRenameState();
}

export function resetProjectCreation() {
  state.projectCreation = createProjectCreationState();
}

export function resetTeamPermanentDeletion() {
  state.teamPermanentDeletion = createTeamPermanentDeletionState();
}

export function resetTeamLeave() {
  state.teamLeave = createTeamLeaveState();
}

export function resetProjectRename() {
  state.projectRename = createProjectRenameState();
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
  state.githubAppTest = createGithubAppTestState();
  state.teams = [];
  state.deletedTeams = [];
  state.projects = [];
  state.deletedProjects = [];
  state.users = [];
  state.orgDiscovery = { status: "idle", error: "" };
  state.projectDiscovery = { status: "idle", error: "" };
  state.userDiscovery = { status: "idle", error: "" };
  state.sync = { teams: "idle" };
  state.pageSync = createPageSyncState();
  resetTeamSetup();
  resetTeamRename();
  resetTeamPermanentDeletion();
  resetTeamLeave();
  resetProjectCreation();
  resetProjectRename();
  resetProjectDeletion();
  resetProjectPermanentDeletion();
  state.showDeletedProjects = false;
  state.showDeletedTeams = false;
}

function createPageSyncState() {
  return {
    status: "idle",
  };
}
