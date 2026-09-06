// The derived-glossary language rule — pure functions over chapter state and
// language objects, with no app-state or screen dependencies so both flows
// and screens can import it. See plans/derived-glossary-language-rule-plan.md.

import { languageBaseCode } from "./editor-language-utils.js";

export function resolveLanguageCode(language) {
  if (typeof language === "string" && language.trim()) {
    return language.trim();
  }

  if (language && typeof language === "object") {
    const code = typeof language.code === "string" ? language.code.trim() : "";
    if (code) {
      return code;
    }
  }

  return "";
}

export function resolveLanguageLabel(language, fallbackCode = "") {
  if (language && typeof language === "object") {
    const name = typeof language.name === "string" ? language.name.trim() : "";
    if (name) {
      return name;
    }
  }

  return fallbackCode || "";
}

// The single resolution of "which language is this chapter's linked
// glossary's source language" — the translate-all pair classifier, the
// batch-flow change gate, and the usage resolver below must all agree on it.
export function glossarySourceLanguageCodeForChapter(chapterState) {
  const glossaryState = chapterState?.glossary ?? null;
  const glossaryModel = glossaryState?.matcherModel ?? null;
  return resolveLanguageCode(glossaryState?.sourceLanguage ?? glossaryModel?.sourceLanguage);
}

// The chapter column a derived glossary pivots through: the chapter language
// whose base code is the linked glossary's source language. `null` when the
// chapter has no such column — the glossary can still be linked, but nothing
// can be derived through it.
export function resolveDerivedGlossaryPivotLanguage(chapterState) {
  const glossarySourceLanguageCode = glossarySourceLanguageCodeForChapter(chapterState);
  if (!glossarySourceLanguageCode) {
    return null;
  }
  const languages = Array.isArray(chapterState?.languages) ? chapterState.languages : [];
  return languages.find((language) => languageBaseCode(language) === glossarySourceLanguageCode) ?? null;
}

// The derived-glossary language rule — the ONE place that decides how a
// linked glossary (source Gs → target Gt) can serve a translate pair S → T.
// Every AI flow (single-row translate, Translate All, Derive Glossaries)
// must classify through this so none of them spends tokens on derivation
// the chapter's language setup cannot support:
//   "direct"  — base(S) is Gs and base(T) is Gt: the glossary applies as-is.
//   "derived" — base(T) is Gt, base(S) is not Gs, AND the chapter has a
//               pivot column (a language whose base code is Gs). Derived
//               entries are aligned through that column's real text; pivot
//               generation only fills gaps in an existing column.
//   "none"    — anything else, including a glossary whose source language is
//               not a chapter column at all.
export function derivedGlossaryUsageKindForPair(chapterState, sourceLanguage, targetLanguage) {
  const glossaryState = chapterState?.glossary ?? null;
  const glossaryModel = glossaryState?.matcherModel ?? null;
  const glossarySourceLanguageCode = glossarySourceLanguageCodeForChapter(chapterState);
  const glossaryTargetLanguageCode = resolveLanguageCode(
    glossaryState?.targetLanguage ?? glossaryModel?.targetLanguage,
  );
  if (
    !glossarySourceLanguageCode
    || !glossaryTargetLanguageCode
    || glossaryTargetLanguageCode !== languageBaseCode(targetLanguage)
  ) {
    return "none";
  }
  if (glossarySourceLanguageCode === languageBaseCode(sourceLanguage)) {
    return "direct";
  }
  return resolveDerivedGlossaryPivotLanguage(chapterState) ? "derived" : "none";
}
