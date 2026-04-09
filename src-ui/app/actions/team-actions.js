import { openExternalUrl } from "../runtime.js";
import { state } from "../state.js";
import {
  cancelTeamLeave,
  cancelTeamPermanentDeletion,
  cancelTeamRename,
  confirmTeamLeave,
  confirmTeamPermanentDeletion,
  deleteTeam,
  openTeamLeave,
  openTeamPermanentDeletion,
  openTeamRename,
  restoreTeam,
  submitTeamRename,
} from "../team-flow/actions.js";
import {
  acknowledgeTeamSetup,
  beginGithubAppInstall,
  beginTeamOrgSetup,
  cancelTeamSetup,
  continueTeamSetupAfterOrgCreation,
  finishTeamSetup,
  openTeamSetup,
} from "../team-flow/setup.js";
import { actionSuffix, runWithImmediateLoading } from "../action-helpers.js";

export function createTeamActions(render) {
  const exactActions = {
    "open-new-team": () => openTeamSetup(render),
    "toggle-deleted-teams": () => {
      state.showDeletedTeams = !state.showDeletedTeams;
      render();
    },
    "cancel-team-setup": () => cancelTeamSetup(render),
    "cancel-team-rename": () => cancelTeamRename(render),
    "cancel-team-permanent-deletion": () => cancelTeamPermanentDeletion(render),
    "cancel-team-leave": () => cancelTeamLeave(render),
    "acknowledge-team-setup": () => acknowledgeTeamSetup(render),
    "begin-github-app-install": () => beginGithubAppInstall(render),
    "begin-team-org-setup": () => beginTeamOrgSetup(render),
    "continue-team-setup-after-org-creation": () => continueTeamSetupAfterOrgCreation(render),
    "finish-team-setup": () => finishTeamSetup(render),
    "open-github-signup": () => openExternalUrl("https://github.com/signup"),
  };

  const prefixHandlers = [
    {
      prefix: "rename-team:",
      handler: (teamId) => openTeamRename(render, teamId),
    },
    {
      prefix: "delete-team:",
      handler: (teamId) => deleteTeam(render, teamId),
    },
    {
      prefix: "leave-team:",
      handler: (teamId) => openTeamLeave(render, teamId),
    },
    {
      prefix: "restore-team:",
      handler: (teamId) => restoreTeam(render, teamId),
    },
    {
      prefix: "delete-deleted-team:",
      handler: (teamId) => openTeamPermanentDeletion(render, teamId),
    },
  ];

  return async function handleTeamAction(action, event) {
    if (exactActions[action]) {
      if (action === "submit-team-rename") {
        await runWithImmediateLoading(event, "Saving...", () => submitTeamRename(render));
        return true;
      }
      if (action === "finish-team-setup") {
        await runWithImmediateLoading(event, "Finishing...", () => finishTeamSetup(render));
        return true;
      }
      if (action === "confirm-team-permanent-deletion") {
        await runWithImmediateLoading(event, "Deleting...", () =>
          confirmTeamPermanentDeletion(render),
        );
        return true;
      }
      if (action === "confirm-team-leave") {
        await runWithImmediateLoading(event, "Leaving...", () => confirmTeamLeave(render));
        return true;
      }

      exactActions[action]();
      return true;
    }

    if (action === "submit-team-rename") {
      await runWithImmediateLoading(event, "Saving...", () => submitTeamRename(render));
      return true;
    }
    if (action === "confirm-team-permanent-deletion") {
      await runWithImmediateLoading(event, "Deleting...", () =>
        confirmTeamPermanentDeletion(render),
      );
      return true;
    }
    if (action === "confirm-team-leave") {
      await runWithImmediateLoading(event, "Leaving...", () => confirmTeamLeave(render));
      return true;
    }

    for (const { prefix, handler } of prefixHandlers) {
      const value = actionSuffix(action, prefix);
      if (value !== null) {
        await handler(value);
        return true;
      }
    }

    return false;
  };
}
