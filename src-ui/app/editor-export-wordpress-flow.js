import { formatErrorForDisplay } from "./error-display.js";
import { invoke, listen, openExternalUrl } from "./runtime.js";
import { findChapterContext, selectedProjectsTeam } from "./project-context.js";
import {
  buildEditorPreviewDocument,
  extractWordPressLeadingHeadingTitle,
  selectedEditorPreviewLanguageCode,
  serializeEditorPreviewWordPress,
} from "./editor-preview.js";
import {
  createEditorExportModalState,
  createEditorExportWordPressState,
  createWordPressExportSuccessModalState,
  state,
} from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";
import {
  loadStoredEditorExportDefault,
  saveStoredEditorExportDefault,
} from "./editor-export-defaults.js";

function currentExportModal() {
  return state.editorChapter?.exportModal ?? null;
}

export function currentWordPressExportState() {
  return currentExportModal()?.wordpress ?? null;
}

function updateExportModal(patch) {
  state.editorChapter = {
    ...state.editorChapter,
    exportModal: {
      ...(currentExportModal() ?? createEditorExportModalState()),
      ...patch,
    },
  };
}

function updateWordPressState(patch) {
  updateExportModal({
    wordpress: {
      ...(currentWordPressExportState() ?? createEditorExportWordPressState()),
      ...patch,
    },
  });
}

function failWordPressAction(render, error) {
  updateExportModal({ status: "idle", error: formatErrorForDisplay(error) });
  updateWordPressState({ exportStage: "" });
  render();
}

