const EDITOR_TEXT_STYLE_PARAGRAPH = "paragraph";
const EDITOR_TEXT_STYLE_HEADING1 = "heading1";
const EDITOR_TEXT_STYLE_HEADING2 = "heading2";
const EDITOR_TEXT_STYLE_QUOTE = "quote";
const EDITOR_TEXT_STYLE_NUMBERED_LIST = "numbered-list";
const EDITOR_TEXT_STYLE_BULLET_LIST = "bullet-list";

export const EDITOR_TEXT_STYLE_OPTIONS = [
  {
    value: EDITOR_TEXT_STYLE_PARAGRAPH,
    shortLabel: "P",
    tooltip: "Plain text",
  },
  {
    value: EDITOR_TEXT_STYLE_HEADING1,
    shortLabel: "H1",
    tooltip: "Large heading",
  },
  {
    value: EDITOR_TEXT_STYLE_HEADING2,
    shortLabel: "H2",
    tooltip: "Subheading",
  },
  {
    value: EDITOR_TEXT_STYLE_QUOTE,
    shortLabel: "Q",
    tooltip: "Quote",
  },
  {
    value: EDITOR_TEXT_STYLE_NUMBERED_LIST,
    shortLabel: "NL",
    tooltip: "Numbered list",
  },
  {
    value: EDITOR_TEXT_STYLE_BULLET_LIST,
    shortLabel: "BL",
    tooltip: "Bullet list",
  },
];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderLineContent(contentHtml) {
  return contentHtml.length > 0 ? contentHtml : "<br>";
}

function splitContentLines(contentHtml) {
  const normalizedHtml = typeof contentHtml === "string" ? contentHtml : String(contentHtml ?? "");
  return normalizedHtml.split("\n");
}

export function normalizeEditorTextStyle(value) {
  switch (String(value ?? "").trim()) {
    case EDITOR_TEXT_STYLE_HEADING1:
      return EDITOR_TEXT_STYLE_HEADING1;
    case EDITOR_TEXT_STYLE_HEADING2:
      return EDITOR_TEXT_STYLE_HEADING2;
    case EDITOR_TEXT_STYLE_QUOTE:
      return EDITOR_TEXT_STYLE_QUOTE;
    case EDITOR_TEXT_STYLE_NUMBERED_LIST:
      return EDITOR_TEXT_STYLE_NUMBERED_LIST;
    case EDITOR_TEXT_STYLE_BULLET_LIST:
      return EDITOR_TEXT_STYLE_BULLET_LIST;
    default:
      return EDITOR_TEXT_STYLE_PARAGRAPH;
  }
}

export function editorTextStyleModifierClass(textStyle) {
  return `translation-language-panel__field-stack--text-style-${normalizeEditorTextStyle(textStyle)}`;
}

export function editorTextStyleUsesPreviewLayer(textStyle) {
  return normalizeEditorTextStyle(textStyle) !== EDITOR_TEXT_STYLE_PARAGRAPH;
}

export function buildEditorTextStyleMarkup(textStyle, contentHtml) {
  const normalizedTextStyle = normalizeEditorTextStyle(textStyle);
  const lines = splitContentLines(contentHtml);

  if (normalizedTextStyle === EDITOR_TEXT_STYLE_NUMBERED_LIST) {
    return `
      <ol class="translation-text-style-preview translation-text-style-preview--numbered-list">
        ${lines
          .map((line, index) => `
            <li class="translation-text-style-preview__list-item">
              <span class="translation-text-style-preview__list-marker">${index + 1}.</span>
              <span class="translation-text-style-preview__list-content">${renderLineContent(line)}</span>
            </li>
          `)
          .join("")}
      </ol>
    `;
  }

  if (normalizedTextStyle === EDITOR_TEXT_STYLE_BULLET_LIST) {
    return `
      <ul class="translation-text-style-preview translation-text-style-preview--bullet-list">
        ${lines
          .map((line) => `
            <li class="translation-text-style-preview__list-item">
              <span class="translation-text-style-preview__list-marker">&bull;</span>
              <span class="translation-text-style-preview__list-content">${renderLineContent(line)}</span>
            </li>
          `)
          .join("")}
      </ul>
    `;
  }

  return `
    <div class="translation-text-style-preview translation-text-style-preview--${normalizedTextStyle}">
      ${renderLineContent(String(contentHtml ?? ""))}
    </div>
  `;
}

export function buildEditorTextStylePlainTextMarkup(textStyle, plainText) {
  return buildEditorTextStyleMarkup(textStyle, escapeHtml(plainText));
}
