import { findIsoLanguageOption } from "../lib/language-options.js";

export function normalizeLanguageColumnCode(code) {
  return typeof code === "string" ? code.trim().replaceAll("_", "-") : "";
}

export function languageBaseCode(language) {
  const baseCode = normalizeLanguageColumnCode(language?.baseCode);
  return baseCode || normalizeLanguageColumnCode(language?.code);
}

export function languageDisplayName(language) {
  const name = typeof language?.name === "string" ? language.name.trim() : "";
  if (name) {
    return name;
  }

  const baseCode = languageBaseCode(language);
  return findIsoLanguageOption(baseCode)?.name || baseCode || normalizeLanguageColumnCode(language?.code);
}

export function languageSemanticLabel(language) {
  const baseCode = languageBaseCode(language);
  return findIsoLanguageOption(baseCode)?.name || languageDisplayName(language) || baseCode;
}

export function languageBaseCodesMatch(left, right) {
  const leftBase = languageBaseCode(left).toLowerCase();
  const rightBase = languageBaseCode(right).toLowerCase();
  return Boolean(leftBase) && leftBase === rightBase;
}

export function languageMatchesBaseCode(language, baseCode) {
  const normalizedBaseCode = normalizeLanguageColumnCode(baseCode).toLowerCase();
  return Boolean(normalizedBaseCode) && languageBaseCode(language).toLowerCase() === normalizedBaseCode;
}

export function normalizeChapterLanguage(language) {
  const code = normalizeLanguageColumnCode(language?.code);
  if (!code) {
    return null;
  }

  const baseCode = languageBaseCode(language);
  const name = typeof language?.name === "string" && language.name.trim()
    ? language.name.trim()
    : findIsoLanguageOption(baseCode)?.name || code;
  const role = String(language?.role ?? "").trim().toLowerCase() === "source"
    ? "source"
    : "target";

  const normalized = { code, name, role };
  if (baseCode && baseCode !== code) {
    normalized.baseCode = baseCode;
  } else if (typeof language?.baseCode === "string" && language.baseCode.trim()) {
    normalized.baseCode = baseCode || code;
  }
  return normalized;
}

export function normalizeChapterLanguages(languages = []) {
  const seenCodes = new Set();
  return (Array.isArray(languages) ? languages : [])
    .map(normalizeChapterLanguage)
    .filter((language) => {
      if (!language || seenCodes.has(language.code)) {
        return false;
      }
      seenCodes.add(language.code);
      return true;
    });
}

function duplicateColumnCodeForIndex(baseCode, index) {
  return index <= 1 ? baseCode : `${baseCode}-x-${index}`;
}

export function nextDuplicateLanguageCode(languages = [], baseCode) {
  const normalizedBaseCode = normalizeLanguageColumnCode(baseCode);
  if (!normalizedBaseCode) {
    return "";
  }

  const usedCodes = new Set(
    normalizeChapterLanguages(languages)
      .map((language) => language.code)
      .filter(Boolean),
  );
  if (!usedCodes.has(normalizedBaseCode)) {
    return normalizedBaseCode;
  }

  for (let index = 2; index < 1000; index += 1) {
    const candidate = duplicateColumnCodeForIndex(normalizedBaseCode, index);
    if (!usedCodes.has(candidate)) {
      return candidate;
    }
  }

  return `${normalizedBaseCode}-x-${Date.now()}`;
}

export function numberDuplicateLanguageGroups(languages = []) {
  const normalizedLanguages = normalizeChapterLanguages(languages);
  const groupsByBaseCode = new Map();
  for (const language of normalizedLanguages) {
    const baseCode = languageBaseCode(language);
    if (!baseCode) {
      continue;
    }
    const group = groupsByBaseCode.get(baseCode) ?? [];
    group.push(language);
    groupsByBaseCode.set(baseCode, group);
  }

  return normalizedLanguages.map((language) => {
    const baseCode = languageBaseCode(language);
    const group = groupsByBaseCode.get(baseCode) ?? [];
    if (group.length <= 1) {
      return language;
    }

    const groupIndex = group.findIndex((item) => item.code === language.code) + 1;
    const semanticName = findIsoLanguageOption(baseCode)?.name || languageSemanticLabel(language) || baseCode;
    return {
      ...language,
      name: `${semanticName} ${groupIndex}`,
      baseCode,
    };
  });
}

export function appendDuplicateLanguage(languages = [], baseCode, role = "target") {
  const normalizedBaseCode = normalizeLanguageColumnCode(baseCode);
  if (!normalizedBaseCode) {
    return normalizeChapterLanguages(languages);
  }

  const option = findIsoLanguageOption(normalizedBaseCode);
  const normalizedLanguages = normalizeChapterLanguages(languages);
  const hasBaseSibling = normalizedLanguages.some((language) =>
    languageMatchesBaseCode(language, normalizedBaseCode)
  );
  const nextLanguage = {
    code: nextDuplicateLanguageCode(normalizedLanguages, normalizedBaseCode),
    name: option?.name || normalizedBaseCode,
    role: role === "source" ? "source" : "target",
  };
  if (hasBaseSibling) {
    nextLanguage.baseCode = normalizedBaseCode;
  }

  return numberDuplicateLanguageGroups([
    ...normalizedLanguages,
    nextLanguage,
  ]);
}
