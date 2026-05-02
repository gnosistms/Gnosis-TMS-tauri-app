import { onCurrentWebviewDragDrop } from "../runtime.js";
import {
  handleDroppedProjectImportFiles,
  handleDroppedProjectImportPaths,
} from "../project-import-flow.js";
import {
  handleDroppedGlossaryImportFile,
  handleDroppedGlossaryImportPath,
} from "../glossary-import-flow.js";

const PROJECT_IMPORT_DROPZONE_SELECTOR = "[data-project-import-dropzone]";
const GLOSSARY_IMPORT_DROPZONE_SELECTOR = "[data-glossary-import-dropzone]";

function droppedProjectImportFiles(dataTransfer) {
  const directFiles = Array.from(dataTransfer?.files ?? []).filter(Boolean);
  if (directFiles.length > 0) {
    return directFiles;
  }

  if (!dataTransfer?.items) {
    return [];
  }

  const files = [];
  for (const item of Array.from(dataTransfer.items)) {
    if (item?.kind !== "file" || typeof item.getAsFile !== "function") {
      continue;
    }

    const file = item.getAsFile();
    if (file) {
      files.push(file);
    }
  }

  return files;
}

function nativeDropPosition(event) {
  const position = event?.payload?.position;
  if (
    position
    && typeof position === "object"
    && Number.isFinite(position.x)
    && Number.isFinite(position.y)
  ) {
    return { x: position.x, y: position.y };
  }

  return null;
}

function closestProjectImportDropzoneFromElement(element) {
  if (!(element instanceof Element)) {
    return null;
  }

  const dropzone = element.closest(PROJECT_IMPORT_DROPZONE_SELECTOR);
  return dropzone instanceof HTMLElement ? dropzone : null;
}

function closestGlossaryImportDropzoneFromElement(element) {
  if (!(element instanceof Element)) {
    return null;
  }

  const dropzone = element.closest(GLOSSARY_IMPORT_DROPZONE_SELECTOR);
  return dropzone instanceof HTMLElement ? dropzone : null;
}

function visibleProjectImportDropzone() {
  const dropzone = document.querySelector(PROJECT_IMPORT_DROPZONE_SELECTOR);
  if (!(dropzone instanceof HTMLElement)) {
    return null;
  }

  const rect = dropzone.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }

  return dropzone;
}

function visibleGlossaryImportDropzone() {
  const dropzone = document.querySelector(GLOSSARY_IMPORT_DROPZONE_SELECTOR);
  if (!(dropzone instanceof HTMLElement)) {
    return null;
  }

  const rect = dropzone.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }

  return dropzone;
}

function setProjectImportDropzoneNativeDragActive(isActive) {
  const dropzone = visibleProjectImportDropzone();
  if (!dropzone) {
    return null;
  }

  dropzone.classList.toggle("is-native-drag-over", isActive);
  return dropzone;
}

function setGlossaryImportDropzoneNativeDragActive(isActive) {
  const dropzone = visibleGlossaryImportDropzone();
  if (!dropzone) {
    return null;
  }

  dropzone.classList.toggle("is-native-drag-over", isActive);
  return dropzone;
}

