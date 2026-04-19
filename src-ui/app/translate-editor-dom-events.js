import { syncEditorRowTextareaHeight } from "./autosize.js";
import { syncEditorVirtualizationRowLayout } from "./editor-virtualization.js";
import { closestEventTarget } from "./event-target.js";
import { listen } from "./runtime.js";
import { state } from "./state.js";
import {
  collapseEditorImageCaption,
  collapseEmptyEditorFootnote,
  collapseEmptyEditorImageEditor,
  dismissActiveIdleEditorImageUpload,
  flushDirtyEditorRows,
  handleDroppedEditorImageFile,
  handleDroppedEditorImagePath,
  persistEditorImageUrlOnBlur,
  scheduleDirtyEditorRowScan,
  setActiveEditorField,
  submitEditorImageUrl,
  toggleEditorRowFieldMarker,
} from "./translate-flow.js";

const TAURI_DRAG_DROP_EVENT = "tauri://drag-drop";

function activeElementIsInEditorLanguageCluster(rowId, languageCode) {
  if (!rowId || !languageCode) {
    return false;
  }

  const activeElement = document.activeElement;
  if (!(activeElement instanceof Element)) {
    return false;
  }

  const cluster = activeElement.closest("[data-editor-language-cluster]");
  return (
    cluster instanceof HTMLElement
    && cluster.dataset.rowId === rowId
    && cluster.dataset.languageCode === languageCode
  );
}

function droppedEditorImageFile(dataTransfer) {
  const directFile = dataTransfer?.files?.[0];
  if (directFile) {
    return directFile;
  }

  if (!dataTransfer?.items) {
    return null;
  }

  for (const item of Array.from(dataTransfer.items)) {
    if (item?.kind !== "file" || typeof item.getAsFile !== "function") {
      continue;
    }

    const file = item.getAsFile();
    if (file) {
      return file;
    }
  }

  return null;
}

function refocusEditorRowFieldAfterRender(rowId, languageCode) {
  if (!rowId || !languageCode) {
    return;
  }

  requestAnimationFrame(() => {
    const nextField = document.querySelector(
      `[data-editor-row-field][data-row-id="${CSS.escape(rowId)}"][data-language-code="${CSS.escape(languageCode)}"]`,
    );
    if (nextField instanceof HTMLTextAreaElement) {
      nextField.focus({ preventScroll: true });
    }
  });
}

