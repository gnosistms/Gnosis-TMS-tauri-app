import { clearNoticeBadge, showNoticeBadge } from "./status-feedback.js";

export function guardResourceCreateStart(options) {
  const installationReady =
    typeof options?.installationReady === "function"
      ? options.installationReady
      : () => true;
  const offlineBlocked =
    typeof options?.offlineBlocked === "function"
      ? options.offlineBlocked
      : () => false;
  const canCreate =
    typeof options?.canCreate === "function"
      ? options.canCreate
      : () => true;
  const onBlocked = options?.onBlocked;

  if (!installationReady()) {
    onBlocked?.(options?.installationMessage ?? "This action requires a GitHub App-connected team.");
    return false;
  }

  if (offlineBlocked()) {
    onBlocked?.(options?.offlineMessage ?? "You cannot create this resource while offline.");
    return false;
  }

  if (!canCreate()) {
    onBlocked?.(options?.permissionMessage ?? "You do not have permission to create this resource in this team.");
    return false;
  }

  return true;
}

export function showResourceCreateProgress(render, text) {
  showNoticeBadge(text, render, null);
}

export function clearResourceCreateProgress() {
  clearNoticeBadge();
}
