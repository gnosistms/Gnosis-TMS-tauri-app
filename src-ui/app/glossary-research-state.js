// State shapes for Glossary Research (kept out of state.js to stay small).

export function createGlossaryResearchState() {
  return {
    isOpen: false,
    // form | unsupported | existing | run
    step: "form",
    term: "",
    variants: [],
    reportLanguageCode: "",
    reportLanguageMenuOpen: false,
    reportLanguagePickerOpen: false,
    reportLanguagePickerSelection: "",
    sourceMode: "samael",
    selectedProjectIds: [],
    projectPickerOpen: false,
    projectPickerDraft: [],
    advancedOpen: false,
    sampleSize: 100,
    spendingLimitUsd: 4,
    seed: "1",
    pauseForReview: false,
    formError: "",
    existingMatches: [],
    unsupportedProviderName: "",
    // run view
    runId: null,
    runStatus: "idle", // running | review | counting | done | stopped | failed
    stageLabel: "",
    progress: 0,
    spent: 0,
    limit: 4,
    log: [],
    runError: "",
    stopKind: "",
    proposalDraft: null,
    reviewError: "",
    // where the user came from (editor flow returns there on cancel)
    origin: null,
  };
}

export function createGlossaryResearchPrepState() {
  return {
    isOpen: false,
    // input | finding | not-found | confirm | blocked
    step: "input",
    chapterId: null,
    rowId: null,
    glossaryId: null,
    sourceLanguageCode: "",
    languages: [],
    selectedLanguageCode: "",
    term: "",
    identified: null,
    blockedMessage: "",
    error: "",
  };
}

export function createGlossaryResearchReportState() {
  return {
    glossaryId: null,
    runId: null,
    status: "idle", // loading | ready | error
    error: "",
    run: null,
    entryDrafts: {},
    expandedVariants: {},
    showAllExamples: {},
    returnScreen: "glossaryEditor",
  };
}
