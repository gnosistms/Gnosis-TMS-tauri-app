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
  handleDroppedProjectImportPath,
  importProjectFile,
  importProjectFiles,
  openProjectImportModal,
  PROJECT_IMPORT_ACCEPT,
  retryProjectImportLink,
  selectProjectImportInputMode,
  selectProjectImportSourceLanguage,
  submitProjectImportLink,
  submitProjectImportPastedText,
  updateProjectImportLinkUrl,
  updateProjectImportPastedText,
} = await import("./project-import-flow.js");
const { createProjectImportState, createStatusBadgesState, state } = await import("./state.js");
const { clearActiveStorageLogin, setActiveStorageLogin } = await import("./team-storage.js");
const { saveStoredDefaultGlossaryIdForTeam } = await import("./glossary-default-cache.js");
const { queryClient } = await import("./query-client.js");
const { resetProjectWriteCoordinator } = await import("./project-write-coordinator.js");

function resetProjectImportTestState() {
  clearActiveStorageLogin();
  queryClient.clear();
  resetProjectWriteCoordinator();
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
    if (command === "import_project_files_to_gtms") {
      const files = Array.isArray(payload.input?.files) ? payload.input.files : [];
      return {
        imported: files
          .filter((file) => !failFileNames.has(file.fileName))
          .map((file, index) => importedResult(file.fileName, index + 1)),
        failedFiles: files
          .filter((file) => failFileNames.has(file.fileName))
          .map((file) => ({ fileName: file.fileName, error: `Import failed for ${file.fileName}` })),
        failedFileNames: files
          .filter((file) => failFileNames.has(file.fileName))
          .map((file) => file.fileName),
        canceled: false,
      };
    }
    if (command === "import_xlsx_to_gtms" || command === "import_txt_to_gtms" || command === "import_docx_to_gtms" || command === "import_html_to_gtms") {
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
    if (command === "cancel_project_import_batch") {
      return {};
    }
    throw new Error(`Unexpected command: ${command}`);
  };
  return calls;
}

test("detectImportFileType supports XLSX, TXT, DOCX, and HTML", () => {
  assert.equal(detectImportFileType("chapter.xlsx"), "xlsx");
  assert.equal(detectImportFileType("chapter.TXT"), "txt");
  assert.equal(detectImportFileType("chapter.docx"), "docx");
  assert.equal(detectImportFileType("chapter.html"), "html");
  assert.equal(detectImportFileType("chapter.htm"), "html");
  assert.equal(detectImportFileType("chapter.pdf"), null);
});

test("project import accept string includes plain text, DOCX, and HTML", () => {
  assert.match(PROJECT_IMPORT_ACCEPT, /\.txt/);
  assert.match(PROJECT_IMPORT_ACCEPT, /text\/plain/);
  assert.match(PROJECT_IMPORT_ACCEPT, /\.docx/);
  assert.match(PROJECT_IMPORT_ACCEPT, /wordprocessingml\.document/);
  assert.match(PROJECT_IMPORT_ACCEPT, /\.html/);
  assert.match(PROJECT_IMPORT_ACCEPT, /\.htm/);
  assert.match(PROJECT_IMPORT_ACCEPT, /text\/html/);
});

test("project import modal opens during background project refresh", () => {
  resetProjectImportTestState();
  state.projectsPage = {
    isRefreshing: true,
    writeState: "idle",
  };
  let rendered = false;

  openProjectImportModal(() => {
    rendered = true;
  }, "project-1");

  assert.equal(state.projectImport.isOpen, true);
  assert.equal(state.projectImport.projectId, "project-1");
  assert.equal(state.projectImport.status, "idle");
  assert.equal(rendered, true);
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

test("HTML import selection opens source language step before importing", async () => {
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
    name: "article.html",
    arrayBuffer: async () => new ArrayBuffer(0),
  });

  assert.equal(state.projectImport.status, "selectingSourceLanguage");
  assert.equal(state.projectImport.pendingFileName, "article.html");
  assert.equal(renderCount, 1);
});

