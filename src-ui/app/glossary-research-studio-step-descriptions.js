import { studioStepNumber } from "./glossary-research-studio-workflow.js";

// One plain-text sentence under each step title saying what the step does.
// The screen escapes it.
export function studioStepDescription(study, stepId) {
  const term = study.scope.term?.trim() || "the term";
  const corpus = study.scope.corpus === "samael" ? "the complete works of Samael Aun Weor" : "the selected projects";
  // The step 3 sample, without paragraphs the missing-meaning search added later.
  // Until a step loads it, a saved study holds the paragraphs as a compact reference.
  const sample = Array.isArray(study.passages) ? study.passages.filter((p) => !p.recovered).length : 0;
  const sampled = sample ? `${sample} ${sample === 1 ? "paragraph" : "paragraphs"}` : "paragraphs";
  return ({
    "1": "Choose the term to research, any forms you already know, and the corpus to research it in.",
    "2a": `Find other forms and spellings of ${term} in ${corpus}, and count the paragraphs that use each.`,
    "2b": `Check the glossary for entries that already cover ${term} or its forms, and decide how to handle them.`,
    "3": `Choose a sample of paragraphs from ${corpus} that use ${term}, as evidence for the following steps.`,
    "4.1": `Look up ${term} in dictionaries and list its senses.`,
    "4.2": `Read the sample paragraphs to find the meanings of ${term} in ${corpus}.`,
    "4.3": `Check whether the parts of ${term}, such as its root words or affixes, explain a meaning not yet found.`,
    "4.4.1": `Find earlier authors from whom ${term} may have been borrowed, and the meanings they gave it.`,
    "4.4.2": `Search primary sources on the internet for further meanings or the origin of ${term}.`,
    "4.4.4": "Combine the bibliographical and internet findings into one summary.",
    "4.5": `Combine all findings into one list of meanings of ${term}, and choose the definitions to use.`,
    "4.6": `In a sample of ${sampled} from ${corpus}, identify which meaning of ${term} is used.`,
    "4.7": `Find fixed expressions with ${term} that always carry one meaning and could become separate glossary entries.`,
    "5": `Find recurring compounds and phrases with ${term} that should inform its translations.`,
    "6": `Suggest ${study.scope.targetLanguage?.name ?? "target-language"} translations for each meaning of ${term}, and choose which to use.`,
    "7": "Check the spelling of translations that may be uncertain, such as borrowed names.",
    "8": "Translate each meaning's sample paragraphs with its translations, and revise translations that fail.",
    "9": "Translate the sample paragraphs with the complete entry, as translators will see it, to check that it leads to the right translation.",
    "10a": "Count how often each translation was used, and choose which to keep.",
    "10b": `Decide what to do where a form of ${term} is already a source form of another glossary entry.`,
    "11": "Open the finished entry in the term editor to review and save it.",
    "12": `Research the expressions split off in step ${studioStepNumber("4.7")} as their own entries.`,
  })[stepId] ?? "";
}
