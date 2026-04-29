import test from "node:test";
import assert from "node:assert/strict";

let invokeHandler = async () => null;

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
      invoke: async (...args) => invokeHandler(...args),
    },
    event: {
      listen: async () => () => {},
    },
  },
  setTimeout(callback) {
    callback?.();
    return 1;
  },
  clearTimeout() {},
  requestAnimationFrame(callback) {
    callback?.();
    return 1;
  },
};

const {
  buildImportedFileEntry,
  cancelProjectImportModal,
  closeProjectImportUploadError,
  continueProjectImportText,
  detectImportFileType,
  importProjectFile,
  importProjectFiles,
  PROJECT_IMPORT_ACCEPT,
  selectProjectImportSourceLanguage,
} = await import("./project-import-flow.js");
const { createProjectImportState, createStatusBadgesState, state } = await import("./state.js");
const { clearActiveStorageLogin, setActiveStorageLogin } = await import("./team-storage.js");
const { saveStoredDefaultGlossaryIdForTeam } = await import("./glossary-default-cache.js");

function resetProjectImportTestState() {
  clearActiveStorageLogin();
  state.projectImport = createProjectImportState();
  state.teams = [{ id: "team-1", installationId: 1, canManageProjects: true }];
  state.selectedTeamId = "team-1";
  state.projects = [{ id: "project-1", name: "project-repo", title: "Project" }];
  state.deletedProjects = [];
  state.glossaries = [];
  state.offline = { isEnabled: false };
  state.auth = {
    session: {
      sessionToken: "session-token",
    },
  };
  state.projectRepoSyncByProjectId = {};
  state.pendingChapterMutations = [];
  state.statusBadges = createStatusBadgesState();
  invokeHandler = async () => null;
  globalThis.document.testScrollList = null;
}

function importFile(name, content = "content") {
  return {
    name,
    arrayBuffer: async () => new TextEncoder().encode(content).buffer,
  };
}

function importedResult(fileName, index = 1) {
  return {
    chapterId: `chapter-${index}`,
    fileTitle: fileName.replace(/\.[^.]+$/, ""),
    projectTitle: "Project",
    sourceFileName: fileName,
    unitCount: 1,
    languages: [{ code: "en", name: "English", role: "source" }],
    sourceWordCounts: { en: 1 },
    selectedSourceLanguageCode: "en",
    selectedTargetLanguageCode: null,
  };
}

function installBatchImportInvokeHandler({ failFileNames = new Set() } = {}) {
  const calls = [];
  invokeHandler = async (command, payload = {}) => {
    calls.push({ command, payload });
    if (command === "import_xlsx_to_gtms" || command === "import_txt_to_gtms" || command === "import_docx_to_gtms") {
      const fileName = payload.input.fileName;
      if (failFileNames.has(fileName)) {
        throw new Error(`Import failed for ${fileName}`);
      }
      return importedResult(fileName, calls.length);
    }
    if (command === "reconcile_project_repo_sync_states") {
      return [];
    }
    if (command === "list_local_gtms_project_files") {
      return (payload.input?.projects ?? []).map((projectInput) => ({
        projectId: projectInput.projectId,
        repoName: projectInput.repoName,
        chapters: state.projects.find((project) => project.id === projectInput.projectId)?.chapters ?? [],
      }));
    }
    if (command === "update_gtms_chapter_glossary_links") {
      return {};
    }
    throw new Error(`Unexpected command: ${command}`);
  };
  return calls;
}

test("detectImportFileType supports XLSX, TXT, and DOCX", () => {
  assert.equal(detectImportFileType("chapter.xlsx"), "xlsx");
  assert.equal(detectImportFileType("chapter.TXT"), "txt");
  assert.equal(detectImportFileType("chapter.docx"), "docx");
  assert.equal(detectImportFileType("chapter.pdf"), null);
});