test("HTML import continues with source language and local source metadata", async () => {
  resetProjectImportTestState();
  state.projectImport = {
    ...state.projectImport,
    isOpen: true,
    projectId: "project-1",
    projectTitle: "Project",
  };
  const calls = installBatchImportInvokeHandler();

  await importProjectFile(() => {}, {
    name: "article.html",
    sourcePath: "/tmp/article.html",
    sourceUrl: "file:///tmp/article.html",
    arrayBuffer: async () => new TextEncoder().encode("<html><body>Article</body></html>").buffer,
  });

  assert.equal(state.projectImport.status, "selectingSourceLanguage");
  state.projectImport.selectedSourceLanguageCode = "vi";
  await continueProjectImportText(() => {});

  const importCall = calls.find((call) => call.command === "import_html_to_gtms");
  assert.equal(importCall.payload.input.fileName, "article.html");
  assert.equal(importCall.payload.input.sourceLanguageCode, "vi");
  assert.equal(importCall.payload.input.sourcePath, "/tmp/article.html");
  assert.equal(importCall.payload.input.sourceUrl, "file:///tmp/article.html");
  assert.ok(Array.isArray(importCall.payload.input.bytes));
});

test("HTML import keeps the new chapter visible when the immediate refresh listing is stale", async () => {
  resetProjectImportTestState();
  state.projectImport = {
    ...state.projectImport,
    isOpen: true,
    projectId: "project-1",
    projectTitle: "Project",
  };
  const renderSnapshots = [];
  invokeHandler = async (command, payload = {}) => {
    if (command === "import_html_to_gtms") {
      return importedResult(payload.input.fileName, 1);
    }
    if (command === "reconcile_project_repo_sync_states") {
      return [];
    }
    if (command === "list_local_gtms_project_files") {
      return [{ projectId: "project-1", repoName: "project-repo", chapters: [] }];
    }
    throw new Error(`Unexpected command: ${command}`);
  };
  const render = () => {
    renderSnapshots.push(state.projects[0]?.chapters?.map((chapter) => chapter.id) ?? []);
  };

  await importProjectFile(render, {
    name: "article.html",
    arrayBuffer: async () => new TextEncoder().encode("<html><body>Article</body></html>").buffer,
  });
  state.projectImport.selectedSourceLanguageCode = "en";
  await continueProjectImportText(render);

  assert.deepEqual(state.projects[0].chapters.map((chapter) => chapter.id), ["chapter-1"]);
  assert.ok(
    renderSnapshots.some((chapterIds) => chapterIds.includes("chapter-1")),
    "the imported chapter should be rendered optimistically",
  );
  assert.equal(
    renderSnapshots.some((chapterIds, index) =>
      index > 0
      && renderSnapshots[index - 1].includes("chapter-1")
      && !chapterIds.includes("chapter-1")
    ),
    false,
    "the imported chapter should not disappear during stale refresh",
  );
});

test("dropped local HTML path preserves source metadata for image resolution", async () => {
  resetProjectImportTestState();
  state.projectImport = {
    ...state.projectImport,
    isOpen: true,
    projectId: "project-1",
    projectTitle: "Project",
  };
  invokeHandler = async (command, payload = {}) => {
    if (command === "read_local_dropped_file") {
      assert.equal(payload.path, "/tmp/article.html");
      return {
        name: "article.html",
        mimeType: "text/html",
        dataBase64: "PGh0bWw+PC9odG1sPg==",
      };
    }
    throw new Error(`Unexpected command: ${command}`);
  };

  await handleDroppedProjectImportPath(() => {}, "/tmp/article.html");

  assert.equal(state.projectImport.status, "selectingSourceLanguage");
  assert.equal(state.projectImport.pendingFileName, "article.html");
  assert.equal(state.projectImport.pendingFile.sourcePath, "/tmp/article.html");
  assert.equal(state.projectImport.pendingFile.sourceUrl, "file:///tmp/article.html");
});

