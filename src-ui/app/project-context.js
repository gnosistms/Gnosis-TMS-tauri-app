import { state } from "./state.js";

export function selectedProjectsTeam() {
  return state.teams.find((team) => team.id === state.selectedTeamId) ?? null;
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
