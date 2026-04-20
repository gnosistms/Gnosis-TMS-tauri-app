export const EDITOR_ROW_TEXT_STYLE_PARAGRAPH = "paragraph";
export const EDITOR_ROW_TEXT_STYLE_HEADING1 = "heading1";
export const EDITOR_ROW_TEXT_STYLE_HEADING2 = "heading2";
export const EDITOR_ROW_TEXT_STYLE_QUOTE = "quote";
export const EDITOR_ROW_TEXT_STYLE_INDENTED = "indented";
export const EDITOR_ROW_TEXT_STYLE_CENTERED = "centered";

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
    tooltip: "Indented text",
  },
  {
    value: EDITOR_ROW_TEXT_STYLE_CENTERED,
    label: "C",
    tooltip: "Centered text",
  },
];

export function editorRowTextStyleLabel(value) {
  const normalizedValue = normalizeEditorRowTextStyle(value);
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
    default:
      return EDITOR_ROW_TEXT_STYLE_PARAGRAPH;
  }
}
