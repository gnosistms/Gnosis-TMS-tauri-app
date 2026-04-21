import {
  extractInlineMarkupBaseText,
  extractInlineMarkupVisibleText,
  renderSanitizedInlineMarkupHtml,
  renderSanitizedInlineMarkupHtmlWithAllowedTags,
  serializeInlineMarkupRubyNotation,
} from "./editor-inline-markup.js";

const GLOSSARY_RUBY_ALLOWED_TAGS = new Set(["ruby", "rt"]);
const GLOSSARY_WORD_REGEX = /[\p{L}\p{M}\p{N}]+/gu;
const NON_RUBY_INLINE_TAG_REGEX = /<\/?(?:strong|em|u)\s*>/giu;

function decodeGlossaryRubyTextEntities(value) {
  return String(value ?? "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

function normalizeGlossaryRubyMarkupInput(value) {
  return decodeGlossaryRubyTextEntities(String(value ?? ""));
}

function normalizeGlossaryRubyToken(value, languageCode = "") {
  const text = String(value ?? "");
  if (!text) {
    return "";
  }

  try {
    return text.toLocaleLowerCase(languageCode || undefined).normalize("NFKC");
  } catch {
    return text.toLowerCase().normalize("NFKC");
  }
}

function sanitizeGlossaryRubyScalar(value) {
  return renderSanitizedInlineMarkupHtmlWithAllowedTags(
    normalizeGlossaryRubyMarkupInput(value),
    GLOSSARY_RUBY_ALLOWED_TAGS,
  );
}

function rubyComparisonTokensFromSanitizedMarkup(value, languageCode = "") {
  const source = renderSanitizedInlineMarkupHtml(normalizeGlossaryRubyMarkupInput(value));
  const normalizedSource = source.replace(NON_RUBY_INLINE_TAG_REGEX, "");
  const tokens = [];
  let cursor = 0;

  while (cursor < normalizedSource.length) {
    const rubyStart = normalizedSource.indexOf("<ruby>", cursor);
    if (rubyStart < 0) {
      const text = normalizedSource.slice(cursor);
      for (const match of text.matchAll(GLOSSARY_WORD_REGEX)) {
        tokens.push({
          base: normalizeGlossaryRubyToken(match[0], languageCode),
          ruby: "",
        });
      }
      break;
    }

    const plainText = normalizedSource.slice(cursor, rubyStart);
    for (const match of plainText.matchAll(GLOSSARY_WORD_REGEX)) {
      tokens.push({
        base: normalizeGlossaryRubyToken(match[0], languageCode),
        ruby: "",
      });
    }

    const rubyEnd = normalizedSource.indexOf("</ruby>", rubyStart);
    if (rubyEnd < 0) {
      const text = normalizedSource.slice(rubyStart);
      for (const match of text.matchAll(GLOSSARY_WORD_REGEX)) {
        tokens.push({
          base: normalizeGlossaryRubyToken(match[0], languageCode),
          ruby: "",
        });
      }
      break;
    }

    const rubyInner = normalizedSource.slice(rubyStart + "<ruby>".length, rubyEnd);
    const rtStart = rubyInner.indexOf("<rt>");
    const rtEnd = rubyInner.indexOf("</rt>");
    if (rtStart < 0 || rtEnd < rtStart) {
      const baseText = extractInlineMarkupBaseText(rubyInner);
      for (const match of baseText.matchAll(GLOSSARY_WORD_REGEX)) {
        tokens.push({
          base: normalizeGlossaryRubyToken(match[0], languageCode),
          ruby: "",
        });
      }
      cursor = rubyEnd + "</ruby>".length;
      continue;
    }

    const baseMarkup = rubyInner.slice(0, rtStart);
    const rubyMarkup = rubyInner.slice(rtStart + "<rt>".length, rtEnd);
    const baseText = extractInlineMarkupBaseText(baseMarkup);
    const rubyText = extractInlineMarkupVisibleText(rubyMarkup).trim();
    for (const match of baseText.matchAll(GLOSSARY_WORD_REGEX)) {
      tokens.push({
        base: normalizeGlossaryRubyToken(match[0], languageCode),
        ruby: normalizeGlossaryRubyToken(rubyText, languageCode),
      });
    }

    cursor = rubyEnd + "</ruby>".length;
  }

  return tokens;
}

export function sanitizeGlossaryRubyMarkup(value) {
  return sanitizeGlossaryRubyScalar(value);
}

export function sanitizeGlossaryRubyTerms(values) {
  return (Array.isArray(values) ? values : []).map((value) => sanitizeGlossaryRubyScalar(value));
}

export function extractGlossaryRubyBaseText(value) {
  return decodeGlossaryRubyTextEntities(
    extractInlineMarkupBaseText(sanitizeGlossaryRubyScalar(value)),
  );
}

export function extractGlossaryRubyVisibleText(value) {
  return decodeGlossaryRubyTextEntities(
    extractInlineMarkupVisibleText(sanitizeGlossaryRubyScalar(value)),
  );
}

export function renderGlossaryRubyHtml(value) {
  return sanitizeGlossaryRubyScalar(value);
}

export function renderGlossaryRubyTermListHtml(values, separator = ", ") {
  return (Array.isArray(values) ? values : [])
    .filter((value) => String(value ?? "").trim())
    .map((value) => renderGlossaryRubyHtml(value))
    .join(separator);
}

export function serializeGlossaryRubyForAiPrompt(value) {
  return decodeGlossaryRubyTextEntities(
    serializeInlineMarkupRubyNotation(sanitizeGlossaryRubyScalar(value)),
  ).trim();
}

export function glossaryRubyHasAnnotation(value) {
  return sanitizeGlossaryRubyScalar(value).includes("<ruby>");
}

export function targetTextContainsGlossaryVariantExactRuby(
  targetText,
  variant,
  languageCode = "",
) {
  const variantTokens = rubyComparisonTokensFromSanitizedMarkup(
    sanitizeGlossaryRubyScalar(variant),
    languageCode,
  );
  if (variantTokens.length === 0) {
    return false;
  }

  const targetTokens = rubyComparisonTokensFromSanitizedMarkup(String(targetText ?? ""), languageCode);
  for (let startIndex = 0; startIndex <= targetTokens.length - variantTokens.length; startIndex += 1) {
    const isMatch = variantTokens.every((token, tokenIndex) => {
      const candidate = targetTokens[startIndex + tokenIndex];
      return candidate?.base === token.base && candidate?.ruby === token.ruby;
    });
    if (isMatch) {
      return true;
    }
  }

  return false;
}