export function registerTranslateEditorDomEvents(app, render) {
  if (typeof listen === "function") {
    void listen(TAURI_DRAG_DROP_EVENT, (event) => {
      const droppedPaths = Array.isArray(event?.payload?.paths)
        ? event.payload.paths
        : [];
      const droppedPath = droppedPaths.find((value) => typeof value === "string" && value.trim());
      if (!droppedPath) {
        return;
      }

      void handleDroppedEditorImagePath(render, droppedPath);
    });
  }

  app.addEventListener("focusin", (event) => {
    const input = closestEventTarget(event.target, "[data-editor-row-field]");
    if (!(input instanceof HTMLTextAreaElement)) {
      return;
    }

    const rowId = input.dataset.rowId ?? "";
    const languageCode = input.dataset.languageCode ?? "";
    void setActiveEditorField(render, rowId, languageCode, { input });
    syncEditorRowTextareaHeight(input);
    requestAnimationFrame(() => syncEditorVirtualizationRowLayout(input));
    requestAnimationFrame(() => {
      const activeElement = document.activeElement;
      if (
        !(activeElement instanceof HTMLTextAreaElement)
        || !activeElement.matches("[data-editor-row-field]")
        || activeElement.dataset.rowId !== rowId
        || activeElement.dataset.languageCode !== languageCode
      ) {
        return;
      }

      void flushDirtyEditorRows(render, { excludeRowId: rowId });
    });
  });

  app.addEventListener("mousedown", (event) => {
    const button = closestEventTarget(
      event.target,
      "[data-editor-row-text-style-button], [data-editor-footnote-button], [data-editor-image-button], [data-editor-image-caption-button], [data-editor-image-upload-dropzone], [data-editor-language-image-remove-button], [data-action^=\"switch-editor-sidebar-tab:\"]",
    );
    if (!button) {
      return;
    }

    event.preventDefault();
  });

  app.addEventListener("pointerdown", (event) => {
    if (!(event instanceof PointerEvent) || event.button !== 0) {
      return;
    }

    const uploadDropzone = closestEventTarget(event.target, "[data-editor-image-upload-dropzone]");
    const nextTextarea = closestEventTarget(event.target, "[data-editor-row-field]");
    const dismissedUploadEditor =
      !(uploadDropzone instanceof HTMLButtonElement)
      && dismissActiveIdleEditorImageUpload(render);
    if (dismissedUploadEditor && nextTextarea instanceof HTMLTextAreaElement) {
      refocusEditorRowFieldAfterRender(
        nextTextarea.dataset.rowId ?? "",
        nextTextarea.dataset.languageCode ?? "",
      );
    }
    if (uploadDropzone instanceof HTMLButtonElement) {
      event.preventDefault();
      return;
    }

    const button = closestEventTarget(
      event.target,
      '[data-action="toggle-editor-reviewed"], [data-action="toggle-editor-please-check"]',
    );
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const rowId = button.dataset.rowId ?? "";
    const languageCode = button.dataset.languageCode ?? "";
    const kind = button.dataset.action === "toggle-editor-reviewed" ? "reviewed" : "please-check";
    void toggleEditorRowFieldMarker(render, rowId, languageCode, kind);
  });

  app.addEventListener("click", (event) => {
    const button = closestEventTarget(
      event.target,
      '[data-action="toggle-editor-reviewed"], [data-action="toggle-editor-please-check"]',
    );
    if (!button) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
  });

  app.addEventListener("focusout", (event) => {
    const target = closestEventTarget(
      event.target,
      "[data-editor-row-field], [data-editor-image-url-input], [data-editor-image-upload-dropzone]",
    );
    const textarea = target?.closest?.("[data-editor-row-field]");
    const imageUrlInput = target?.closest?.("[data-editor-image-url-input]");
    const imageUploadDropzone = target?.closest?.("[data-editor-image-upload-dropzone]");
    const control = textarea ?? imageUrlInput ?? imageUploadDropzone;
    if (!(control instanceof HTMLElement)) {
      return;
    }

    const rowId = control.dataset.rowId ?? "";
    const languageCode = control.dataset.languageCode ?? "";
    const contentKind = textarea?.dataset.contentKind ?? "";
    if (textarea instanceof HTMLTextAreaElement) {
      requestAnimationFrame(() => {
        syncEditorRowTextareaHeight(textarea);
        syncEditorVirtualizationRowLayout(textarea);
      });
    }
    if (textarea instanceof HTMLTextAreaElement && contentKind === "image-caption") {
      requestAnimationFrame(() => {
        if (document.activeElement === textarea) {
          return;
        }

        collapseEditorImageCaption(render, rowId, languageCode);
        void persistEditorRowOnBlur(render, rowId);
      });
      scheduleDirtyEditorRowScan(render, rowId);
      return;
    }
    requestAnimationFrame(() => {
      if (imageUploadDropzone instanceof HTMLElement && !document.hasFocus()) {
        return;
      }

      if (activeElementIsInEditorLanguageCluster(rowId, languageCode)) {
        return;
      }

      collapseEmptyEditorFootnote(render, rowId, languageCode);
      collapseEmptyEditorImageEditor(render, rowId, languageCode);
      void persistEditorImageUrlOnBlur(render, rowId, languageCode);
    });
    if (textarea instanceof HTMLTextAreaElement) {
      scheduleDirtyEditorRowScan(render, rowId);
    }
  });

  app.addEventListener("keydown", (event) => {
    if (
      event.defaultPrevented
      || event.repeat
      || event.isComposing
    ) {
      return;
    }

    const captionInput = closestEventTarget(event.target, "[data-editor-image-caption-input]");
    if (captionInput instanceof HTMLTextAreaElement) {
      const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
      if (
        key === "enter"
        && event.shiftKey
        && !event.metaKey
        && !event.ctrlKey
        && !event.altKey
      ) {
        event.preventDefault();
        captionInput.blur();
      }
      return;
    }

    const input = closestEventTarget(event.target, "[data-editor-image-url-input]");
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
    if (
      key !== "enter"
      || !event.shiftKey
      || event.metaKey
      || event.ctrlKey
      || event.altKey
    ) {
      return;
    }

    event.preventDefault();
    void submitEditorImageUrl(render, input.dataset.rowId ?? "", input.dataset.languageCode ?? "");
  });

  app.addEventListener("dragover", (event) => {
    const dropzone = closestEventTarget(event.target, "[data-editor-image-upload-dropzone]");
    if (!(dropzone instanceof HTMLElement)) {
      return;
    }

    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
  });

  app.addEventListener("drop", (event) => {
    const dropzone = closestEventTarget(event.target, "[data-editor-image-upload-dropzone]");
    if (!(dropzone instanceof HTMLElement)) {
      return;
    }

    event.preventDefault();
    const file = droppedEditorImageFile(event.dataTransfer);
    if (!file) {
      return;
    }

    void handleDroppedEditorImageFile(
      render,
      dropzone.dataset.rowId ?? "",
      dropzone.dataset.languageCode ?? "",
      file,
    );
  });

  app.addEventListener("load", (event) => {
    const image = closestEventTarget(event.target, "[data-editor-language-image-preview-img]");
    if (!(image instanceof HTMLImageElement)) {
      return;
    }

    syncEditorVirtualizationRowLayout(image);
  }, true);

  app.addEventListener("beforeinput", (event) => {
    const input = closestEventTarget(event.target, "[data-editor-row-field]");
    if (!(input instanceof HTMLTextAreaElement)) {
      return;
    }

    const row = state.editorChapter?.rows?.find?.((candidate) => candidate?.rowId === input.dataset.rowId) ?? null;
    if (!row || (row.freshness !== "stale" && row.remotelyDeleted !== true)) {
      return;
    }

    event.preventDefault();
    void setActiveEditorField(render, input.dataset.rowId ?? "", input.dataset.languageCode ?? "", {
      input,
      suppressNotice: true,
    });
  }, true);
}
