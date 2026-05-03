import { normalizeEditorFieldImage } from "./editor-images.js";
import { openLocalFilePicker } from "./local-file-picker.js";
import { findChapterContextById, selectedProjectsTeam } from "./project-context.js";
import {
  applyEditorRowImageSaved,
} from "./editor-persistence-state.js";
import { invoke, convertLocalFileSrc, waitForNextPaint } from "./runtime.js";
import { logEditorScrollDebug } from "./editor-scroll-debug.js";
import {
  captureTranslateAnchorForRow,
  captureVisibleTranslateLocation,
} from "./scroll-state.js";
import {
  createEditorImageEditorState,
  createEditorImageInvalidFileModalState,
  createEditorImagePreviewOverlayState,
  state,
} from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";
import {
  buildEditorFieldSelector,
  editorImageEditorCanCollapse,
  findEditorRowById,
} from "./editor-utils.js";
import { ensureEditorRowReadyForWrite, reloadEditorRowFromDisk } from "./editor-row-sync-flow.js";
import {
  captureTranslateViewport,
  renderTranslateBodyPreservingViewport,
} from "./translate-viewport.js";

const IMAGE_FILE_ACCEPT =
  ".jpg,.jpeg,.png,.gif,.svg,.webp,.avif,.bmp,.ico,.apng,image/jpeg,image/png,image/gif,image/svg+xml,image/webp,image/avif,image/bmp,image/x-icon";
const TRANSLATE_MAIN_BOTTOM_PIN_TOLERANCE_PX = 80;

function nextChapterBaseCommitSha(payload, chapterState = state.editorChapter) {
  return typeof payload?.chapterBaseCommitSha === "string" && payload.chapterBaseCommitSha.trim()
    ? payload.chapterBaseCommitSha.trim()
    : chapterState?.chapterBaseCommitSha ?? null;
}

function imageEditorMatches(chapterState, rowId, languageCode, mode = null) {
  if (
    chapterState?.imageEditor?.rowId !== rowId
    || chapterState?.imageEditor?.languageCode !== languageCode
  ) {
    return false;
  }

  return mode ? chapterState?.imageEditor?.mode === mode : true;
}

function resetImageEditor(chapterState) {
  return {
    ...chapterState,
    imageEditor: createEditorImageEditorState(),
  };
}

function imagePayloadValue(image) {
  const normalizedImage = normalizeEditorFieldImage(image);
  if (!normalizedImage) {
    return null;
  }

  return {
    kind: normalizedImage.kind,
    url: normalizedImage.url ?? "",
    path: normalizedImage.path ?? "",
  };
}

function imagePreviewSrc(image) {
  const normalizedImage = normalizeEditorFieldImage(image);
  if (!normalizedImage) {
    return "";
  }

  if (normalizedImage.kind === "url") {
    return normalizedImage.url ?? "";
  }

  return convertLocalFileSrc(normalizedImage.filePath ?? "");
}

function focusEditorImageControl(selector, rowId, languageCode) {
  if (typeof window === "undefined") {
    return;
  }

  window.requestAnimationFrame(() => {
    logEditorScrollDebug("editor-image-upload-focus-requested", {
      rowId,
      languageCode,
      selector,
      ...translateMainScrollDebugDetail(rowId, languageCode),
    });
    if (
      state.editorChapter?.imageEditor?.rowId !== rowId
      || state.editorChapter?.imageEditor?.languageCode !== languageCode
    ) {
      return;
    }

    const nextElement = document.querySelector(selector);
    if (nextElement instanceof HTMLElement) {
      nextElement.focus({ preventScroll: true });
      window.requestAnimationFrame(() => {
        logEditorScrollDebug("editor-image-upload-focused", {
          rowId,
          languageCode,
          selector,
          activeMatches:
            document.activeElement instanceof HTMLElement
            && document.activeElement === nextElement,
          ...translateMainScrollDebugDetail(rowId, languageCode),
        });
      });
    }
  });
}

