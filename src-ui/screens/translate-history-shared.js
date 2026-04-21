import { editorRowTextStyleLabel, normalizeEditorRowTextStyle } from "../app/editor-row-text-style.js";
import { renderTranslationMarkerIcon } from "../app/editor-row-render.js";
import { editorFieldImageMetadataText } from "../app/editor-images.js";
import {
  extractInlineMarkupHistoryText,
  renderSanitizedInlineMarkupHistoryHtml,
} from "../app/editor-inline-markup.js";
import { escapeHtml } from "../lib/ui.js";
import {
  diff_match_patch,
  DIFF_DELETE,
  DIFF_INSERT,
} from "../lib/vendor/diff-match-patch.js";

const historyDiffEngine = new diff_match_patch();

export function formatHistoryTimestamp(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function buildHistoryDiffSegments(previousText, currentText) {
  const diffs = historyDiffEngine.diff_main(String(previousText ?? ""), String(currentText ?? ""), false);
  historyDiffEngine.diff_cleanupSemantic(diffs);
  historyDiffEngine.diff_cleanupSemanticLossless(diffs);

  return diffs
    .filter((diff) => Boolean(diff?.[1]))
    .map((diff) => {
      const operation = diff?.[0];
      const text = diff?.[1] ?? "";
      return {
        type:
          operation === DIFF_INSERT
            ? "insert"
            : operation === DIFF_DELETE
              ? "delete"
              : "equal",
        text,
      };
    });
}

function renderHistoryDiffText(previousText, currentText) {
  if (previousText === undefined || previousText === null) {
    return renderSanitizedInlineMarkupHistoryHtml(String(currentText ?? ""));
  }

  return buildHistoryDiffSegments(
    extractInlineMarkupHistoryText(previousText),
    extractInlineMarkupHistoryText(currentText),
  )
    .map((segment) => {
      if (segment.type === "equal") {
        return escapeHtml(segment.text);
      }

      return `<span class="history-diff__${segment.type}">${escapeHtml(segment.text)}</span>`;
    })
    .join("");
}

function historyTextHasVisibleContent(value) {
  return String(value ?? "").trim().length > 0;
}

export function renderHistoryContent(entry, previousEntry) {
  return renderHistoryDiffText(previousEntry?.plainText, entry?.plainText);
}

export function renderHistoryEntryContent(entry, previousEntry, languageCode) {
  const currentImageText = editorFieldImageMetadataText(entry?.image);
  const previousImageText = editorFieldImageMetadataText(previousEntry?.image);
  const hasVisibleImage =
    historyTextHasVisibleContent(currentImageText)
    || historyTextHasVisibleContent(previousImageText);
  const historyBlocks = [
    {
      currentText: entry?.plainText,
      previousText: previousEntry?.plainText,
      className: "history-item__content",
      alwaysRender: true,
    },
    {
      currentText: entry?.footnote,
      previousText: previousEntry?.footnote,
      className: "history-item__content history-item__content--footnote",
      alwaysRender: false,
    },
    {
      currentText: currentImageText,
      previousText: previousImageText,
      className: "history-item__content history-item__content--image",
      alwaysRender: false,
      render(prefixLabel, diffText, className, currentLanguageCode) {
        return `<p class="${className}" lang="${escapeHtml(currentLanguageCode ?? "")}"><span class="history-item__image-label">${escapeHtml(prefixLabel)}</span><span class="history-item__image-value">${diffText}</span></p>`;
      },
      prefixLabel: "Image:",
    },
    {
      currentText: entry?.imageCaption,
      previousText: previousEntry?.imageCaption,
      className: "history-item__content history-item__content--footnote",
      alwaysRender: false,
      requiresVisibleImage: true,
    },
  ];

  return `
    <div class="history-item__content-stack">
      ${historyBlocks
        .filter((block) =>
          (
            block.alwaysRender
            || historyTextHasVisibleContent(block.currentText)
            || historyTextHasVisibleContent(block.previousText)
          )
          && (block.requiresVisibleImage !== true || hasVisibleImage)
        )
        .map((block) => {
          const diffText = renderHistoryDiffText(block.previousText, block.currentText);
          if (typeof block.render === "function") {
            return block.render(block.prefixLabel ?? "", diffText, block.className, languageCode);
          }

          return `<p class="${block.className}" lang="${escapeHtml(languageCode ?? "")}">${diffText}</p>`;
        })
        .join("")}
    </div>
  `;
}

function buildHistoryMarkerNoteActions(entry, previousEntry) {
  if (!entry || !previousEntry) {
    return [];
  }

  const actions = [];
  if ((previousEntry.reviewed === true) !== (entry.reviewed === true)) {
    actions.push({
      kind: "reviewed",
      enabled: entry.reviewed === true,
    });
  }
  if ((previousEntry.pleaseCheck === true) !== (entry.pleaseCheck === true)) {
    actions.push({
      kind: "please-check",
      enabled: entry.pleaseCheck === true,
    });
  }

  return actions;
}

function renderHistoryMarkerNoteAction(action) {
  const title =
    action.kind === "reviewed"
      ? action.enabled
        ? "Marked reviewed"
        : "Removed reviewed"
      : action.enabled
        ? 'Marked "Please check"'
        : 'Removed "Please check"';
  const icon = `
    <span
      class="history-item__marker-note-icon history-item__marker-note-icon--${action.kind}${action.enabled ? "" : " history-item__marker-note-icon--removed"}"
      aria-hidden="true"
    >
      ${renderTranslationMarkerIcon(action.kind)}
    </span>
  `;

  return `<span class="history-item__marker-note" title="${escapeHtml(title)}">${icon}</span>`;
}

function buildHistoryMarkerNoteActionsFromStatusNote(statusNote) {
  switch (String(statusNote ?? "").trim()) {
    case "Marked reviewed":
      return [{ kind: "reviewed", enabled: true }];
    case "Marked unreviewed":
    case "Removed reviewed":
      return [{ kind: "reviewed", enabled: false }];
    case 'Marked "Please check"':
      return [{ kind: "please-check", enabled: true }];
    case 'Removed "Please check"':
      return [{ kind: "please-check", enabled: false }];
    default:
      return [];
  }
}

function buildHistoryStyleChange(entry, previousEntry) {
  if (!entry || !previousEntry) {
    return null;
  }

  const previousTextStyle = normalizeEditorRowTextStyle(previousEntry?.textStyle);
  const nextTextStyle = normalizeEditorRowTextStyle(entry?.textStyle);
  if (previousTextStyle === nextTextStyle) {
    return null;
  }

  return {
    previousLabel: editorRowTextStyleLabel(previousTextStyle),
    nextLabel: editorRowTextStyleLabel(nextTextStyle),
  };
}

function renderHistoryStyleNote(styleChange) {
  if (!styleChange) {
    return "";
  }

  return `
    <span class="history-item__style-note">
      <span class="history-item__style-note-label">Style change</span>
      <span class="history-diff__delete">${escapeHtml(styleChange.previousLabel)}</span>
      <span class="history-item__style-note-separator" aria-hidden="true">→</span>
      <span class="history-diff__insert">${escapeHtml(styleChange.nextLabel)}</span>
    </span>
  `;
}

export function renderHistoryNote(entry, previousEntry, options = {}) {
  const includeMarkers = options.includeMarkers !== false;
  const includeStyle = options.includeStyle !== false;
  const markerActions = includeMarkers
    ? (
      Array.isArray(entry?.markerNoteActions) && entry.markerNoteActions.length > 0
        ? entry.markerNoteActions
        : buildHistoryMarkerNoteActions(entry, previousEntry)
    )
    : [];
  const styleChange = includeStyle ? buildHistoryStyleChange(entry, previousEntry) : null;

  if (markerActions.length > 0 || styleChange) {
    return `
      <p class="history-item__note history-item__note--markers">
        ${markerActions.map((action) => renderHistoryMarkerNoteAction(action)).join("")}
        ${renderHistoryStyleNote(styleChange)}
      </p>
    `;
  }

  const fallbackMarkerActions = includeMarkers
    ? buildHistoryMarkerNoteActionsFromStatusNote(entry?.statusNote)
    : [];
  if (fallbackMarkerActions.length > 0) {
    return `
      <p class="history-item__note history-item__note--markers">
        ${fallbackMarkerActions.map((action) => renderHistoryMarkerNoteAction(action)).join("")}
      </p>
    `;
  }

  const statusNote = entry?.statusNote
    ? `<p class="history-item__note">${escapeHtml(entry.statusNote)}</p>`
    : "";
  return statusNote;
}