function createWordPressJobId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `wp-job-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

// Defaults the pane to overwriting the remembered post from the chapter's
// last successful WordPress export.
export function seedWordPressOverwriteDefault(storedWordPress) {
  const postId = Number.parseInt(String(storedWordPress?.postId ?? ""), 10);
  if (!Number.isFinite(postId) || postId <= 0) {
    return;
  }

  const postTitle = String(storedWordPress?.postTitle ?? "").trim();
  updateWordPressState({
    mode: "overwrite",
    selectedPostId: postId,
    searchResults: [{
      id: postId,
      title: postTitle || `Post ${postId}`,
      status: "",
      link: "",
      modified: "",
    }],
    searchStatus: "done",
  });
}

// Prepares the pane when the WordPress option is shown: loads the stored
// connection once and seeds the new-post title from the open file.
export function ensureWordPressPaneReady(render, operations = {}) {
  const wordpress = currentWordPressExportState();
  if (!wordpress) {
    return;
  }

  if (wordpress.selectedPostId == null) {
    const stored = loadStoredEditorExportDefault(currentExportModal()?.chapterId);
    if (stored?.wordpress) {
      seedWordPressOverwriteDefault(stored.wordpress);
    }
  }

  if (!wordpress.title) {
    // Prefer the chapter's leading H1 (it becomes the post title and is
    // stripped from the exported content); fall back to the file title.
    const languageCode = selectedEditorPreviewLanguageCode(state.editorChapter);
    const blocks = buildEditorPreviewDocument(state.editorChapter?.rows, languageCode);
    const headingTitle = extractWordPressLeadingHeadingTitle(blocks);
    const title = headingTitle || String(state.editorChapter?.fileTitle ?? "");
    if (title) {
      updateWordPressState({ title });
    }
  }

  if (wordpress.connectionStatus === "unknown") {
    void loadWordPressConnection(render, operations);
  }
}

export async function loadWordPressConnection(render, operations = {}) {
  const invokeCommand = operations.invoke ?? invoke;
  if (!invokeCommand) {
    updateWordPressState({ connectionStatus: "disconnected" });
    return;
  }

  updateWordPressState({ connectionStatus: "loading" });
  render();
  try {
    const connection = await invokeCommand("get_wordpress_connection");
    updateWordPressState(connection
      ? { connectionStatus: "connected", connection }
      : { connectionStatus: "disconnected", connection: null });
  } catch (error) {
    updateWordPressState({ connectionStatus: "disconnected", connection: null });
    updateExportModal({ error: formatErrorForDisplay(error) });
  }
  render();
}

export async function connectWordPress(render, operations = {}) {
  const invokeCommand = operations.invoke ?? invoke;
  const openUrl = operations.openExternalUrl ?? openExternalUrl;
  if (!invokeCommand) {
    failWordPressAction(render, "Connecting to WordPress.com requires the desktop app runtime.");
    return;
  }

  updateExportModal({ error: "" });
  updateWordPressState({ connectionStatus: "connecting" });
  render();
  try {
    const { authUrl } = await invokeCommand("begin_wordpress_auth");
    openUrl(authUrl);
  } catch (error) {
    updateWordPressState({ connectionStatus: "disconnected" });
    failWordPressAction(render, error);
  }
}

export async function disconnectWordPress(render, operations = {}) {
  const invokeCommand = operations.invoke ?? invoke;
  if (!invokeCommand) {
    return;
  }

  try {
    await invokeCommand("disconnect_wordpress");
    updateWordPressState({
      connectionStatus: "disconnected",
      connection: null,
      searchResults: [],
      searchStatus: "idle",
      selectedPostId: null,
    });
    updateExportModal({ error: "" });
    render();
  } catch (error) {
    failWordPressAction(render, error);
  }
}

export function setWordPressExportMode(render, mode) {
  if (mode !== "create" && mode !== "overwrite") {
    return;
  }
  updateWordPressState({ mode });
  updateExportModal({ error: "" });
  render();
}

export function updateWordPressTitle(value) {
  updateWordPressState({ title: String(value ?? "") });
}

export function updateWordPressSearchQuery(value) {
  updateWordPressState({ searchQuery: String(value ?? "") });
}

export async function searchWordPressPosts(render, operations = {}) {
  const invokeCommand = operations.invoke ?? invoke;
  const wordpress = currentWordPressExportState();
  if (!invokeCommand || !wordpress || wordpress.searchStatus === "searching") {
    return;
  }

  updateWordPressState({ searchStatus: "searching" });
  updateExportModal({ error: "" });
  render();
  try {
    const results = await invokeCommand("search_wordpress_posts", {
      search: wordpress.searchQuery ?? "",
    });
    updateWordPressState({
      searchStatus: "done",
      searchResults: Array.isArray(results) ? results : [],
    });
    render();
  } catch (error) {
    updateWordPressState({ searchStatus: "error", searchResults: [] });
    failWordPressAction(render, error);
  }
}

export function selectWordPressPost(render, postId) {
  const wordpress = currentWordPressExportState();
  const normalizedId = Number.parseInt(postId, 10);
  if (
    !wordpress
    || !Number.isFinite(normalizedId)
    || !wordpress.searchResults.some((post) => post.id === normalizedId)
  ) {
    return;
  }

  updateWordPressState({ selectedPostId: normalizedId });
  updateExportModal({ error: "" });
  render();
}

export function selectedWordPressPost(wordpress) {
  if (!wordpress || wordpress.selectedPostId == null) {
    return null;
  }
  return wordpress.searchResults.find((post) => post.id === wordpress.selectedPostId) ?? null;
}

export async function submitWordPressExport(render, operations = {}) {
  const invokeCommand = operations.invoke ?? invoke;
  const modal = currentExportModal();
  const wordpress = currentWordPressExportState();
  if (!modal?.isOpen || modal.status === "exporting" || !wordpress) {
    return;
  }
  if (!invokeCommand) {
    failWordPressAction(render, "WordPress export requires the desktop app runtime.");
    return;
  }
  if (wordpress.connectionStatus !== "connected") {
    failWordPressAction(render, "Connect your WordPress.com account first.");
    return;
  }
  if (wordpress.mode === "create" && !String(wordpress.title ?? "").trim()) {
    failWordPressAction(render, "Enter a title for the new post.");
    return;
  }
  const overwritePost = selectedWordPressPost(wordpress);
  if (wordpress.mode === "overwrite" && !overwritePost) {
    failWordPressAction(render, "Choose the post to overwrite first.");
    return;
  }

  const team = selectedProjectsTeam();
  const context = findChapterContext(state.editorChapter?.chapterId);
  const languageCode = String(selectedEditorPreviewLanguageCode(state.editorChapter) ?? "").trim();
  if (!Number.isFinite(team?.installationId) || !context?.project || !languageCode) {
    failWordPressAction(render, "Could not find the open file.");
    return;
  }

  const blocks = buildEditorPreviewDocument(state.editorChapter?.rows, languageCode);
  const { content, footnotes, title: headingTitle } = serializeEditorPreviewWordPress(blocks);
  if (!content.trim()) {
    failWordPressAction(render, "There is nothing to export.");
    return;
  }

  const jobId = createWordPressJobId();
  updateExportModal({ status: "exporting", error: "" });
  updateWordPressState({ jobId, exportStage: "Starting the export..." });
  render();

  try {
    await invokeCommand("export_chapter_to_wordpress", {
      input: {
        installationId: team.installationId,
        repoName: context.project.name,
        projectId: context.project.id ?? null,
        jobId,
        mode: wordpress.mode,
        postId: wordpress.mode === "overwrite" ? overwritePost.id : null,
        // Create uses the (editable) title field; overwrite only updates the
        // post title when the chapter's leading H1 supplies one.
        title: wordpress.mode === "create"
          ? String(wordpress.title ?? "").trim()
          : headingTitle ?? "",
        content,
        footnotes,
      },
    });
  } catch (error) {
    failWordPressAction(render, error);
  }
}

export function handleWordPressAuthEvent(payload, render) {
  if (!currentWordPressExportState()) {
    return;
  }

  if (payload?.status === "success" && payload?.connection) {
    updateWordPressState({
      connectionStatus: "connected",
      connection: payload.connection,
    });
    updateExportModal({ error: "" });
  } else {
    updateWordPressState({ connectionStatus: "disconnected" });
    updateExportModal({
      error: payload?.message ?? "WordPress.com sign-in did not complete.",
    });
  }
  render();
}

export function handleWordPressExportProgressEvent(payload, render) {
  const wordpress = currentWordPressExportState();
  if (!wordpress || !payload?.jobId || payload.jobId !== wordpress.jobId) {
    return;
  }

  if (payload.status === "progress") {
    updateWordPressState({ exportStage: String(payload.message ?? "") });
    render();
    return;
  }

  if (payload.status === "success") {
    updateWordPressState({ exportStage: "", jobId: "" });
    updateExportModal({ isOpen: false, status: "idle", error: "" });
    const postId = Number.parseInt(String(payload.postId ?? ""), 10);
    if (Number.isFinite(postId) && postId > 0) {
      saveStoredEditorExportDefault(state.editorChapter?.chapterId, {
        optionId: "link:wordpress",
        wordpress: {
          postId,
          postTitle: String(payload.postTitle ?? "").trim(),
        },
      });
    }

    // A published post links to the live page; anything else (draft, pending,
    // private, future) links to the WordPress editor for preview + publish.
    const isPublished = String(payload.postStatus ?? "").trim().toLowerCase() === "publish";
    const postLink = String(payload.postLink ?? "").trim();
    const editLink = String(payload.postEditLink ?? "").trim();
    const successUrl = isPublished ? (postLink || editLink) : (editLink || postLink);
    if (successUrl && state.editorChapter?.chapterId) {
      state.editorChapter = {
        ...state.editorChapter,
        wordpressExportSuccessModal: {
          isOpen: true,
          isDraft: !isPublished,
          url: successUrl,
        },
      };
      render();
      return;
    }

    // Full render to remove the modal; showNoticeBadge only repaints the
    // badge surface.
    render();
    showNoticeBadge(payload.message || "Exported to WordPress.", render, 2600);
    return;
  }

  updateWordPressState({ exportStage: "", jobId: "" });
  updateExportModal({ status: "idle", error: formatErrorForDisplay(payload.message ?? "WordPress export failed.") });
  render();
}

export function closeWordPressExportSuccessModal(render) {
  if (!state.editorChapter?.wordpressExportSuccessModal?.isOpen) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    wordpressExportSuccessModal: createWordPressExportSuccessModalState(),
  };
  render();
}

export async function registerWordPressExportListeners(render) {
  if (!listen) {
    return;
  }

  await listen("wordpress-auth-callback", (event) => {
    handleWordPressAuthEvent(event.payload, render);
  });
  await listen("wordpress-export-progress", (event) => {
    handleWordPressExportProgressEvent(event.payload, render);
  });
}
