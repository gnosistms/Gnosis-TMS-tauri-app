// Batched derived (pivot) glossary preparation, shared by AI Translate All and
// the Derive Glossaries modal. Given work items for ONE language pair, ensures
// each row has a fresh derived-glossary entry in chapter state (and the
// persistent per-row cache): fresh cached entries are reused, the rest get a
// combined derivation call per chunk, and the returned entries are
// redistributed per row by containment — mirroring the single-row derivation's
// own source-text containment filter.

import {
  AI_BATCH_MAX_ROWS,
  AI_BATCH_TOKEN_TARGET,
  estimateSourceTokens,
} from "./editor-ai-batch-request.js";
import {
  buildDerivedGlossaryState,
  readRowFieldText,
  resolveEditorDerivedGlossaryUsage,
} from "./editor-derived-glossary-flow.js";
import { applyEditorDerivedGlossaryEntry } from "./editor-derived-glossary-state.js";
import { saveStoredEditorDerivedGlossaryEntryForChapter } from "./editor-derived-glossary-cache.js";
import { findEditorRowById } from "./editor-utils.js";
import { languageBaseCode, languageSemanticLabel } from "./editor-language-utils.js";
import { selectedProjectsTeam, selectedProjectsTeamInstallationId } from "./project-context.js";
import { invoke } from "./runtime.js";
import { state } from "./state.js";

