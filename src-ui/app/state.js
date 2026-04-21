import {
  clearActiveStorageLogin,
  splitStoredTeamRecords,
  loadStoredTeamPendingMutations,
} from "./team-storage.js";
import {
  AI_TRANSLATE_ACTION_IDS,
  createAiActionConfigurationState,
} from "./ai-action-config.js";
import { DEFAULT_AI_PROVIDER_ID } from "./ai-provider-config.js";
import {
  EDITOR_MODE_TRANSLATE,
  normalizeEditorMode,
  normalizeEditorPreviewSearchState,
} from "./editor-preview.js";
import { loadStoredAiActionPreferences } from "./ai-action-preferences.js";
import { loadStoredEditorFontSizePx } from "./editor-preferences.js";
import { createResourcePageState } from "./resource-page-controller.js";
import { createSyncState } from "./sync-state.js";

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
    status: "booting",
    message: "",
    session: null,
    pendingAutoOpenSingleTeam: false,
  },
  appUpdate: createAppUpdateState(),
  offline: createOfflineState(),
  connectionFailure: createConnectionFailureState(),
  navigationLoadingModal: createNavigationLoadingModalState(),
  statusBadges: createStatusBadgesState(),
  githubAppTest: createGithubAppTestState(),
  orgDiscovery: {
    status: "idle",
    error: "",
  },
  projectDiscovery: createProjectDiscoveryState(),
  glossaryDiscovery: createGlossaryDiscoveryState(),
  projectsPage: createResourcePageState(),
  projectsSearch: createProjectsSearchState(),
  glossariesPage: createResourcePageState(),
  projectImport: createProjectImportState(),
  projectRepoSyncByProjectId: {},
  projectRepoConflictRecovery: createProjectRepoConflictRecoveryState(),
  glossaryRepoSyncByRepoName: {},
  editorChapter: createEditorChapterState(),
  aiSettings: createAiSettingsState(),
  targetLanguageManager: createTargetLanguageManagerState(),
  glossaryEditor: createGlossaryEditorState(),
  userDiscovery: {
    status: "idle",
    error: "",
  },
  teamSyncVersion: 0,
  projectSyncVersion: 0,
  projectDiscoveryRequestId: 0,
  glossarySyncVersion: 0,
  pendingTeamMutations: [],
  pendingChapterMutations: [],
  pageSync: createSyncState(),
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
  glossaryCreation: createGlossaryCreationState(),
  glossaryRename: createGlossaryRenameState(),
  glossaryPermanentDeletion: createGlossaryPermanentDeletionState(),
  glossaryTermEditor: createGlossaryTermEditorState(),
  aiReviewMissingKeyModal: createAiReviewMissingKeyModalState(),
  showDeletedProjects: false,
  showDeletedTeams: false,
  showDeletedGlossaries: false,
};

export function hydratePersistentAppState() {
  hydrateStoredTeamState();
  hydrateStoredEditorPreferences();
  hydrateStoredAiSettingsPreferences();
}

function isOrganizationTeamRecord(team) {
  const accountType = String(team?.accountType ?? "").trim().toLowerCase();
  return accountType === "organization";
}

export function hydrateStoredTeamState() {
  const storedTeams = splitStoredTeamRecords();
  state.teams = storedTeams.activeTeams.filter(isOrganizationTeamRecord);
  state.deletedTeams = storedTeams.deletedTeams.filter(isOrganizationTeamRecord);
  state.pendingTeamMutations = loadStoredTeamPendingMutations();
  state.selectedTeamId =
    state.selectedTeamId && state.teams.some((team) => team.id === state.selectedTeamId)
      ? state.selectedTeamId
      : state.teams[0]?.id ?? null;
}

export function hydrateStoredEditorPreferences() {
  state.editorChapter = {
    ...state.editorChapter,
    fontSizePx: coerceEditorFontSizePx(loadStoredEditorFontSizePx()),
  };
}

