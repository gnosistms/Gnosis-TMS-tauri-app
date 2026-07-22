import { handleInputEvent, handlePasteEvent } from "./input-handlers.js";
import { handleNavigation } from "./navigation.js";
import { createActionDispatcher } from "./action-dispatcher.js";
import { checkForAppUpdate } from "./updater-flow.js";
import { listen } from "./runtime.js";
import { syncGlossaryTermInlineStyleButtons } from "./glossary-term-inline-markup-flow.js";
import { syncQaTermInlineStyleButtons } from "./qa-term-inline-markup-flow.js";
import { registerKeyboardShortcutEvents } from "./events/keyboard-shortcuts.js";
import { registerListboxControlEvents } from "./events/listbox-control.js";
import { registerNativeDropEvents } from "./events/native-drops.js";
import { reportBackendNonfatalError } from "./telemetry.js";
import {
  deactivateGlossaryTooltipMark,
  focusEditorFieldFromGlossaryMark,
  handleGlossaryTooltipPointerMove,
  registerGlossaryTooltipEvents,
} from "./events/glossary-tooltip.js";
import {
  cancelGlossaryTermVariantDrag,
  finishGlossaryTermVariantDrag,
  startGlossaryTermVariantDrag,
  updateGlossaryTermVariantDrag,
} from "./events/glossary-term-variant-drag.js";
import {
  cancelTargetLanguageManagerDrag,
  finishTargetLanguageManagerDrag,
  startTargetLanguageManagerDrag,
  updateTargetLanguageManagerDrag,
} from "./events/target-language-drag.js";
import { registerProjectAddTranslationProgress } from "./project-add-translation-flow.js";
import {
  installProjectsRenderHold,
  isProjectsSelectCommitTarget,
  withProjectsSelectCommit,
} from "./projects-render-hold.js";

const SYNC_WITH_SERVER_EVENT = "sync-with-server";
const ERROR_REPORTING_EVENT = "open-error-reporting";
const CHECK_FOR_UPDATES_EVENT = "check-for-updates";
const BACKEND_NONFATAL_TELEMETRY_EVENT = "backend-nonfatal-telemetry";
export function registerAppEvents(render) {
  const dispatchAction = createActionDispatcher(render);

  registerNativeDropEvents(render);
  registerKeyboardShortcutEvents(dispatchAction);
  registerListboxControlEvents();
  registerGlossaryTooltipEvents();
  registerProjectAddTranslationProgress(render);

  installProjectsRenderHold();
  document.addEventListener("input", (event) => handleInputEvent(event, render));
  document.addEventListener("change", (event) => {
    // A chapter-select commit must render its optimistic update immediately,
    // so its change handling runs with the projects render hold bypassed.
    if (isProjectsSelectCommitTarget(event.target)) {
      withProjectsSelectCommit(() => handleInputEvent(event, render));
      return;
    }
    handleInputEvent(event, render);
  });
  document.addEventListener("paste", (event) => handlePasteEvent(event, render));

  document.addEventListener("mousedown", (event) => {
    if (event.target instanceof Element && event.target.closest("[data-glossary-inline-style-button]")) {
      event.preventDefault();
      syncGlossaryTermInlineStyleButtons();
      return;
    }

    if (event.target instanceof Element && event.target.closest("[data-qa-term-inline-style-button]")) {
      event.preventDefault();
      syncQaTermInlineStyleButtons();
      return;
    }

    // Keep the active editor field focused (and its selection intact) when the
    // Insert-link button is pressed, so the link targets whichever field the user
    // was editing — including footnotes — instead of falling back to the main field.
    if (event.target instanceof Element && event.target.closest("[data-editor-link-button]")) {
      event.preventDefault();
      return;
    }

    focusEditorFieldFromGlossaryMark(event);
  });

  document.addEventListener("focusin", () => {
    window.requestAnimationFrame(() => {
      syncGlossaryTermInlineStyleButtons();
      syncQaTermInlineStyleButtons();
    });
  });

  document.addEventListener("focusout", () => {
    window.requestAnimationFrame(() => {
      syncGlossaryTermInlineStyleButtons();
      syncQaTermInlineStyleButtons();
    });
  });

  document.addEventListener("selectionchange", () => {
    syncGlossaryTermInlineStyleButtons();
    syncQaTermInlineStyleButtons();
  });


  document.addEventListener("click", async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) {
      return;
    }

    const disabledControl = target.closest('[aria-disabled="true"], :disabled');
    if (disabledControl) {
      event.preventDefault();
      return;
    }

    if (target.closest("[data-stop-row-action]")) {
      return;
    }

    const navTarget = target.closest("[data-nav-target]")?.dataset.navTarget;
    if (navTarget) {
      await handleNavigation(navTarget, render);
      return;
    }

    const action = target.closest("[data-action]")?.dataset.action;
    if (!action) {
      return;
    }

    await dispatchAction(action, event);
  });

  document.addEventListener("pointerdown", (event) => {
    if (!(event instanceof PointerEvent) || event.button !== 0) {
      return;
    }

    if (event.target instanceof Element && event.target.closest("[data-editor-replace-row-select]")) {
      event.preventDefault();
      return;
    }

    if (event.target instanceof Element && event.target.closest("[data-editor-search-case-toggle]")) {
      event.preventDefault();
      return;
    }

    startGlossaryTermVariantDrag(event);
    startTargetLanguageManagerDrag(event);
  });

  document.addEventListener("pointermove", (event) => {
    if (!(event instanceof PointerEvent)) {
      return;
    }

    handleGlossaryTooltipPointerMove(event);

    updateGlossaryTermVariantDrag(event);
    updateTargetLanguageManagerDrag(event);
  });

  document.addEventListener("pointerup", (event) => {
    if (!(event instanceof PointerEvent)) {
      return;
    }

    void finishGlossaryTermVariantDrag(event, dispatchAction);
    void finishTargetLanguageManagerDrag(event, dispatchAction);
  });

  document.addEventListener("pointercancel", () => {
    cancelGlossaryTermVariantDrag();
    cancelTargetLanguageManagerDrag();
  });

  window.addEventListener("blur", () => {
    cancelGlossaryTermVariantDrag();
    cancelTargetLanguageManagerDrag();
    deactivateGlossaryTooltipMark();
  });

  if (listen) {
    void listen(SYNC_WITH_SERVER_EVENT, () => {
      void dispatchAction("refresh-page");
    });

    void listen(ERROR_REPORTING_EVENT, () => {
      void dispatchAction("open-error-reporting-settings");
    });

    void listen(CHECK_FOR_UPDATES_EVENT, () => {
      void checkForAppUpdate(render, { silent: false });
    });

    void listen(BACKEND_NONFATAL_TELEMETRY_EVENT, (event) => {
      reportBackendNonfatalError(event?.payload);
    });
  }
}
