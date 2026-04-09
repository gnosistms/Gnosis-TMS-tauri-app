import {
  clearActiveStorageLogin,
  splitStoredTeamRecords,
  loadStoredTeamPendingMutations,
} from "./team-storage.js";
import { loadStoredEditorFontSizePx } from "./editor-preferences.js";

export const DEFAULT_EDITOR_FONT_SIZE_PX = 20;
export const EDITOR_FONT_SIZE_OPTIONS = [16, 18, 20, 22, 24, 26, 28];

export function coerceEditorFontSizePx(value) {
  const nextValue = Number.parseInt(String(value ?? ""), 10);
  return EDITOR_FONT_SIZE_OPTIONS.includes(nextValue) ? nextValue : DEFAULT_EDITOR_FONT_SIZE_PX;
}

export const state = {
  screen: "start",
  expandedProjects: new Set(),
  expandedDeletedFiles: new Set(),
  selectedTeamId: null,
  selectedProjectId: null,
  selectedGlossaryId: null,
  selectedChapterId: null,
  teams: [],
  deletedTeams: [],
  projects: [],
  deletedProjects: [],
  glossaries: [],
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
  glossaryDiscovery: {
    status: "idle",
    error: "",
  },
  projectImport: createProjectImportState(),
  projectRepoSyncByProjectId: {},
  editorChapter: createEditorChapterState(),
  targetLanguageManager: createTargetLanguageManagerState(),
  glossaryEditor: createGlossaryEditorState(),
  userDiscovery: {
    status: "idle",
    error: "",
  },
  teamSyncVersion: 0,
  projectSyncVersion: 0,
  pendingTeamMutations: [],
  pendingProjectMutations: [],
  pendingChapterMutations: [],
  pageSync: createPageSyncState(),
  projectsPageSync: createProjectsPageSyncState(),
  teamSetup: createTeamSetupState(),
  teamRename: createTeamRenameState(),
  teamPermanentDeletion: createTeamPermanentDeletionState(),
  teamLeave: createTeamLeaveState(),
  teamMemberRemoval: createTeamMemberRemovalState(),
  projectCreation: createProjectCreationState(),
  inviteUser: createInviteUserState(),
  projectRename: createProjectRenameState(),
  projectPermanentDeletion: createProjectPermanentDeletionState(),
  chapterRename: createChapterRenameState(),
  chapterPermanentDeletion: createChapterPermanentDeletionState(),
  chapterGlossaryConflict: createChapterGlossaryConflictState(),
  glossaryCreation: createGlossaryCreationState(),
  glossaryRename: createGlossaryRenameState(),
  glossaryPermanentDeletion: createGlossaryPermanentDeletionState(),
  glossaryTermEditor: createGlossaryTermEditorState(),
  showDeletedProjects: false,
  showDeletedTeams: false,
  showDeletedGlossaries: false,
};

export function hydratePersistentAppState() {
  hydrateStoredTeamState();
  hydrateStoredEditorPreferences();
}

export function hydrateStoredTeamState() {
  const storedTeams = splitStoredTeamRecords();
  state.teams = storedTeams.activeTeams;
  state.deletedTeams = storedTeams.deletedTeams;
  state.pendingTeamMutations = loadStoredTeamPendingMutations();
  state.selectedTeamId =
    state.selectedTeamId && storedTeams.activeTeams.some((team) => team.id === state.selectedTeamId)
      ? state.selectedTeamId
      : storedTeams.activeTeams[0]?.id ?? null;
}

