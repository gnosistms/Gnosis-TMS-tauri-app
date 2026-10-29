export const EDITOR_ROW_TEXT_STYLE_PARAGRAPH = "paragraph";
export const EDITOR_ROW_TEXT_STYLE_HEADING1 = "heading1";
export const EDITOR_ROW_TEXT_STYLE_HEADING2 = "heading2";
export const EDITOR_ROW_TEXT_STYLE_QUOTE = "quote";
export const EDITOR_ROW_TEXT_STYLE_INDENTED = "indented";
export const EDITOR_ROW_TEXT_STYLE_CENTERED = "centered";
export const EDITOR_ROW_TEXT_STYLE_LIST_BULLET = "list_bullet";
export const EDITOR_ROW_TEXT_STYLE_LIST_NUMBER = "list_number";
export const EDITOR_ROW_TEXT_STYLE_LIST_LETTER = "list_letter";
export const EDITOR_ROW_TEXT_STYLE_LIST_ROMAN = "list_roman";
export const EDITOR_ROW_TEXT_STYLE_CUSTOM_HTML = "custom_html";

export function isCustomHtmlRowTextStyle(value) {
  return normalizeEditorRowTextStyle(value) === EDITOR_ROW_TEXT_STYLE_CUSTOM_HTML;
}

// A list row holds a whole list; the list style (bullets, numbers, …) is part
// of its text style. See plans/list-row-style-plan.md.
export const EDITOR_ROW_LIST_STYLE_OPTIONS = [
  { value: EDITOR_ROW_TEXT_STYLE_LIST_BULLET, label: "Bullets", marker: "•" },
  { value: EDITOR_ROW_TEXT_STYLE_LIST_NUMBER, label: "Numbers", marker: "1." },
  { value: EDITOR_ROW_TEXT_STYLE_LIST_LETTER, label: "Letters", marker: "a." },
  { value: EDITOR_ROW_TEXT_STYLE_LIST_ROMAN, label: "Roman numerals", marker: "I." },
];

export function isListRowTextStyle(value) {
  const normalizedValue = normalizeEditorRowTextStyle(value);
  return EDITOR_ROW_LIST_STYLE_OPTIONS.some((option) => option.value === normalizedValue);
}

// Lucide "list" icon (ISC licence, https://lucide.dev).
const LIST_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/></svg>';

export const EDITOR_ROW_TEXT_STYLE_OPTIONS = [
  {
    value: EDITOR_ROW_TEXT_STYLE_PARAGRAPH,
    label: "P",
    tooltip: "Plain text",
  },
  {
    value: EDITOR_ROW_TEXT_STYLE_HEADING1,
    label: "H1",
    tooltip: "Large heading",
  },
  {
    value: EDITOR_ROW_TEXT_STYLE_HEADING2,
    label: "H2",
    tooltip: "Subheading",
  },
  {
    value: EDITOR_ROW_TEXT_STYLE_QUOTE,
    label: "Q",
    tooltip: "Quote",
  },
  {
    value: EDITOR_ROW_TEXT_STYLE_INDENTED,
    label: "I",
    tooltip: "Indented",
  },
  {
    value: EDITOR_ROW_TEXT_STYLE_CENTERED,
    label: "C",
    tooltip: "Centered",
  },
  {
    value: EDITOR_ROW_TEXT_STYLE_LIST_BULLET,
    label: "List",
    iconSvg: LIST_ICON_SVG,
    tooltip: "List",
  },
  {
    value: EDITOR_ROW_TEXT_STYLE_CUSTOM_HTML,
    label: "<>",
    tooltip: "Custom HTML styling",
  },
];

// The style-button option a row style belongs to: every list style selects the
// List button.
export function editorRowTextStyleOptionValue(value) {
  const normalizedValue = normalizeEditorRowTextStyle(value);
  return isListRowTextStyle(normalizedValue) ? EDITOR_ROW_TEXT_STYLE_LIST_BULLET : normalizedValue;
}

export function editorRowTextStyleLabel(value) {
  const normalizedValue = normalizeEditorRowTextStyle(value);
  const listStyle = EDITOR_ROW_LIST_STYLE_OPTIONS.find((option) => option.value === normalizedValue);
  if (listStyle) {
    return `List (${listStyle.label.toLowerCase()})`;
  }
  return (
    EDITOR_ROW_TEXT_STYLE_OPTIONS.find((option) => option.value === normalizedValue)?.label
    ?? "P"
  );
}

export function normalizeEditorRowTextStyle(value) {
  switch (String(value ?? "").trim()) {
    case "h1":
    case EDITOR_ROW_TEXT_STYLE_HEADING1:
      return EDITOR_ROW_TEXT_STYLE_HEADING1;
    case "h2":
    case EDITOR_ROW_TEXT_STYLE_HEADING2:
      return EDITOR_ROW_TEXT_STYLE_HEADING2;
    case "q":
    case EDITOR_ROW_TEXT_STYLE_QUOTE:
      return EDITOR_ROW_TEXT_STYLE_QUOTE;
    case "i":
    case EDITOR_ROW_TEXT_STYLE_INDENTED:
      return EDITOR_ROW_TEXT_STYLE_INDENTED;
    case "c":
    case "center":
    case EDITOR_ROW_TEXT_STYLE_CENTERED:
      return EDITOR_ROW_TEXT_STYLE_CENTERED;
    case "list":
    case "ul":
    case "list-bullet":
    case EDITOR_ROW_TEXT_STYLE_LIST_BULLET:
      return EDITOR_ROW_TEXT_STYLE_LIST_BULLET;
    case "ol":
    case "list-number":
    case EDITOR_ROW_TEXT_STYLE_LIST_NUMBER:
      return EDITOR_ROW_TEXT_STYLE_LIST_NUMBER;
    case "list-letter":
    case EDITOR_ROW_TEXT_STYLE_LIST_LETTER:
      return EDITOR_ROW_TEXT_STYLE_LIST_LETTER;
    case "list-roman":
    case EDITOR_ROW_TEXT_STYLE_LIST_ROMAN:
      return EDITOR_ROW_TEXT_STYLE_LIST_ROMAN;
    case "html":
    case "custom-html":
    case EDITOR_ROW_TEXT_STYLE_CUSTOM_HTML:
      return EDITOR_ROW_TEXT_STYLE_CUSTOM_HTML;
    default:
      return EDITOR_ROW_TEXT_STYLE_PARAGRAPH;
  }
}
