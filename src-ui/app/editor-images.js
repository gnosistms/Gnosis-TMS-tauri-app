function normalizeText(value) {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

function uploadedImageFileName(image) {
  const fileName = normalizeText(image?.fileName);
  if (fileName) {
    return fileName;
  }

  const path = normalizeText(image?.path);
  if (!path) {
    return "";
  }

  const segments = path.split("/");
  return segments[segments.length - 1] ?? "";
}

export function normalizeEditorFieldImage(image) {
  if (!image || typeof image !== "object") {
    return null;
  }

  const kind = normalizeText(image.kind);
  if (kind === "url") {
    const url = normalizeText(image.url);
    if (!url) {
      return null;
    }

    return {
      kind: "url",
      url,
      path: null,
      filePath: null,
      fileName: null,
    };
  }

  if (kind === "upload") {
    const path = normalizeText(image.path);
    if (!path) {
      return null;
    }

    const filePath = normalizeText(image.filePath) || null;
    const fileName = uploadedImageFileName(image) || null;
    return {
      kind: "upload",
      url: null,
      path,
      filePath,
      fileName,
    };
  }

  return null;
}

export function cloneRowImages(images) {
  return Object.fromEntries(
    Object.entries(images && typeof images === "object" ? images : {})
      .map(([code, image]) => [code, normalizeEditorFieldImage(image)])
      .filter(([, image]) => Boolean(image)),
  );
}

export function editorFieldImageEqual(left, right) {
  const normalizedLeft = normalizeEditorFieldImage(left);
  const normalizedRight = normalizeEditorFieldImage(right);
  if (!normalizedLeft || !normalizedRight) {
    return normalizedLeft === normalizedRight;
  }

  return (
    normalizedLeft.kind === normalizedRight.kind
    && normalizedLeft.url === normalizedRight.url
    && normalizedLeft.path === normalizedRight.path
    && normalizedLeft.fileName === normalizedRight.fileName
  );
}

export function rowImagesEqual(left, right) {
  const leftImages = cloneRowImages(left);
  const rightImages = cloneRowImages(right);
  const leftEntries = Object.entries(leftImages);
  const rightEntries = Object.entries(rightImages);
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }

  return leftEntries.every(([code, image]) => editorFieldImageEqual(image, rightImages[code]));
}

export function editorFieldImageMetadataText(image) {
  const normalizedImage = normalizeEditorFieldImage(image);
  if (!normalizedImage) {
    return "";
  }

  if (normalizedImage.kind === "url") {
    return normalizedImage.url ?? "";
  }

  return normalizedImage.fileName ?? uploadedImageFileName(normalizedImage);
}