test("unsupported project import error includes HTML", async () => {
  resetProjectImportTestState();
  state.projectImport = {
    ...state.projectImport,
    isOpen: true,
    projectId: "project-1",
    projectTitle: "Project",
  };

  await importProjectFile(() => {}, {
    name: "chapter.pdf",
    arrayBuffer: async () => new ArrayBuffer(0),
  });

  assert.equal(state.projectImport.status, "error");
  assert.match(state.projectImport.error, /XLSX, TXT, DOCX, and HTML/);
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
    inputMode: "pasteText",
    status: "selectingSourceLanguage",
    pendingFile: { name: "chapter.txt" },
    pendingFileName: "chapter.txt",
    selectedSourceLanguageCode: "en",
    pastedText: "Pasted text",
  };

  cancelProjectImportModal(() => {});

  assert.equal(state.projectImport.isOpen, false);
  assert.equal(state.projectImport.inputMode, "upload");
  assert.equal(state.projectImport.pendingFile, null);
  assert.equal(state.projectImport.pendingFileName, "");
  assert.equal(state.projectImport.selectedSourceLanguageCode, "");
  assert.equal(state.projectImport.sourceLanguageScrollTop, 0);
  assert.equal(state.projectImport.pastedText, "");
});

test("project import input mode selection updates mode and clears stale errors", () => {
  resetProjectImportTestState();
  state.projectImport = {
    ...state.projectImport,
    isOpen: true,
    inputMode: "upload",
    status: "error",
    error: "Unsupported file type.",
  };
  let renderCount = 0;

  selectProjectImportInputMode(() => {
    renderCount += 1;
  }, "pasteLink");

  assert.equal(state.projectImport.inputMode, "pasteLink");
  assert.equal(state.projectImport.error, "");
  assert.equal(renderCount, 1);
});

test("project import input mode selection clears pasted text when switching away", () => {
  resetProjectImportTestState();
  state.projectImport = {
    ...state.projectImport,
    isOpen: true,
    inputMode: "pasteText",
    pastedText: "Existing pasted text",
  };

  selectProjectImportInputMode(() => {}, "upload");

  assert.equal(state.projectImport.inputMode, "upload");
  assert.equal(state.projectImport.pastedText, "");
});

test("project import input mode selection ignores changes while importing", () => {
  resetProjectImportTestState();
  state.projectImport = {
    ...state.projectImport,
    isOpen: true,
    inputMode: "upload",
    status: "importing",
  };
  let renderCount = 0;

  selectProjectImportInputMode(() => {
    renderCount += 1;
  }, "pasteText");

  assert.equal(state.projectImport.inputMode, "upload");
  assert.equal(renderCount, 0);
});

test("project import input mode selection ignores changes while resolving a link", () => {
  resetProjectImportTestState();
  state.projectImport = {
    ...state.projectImport,
    isOpen: true,
    inputMode: "pasteLink",
    linkUrl: "https://example.com/article",
    status: "resolvingLink",
  };
  let renderCount = 0;

  selectProjectImportInputMode(() => {
    renderCount += 1;
  }, "upload");

  assert.equal(state.projectImport.inputMode, "pasteLink");
  assert.equal(state.projectImport.linkUrl, "https://example.com/article");
  assert.equal(renderCount, 0);
});

test("project import link input updates the paste link URL", () => {
  resetProjectImportTestState();
  state.projectImport = {
    ...state.projectImport,
    isOpen: true,
    inputMode: "pasteLink",
  };
  let renderCount = 0;

  updateProjectImportLinkUrl(() => {
    renderCount += 1;
  }, "https://example.com/article");

  assert.equal(state.projectImport.linkUrl, "https://example.com/article");
  assert.equal(renderCount, 1);
});

test("project import pasted text input updates the paste text value", () => {
  resetProjectImportTestState();
  state.projectImport = {
    ...state.projectImport,
    isOpen: true,
    inputMode: "pasteText",
  };
  let renderCount = 0;

  updateProjectImportPastedText(() => {
    renderCount += 1;
  }, "Line one\nLine two");

  assert.equal(state.projectImport.pastedText, "Line one\nLine two");
  assert.equal(renderCount, 1);
});

