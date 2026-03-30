import { hasOfflineData } from "./offline-connectivity.js";
import { createConnectionFailureState, state } from "./state.js";

export function openConnectionFailureModal(message, render) {
  state.connectionFailure = {
    isOpen: true,
    message,
    canGoOffline: hasOfflineData(),
  };
  render?.();
}

export function closeConnectionFailureModal(render) {
  state.connectionFailure = createConnectionFailureState();
  render?.();
}
