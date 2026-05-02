import { handleInputEvent } from "./input-handlers.js";
import { handleNavigation } from "./navigation.js";
import { createActionDispatcher } from "./action-dispatcher.js";
import { checkForAppUpdate } from "./updater-flow.js";
import { listen } from "./runtime.js";
import { primeTranslateInteractionAnchor, primeTranslateMainScrollTop } from "./scroll-state.js";
import { syncGlossaryTermInlineStyleButtons } from "./glossary-term-inline-markup-flow.js";
import { registerKeyboardShortcutEvents } from "./events/keyboard-shortcuts.js";
import { registerNativeDropEvents } from "./events/native-drops.js";
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

const SYNC_WITH_SERVER_EVENT = "sync-with-server";
const CHECK_FOR_UPDATES_EVENT = "check-for-updates";
const PROJECT_EXPORT_SELECT_SELECTOR =
  "[data-project-export-format-select], [data-project-export-language-select]";

function openProjectExportSelectOnFirstPointer(event) {
  if (!(event instanceof PointerEvent) || event.button !== 0) {
    return false;
  }

  const select =
    event.target instanceof Element
      ? event.target.closest(PROJECT_EXPORT_SELECT_SELECTOR)
      : null;
  if (!(select instanceof HTMLSelectElement) || select.disabled) {
    return false;
  }

  const showPicker = select.showPicker;
  if (typeof showPicker !== "function") {
    return false;
  }

  try {
    select.focus({ preventScroll: true });
    showPicker.call(select);
    event.preventDefault();
    return true;
  } catch {
    return false;
  }
}

export function registerAppEvents(render) {
  const dispatchAction = createActionDispatcher(render);

  registerNativeDropEvents(render);
  registerKeyboardShortcutEvents(dispatchAction);
  registerGlossaryTooltipEvents();

  document.addEventListener("input", (event) => handleInputEvent(event, render));
  document.addEventListener("change", (event) => handleInputEvent(event, render));

  document.addEventListener("mousedown", (event) => {
    if (event.target instanceof Element && event.target.closest("[data-glossary-inline-style-button]")) {
      event.preventDefault();
      syncGlossaryTermInlineStyleButtons();
      return;
    }

    focusEditorFieldFromGlossaryMark(event);
  });

  document.addEventListener("focusin", () => {
    window.requestAnimationFrame(() => {
      syncGlossaryTermInlineStyleButtons();
    });
  });

  document.addEventListener("focusout", () => {
    window.requestAnimationFrame(() => {
      syncGlossaryTermInlineStyleButtons();
    });
  });

  document.addEventListener("selectionchange", () => {
    syncGlossaryTermInlineStyleButtons();
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

    if (openProjectExportSelectOnFirstPointer(event)) {
      return;
    }

    if (event.target instanceof Element && event.target.closest("[data-editor-replace-row-select]")) {
      primeTranslateInteractionAnchor(event.target);
      primeTranslateMainScrollTop();
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

    void listen(CHECK_FOR_UPDATES_EVENT, () => {
      void checkForAppUpdate(render, { silent: false });
    });
  }
}