export function hydrateStoredEditorPreferences() {
  state.editorChapter = {
    ...state.editorChapter,
    fontSizePx: coerceEditorFontSizePx(loadStoredEditorFontSizePx()),
  };
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

export function createProjectsPageSyncState() {
  return {
    status: "idle",
    startedAt: null,
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

export function createEditorChapterState() {
  return {
    status: "idle",
    error: "",
    projectId: null,
    chapterId: null,
    fileTitle: "",
    languages: [],
    sourceWordCounts: {},
    selectedSourceLanguageCode: null,
    selectedTargetLanguageCode: null,
    persistedSourceLanguageCode: null,
    persistedTargetLanguageCode: null,
    selectionPersistStatus: "idle",
    fontSizePx: DEFAULT_EDITOR_FONT_SIZE_PX,
    collapsedLanguageCodes: new Set(),
    activeRowId: null,
    activeLanguageCode: null,
    history: createEditorHistoryState(),
    rows: [],
  };
}

export function createEditorHistoryState() {
  return {
    status: "idle",
    error: "",
    rowId: null,
    languageCode: null,
    requestKey: null,
    restoringCommitSha: null,
    expandedGroupKeys: new Set(),
    entries: [],
  };
}

export function createGlossaryEditorState() {
  return {
    status: "idle",
    error: "",
    glossaryId: null,
    repoName: "",
    title: "",
    lifecycleState: "active",
    sourceLanguage: null,
    targetLanguage: null,
    termCount: 0,
    searchQuery: "",
    terms: [],
  };
}

export function createTargetLanguageManagerState() {
  return createEntityModalState();
}

export function createGlossaryDiscoveryState() {
  return {
    status: "idle",
    error: "",
  };
}

export function createGlossaryCreationState() {
  return createEntityModalState({
    title: "",
    sourceLanguageCode: "",
    targetLanguageCode: "",
  });
}

export function createGlossaryRenameState() {
  return createEntityModalState({
    glossaryId: null,
    glossaryName: "",
  });
}

export function createGlossaryPermanentDeletionState() {
  return createEntityModalState({
    glossaryId: null,
    glossaryName: "",
    confirmationText: "",
  });
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

export function createTeamMemberRemovalState() {
  return createEntityModalState({
    teamId: null,
    teamName: "",
    username: "",
    memberName: "",
  });
}

export function createProjectRenameState() {
  return createEntityModalState({
    projectId: null,
    projectName: "",
  });
}

export function createChapterRenameState() {
  return createEntityModalState({
    projectId: null,
    chapterId: null,
    chapterName: "",
  });
}

export function createChapterPermanentDeletionState() {
  return createEntityModalState({
    projectId: null,
    chapterId: null,
    chapterName: "",
    confirmationText: "",
  });
}

export function createChapterGlossaryConflictState() {
  return createEntityModalState({
    chapterId: null,
    glossary1: null,
    glossary2: null,
    message: "",
  });
}

export function createGlossaryTermEditorState() {
  return createEntityModalState({
    glossaryId: null,
    termId: null,
    sourceTerms: [""],
    targetTerms: [""],
    sourceTermDuplicateWarning: "",
    redundantSourceVariantIndices: [],
    notesToTranslators: "",
    footnote: "",
    untranslated: false,
  });
}

export function resetInviteUser() {
  state.inviteUser = createInviteUserState();
}

export function resetTargetLanguageManager() {
  state.targetLanguageManager = createTargetLanguageManagerState();
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

export function resetTeamMemberRemoval() {
  state.teamMemberRemoval = createTeamMemberRemovalState();
}

export function resetProjectRename() {
  state.projectRename = createProjectRenameState();
}

export function resetChapterRename() {
  state.chapterRename = createChapterRenameState();
}

export function resetChapterPermanentDeletion() {
  state.chapterPermanentDeletion = createChapterPermanentDeletionState();
}

export function resetChapterGlossaryConflict() {
  state.chapterGlossaryConflict = createChapterGlossaryConflictState();
}

export function resetProjectPermanentDeletion() {
  state.projectPermanentDeletion = createProjectPermanentDeletionState();
}

export function resetGlossaryTermEditor() {
  state.glossaryTermEditor = createGlossaryTermEditorState();
}

export function resetGlossaryCreation() {
  state.glossaryCreation = createGlossaryCreationState();
}

export function resetGlossaryRename() {
  state.glossaryRename = createGlossaryRenameState();
}

export function resetGlossaryPermanentDeletion() {
  state.glossaryPermanentDeletion = createGlossaryPermanentDeletionState();
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
  state.selectedTeamId = null;
  state.projects = [];
  state.deletedProjects = [];
  state.selectedProjectId = null;
  state.glossaries = [];
  state.selectedGlossaryId = null;
  state.users = [];
  state.orgDiscovery = { status: "idle", error: "" };
  state.projectDiscovery = { status: "idle", error: "" };
  state.glossaryDiscovery = createGlossaryDiscoveryState();
  state.projectImport = createProjectImportState();
  state.projectRepoSyncByProjectId = {};
  state.editorChapter = createEditorChapterState();
  state.selectedChapterId = null;
  state.targetLanguageManager = createTargetLanguageManagerState();
  state.glossaryEditor = createGlossaryEditorState();
  state.userDiscovery = { status: "idle", error: "" };
  state.teamSyncVersion = 0;
  state.projectSyncVersion = 0;
  state.pendingTeamMutations = [];
  state.pendingProjectMutations = [];
  state.pendingChapterMutations = [];
  state.pageSync = createPageSyncState();
  state.projectsPageSync = createProjectsPageSyncState();
  state.offline = offlineState;
  state.connectionFailure = createConnectionFailureState();
  state.statusBadges = createStatusBadgesState();
  resetTeamSetup();
  resetTeamRename();
  resetTeamPermanentDeletion();
  resetTeamLeave();
  resetTeamMemberRemoval();
  resetProjectCreation();
  resetInviteUser();
  resetProjectRename();
  resetChapterRename();
  resetChapterPermanentDeletion();
  resetChapterGlossaryConflict();
  resetProjectPermanentDeletion();
  resetGlossaryCreation();
  resetGlossaryRename();
  resetGlossaryPermanentDeletion();
  resetGlossaryTermEditor();
  state.showDeletedProjects = false;
  state.showDeletedTeams = false;
  state.showDeletedGlossaries = false;
  state.expandedProjects = new Set();
  state.expandedDeletedFiles = new Set();
}

function createPageSyncState() {
  return {
    status: "idle",
    startedAt: null,
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
