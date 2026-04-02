import { handleInputEvent } from "./input-handlers.js";
import { handleNavigation, refreshCurrentScreen } from "./navigation.js";
import { createActionDispatcher } from "./action-dispatcher.js";
import { checkForAppUpdate } from "./updater-flow.js";
import { listen } from "./runtime.js";

const SYNC_WITH_SERVER_EVENT = "sync-with-server";
const CHECK_FOR_UPDATES_EVENT = "check-for-updates";

function shouldTriggerSyncShortcut(event) {
  if (event.defaultPrevented || event.repeat) {
    return false;
  }

  const target = event.target;
  if (
    target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || target?.isContentEditable === true
  ) {
    return false;
  }

  const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
  if (navigator.platform.includes("Mac")) {
    return event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && key === "s";
  }

  return event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && key === "r";
}

export function registerAppEvents(render) {
  const dispatchAction = createActionDispatcher(render);

  document.addEventListener("input", (event) => handleInputEvent(event, render));
  document.addEventListener("keydown", (event) => {
    if (!shouldTriggerSyncShortcut(event)) {
      return;
    }

    event.preventDefault();
    void refreshCurrentScreen(render);
  });

  document.addEventListener("click", async (event) => {
    const disabledControl = event.target.closest('[aria-disabled="true"], :disabled');
    if (disabledControl) {
      event.preventDefault();
      return;
    }

    const navTarget = event.target.closest("[data-nav-target]")?.dataset.navTarget;
    if (navTarget) {
      handleNavigation(navTarget, render);
      return;
    }

    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!action) {
      return;
    }

    await dispatchAction(action, event);
  });

  if (listen) {
    void listen(SYNC_WITH_SERVER_EVENT, () => {
      void refreshCurrentScreen(render);
    });

    void listen(CHECK_FOR_UPDATES_EVENT, () => {
      void checkForAppUpdate(render, { silent: false });
    });
  }
}
