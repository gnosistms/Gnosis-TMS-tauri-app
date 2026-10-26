// "Make a glossary entry" from text highlighted in the chapter editor. Text
// highlighted in the glossary's source language becomes the source term;
// text in its target language becomes the translation, and the AI finds the
// source text it translates; text in any other language is matched to its
// source term the same way. The person then saves the pair through the usual
// New Term window, or researches the source term in the Research Studio.

import { state } from "./state.js";
import { invoke } from "./runtime.js";
import { openGlossaryEditor } from "./glossary-editor-flow.js";
import { openGlossaryTermEditor } from "./glossary-term-draft.js";
import { openStudioForTerm } from "./glossary-research-studio-flow.js";
import { resolveSelectedChapterGlossary, selectedProjectsTeamInstallationId } from "./project-context.js";
import { createEditorGlossaryEntryState } from "./glossary-research-state.js";
import { researchModelStatus } from "./glossary-research-flow.js";
import {
  SELECTION_SOURCE_SCHEMA,
  selectionSourceContent,
  selectionSourceInstructions,
} from "./glossary-research-prompts.js";
import { editorGlossaryEntryLanguages, glossaryEntryLanguageRole } from "./editor-glossary-entry-selection.js";
import { extractInlineMarkupBaseText } from "./editor-inline-markup.js";
import { collapseEditorMainField } from "./translate-flow.js";
import { findIsoLanguageOption } from "../lib/language-options.js";

function entry() {
  return state.editorGlossaryEntry;
}

function languageName(code) {
  return findIsoLanguageOption(code)?.name ?? code;
}

function namedLanguage(language, fallbackCode = "") {
  const code = language?.code ?? fallbackCode;
  return code ? { code, name: language?.name || languageName(code) } : null;
}

/** All the text a row holds in one language, without inline markup. */
function rowLanguageText(row, code) {
  return [row?.fields?.[code], row?.footnotes?.[code], row?.imageCaptions?.[code]]
    .map((value) => extractInlineMarkupBaseText(String(value ?? "")).trim())
    .filter(Boolean)
    .join("\n\n");
}

// Lower case, one space for any run of spacing. Each folded character
// remembers its offset in the original, so a match maps back to the text.
function foldText(text) {
  const source = String(text ?? "").normalize("NFC");
  let folded = "";
  const offsets = [];
  let afterSpace = false;
  let offset = 0;
  for (const character of source) {
    if (/\s/u.test(character)) {
      if (!afterSpace) {
        folded += " ";
        offsets.push(offset);
      }
      afterSpace = true;
    } else {
      afterSpace = false;
      const lower = character.toLowerCase();
      folded += lower;
      for (let unit = 0; unit < lower.length; unit += 1) offsets.push(offset);
    }
    offset += character.length;
  }
  return { source, folded, offsets };
}

/**
 * The AI's answer as the row's source text writes it, or "" when that text is
 * not in the row (a wrong or invented answer is not offered as the source).
 * Case and spacing are ignored in the search.
 */
export function sourceTextOccurrence(candidate, text) {
  const wanted = foldText(candidate).folded.trim();
  if (!wanted) return "";
  const { source, folded, offsets } = foldText(text);
  // Prefer a whole-word occurrence ("alma", not the start of "almacén"), which
  // decides the capitalization returned.
  const wordCharacter = /[\p{L}\p{N}\p{M}]/u;
  let at = -1;
  for (let index = folded.indexOf(wanted); index >= 0; index = folded.indexOf(wanted, index + 1)) {
    if (at < 0) at = index;
    const before = folded[index - 1] ?? "";
    const after = folded[index + wanted.length] ?? "";
    if (!wordCharacter.test(before) && !wordCharacter.test(after)) {
      at = index;
      break;
    }
  }
  if (at < 0) return "";
  const start = offsets[at];
  const last = offsets[at + wanted.length - 1];
  const lastLength = String.fromCodePoint(source.codePointAt(last)).length;
  return source.slice(start, last + lastLength).trim();
}

function blocked(base, message) {
  state.editorGlossaryEntry = { ...base, step: "blocked", blockedMessage: message };
}

/**
 * Opens the window for text highlighted in the editor.
 * selection: { rowId, languageCode, text } (see editor-glossary-entry-selection.js).
 */
