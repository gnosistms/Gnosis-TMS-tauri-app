import { showNoticeBadge } from "./status-feedback.js";

export function showOfflineUnsupportedMessage(render) {
  showNoticeBadge("This operation is not supported in offline mode", render);
}
