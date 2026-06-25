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

const {
  createEditorChapterState,
  createStatusBadgesState,
  resetSessionState,
  state,
} = await import("./state.js");
const { clearActiveStorageLogin, setActiveStorageLogin } = await import("./team-storage.js");
const {
  loadStoredEditorExportDefault,
  saveStoredEditorExportDefault,
} = await import("./editor-export-defaults.js");
const { EDITOR_MODE_PREVIEW } = await import("./editor-preview.js");
const {
  findEditorExportOption,
  openEditorExportOptions,
  selectEditorExportOption,
} = await import("./editor-export-flow.js");
const {
  closeWordPressExportSuccessModal,
  connectWordPress,
  currentWordPressExportState,
  disconnectWordPress,
  ensureWordPressPaneReady,
  handleWordPressAuthEvent,
  handleWordPressExportProgressEvent,
  loadWordPressConnection,
  searchWordPressPosts,
  selectWordPressPost,
  selectedWordPressPost,
  setWordPressExportMode,
  submitWordPressExport,
  updateWordPressSearchQuery,
  updateWordPressTitle,
} = await import("./editor-export-wordpress-flow.js");

function installWordPressFixture(editorChapterOverrides = {}) {
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
      languages: [
        { code: "es", name: "Spanish", role: "source" },
        { code: "vi", name: "Vietnamese", role: "target" },
      ],
    }],
  }];
  state.deletedProjects = [];
  state.statusBadges = createStatusBadgesState();
  state.editorChapter = {
    ...createEditorChapterState(),
    chapterId: "chapter-1",
    projectId: "project-1",
    fileTitle: "Chapter One",
    mode: EDITOR_MODE_PREVIEW,
    languages: [
      { code: "es", name: "Spanish", role: "source" },
      { code: "vi", name: "Vietnamese", role: "target" },
    ],
    selectedSourceLanguageCode: "es",
    selectedTargetLanguageCode: "vi",
    rows: [{
      rowId: "row-1",
      lifecycleState: "active",
      textStyle: "paragraph",
      fields: { vi: "Text one[1]", es: "Texto uno" },
      footnotes: { vi: "footnote 1" },
    }],
    ...editorChapterOverrides,
  };
  openEditorExportOptions(() => {});
  state.editorChapter = {
    ...state.editorChapter,
    exportModal: {
      ...state.editorChapter.exportModal,
      selectedOptionId: "link:wordpress",
    },
  };
}

function setWordPress(patch) {
  state.editorChapter = {
    ...state.editorChapter,
    exportModal: {
      ...state.editorChapter.exportModal,
      wordpress: {
        ...state.editorChapter.exportModal.wordpress,
        ...patch,
      },
    },
  };
}

test.afterEach(() => {
  resetSessionState();
  clearActiveStorageLogin();
});

test("a successful export remembers the post and reopening defaults to overwriting it", async () => {
  installWordPressFixture();
  setActiveStorageLogin("tester");
  setWordPress({ jobId: "job-1" });
  state.editorChapter = {
    ...state.editorChapter,
    exportModal: { ...state.editorChapter.exportModal, status: "exporting" },
  };

  handleWordPressExportProgressEvent({
    jobId: "job-1",
    status: "success",
    message: "Created a new WordPress draft.",
    postLink: "https://example.wordpress.com/?p=24994",
    postId: 24994,
    postTitle: "Chương 3",
  }, () => {});

  assert.deepEqual(loadStoredEditorExportDefault("chapter-1"), {
    optionId: "link:wordpress",
    wordpress: { postId: 24994, postTitle: "Chương 3" },
  });

  // Reopen: the modal defaults to WordPress overwrite of the remembered post.
  openEditorExportOptions(() => {});
  assert.equal(state.editorChapter.exportModal.selectedOptionId, "link:wordpress");
  assert.ok(state.editorChapter.exportModal.expandedCategoryIds.includes("link"));
  const wordpress = currentWordPressExportState();
  assert.equal(wordpress.mode, "overwrite");
  assert.equal(wordpress.selectedPostId, 24994);
  assert.equal(wordpress.searchResults[0].title, "Chương 3");
});

