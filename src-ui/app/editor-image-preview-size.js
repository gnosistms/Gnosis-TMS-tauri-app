const EDITOR_IMAGE_PREVIEW_MAX_CONTENT_WIDTH_PX = 360;
const EDITOR_IMAGE_PREVIEW_MAX_CONTENT_HEIGHT_PX = 100;
const EDITOR_IMAGE_PREVIEW_FRAME_CHROME_PX = 18;
const cachedEditorImagePreviewFrameSizeBySrc = new Map();
const pendingEditorImagePreviewFrameSyncByImage = new WeakMap();

function finitePositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function editorImagePreviewFrameSize(naturalWidth, naturalHeight) {
  const width = finitePositiveNumber(naturalWidth);
  const height = finitePositiveNumber(naturalHeight);
  if (!width || !height) {
    return null;
  }

  const scale = Math.min(
    1,
    EDITOR_IMAGE_PREVIEW_MAX_CONTENT_WIDTH_PX / width,
    EDITOR_IMAGE_PREVIEW_MAX_CONTENT_HEIGHT_PX / height,
  );
  const contentWidth = Math.max(1, Math.round(width * scale));
  const contentHeight = Math.max(1, Math.round(height * scale));

  return {
    contentWidth,
    contentHeight,
    frameWidth: contentWidth + EDITOR_IMAGE_PREVIEW_FRAME_CHROME_PX,
    frameHeight: contentHeight + EDITOR_IMAGE_PREVIEW_FRAME_CHROME_PX,
  };
}

function normalizedImagePreviewSrc(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function cacheEditorImagePreviewFrameSize(src, size) {
  const normalizedSrc = normalizedImagePreviewSrc(src);
  if (!normalizedSrc || !size) {
    return;
  }

  cachedEditorImagePreviewFrameSizeBySrc.set(normalizedSrc, {
    contentWidth: size.contentWidth,
    contentHeight: size.contentHeight,
    frameWidth: size.frameWidth,
    frameHeight: size.frameHeight,
  });
}

export function editorImagePreviewFrameSizeForSrc(src) {
  return cachedEditorImagePreviewFrameSizeBySrc.get(normalizedImagePreviewSrc(src)) ?? null;
}

export function editorImagePreviewFrameSizesEqual(left, right) {
  return (
    Boolean(left)
    && Boolean(right)
    && left.contentWidth === right.contentWidth
    && left.contentHeight === right.contentHeight
    && left.frameWidth === right.frameWidth
    && left.frameHeight === right.frameHeight
  );
}

export function cacheEditorImagePreviewFrameSizeForTests(src, size) {
  cacheEditorImagePreviewFrameSize(src, size);
}

export function clearEditorImagePreviewFrameSizeCacheForTests() {
  cachedEditorImagePreviewFrameSizeBySrc.clear();
}

function imagePreviewSyncKey(src, naturalWidth, naturalHeight) {
  return `${normalizedImagePreviewSrc(src)}::${Number(naturalWidth) || 0}x${Number(naturalHeight) || 0}`;
}

export function takeEditorImagePreviewFrameSyncResult(image) {
  if (!(image instanceof HTMLImageElement)) {
    return null;
  }

  const pending = pendingEditorImagePreviewFrameSyncByImage.get(image) ?? null;
  pendingEditorImagePreviewFrameSyncByImage.delete(image);
  return pending?.result ?? null;
}

export function syncEditorImagePreviewFrameWithResult(image) {
  if (!(image instanceof HTMLImageElement)) {
    return { synced: false, sizeChanged: false, size: null, previousSize: null };
  }

  const preview = image.closest(".translation-language-panel__image-preview");
  if (!(preview instanceof HTMLElement)) {
    return { synced: false, sizeChanged: false, size: null, previousSize: null };
  }

  const src = image.currentSrc || image.src;
  const syncKey = imagePreviewSyncKey(src, image.naturalWidth, image.naturalHeight);
  const pending = pendingEditorImagePreviewFrameSyncByImage.get(image);
  if (pending?.key === syncKey) {
    return pending.result;
  }

  const size = editorImagePreviewFrameSize(image.naturalWidth, image.naturalHeight);
  if (!size) {
    return { synced: false, sizeChanged: false, size: null, previousSize: null };
  }

  const previousSize = editorImagePreviewFrameSizeForSrc(src);
  const sizeChanged = !editorImagePreviewFrameSizesEqual(previousSize, size);
  preview.style.setProperty("--editor-image-preview-width", `${size.frameWidth}px`);
  preview.style.setProperty("--editor-image-preview-height", `${size.frameHeight}px`);
  image.style.setProperty("--editor-image-preview-content-width", `${size.contentWidth}px`);
  image.style.setProperty("--editor-image-preview-content-height", `${size.contentHeight}px`);
  cacheEditorImagePreviewFrameSize(src, size);
  preview.classList.remove("is-loading");
  preview.removeAttribute("aria-busy");
  const result = { synced: true, sizeChanged, size, previousSize };
  pendingEditorImagePreviewFrameSyncByImage.set(image, { key: syncKey, result });
  return result;
}

export function syncEditorImagePreviewFrame(image) {
  return syncEditorImagePreviewFrameWithResult(image).synced;
}
