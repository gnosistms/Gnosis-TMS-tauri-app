import { state } from "./state.js";

export function chapterGlossaryLinkFromGlossaryId(glossaryId) {
  if (typeof glossaryId !== "string" || !glossaryId.trim()) {
    return null;
  }

  const glossary = state.glossaries.find(
    (item) => item?.id === glossaryId && item.lifecycleState !== "deleted",
  );
  if (!glossary) {
    return null;
  }

  return {
    glossaryId: glossary.id,
    repoName: glossary.repoName,
  };
}

export function chapterGlossaryLinkInput(link) {
  if (!link) {
    return null;
  }

  return {
    glossaryId: link.glossaryId,
    repoName: link.repoName,
  };
}