test("remembered wordpress post survives a later non-WordPress default and restores when selected", () => {
  installWordPressFixture();
  setActiveStorageLogin("tester");
  setWordPress({ jobId: "job-1" });
  state.editorChapter = {
    ...state.editorChapter,
    exportModal: { ...state.editorChapter.exportModal, status: "exporting" },
  };

  handleWordPressExportProgressEvent({
    jobId: "job-1",
    status: "success",
    message: "Created a new WordPress draft.",
    postLink: "https://example.wordpress.com/?p=24994",
    postId: 24994,
    postTitle: "Chương 3",
  }, () => {});
  const nonWordPressOptionId = findEditorExportOption("copy:vellum")?.id ?? "copy:text";
  saveStoredEditorExportDefault("chapter-1", { optionId: nonWordPressOptionId });

  openEditorExportOptions(() => {});
  assert.equal(state.editorChapter.exportModal.selectedOptionId, nonWordPressOptionId);

  selectEditorExportOption(() => {}, "link:wordpress");

  assert.equal(state.editorChapter.exportModal.selectedOptionId, "link:wordpress");
  const wordpress = currentWordPressExportState();
  assert.equal(wordpress.mode, "overwrite");
  assert.equal(wordpress.selectedPostId, 24994);
  assert.equal(wordpress.searchResults[0].title, "Chương 3");
});

test("a draft export opens the success modal linking to the WordPress editor", () => {
  installWordPressFixture();
  setActiveStorageLogin("tester");
  setWordPress({ jobId: "job-1" });

  handleWordPressExportProgressEvent({
    jobId: "job-1",
    status: "success",
    message: "Created a new WordPress draft.",
    postLink: "https://example.wordpress.com/?p=24994",
    postEditLink: "https://wordpress.com/post/12345/24994",
    postId: 24994,
    postStatus: "draft",
    postTitle: "Chương 3",
  }, () => {});

  assert.deepEqual(state.editorChapter.wordpressExportSuccessModal, {
    isOpen: true,
    isDraft: true,
    url: "https://wordpress.com/post/12345/24994",
  });

  closeWordPressExportSuccessModal(() => {});
  assert.equal(state.editorChapter.wordpressExportSuccessModal.isOpen, false);
});

test("a published export opens the success modal linking to the live post", () => {
  installWordPressFixture();
  setActiveStorageLogin("tester");
  setWordPress({ jobId: "job-1" });

  handleWordPressExportProgressEvent({
    jobId: "job-1",
    status: "success",
    message: "Overwrote the WordPress post.",
    postLink: "https://example.wordpress.com/2026/06/11/chapter-3/",
    postEditLink: "https://wordpress.com/post/12345/24994",
    postId: 24994,
    postStatus: "publish",
    postTitle: "Chương 3",
  }, () => {});

  assert.deepEqual(state.editorChapter.wordpressExportSuccessModal, {
    isOpen: true,
    isDraft: false,
    url: "https://example.wordpress.com/2026/06/11/chapter-3/",
  });
});

test("a success payload without links falls back to the notice badge", () => {
  installWordPressFixture();
  setActiveStorageLogin("tester");
  setWordPress({ jobId: "job-1" });

  handleWordPressExportProgressEvent({
    jobId: "job-1",
    status: "success",
    message: "Created a new WordPress draft.",
    postId: 24994,
    postTitle: "Chương 3",
  }, () => {});

  assert.equal(state.editorChapter.wordpressExportSuccessModal.isOpen, false);
});

test("ensureWordPressPaneReady seeds the title and loads the connection once", async () => {
  installWordPressFixture();
  const invokeCalls = [];

  ensureWordPressPaneReady(() => {}, {
    invoke: async (command) => {
      invokeCalls.push(command);
      return { blogId: "12345", blogUrl: "https://example.wordpress.com" };
    },
  });
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(invokeCalls, ["get_wordpress_connection"]);
  const wordpress = currentWordPressExportState();
  assert.equal(wordpress.title, "Chapter One");
  assert.equal(wordpress.connectionStatus, "connected");
  assert.deepEqual(wordpress.connection, {
    blogId: "12345",
    blogUrl: "https://example.wordpress.com",
  });

  ensureWordPressPaneReady(() => {}, {
    invoke: async (command) => {
      invokeCalls.push(command);
      return null;
    },
  });
  await Promise.resolve();
  assert.deepEqual(invokeCalls, ["get_wordpress_connection"]);
});

test("ensureWordPressPaneReady seeds the title from a leading H1 row", async () => {
  installWordPressFixture({
    rows: [
      {
        rowId: "row-1",
        lifecycleState: "active",
        textStyle: "heading1",
        fields: { vi: "Chương 3 – Trận chiến" },
        footnotes: {},
      },
      {
        rowId: "row-2",
        lifecycleState: "active",
        textStyle: "paragraph",
        fields: { vi: "Body" },
        footnotes: {},
      },
    ],
  });

  ensureWordPressPaneReady(() => {}, { invoke: async () => null });
  await Promise.resolve();

  assert.equal(currentWordPressExportState().title, "Chương 3 – Trận chiến");
});