test("project import pasted text submit validates non-blank text", async () => {
  resetProjectImportTestState();
  state.projectImport = {
    ...state.projectImport,
    isOpen: true,
    inputMode: "pasteText",
    projectId: "project-1",
    projectTitle: "Project",
    pastedText: "  \n  ",
  };
  let renderCount = 0;

  await submitProjectImportPastedText(() => {
    renderCount += 1;
  });

  assert.equal(state.projectImport.error, "Paste text before continuing.");
  assert.equal(state.projectImport.status, "idle");
  assert.equal(renderCount, 1);
});

test("project import pasted text opens source language selection with synthetic TXT file", async () => {
  resetProjectImportTestState();
  state.projectImport = {
    ...state.projectImport,
    isOpen: true,
    inputMode: "pasteText",
    projectId: "project-1",
    projectTitle: "Project",
    pastedText: "Line one\nLine two",
  };
  let renderCount = 0;

  await submitProjectImportPastedText(() => {
    renderCount += 1;
  });

  assert.equal(state.projectImport.status, "selectingSourceLanguage");
  assert.equal(state.projectImport.pendingFileName, "Pasted text.txt");
  assert.equal(typeof state.projectImport.pendingFile.dataBase64, "string");
  assert.equal(renderCount, 1);
});

test("project import pasted text continues through TXT import with UTF-8 bytes", async () => {
  resetProjectImportTestState();
  state.projectImport = {
    ...state.projectImport,
    isOpen: true,
    inputMode: "pasteText",
    projectId: "project-1",
    projectTitle: "Project",
    pastedText: "Line one\n世界",
  };
  const calls = installBatchImportInvokeHandler();

  await submitProjectImportPastedText(() => {});
  selectProjectImportSourceLanguage(() => {}, "en");
  await continueProjectImportText(() => {});

  const importCall = calls.find((call) => call.command === "import_txt_to_gtms");
  assert.equal(importCall.payload.input.fileName, "Pasted text.txt");
  assert.equal(importCall.payload.input.sourceLanguageCode, "en");
  assert.equal(
    new TextDecoder().decode(Uint8Array.from(importCall.payload.input.bytes)),
    "Line one\n世界",
  );
  assert.equal(state.projectImport.isOpen, false);
  assert.equal(state.projectImport.pastedText, "");
});

test("project import Google Docs link opens source language selection with DOCX file", async () => {
  resetProjectImportTestState();
  state.projectImport = {
    ...state.projectImport,
    isOpen: true,
    inputMode: "pasteLink",
    projectId: "project-1",
    projectTitle: "Project",
    linkUrl: "https://docs.google.com/document/d/doc-id/edit",
  };
  const calls = [];
  invokeHandler = async (command, payload = {}) => {
    calls.push({ command, payload });
    if (command === "resolve_project_import_link") {
      return {
        fileType: "docx",
        fileName: "google-doc.docx",
        dataBase64: "ZGF0YQ==",
        sourceUrl: payload.input.url,
      };
    }
    throw new Error(`Unexpected command: ${command}`);
  };
  let renderCount = 0;

  await submitProjectImportLink(() => {
    renderCount += 1;
  });

  assert.deepEqual(
    calls.map((call) => call.command).filter((command) => command === "resolve_project_import_link"),
    ["resolve_project_import_link"],
  );
  assert.equal(state.projectImport.status, "selectingSourceLanguage");
  assert.equal(state.projectImport.pendingFileName, "google-doc.docx");
  assert.equal(state.projectImport.pendingFile.sourceUrl, "https://docs.google.com/document/d/doc-id/edit");
  assert.ok(renderCount >= 2);
});

