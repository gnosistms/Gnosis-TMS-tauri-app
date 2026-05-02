import { hasOfflineData, checkInternetConnection } from "./offline-connectivity.js";
import { waitForNextPaint } from "./runtime.js";
import { createConnectionFailureState, state } from "./state.js";

export function openConnectionFailureModal(message, render, options = {}) {
  const existingRetryAction =
    typeof state.connectionFailure?.retryAction === "function"
      ? state.connectionFailure.retryAction
      : null;
  state.connectionFailure = {
    isOpen: true,
    message,
    canGoOffline: hasOfflineData(),
    reconnecting: false,
    retryAction: typeof options.retryAction === "function"
      ? options.retryAction
      : existingRetryAction,
  };
  render?.();
}

export function closeConnectionFailureModal(render) {
  state.connectionFailure = createConnectionFailureState();
  render?.();
}

export async function reconnectFromConnectionFailure(render, fallbackRetryAction = null) {
  const failure = state.connectionFailure;
  if (!failure?.isOpen || failure.reconnecting === true) {
    return;
  }

  const retryAction =
    typeof failure.retryAction === "function"
      ? failure.retryAction
      : typeof fallbackRetryAction === "function"
        ? fallbackRetryAction
        : null;

  state.connectionFailure = {
    ...failure,
    reconnecting: true,
  };
  render?.();
  await waitForNextPaint();

  const hasConnection = await checkInternetConnection();
  state.offline.checked = true;
  state.offline.hasConnection = hasConnection;

  if (!hasConnection) {
    state.connectionFailure = {
      ...state.connectionFailure,
      isOpen: true,
      message: "No internet connection.",
      reconnecting: false,
      retryAction,
    };
    render?.();
    return;
  }

  if (!retryAction) {
    closeConnectionFailureModal(render);
    return;
  }

  try {
    await retryAction();
    if (state.connectionFailure?.isOpen && state.connectionFailure.reconnecting === true) {
      closeConnectionFailureModal(render);
    }
  } catch (error) {
    state.connectionFailure = {
      ...state.connectionFailure,
      isOpen: true,
      message: error?.message ?? String(error),
      reconnecting: false,
      retryAction,
    };
    render?.();
  }
}