test("submitWordPressExport strips the leading H1 and sends it as the overwrite title", async () => {
  installWordPressFixture({
    rows: [
      {
        rowId: "row-1",
        lifecycleState: "active",
        textStyle: "heading1",
        fields: { vi: "Chương 3" },
        footnotes: {},
      },
      {
        rowId: "row-2",
        lifecycleState: "active",
        textStyle: "paragraph",
        fields: { vi: "Body" },
        footnotes: {},
      },
    ],
  });
  setWordPress({
    connectionStatus: "connected",
    connection: { blogId: "12345", blogUrl: "https://example.wordpress.com" },
    mode: "overwrite",
    searchResults: [{ id: 7, title: "Old title", status: "draft", link: "", modified: "" }],
    selectedPostId: 7,
    searchStatus: "done",
  });

  const invokeCalls = [];
  await submitWordPressExport(() => {}, {
    invoke: async (command, payload) => {
      invokeCalls.push({ command, payload });
    },
  });

  assert.equal(invokeCalls.length, 1);
  const input = invokeCalls[0].payload.input;
  assert.equal(input.mode, "overwrite");
  assert.equal(input.postId, 7);
  assert.equal(input.title, "Chương 3");
  assert.doesNotMatch(input.content, /wp:heading/);
  assert.match(input.content, /Body/);
  assert.doesNotMatch(input.content, /no_toc/);
});

test("submitWordPressExport sends no overwrite title without a leading H1", async () => {
  installWordPressFixture();
  setWordPress({
    connectionStatus: "connected",
    connection: { blogId: "12345", blogUrl: "https://example.wordpress.com" },
    mode: "overwrite",
    searchResults: [{ id: 7, title: "Old title", status: "draft", link: "", modified: "" }],
    selectedPostId: 7,
    searchStatus: "done",
    title: "typed but ignored for overwrite",
  });

  const invokeCalls = [];
  await submitWordPressExport(() => {}, {
    invoke: async (command, payload) => {
      invokeCalls.push({ command, payload });
    },
  });

  assert.equal(invokeCalls.length, 1);
  assert.equal(invokeCalls[0].payload.input.title, "");
});

test("loadWordPressConnection marks the pane disconnected without a stored connection", async () => {
  installWordPressFixture();

  await loadWordPressConnection(() => {}, { invoke: async () => null });

  assert.equal(currentWordPressExportState().connectionStatus, "disconnected");
});

test("connectWordPress opens the broker auth URL and waits for the callback", async () => {
  installWordPressFixture();
  const openedUrls = [];

  await connectWordPress(() => {}, {
    invoke: async (command) => {
      assert.equal(command, "begin_wordpress_auth");
      return { authUrl: "https://broker.example/auth/wordpress/start?state=x" };
    },
    openExternalUrl: (url) => openedUrls.push(url),
  });

  assert.deepEqual(openedUrls, ["https://broker.example/auth/wordpress/start?state=x"]);
  assert.equal(currentWordPressExportState().connectionStatus, "connecting");
});

test("handleWordPressAuthEvent applies success and error callbacks", () => {
  installWordPressFixture();
  setWordPress({ connectionStatus: "connecting" });

  handleWordPressAuthEvent({
    status: "success",
    message: "Connected.",
    connection: { blogId: "12345", blogUrl: "https://example.wordpress.com" },
  }, () => {});
  assert.equal(currentWordPressExportState().connectionStatus, "connected");
  assert.equal(currentWordPressExportState().connection.blogId, "12345");

  handleWordPressAuthEvent({ status: "error", message: "Sign-in failed." }, () => {});
  assert.equal(currentWordPressExportState().connectionStatus, "disconnected");
  assert.equal(state.editorChapter.exportModal.error, "Sign-in failed.");
});

test("disconnectWordPress clears the connection and search state", async () => {
  installWordPressFixture();
  setWordPress({
    connectionStatus: "connected",
    connection: { blogId: "12345", blogUrl: "https://example.wordpress.com" },
    searchResults: [{ id: 7, title: "Hello", status: "publish", link: "", modified: "" }],
    selectedPostId: 7,
    searchStatus: "done",
  });

  const invokeCalls = [];
  await disconnectWordPress(() => {}, {
    invoke: async (command) => {
      invokeCalls.push(command);
    },
  });

  assert.deepEqual(invokeCalls, ["disconnect_wordpress"]);
  const wordpress = currentWordPressExportState();
  assert.equal(wordpress.connectionStatus, "disconnected");
  assert.equal(wordpress.connection, null);
  assert.deepEqual(wordpress.searchResults, []);
  assert.equal(wordpress.selectedPostId, null);
});

