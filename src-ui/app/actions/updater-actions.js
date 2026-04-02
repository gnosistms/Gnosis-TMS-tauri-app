import { installAppUpdate } from "../updater-flow.js";

export function createUpdaterActions(render) {
  return {
    "install-app-update": async () => {
      await installAppUpdate(render);
    },
  };
}