function refocusEditorMainField(rowId, languageCode) {
  if (typeof window === "undefined" || !rowId || !languageCode) {
    return;
  }

  window.requestAnimationFrame(() => {
    if (
      state.editorChapter?.mainFieldEditor?.rowId !== rowId
      || state.editorChapter?.mainFieldEditor?.languageCode !== languageCode
    ) {
      return;
    }

    const nextField = document.querySelector(buildEditorFieldSelector(rowId, languageCode));
    if (nextField instanceof HTMLTextAreaElement) {
      nextField.focus({ preventScroll: true });
    }
  });
}

function currentImageEditorAnchor(rowId, languageCode) {
  return captureTranslateAnchorForRow(rowId, languageCode)
    ?? captureVisibleTranslateLocation();
}

function translateMainScrollElement() {
  return document.querySelector(".translate-main-scroll");
}

function translateMainScrollIsAtBottom() {
  const container = translateMainScrollElement();
  if (!(container instanceof HTMLElement)) {
    return false;
  }

  const bottomGap = container.scrollHeight - container.clientHeight - container.scrollTop;
  return (
    Number.isFinite(bottomGap)
    && bottomGap <= TRANSLATE_MAIN_BOTTOM_PIN_TOLERANCE_PX
  );
}

function scrollTranslateMainToBottom() {
  const container = translateMainScrollElement();
  if (!(container instanceof HTMLElement)) {
    return;
  }

  container.scrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
}

function translateMainScrollDebugDetail(rowId = "", languageCode = "") {
  const container = translateMainScrollElement();
  const detail = {
    scrollTop: null,
    scrollHeight: null,
    clientHeight: null,
    bottomGap: null,
    isLastRow: false,
    rowTop: null,
    rowBottom: null,
    panelTop: null,
    panelBottom: null,
  };
  if (!(container instanceof HTMLElement)) {
    return detail;
  }

  detail.scrollTop = container.scrollTop;
  detail.scrollHeight = container.scrollHeight;
  detail.clientHeight = container.clientHeight;
  detail.bottomGap = container.scrollHeight - container.clientHeight - container.scrollTop;

  const rowCards = [...document.querySelectorAll("[data-editor-row-card]")]
    .filter((element) => element instanceof HTMLElement);
  const lastRowCard = rowCards[rowCards.length - 1] ?? null;
  detail.isLastRow =
    lastRowCard instanceof HTMLElement
    && (lastRowCard.dataset.rowId ?? "") === rowId;

  const containerRect = container.getBoundingClientRect();
  const rowCard = rowId
    ? document.querySelector(`[data-editor-row-card][data-row-id="${CSS.escape(rowId)}"]`)
    : null;
  if (rowCard instanceof HTMLElement) {
    const rowRect = rowCard.getBoundingClientRect();
    detail.rowTop = rowRect.top - containerRect.top;
    detail.rowBottom = rowRect.bottom - containerRect.top;
  }

  const panel = rowId && languageCode
    ? document.querySelector(
      `[data-editor-language-cluster][data-row-id="${CSS.escape(rowId)}"][data-language-code="${CSS.escape(languageCode)}"]`,
    )
    : null;
  if (panel instanceof HTMLElement) {
    const panelRect = panel.getBoundingClientRect();
    detail.panelTop = panelRect.top - containerRect.top;
    detail.panelBottom = panelRect.bottom - containerRect.top;
  }

  return detail;
}

function updateRowForImagePayload(rowId, payloadRow, operations = {}) {
  const { updateEditorChapterRow } = operations;
  if (!payloadRow || typeof updateEditorChapterRow !== "function") {
    return null;
  }

  return updateEditorChapterRow(
    rowId,
    (currentRow) => applyEditorRowImageSaved(currentRow, payloadRow),
  );
}

function currentImage(rowId, languageCode) {
  return normalizeEditorFieldImage(findEditorRowById(rowId, state.editorChapter)?.images?.[languageCode]);
}

function setImageEditorState(nextEditorState) {
  if (!state.editorChapter?.chapterId) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    imageEditor: {
      ...createEditorImageEditorState(),
      ...(nextEditorState && typeof nextEditorState === "object" ? nextEditorState : {}),
    },
  };
}

