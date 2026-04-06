import {
  clearActiveStorageLogin,
  splitStoredTeamRecords,
  loadStoredTeamPendingMutations,
} from "./team-storage.js";

export const state = {
  screen: "start",
  expandedProjects: new Set(["p2"]),
  selectedTeamId: null,
  selectedProjectId: "p2",
  selectedGlossaryId: "g1",
  selectedChapterId: "c2",
  teams: [],
  deletedTeams: [],
  projects: [],
  deletedProjects: [],
  users: [],
  auth: {
    status: "idle",
    message: "",
    session: null,
  },
  appUpdate: createAppUpdateState(),
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
  projectImport: createProjectImportState(),
  userDiscovery: {
    status: "idle",
    error: "",
  },
  teamSyncVersion: 0,
  projectSyncVersion: 0,
  pendingTeamMutations: [],
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

export function hydratePersistentAppState() {
  hydrateStoredTeamState();
}

export function hydrateStoredTeamState() {
  const storedTeams = splitStoredTeamRecords();
  state.teams = storedTeams.activeTeams;
  state.deletedTeams = storedTeams.deletedTeams;
  state.pendingTeamMutations = loadStoredTeamPendingMutations();
  state.selectedTeamId = state.selectedTeamId ?? storedTeams.activeTeams[0]?.id ?? null;
}

export function createOfflineState() {
  return {
    checked: false,
    hasConnection: true,
    hasLocalData: false,
    isEnabled: false,
    reconnecting: false,
  };
}

export function createAppUpdateState() {
  return {
    status: "idle",
    error: "",
    available: false,
    version: null,
    currentVersion: null,
    body: null,
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
  return createEntityModalState({
    teamId: null,
    teamName: "",
  });
}

export function createProjectCreationState() {
  return createEntityModalState({
    projectName: "",
  });
}

export function createProjectImportState() {
  return {
    status: "idle",
    error: "",
    result: null,
  };
}

export function createInviteUserState() {
  return {
    isOpen: false,
    step: "form",
    query: "",
    selectedUserId: null,
    selectedSuggestion: null,
    suggestions: [],
    suggestionsStatus: "idle",
    status: "idle",
    error: "",
  };
}

export function createTeamPermanentDeletionState() {
  return createEntityModalState({
    teamId: null,
    teamName: "",
    confirmationText: "",
  });
}

export function createTeamLeaveState() {
  return createEntityModalState({
    teamId: null,
    teamName: "",
  });
}

export function createProjectRenameState() {
  return createEntityModalState({
    projectId: null,
    projectName: "",
  });
}

export function resetInviteUser() {
  state.inviteUser = createInviteUserState();
}

export function createProjectPermanentDeletionState() {
  return createEntityModalState({
    projectId: null,
    projectName: "",
    confirmationText: "",
  });
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
  clearActiveStorageLogin();
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
  state.appUpdate = createAppUpdateState();
  state.githubAppTest = createGithubAppTestState();
  state.teams = [];
  state.deletedTeams = [];
  state.projects = [];
  state.deletedProjects = [];
  state.users = [];
  state.orgDiscovery = { status: "idle", error: "" };
  state.projectDiscovery = { status: "idle", error: "" };
  state.projectImport = createProjectImportState();
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

function createEntityModalState(fields = {}) {
  return {
    isOpen: false,
    status: "idle",
    error: "",
    ...fields,
  };
}
