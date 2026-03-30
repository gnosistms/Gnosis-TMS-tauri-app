import { state } from "./state.js";

let noticeTimeoutId = null;

export function getNoticeBadgeText() {
  return state.statusBadges.left.visible ? state.statusBadges.left.text : "";
}

export function getScopedSyncBadgeText(scope) {
  const right = state.statusBadges.right;
  return right.visible && right.scope === scope ? right.text : "";
}

export function showNoticeBadge(text, render, durationMs = 1800) {
  clearNoticeBadge();
  state.statusBadges.left = {
    visible: true,
    text,
  };
  render();

  if (durationMs === null) {
    return;
  }

  noticeTimeoutId = window.setTimeout(() => {
    state.statusBadges.left = {
      visible: false,
      text: "",
    };
    render();
    noticeTimeoutId = null;
  }, durationMs);
}

export function clearNoticeBadge() {
  if (noticeTimeoutId) {
    window.clearTimeout(noticeTimeoutId);
    noticeTimeoutId = null;
  }

  state.statusBadges.left = {
    visible: false,
    text: "",
  };
}

export function showScopedSyncBadge(scope, text, render) {
  state.statusBadges.right = {
    visible: true,
    text,
    scope,
  };
  render();
}

export function clearScopedSyncBadge(scope, render) {
  const right = state.statusBadges.right;
  if (!right.visible || right.scope !== scope) {
    return;
  }

  state.statusBadges.right = {
    visible: false,
    text: "",
    scope: null,
  };
  render();
}