test("project import Google Sheets link imports through XLSX command", async () => {
  resetProjectImportTestState();
  state.projectImport = {
    ...state.projectImport,
    isOpen: true,
    inputMode: "pasteLink",
    projectId: "project-1",
    projectTitle: "Project",
    linkUrl: "https://docs.google.com/spreadsheets/d/sheet-id/edit",
  };
  const calls = installBatchImportInvokeHandler();
  invokeHandler = async (command, payload = {}) => {
    calls.push({ command, payload });
    if (command === "resolve_project_import_link") {
      return {
        fileType: "xlsx",
        fileName: "google-sheet.xlsx",
        dataBase64: "ZGF0YQ==",
        sourceUrl: payload.input.url,
      };
    }
    if (command === "import_xlsx_to_gtms") {
      return importedResult(payload.input.fileName);
    }
    if (command === "reconcile_project_repo_sync_states") {
      return [];
    }
    if (command === "list_local_gtms_project_files") {
      return [{ projectId: "project-1", repoName: "project-repo", chapters: [] }];
    }
    if (command === "update_gtms_chapter_glossary_links") {
      return {};
    }
    throw new Error(`Unexpected command: ${command}`);
  };

  await submitProjectImportLink(() => {});

  assert.deepEqual(
    calls.map((call) => call.command).filter((command) => command === "resolve_project_import_link" || command === "import_xlsx_to_gtms"),
    ["resolve_project_import_link", "import_xlsx_to_gtms"],
  );
  assert.equal(calls.find((call) => call.command === "import_xlsx_to_gtms").payload.input.fileName, "google-sheet.xlsx");
  assert.equal(state.projectImport.isOpen, false);
});

test("project import HTML link opens source language selection with HTML file", async () => {
  resetProjectImportTestState();
  state.projectImport = {
    ...state.projectImport,
    isOpen: true,
    inputMode: "pasteLink",
    projectId: "project-1",
    projectTitle: "Project",
    linkUrl: "https://example.com/article",
  };
  invokeHandler = async (command, payload = {}) => {
    if (command === "resolve_project_import_link") {
      return {
        fileType: "html",
        fileName: "article.html",
        dataBase64: "PGh0bWw+PC9odG1sPg==",
        sourceUrl: payload.input.url,
      };
    }
    throw new Error(`Unexpected command: ${command}`);
  };

  await submitProjectImportLink(() => {});

  assert.equal(state.projectImport.status, "selectingSourceLanguage");
  assert.equal(state.projectImport.pendingFileName, "article.html");
  assert.equal(state.projectImport.pendingFile.sourceUrl, "https://example.com/article");
});

test("project import link errors open the matching modal state and retry reuses the link", async () => {
  resetProjectImportTestState();
  state.projectImport = {
    ...state.projectImport,
    isOpen: true,
    inputMode: "pasteLink",
    projectId: "project-1",
    projectTitle: "Project",
    linkUrl: "https://docs.google.com/document/d/doc-id/edit",
  };
  let attempts = 0;
  invokeHandler = async (command) => {
    if (command === "resolve_project_import_link") {
      attempts += 1;
      throw new Error("PROJECT_IMPORT_LINK_ACCESS_DENIED:private file");
    }
    throw new Error(`Unexpected command: ${command}`);
  };

  await submitProjectImportLink(() => {});
  assert.equal(state.projectImport.linkErrorModal, "accessDenied");

  await retryProjectImportLink(() => {});
  assert.equal(attempts, 2);
  assert.equal(state.projectImport.linkUrl, "https://docs.google.com/document/d/doc-id/edit");
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
  const progressSnapshots = [];

  await importProjectFiles(() => {
    const text = state.statusBadges.right.visible ? state.statusBadges.right.text : "";
    if (text) {
      statusTexts.push(text);
    }
    if (state.projectImport.uploadProgress) {
      progressSnapshots.push({ ...state.projectImport.uploadProgress });
    }
  }, [
    importFile("one.xlsx"),
    importFile("two.xlsx"),
  ]);

  assert.deepEqual(
    calls
      .filter((call) => call.command === "import_project_files_to_gtms")
      .flatMap((call) => call.payload.input.files.map((file) => file.fileName)),
    ["one.xlsx", "two.xlsx"],
  );
  assert.equal(calls.filter((call) => call.command === "import_xlsx_to_gtms").length, 0);
  assert.equal(calls.filter((call) => call.command === "list_local_gtms_project_files").length, 1);
  assert.equal(state.projectImport.failedFileNames.length, 0);
  assert.equal(state.projectImport.isOpen, false);
  assert.deepEqual(progressSnapshots, [{ current: 1, total: 2 }]);
  assert.equal(statusTexts.includes("Importing files..."), false);
  assert.equal(statusTexts.includes("Importing 1 of 2..."), false);
  assert.equal(statusTexts.includes("Importing 2 of 2..."), false);
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

test("batch project import sends the default glossary in the batch payload", async () => {
  resetProjectImportTestState();
  setActiveStorageLogin("project-import-default-batch-test");
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
    importFile("two.xlsx"),
  ]);

  const batchCall = calls.find((call) => call.command === "import_project_files_to_gtms");
  assert.deepEqual(batchCall.payload.input.defaultGlossary, {
    glossaryId: "glossary-1",
    repoName: "glossary-repo",
  });
  assert.equal(calls.filter((call) => call.command === "update_gtms_chapter_glossary_links").length, 0);
  assert.deepEqual(state.projects[0].chapters.map((chapter) => chapter.linkedGlossary), [
    { glossaryId: "glossary-1", repoName: "glossary-repo" },
    { glossaryId: "glossary-1", repoName: "glossary-repo" },
  ]);
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
      .filter((call) => call.command === "import_project_files_to_gtms")
      .flatMap((call) => call.payload.input.files.map((file) => file.fileName)),
    ["good.xlsx", "bad.xlsx", "later.xlsx"],
  );
  assert.equal(calls.filter((call) => call.command === "import_xlsx_to_gtms").length, 0);
  assert.deepEqual(state.projectImport.failedFileNames, ["notes.pdf", "bad.xlsx"]);
});

