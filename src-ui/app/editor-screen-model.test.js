import test from "node:test";
import assert from "node:assert/strict";

import { applyEditorRegressionFixture } from "./editor-regression-fixture.js";
import { buildEditorScreenViewModel } from "./editor-screen-model.js";
import { state } from "./state.js";

function snapshotSharedState() {
  return {
    screen: state.screen,
    editorChapter: state.editorChapter,
    projects: state.projects,
    deletedProjects: state.deletedProjects,
    teams: state.teams,
    deletedTeams: state.deletedTeams,
    selectedTeamId: state.selectedTeamId,
    selectedProjectId: state.selectedProjectId,
    selectedChapterId: state.selectedChapterId,
    expandedProjects: state.expandedProjects,
    expandedDeletedFiles: state.expandedDeletedFiles,
    glossaries: state.glossaries,
    users: state.users,
    auth: state.auth,
    offline: state.offline,
  };
}

function restoreSharedState(snapshot) {
  state.screen = snapshot.screen;
  state.editorChapter = snapshot.editorChapter;
  state.projects = snapshot.projects;
  state.deletedProjects = snapshot.deletedProjects;
  state.teams = snapshot.teams;
  state.deletedTeams = snapshot.deletedTeams;
  state.selectedTeamId = snapshot.selectedTeamId;
  state.selectedProjectId = snapshot.selectedProjectId;
  state.selectedChapterId = snapshot.selectedChapterId;
  state.expandedProjects = snapshot.expandedProjects;
  state.expandedDeletedFiles = snapshot.expandedDeletedFiles;
  state.glossaries = snapshot.glossaries;
  state.users = snapshot.users;
  state.auth = snapshot.auth;
  state.offline = snapshot.offline;
}

test("buildEditorScreenViewModel exposes showContextAction only when user filters are active", () => {
  const snapshot = snapshotSharedState();

  try {
    applyEditorRegressionFixture(state, {
      rowCount: 4,
      searchQuery: "alpha",
    });

    let viewModel = buildEditorScreenViewModel(state);
    let firstRow = viewModel.contentRows.find((row) => row?.kind === "row");
    assert.equal(firstRow?.showContextAction, true);

    state.editorChapter = {
      ...state.editorChapter,
      filters: {
        ...state.editorChapter.filters,
        searchQuery: "",
        rowFilterMode: "show-all",
      },
    };

    viewModel = buildEditorScreenViewModel(state);
    firstRow = viewModel.contentRows.find((row) => row?.kind === "row");
    assert.equal(firstRow?.showContextAction, false);
  } finally {
    restoreSharedState(snapshot);
  }
});

test("buildEditorScreenViewModel shows translating placeholder in the active target section while ai translation is loading", () => {
  const snapshot = snapshotSharedState();

  try {
    const fixture = applyEditorRegressionFixture(state, {
      rowCount: 1,
      aiTranslate: {
        translate1: {
          status: "loading",
          rowId: "fixture-row-0001",
          sourceLanguageCode: "es",
          targetLanguageCode: "vi",
          requestKey: "request-1",
          sourceText: "alpha 0001 source text",
        },
      },
    });

    const viewModel = buildEditorScreenViewModel(state);
    const firstRow = viewModel.contentRows.find((row) => row?.id === fixture.firstRowId);
    const sourceSection = firstRow?.sections.find((section) => section.code === fixture.sourceCode);
    const targetSection = firstRow?.sections.find((section) => section.code === fixture.targetCode);

    assert.equal(sourceSection?.text, "alpha 0001 source text");
    assert.equal(targetSection?.text, "Translating...");
    assert.equal(targetSection?.isAiTranslating, true);
  } finally {
    restoreSharedState(snapshot);
  }
});