function setImageInvalidFileModal(open) {
  if (!state.editorChapter?.chapterId) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    imageInvalidFileModal: open
      ? {
          ...createEditorImageInvalidFileModalState(),
          isOpen: true,
        }
      : createEditorImageInvalidFileModalState(),
  };
}

function editorImageWriteBlocked(row, render) {
  if (!row) {
    return true;
  }

  if (row.saveStatus === "saving") {
    showNoticeBadge("Finish saving the row text before updating the image.", render);
    return true;
  }

  if (row.textStyleSaveState?.status === "saving") {
    showNoticeBadge("Finish saving the row style before updating the image.", render);
    return true;
  }

  if (row.markerSaveState?.status === "saving") {
    showNoticeBadge("Finish saving review markers before updating the image.", render);
    return true;
  }

  return false;
}

function loadImageBySource(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.referrerPolicy = "no-referrer";
    const timeoutId = window.setTimeout(() => {
      reject(new Error("Image load timed out."));
    }, 12000);

    image.onload = () => {
      window.clearTimeout(timeoutId);
      resolve();
    };
    image.onerror = () => {
      window.clearTimeout(timeoutId);
      reject(new Error("Image load failed."));
    };
    image.src = src;
  });
}

function validateImageUrlSyntax(url) {
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return "Enter a valid image URL.";
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    return "Only http:// and https:// image URLs are supported.";
  }

  return "";
}

function readableUploadLike(value) {
  return value && typeof value === "object" && typeof value.arrayBuffer === "function";
}

function droppedPathUploadLike(value) {
  return value && typeof value === "object" && typeof value.dataBase64 === "string";
}

function uploadLikeFileName(value, fallback = "image") {
  const name = typeof value?.name === "string" ? value.name.trim() : "";
  return name || fallback;
}

function decodeBase64ToBytes(dataBase64) {
  const normalized = typeof dataBase64 === "string" ? dataBase64.trim() : "";
  if (!normalized) {
    throw new Error("Invalid file");
  }

  if (typeof globalThis.atob === "function") {
    const binary = globalThis.atob(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  if (typeof Buffer === "function") {
    return Uint8Array.from(Buffer.from(normalized, "base64"));
  }

  throw new Error("Base64 decoding is unavailable.");
}

async function coerceUploadBlob(value) {
  if (readableUploadLike(value)) {
    const bytes = await value.arrayBuffer();
    const type = typeof value?.type === "string" ? value.type : "";
    return new Blob([bytes], { type });
  }

  if (droppedPathUploadLike(value)) {
    const type = typeof value?.type === "string" ? value.type : "";
    return new Blob([decodeBase64ToBytes(value.dataBase64)], { type });
  }

  throw new Error("Invalid file");
}

async function validateUploadedImageFile(fileBlob) {
  if (!(fileBlob instanceof Blob)) {
    throw new Error("Invalid file");
  }

  const objectUrl = URL.createObjectURL(fileBlob);
  try {
    await loadImageBySource(objectUrl);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function fileToBase64Data(file) {
  if (droppedPathUploadLike(file)) {
    const dataBase64 = file.dataBase64.trim();
    if (!dataBase64) {
      return Promise.reject(new Error("The file could not be read."));
    }
    return Promise.resolve(dataBase64);
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const [, data = ""] = result.split(",", 2);
      resolve(data);
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error("The file could not be read."));
    };
    reader.readAsDataURL(file);
  });
}

function closeImagePreviewIfTarget(rowId, languageCode) {
  if (
    state.editorChapter?.imagePreviewOverlay?.rowId !== rowId
    || state.editorChapter?.imagePreviewOverlay?.languageCode !== languageCode
  ) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    imagePreviewOverlay: createEditorImagePreviewOverlayState(),
  };
}

