import { renderSelectPillControl } from "../lib/ui.js";
import {
  CHAPTER_WORKFLOW_STATUS_OPTIONS,
  chapterWorkflowStatusLabel,
  normalizeChapterWorkflowStatus,
} from "../app/chapter-workflow-status.js";

export function renderChapterStatusBadge(chapter, options = {}) {
  const disabled = options.disabled === true;
  const selectedStatus = normalizeChapterWorkflowStatus(chapter?.workflowStatus);
  const label = chapterWorkflowStatusLabel(selectedStatus);

  return renderSelectPillControl({
    className: `select-pill--toolbar chapter-status-badge chapter-status-badge--${selectedStatus}`,
    value: label,
    tooltip: disabled ? "" : "Click to update the status of this file in your translation workflow.",
    disabled,
    wrapperAttributes: {
      "data-stop-row-action": true,
    },
    selectAttributes: {
      "data-chapter-status-select": true,
      "data-chapter-id": chapter.id,
      "aria-label": "Select chapter status",
    },
    options: CHAPTER_WORKFLOW_STATUS_OPTIONS.map((status) => ({
      value: status.id,
      label: status.label,
      selected: status.id === selectedStatus,
    })),
  });
}
