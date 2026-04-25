import { actionSuffix, runWithImmediateLoading } from "./action-helpers.js";
import { openTeamLeave } from "./team-flow/actions.js";
import { state } from "./state.js";
import {
  acknowledgeInviteUserSuccess,
  cancelInviteUser,
  editInviteUserSelection,
  openInviteUser,
  selectInviteUserSuggestion,
  submitInviteUser,
} from "./invite-user-flow.js";
import {
  cancelTeamMemberOwnerPromotion,
  cancelTeamMemberRemoval,
  confirmTeamMemberOwnerPromotion,
  confirmTeamMemberRemoval,
  makeOrganizationAdmin,
  openTeamMemberOwnerPromotion,
  openTeamMemberRemoval,
  revokeOrganizationAdmin,
} from "./team-members-flow.js";

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

    if (action === "cancel-team-member-removal") {
      cancelTeamMemberRemoval(render);
      return true;
    }

    if (action === "cancel-team-member-owner-promotion") {
      cancelTeamMemberOwnerPromotion(render);
      return true;
    }

    if (action === "submit-invite-user") {
      await runWithImmediateLoading(event, "Inviting...", () => submitInviteUser(render));
      return true;
    }

    if (action === "confirm-team-member-removal") {
      await runWithImmediateLoading(event, "Removing...", () => confirmTeamMemberRemoval(render));
      return true;
    }

    if (action === "confirm-team-member-owner-promotion") {
      await runWithImmediateLoading(event, "Promoting...", () =>
        confirmTeamMemberOwnerPromotion(render),
      );
      return true;
    }

    const leaveTeamId = actionSuffix(action, "open-current-team-leave:");
    if (leaveTeamId !== null) {
      const selectedTeamId = state.selectedTeamId ?? "";
      if (leaveTeamId === selectedTeamId) {
        openTeamLeave(render, leaveTeamId);
        return true;
      }
    }

    const selectedSuggestionId = actionSuffix(action, "select-invite-user-suggestion:");
    if (selectedSuggestionId !== null) {
      selectInviteUserSuggestion(render, selectedSuggestionId);
      return true;
    }

    const makeAdminUsername = actionSuffix(action, "make-admin:");
    if (makeAdminUsername !== null) {
      void makeOrganizationAdmin(render, makeAdminUsername);
      return true;
    }

    const revokeAdminUsername = actionSuffix(action, "revoke-admin:");
    if (revokeAdminUsername !== null) {
      void revokeOrganizationAdmin(render, revokeAdminUsername);
      return true;
    }

    const removalUsername = actionSuffix(action, "open-team-member-removal:");
    if (removalUsername !== null) {
      openTeamMemberRemoval(render, removalUsername);
      return true;
    }

    const ownerPromotionUsername = actionSuffix(action, "open-team-member-owner-promotion:");
    if (ownerPromotionUsername !== null) {
      openTeamMemberOwnerPromotion(render, ownerPromotionUsername);
      return true;
    }

    return false;
  };
}
