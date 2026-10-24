// Languages written without spaces between words. Terms in these languages
// are matched anywhere inside the text, not as whole space-separated words.

export const NON_SPACE_DELIMITED_LANGUAGE_CODES = new Set([
  "zh",
  "ja",
  "th",
  "lo",
  "km",
  "my",
  "bo",
  "dz",
]);

export function primaryLanguageSubtag(languageCode) {
  const [primarySubtag = ""] = String(languageCode ?? "")
    .trim()
    .toLowerCase()
    .split(/[-_]/u);
  return primarySubtag;
}

export function isNonSpaceDelimitedLanguage(languageCode) {
  return NON_SPACE_DELIMITED_LANGUAGE_CODES.has(primaryLanguageSubtag(languageCode));
}