async function applyImageCommandPayload(render, rowId, languageCode, payload, operations = {}, options = {}) {
  const { loadActiveEditorFieldHistory } = operations;
  const resolvedOptions = options && typeof options === "object" ? options : {};
  if (!state.editorChapter?.chapterId) {
    return;
  }

  if (payload?.status === "deleted") {
    await reloadEditorRowFromDisk(render, rowId, { suppressNotice: false });
    state.editorChapter = resetImageEditor(state.editorChapter);
    renderTranslateBodyPreservingViewport(render, resolvedOptions.viewportSnapshot ?? null);
    return;
  }

  if (payload?.row) {
    updateRowForImagePayload(rowId, payload.row, operations);
  }

  state.editorChapter = {
    ...resetImageEditor(state.editorChapter),
    chapterBaseCommitSha: nextChapterBaseCommitSha(payload, state.editorChapter),
  };
  closeImagePreviewIfTarget(rowId, languageCode);
  renderTranslateBodyPreservingViewport(render, resolvedOptions.viewportSnapshot ?? null);

  if (
    typeof loadActiveEditorFieldHistory === "function"
    && state.editorChapter.activeRowId === rowId
    && state.editorChapter.activeLanguageCode === languageCode
  ) {
    loadActiveEditorFieldHistory(render);
  }

  if (resolvedOptions.notice) {
    showNoticeBadge(resolvedOptions.notice, render);
  }
}

export function openEditorImageUrl(render, rowId, languageCode) {
  if (!rowId || !languageCode || !state.editorChapter?.chapterId) {
    return;
  }

  const viewportSnapshot = captureTranslateViewport(null, {
    preferPrimed: true,
    expectedRowId: rowId,
    fallbackAnchor: currentImageEditorAnchor(rowId, languageCode),
  });
  const existingEditor = imageEditorMatches(state.editorChapter, rowId, languageCode)
    ? state.editorChapter.imageEditor
    : null;
  setImageEditorState({
    rowId,
    languageCode,
    mode: "url",
    urlDraft: existingEditor?.urlDraft ?? "",
    invalidUrl: false,
    urlErrorMessage: "",
    status: "idle",
  });
  renderTranslateBodyPreservingViewport(render, viewportSnapshot);
  focusEditorImageControl(
    `[data-editor-image-url-input][data-row-id="${CSS.escape(rowId)}"][data-language-code="${CSS.escape(languageCode)}"]`,
    rowId,
    languageCode,
  );
}

export function closeEditorImageUrl(render, rowId, languageCode) {
  if (!rowId || !languageCode || !imageEditorMatches(state.editorChapter, rowId, languageCode, "url")) {
    return;
  }

  const viewportSnapshot = captureTranslateViewport(null, {
    preferPrimed: true,
    expectedRowId: rowId,
    fallbackAnchor: currentImageEditorAnchor(rowId, languageCode),
  });
  closeEditorImageInput(render, viewportSnapshot);
  refocusEditorMainField(rowId, languageCode);
}

export function updateEditorImageUrlDraft(nextValue) {
  if (!state.editorChapter?.chapterId || !state.editorChapter?.imageEditor?.rowId) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    imageEditor: {
      ...state.editorChapter.imageEditor,
      urlDraft: String(nextValue ?? ""),
      invalidUrl: false,
      urlErrorMessage: "",
    },
  };
}

function closeEditorImageInput(render, viewportSnapshot = null) {
  if (!state.editorChapter?.chapterId) {
    return;
  }

  state.editorChapter = resetImageEditor(state.editorChapter);
  renderTranslateBodyPreservingViewport(render, viewportSnapshot);
}