export function hydrateStoredAiSettingsPreferences() {
  state.aiSettings = {
    ...state.aiSettings,
    actionConfig: {
      ...state.aiSettings.actionConfig,
      ...loadStoredAiActionPreferences(),
    },
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

export function createNavigationLoadingModalState() {
  return {
    isOpen: false,
    title: "",
    message: "",
    token: null,
  };
}

export function createAppUpdateState() {
  return {
    status: "idle",
    error: "",
    message: "",
    available: false,
    required: false,
    version: null,
    currentVersion: null,
    body: null,
    promptVisible: false,
    dismissedVersion: null,
  };
}

export function createProjectsPageSyncState() {
  return createSyncState();
}

export function createProjectRepoConflictRecoveryState() {
  return {
    teamId: null,
    status: "idle",
    error: "",
  };
}

export function createProjectsSearchState() {
  return {
    query: "",
    status: "idle",
    error: "",
    results: [],
    resultsById: {},
    total: 0,
    totalCapped: false,
    hasMore: false,
    nextOffset: 0,
    loadingMore: false,
    indexStatus: "idle",
    requestId: 0,
    queryTooShort: false,
    minimumQueryLength: 2,
  };
}

export function createProjectDiscoveryState() {
  return {
    status: "idle",
    error: "",
    glossaryWarning: "",
    recoveryMessage: "",
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
    step: "intro",
    status: "idle",
    error: "",
    githubAppInstallationId: null,
    githubAppInstallation: null,
    invalidInstallationAccountLogin: "",
    invalidInstallationAccountType: "",
    expectedOrganizationName: "",
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
    chapterBaseCommitSha: null,
    fileTitle: "",
    languages: [],
    sourceWordCounts: {},
    selectedSourceLanguageCode: null,
    selectedTargetLanguageCode: null,
    persistedSourceLanguageCode: null,
    persistedTargetLanguageCode: null,
    selectionPersistStatus: "idle",
    mode: EDITOR_MODE_TRANSLATE,
    previewSearch: createEditorPreviewSearchState(),
    fontSizePx: DEFAULT_EDITOR_FONT_SIZE_PX,
    collapsedLanguageCodes: new Set(),
    filters: createEditorChapterFilterState(),
    replace: createEditorReplaceState(),
    glossary: createEditorChapterGlossaryState(),
    derivedGlossariesByRowId: {},
    activeRowId: null,
    activeLanguageCode: null,
    mainFieldEditor: createEditorMainFieldEditorState(),
    pendingSelection: createEditorPendingSelectionState(),
    footnoteEditor: createEditorFootnoteEditorState(),
    imageCaptionEditor: createEditorImageCaptionEditorState(),
    imageEditor: createEditorImageEditorState(),
    imageInvalidFileModal: createEditorImageInvalidFileModalState(),
    imagePreviewOverlay: createEditorImagePreviewOverlayState(),
    sidebarTab: "review",
    reviewExpandedSectionKeys: new Set(["last-update", "ai-review"]),
    aiReview: createEditorAiReviewState(),
    aiTranslate: createEditorAiTranslateState(),
    assistant: createEditorAssistantState(),
    commentSeenRevisions: {},
    comments: createEditorCommentsState(),
    dirtyRowIds: new Set(),
    history: createEditorHistoryState(),
    deferredStructuralChanges: false,
    backgroundSyncStatus: "idle",
    backgroundSyncError: "",
    replaceUndoModal: createEditorReplaceUndoModalState(),
    conflictResolutionModal: createEditorConflictResolutionModalState(),
    unreviewAllModal: createEditorUnreviewAllModalState(),
    expandedDeletedRowGroupIds: new Set(),
    insertRowModal: createEditorInsertRowModalState(),
    rowPermanentDeletionModal: createEditorRowPermanentDeletionModalState(),
    rows: [],
  };
}

export function createEditorPreviewSearchState() {
  return normalizeEditorPreviewSearchState({
    query: "",
    activeMatchIndex: 0,
    totalMatchCount: 0,
  });
}

export function coerceEditorMode(value) {
  return normalizeEditorMode(value);
}

export function createEditorFootnoteEditorState() {
  return {
    rowId: null,
    languageCode: null,
  };
}

export function createEditorMainFieldEditorState() {
  return {
    rowId: null,
    languageCode: null,
  };
}

export function createEditorPendingSelectionState() {
  return {
    rowId: null,
    languageCode: null,
    offset: null,
  };
}

export function createEditorImageCaptionEditorState() {
  return {
    rowId: null,
    languageCode: null,
  };
}

export function createEditorImageEditorState() {
  return {
    rowId: null,
    languageCode: null,
    mode: null,
    urlDraft: "",
    invalidUrl: false,
    status: "idle",
  };
}

export function createEditorImageInvalidFileModalState() {
  return createEntityModalState();
}

export function createEditorImagePreviewOverlayState() {
  return {
    isOpen: false,
    rowId: null,
    languageCode: null,
    src: "",
  };
}

export function createEditorAiReviewState() {
  return {
    status: "idle",
    error: "",
    rowId: null,
    languageCode: null,
    requestKey: null,
    sourceText: "",
    suggestedText: "",
  };
}

export function createEditorAiTranslateActionState() {
  return {
    status: "idle",
    error: "",
    rowId: null,
    sourceLanguageCode: null,
    targetLanguageCode: null,
    requestKey: null,
    sourceText: "",
  };
}

export function createEditorAiTranslateState() {
  return Object.fromEntries(
    AI_TRANSLATE_ACTION_IDS.map((actionId) => [actionId, createEditorAiTranslateActionState()]),
  );
}

export function createEditorAssistantThreadState() {
  return {
    rowId: null,
    targetLanguageCode: null,
    items: [],
    providerContinuityByModelKey: {},
    lastTouchedAt: null,
  };
}

export function createEditorAssistantChapterArtifactsState() {
  return {
    documentDigestsBySourceLanguage: {},
  };
}

export function createEditorAssistantState() {
  return {
    status: "idle",
    error: "",
    requestKey: null,
    activeThreadKey: null,
    applyingItemId: null,
    composerDraft: "",
    threadsByKey: {},
    chapterArtifacts: createEditorAssistantChapterArtifactsState(),
  };
}

export function createAiSettingsState() {
  return {
    status: "idle",
    error: "",
    successMessage: "",
    providerId: DEFAULT_AI_PROVIDER_ID,
    apiKey: "",
    hasLoaded: false,
    returnScreen: "teams",
    modelValidationRequestId: 0,
    modelValidationStatus: "idle",
    modelValidationProviderId: "",
    actionMenuLoadingProviderIds: [],
    aboutModal: createAiSettingsAboutModalState(),
    modelErrorModal: createAiModelErrorModalState(),
    teamShared: createTeamAiSharedState(),
    actionConfig: createAiActionConfigurationState(),
  };
}

export function createAiReviewMissingKeyModalState() {
  return createEntityModalState({
    providerId: null,
    reason: "owner_missing",
    teamName: "",
  });
}

export function createTeamAiSharedState() {
  return {
    teamId: null,
    status: "idle",
    error: "",
    isOwner: false,
    settings: null,
    secrets: null,
    settingsSaveStatus: "idle",
    settingsSaveError: "",
  };
}

export function createAiSettingsAboutModalState() {
  return createEntityModalState({
    dontShowAgain: false,
  });
}

export function createAiModelErrorModalState() {
  return createEntityModalState({
    banner: "",
    message: "",
  });
}

export function createEditorChapterFilterState() {
  return {
    searchQuery: "",
    caseSensitive: false,
    rowFilterMode: "show-all",
  };
}

export function createEditorReplaceState() {
  return {
    enabled: false,
    replaceQuery: "",
    selectedRowIds: new Set(),
    status: "idle",
    error: "",
  };
}

export function createEditorInsertRowModalState() {
  return createEntityModalState({
    rowId: null,
  });
}

export function createEditorRowPermanentDeletionModalState() {
  return createEntityModalState({
    rowId: null,
  });
}

export function createEditorReplaceUndoModalState() {
  return createEntityModalState({
    commitSha: null,
  });
}

export function createEditorUnreviewAllModalState() {
  return createEntityModalState({
    languageCode: null,
  });
}

export function createEditorConflictResolutionModalState() {
  return createEntityModalState({
    rowId: null,
    languageCode: null,
    localText: "",
    remoteText: "",
    finalText: "",
    localFootnote: "",
    remoteFootnote: "",
    finalFootnote: "",
    localImageCaption: "",
    remoteImageCaption: "",
    finalImageCaption: "",
    remoteVersion: null,
  });
}

export function createEditorChapterGlossaryState() {
  return {
    status: "idle",
    error: "",
    glossaryId: null,
    repoName: "",
    title: "",
    sourceLanguage: null,
    targetLanguage: null,
    terms: [],
    matcherModel: null,
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

export function createEditorCommentsState() {
  return {
    status: "idle",
    error: "",
    rowId: null,
    requestKey: null,
    commentsRevision: 0,
    entries: [],
    draft: "",
    deletingCommentId: null,
  };
}

export function createGlossaryEditorState() {
  return {
    status: "idle",
    error: "",
    navigationSource: null,
    glossaryId: null,
    repoName: "",
    repoId: null,
    fullName: "",
    defaultBranchName: "main",
    defaultBranchHeadOid: null,
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
    brokerWarning: "",
    recoveryMessage: "",
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

export function resetProjectPermanentDeletion() {
  state.projectPermanentDeletion = createProjectPermanentDeletionState();
}

export function resetProjectsSearch() {
  state.projectsSearch = createProjectsSearchState();
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
    pendingAutoOpenSingleTeam: false,
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
  state.projectDiscovery = createProjectDiscoveryState();
  state.glossaryDiscovery = createGlossaryDiscoveryState();
  state.projectsSearch = createProjectsSearchState();
  state.projectImport = createProjectImportState();
  state.projectRepoSyncByProjectId = {};
  state.projectRepoConflictRecovery = createProjectRepoConflictRecoveryState();
  state.editorChapter = createEditorChapterState();
  state.aiSettings = createAiSettingsState();
  state.selectedChapterId = null;
  state.targetLanguageManager = createTargetLanguageManagerState();
  state.glossaryEditor = createGlossaryEditorState();
  state.userDiscovery = { status: "idle", error: "" };
  state.teamSyncVersion = 0;
  state.projectSyncVersion = 0;
  state.projectDiscoveryRequestId = 0;
  state.glossarySyncVersion = 0;
  state.pendingTeamMutations = [];
  state.pendingChapterMutations = [];
  state.pageSync = createSyncState();
  state.projectsPageSync = createProjectsPageSyncState();
  state.offline = offlineState;
  state.connectionFailure = createConnectionFailureState();
  state.navigationLoadingModal = createNavigationLoadingModalState();
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
  resetProjectPermanentDeletion();
  resetProjectsSearch();
  resetGlossaryCreation();
  resetGlossaryRename();
  resetGlossaryPermanentDeletion();
  resetGlossaryTermEditor();
  state.aiReviewMissingKeyModal = createAiReviewMissingKeyModalState();
  state.showDeletedProjects = false;
  state.showDeletedTeams = false;
  state.showDeletedGlossaries = false;
  state.expandedProjects = new Set();
  state.expandedDeletedFiles = new Set();
}

function createEntityModalState(fields = {}) {
  return {
    isOpen: false,
    status: "idle",
    error: "",
    ...fields,
  };
}
