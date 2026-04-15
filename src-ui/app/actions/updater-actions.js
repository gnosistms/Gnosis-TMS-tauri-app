import { dismissAppUpdatePrompt, installAppUpdate } from "../updater-flow.js";

export function createUpdaterActions(render) {
  return {
    "dismiss-app-update": () => {
      dismissAppUpdatePrompt(render);
    },
    "install-app-update": async () => {
      await installAppUpdate(render);
    },
  };
}
