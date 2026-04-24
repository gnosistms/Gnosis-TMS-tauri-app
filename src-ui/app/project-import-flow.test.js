import test from "node:test";
import assert from "node:assert/strict";

globalThis.document = {
  testScrollList: null,
  querySelector() {
    return this.testScrollList;
  },
  querySelectorAll() {
    return [];
  },
};
globalThis.window = {
  __TAURI__: {
    core: {
      invoke: async () => null,
    },
    event: {
      listen: async () => () => {},
    },
  },
  setTimeout(callback) {
    return 1;
  },
  clearTimeout() {},
};

const {
  buildImportedFileEntry,
  cancelProjectImportModal,
  detectImportFileType,
  importProjectFile,
  PROJECT_IMPORT_ACCEPT,
  selectProjectImportSourceLanguage,
} = await import("./project-import-flow.js");
const { createProjectImportState, state } = await import("./state.js");

function resetProjectImportTestState() {
  state.projectImport = createProjectImportState();
  state.teams = [{ id: "team-1", installationId: 1, canManageProjects: true }];
  state.selectedTeamId = "team-1";
  state.projects = [{ id: "project-1", name: "project-repo", title: "Project" }];
  state.deletedProjects = [];
  state.offline = { isEnabled: false };
  globalThis.document.testScrollList = null;
}

test("detectImportFileType supports XLSX and TXT", () => {
  assert.equal(detectImportFileType("chapter.xlsx"), "xlsx");
  assert.equal(detectImportFileType("chapter.TXT"), "txt");
  assert.equal(detectImportFileType("chapter.docx"), null);
});

test("project import accept string includes plain text", () => {
  assert.match(PROJECT_IMPORT_ACCEPT, /\.txt/);
  assert.match(PROJECT_IMPORT_ACCEPT, /text\/plain/);
});

test("TXT import selection opens source language step before importing", async () => {
  resetProjectImportTestState();
  state.projectImport = {
    ...state.projectImport,
    isOpen: true,
    projectId: "project-1",
    projectTitle: "Project",
  };
  let renderCount = 0;

  await importProjectFile(() => {
    renderCount += 1;
  }, {
    name: "chapter.txt",
    arrayBuffer: async () => new ArrayBuffer(0),
  });

  assert.equal(state.projectImport.status, "selectingSourceLanguage");
  assert.equal(state.projectImport.pendingFileName, "chapter.txt");
  assert.equal(state.projectImport.selectedSourceLanguageCode, "");
  assert.equal(renderCount, 1);
});

test("project import source language selection updates pending TXT state", () => {
  resetProjectImportTestState();
  state.projectImport = {
    ...state.projectImport,
    isOpen: true,
    status: "selectingSourceLanguage",
    pendingFile: { name: "chapter.txt" },
    pendingFileName: "chapter.txt",
  };
  let renderCount = 0;

  selectProjectImportSourceLanguage(() => {
    renderCount += 1;
  }, "EN");

  assert.equal(state.projectImport.selectedSourceLanguageCode, "en");
  assert.equal(renderCount, 1);
});

test("project import source language selection toggles and preserves list scroll", async () => {
  resetProjectImportTestState();
  const list = { scrollTop: 144 };
  globalThis.document.testScrollList = list;
  state.projectImport = {
    ...state.projectImport,
    isOpen: true,
    status: "selectingSourceLanguage",
    pendingFile: { name: "chapter.txt" },
    pendingFileName: "chapter.txt",
    selectedSourceLanguageCode: "en",
  };

  selectProjectImportSourceLanguage(() => {}, "en");
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(state.projectImport.selectedSourceLanguageCode, "");
  assert.equal(state.projectImport.sourceLanguageScrollTop, 144);
  assert.equal(list.scrollTop, 144);
});

test("canceling project import clears pending TXT state", () => {
  resetProjectImportTestState();
  state.projectImport = {
    ...state.projectImport,
    isOpen: true,
    status: "selectingSourceLanguage",
    pendingFile: { name: "chapter.txt" },
    pendingFileName: "chapter.txt",
    selectedSourceLanguageCode: "en",
  };

  cancelProjectImportModal(() => {});

  assert.equal(state.projectImport.isOpen, false);
  assert.equal(state.projectImport.pendingFile, null);
  assert.equal(state.projectImport.pendingFileName, "");
  assert.equal(state.projectImport.selectedSourceLanguageCode, "");
  assert.equal(state.projectImport.sourceLanguageScrollTop, 0);
});

test("imported TXT chapter entry does not fall back to source as target", () => {
  const entry = buildImportedFileEntry({
    chapterId: "chapter-1",
    fileTitle: "Chapter",
    languages: [{ code: "en", name: "English", role: "source" }],
    sourceWordCounts: { en: 3 },
    selectedSourceLanguageCode: "en",
    selectedTargetLanguageCode: null,
  });

  assert.equal(entry.selectedSourceLanguageCode, "en");
  assert.equal(entry.selectedTargetLanguageCode, null);
  assert.equal(entry.sourceWordCount, 3);
});
