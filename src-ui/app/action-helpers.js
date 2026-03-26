import { waitForNextPaint } from "./runtime.js";
import { setImmediateLoadingButton } from "../lib/ui.js";

export async function runWithImmediateLoading(event, label, action) {
  setImmediateLoadingButton(event.target.closest("button"), label);
  await waitForNextPaint();
  return action();
}

export function actionSuffix(action, prefix) {
  if (!action.startsWith(prefix)) {
    return null;
  }

  return action.slice(prefix.length);
}
