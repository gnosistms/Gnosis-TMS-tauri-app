export const CHAPTER_WORKFLOW_STATUS_OPTIONS = [
  { id: "none", label: "none" },
  { id: "queued", label: "queued" },
  { id: "translating", label: "translating" },
  { id: "review1", label: "review 1" },
  { id: "review2", label: "review 2" },
  { id: "review3", label: "review 3" },
  { id: "publish", label: "publish" },
  { id: "done", label: "done" },
];

const CHAPTER_WORKFLOW_STATUS_IDS = new Set(
  CHAPTER_WORKFLOW_STATUS_OPTIONS.map((status) => status.id),
);

const CHAPTER_WORKFLOW_STATUS_ALIASES = new Map([
  ["", "none"],
  ["review 1", "review1"],
  ["review-1", "review1"],
  ["review_1", "review1"],
  ["review 2", "review2"],
  ["review-2", "review2"],
  ["review_2", "review2"],
  ["review 3", "review3"],
  ["review-3", "review3"],
  ["review_3", "review3"],
]);

export function normalizeChapterWorkflowStatus(value) {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  const normalized = CHAPTER_WORKFLOW_STATUS_ALIASES.get(raw) ?? raw;
  return CHAPTER_WORKFLOW_STATUS_IDS.has(normalized) ? normalized : "none";
}

export function chapterWorkflowStatusLabel(value) {
  const normalized = normalizeChapterWorkflowStatus(value);
  return CHAPTER_WORKFLOW_STATUS_OPTIONS.find((status) => status.id === normalized)?.label ?? "none";
}
