import { reconcileBookLayout } from "./project-book-model.js";

const ITEM_FIELDS = ["id", "kind", "chapterId", "title", "subtitle", "author", "translator", "text", "caption"];
const OPTION_FIELDS = ["pdfPaperSize"];
const pick = (value, keys) => Object.fromEntries(keys.filter((key) => value?.[key] !== undefined).map((key) => [key, value[key]]));

function portableImage(image) {
  const result = pick(image, ["assetId", "fileName", "vellumAssetId"]);
  // Older local records kept only the prepared PNG's machine path.
  const prepared = image.vellumFilePath?.split(/[/\\]/).at(-1);
  if (!result.vellumAssetId && /^[a-f0-9]{64}\.png$/.test(prepared || "")) result.vellumAssetId = prepared;
  return result;
}

export function portableBookOptions(options = {}) {
  return pick(options, OPTION_FIELDS);
}

export function portableBookSettings(record = {}) {
  return { version: 1, layouts: Object.fromEntries(Object.entries(record.layouts || {}).map(([code, layout]) => [code, {
    options: portableBookOptions(layout.options || record.options),
    items: (layout.items || []).map((item) => ({
      ...pick(item, ITEM_FIELDS), excluded: item.excluded === true,
      ...(item.kind === "chapter" ? { numbered: item.numbered !== false } : {}),
      ...(item.kind === "contents" ? { includeH1Headings: item.includeH1Headings === true } : {}),
      ...(item.image?.assetId ? { image: portableImage(item.image) } : {}),
    })),
  }])) };
}

// Object key order is immaterial; book item order remains significant.
export function bookSettingsEqual(left, right) {
  const stable = (value) => Array.isArray(value) ? value.map(stable) : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value;
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

// Compare the effective page-1 configuration, not optional serialization details.
export function comparableBookLayout(document, chapters, code, defaults = {}) {
  const layout = document.layouts?.[code];
  const result = portableBookSettings({ layouts: { [code]: {
    items: reconcileBookLayout(chapters, code, layout || {}).items,
    options: { ...defaults, ...portableBookOptions(document.options), ...portableBookOptions(layout?.options) },
  } } }).layouts[code];
  for (const item of result.items) {
    for (const field of ITEM_FIELDS) if (item[field] === "" && !["id", "kind", "chapterId"].includes(field)) delete item[field];
    if (item.kind === "chapter" && !item.title?.trim()) delete item.title;
    if (item.image) delete item.image.fileName;
  }
  return result;
}

export function mergeRemoteBookSettings(local, remote, languageCode, preserveActive = false) {
  const layouts = Object.fromEntries(Object.entries(remote.layouts || {}).map(([code, layout]) => [code, {
    ...layout, selectedItemId: local.layouts?.[code]?.selectedItemId,
    options: { ...portableBookOptions(local.layouts?.[code]?.options), ...portableBookOptions(layout.options) },
  }]));
  if (preserveActive && local.layouts?.[languageCode]) layouts[languageCode] = local.layouts[languageCode];
  return { ...local, version: 1, layouts,
    options: { ...local.options, ...layouts[languageCode]?.options },
  };
}
