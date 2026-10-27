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
    researchProcedure: "compact",
    sampleSize: 40,
    spendingLimitUsd: 4,
    seed: "1",
    pauseForReview: true,
    formError: "",
    existingMatches: [],
    unsupportedProviderName: "",
    // run view
    runId: null,
    runStatus: "idle", // running | spellings | review | counting | done | stopped | failed
    spellingSuggestions: [],
    spellingTicked: [],
    spellingError: "",
    stageLabel: "",
    progress: 0,
    spent: 0,
    limit: 4,
    log: [],
    runError: "",
    stopKind: "",
    paused: false, // no new AI request starts until the person continues
    proposalDraft: null,
    reviewError: "",
    // where the user came from (editor flow returns there on cancel)
    origin: null,
  };
}

/** The editor window that makes a glossary entry from highlighted text. */
export function createEditorGlossaryEntryState() {
  return {
    isOpen: false,
    // finding | entry | not-found | blocked
    step: "entry",
    chapterId: null,
    rowId: null,
    projectId: null,
    glossary: null, // { glossaryId, repoName, … } as the glossary page opens it
    // source | target | other: the language the text was highlighted in
    selectionRole: "",
    selectionLanguage: null, // { code, name }
    selectedText: "",
    sourceLanguage: null,
    targetLanguage: null,
    sourceTerm: "",
    targetTerm: "",
    requestId: "", // the AI request that finds the source text, while it runs
    notice: "",
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