export async function persistEditorImageUrlOnBlur(render, rowId, languageCode, operations = {}, options = {}) {
  if (!imageEditorMatches(state.editorChapter, rowId, languageCode, "url")) {
    return;
  }

  const viewportSnapshot = captureTranslateViewport(null, {
    fallbackAnchor: currentImageEditorAnchor(rowId, languageCode),
  });
  const draft = String(state.editorChapter.imageEditor?.urlDraft ?? "").trim();
  const closeInput = options?.closeInput === true;
  if (!draft) {
    if (closeInput) {
      closeEditorImageInput(render, viewportSnapshot);
    }
    return;
  }

  if (
    state.editorChapter.imageEditor?.status === "saving"
    || state.editorChapter.imageEditor?.status === "submitting"
  ) {
    return;
  }

  const chapterAtRequest = state.editorChapter.chapterId;
  setImageEditorState({
    rowId,
    languageCode,
    mode: "url",
    urlDraft: draft,
    invalidUrl: false,
    urlErrorMessage: "",
    status: closeInput ? "submitting" : "saving",
  });
  renderTranslateBodyPreservingViewport(render, viewportSnapshot);

  const urlSyntaxError = validateImageUrlSyntax(draft);
  if (urlSyntaxError) {
    if (
      state.editorChapter?.chapterId === chapterAtRequest
      && imageEditorMatches(state.editorChapter, rowId, languageCode)
      && (
        state.editorChapter?.imageEditor?.status === "submitting"
        || state.editorChapter?.imageEditor?.status === "saving"
      )
    ) {
      setImageEditorState({
        rowId,
        languageCode,
        mode: null,
        urlDraft: draft,
        invalidUrl: true,
        urlErrorMessage: urlSyntaxError,
        status: "idle",
      });
      renderTranslateBodyPreservingViewport(render, viewportSnapshot);
    }
    return;
  }

  const row = await ensureEditorRowReadyForWrite(render, rowId, { allowStaleDirty: true });
  if (editorImageWriteBlocked(row, render)) {
    if (
      state.editorChapter?.chapterId === chapterAtRequest
      && imageEditorMatches(state.editorChapter, rowId, languageCode)
      && (
        state.editorChapter?.imageEditor?.status === "submitting"
        || state.editorChapter?.imageEditor?.status === "saving"
      )
    ) {
      setImageEditorState({
        rowId,
        languageCode,
        mode: "url",
        urlDraft: draft,
        invalidUrl: false,
        urlErrorMessage: "",
        status: "idle",
      });
      renderTranslateBodyPreservingViewport(render, viewportSnapshot);
    }
    return;
  }

  const team = selectedProjectsTeam();
  const context = findChapterContextById(state.editorChapter?.chapterId);
  if (!Number.isFinite(team?.installationId) || !context?.project?.name) {
    setImageEditorState({
      rowId,
      languageCode,
      mode: "url",
      urlDraft: draft,
      invalidUrl: false,
      urlErrorMessage: "",
      status: "idle",
    });
    renderTranslateBodyPreservingViewport(render, viewportSnapshot);
    return;
  }

  try {
    const payload = await invoke("save_gtms_editor_language_image_url", {
      input: {
        installationId: team.installationId,
        projectId: context.project.id,
        repoName: context.project.name,
        chapterId: state.editorChapter.chapterId,
        rowId,
        languageCode,
        url: draft,
        baseImage: imagePayloadValue(currentImage(rowId, languageCode)),
      },
    });

    if (state.editorChapter?.chapterId !== chapterAtRequest) {
      return;
    }

    const currentEditor = state.editorChapter?.imageEditor;
    const editorWasReopened =
      imageEditorMatches(state.editorChapter, rowId, languageCode, "url")
      && currentEditor?.status !== "submitting";
    if (editorWasReopened && payload?.row) {
      updateRowForImagePayload(rowId, payload.row, operations);
      state.editorChapter = {
        ...state.editorChapter,
        chapterBaseCommitSha: nextChapterBaseCommitSha(payload, state.editorChapter),
      };
      closeImagePreviewIfTarget(rowId, languageCode);
      renderTranslateBodyPreservingViewport(render, viewportSnapshot);
      if (
        typeof operations.loadActiveEditorFieldHistory === "function"
        && state.editorChapter.activeRowId === rowId
        && state.editorChapter.activeLanguageCode === languageCode
      ) {
        operations.loadActiveEditorFieldHistory(render);
      }
      return;
    }

    await applyImageCommandPayload(
      render,
      rowId,
      languageCode,
      payload,
      operations,
      payload?.status === "conflict"
        ? {
          notice: "The image changed on disk. Reloaded the latest version.",
          viewportSnapshot,
        }
        : { viewportSnapshot },
    );
  } catch (error) {
    if (
      state.editorChapter?.chapterId === chapterAtRequest
      && imageEditorMatches(state.editorChapter, rowId, languageCode)
      && (
        state.editorChapter?.imageEditor?.status === "submitting"
        || state.editorChapter?.imageEditor?.status === "saving"
      )
    ) {
      const message = error instanceof Error ? error.message : String(error);
      setImageEditorState({
        rowId,
        languageCode,
        mode: null,
        urlDraft: draft,
        invalidUrl: true,
        urlErrorMessage: message || "The image URL could not be saved.",
        status: "idle",
      });
      renderTranslateBodyPreservingViewport(render, viewportSnapshot);
    }
  }
}

