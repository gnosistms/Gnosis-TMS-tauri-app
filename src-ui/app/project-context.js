import { state } from "./state.js";

export function selectedProjectsTeam() {
  return state.teams.find((team) => team.id === state.selectedTeamId) ?? null;
}

export function selectedProjectsTeamInstallationId() {
  const installationId = selectedProjectsTeam()?.installationId;
  return Number.isFinite(installationId) ? installationId : null;
}

export function findChapterContext(chapterId) {
  for (const project of [...state.projects, ...state.deletedProjects]) {
    const chapter = Array.isArray(project?.chapters)
      ? project.chapters.find((item) => item?.id === chapterId)
      : null;
    if (chapter) {
      return { project, chapter };
    }
  }

  return null;
}

export function findChapterContextById(chapterId = state.selectedChapterId) {
  return chapterId ? findChapterContext(chapterId) : null;
}

export function resolveSelectedChapterGlossary(glossaries = state.glossaries) {
  const link = findChapterContextById()?.chapter?.linkedGlossary ?? null;
  if (!link) {
    return null;
  }

  return (
    (Array.isArray(glossaries) ? glossaries : []).find(
      (glossary) => glossary?.id === link.glossaryId || glossary?.repoName === link.repoName,
    )
    ?? {
      id: link.glossaryId,
      glossaryId: link.glossaryId,
      repoName: link.repoName,
      title: "Glossary",
    }
  );
}