test("buildEditorScreenViewModel shows glossary preparation placeholder while a derived glossary is loading", () => {
  const snapshot = snapshotSharedState();

  try {
    const fixture = applyEditorRegressionFixture(state, {
      rowCount: 1,
      languages: [
        { code: "en", name: "English", role: "source" },
        { code: "es", name: "Spanish" },
        { code: "vi", name: "Vietnamese", role: "target" },
      ],
      aiTranslate: {
        translate1: {
          status: "loading",
          rowId: "fixture-row-0001",
          sourceLanguageCode: "en",
          targetLanguageCode: "vi",
          requestKey: "request-prepare-1",
          sourceText: "alpha 0001 en text",
        },
      },
    });
    state.editorChapter = {
      ...state.editorChapter,
      derivedGlossariesByRowId: {
        "fixture-row-0001": {
          status: "loading",
          error: "",
          requestKey: "request-prepare-1",
          translationSourceLanguageCode: "en",
          glossarySourceLanguageCode: "es",
          targetLanguageCode: "vi",
          translationSourceText: "alpha 0001 en text",
          glossarySourceText: "",
          glossarySourceTextOrigin: "generated",
          glossaryRevisionKey: "rev-1",
          entries: [],
          matcherModel: null,
        },
      },
    };

    const viewModel = buildEditorScreenViewModel(state);
    const firstRow = viewModel.contentRows.find((row) => row?.id === fixture.firstRowId);
    const targetSection = firstRow?.sections.find((section) => section.code === fixture.targetCode);

    assert.equal(targetSection?.text, "Preparing glossary...");
    assert.equal(targetSection?.isAiTranslating, true);
  } finally {
    restoreSharedState(snapshot);
  }
});

test("buildEditorScreenViewModel marks the translated alternate language field while loading", () => {
  const snapshot = snapshotSharedState();

  try {
    applyEditorRegressionFixture(state, {
      rowCount: 1,
      languages: [
        { code: "es", name: "Spanish", role: "source" },
        { code: "vi", name: "Vietnamese", role: "target" },
        { code: "fr", name: "French" },
      ],
      aiTranslate: {
        translate1: {
          status: "loading",
          rowId: "fixture-row-0001",
          sourceLanguageCode: "es",
          targetLanguageCode: "fr",
          requestKey: "request-2",
          sourceText: "alpha 0001 source text",
        },
      },
    });

    const viewModel = buildEditorScreenViewModel(state);
    const firstRow = viewModel.contentRows.find((row) => row?.id === "fixture-row-0001");
    const defaultTargetSection = firstRow?.sections.find((section) => section.code === "vi");
    const alternateTargetSection = firstRow?.sections.find((section) => section.code === "fr");

    assert.equal(defaultTargetSection?.text, "alpha 0001 target text");
    assert.equal(defaultTargetSection?.isAiTranslating, false);
    assert.equal(alternateTargetSection?.text, "Translating...");
    assert.equal(alternateTargetSection?.isAiTranslating, true);
  } finally {
    restoreSharedState(snapshot);
  }
});

test("buildEditorScreenViewModel rebuilds section footnote visibility when the footnote editor opens", () => {
  const snapshot = snapshotSharedState();

  try {
    applyEditorRegressionFixture(state, {
      rowCount: 1,
    });

    let viewModel = buildEditorScreenViewModel(state);
    let firstRow = viewModel.contentRows.find((row) => row?.id === "fixture-row-0001");
    let targetSection = firstRow?.sections.find((section) => section.code === "vi");

    assert.equal(targetSection?.hasVisibleFootnote, false);
    assert.equal(targetSection?.showAddFootnoteButton, true);

    state.editorChapter = {
      ...state.editorChapter,
      footnoteEditor: {
        rowId: "fixture-row-0001",
        languageCode: "vi",
      },
    };

    viewModel = buildEditorScreenViewModel(state);
    firstRow = viewModel.contentRows.find((row) => row?.id === "fixture-row-0001");
    targetSection = firstRow?.sections.find((section) => section.code === "vi");

    assert.equal(targetSection?.hasVisibleFootnote, true);
    assert.equal(targetSection?.isFootnoteEditorOpen, true);
    assert.equal(targetSection?.showAddFootnoteButton, false);
  } finally {
    restoreSharedState(snapshot);
  }
});