export async function submitEditorImageUrl(render, rowId, languageCode, operations = {}) {
  await persistEditorImageUrlOnBlur(render, rowId, languageCode, operations, {
    closeInput: true,
  });
}

export function openEditorImageUpload(render, rowId, languageCode) {
  if (!rowId || !languageCode || !state.editorChapter?.chapterId) {
    return;
  }

  const viewportSnapshot = captureTranslateViewport(null, {
    preferPrimed: true,
    expectedRowId: rowId,
    fallbackAnchor: currentImageEditorAnchor(rowId, languageCode),
  });
  const shouldPinBottom = translateMainScrollIsAtBottom();
  logEditorScrollDebug("editor-image-upload-open", {
    stage: "before-render",
    rowId,
    languageCode,
    shouldPinBottom,
    bottomTolerancePx: TRANSLATE_MAIN_BOTTOM_PIN_TOLERANCE_PX,
    ...translateMainScrollDebugDetail(rowId, languageCode),
  });
  setImageEditorState({
    rowId,
    languageCode,
    mode: "upload",
    urlDraft: "",
    invalidUrl: false,
    status: "idle",
  });
  renderTranslateBodyPreservingViewport(render, viewportSnapshot);
  logEditorScrollDebug("editor-image-upload-open", {
    stage: "after-render",
    rowId,
    languageCode,
    shouldPinBottom,
    bottomTolerancePx: TRANSLATE_MAIN_BOTTOM_PIN_TOLERANCE_PX,
    ...translateMainScrollDebugDetail(rowId, languageCode),
  });
  focusEditorImageControl(
    `[data-editor-image-upload-dropzone][data-row-id="${CSS.escape(rowId)}"][data-language-code="${CSS.escape(languageCode)}"]`,
    rowId,
    languageCode,
  );
  if (shouldPinBottom) {
    void waitForNextPaint().then(() => {
      logEditorScrollDebug("editor-image-upload-open", {
        stage: "before-bottom-pin",
        rowId,
        languageCode,
        shouldPinBottom,
        bottomTolerancePx: TRANSLATE_MAIN_BOTTOM_PIN_TOLERANCE_PX,
        matchesUploadEditor: imageEditorMatches(state.editorChapter, rowId, languageCode, "upload"),
        ...translateMainScrollDebugDetail(rowId, languageCode),
      });
      if (!imageEditorMatches(state.editorChapter, rowId, languageCode, "upload")) {
        return;
      }

      scrollTranslateMainToBottom();
      logEditorScrollDebug("editor-image-upload-open", {
        stage: "after-bottom-pin",
        rowId,
        languageCode,
        shouldPinBottom,
        bottomTolerancePx: TRANSLATE_MAIN_BOTTOM_PIN_TOLERANCE_PX,
        ...translateMainScrollDebugDetail(rowId, languageCode),
      });
    });
  } else {
    void waitForNextPaint().then(() => {
      logEditorScrollDebug("editor-image-upload-open", {
        stage: "after-paint-no-pin",
        rowId,
        languageCode,
        shouldPinBottom,
        bottomTolerancePx: TRANSLATE_MAIN_BOTTOM_PIN_TOLERANCE_PX,
        ...translateMainScrollDebugDetail(rowId, languageCode),
      });
    });
  }
}

export function dismissActiveIdleEditorImageUpload(render) {
  if (
    !state.editorChapter?.chapterId
    || state.editorChapter.imageEditor?.mode !== "upload"
    || state.editorChapter.imageEditor?.status !== "idle"
  ) {
    return false;
  }

  state.editorChapter = resetImageEditor(state.editorChapter);
  render?.({ scope: "translate-body" });
  return true;
}