export async function openEditorGlossaryEntry(render, selection) {
  const text = String(selection?.text ?? "").trim();
  if (!text) return;
  const chapter = state.editorChapter ?? {};
  const languages = Array.isArray(chapter.languages) ? chapter.languages : [];
  const row = (chapter.rows ?? []).find((candidate) => (candidate.id ?? candidate.rowId) === selection.rowId);
  const glossary = resolveSelectedChapterGlossary();
  const base = {
    ...createEditorGlossaryEntryState(),
    isOpen: true,
    chapterId: chapter.chapterId ?? null,
    rowId: selection.rowId,
    projectId: chapter.projectId ?? null,
    glossary,
    selectedText: text,
  };
  if (!glossary?.repoName) {
    blocked(base, "Glossary entries need a glossary linked to this chapter. Link a glossary to the chapter first, then try again.");
    render();
    return;
  }

  const codes = editorGlossaryEntryLanguages(chapter, glossary, languages.find((language) => language.role === "source")?.code ?? "");
  const loaded = chapter.glossary ?? {};
  const sourceLanguage = namedLanguage(loaded.sourceLanguage ?? glossary.sourceLanguage, codes.sourceCode);
  const targetLanguage = namedLanguage(loaded.targetLanguage ?? glossary.targetLanguage, codes.targetCode);
  const chapterSource = languages.find((language) => glossaryEntryLanguageRole(language, codes) === "source");
  if (!chapterSource) {
    blocked(base, `Glossary entries need a glossary whose source language is one of this chapter's languages. This chapter's glossary is ${sourceLanguage?.name ?? "?"}→${targetLanguage?.name ?? "?"}.`);
    render();
    return;
  }

  const highlighted = languages.find((language) => language.code === selection.languageCode);
  const role = glossaryEntryLanguageRole(highlighted ?? { code: selection.languageCode }, codes) ?? "other";
  const current = {
    ...base,
    step: "entry",
    selectionRole: role,
    selectionLanguage: namedLanguage(highlighted, selection.languageCode),
    sourceLanguage,
    targetLanguage,
    sourceTerm: role === "source" ? text : "",
    targetTerm: role === "target" ? text : "",
  };
  state.editorGlossaryEntry = current;
  if (role === "source") {
    render();
    return;
  }
  await findSourceText(render, current, {
    sourceText: rowLanguageText(row, chapterSource.code),
    rowTexts: languages
      .map((language) => ({
        language: language.name || languageName(language.code),
        text: rowLanguageText(row, language.code),
        isSource: language.code === chapterSource.code,
      }))
      .filter((rowText) => rowText.text),
  });
}

// error: why the AI could not be asked or gave no usable answer ("" when it
// answered that nothing corresponds).
function noMatch(current, notice, error = "") {
  const sourceName = current.sourceLanguage?.name ?? "source";
  if (current.selectionRole === "target") {
    // The translator knows both texts; let them type the source.
    current.step = "entry";
    current.notice = notice || (error
      ? `Something went wrong while finding the ${sourceName} text. You can type it in above.`
      : `We could not find the ${sourceName} text that corresponds to “${current.selectedText}”. You can type it in above.`);
  } else {
    current.step = "not-found";
    current.notice = notice || (error
      ? `Something went wrong while finding the ${sourceName} term that corresponds to “${current.selectedText}”.`
      : `We could not find the ${sourceName} term that corresponds to “${current.selectedText}”.`);
  }
  current.error = error;
}

