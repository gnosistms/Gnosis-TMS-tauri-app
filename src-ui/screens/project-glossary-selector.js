import {
  renderSelectPillControl,
} from "../lib/ui.js";

export function availableGlossaryOptions(glossaries = []) {
  return (Array.isArray(glossaries) ? glossaries : []).filter(
    (glossary) => glossary?.lifecycleState !== "deleted",
  );
}

export function findGlossaryOptionById(glossaries, glossaryId, { includeDeleted = false } = {}) {
  if (typeof glossaryId !== "string" || !glossaryId.trim()) {
    return null;
  }

  const source = includeDeleted ? (Array.isArray(glossaries) ? glossaries : []) : availableGlossaryOptions(glossaries);
  return source.find((glossary) => glossary?.id === glossaryId) ?? null;
}

export function renderChapterGlossarySelect(chapter, glossaries, options = {}) {
  const linkedGlossary = chapter.linkedGlossary;
  const disabled = options.disabled === true;
  const selectedGlossary = findGlossaryOptionById(glossaries, linkedGlossary?.glossaryId, {
    includeDeleted: disabled,
  });
  const optionList = availableGlossaryOptions(glossaries);
  const selectedGlossaryId =
    typeof linkedGlossary?.glossaryId === "string" && linkedGlossary.glossaryId.trim()
      ? linkedGlossary.glossaryId.trim()
      : "";
  const selectedFallbackLabel =
    typeof linkedGlossary?.title === "string" && linkedGlossary.title.trim()
      ? linkedGlossary.title.trim()
      : typeof linkedGlossary?.name === "string" && linkedGlossary.name.trim()
        ? linkedGlossary.name.trim()
        : typeof linkedGlossary?.repoName === "string" && linkedGlossary.repoName.trim()
          ? linkedGlossary.repoName.trim()
          : "";
  const selectedLabel = selectedGlossary?.title ?? selectedFallbackLabel;
  const selectedIsInOptionList = optionList.some((glossary) => glossary.id === selectedGlossaryId);
  const selectedOnlyOption =
    selectedGlossaryId && !selectedIsInOptionList
      ? [{
          value: selectedGlossaryId,
          label: selectedLabel || "Assigned glossary",
          selected: true,
        }]
      : [];

  return renderSelectPillControl({
    className: "select-pill--toolbar select-pill--chapter-glossary select-pill--truncate-value",
    value: selectedLabel || "no glossary",
    disabled,
    wrapperAttributes: {
      "data-stop-row-action": true,
    },
    selectAttributes: {
      "data-chapter-glossary-select": true,
      "data-chapter-id": chapter.id,
      "aria-label": "Select a glossary",
    },
    options: [
      {
        value: "",
        label: "no glossary",
        selected: !selectedGlossaryId,
      },
      ...selectedOnlyOption,
      ...optionList.map((glossary) => ({
        value: glossary.id,
        label: glossary.title,
        selected: glossary.id === selectedGlossaryId,
      })),
    ],
  });
}

