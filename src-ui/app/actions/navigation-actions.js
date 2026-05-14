import { state } from "../state.js";
import {
  loadTeamGlossaries,
  openGlossaryEditor,
  primeGlossariesLoadingState,
} from "../glossary-flow.js";
import {
  loadTeamQaLists,
  openEditorQaList,
  openQaListEditor,
  primeQaListsLoadingState,
} from "../qa-list-flow.js";
import { openAiKeyPage } from "../ai-settings-flow.js";
import {
  loadTeamProjects,
  primeProjectsLoadingState,
} from "../project-flow.js";
import { loadTeamUsers, primeUsersForTeam } from "../team-members-flow.js";
import { actionSuffix } from "../action-helpers.js";
import { waitForNextPaint } from "../runtime.js";
import { openTranslateChapter } from "../translate-flow.js";
import { resolveSelectedChapterGlossary } from "../project-context.js";
import { refreshCurrentUserTeamAccess } from "../team-query.js";

async function refreshSelectedTeamAccess(render) {
  if (!state.selectedTeamId) {
    return;
  }

  await refreshCurrentUserTeamAccess({ render });
}

export function createNavigationActions(render) {
  return async function handleNavigationAction(action) {
    const openTeamId = actionSuffix(action, "open-team:");
    if (openTeamId !== null) {
      state.selectedTeamId = openTeamId;
      state.screen = "projects";
      primeProjectsLoadingState(openTeamId);
      render();
      void (async () => {
        await refreshSelectedTeamAccess(render);
        await loadTeamProjects(render, state.selectedTeamId);
      })();
      return true;
    }

    const openTeamUsersId = actionSuffix(action, "open-team-users:");
    if (openTeamUsersId !== null) {
      state.selectedTeamId = openTeamUsersId;
      state.screen = "users";
      primeUsersForTeam(state.selectedTeamId);
      render();
      void waitForNextPaint().then(async () => {
        await refreshSelectedTeamAccess(render);
        return loadTeamUsers(render, state.selectedTeamId);
      });
      return true;
    }

    const openTeamGlossariesId = actionSuffix(action, "open-team-glossaries:");
    if (openTeamGlossariesId !== null) {
      state.selectedTeamId = openTeamGlossariesId;
      state.screen = "glossaries";
      primeGlossariesLoadingState(state.selectedTeamId);
      render();
      void (async () => {
        await refreshSelectedTeamAccess(render);
        await loadTeamGlossaries(render, state.selectedTeamId);
      })();
      return true;
    }

    const openTeamQaId = actionSuffix(action, "open-team-qa:");
    if (openTeamQaId !== null) {
      state.selectedTeamId = openTeamQaId;
      state.screen = "qa";
      primeQaListsLoadingState(state.selectedTeamId);
      render();
      void (async () => {
        await refreshSelectedTeamAccess(render);
        await loadTeamQaLists(render, state.selectedTeamId);
      })();
      return true;
    }

    const openTeamAiSettingsId = actionSuffix(action, "open-team-ai-settings:");
    if (openTeamAiSettingsId !== null) {
      state.selectedTeamId = openTeamAiSettingsId;
      openAiKeyPage(render, { returnScreen: "teams" });
      return true;
    }

    const openQaListId = actionSuffix(action, "open-qa-list:");
    if (openQaListId !== null) {
      openQaListEditor(render, openQaListId);
      return true;
    }

    const openGlossaryId = actionSuffix(action, "open-glossary:");
    if (openGlossaryId !== null) {
      void openGlossaryEditor(render, openGlossaryId);
      return true;
    }

    if (action === "open-editor-glossary") {
      const glossary = resolveSelectedChapterGlossary();
      if (!glossary?.repoName) {
        return true;
      }

      void openGlossaryEditor(render, glossary.id ?? glossary.glossaryId, {
        navigationSource: "editor",
        preferredGlossary: glossary,
      });
      return true;
    }

    if (action === "open-editor-qa") {
      void openEditorQaList(render);
      return true;
    }

    if (action === "open-glossaries") {
      state.screen = "glossaries";
      primeGlossariesLoadingState(state.selectedTeamId, {
        preserveVisibleData: state.glossaries.length > 0,
      });
      render();
      void (async () => {
        await refreshSelectedTeamAccess(render);
        await loadTeamGlossaries(render, state.selectedTeamId, {
          preserveVisibleData: state.glossaries.length > 0,
        });
      })();
      return true;
    }

    if (action === "open-qa-lists") {
      state.screen = "qa";
      primeQaListsLoadingState(state.selectedTeamId, {
        preserveVisibleData: state.qaLists.length > 0,
      });
      render();
      void (async () => {
        await refreshSelectedTeamAccess(render);
        await loadTeamQaLists(render, state.selectedTeamId);
      })();
      return true;
    }

    const chapterId = actionSuffix(action, "open-translate:");
    if (chapterId !== null) {
      await openTranslateChapter(render, chapterId);
      return true;
    }

    return false;
  };
}