async function findSourceText(render, current, { sourceText, rowTexts }) {
  const sourceName = current.sourceLanguage?.name ?? "source";
  const status = researchModelStatus();
  if (!status.ok) {
    noMatch(current, current.selectionRole === "target"
      ? `To find the ${sourceName} text automatically, choose a Research model in AI Settings. You can also type it in above.`
      : `Finding the ${sourceName} term needs a Research model. Choose one in AI Settings, then try again.`);
    render();
    return;
  }
  current.step = "finding";
  current.requestId = `selection-source-${Date.now().toString(36)}`;
  render();
  try {
    const outcome = await invoke("run_glossary_research_request", {
      request: {
        installationId: selectedProjectsTeamInstallationId(),
        providerId: status.providerId,
        modelId: status.modelId,
        requestId: current.requestId,
        instructions: selectionSourceInstructions({ sourceLanguage: sourceName }),
        content: selectionSourceContent({
          selectedText: current.selectedText,
          selectionLanguage: current.selectionLanguage?.name ?? "",
          sourceLanguage: sourceName,
          rowTexts,
        }),
        schemaName: "selection_source",
        schema: SELECTION_SOURCE_SCHEMA,
        effort: "low",
        maxOutputTokens: 3000,
        webSearchDomains: null,
      },
    });
    if (entry() !== current) return;
    const answer = outcome?.status === "ok" ? JSON.parse(outcome.text) : null;
    const found = answer?.found === true && answer.confidence === "high"
      ? sourceTextOccurrence(answer.sourceText, sourceText)
      : "";
    if (found) {
      current.sourceTerm = found;
      current.step = "entry";
    } else {
      noMatch(current, "", answer ? "" : outcome?.message || outcome?.reason || "The AI gave no answer.");
    }
  } catch (error) {
    if (entry() !== current) return;
    noMatch(current, "", error?.message ?? String(error));
  }
  render();
}

export function closeEditorGlossaryEntry(render) {
  const current = entry();
  // Closing while the AI is still searching: stop the request too.
  if (current?.step === "finding" && current.requestId && invoke) {
    void invoke("cancel_glossary_research_request", { requestId: current.requestId }).catch(() => {});
  }
  state.editorGlossaryEntry = createEditorGlossaryEntryState();
  render();
}

/** Typing keeps focus: update each action's required fields in place. */
export function updateEditorGlossaryEntryField(field, value) {
  const current = entry();
  if (!current?.isOpen || !["sourceTerm", "targetTerm"].includes(field)) return;
  current[field] = String(value ?? "");
  if (typeof document === "undefined") return;
  const buttons = document.querySelectorAll(
    '[data-action="save-editor-glossary-entry"], [data-action="research-editor-glossary-entry"]',
  );
  for (const button of buttons) {
    const empty = !current.sourceTerm.trim()
      || (button.getAttribute("data-action") === "save-editor-glossary-entry" && !current.targetTerm.trim());
    button.classList.toggle("is-disabled", empty);
    button.toggleAttribute("disabled", empty);
    const hint = button.closest("[data-editor-glossary-entry-save-hint]");
    if (hint) {
      if (current.targetTerm.trim()) hint.removeAttribute("data-tooltip");
      else hint.setAttribute("data-tooltip", hint.dataset.editorGlossaryEntrySaveHint);
    }
    if (empty) {
      button.setAttribute("aria-disabled", "true");
      button.setAttribute("data-offline-blocked", "true");
    } else {
      button.removeAttribute("aria-disabled");
      button.removeAttribute("data-offline-blocked");
    }
  }
}

/** Leave the editor for the chapter's glossary; true once it is ready. */
async function openChapterGlossary(render, current) {
  state.editorGlossaryEntry = createEditorGlossaryEntryState();
  // An editing field left open comes back from the glossary without its
  // glossary underlines; close it as the double-click "edit term" route does.
  const field = state.editorChapter?.mainFieldEditor;
  if (field?.rowId && field?.languageCode) collapseEditorMainField(render, field.rowId, field.languageCode);
  const glossaryId = current.glossary.id ?? current.glossary.glossaryId;
  await openGlossaryEditor(render, glossaryId, { navigationSource: "editor", preferredGlossary: current.glossary });
  return state.screen === "glossaryEditor"
    && state.glossaryEditor?.glossaryId === glossaryId
    && state.glossaryEditor?.status === "ready";
}

function readyEntry() {
  const current = entry();
  return current?.isOpen && current.step === "entry" && current.sourceTerm.trim() ? current : null;
}

export async function saveEditorGlossaryEntry(render) {
  const current = readyEntry();
  if (!current?.targetTerm.trim()) return;
  const prefill = { sourceTerms: [current.sourceTerm.trim()], targetTerms: [current.targetTerm.trim()] };
  if (await openChapterGlossary(render, current)) await openGlossaryTermEditor(render, null, { prefill });
}

export async function researchEditorGlossaryEntry(render) {
  const current = readyEntry();
  if (!current) return;
  const term = current.sourceTerm.trim();
  if (await openChapterGlossary(render, current)) await openStudioForTerm(render, term, { projectId: current.projectId });
}