test("canceling an upload import requests backend cancellation", async () => {
  resetProjectImportTestState();
  state.projectImport = {
    ...state.projectImport,
    isOpen: true,
    inputMode: "upload",
    projectId: "project-1",
    projectTitle: "Project",
  };
  const importCalls = [];
  const cancelCalls = [];
  let resolveBatchImportStarted;
  const batchImportStarted = new Promise((resolve) => {
    resolveBatchImportStarted = resolve;
  });
  let resolveBatchImport;
  const batchImport = new Promise((resolve) => {
    resolveBatchImport = resolve;
  });
  invokeHandler = async (command, payload = {}) => {
    if (command === "import_project_files_to_gtms") {
      importCalls.push(...payload.input.files.map((file) => file.fileName));
      resolveBatchImportStarted();
      await batchImport;
      return {
        imported: [importedResult("one.xlsx", 1)],
        failedFiles: [],
        failedFileNames: [],
        canceled: true,
      };
    }
    if (command === "cancel_project_import_batch") {
      cancelCalls.push(payload.batchId);
      return {};
    }
    if (command === "reconcile_project_repo_sync_states") {
      return [];
    }
    if (command === "list_local_gtms_project_files") {
      return [{ projectId: "project-1", repoName: "project-repo", chapters: state.projects[0]?.chapters ?? [] }];
    }
    if (command === "update_gtms_chapter_glossary_links") {
      return {};
    }
    throw new Error(`Unexpected command: ${command}`);
  };
  const notices = [];
  const render = () => {
    if (state.statusBadges.left.visible && state.statusBadges.left.text) {
      notices.push(state.statusBadges.left.text);
    }
  };

  const importPromise = importProjectFiles(render, [
    importFile("one.xlsx"),
    importFile("two.xlsx"),
  ]);
  await batchImportStarted;
  cancelProjectImportModal(render);
  assert.equal(state.projectImport.uploadCancelRequested, true);
  resolveBatchImport();
  await importPromise;

  assert.deepEqual(importCalls, ["one.xlsx", "two.xlsx"]);
  assert.equal(cancelCalls.length, 1);
  assert.equal(state.projectImport.isOpen, false);
  assert.equal(state.projectImport.uploadCancelRequested, false);
  assert.equal(state.projects[0].chapters.length, 1);
  assert.equal(state.projects[0].chapters[0].name, "one");
  assert.ok(notices.includes("Import cancelled after importing 1 of 2 files."));
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
      .filter((call) => call.command === "import_project_files_to_gtms")
      .flatMap((call) => call.payload.input.files.map((file) => [file.fileType, file.sourceLanguageCode])),
    [["txt", "ja"], ["docx", "ja"]],
  );
  assert.equal(calls.filter((call) => call.command === "import_txt_to_gtms" || call.command === "import_docx_to_gtms").length, 0);
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
