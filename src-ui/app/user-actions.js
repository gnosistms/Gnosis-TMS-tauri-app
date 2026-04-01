import { actionSuffix, runWithImmediateLoading } from "./action-helpers.js";
import {
  acknowledgeInviteUserSuccess,
  cancelInviteUser,
  editInviteUserSelection,
  openInviteUser,
  selectInviteUserSuggestion,
  submitInviteUser,
} from "./user-flow.js";

export function createUserActions(render) {
  return async function handleUserAction(action, event) {
    if (action === "open-invite-user") {
      openInviteUser(render);
      return true;
    }

    if (action === "cancel-invite-user") {
      cancelInviteUser(render);
      return true;
    }

    if (action === "edit-selected-invite-user") {
      editInviteUserSelection(render);
      return true;
    }

    if (action === "acknowledge-invite-user-success") {
      acknowledgeInviteUserSuccess(render);
      return true;
    }

    if (action === "submit-invite-user") {
      await runWithImmediateLoading(event, "Inviting...", () => submitInviteUser(render));
      return true;
    }

    const selectedSuggestionId = actionSuffix(action, "select-invite-user-suggestion:");
    if (selectedSuggestionId !== null) {
      selectInviteUserSuggestion(render, selectedSuggestionId);
      return true;
    }

    return false;
  };
}
