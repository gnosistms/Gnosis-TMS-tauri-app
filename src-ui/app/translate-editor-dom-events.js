import { syncEditorRowTextareaHeight } from "./autosize.js";
import { syncEditorImagePreviewFrameWithResult } from "./editor-image-preview-size.js";
import { syncEditorVirtualizationRowLayout } from "./editor-virtualization.js";
import { closestEventTarget } from "./event-target.js";
import { onCurrentWebviewDragDrop, openExternalUrl } from "./runtime.js";
import {
  captureTranslateAnchorForRow,
  primeTranslateInteractionAnchor,
  primeTranslateMainScrollTop,
} from "./scroll-state.js";
import { captureTranslateViewport } from "./translate-viewport.js";
import { noteUserScrollIntent } from "./editor-scroll-session.js";
import { state } from "./state.js";
import {
  collapseEditorMainField,
  collapseEditorImageCaption,
  collapseEmptyEditorFootnote,
  collapseEmptyEditorImageEditor,
  persistEditorRowOnBlur,
  moveEditorPreviewSearch,
  dismissActiveIdleEditorImageUpload,
  flushDirtyEditorRows,
  handleDroppedEditorImageFile,
  handleDroppedEditorImagePath,
  runEditorAiAssistant,
  scheduleDirtyEditorRowScan,
  setActiveEditorField,
  submitEditorImageUrl,
  toggleEditorRowFieldMarker,
  jumpFromPreviewBlockToTranslateMode,
} from "./translate-flow.js";
import { syncActiveEditorInlineStyleButtons } from "./editor-inline-markup-flow.js";
import { showNoticeBadge } from "./status-feedback.js";

const PREVIEW_EDITABLE_TEXT_BLOCK_SELECTOR = [
  "[data-editor-preview-document] p.translate-preview__block[data-preview-block][data-row-id]",
  "[data-editor-preview-document] h1.translate-preview__block[data-preview-block][data-row-id]",
  "[data-editor-preview-document] h2.translate-preview__block[data-preview-block][data-row-id]",
  "[data-editor-preview-document] blockquote.translate-preview__block[data-preview-block][data-row-id]",
].join(", ");

function previewEditableTextBlockFromTarget(target) {
  if (!(target instanceof Element)) {
    return null;
  }

  if (target.closest("[data-editor-preview-document] a[href]")) {
    return null;
  }

  const block = target.closest(PREVIEW_EDITABLE_TEXT_BLOCK_SELECTOR);
  return block instanceof HTMLElement ? block : null;
}