function pointIsInsideElement(element, x, y) {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function projectImportDropzoneFromNativeDropEvent(event) {
  const visibleDropzone = visibleProjectImportDropzone();
  if (!visibleDropzone) {
    return null;
  }

  const position = nativeDropPosition(event);
  if (!position) {
    return visibleDropzone;
  }

  const scale = Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0
    ? window.devicePixelRatio
    : 1;
  const points = [
    [position.x, position.y],
    [position.x / scale, position.y / scale],
  ];

  for (const [x, y] of points) {
    const element = document.elementFromPoint(x, y);
    const dropzone = closestProjectImportDropzoneFromElement(element);
    if (dropzone) {
      return dropzone;
    }

    if (pointIsInsideElement(visibleDropzone, x, y)) {
      return visibleDropzone;
    }
  }

  return visibleDropzone;
}

function glossaryImportDropzoneFromNativeDropEvent(event) {
  const visibleDropzone = visibleGlossaryImportDropzone();
  if (!visibleDropzone) {
    return null;
  }

  const position = nativeDropPosition(event);
  if (!position) {
    return visibleDropzone;
  }

  const scale = Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0
    ? window.devicePixelRatio
    : 1;
  const points = [
    [position.x, position.y],
    [position.x / scale, position.y / scale],
  ];

  for (const [x, y] of points) {
    const element = document.elementFromPoint(x, y);
    const dropzone = closestGlossaryImportDropzoneFromElement(element);
    if (dropzone) {
      return dropzone;
    }

    if (pointIsInsideElement(visibleDropzone, x, y)) {
      return visibleDropzone;
    }
  }

  return visibleDropzone;
}

export function registerNativeDropEvents(render) {
  void onCurrentWebviewDragDrop((event) => {
    const eventType = event?.payload?.type;
    if (eventType === "enter" || eventType === "over") {
      setProjectImportDropzoneNativeDragActive(Boolean(projectImportDropzoneFromNativeDropEvent(event)));
      setGlossaryImportDropzoneNativeDragActive(Boolean(glossaryImportDropzoneFromNativeDropEvent(event)));
      return;
    }

    if (eventType === "leave") {
      setProjectImportDropzoneNativeDragActive(false);
      setGlossaryImportDropzoneNativeDragActive(false);
      return;
    }

    if (eventType !== "drop") {
      return;
    }

    setProjectImportDropzoneNativeDragActive(false);
    setGlossaryImportDropzoneNativeDragActive(false);
    const droppedPaths = Array.isArray(event?.payload?.paths)
      ? event.payload.paths
      : [];
    const importPaths = droppedPaths.filter((value) => typeof value === "string" && value.trim());
    if (importPaths.length === 0) {
      return;
    }

    if (projectImportDropzoneFromNativeDropEvent(event)) {
      void handleDroppedProjectImportPaths(render, importPaths);
      return;
    }

    const droppedPath = importPaths[0];
    if (glossaryImportDropzoneFromNativeDropEvent(event)) {
      void handleDroppedGlossaryImportPath(render, droppedPath);
    }
  });

  document.addEventListener("dragover", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const dropzone =
      target?.closest(PROJECT_IMPORT_DROPZONE_SELECTOR)
      ?? target?.closest(GLOSSARY_IMPORT_DROPZONE_SELECTOR);
    if (!(dropzone instanceof HTMLElement)) {
      return;
    }

    event.preventDefault();
    dropzone.classList.add("is-native-drag-over");
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
  });

  document.addEventListener("dragleave", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const dropzone =
      target?.closest(PROJECT_IMPORT_DROPZONE_SELECTOR)
      ?? target?.closest(GLOSSARY_IMPORT_DROPZONE_SELECTOR);
    if (!(dropzone instanceof HTMLElement)) {
      return;
    }

    dropzone.classList.remove("is-native-drag-over");
  });

  document.addEventListener("drop", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const projectDropzone = target?.closest(PROJECT_IMPORT_DROPZONE_SELECTOR);
    const glossaryDropzone = target?.closest(GLOSSARY_IMPORT_DROPZONE_SELECTOR);
    const dropzone = projectDropzone ?? glossaryDropzone;
    if (!(dropzone instanceof HTMLElement)) {
      return;
    }

    event.preventDefault();
    dropzone.classList.remove("is-native-drag-over");
    const files = droppedProjectImportFiles(event.dataTransfer);
    if (files.length === 0) {
      return;
    }

    if (projectDropzone instanceof HTMLElement) {
      void handleDroppedProjectImportFiles(render, files);
      return;
    }

    const file = files[0];
    void handleDroppedGlossaryImportFile(render, file);
  });
}
