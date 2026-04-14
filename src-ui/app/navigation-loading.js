import {
  createNavigationLoadingModalState,
  state,
} from "./state.js";

let nextNavigationLoadingToken = 1;

export function showNavigationLoadingModal(title, message = "") {
  const token = nextNavigationLoadingToken;
  nextNavigationLoadingToken += 1;

  state.navigationLoadingModal = {
    isOpen: true,
    title: typeof title === "string" ? title : String(title ?? ""),
    message: typeof message === "string" ? message : String(message ?? ""),
    token,
  };

  return token;
}

export function hideNavigationLoadingModal(token = null) {
  if (
    token !== null
    && state.navigationLoadingModal?.isOpen === true
    && state.navigationLoadingModal?.token !== token
  ) {
    return false;
  }

  state.navigationLoadingModal = createNavigationLoadingModalState();
  return true;
}
