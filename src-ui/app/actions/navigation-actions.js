import { state } from "../state.js";
import {
  clearScopedSyncBadge,
  showNoticeBadge,
  showScopedSyncBadge,
} from "../status-feedback.js";
import {
  loadTeamGlossaries,
  openGlossaryEditor,
  openGlossaryTermEditor,
  primeGlossariesLoadingState,
} from "../glossary-flow.js";
import { findGlossaryTermById } from "../glossary-term-sync.js";
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
import { collapseEditorMainField, openTranslateChapter } from "../translate-flow.js";
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
      // Show the refresh badge before the access check, not after — the access refresh
      // can take seconds when the teams listing is not fresh, and this path previously
      // sat badge-less the whole time.
      showScopedSyncBadge("projects", "Refreshing project list...", null);
      render();
      void (async () => {
        try {
          // Capabilities arrive with the combined resource listing during the load —
          // no blocking access check on entry.
          await loadTeamProjects(render, state.selectedTeamId);
        } finally {
          clearScopedSyncBadge("projects", render);
        }
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
      void openQaListEditor(render, openQaListId);
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

    const openEditorGlossaryTermId = actionSuffix(action, "open-editor-glossary-term:");
    if (openEditorGlossaryTermId !== null) {
      const glossary = resolveSelectedChapterGlossary();
      if (!glossary?.repoName) {
        return true;
      }

      // The first click of the double-click opened this field's editor. Close it
      // before leaving, or the field comes back from the glossary still in
      // open-editor mode — which suppresses its glossary underlines.
      const mainField = state.editorChapter?.mainFieldEditor;
      if (mainField?.rowId && mainField?.languageCode) {
        collapseEditorMainField(render, mainField.rowId, mainField.languageCode);
      }

      const glossaryId = glossary.id ?? glossary.glossaryId;
      void (async () => {
        await openGlossaryEditor(render, glossaryId, {
          navigationSource: "editor",
          preferredGlossary: glossary,
        });
        if (
          state.screen !== "glossaryEditor"
          || state.glossaryEditor?.glossaryId !== glossaryId
          || state.glossaryEditor?.status !== "ready"
        ) {
          return;
        }

        if (!findGlossaryTermById(openEditorGlossaryTermId, state.glossaryEditor)) {
          showNoticeBadge("This term is no longer in the glossary.", render);
          return;
        }

        await openGlossaryTermEditor(render, openEditorGlossaryTermId);
      })();
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