test("buildEditorScreenViewModel hides add-image buttons while an image editor is open", () => {
  const snapshot = snapshotSharedState();

  try {
    applyEditorRegressionFixture(state, {
      rowCount: 1,
    });

    state.editorChapter = {
      ...state.editorChapter,
      imageEditor: {
        rowId: "fixture-row-0001",
        languageCode: "vi",
        mode: "upload",
        urlDraft: "",
        invalidUrl: false,
        status: "idle",
      },
    };

    const viewModel = buildEditorScreenViewModel(state);
    const firstRow = viewModel.contentRows.find((row) => row?.id === "fixture-row-0001");
    const targetSection = firstRow?.sections.find((section) => section.code === "vi");

    assert.equal(targetSection?.isImageUploadEditorOpen, true);
    assert.equal(targetSection?.hasVisibleImage, true);
    assert.equal(targetSection?.showAddImageButtons, false);
  } finally {
    restoreSharedState(snapshot);
  }
});

test("buildEditorScreenViewModel keeps add-image buttons visible for invalid-url recovery", () => {
  const snapshot = snapshotSharedState();

  try {
    applyEditorRegressionFixture(state, {
      rowCount: 1,
    });

    state.editorChapter = {
      ...state.editorChapter,
      imageEditor: {
        rowId: "fixture-row-0001",
        languageCode: "vi",
        mode: null,
        urlDraft: "https://example.com/bad.png",
        invalidUrl: true,
        status: "idle",
      },
    };

    const viewModel = buildEditorScreenViewModel(state);
    const firstRow = viewModel.contentRows.find((row) => row?.id === "fixture-row-0001");
    const targetSection = firstRow?.sections.find((section) => section.code === "vi");

    assert.equal(targetSection?.showInvalidImageUrl, true);
    assert.equal(targetSection?.showAddImageButtons, true);
  } finally {
    restoreSharedState(snapshot);
  }
});

test("buildEditorScreenViewModel shows the image caption button only when an image exists", () => {
  const snapshot = snapshotSharedState();

  try {
    applyEditorRegressionFixture(state, {
      rowCount: 1,
      imagesByRowId: {
        "fixture-row-0001": {
          vi: {
            kind: "url",
            url: "https://example.com/image.png",
          },
        },
      },
    });

    let viewModel = buildEditorScreenViewModel(state);
    let firstRow = viewModel.contentRows.find((row) => row?.id === "fixture-row-0001");
    let targetSection = firstRow?.sections.find((section) => section.code === "vi");

    assert.equal(targetSection?.showAddImageCaptionButton, true);
    assert.equal(targetSection?.hasVisibleImageCaption, false);

    state.editorChapter = {
      ...state.editorChapter,
      rows: state.editorChapter.rows.map((row) => (
        row.rowId === "fixture-row-0001"
          ? {
              ...row,
              imageCaptions: {
                ...row.imageCaptions,
                vi: "Existing caption",
              },
              persistedImageCaptions: {
                ...row.persistedImageCaptions,
                vi: "Existing caption",
              },
            }
          : row
      )),
    };

    viewModel = buildEditorScreenViewModel(state);
    firstRow = viewModel.contentRows.find((row) => row?.id === "fixture-row-0001");
    targetSection = firstRow?.sections.find((section) => section.code === "vi");

    assert.equal(targetSection?.showAddImageCaptionButton, false);
    assert.equal(targetSection?.hasVisibleImageCaption, true);

    state.editorChapter = {
      ...state.editorChapter,
      imageCaptionEditor: {
        rowId: "fixture-row-0001",
        languageCode: "vi",
      },
    };

    viewModel = buildEditorScreenViewModel(state);
    firstRow = viewModel.contentRows.find((row) => row?.id === "fixture-row-0001");
    targetSection = firstRow?.sections.find((section) => section.code === "vi");

    assert.equal(targetSection?.showAddImageCaptionButton, false);

    state.editorChapter = {
      ...state.editorChapter,
      rows: state.editorChapter.rows.map((row) => (
        row.rowId === "fixture-row-0001"
          ? {
              ...row,
              images: {},
            }
          : row
      )),
    };
    viewModel = buildEditorScreenViewModel(state);
    firstRow = viewModel.contentRows.find((row) => row?.id === "fixture-row-0001");
    targetSection = firstRow?.sections.find((section) => section.code === "vi");

    assert.equal(targetSection?.showAddImageCaptionButton, false);
    assert.equal(targetSection?.hasVisibleImageCaption, false);
  } finally {
    restoreSharedState(snapshot);
  }
});
