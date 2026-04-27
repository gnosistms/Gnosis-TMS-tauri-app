import { escapeHtml } from "../lib/ui.js";

export function normalizedBatchProgressEntry(languageProgress, languageCode) {
  const progress =
    languageProgress && typeof languageProgress === "object"
      ? languageProgress[languageCode]
      : null;
  const completedCount = Math.max(0, Number.parseInt(String(progress?.completedCount ?? 0), 10) || 0);
  const totalCount = Math.max(0, Number.parseInt(String(progress?.totalCount ?? 0), 10) || 0);
  const percent = totalCount > 0
    ? Math.max(0, Math.min(100, Math.round((completedCount / totalCount) * 100)))
    : 100;
  return {
    completedCount: Math.min(completedCount, totalCount),
    totalCount,
    percent,
  };
}

export function renderBatchLanguageProgressBars({
  languages,
  selectedLanguageCodes,
  languageProgress,
  emptyMessage,
  progressLabel,
  renderLanguageLabel = null,
}) {
  const selected = new Set(Array.isArray(selectedLanguageCodes) ? selectedLanguageCodes : []);
  const selectedLanguages = (Array.isArray(languages) ? languages : []).filter((language) =>
    selected.has(String(language?.code ?? "").trim()),
  );
  if (selectedLanguages.length === 0) {
    return `<p class="modal__supporting">${escapeHtml(emptyMessage)}</p>`;
  }

  return `
    <div class="ai-translate-all-modal__progress-list">
      ${selectedLanguages.map((language) => {
        const code = String(language?.code ?? "").trim();
        const name = String(language?.name ?? "").trim() || code;
        const labelMarkup = typeof renderLanguageLabel === "function"
          ? renderLanguageLabel(language)
          : `<span>${escapeHtml(name)}</span>`;
        const progress = normalizedBatchProgressEntry(languageProgress, code);
        return `
          <div class="ai-translate-all-modal__progress-row">
            <div class="ai-translate-all-modal__progress-label">
              ${labelMarkup}
              <span>${escapeHtml(String(progress.completedCount))} / ${escapeHtml(String(progress.totalCount))}</span>
            </div>
            <div
              class="ai-translate-all-modal__progress-track"
              role="progressbar"
              aria-label="${escapeHtml(`${name} ${progressLabel}`)}"
              aria-valuemin="0"
              aria-valuemax="${escapeHtml(String(progress.totalCount))}"
              aria-valuenow="${escapeHtml(String(progress.completedCount))}"
            >
              <div class="ai-translate-all-modal__progress-fill" style="width: ${escapeHtml(String(progress.percent))}%;"></div>
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

export function renderBatchOverallProgress(modal, itemLabelSingular, itemLabelPlural) {
  const completedCount = Math.max(0, Number.parseInt(String(modal?.completedCount ?? modal?.translatedCount ?? 0), 10) || 0);
  const totalCount = Math.max(0, Number.parseInt(String(modal?.totalCount ?? 0), 10) || 0);
  const itemLabel = totalCount === 1 ? itemLabelSingular : itemLabelPlural;
  return `
    <p class="ai-translate-all-modal__progress-summary">
      ${escapeHtml(String(Math.min(completedCount, totalCount)))} / ${escapeHtml(String(totalCount))} ${escapeHtml(itemLabel)} completed
    </p>
  `;
}