export function collapseEmptyEditorImageEditor(render, rowId, languageCode) {
  if (!imageEditorMatches(state.editorChapter, rowId, languageCode)) {
    return;
  }

  if (!editorImageEditorCanCollapse(state.editorChapter.imageEditor)) {
    return;
  }

  state.editorChapter = resetImageEditor(state.editorChapter);
  render?.({ scope: "translate-body" });
}

async function saveUploadedEditorImage(render, rowId, languageCode, file, operations = {}) {
  if (!imageEditorMatches(state.editorChapter, rowId, languageCode, "upload")) {
    return;
  }

  let fileBlob;
  let fileName;
  try {
    fileBlob = await coerceUploadBlob(file);
    fileName = uploadLikeFileName(file);
  } catch {
    if (state.editorChapter?.chapterId) {
      setImageEditorState({
        rowId,
        languageCode,
        mode: "upload",
        status: "idle",
      });
      setImageInvalidFileModal(true);
      render?.({ scope: "translate-body" });
    }
    return;
  }

  const chapterAtRequest = state.editorChapter.chapterId;
  setImageEditorState({
    rowId,
    languageCode,
    mode: "upload",
    status: "saving",
  });
  render?.({ scope: "translate-body" });

  try {
    await validateUploadedImageFile(fileBlob);
  } catch {
    if (state.editorChapter?.chapterId === chapterAtRequest) {
      setImageEditorState({
        rowId,
        languageCode,
        mode: "upload",
        status: "idle",
      });
      setImageInvalidFileModal(true);
      render?.({ scope: "translate-body" });
    }
    return;
  }

  const row = await ensureEditorRowReadyForWrite(render, rowId, { allowStaleDirty: true });
  if (editorImageWriteBlocked(row, render)) {
    if (state.editorChapter?.chapterId === chapterAtRequest) {
      setImageEditorState({
        rowId,
        languageCode,
        mode: "upload",
        status: "idle",
      });
      render?.({ scope: "translate-body" });
    }
    return;
  }

  const team = selectedProjectsTeam();
  const context = findChapterContextById(state.editorChapter?.chapterId);
  if (!Number.isFinite(team?.installationId) || !context?.project?.name) {
    setImageEditorState({
      rowId,
      languageCode,
      mode: "upload",
      status: "idle",
    });
    render?.({ scope: "translate-body" });
    return;
  }

  try {
    const dataBase64 = await fileToBase64Data(file);
    const payload = await invoke("upload_gtms_editor_language_image", {
      input: {
        installationId: team.installationId,
        projectId: context.project.id,
        repoName: context.project.name,
        chapterId: state.editorChapter.chapterId,
        rowId,
        languageCode,
        filename: fileName,
        dataBase64,
        baseImage: imagePayloadValue(currentImage(rowId, languageCode)),
      },
    });

    if (state.editorChapter?.chapterId !== chapterAtRequest) {
      return;
    }

    await applyImageCommandPayload(
      render,
      rowId,
      languageCode,
      payload,
      operations,
      payload?.status === "conflict"
        ? { notice: "The image changed on disk. Reloaded the latest version." }
        : null,
    );
  } catch (error) {
    if (state.editorChapter?.chapterId === chapterAtRequest) {
      setImageEditorState({
        rowId,
        languageCode,
        mode: "upload",
        status: "idle",
      });
      render?.({ scope: "translate-body" });
    }
    const message = error instanceof Error ? error.message : String(error);
    showNoticeBadge(message || "The image could not be uploaded.", render);
  }
}