test("search and post selection drive the overwrite picker", async () => {
  installWordPressFixture();
  setWordPress({ connectionStatus: "connected" });
  setWordPressExportMode(() => {}, "overwrite");
  updateWordPressSearchQuery("hello");

  await searchWordPressPosts(() => {}, {
    invoke: async (command, payload) => {
      assert.equal(command, "search_wordpress_posts");
      assert.equal(payload.search, "hello");
      return [
        { id: 7, title: "Hello World", status: "publish", link: "", modified: "" },
        { id: 9, title: "Other", status: "draft", link: "", modified: "" },
      ];
    },
  });

  const wordpress = currentWordPressExportState();
  assert.equal(wordpress.searchStatus, "done");
  assert.equal(wordpress.searchResults.length, 2);

  selectWordPressPost(() => {}, "7");
  assert.equal(currentWordPressExportState().selectedPostId, 7);
  assert.equal(selectedWordPressPost(currentWordPressExportState()).title, "Hello World");

  selectWordPressPost(() => {}, "999");
  assert.equal(currentWordPressExportState().selectedPostId, 7);
});

test("submitWordPressExport sends content, footnotes, and a job id for create", async () => {
  installWordPressFixture();
  setWordPress({
    connectionStatus: "connected",
    connection: { blogId: "12345", blogUrl: "https://example.wordpress.com" },
  });
  updateWordPressTitle("My Draft");

  const invokeCalls = [];
  await submitWordPressExport(() => {}, {
    invoke: async (command, payload) => {
      invokeCalls.push({ command, payload });
    },
  });

  assert.equal(invokeCalls.length, 1);
  assert.equal(invokeCalls[0].command, "export_chapter_to_wordpress");
  const input = invokeCalls[0].payload.input;
  assert.equal(input.installationId, 42);
  assert.equal(input.repoName, "project-repo");
  assert.equal(input.mode, "create");
  assert.equal(input.postId, null);
  assert.equal(input.title, "My Draft");
  assert.match(input.content, /<!-- wp:paragraph -->/);
  assert.match(input.content, /<!-- wp:footnotes \/-->/);
  assert.equal(input.footnotes.length, 1);
  assert.equal(input.footnotes[0].content, "footnote 1");
  assert.ok(input.jobId);
  assert.equal(state.editorChapter.exportModal.status, "exporting");
  assert.equal(currentWordPressExportState().jobId, input.jobId);
});

test("submitWordPressExport validates the form before invoking", async () => {
  installWordPressFixture();
  setWordPress({
    connectionStatus: "connected",
    title: "",
  });

  const invokeCalls = [];
  const operations = {
    invoke: async (command) => {
      invokeCalls.push(command);
    },
  };

  await submitWordPressExport(() => {}, operations);
  assert.equal(state.editorChapter.exportModal.error, "Enter a title for the new post.");

  setWordPress({ mode: "overwrite", selectedPostId: null });
  await submitWordPressExport(() => {}, operations);
  assert.equal(state.editorChapter.exportModal.error, "Choose the post to overwrite first.");

  setWordPress({ mode: "create", connectionStatus: "disconnected" });
  await submitWordPressExport(() => {}, operations);
  assert.equal(state.editorChapter.exportModal.error, "Connect your WordPress.com account first.");

  assert.equal(invokeCalls.length, 0);
});

test("export progress events update the stage and close the modal on success", () => {
  installWordPressFixture();
  setWordPress({ jobId: "job-1" });
  state.editorChapter = {
    ...state.editorChapter,
    exportModal: { ...state.editorChapter.exportModal, status: "exporting" },
  };

  handleWordPressExportProgressEvent({
    jobId: "other-job",
    status: "progress",
    message: "Ignored.",
  }, () => {});
  assert.equal(currentWordPressExportState().exportStage, "");

  handleWordPressExportProgressEvent({
    jobId: "job-1",
    status: "progress",
    message: "Uploading image 1 of 2...",
  }, () => {});
  assert.equal(currentWordPressExportState().exportStage, "Uploading image 1 of 2...");

  handleWordPressExportProgressEvent({
    jobId: "job-1",
    status: "success",
    message: "Created a new WordPress draft.",
    postLink: "https://example.wordpress.com/?p=1",
  }, () => {});
  assert.equal(state.editorChapter.exportModal.isOpen, false);
  assert.equal(state.editorChapter.exportModal.status, "idle");
});

test("export error events reopen the form with the error message", () => {
  installWordPressFixture();
  setWordPress({ jobId: "job-1" });
  state.editorChapter = {
    ...state.editorChapter,
    exportModal: { ...state.editorChapter.exportModal, status: "exporting" },
  };

  handleWordPressExportProgressEvent({
    jobId: "job-1",
    status: "error",
    message: "WordPress rejected the request: invalid token.",
  }, () => {});

  assert.equal(state.editorChapter.exportModal.isOpen, true);
  assert.equal(state.editorChapter.exportModal.status, "idle");
  assert.match(state.editorChapter.exportModal.error, /invalid token/);
  assert.equal(currentWordPressExportState().jobId, "");
});