test("project import accept string includes plain text and DOCX", () => {
  assert.match(PROJECT_IMPORT_ACCEPT, /\.txt/);
  assert.match(PROJECT_IMPORT_ACCEPT, /text\/plain/);
  assert.match(PROJECT_IMPORT_ACCEPT, /\.docx/);
  assert.match(PROJECT_IMPORT_ACCEPT, /wordprocessingml\.document/);
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

test("DOCX import selection opens source language step before importing", async () => {
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
    name: "chapter.docx",
    arrayBuffer: async () => new ArrayBuffer(0),
  });

  assert.equal(state.projectImport.status, "selectingSourceLanguage");
  assert.equal(state.projectImport.pendingFileName, "chapter.docx");
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

test("batch project import imports valid XLSX files and refreshes once", async () => {
  resetProjectImportTestState();
  state.projectImport = {
    ...state.projectImport,
    isOpen: true,
    projectId: "project-1",
    projectTitle: "Project",
  };
  const calls = installBatchImportInvokeHandler();
  const statusTexts = [];

  await importProjectFiles(() => {
    const text = state.statusBadges.right.visible ? state.statusBadges.right.text : "";
    if (text) {
      statusTexts.push(text);
    }
  }, [
    importFile("one.xlsx"),
    importFile("two.xlsx"),
  ]);

  assert.deepEqual(
    calls
      .filter((call) => call.command === "import_xlsx_to_gtms")
      .map((call) => call.payload.input.fileName),
    ["one.xlsx", "two.xlsx"],
  );
  assert.equal(calls.filter((call) => call.command === "list_local_gtms_project_files").length, 1);
  assert.equal(state.projectImport.failedFileNames.length, 0);
  assert.equal(state.projectImport.isOpen, false);
  assert.ok(statusTexts.includes("Importing files..."));
  assert.ok(statusTexts.includes("Importing 1 of 2..."));
  assert.ok(statusTexts.includes("Importing 2 of 2..."));
  assert.ok(statusTexts.includes("Syncing project repo..."));
  assert.ok(statusTexts.includes("Refreshing file list..."));
});

test("project import assigns the default glossary to new files before refresh", async () => {
  resetProjectImportTestState();
  setActiveStorageLogin("project-import-default-test");
  state.projectImport = {
    ...state.projectImport,
    isOpen: true,
    projectId: "project-1",
    projectTitle: "Project",
  };
  state.glossaries = [{
    id: "glossary-1",
    repoName: "glossary-repo",
    title: "Default Glossary",
    lifecycleState: "active",
  }];
  saveStoredDefaultGlossaryIdForTeam(state.teams[0], "glossary-1");
  const calls = installBatchImportInvokeHandler();

  await importProjectFiles(() => {}, [
    importFile("one.xlsx"),
  ]);

  const updateCalls = calls.filter((call) => call.command === "update_gtms_chapter_glossary_links");
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0].payload.input.installationId, 1);
  assert.equal(updateCalls[0].payload.input.projectId, "project-1");
  assert.equal(updateCalls[0].payload.input.repoName, "project-repo");
  assert.equal(updateCalls[0].payload.input.chapterId, state.projects[0].chapters[0].id);
  assert.deepEqual(updateCalls[0].payload.input.glossary, {
    glossaryId: "glossary-1",
    repoName: "glossary-repo",
  });
  assert.deepEqual(state.projects[0].chapters[0].linkedGlossary, {
    glossaryId: "glossary-1",
    repoName: "glossary-repo",
  });
});

test("batch project import continues after unsupported and failed files", async () => {
  resetProjectImportTestState();
  state.projectImport = {
    ...state.projectImport,
    isOpen: true,
    projectId: "project-1",
    projectTitle: "Project",
  };
  const calls = installBatchImportInvokeHandler({
    failFileNames: new Set(["bad.xlsx"]),
  });

  await importProjectFiles(() => {}, [
    importFile("good.xlsx"),
    importFile("notes.pdf"),
    importFile("bad.xlsx"),
    importFile("later.xlsx"),
  ]);

  assert.deepEqual(
    calls
      .filter((call) => call.command === "import_xlsx_to_gtms")
      .map((call) => call.payload.input.fileName),
    ["good.xlsx", "bad.xlsx", "later.xlsx"],
  );
  assert.deepEqual(state.projectImport.failedFileNames, ["notes.pdf", "bad.xlsx"]);
});

test("batch project import asks once for text-like source language and applies it to TXT and DOCX files", async () => {
  resetProjectImportTestState();
  state.projectImport = {
    ...state.projectImport,
    isOpen: true,
    projectId: "project-1",
    projectTitle: "Project",
  };
  const calls = installBatchImportInvokeHandler();
  let renderCount = 0;

  await importProjectFiles(() => {
    renderCount += 1;
  }, [
    importFile("one.txt"),
    importFile("two.docx"),
  ]);

  assert.equal(state.projectImport.status, "selectingSourceLanguage");
  assert.equal(state.projectImport.isBatch, true);
  assert.equal(state.projectImport.pendingFiles.length, 2);
  assert.equal(renderCount, 1);

  state.projectImport.selectedSourceLanguageCode = "ja";
  await continueProjectImportText(() => {});

  assert.deepEqual(
    calls
      .filter((call) => call.command === "import_txt_to_gtms" || call.command === "import_docx_to_gtms")
      .map((call) => [call.command, call.payload.input.sourceLanguageCode]),
    [["import_txt_to_gtms", "ja"], ["import_docx_to_gtms", "ja"]],
  );
  assert.equal(state.projectImport.isOpen, false);
});

test("closing grouped upload error clears failed filenames", () => {
  resetProjectImportTestState();
  state.projectImport = {
    ...state.projectImport,
    failedFileNames: ["bad.docx"],
  };

  closeProjectImportUploadError(() => {});

  assert.deepEqual(state.projectImport.failedFileNames, []);
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
