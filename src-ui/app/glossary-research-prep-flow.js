// "Research glossary terms" from a row in the chapter editor: choose the
// language of the word, find the matching source-language term with the AI
// when needed, confirm it, then open the Research modal on the glossary page.

import { state } from "./state.js";
import { invoke } from "./runtime.js";
import { openGlossaryEditor } from "./glossary-editor-flow.js";
import { selectedProjectsTeamInstallationId } from "./project-context.js";
import { createGlossaryResearchPrepState } from "./glossary-research-state.js";
import { openGlossaryResearch, researchModelStatus } from "./glossary-research-flow.js";
import { PIVOT_SCHEMA, pivotContent, pivotInstructions } from "./glossary-research-prompts.js";
import { findIsoLanguageOption } from "../lib/language-options.js";

function prep() {
  return state.glossaryResearchPrep;
}

function languageName(code) {
  return findIsoLanguageOption(code)?.name ?? code;
}

function chapterSourceLanguageCode(chapter) {
  return chapter.selectedSourceLanguageCode
    ?? chapter.languages?.find((language) => language.role === "source")?.code
    ?? null;
}

function returnToEditor(render) {
  state.glossaryResearchPrep = createGlossaryResearchPrepState();
  state.screen = "translate";
  render();
}

export async function openResearchPrepFromEditor(render, rowId) {
  const chapter = state.editorChapter ?? {};
  const row = (chapter.rows ?? []).find((candidate) => (candidate.id ?? candidate.rowId) === rowId);
  const sourceCode = chapterSourceLanguageCode(chapter);
  const glossary = chapter.glossary ?? {};
  const base = { ...createGlossaryResearchPrepState(), isOpen: true, chapterId: chapter.chapterId, rowId };
  if (!glossary.glossaryId) {
    state.glossaryResearchPrep = {
      ...base, step: "blocked",
      blockedMessage: "Research needs a glossary linked to this chapter. Link a glossary to the chapter first, then try again.",
    };
    render();
    return;
  }
  const glossarySource = glossary.sourceLanguage?.code ?? null;
  if (glossarySource && sourceCode && glossarySource !== sourceCode) {
    state.glossaryResearchPrep = {
      ...base, step: "blocked",
      blockedMessage: `Research needs a glossary in the same source language as this chapter (${languageName(sourceCode)}). This chapter's glossary is ${languageName(glossarySource)}→${languageName(glossary.targetLanguage?.code ?? "")}.`,
    };
    render();
    return;
  }
  const languages = (chapter.languages ?? []).map((language) => ({
    code: language.code,
    name: language.name ?? languageName(language.code),
    text: String(row?.fields?.[language.code] ?? ""),
  }));
  const projectId = chapter.projectId;
  await openGlossaryEditor(render, glossary.glossaryId, { navigationSource: "editor", preferredGlossary: glossary });
  state.glossaryResearchPrep = {
    ...base, step: "input", glossaryId: glossary.glossaryId, sourceLanguageCode: sourceCode,
    languages, selectedLanguageCode: sourceCode, projectId,
  };
  render();
}

export function closeResearchPrepBlocked(render) {
  state.glossaryResearchPrep = createGlossaryResearchPrepState();
  render();
}

export function cancelResearchPrep(render) {
  returnToEditor(render);
}

export function selectResearchPrepLanguage(render, code) {
  prep().selectedLanguageCode = code;
  prep().error = "";
  render();
}

/** Typing keeps focus: toggle Next in place instead of re-rendering. */
export function updateResearchPrepTerm(_render, value) {
  prep().term = value;
  const next = typeof document !== "undefined" ? document.querySelector("[data-action='research-prep-next']") : null;
  if (next) {
    const empty = !value.trim();
    next.classList.toggle("is-disabled", empty);
    next.toggleAttribute("disabled", empty);
    next.setAttribute("aria-disabled", String(empty));
  }
}

function startResearch(render, term) {
  const current = prep();
  const origin = { projectId: current.projectId, returnToEditor: () => returnToEditor(render) };
  state.glossaryResearchPrep = createGlossaryResearchPrepState();
  openGlossaryResearch(render, { term, origin });
}

export async function researchPrepNext(render) {
  const current = prep();
  const term = current.term.trim();
  if (!term) return;
  if (current.selectedLanguageCode === current.sourceLanguageCode) {
    startResearch(render, term);
    return;
  }
  const status = researchModelStatus();
  if (!status.ok) {
    startResearch(render, ""); // the Research modal shows the unsupported-AI message
    return;
  }
  current.step = "finding";
  current.error = "";
  render();
  try {
    const outcome = await invoke("run_glossary_research_request", {
      request: {
        installationId: selectedProjectsTeamInstallationId(),
        providerId: status.providerId, modelId: status.modelId,
        requestId: `pivot-${Date.now().toString(36)}`,
        instructions: pivotInstructions(),
        content: pivotContent({
          researchTerm: term,
          researchLanguage: languageName(current.selectedLanguageCode),
          sourceLanguage: languageName(current.sourceLanguageCode),
          rowTexts: current.languages.filter((language) => language.text.trim())
            .map((language) => ({ language: language.name, text: language.text })),
        }),
        schemaName: "pivot", schema: PIVOT_SCHEMA, effort: "low", maxOutputTokens: 3000,
        webSearchDomains: null,
      },
    });
    if (prep() !== current) return;
    const answer = outcome.status === "ok" ? JSON.parse(outcome.text) : null;
    if (answer?.found && answer.confidence === "high" && answer.sourceTerm?.trim()) {
      current.identified = { sourceTerm: answer.sourceTerm.trim(), definitions: answer.definitions ?? [] };
      current.step = "confirm";
    } else {
      current.step = "not-found";
      if (!answer) current.error = outcome.message ?? outcome.reason ?? "";
    }
  } catch (error) {
    current.step = "not-found";
    current.error = error.message ?? String(error);
  }
  render();
}

export function editResearchPrepTerm(render) {
  prep().step = "input";
  prep().identified = null;
  render();
}

export function confirmResearchPrepTerm(render) {
  const identified = prep().identified;
  if (identified) startResearch(render, identified.sourceTerm);
}
