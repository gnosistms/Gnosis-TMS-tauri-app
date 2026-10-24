import { sourceFormKey } from "./glossary-research-studio-workflow.js";

// Avoid a flow/editor import cycle while retaining the normal term-save path.
let handler = null;
export function setStudioEditorHandler(callback) { handler = callback; }
export function notifyStudioEditor(event, origin, value) {
  return origin && handler ? handler(event, origin, value) : Promise.resolve();
}

export function researchChangesForDraft(origin, sourceTerms) {
  const language = origin?.scope?.sourceLanguage?.code ?? "und";
  const current = new Set(sourceTerms.map((form) => sourceFormKey(form, language)));
  return (origin?.changes ?? []).map((change) => ({ ...change,
    sourceTerms: change.expected.sourceTerms.filter((form) => change.sourceTerms.includes(form) || !current.has(sourceFormKey(form, language))),
  })).filter((change) => change.sourceTerms.length !== change.expected.sourceTerms.length);
}
