import test from "node:test";
import assert from "node:assert/strict";

globalThis.document = {
  querySelector() {
    return null;
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
    dialog: {
      save: async () => null,
    },
  },
  __TAURI_INTERNALS__: null,
  open() {},
  addEventListener() {},
  removeEventListener() {},
  requestAnimationFrame(callback) {
    callback?.();
    return 1;
  },
  setTimeout() {
    return 1;
  },
  clearTimeout() {},
};

const { createStatusBadgesState, resetSessionState, state } = await import("./state.js");
const {
  closeProjectExportUnsupported,
  openProjectExport,
  selectProjectExportFormat,
  selectProjectExportLanguage,
  submitProjectExport,
} = await import("./project-export-flow.js");

function installProjectExportFixture() {
  resetSessionState();
  state.selectedTeamId = "team-1";
  state.teams = [{
    id: "team-1",
    installationId: 42,
  }];
  state.projects = [{
    id: "project-1",
    title: "Project",
    name: "project-repo",
    fullName: "org/project-repo",
    chapters: [{
      id: "chapter-1",
      name: "Chapter One",
      status: "active",
      selectedTargetLanguageCode: "en",
      languages: [
        { code: "es", name: "Spanish", role: "source" },
        { code: "en", name: "English", role: "target" },
      ],
    }],
  }];
  state.deletedProjects = [];
  state.statusBadges = createStatusBadgesState();
}

test.afterEach(() => {
  resetSessionState();
});

test("openProjectExport copies chapter context and defaults to target language", () => {
  installProjectExportFixture();
  let renderCount = 0;

  openProjectExport(() => {
    renderCount += 1;
  }, "chapter-1");

  assert.equal(renderCount, 1);
  assert.equal(state.projectExport.isOpen, true);
  assert.equal(state.projectExport.projectId, "project-1");
  assert.equal(state.projectExport.repoName, "project-repo");
  assert.equal(state.projectExport.projectFullName, "org/project-repo");
  assert.equal(state.projectExport.chapterName, "Chapter One");
  assert.equal(state.projectExport.languageCode, "en");
});

test("selectProjectExportFormat routes unsupported formats through unsupported modal state", () => {
  installProjectExportFixture();
  openProjectExport(() => {}, "chapter-1");

  selectProjectExportFormat(() => {}, "xlsx");

  assert.equal(state.projectExport.format, "");
  assert.equal(state.projectExport.unsupportedFormat, "xlsx");

  closeProjectExportUnsupported(() => {});

  assert.equal(state.projectExport.unsupportedFormat, "");
  assert.equal(state.projectExport.isOpen, true);
});

test("selectProjectExportLanguage only accepts chapter languages", () => {
  installProjectExportFixture();
  openProjectExport(() => {}, "chapter-1");
  selectProjectExportFormat(() => {}, "html");

  selectProjectExportLanguage(() => {}, "es");
  assert.equal(state.projectExport.languageCode, "es");

  selectProjectExportLanguage(() => {}, "fr");
  assert.equal(state.projectExport.languageCode, "");
});

test("submitProjectExport leaves modal open when save dialog is cancelled", async () => {
  installProjectExportFixture();
  openProjectExport(() => {}, "chapter-1");
  selectProjectExportFormat(() => {}, "txt");
  let invoked = false;

  await submitProjectExport(() => {}, {
    saveDialog: async () => null,
    invoke: async () => {
      invoked = true;
    },
  });

  assert.equal(invoked, false);
  assert.equal(state.projectExport.isOpen, true);
  assert.equal(state.projectExport.status, "idle");
});

test("submitProjectExport invokes native export with selected format and language", async () => {
  installProjectExportFixture();
  openProjectExport(() => {}, "chapter-1");
  selectProjectExportFormat(() => {}, "docx");
  const calls = [];

  await submitProjectExport(() => {}, {
    saveDialog: async (options) => {
      calls.push(["save", options]);
      return "/tmp/chapter.docx";
    },
    invoke: async (command, payload) => {
      calls.push(["invoke", command, payload]);
    },
  });

  assert.equal(calls[0][0], "save");
  assert.equal(calls[0][1].defaultPath, "Chapter One-en.docx");
  assert.deepEqual(calls[0][1].filters, [{ name: "DOCX document", extensions: ["docx"] }]);
  assert.equal(calls[1][1], "export_gtms_chapter_file");
  assert.deepEqual(calls[1][2], {
    input: {
      installationId: 42,
      repoName: "project-repo",
      projectId: "project-1",
      projectFullName: "org/project-repo",
      chapterId: "chapter-1",
      languageCode: "en",
      format: "docx",
      outputPath: "/tmp/chapter.docx",
    },
  });
  assert.equal(state.projectExport.isOpen, false);
  assert.equal(state.statusBadges.left.visible, true);
  assert.equal(state.statusBadges.left.text, "Exported Chapter One-en.docx.");
});

test("submitProjectExport keeps modal open and shows native export errors", async () => {
  installProjectExportFixture();
  openProjectExport(() => {}, "chapter-1");
  selectProjectExportFormat(() => {}, "html");

  await submitProjectExport(() => {}, {
    saveDialog: async () => "/tmp/chapter.html",
    invoke: async () => {
      throw new Error("export failed");
    },
  });

  assert.equal(state.projectExport.isOpen, true);
  assert.equal(state.projectExport.status, "idle");
  assert.match(state.projectExport.error, /export failed/);
});