export async function openEditorImageUploadPicker(render, rowId, languageCode, operations = {}) {
  if (!imageEditorMatches(state.editorChapter, rowId, languageCode, "upload")) {
    return;
  }

  const chapterAtRequest = state.editorChapter?.chapterId ?? null;
  setImageEditorState({
    rowId,
    languageCode,
    mode: "upload",
    status: "picking",
  });

  const file = await openLocalFilePicker({ accept: IMAGE_FILE_ACCEPT });
  if (
    state.editorChapter?.chapterId !== chapterAtRequest
    || !imageEditorMatches(state.editorChapter, rowId, languageCode, "upload")
  ) {
    return;
  }

  if (!file) {
    setImageEditorState({
      rowId,
      languageCode,
      mode: "upload",
      status: "idle",
    });
    render?.({ scope: "translate-body" });
    return;
  }

  await saveUploadedEditorImage(render, rowId, languageCode, file, operations);
}

export async function handleDroppedEditorImageFile(render, rowId, languageCode, file, operations = {}) {
  if (!file || !imageEditorMatches(state.editorChapter, rowId, languageCode, "upload")) {
    return;
  }

  await saveUploadedEditorImage(render, rowId, languageCode, file, operations);
}

export async function handleDroppedEditorImagePath(render, path, operations = {}) {
  const normalizedPath = typeof path === "string" ? path.trim() : "";
  const rowId = state.editorChapter?.imageEditor?.rowId ?? "";
  const languageCode = state.editorChapter?.imageEditor?.languageCode ?? "";
  if (!normalizedPath || !imageEditorMatches(state.editorChapter, rowId, languageCode, "upload")) {
    return;
  }

  try {
    const file = await invoke("read_local_dropped_file", { path: normalizedPath });
    await saveUploadedEditorImage(
      render,
      rowId,
      languageCode,
      {
        name: typeof file?.name === "string" ? file.name : "",
        type: typeof file?.mimeType === "string" ? file.mimeType : "",
        dataBase64: typeof file?.dataBase64 === "string" ? file.dataBase64 : "",
      },
      operations,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showNoticeBadge(message || "The image could not be uploaded.", render);
  }
}

export async function removeEditorLanguageImage(render, rowId, languageCode, operations = {}) {
  if (!rowId || !languageCode || !state.editorChapter?.chapterId) {
    return;
  }

  const chapterAtRequest = state.editorChapter.chapterId;
  const row = await ensureEditorRowReadyForWrite(render, rowId, { allowStaleDirty: true });
  if (editorImageWriteBlocked(row, render)) {
    return;
  }

  const image = currentImage(rowId, languageCode);
  if (!image) {
    return;
  }

  const team = selectedProjectsTeam();
  const context = findChapterContextById(state.editorChapter?.chapterId);
  if (!Number.isFinite(team?.installationId) || !context?.project?.name) {
    return;
  }

  try {
    const payload = await invoke("remove_gtms_editor_language_image", {
      input: {
        installationId: team.installationId,
        projectId: context.project.id,
        repoName: context.project.name,
        chapterId: state.editorChapter.chapterId,
        rowId,
        languageCode,
        baseImage: imagePayloadValue(image),
      },
    });

    if (state.editorChapter?.chapterId !== chapterAtRequest) {
      return;
    }

    await applyImageCommandPayload(
      render,
      rowId,
      languageCode,
      payload,
      operations,
      payload?.status === "conflict"
        ? { notice: "The image changed on disk. Reloaded the latest version." }
        : null,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showNoticeBadge(message || "The image could not be removed.", render);
  }
}

export function openEditorImagePreview(render, rowId, languageCode) {
  if (!rowId || !languageCode || !state.editorChapter?.chapterId) {
    return;
  }

  const image = currentImage(rowId, languageCode);
  const src = imagePreviewSrc(image);
  if (!src) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    imagePreviewOverlay: {
      isOpen: true,
      rowId,
      languageCode,
      src,
    },
  };
  render?.({ scope: "translate-image-preview-overlay" });
}

export function closeEditorImagePreview(render) {
  if (!state.editorChapter?.chapterId) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    imagePreviewOverlay: createEditorImagePreviewOverlayState(),
  };
  render?.({ scope: "translate-image-preview-overlay" });
}

export function closeEditorImageInvalidFileModal(render) {
  if (!state.editorChapter?.chapterId) {
    return;
  }

  setImageInvalidFileModal(false);
  render?.();
}
