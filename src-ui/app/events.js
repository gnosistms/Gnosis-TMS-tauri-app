import { handleInputEvent } from "./input-handlers.js";
import { handleNavigation } from "./navigation.js";
import { createActionDispatcher } from "./action-dispatcher.js";

export function registerAppEvents(render) {
  const dispatchAction = createActionDispatcher(render);

  document.addEventListener("input", (event) => handleInputEvent(event, render));

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
}
