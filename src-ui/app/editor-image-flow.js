import { normalizeEditorFieldImage } from "./editor-images.js";
import { openLocalFilePicker } from "./local-file-picker.js";
import { findChapterContextById, selectedProjectsTeam } from "./project-context.js";
import {
  applyEditorRowImageSaved,
} from "./editor-persistence-state.js";
import { invoke, convertLocalFileSrc } from "./runtime.js";
import {
  createEditorImageEditorState,
  createEditorImageInvalidFileModalState,
  createEditorImagePreviewOverlayState,
  state,
} from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";
import { editorImageEditorCanCollapse, findEditorRowById } from "./editor-utils.js";
import { ensureEditorRowReadyForWrite, reloadEditorRowFromDisk } from "./editor-row-sync-flow.js";

const IMAGE_FILE_ACCEPT =
  ".jpg,.jpeg,.png,.gif,.svg,.webp,.avif,.bmp,.ico,.apng,image/jpeg,image/png,image/gif,image/svg+xml,image/webp,image/avif,image/bmp,image/x-icon";

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
    if (
      state.editorChapter?.imageEditor?.rowId !== rowId
      || state.editorChapter?.imageEditor?.languageCode !== languageCode
    ) {
      return;
    }

    const nextElement = document.querySelector(selector);
    if (nextElement instanceof HTMLElement) {
      nextElement.focus({ preventScroll: true });
    }
  });
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

async function validateImageUrlLoadable(url) {
  await loadImageBySource(url);
}

async function validateUploadedImageFile(file) {
  if (!(file instanceof File)) {
    throw new Error("Invalid file");
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    await loadImageBySource(objectUrl);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function fileToBase64Data(file) {
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
  if (!state.editorChapter?.chapterId) {
    return;
  }

  if (payload?.status === "deleted") {
    await reloadEditorRowFromDisk(render, rowId, { suppressNotice: false });
    state.editorChapter = resetImageEditor(state.editorChapter);
    render?.({ scope: "translate-body" });
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
  render?.({ scope: "translate-body" });

  if (
    typeof loadActiveEditorFieldHistory === "function"
    && state.editorChapter.activeRowId === rowId
    && state.editorChapter.activeLanguageCode === languageCode
  ) {
    loadActiveEditorFieldHistory(render);
  }

  if (options.notice) {
    showNoticeBadge(options.notice, render);
  }
}

export function openEditorImageUrl(render, rowId, languageCode) {
  if (!rowId || !languageCode || !state.editorChapter?.chapterId) {
    return;
  }

  const existingEditor = imageEditorMatches(state.editorChapter, rowId, languageCode)
    ? state.editorChapter.imageEditor
    : null;
  setImageEditorState({
    rowId,
    languageCode,
    mode: "url",
    urlDraft: existingEditor?.urlDraft ?? "",
    invalidUrl: false,
    status: "idle",
  });
  render?.({ scope: "translate-body" });
  focusEditorImageControl(
    `[data-editor-image-url-input][data-row-id="${CSS.escape(rowId)}"][data-language-code="${CSS.escape(languageCode)}"]`,
    rowId,
    languageCode,
  );
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
    },
  };
}

function closeEditorImageInput(render) {
  if (!state.editorChapter?.chapterId) {
    return;
  }

  state.editorChapter = resetImageEditor(state.editorChapter);
  render?.({ scope: "translate-body" });
}

export async function persistEditorImageUrlOnBlur(render, rowId, languageCode, operations = {}, options = {}) {
  if (!imageEditorMatches(state.editorChapter, rowId, languageCode, "url")) {
    return;
  }

  const draft = String(state.editorChapter.imageEditor?.urlDraft ?? "").trim();
  const closeInput = options?.closeInput === true;
  if (!draft) {
    if (closeInput) {
      closeEditorImageInput(render);
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
    status: closeInput ? "submitting" : "saving",
  });
  render?.({ scope: "translate-body" });

  try {
    await validateImageUrlLoadable(draft);
  } catch {
    if (
      state.editorChapter?.chapterId === chapterAtRequest
      && imageEditorMatches(state.editorChapter, rowId, languageCode)
    ) {
      setImageEditorState({
        rowId,
        languageCode,
        mode: null,
        urlDraft: draft,
        invalidUrl: true,
        status: "idle",
      });
      render?.({ scope: "translate-body" });
    }
    return;
  }

  const row = await ensureEditorRowReadyForWrite(render, rowId, { allowStaleDirty: true });
  if (editorImageWriteBlocked(row, render)) {
    if (
      state.editorChapter?.chapterId === chapterAtRequest
      && imageEditorMatches(state.editorChapter, rowId, languageCode)
    ) {
      setImageEditorState({
        rowId,
        languageCode,
        mode: "url",
        urlDraft: draft,
        invalidUrl: false,
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
      mode: "url",
      urlDraft: draft,
      invalidUrl: false,
      status: "idle",
    });
    render?.({ scope: "translate-body" });
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
    if (
      state.editorChapter?.chapterId === chapterAtRequest
      && imageEditorMatches(state.editorChapter, rowId, languageCode)
    ) {
      setImageEditorState({
        rowId,
        languageCode,
        mode: "url",
        urlDraft: draft,
        invalidUrl: false,
        status: "idle",
      });
      render?.({ scope: "translate-body" });
    }
    const message = error instanceof Error ? error.message : String(error);
    showNoticeBadge(message || "The image URL could not be saved.", render);
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

  setImageEditorState({
    rowId,
    languageCode,
    mode: "upload",
    urlDraft: "",
    invalidUrl: false,
    status: "idle",
  });
  render?.({ scope: "translate-body" });
  focusEditorImageControl(
    `[data-editor-image-upload-dropzone][data-row-id="${CSS.escape(rowId)}"][data-language-code="${CSS.escape(languageCode)}"]`,
    rowId,
    languageCode,
  );
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

  const chapterAtRequest = state.editorChapter.chapterId;
  setImageEditorState({
    rowId,
    languageCode,
    mode: "upload",
    status: "saving",
  });
  render?.({ scope: "translate-body" });

  try {
    await validateUploadedImageFile(file);
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
        filename: file.name ?? "image",
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
  if (!(file instanceof File) || !imageEditorMatches(state.editorChapter, rowId, languageCode, "upload")) {
    return;
  }

  await saveUploadedEditorImage(render, rowId, languageCode, file, operations);
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
  render?.();
}

export function closeEditorImagePreview(render) {
  if (!state.editorChapter?.chapterId) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    imagePreviewOverlay: createEditorImagePreviewOverlayState(),
  };
  render?.();
}

export function closeEditorImageInvalidFileModal(render) {
  if (!state.editorChapter?.chapterId) {
    return;
  }

  setImageInvalidFileModal(false);
  render?.();
}