export function activeElementKeepsEditorControlOpen(
  rowId,
  languageCode,
  doc = document,
  chapterState = state.editorChapter,
) {
  if (!rowId || !languageCode) {
    return false;
  }

  const activeElement = doc?.activeElement;
  if (!activeElement || typeof activeElement.closest !== "function") {
    return false;
  }

  const cluster = activeElement.closest("[data-editor-language-cluster]");
  if (
    cluster?.dataset?.rowId === rowId
    && cluster?.dataset?.languageCode === languageCode
  ) {
    return true;
  }

  const insertLinkInput = activeElement.closest("[data-editor-insert-link-url-input]");
  const insertLinkModal = chapterState?.insertLinkModal;
  return Boolean(
    insertLinkInput
    && insertLinkModal?.isOpen === true
    && insertLinkModal.mode === "url"
    && insertLinkModal.rowId === rowId
    && insertLinkModal.languageCode === languageCode,
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

  const focusField = () => {
    const nextField = document.querySelector(
      `[data-editor-row-field][data-row-id="${CSS.escape(rowId)}"][data-language-code="${CSS.escape(languageCode)}"]`,
    );
    if (nextField instanceof HTMLTextAreaElement) {
      nextField.focus({ preventScroll: true });
      return true;
    }
    return false;
  };

  // Row patches render synchronously, so the replacement field usually exists
  // already. Focusing it now (not next frame) matters: a focusout collapse
  // check queued by the patch would otherwise run first, see focus on body,
  // and close the editor this refocus targets.
  if (focusField()) {
    return;
  }

  requestAnimationFrame(() => {
    focusField();
  });
}

function activeEditorControlRowId() {
  const control = activeEditorControl();
  return control instanceof HTMLElement ? (control.dataset.rowId ?? "") : "";
}

function activeEditorControl() {
  const activeElement = document.activeElement;
  if (!(activeElement instanceof Element)) {
    return null;
  }

  const control = activeElement.closest(
    "[data-editor-row-field], [data-editor-image-url-input], [data-editor-image-upload-dropzone]",
  );
  return control instanceof HTMLElement ? control : null;
}

function textOffsetFromDomPoint(container, node, offset) {
  if (!(container instanceof HTMLElement) || !(node instanceof Node) || !container.contains(node)) {
    return null;
  }

  const range = document.createRange();
  range.selectNodeContents(container);
  try {
    range.setEnd(node, offset);
  } catch {
    return null;
  }

  return Math.max(0, Math.min(container.textContent?.length ?? 0, range.toString().length));
}

function displayFieldOffsetFromPoint(displayField, clientX, clientY) {
  const displayText = displayField?.querySelector?.("[data-editor-display-text]");
  if (!(displayField instanceof HTMLElement) || !(displayText instanceof HTMLElement)) {
    return null;
  }

  if (typeof document.caretPositionFromPoint === "function") {
    const caretPosition = document.caretPositionFromPoint(clientX, clientY);
    const nextOffset = textOffsetFromDomPoint(
      displayText,
      caretPosition?.offsetNode ?? null,
      caretPosition?.offset ?? 0,
    );
    if (Number.isInteger(nextOffset)) {
      return nextOffset;
    }
  }

  if (typeof document.caretRangeFromPoint === "function") {
    const caretRange = document.caretRangeFromPoint(clientX, clientY);
    const nextOffset = textOffsetFromDomPoint(
      displayText,
      caretRange?.startContainer ?? null,
      caretRange?.startOffset ?? 0,
    );
    if (Number.isInteger(nextOffset)) {
      return nextOffset;
    }
  }

  return displayText.textContent?.length ?? 0;
}

const SCROLL_INTENT_KEYS = new Set([
  "PageUp",
  "PageDown",
  "Home",
  "End",
  "ArrowUp",
  "ArrowDown",
  " ",
]);

// User scroll intent must come from input events: `scroll` events fire for
// programmatic scrollTop writes too, so listening to them would let the app
// treat its own restores as user scrolling. Listeners are delegated (checked
// via closest) because the scroll container is destroyed and recreated on
// every translate-body render.
function registerTranslateScrollIntentEvents(app) {
  const withinTranslateScroll = (target) =>
    target instanceof Element && target.closest(".translate-main-scroll") !== null;

  app.addEventListener("wheel", (event) => {
    if (withinTranslateScroll(event.target)) {
      noteUserScrollIntent("wheel");
    }
  }, { passive: true, capture: true });

  app.addEventListener("touchmove", (event) => {
    if (withinTranslateScroll(event.target)) {
      noteUserScrollIntent("touch");
    }
  }, { passive: true, capture: true });

  // A pointerdown whose target IS the scroll container (not a child) hits the
  // scrollbar gutter — the start of a scrollbar drag.
  app.addEventListener("pointerdown", (event) => {
    if (
      event.target instanceof HTMLElement
      && event.target.classList.contains("translate-main-scroll")
    ) {
      noteUserScrollIntent("scrollbar");
    }
  }, { passive: true, capture: true });

  app.addEventListener("keydown", (event) => {
    if (!SCROLL_INTENT_KEYS.has(event.key)) {
      return;
    }

    // Keys typed into editor fields edit text; they only scroll when focus is
    // on the scroll container or a non-editing element inside it.
    const target = event.target;
    if (
      target instanceof HTMLTextAreaElement
      || target instanceof HTMLInputElement
      || target instanceof HTMLSelectElement
    ) {
      return;
    }

    if (withinTranslateScroll(target)) {
      noteUserScrollIntent("key");
    }
  }, { passive: true, capture: true });
}

export function registerTranslateEditorDomEvents(app, render) {
  let pendingImageUrlCloseRequest = null;

  registerTranslateScrollIntentEvents(app);

  void onCurrentWebviewDragDrop((event) => {
    if (event?.payload?.type !== "drop") {
      return;
    }

    const droppedPaths = Array.isArray(event?.payload?.paths)
      ? event.payload.paths
      : [];
    const droppedPath = droppedPaths.find((value) => typeof value === "string" && value.trim());
    if (!droppedPath) {
      return;
    }

    void handleDroppedEditorImagePath(render, droppedPath);
  });

  app.addEventListener("focusin", (event) => {
    const input = closestEventTarget(event.target, "[data-editor-row-field]");
    if (!(input instanceof HTMLTextAreaElement)) {
      return;
    }

    const rowId = input.dataset.rowId ?? "";
    const languageCode = input.dataset.languageCode ?? "";
    void setActiveEditorField(render, rowId, languageCode, { input });
    syncEditorRowTextareaHeight(input);
    syncActiveEditorInlineStyleButtons();
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
      "[data-editor-row-text-style-button], [data-editor-inline-style-button], [data-editor-separator-button], [data-editor-link-button], [data-editor-footnote-button], [data-editor-image-button], [data-editor-image-caption-button], [data-editor-image-upload-dropzone], [data-editor-image-upload-close-button], [data-editor-image-url-close-button], [data-editor-image-url-status-button], [data-editor-language-image-remove-button], [data-action^=\"switch-editor-sidebar-tab:\"], [data-action^=\"run-editor-ai-translate:\"], [data-action^=\"apply-editor-assistant-draft:\"], [data-action^=\"review-editor-text-now:\"], [data-action=\"review-editor-text-now\"], [data-action=\"apply-editor-ai-review\"], [data-preview-search-nav-button]",
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

    const externalLink = closestEventTarget(event.target, "a[href]");
    if (
      externalLink instanceof HTMLAnchorElement
      && /^https?:\/\//i.test(externalLink.getAttribute("href") ?? "")
    ) {
      event.preventDefault();
      return;
    }

    const previewBlock = previewEditableTextBlockFromTarget(event.target);
    if (previewBlock && event.detail === 1) {
      showNoticeBadge("Double click to edit this text", render, 2200);
      return;
    }

    const displayField = closestEventTarget(event.target, "[data-editor-display-field]");
    if (displayField instanceof HTMLButtonElement) {
      const rowId = displayField.dataset.rowId ?? "";
      const languageCode = displayField.dataset.languageCode ?? "";
      const previouslyFocusedControl = activeEditorControl();
      const previouslyFocusedRowId = previouslyFocusedControl?.dataset?.rowId ?? "";
      if (previouslyFocusedRowId && previouslyFocusedRowId !== rowId) {
        scheduleDirtyEditorRowScan(render, previouslyFocusedRowId);
      }
      primeTranslateInteractionAnchor(displayField);
      primeTranslateMainScrollTop();
      const viewportSnapshot = captureTranslateViewport(displayField, {
        preferPrimed: true,
        expectedRowId: rowId,
        fallbackAnchor: captureTranslateAnchorForRow(rowId, languageCode),
      });
      const pendingSelectionOffset = displayFieldOffsetFromPoint(displayField, event.clientX, event.clientY);
      if (
        previouslyFocusedControl instanceof HTMLTextAreaElement
        && previouslyFocusedControl.dataset.contentKind === "footnote"
        && previouslyFocusedRowId === rowId
        && previouslyFocusedControl.dataset.languageCode === languageCode
      ) {
        collapseEmptyEditorFootnote(render, rowId, languageCode, { viewportSnapshot });
      }
      event.preventDefault();
      void setActiveEditorField(render, rowId, languageCode, {
        openEditor: true,
        pendingSelectionOffset,
        target: displayField,
        viewportSnapshot,
      });
      return;
    }

    const editorControlButton = closestEventTarget(
      event.target,
      "[data-editor-row-text-style-button], [data-editor-inline-style-button], [data-editor-separator-button], [data-editor-link-button], [data-editor-footnote-button], [data-editor-footnote-display], [data-editor-image-button], [data-editor-image-caption-button], [data-editor-image-upload-close-button], [data-editor-image-url-close-button], [data-editor-image-url-status-button], [data-editor-language-image-remove-button], [data-action^=\"switch-editor-sidebar-tab:\"]",
    );
    const imageOpenButton = closestEventTarget(
      event.target,
      '[data-action="open-editor-image-url"], [data-action="open-editor-image-upload"]',
    );
    const uploadDropzone = closestEventTarget(event.target, "[data-editor-image-upload-dropzone]");
    const uploadCloseButton = closestEventTarget(event.target, "[data-editor-image-upload-close-button]");
    const imageUrlCloseButton = closestEventTarget(event.target, "[data-editor-image-url-close-button]");
    const previewSearchNavButton = closestEventTarget(event.target, "[data-preview-search-nav-button]");
    const aiTranslateButton = closestEventTarget(event.target, '[data-action^="run-editor-ai-translate:"]');
    const nextTextarea = closestEventTarget(event.target, "[data-editor-row-field]");
    const dismissedUploadEditor =
      !(editorControlButton instanceof HTMLButtonElement)
      && !(uploadDropzone instanceof HTMLButtonElement)
      && !(uploadCloseButton instanceof HTMLButtonElement)
      && !(aiTranslateButton instanceof HTMLButtonElement)
      && !(previewSearchNavButton instanceof HTMLButtonElement)
      && dismissActiveIdleEditorImageUpload(render);
    if (dismissedUploadEditor && nextTextarea instanceof HTMLTextAreaElement) {
      refocusEditorRowFieldAfterRender(
        nextTextarea.dataset.rowId ?? "",
        nextTextarea.dataset.languageCode ?? "",
      );
      // The dismissal patch replaced the pressed textarea, so the browser's
      // default focus action would land on the detached node's container and
      // blur the field just refocused above.
      event.preventDefault();
    }
    if (uploadDropzone instanceof HTMLButtonElement) {
      event.preventDefault();
      return;
    }

    if (uploadCloseButton instanceof HTMLButtonElement) {
      event.preventDefault();
      return;
    }

    if (imageUrlCloseButton instanceof HTMLButtonElement) {
      pendingImageUrlCloseRequest = {
        rowId: imageUrlCloseButton.dataset.rowId ?? "",
        languageCode: imageUrlCloseButton.dataset.languageCode ?? "",
      };
      event.preventDefault();
      return;
    }

    if (previewSearchNavButton instanceof HTMLButtonElement) {
      event.preventDefault();
      return;
    }

    if (aiTranslateButton instanceof HTMLButtonElement) {
      primeTranslateInteractionAnchor();
      primeTranslateMainScrollTop();
      event.preventDefault();
      return;
    }

    if (imageOpenButton instanceof HTMLButtonElement) {
      primeTranslateInteractionAnchor(imageOpenButton);
      primeTranslateMainScrollTop();
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
    void toggleEditorRowFieldMarker(render, rowId, languageCode, kind, {
      viewportSnapshot: captureTranslateViewport(button, {
        fallbackAnchor: captureTranslateAnchorForRow(rowId, languageCode),
      }),
    });
  });

  app.addEventListener("click", (event) => {
    const externalLink = closestEventTarget(event.target, "a[href]");
    if (
      externalLink instanceof HTMLAnchorElement
      && /^https?:\/\//i.test(externalLink.getAttribute("href") ?? "")
    ) {
      event.preventDefault();
      event.stopPropagation();
      openExternalUrl(externalLink.getAttribute("href") ?? "");
      return;
    }

    const displayField = closestEventTarget(event.target, "[data-editor-display-field]");
    if (displayField instanceof HTMLButtonElement) {
      const rowId = displayField.dataset.rowId ?? "";
      const languageCode = displayField.dataset.languageCode ?? "";
      if (
        state.editorChapter?.mainFieldEditor?.rowId === rowId
        && state.editorChapter?.mainFieldEditor?.languageCode === languageCode
      ) {
        return;
      }

      event.preventDefault();
      void setActiveEditorField(render, rowId, languageCode, {
        openEditor: true,
        pendingSelectionOffset: displayField.textContent?.length ?? 0,
        target: displayField,
        viewportSnapshot: captureTranslateViewport(displayField, {
          fallbackAnchor: captureTranslateAnchorForRow(rowId, languageCode),
        }),
      });
      return;
    }

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

  app.addEventListener("dblclick", (event) => {
    const previewBlock = previewEditableTextBlockFromTarget(event.target);
    if (!previewBlock) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    jumpFromPreviewBlockToTranslateMode(render, previewBlock);
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
    if (
      imageUrlInput instanceof HTMLInputElement
      && pendingImageUrlCloseRequest?.rowId === rowId
      && pendingImageUrlCloseRequest?.languageCode === languageCode
    ) {
      pendingImageUrlCloseRequest = null;
      return;
    }
    const viewportSnapshot = captureTranslateViewport(control, {
      fallbackAnchor: captureTranslateAnchorForRow(rowId, languageCode),
    });
    if (
      textarea instanceof HTMLTextAreaElement
      && (contentKind === "" || contentKind === "footnote")
    ) {
      viewportSnapshot.anchor =
        captureTranslateAnchorForRow(rowId, languageCode, { preferRow: true })
        ?? viewportSnapshot.anchor;
    }
    if (textarea instanceof HTMLTextAreaElement) {
      requestAnimationFrame(() => {
        syncEditorRowTextareaHeight(textarea);
        syncEditorVirtualizationRowLayout(textarea);
        syncActiveEditorInlineStyleButtons();
      });
    }
    if (imageUrlInput instanceof HTMLInputElement) {
      requestAnimationFrame(() => {
        if (document.activeElement === imageUrlInput) {
          return;
        }

        void submitEditorImageUrl(render, rowId, languageCode);
      });
      return;
    }
    if (textarea instanceof HTMLTextAreaElement && contentKind === "image-caption") {
      requestAnimationFrame(() => {
        if (document.activeElement === textarea) {
          return;
        }

        if (activeElementKeepsEditorControlOpen(rowId, languageCode)) {
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

      if (activeElementKeepsEditorControlOpen(rowId, languageCode)) {
        return;
      }

      collapseEditorMainField(render, rowId, languageCode, { viewportSnapshot });
      collapseEmptyEditorFootnote(render, rowId, languageCode, { viewportSnapshot });
      collapseEmptyEditorImageEditor(render, rowId, languageCode);
      void submitEditorImageUrl(render, rowId, languageCode);
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

    const previewSearchInput = closestEventTarget(event.target, "[data-preview-search-input]");
    if (previewSearchInput instanceof HTMLInputElement) {
      const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
      if (
        key === "enter"
        && !event.metaKey
        && !event.ctrlKey
        && !event.altKey
      ) {
        event.preventDefault();
        moveEditorPreviewSearch(render, event.shiftKey ? "previous" : "next");
      }
      return;
    }

    const assistantDraftInput = closestEventTarget(event.target, "[data-editor-assistant-draft]");
    if (assistantDraftInput instanceof HTMLTextAreaElement) {
      const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
      if (
        key === "enter"
        && event.shiftKey
        && !event.metaKey
        && !event.ctrlKey
        && !event.altKey
      ) {
        event.preventDefault();
        void runEditorAiAssistant(render);
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

    syncEditorImagePreviewFrameWithResult(image);
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

  document.addEventListener("selectionchange", () => {
    syncActiveEditorInlineStyleButtons(document);
  });
}
