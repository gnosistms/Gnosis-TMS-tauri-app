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
import { applyEditorDerivedGlossaryEntries } from "./editor-derived-glossary-state.js";
import { saveStoredEditorDerivedGlossaryEntriesForChapter } from "./editor-derived-glossary-cache.js";
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

// Splits entries into chunks bounded by row count and a token budget.
function chunkByTokenBudget(entries, options, tokensForEntry) {
  const maxRows = Number.isFinite(options.maxRows) && options.maxRows > 0
    ? options.maxRows
    : AI_BATCH_MAX_ROWS;
  const tokenTarget = Number.isFinite(options.tokenTarget) && options.tokenTarget > 0
    ? options.tokenTarget
    : AI_BATCH_TOKEN_TARGET;

  const chunks = [];
  let current = [];
  let currentTokens = 0;
  for (const entry of Array.isArray(entries) ? entries : []) {
    const tokens = tokensForEntry(entry);
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

// Both the row source text and its pivot text enter the alignment prompts, so
// both count against the derivation chunk budget.
function chunkPendingDerivations(pending, options = {}) {
  return chunkByTokenBudget(pending, options, (entry) =>
    estimateSourceTokens(entry.context.sourceText)
    + estimateSourceTokens(entry.usage.preparationGlossarySourceText),
  );
}

// Phase B: batched pivot-text generation. One run_ai_translation_batch call
// per chunk translates the generation column into the glossary source
// language; each returned text is written into the row's pivot column (and
// optionally persisted) before the row is re-resolved into the derivation
// queue. Rows whose generation fails settle as unresolved.
async function generatePivotTextBatches({
  chapterState,
  needsPivotText,
  providerId,
  modelId,
  isRunActive,
  useCurrentGlossarySourceText,
  persistPivotTextToRow,
  render,
  settle,
  chunkOptions,
  operations,
}) {
  const runBatch =
    typeof operations.runAiTranslationBatch === "function"
      ? operations.runAiTranslationBatch
      : (batchRequest) => invoke("run_ai_translation_batch", { request: batchRequest });
  const installationId = selectedProjectsTeamInstallationId();
  const pending = [];

  const chunks = chunkByTokenBudget(needsPivotText, chunkOptions, (entry) =>
    estimateSourceTokens(entry.generationSourceText),
  );
  for (const chunk of chunks) {
    if (!isRunActive()) {
      return { aborted: true, pending };
    }

    const first = chunk[0];
    const generationLanguage = languageByCode(chapterState, first.generationCode);
    let payload = null;
    try {
      payload = await runBatch({
        providerId,
        modelId,
        sourceLanguage:
          languageSemanticLabel(generationLanguage) || first.generationCode,
        targetLanguage: first.usage.glossarySourceLanguageLabel,
        sourceLanguageCode: first.generationCode,
        targetLanguageCode: first.usage.glossarySourceLanguageCode,
        rows: chunk.map((entry) => ({
          rowId: entry.item.rowId,
          sourceText: entry.generationSourceText,
        })),
        ...(installationId === null ? {} : { installationId }),
      });
    } catch {
      if (!isRunActive()) {
        return { aborted: true, pending };
      }
      for (const entry of chunk) {
        settle({ item: entry.item, status: "unresolved", reason: "generation-failed" });
      }
      continue;
    }
    if (!isRunActive()) {
      return { aborted: true, pending };
    }

    const returnedById = new Map(
      (Array.isArray(payload?.rows) ? payload.rows : []).map((row) => [row.rowId, row]),
    );
    for (const entry of chunk) {
      const pivotText =
        typeof returnedById.get(entry.item.rowId)?.translatedText === "string"
          ? returnedById.get(entry.item.rowId).translatedText.trim()
          : "";
      if (!pivotText) {
        settle({ item: entry.item, status: "unresolved", reason: "generation-failed" });
        continue;
      }

      operations.updateEditorRowFieldValue(
        entry.item.rowId,
        entry.usage.glossarySourceLanguageCode,
        pivotText,
      );
      if (persistPivotTextToRow && typeof operations.persistEditorRowOnBlur === "function") {
        await operations.persistEditorRowOnBlur(render, entry.item.rowId, {
          commitMetadata: {
            operation: "ai-translation",
            aiModel: modelId,
          },
          waitForDurable: false,
        });
        if (!isRunActive()) {
          return { aborted: true, pending };
        }
      }

      // Re-resolve against the freshly written row so the derivation context
      // (and its staleness keys) reflect what is now in the pivot column.
      const freshContext = buildDerivedGlossaryItemContext(state.editorChapter, entry.item);
      const freshUsage = freshContext
        ? resolveEditorDerivedGlossaryUsage(freshContext, { useCurrentGlossarySourceText })
        : null;
      if (
        freshUsage?.kind !== "derived"
        || !String(freshUsage.preparationGlossarySourceText ?? "").trim()
      ) {
        settle({ item: entry.item, status: "unresolved", reason: "generation-failed" });
        continue;
      }
      pending.push({ item: entry.item, context: freshContext, usage: freshUsage });
    }
  }

  return { aborted: false, pending };
}

// Ensures every item (all sharing one language pair) has a fresh derived
// glossary entry in chapter state and the persistent cache. Returns
// { aborted, results } where each result is
// { item, status: "none"|"cached"|"derived"|"unresolved", reason?,
//   matcherModel?, glossarySourceText? }.
// "unresolved" rows are the caller's to fall back on (single-row path);
// reasons: "no-context", "missing-pivot-text", "generation-failed",
// "derivation-failed", "stale-source". A chunk failure resolves that chunk as
// unresolved and continues; only an inactive run aborts.
//
// With generateMissingPivotText, rows whose pivot column is empty first get a
// batched pivot translation (generationSourceLanguageCode column — defaults to
// the item's source column — into the glossary source language); the result is
// written into the row and, with persistPivotTextToRow, persisted like the
// single-row path before the row joins the derivation queue.
export async function ensureBatchDerivedGlossaries({
  chapterState,
  items,
  providerId,
  modelId,
  isRunActive = () => true,
  useCurrentGlossarySourceText = false,
  generateMissingPivotText = false,
  persistPivotTextToRow = false,
  generationSourceLanguageCode = "",
  render = null,
  onItemSettled = null,
  chunkOptions = {},
  operations = {},
}) {
  const results = [];
  const settle = (result) => {
    results.push(result);
    onItemSettled?.(result);
  };

  const canGeneratePivotText =
    generateMissingPivotText
    && typeof operations.updateEditorRowFieldValue === "function";

  const pending = [];
  const needsPivotText = [];
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
      const generationCode = generationSourceLanguageCode || item.sourceLanguageCode;
      const generationSourceText = readRowFieldText(context.row, generationCode);
      if (!canGeneratePivotText || !generationSourceText.trim()) {
        settle({ item, status: "unresolved", reason: "missing-pivot-text" });
        continue;
      }
      needsPivotText.push({ item, context, usage, generationCode, generationSourceText });
      continue;
    }
    pending.push({ item, context, usage });
  }

  if (needsPivotText.length > 0) {
    const generated = await generatePivotTextBatches({
      chapterState,
      needsPivotText,
      providerId,
      modelId,
      isRunActive,
      useCurrentGlossarySourceText,
      persistPivotTextToRow,
      render,
      settle,
      chunkOptions,
      operations,
    });
    if (generated.aborted) {
      return { aborted: true, results };
    }
    pending.push(...generated.pending);
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
    // Chapter-state apply and cache save happen ONCE per chunk — per-row
    // writes re-normalize the whole entry map and clone + persist the whole
    // cross-chapter cache per row, which is quadratic in chapter size and has
    // frozen the machine on large derivation runs.
    const applied = [];
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
      applied.push({ entry, derivedEntry });
    }

    if (applied.length > 0) {
      const entriesByRowId = Object.fromEntries(
        applied.map(({ entry, derivedEntry }) => [entry.item.rowId, derivedEntry]),
      );
      state.editorChapter = applyEditorDerivedGlossaryEntries(
        state.editorChapter,
        entriesByRowId,
      );
      if (team && chapterState.projectId) {
        saveStoredEditorDerivedGlossaryEntriesForChapter(
          team,
          chapterState.projectId,
          chapterState.chapterId,
          entriesByRowId,
        );
      }
      for (const { entry, derivedEntry } of applied) {
        settle({
          item: entry.item,
          status: "derived",
          matcherModel: derivedEntry.matcherModel ?? null,
          glossarySourceText: entry.usage.preparationGlossarySourceText,
        });
      }
    }
  }

  return { aborted: false, results };
}

export const editorDerivedGlossaryBatchTestApi = {
  buildDerivedGlossaryItemContext,
  chunkPendingDerivations,
};
