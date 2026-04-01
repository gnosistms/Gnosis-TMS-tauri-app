import { state } from "../state.js";
import { loadTeamProjects } from "../project-flow.js";
import { loadTeamUsers, primeUsersForTeam } from "../user-flow.js";
import { actionSuffix } from "../action-helpers.js";
import { waitForNextPaint } from "../runtime.js";

export function createNavigationActions(render) {
  return async function handleNavigationAction(action) {
    const openTeamId = actionSuffix(action, "open-team:");
    if (openTeamId !== null) {
      state.selectedTeamId = openTeamId;
      state.screen = "projects";
      render();
      void loadTeamProjects(render, state.selectedTeamId);
      return true;
    }

    const openTeamUsersId = actionSuffix(action, "open-team-users:");
    if (openTeamUsersId !== null) {
      state.selectedTeamId = openTeamUsersId;
      state.screen = "users";
      primeUsersForTeam(state.selectedTeamId);
      render();
      void waitForNextPaint().then(() => loadTeamUsers(render, state.selectedTeamId));
      return true;
    }

    const openTeamGlossariesId = actionSuffix(action, "open-team-glossaries:");
    if (openTeamGlossariesId !== null) {
      state.selectedTeamId = openTeamGlossariesId;
      state.screen = "glossaries";
      render();
      return true;
    }

    const openGlossaryId = actionSuffix(action, "open-glossary:");
    if (openGlossaryId !== null) {
      state.selectedGlossaryId = openGlossaryId;
      state.screen = "glossaryEditor";
      render();
      return true;
    }

    if (action === "open-glossaries") {
      state.screen = "glossaries";
      render();
      return true;
    }

    const chapterId = actionSuffix(action, "open-translate:");
    if (chapterId !== null) {
      state.selectedChapterId = chapterId;
      state.screen = "translate";
      render();
      return true;
    }

    return false;
  };
}
