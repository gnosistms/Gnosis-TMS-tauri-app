import { splitStoredTeamRecords, loadStoredTeamPendingMutations } from "./team-storage.js";

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
  offline: createOfflineState(),
  connectionFailure: createConnectionFailureState(),
  statusBadges: createStatusBadgesState(),
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
  teamSyncVersion: 0,
  projectSyncVersion: 0,
  pendingTeamMutations: loadStoredTeamPendingMutations(),
  pendingProjectMutations: [],
  pageSync: createPageSyncState(),
  teamSetup: createTeamSetupState(),
  teamRename: createTeamRenameState(),
  teamPermanentDeletion: createTeamPermanentDeletionState(),
  teamLeave: createTeamLeaveState(),
  projectCreation: createProjectCreationState(),
  inviteUser: createInviteUserState(),
  projectRename: createProjectRenameState(),
  projectPermanentDeletion: createProjectPermanentDeletionState(),
  showDeletedProjects: false,
  showDeletedTeams: false,
};

export function createOfflineState() {
  return {
    checked: false,
    hasConnection: true,
    hasLocalData: false,
    isEnabled: false,
    reconnecting: false,
  };
}

export function createStatusBadgesState() {
  return {
    left: {
      visible: false,
      text: "",
    },
    right: {
      visible: false,
      text: "",
      scope: null,
    },
  };
}

export function createConnectionFailureState() {
  return {
    isOpen: false,
    message: "",
    canGoOffline: false,
  };
}

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

export function createInviteUserState() {
  return {
    isOpen: false,
    query: "",
    selectedUserId: null,
    suggestions: [],
    suggestionsStatus: "idle",
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

export function resetInviteUser() {
  state.inviteUser = createInviteUserState();
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

export function resetProjectPermanentDeletion() {
  state.projectPermanentDeletion = createProjectPermanentDeletionState();
}

export function resetSessionState() {
  const offlineState = {
    ...state.offline,
    isEnabled: false,
    reconnecting: false,
  };
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
  state.teamSyncVersion = 0;
  state.projectSyncVersion = 0;
  state.pendingTeamMutations = [];
  state.pendingProjectMutations = [];
  state.pageSync = createPageSyncState();
  state.offline = offlineState;
  state.connectionFailure = createConnectionFailureState();
  state.statusBadges = createStatusBadgesState();
  resetTeamSetup();
  resetTeamRename();
  resetTeamPermanentDeletion();
  resetTeamLeave();
  resetProjectCreation();
  resetInviteUser();
  resetProjectRename();
  resetProjectPermanentDeletion();
  state.showDeletedProjects = false;
  state.showDeletedTeams = false;
}

function createPageSyncState() {
  return {
    status: "idle",
  };
}