function createBatchDerivedRequestKey(chapterId) {
  const uniqueSuffix =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${chapterId}:batch-derived:${uniqueSuffix}`;
}

function languageByCode(chapterState, languageCode) {
  const code = String(languageCode ?? "").trim();
  if (!code) {
    return null;
  }
  const languages = Array.isArray(chapterState?.languages) ? chapterState.languages : [];
  return (
    languages.find((candidate) => candidate?.code === code)
    ?? languages.find((candidate) => languageBaseCode(candidate) === code)
    ?? null
  );
}

// Minimal per-item context carrying exactly what usage resolution and entry
// construction consume. Target lookup falls back to base-code matching because
// the Derive Glossaries modal addresses the glossary target by base code.
function buildDerivedGlossaryItemContext(chapterState, item) {
  const row = findEditorRowById(item.rowId, chapterState);
  if (!row) {
    return null;
  }
  const sourceLanguage = languageByCode(chapterState, item.sourceLanguageCode);
  const targetLanguage = languageByCode(chapterState, item.targetLanguageCode);
  if (!sourceLanguage || !targetLanguage) {
    return null;
  }
  return {
    chapterState,
    projectId: chapterState.projectId,
    row,
    chapterId: chapterState.chapterId,
    rowId: item.rowId,
    sourceLanguageCode: item.sourceLanguageCode,
    targetLanguageCode: item.targetLanguageCode,
    sourceLanguage,
    targetLanguage,
    sourceLanguageLabel: languageSemanticLabel(sourceLanguage) || item.sourceLanguageCode,
    targetLanguageLabel: languageSemanticLabel(targetLanguage) || item.targetLanguageCode,
    sourceText: readRowFieldText(row, item.sourceLanguageCode),
  };
}

// Splits pending derivations into chunks bounded by row count and a token
// budget. Both the row source text and its pivot text enter the alignment
// prompts, so both count against the budget.
function chunkPendingDerivations(pending, options = {}) {
  const maxRows = Number.isFinite(options.maxRows) && options.maxRows > 0
    ? options.maxRows
    : AI_BATCH_MAX_ROWS;
  const tokenTarget = Number.isFinite(options.tokenTarget) && options.tokenTarget > 0
    ? options.tokenTarget
    : AI_BATCH_TOKEN_TARGET;

  const chunks = [];
  let current = [];
  let currentTokens = 0;
  for (const entry of Array.isArray(pending) ? pending : []) {
    const tokens =
      estimateSourceTokens(entry.context.sourceText)
      + estimateSourceTokens(entry.usage.preparationGlossarySourceText);
    if (
      current.length > 0
      && (current.length >= maxRows || currentTokens + tokens > tokenTarget)
    ) {
      chunks.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(entry);
    currentTokens += tokens;
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}

// Ensures every item (all sharing one language pair) has a fresh derived
// glossary entry in chapter state and the persistent cache. Returns
// { aborted, results } where each result is
// { item, status: "none"|"cached"|"derived"|"unresolved", reason?,
//   matcherModel?, glossarySourceText? }.
// "unresolved" rows are the caller's to fall back on (single-row path);
// reasons: "no-context", "missing-pivot-text", "derivation-failed",
// "stale-source". A chunk failure resolves that chunk as unresolved and
// continues; only an inactive run aborts.
export async function ensureBatchDerivedGlossaries({
  chapterState,
  items,
  providerId,
  modelId,
  isRunActive = () => true,
  useCurrentGlossarySourceText = false,
  onItemSettled = null,
  chunkOptions = {},
  operations = {},
}) {
  const results = [];
  const settle = (result) => {
    results.push(result);
    onItemSettled?.(result);
  };

  const pending = [];
  for (const item of Array.isArray(items) ? items : []) {
    const context = buildDerivedGlossaryItemContext(chapterState, item);
    if (!context) {
      settle({ item, status: "unresolved", reason: "no-context" });
      continue;
    }
    const usage = resolveEditorDerivedGlossaryUsage(context, { useCurrentGlossarySourceText });
    if (usage.kind !== "derived") {
      settle({ item, status: "none" });
      continue;
    }
    if (usage.cachedDerivedEntry && !usage.cachedDerivedEntryIsStale) {
      settle({
        item,
        status: "cached",
        matcherModel: usage.cachedDerivedEntry.matcherModel ?? null,
        glossarySourceText: usage.cachedDerivedEntry.glossarySourceText ?? "",
      });
      continue;
    }
    if (!String(usage.preparationGlossarySourceText ?? "").trim()) {
      settle({ item, status: "unresolved", reason: "missing-pivot-text" });
      continue;
    }
    pending.push({ item, context, usage });
  }

  if (pending.length === 0) {
    return { aborted: false, results };
  }

  const prepareBatch =
    typeof operations.prepareEditorAiTranslatedGlossaryBatch === "function"
      ? operations.prepareEditorAiTranslatedGlossaryBatch
      : (batchRequest) =>
        invoke("prepare_editor_ai_translated_glossary_batch", { request: batchRequest });
  const installationId = selectedProjectsTeamInstallationId();

  for (const chunk of chunkPendingDerivations(pending, chunkOptions)) {
    if (!isRunActive()) {
      return { aborted: true, results };
    }

    const first = chunk[0];
    let payload = null;
    try {
      payload = await prepareBatch({
        providerId,
        modelId,
        translationSourceTexts: chunk.map((entry) => entry.context.sourceText),
        translationSourceLanguage: first.context.sourceLanguageLabel,
        glossarySourceLanguage: first.usage.glossarySourceLanguageLabel,
        targetLanguage: first.context.targetLanguageLabel,
        glossarySourceText: chunk
          .map((entry) => entry.usage.preparationGlossarySourceText.trim())
          .join("\n\n"),
        glossaryTerms: first.usage.glossaryTerms,
        ...(installationId === null ? {} : { installationId }),
      });
    } catch {
      if (!isRunActive()) {
        return { aborted: true, results };
      }
      for (const entry of chunk) {
        settle({ item: entry.item, status: "unresolved", reason: "derivation-failed" });
      }
      continue;
    }
    if (!isRunActive()) {
      return { aborted: true, results };
    }

    const preparedEntries = Array.isArray(payload?.entries) ? payload.entries : [];
    const requestKey = createBatchDerivedRequestKey(chapterState.chapterId);
    const team = selectedProjectsTeam();
    for (const entry of chunk) {
      // The combined derivation ran against the classification-time source
      // text; a mid-flight edit makes the alignment stale for that row.
      const currentRow = findEditorRowById(entry.item.rowId, state.editorChapter);
      if (
        !currentRow
        || readRowFieldText(currentRow, entry.item.sourceLanguageCode) !== entry.context.sourceText
      ) {
        settle({ item: entry.item, status: "unresolved", reason: "stale-source" });
        continue;
      }

      const rowEntries = preparedEntries.filter((prepared) =>
        typeof prepared?.sourceTerm === "string"
        && prepared.sourceTerm
        && entry.context.sourceText.includes(prepared.sourceTerm),
      );
      const derivedEntry = buildDerivedGlossaryState({
        glossaryState: entry.usage.glossaryState,
        sourceLanguage: entry.context.sourceLanguage,
        targetLanguage: entry.context.targetLanguage,
        requestKey,
        derivedContext: entry.usage.derivedContext,
        payload: {
          glossarySourceText: entry.usage.preparationGlossarySourceText,
          entries: rowEntries,
        },
      });
      state.editorChapter = applyEditorDerivedGlossaryEntry(
        state.editorChapter,
        entry.item.rowId,
        derivedEntry,
      );
      if (team && chapterState.projectId) {
        saveStoredEditorDerivedGlossaryEntryForChapter(
          team,
          chapterState.projectId,
          chapterState.chapterId,
          entry.item.rowId,
          derivedEntry,
        );
      }
      settle({
        item: entry.item,
        status: "derived",
        matcherModel: derivedEntry.matcherModel ?? null,
        glossarySourceText: entry.usage.preparationGlossarySourceText,
      });
    }
  }

  return { aborted: false, results };
}

export const editorDerivedGlossaryBatchTestApi = {
  buildDerivedGlossaryItemContext,
  chunkPendingDerivations,
};
