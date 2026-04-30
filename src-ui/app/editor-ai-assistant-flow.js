import {
  applyStoredSelectedTeamAiActionPreferences,
  ensureSharedAiActionConfigurationLoaded,
  openAiMissingKeyModal,
  resolveAiActionProviderAndModel,
} from "./ai-settings-flow.js";
import { ensureSelectedTeamAiProviderReady } from "./team-ai-flow.js";
import { resolveEditorAiTranslateLanguages } from "./editor-ai-translate-target.js";
import { selectedProjectsTeam, selectedProjectsTeamInstallationId } from "./project-context.js";
import { invoke, waitForNextPaint } from "./runtime.js";
import { state } from "./state.js";
import { findEditorRowById } from "./editor-utils.js";
import {
  buildEditorAssistantThreadKey,
  createEditorAssistantItemId,
  createEditorAssistantRequestKey,
  currentEditorAssistantThread,
  normalizeEditorAssistantState,
  appendEditorAssistantItems,
  applyEditorAssistantActiveThreadKey,
  applyEditorAssistantComposerDraft,
  applyEditorAssistantDocumentDigest,
  applyEditorAssistantFailed,
  applyEditorAssistantItemApplied,
  applyEditorAssistantItemApplying,
  applyEditorAssistantItemApplyFailed,
  applyEditorAssistantPending,
  applyEditorAssistantProviderContinuity,
  applyEditorAssistantThinking,
  clearEditorAssistantPending,
} from "./editor-ai-assistant-state.js";
import { showNoticeBadge } from "./status-feedback.js";
import {
  applyEditorDerivedGlossaryEntry,
  buildEditorDerivedGlossaryContext,
  buildEditorGlossaryRevisionKey,
  editorDerivedGlossaryIsStale,
  resolveEditorDerivedGlossarySourceText,
  resolveReadyEditorDerivedGlossaryEntry,
} from "./editor-derived-glossary-state.js";
import {
  buildEditorAiTranslationGlossaryHints,
  buildEditorDerivedGlossaryModel,
} from "./editor-glossary-highlighting.js";
import { extractGlossaryRubyBaseText } from "./glossary-ruby.js";
import { saveStoredEditorDerivedGlossaryEntryForChapter } from "./editor-derived-glossary-cache.js";
import { saveStoredEditorAssistantChapterData } from "./editor-ai-assistant-cache.js";

const DEFAULT_ROW_CONTEXT_COUNT = 3;
const MAX_CONCORDANCE_HITS = 10;
const MAX_TRANSCRIPT_ITEMS = 12;

function renderAssistantSidebar(render) {
  render?.({ scope: "translate-sidebar" });
}

export function scrollAssistantTranscriptToBottom(root = globalThis.document) {
  const transcript = root?.querySelector?.(".assistant-transcript");
  if (!transcript || typeof transcript.scrollTop !== "number") {
    return false;
  }

  const scrollHeight = Number(transcript.scrollHeight);
  if (!Number.isFinite(scrollHeight)) {
    return false;
  }

  transcript.scrollTop = scrollHeight;
  return true;
}

export function scheduleAssistantTranscriptScrollToBottom() {
  if (!globalThis.document) {
    return;
  }

  void waitForNextPaint().then(() => {
    scrollAssistantTranscriptToBottom();
  });
}

function renderAssistantSidebarAtBottom(render) {
  renderAssistantSidebar(render);
  scheduleAssistantTranscriptScrollToBottom();
}

function renderAssistantSidebarAndBody(render) {
  render?.({ scope: "translate-body" });
  renderAssistantSidebar(render);
}

function maybeInstallationPayload() {
  const installationId = selectedProjectsTeamInstallationId();
  return installationId === null ? {} : { installationId };
}

function withSelectedInstallation(request = {}) {
  const installationId = selectedProjectsTeamInstallationId();
  return installationId === null ? request : { ...request, installationId };
}

function errorMeansMissingAiKey(message) {
  const normalizedMessage = String(message ?? "").trim().toLowerCase();
  return (
    normalizedMessage.includes("api key is saved yet")
    || normalizedMessage.includes("save one first")
  );
}

function sanitizeTermList(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
}

function readRowFieldText(row, languageCode) {
  if (!languageCode) {
    return "";
  }

  return typeof row?.fields?.[languageCode] === "string"
    ? row.fields[languageCode]
    : String(row?.fields?.[languageCode] ?? "");
}

function buildDerivedGlossaryTermInputs(glossaryState) {
  return (Array.isArray(glossaryState?.terms) ? glossaryState.terms : [])
    .filter((term) => term?.lifecycleState !== "deleted")
    .map((term) => ({
      glossarySourceTerms: sanitizeTermList(term?.sourceTerms)
        .map((value) => extractGlossaryRubyBaseText(value).trim())
        .filter(Boolean),
      targetVariants: sanitizeTermList(term?.targetTerms),
      notes:
        typeof term?.notesToTranslators === "string" && term.notesToTranslators.trim()
          ? [term.notesToTranslators.trim()]
          : [],
    }))
    .filter((term) => term.glossarySourceTerms.length > 0);
}

function normalizeLanguageLabel(language, fallbackCode = "") {
  const name = typeof language?.name === "string" ? language.name.trim() : "";
  return name || fallbackCode;
}

function buildCurrentDerivedGlossaryContext(context, glossaryState, glossarySourceLanguageCode) {
  const currentGlossarySourceText = readRowFieldText(context.row, glossarySourceLanguageCode);
  return buildEditorDerivedGlossaryContext({
    translationSourceLanguageCode: context.sourceLanguageCode,
    glossarySourceLanguageCode,
    targetLanguageCode: context.targetLanguageCode,
    translationSourceText: context.sourceText,
    glossarySourceText: currentGlossarySourceText,
    glossarySourceTextOrigin: currentGlossarySourceText.trim() ? "row" : "generated",
    glossaryRevisionKey: buildEditorGlossaryRevisionKey(glossaryState),
  });
}

function assistantConfigRender(render) {
  return (options = null) => {
    if (!render) {
      return;
    }

    if (options?.scope === "translate-sidebar" || options?.scope === "translate-body") {
      render(options);
      return;
    }

    render({ scope: "translate-sidebar" });
  };
}

function assistantRequestMatches(chapterId, threadKey, requestKey) {
  const assistant = normalizeEditorAssistantState(state.editorChapter?.assistant);
  return (
    state.editorChapter?.chapterId === chapterId
    && assistant.activeThreadKey === threadKey
    && assistant.requestKey === requestKey
  );
}

function persistAssistantState(chapterState = state.editorChapter) {
  const team = selectedProjectsTeam();
  if (!team || !chapterState?.projectId || !chapterState?.chapterId) {
    return;
  }

  saveStoredEditorAssistantChapterData(
    team,
    chapterState.projectId,
    chapterState.chapterId,
    chapterState.assistant,
  );
}

function currentAssistantContext(chapterState = state.editorChapter, overrides = {}) {
  if (!chapterState?.chapterId || !chapterState?.activeRowId) {
    return null;
  }

  const row = findEditorRowById(chapterState.activeRowId, chapterState);
  if (!row) {
    return null;
  }

  const translateLanguages = resolveEditorAiTranslateLanguages(chapterState);
  const languages = Array.isArray(chapterState.languages) ? chapterState.languages : [];
  const sourceLanguageCode =
    typeof overrides.sourceLanguageCode === "string" && overrides.sourceLanguageCode.trim()
      ? overrides.sourceLanguageCode.trim()
      : translateLanguages.sourceLanguageCode;
  const targetLanguageCode =
    typeof overrides.targetLanguageCode === "string" && overrides.targetLanguageCode.trim()
      ? overrides.targetLanguageCode.trim()
      : translateLanguages.targetLanguageCode;
  const sourceLanguage = languages.find((language) => language.code === sourceLanguageCode) ?? null;
  const targetLanguage = languages.find((language) => language.code === targetLanguageCode) ?? null;
  if (!sourceLanguage || !targetLanguage) {
    return null;
  }

  const sourceText = readRowFieldText(row, sourceLanguageCode);
  const targetText = readRowFieldText(row, targetLanguageCode);
  const threadKey = buildEditorAssistantThreadKey(row.rowId, targetLanguageCode);

  return {
    chapterState,
    chapterId: chapterState.chapterId,
    projectId: chapterState.projectId,
    row,
    rowId: row.rowId,
    threadKey,
    sourceLanguageCode,
    targetLanguageCode,
    sourceLanguage,
    targetLanguage,
    sourceLanguageLabel: normalizeLanguageLabel(sourceLanguage, sourceLanguageCode),
    targetLanguageLabel: normalizeLanguageLabel(targetLanguage, targetLanguageCode),
    sourceText,
    targetText,
    alternateLanguageTexts: languages
      .map((language) => ({
        languageCode: language.code,
        languageLabel: normalizeLanguageLabel(language, language.code),
        text: readRowFieldText(row, language.code),
      }))
      .filter((entry) => entry.text.trim() && entry.languageCode !== sourceLanguageCode && entry.languageCode !== targetLanguageCode),
  };
}

function updateActiveAssistantThreadKey() {
  const context = currentAssistantContext();
  if (!context?.threadKey) {
    return;
  }

  state.editorChapter = applyEditorAssistantActiveThreadKey(
    state.editorChapter,
    context.threadKey,
  );
}

function normalizeForSearch(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFKC");
}

function resolveMentionedLanguage(phrase, languages, preferredCodes = []) {
  const normalizedPhrase = normalizeForSearch(phrase);
  if (!normalizedPhrase) {
    return null;
  }

  const rankedLanguages = [
    ...preferredCodes
      .map((code) => languages.find((language) => language.code === code))
      .filter(Boolean),
    ...languages.filter((language) => !preferredCodes.includes(language.code)),
  ];

  for (const language of rankedLanguages) {
    const code = normalizeForSearch(language?.code);
    const name = normalizeForSearch(language?.name);
    if (normalizedPhrase === code || normalizedPhrase === name) {
      return language;
    }
  }

  for (const language of rankedLanguages) {
    const code = normalizeForSearch(language?.code);
    const name = normalizeForSearch(language?.name);
    if (
      (code && normalizedPhrase.includes(code))
      || (name && normalizedPhrase.includes(name))
    ) {
      return language;
    }
  }

  return null;
}

function createToolEvent(text, summary = text) {
  return {
    id: createEditorAssistantItemId(),
    type: "tool-event",
    createdAt: new Date().toISOString(),
    text,
    summary,
  };
}

function createAssistantUserMessage(message, context) {
  return {
    id: createEditorAssistantItemId(),
    type: "user-message",
    createdAt: new Date().toISOString(),
    text: message,
    summary: message,
    sourceLanguageCode: context?.sourceLanguageCode ?? null,
    targetLanguageCode: context?.targetLanguageCode ?? null,
  };
}

function createAssistantMessage(payload, context) {
  return {
    id: createEditorAssistantItemId(),
    type: "assistant-message",
    createdAt: new Date().toISOString(),
    text: payload.assistantText,
    summary: payload.assistantText,
    sourceLanguageCode: context?.sourceLanguageCode ?? null,
    targetLanguageCode: context?.targetLanguageCode ?? null,
    promptText: payload.promptText ?? "",
    details: payload.details ?? {},
  };
}

function createDraftTranslationMessage(payload, context) {
  return {
    id: createEditorAssistantItemId(),
    type: "draft-translation",
    createdAt: new Date().toISOString(),
    text: payload.assistantText,
    summary: payload.summary ?? "Draft translation",
    sourceLanguageCode: context?.sourceLanguageCode ?? null,
    targetLanguageCode: context?.targetLanguageCode ?? null,
    promptText: payload.promptText ?? "",
    draftTranslationText: payload.draftTranslationText ?? "",
    details: payload.details ?? {},
  };
}

function createApplyResultMessage(text, context) {
  return {
    id: createEditorAssistantItemId(),
    type: "apply-result",
    createdAt: new Date().toISOString(),
    text,
    summary: text,
    sourceLanguageCode: context?.sourceLanguageCode ?? null,
    targetLanguageCode: context?.targetLanguageCode ?? null,
  };
}

function buildAssistantTranscriptEntries(thread) {
  const items = Array.isArray(thread?.items) ? thread.items : [];
  return items
    .slice(-MAX_TRANSCRIPT_ITEMS)
    .map((item) => {
      if (item.type === "user-message") {
        return {
          role: "user",
          text: item.text,
        };
      }

      if (item.type === "tool-event") {
        return {
          role: "tool",
          text: item.text,
        };
      }

      const draftSuffix =
        item.type === "draft-translation" && item.draftTranslationText
          ? `\nDraft translation:\n${item.draftTranslationText}`
          : "";
      return {
        role: "assistant",
        text: `${item.text ?? ""}${draftSuffix}`.trim(),
      };
    })
    .filter((entry) => entry.text.trim().length > 0);
}

function computeStableHash(input) {
  let hash = 2166136261;
  const text = String(input ?? "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${hash >>> 0}`;
}

function buildDocumentRevisionKey(chapterState, sourceLanguageCode) {
  const glossaryRevisionKey = buildEditorGlossaryRevisionKey(chapterState?.glossary);
  const rows = Array.isArray(chapterState?.rows) ? chapterState.rows : [];
  return computeStableHash(
    rows
      .map((row) => `${row?.rowId ?? ""}:${readRowFieldText(row, sourceLanguageCode)}`)
      .join("\n\u241E")
      + `::${glossaryRevisionKey}`,
  );
}

function summarizeRowsForDigest(rows, sourceLanguageCode, limit = 15000) {
  let output = "";
  for (const row of Array.isArray(rows) ? rows : []) {
    const text = readRowFieldText(row, sourceLanguageCode).trim();
    if (!text) {
      continue;
    }

    const nextChunk = `${row.rowId}: ${text}\n`;
    if (output.length + nextChunk.length > limit) {
      break;
    }
    output += nextChunk;
  }
  return output.trim();
}

function resolveDocumentDigest(chapterState, sourceLanguageCode) {
  const revisionKey = buildDocumentRevisionKey(chapterState, sourceLanguageCode);
  const assistant = normalizeEditorAssistantState(chapterState?.assistant);
  const existingDigest = assistant.chapterArtifacts.documentDigestsBySourceLanguage?.[sourceLanguageCode];
  if (existingDigest?.revisionKey === revisionKey && existingDigest.summary.trim()) {
    return {
      digest: existingDigest,
      needsRefresh: false,
    };
  }

  return {
    digest: existingDigest ?? null,
    needsRefresh: true,
    revisionKey,
  };
}

function resolveRowIndex(rows, rowId) {
  return (Array.isArray(rows) ? rows : []).findIndex((row) => row?.rowId === rowId);
}

function buildAssistantRowWindow(
  chapterState,
  rowId,
  sourceLanguageCode,
  targetLanguageCode,
  previousCount,
  includeCurrentRow = true,
) {
  const rows = Array.isArray(chapterState?.rows) ? chapterState.rows : [];
  const rowIndex = resolveRowIndex(rows, rowId);
  if (rowIndex < 0) {
    return [];
  }

  const startIndex = Math.max(0, rowIndex - Math.max(0, previousCount));
  const endIndex = includeCurrentRow ? rowIndex + 1 : rowIndex;
  return rows.slice(startIndex, endIndex).map((row) => ({
    rowId: row.rowId,
    sourceText: readRowFieldText(row, sourceLanguageCode),
    targetText: readRowFieldText(row, targetLanguageCode),
  }));
}

function buildAssistantSummaryRowWindow(
  chapterState,
  rowId,
  sourceLanguageCode,
  targetLanguageCode,
  rowCount,
) {
  const rows = Array.isArray(chapterState?.rows) ? chapterState.rows : [];
  const rowIndex = resolveRowIndex(rows, rowId);
  if (rowIndex < 0) {
    return [];
  }

  const count = Math.max(1, rowCount);
  const startIndex = Math.max(0, rowIndex - count + 1);
  return rows.slice(startIndex, rowIndex + 1).map((row) => ({
    rowId: row.rowId,
    sourceText: readRowFieldText(row, sourceLanguageCode),
    targetText: readRowFieldText(row, targetLanguageCode),
  }));
}

function buildConcordanceHits(chapterState, sourceLanguageCode, targetLanguageCode, term) {
  const normalizedTerm = normalizeForSearch(term);
  if (!normalizedTerm) {
    return [];
  }

  return (Array.isArray(chapterState?.rows) ? chapterState.rows : [])
    .filter((row) => normalizeForSearch(readRowFieldText(row, sourceLanguageCode)).includes(normalizedTerm))
    .slice(0, MAX_CONCORDANCE_HITS)
    .map((row) => ({
      rowId: row.rowId,
      sourceSnippet: readRowFieldText(row, sourceLanguageCode),
      targetSnippet: readRowFieldText(row, targetLanguageCode),
    }));
}

function translationIntentRegex(message) {
  const normalizedMessage = String(message ?? "").trim();
  return {
    retranslateWithContext: /(?:read\s+the\s+previous(?:\s+(\d+))?\s+rows?.*translate again|translate again.*previous(?:\s+(\d+))?\s+rows?)/i.exec(normalizedMessage),
    literal: /\btranslate more literally\b/i.test(normalizedMessage),
    natural: /\b(refine|make|rewrite).*\bmore natural\b|\bsound more natural\b/i.test(normalizedMessage),
    sourceOverride: /\btranslate from\s+(.+?)\s+to\s+(.+?)\s+instead of translating from\s+(.+?)(?:[.!?]|$)/i.exec(normalizedMessage),
    summarizeDocument: /\b(read|summarize|summary).*\b(entire|whole)\s+document\b|\bdocument\b.*\bsummar/i.test(normalizedMessage),
    summarizeRows: /\bsummar(?:ize|y).*(?:last|previous)\s*(\d+)?\s*rows?\b/i.exec(normalizedMessage),
    concordance: /\bword\s+(.+?)\s+is used in the document\b|\bhow\s+the\s+word\s+(.+?)\s+is used\b/i.exec(normalizedMessage),
    explainMeaning: /\bexplain\b.*\bmeaning\b|\bwhat does .* mean\b/i.test(normalizedMessage),
  };
}

function classifyAssistantIntent(message, context) {
  const matches = translationIntentRegex(message);
  const result = {
    kind: "chat",
    toolEvents: [],
    sourceLanguageCode: context.sourceLanguageCode,
    targetLanguageCode: context.targetLanguageCode,
    rowWindow: [],
    includeDocumentDigest: false,
    documentText: "",
    concordanceHits: [],
    sourceOverrideLabel: "",
    summary: "",
  };

  if (matches.sourceOverride) {
    const languages = Array.isArray(context.chapterState?.languages) ? context.chapterState.languages : [];
    const sourceLanguage = resolveMentionedLanguage(matches.sourceOverride[1], languages, [context.sourceLanguageCode]);
    const targetLanguage = resolveMentionedLanguage(matches.sourceOverride[2], languages, [context.targetLanguageCode]);
    if (sourceLanguage?.code && targetLanguage?.code && sourceLanguage.code !== targetLanguage.code) {
      result.kind = "translate_refinement";
      result.sourceLanguageCode = sourceLanguage.code;
      result.targetLanguageCode = targetLanguage.code;
      result.toolEvents.push(
        createToolEvent(
          `Switched translation direction to ${normalizeLanguageLabel(sourceLanguage, sourceLanguage.code)} -> ${normalizeLanguageLabel(targetLanguage, targetLanguage.code)}.`,
        ),
      );
      return result;
    }
  }

  if (matches.retranslateWithContext) {
    const count = Number.parseInt(matches.retranslateWithContext[1] || matches.retranslateWithContext[2] || "", 10);
    const previousCount = Number.isInteger(count) && count > 0 ? count : DEFAULT_ROW_CONTEXT_COUNT;
    result.kind = "translate_refinement";
    result.rowWindow = buildAssistantRowWindow(
      context.chapterState,
      context.rowId,
      context.sourceLanguageCode,
      context.targetLanguageCode,
      previousCount,
      true,
    );
    result.toolEvents.push(
      createToolEvent(
        `Read ${previousCount} previous rows plus the active row for context.`,
      ),
    );
    return result;
  }

  if (matches.literal) {
    result.kind = "translate_refinement";
    return result;
  }

  if (matches.natural) {
    result.kind = "translate_refinement";
    return result;
  }

  if (matches.summarizeDocument) {
    result.includeDocumentDigest = true;
    result.documentText = summarizeRowsForDigest(
      context.chapterState?.rows,
      context.sourceLanguageCode,
    );
    result.toolEvents.push(
      createToolEvent("Read the current document to build or reuse a chapter digest."),
    );
    return result;
  }

  if (matches.summarizeRows) {
    const count = Number.parseInt(matches.summarizeRows[1] || "", 10);
    const rowCount = Number.isInteger(count) && count > 0 ? count : DEFAULT_ROW_CONTEXT_COUNT;
    result.rowWindow = buildAssistantSummaryRowWindow(
      context.chapterState,
      context.rowId,
      context.sourceLanguageCode,
      context.targetLanguageCode,
      rowCount,
    );
    result.toolEvents.push(createToolEvent(`Read the last ${rowCount} rows.`));
    return result;
  }

  if (matches.concordance) {
    const term = (matches.concordance[1] || matches.concordance[2] || "").trim().replace(/^["']|["']$/g, "");
    result.concordanceHits = buildConcordanceHits(
      context.chapterState,
      context.sourceLanguageCode,
      context.targetLanguageCode,
      term,
    );
    if (term) {
      result.toolEvents.push(
        createToolEvent(`Searched the current document for uses of "${term}".`),
      );
    }
    return result;
  }

  if (matches.explainMeaning) {
    return result;
  }

  return result;
}

async function resolveAssistantGlossaryHints(context, providerId, modelId, allowDerivedPreparation = false) {
  const glossaryState = context.chapterState?.glossary ?? null;
  const glossaryModel = glossaryState?.matcherModel ?? null;
  const glossarySourceLanguageCode =
    typeof glossaryState?.sourceLanguage?.code === "string" && glossaryState.sourceLanguage.code.trim()
      ? glossaryState.sourceLanguage.code.trim()
      : typeof glossaryModel?.sourceLanguage?.code === "string" && glossaryModel.sourceLanguage.code.trim()
        ? glossaryModel.sourceLanguage.code.trim()
        : "";
  const glossaryTargetLanguageCode =
    typeof glossaryState?.targetLanguage?.code === "string" && glossaryState.targetLanguage.code.trim()
      ? glossaryState.targetLanguage.code.trim()
      : typeof glossaryModel?.targetLanguage?.code === "string" && glossaryModel.targetLanguage.code.trim()
        ? glossaryModel.targetLanguage.code.trim()
        : "";

  if (
    !glossarySourceLanguageCode
    || !glossaryTargetLanguageCode
    || glossaryTargetLanguageCode !== context.targetLanguageCode
  ) {
    return { glossaryHints: [], glossarySourceText: "" };
  }

  if (glossarySourceLanguageCode === context.sourceLanguageCode) {
    return {
      glossaryHints: buildEditorAiTranslationGlossaryHints(
        context.sourceText,
        context.sourceLanguageCode,
        context.targetLanguageCode,
        glossaryModel,
      ),
      glossarySourceText: context.sourceText,
    };
  }

  const cachedDerivedEntry = resolveReadyEditorDerivedGlossaryEntry(
    context.chapterState,
    context.rowId,
  );
  const derivedContext = buildCurrentDerivedGlossaryContext(
    context,
    glossaryState,
    glossarySourceLanguageCode,
  );
  const canUseCachedDerivedEntry =
    cachedDerivedEntry && !editorDerivedGlossaryIsStale(cachedDerivedEntry, derivedContext);
  if (canUseCachedDerivedEntry) {
    return {
      glossaryHints: buildEditorAiTranslationGlossaryHints(
        context.sourceText,
        context.sourceLanguageCode,
        context.targetLanguageCode,
        cachedDerivedEntry.matcherModel ?? null,
      ),
      glossarySourceText: cachedDerivedEntry.glossarySourceText,
    };
  }

  if (!allowDerivedPreparation) {
    return { glossaryHints: [], glossarySourceText: "" };
  }

  const glossaryTerms = buildDerivedGlossaryTermInputs(glossaryState);
  if (glossaryTerms.length === 0) {
    return { glossaryHints: [], glossarySourceText: "" };
  }

  const preparedGlossarySource = resolveEditorDerivedGlossarySourceText(
    context.row,
    context.sourceLanguageCode,
    glossarySourceLanguageCode,
  );
  const payload = await invoke("prepare_editor_ai_translated_glossary", {
    request: withSelectedInstallation({
      providerId,
      modelId,
      translationSourceText: context.sourceText,
      translationSourceLanguage: context.sourceLanguageLabel,
      glossarySourceLanguage: normalizeLanguageLabel(
        glossaryState?.sourceLanguage ?? glossaryModel?.sourceLanguage,
        glossarySourceLanguageCode,
      ),
      targetLanguage: context.targetLanguageLabel,
      glossarySourceText: preparedGlossarySource.glossarySourceText,
      glossaryTerms,
    }),
  });

  const glossarySourceText =
    typeof payload?.glossarySourceText === "string"
      ? payload.glossarySourceText
      : derivedContext.glossarySourceText;
  const entries = Array.isArray(payload?.entries) ? payload.entries : [];
  const derivedEntry = {
    status: "ready",
    error: "",
    requestKey: createEditorAssistantRequestKey("derived-glossary"),
    ...derivedContext,
    glossarySourceText,
    glossarySourceTextOrigin: preparedGlossarySource.glossarySourceTextOrigin === "row" ? "row" : "generated",
    entries,
    matcherModel: buildEditorDerivedGlossaryModel({
      sourceLanguage: context.sourceLanguage,
      targetLanguage: context.targetLanguage,
      entries,
      glossaryId: glossaryState?.glossaryId ?? null,
      repoName: glossaryState?.repoName ?? "",
      title: glossaryState?.title ?? "",
    }),
  };
  state.editorChapter = applyEditorDerivedGlossaryEntry(
    state.editorChapter,
    context.rowId,
    derivedEntry,
  );
  const team = selectedProjectsTeam();
  if (team && context.projectId) {
    saveStoredEditorDerivedGlossaryEntryForChapter(
      team,
      context.projectId,
      context.chapterId,
      context.rowId,
      derivedEntry,
    );
  }

  return {
    glossaryHints: buildEditorAiTranslationGlossaryHints(
      context.sourceText,
      context.sourceLanguageCode,
      context.targetLanguageCode,
      derivedEntry.matcherModel ?? null,
    ),
    glossarySourceText,
  };
}

function resolveProviderModelKey(providerId, modelId) {
  const normalizedProviderId = typeof providerId === "string" ? providerId.trim() : "";
  const normalizedModelId = typeof modelId === "string" ? modelId.trim() : "";
  return normalizedProviderId && normalizedModelId
    ? `${normalizedProviderId}::${normalizedModelId}`
    : "";
}

function resolveAssistantProviderContinuation(thread, providerId, modelId) {
  const providerModelKey = resolveProviderModelKey(providerId, modelId);
  const continuity = providerModelKey
    ? thread?.providerContinuityByModelKey?.[providerModelKey] ?? null
    : null;
  const previousResponseId =
    typeof continuity?.providerResponseId === "string" && continuity.providerResponseId.trim()
      ? continuity.providerResponseId.trim()
      : typeof continuity?.previousResponseId === "string" && continuity.previousResponseId.trim()
        ? continuity.previousResponseId.trim()
        : "";
  return previousResponseId ? { previousResponseId } : null;
}

function buildAssistantTurnRequestPayload(
  intent,
  message,
  context,
  thread,
  providerId,
  modelId,
  glossaryHints,
  documentDigest,
) {
  return withSelectedInstallation({
    providerId,
    modelId,
    kind: intent.kind,
    userMessage: message,
    transcript: buildAssistantTranscriptEntries(thread),
    row: {
      rowId: context.rowId,
      sourceLanguageCode: context.sourceLanguageCode,
      sourceLanguageLabel: context.sourceLanguageLabel,
      sourceText: context.sourceText,
      targetLanguageCode: context.targetLanguageCode,
      targetLanguageLabel: context.targetLanguageLabel,
      targetText: context.targetText,
      alternateLanguageTexts: context.alternateLanguageTexts,
    },
    rowWindow: intent.rowWindow,
    glossaryHints,
    documentDigest: documentDigest?.summary ?? "",
    documentRevisionKey: documentDigest?.revisionKey ?? "",
    concordanceHits: intent.concordanceHits,
    replyLanguageHint: "",
    providerContinuation: resolveAssistantProviderContinuation(thread, providerId, modelId),
  });
}

function responseDetails(intent, context, providerId, modelId, requestPayload) {
  return {
    kind: intent.kind,
    providerId,
    modelId,
    rowId: context.rowId,
    sourceLanguageCode: context.sourceLanguageCode,
    targetLanguageCode: context.targetLanguageCode,
    sourceLanguageLabel: context.sourceLanguageLabel,
    targetLanguageLabel: context.targetLanguageLabel,
    sourceText: context.sourceText,
    targetText: context.targetText,
    rowWindow: requestPayload.rowWindow ?? [],
    glossaryHints: requestPayload.glossaryHints ?? [],
    concordanceHits: requestPayload.concordanceHits ?? [],
    documentDigest: requestPayload.documentDigest ?? "",
  };
}

async function ensureAssistantProviderReady(render, providerId) {
  const configRender = assistantConfigRender(render);
  const usedStoredTeamActionPreferences = applyStoredSelectedTeamAiActionPreferences(configRender);
  try {
    await ensureSharedAiActionConfigurationLoaded(configRender);
  } catch (error) {
    if (selectedProjectsTeam()?.canDelete !== true && !usedStoredTeamActionPreferences) {
      throw error;
    }
  }
  const ensureKeyResult = await ensureSelectedTeamAiProviderReady(configRender, providerId);
  if (!ensureKeyResult?.ok) {
    openAiMissingKeyModal(providerId);
    render?.();
    return false;
  }

  return true;
}

export function updateEditorAssistantComposerDraft(nextValue) {
  state.editorChapter = applyEditorAssistantComposerDraft(state.editorChapter, nextValue);
  updateActiveAssistantThreadKey();
}

export async function runEditorAiAssistant(render) {
  if (state.offline?.isEnabled === true) {
    showNoticeBadge("This operation is not supported in offline mode", render);
    return;
  }

  updateActiveAssistantThreadKey();
  const message = normalizeEditorAssistantState(state.editorChapter?.assistant).composerDraft.trim();
  const baseContext = currentAssistantContext();
  if (!baseContext?.threadKey || !message) {
    return;
  }

  const userItem = createAssistantUserMessage(message, baseContext);
  state.editorChapter = appendEditorAssistantItems(
    state.editorChapter,
    baseContext.threadKey,
    [userItem],
    {
      rowId: baseContext.rowId,
      targetLanguageCode: baseContext.targetLanguageCode,
    },
  );
  state.editorChapter = applyEditorAssistantComposerDraft(state.editorChapter, "");
  const requestKey = createEditorAssistantRequestKey(baseContext.threadKey);
  state.editorChapter = applyEditorAssistantPending(
    state.editorChapter,
    baseContext.threadKey,
    requestKey,
  );
  persistAssistantState();
  renderAssistantSidebarAtBottom(render);

  try {
    const { providerId, modelId } = resolveAiActionProviderAndModel("discuss");
    if (!modelId) {
      throw new Error("Select a model for Discuss on the AI Settings page first.");
    }
    const providerReady = await ensureAssistantProviderReady(render, providerId);
    if (!providerReady) {
      state.editorChapter = clearEditorAssistantPending(
        state.editorChapter,
        baseContext.threadKey,
        requestKey,
      );
      persistAssistantState();
      return;
    }

    state.editorChapter = applyEditorAssistantThinking(
      state.editorChapter,
      baseContext.threadKey,
      requestKey,
    );
    persistAssistantState();
    renderAssistantSidebarAtBottom(render);

    const intent = classifyAssistantIntent(message, baseContext);
    if (intent.toolEvents.length > 0) {
      state.editorChapter = appendEditorAssistantItems(
        state.editorChapter,
        baseContext.threadKey,
        intent.toolEvents.map((item) => ({
          ...item,
          sourceLanguageCode: baseContext.sourceLanguageCode,
          targetLanguageCode: baseContext.targetLanguageCode,
        })),
        {
          rowId: baseContext.rowId,
          targetLanguageCode: baseContext.targetLanguageCode,
        },
      );
      persistAssistantState();
      renderAssistantSidebarAtBottom(render);
    }

    const context = currentAssistantContext(state.editorChapter, {
      sourceLanguageCode: intent.sourceLanguageCode,
      targetLanguageCode: intent.targetLanguageCode,
    });
    if (!context?.threadKey) {
      throw new Error("Select both the source and target language before using AI Assistant.");
    }

    const glossaryResult = await resolveAssistantGlossaryHints(
      context,
      providerId,
      modelId,
      intent.kind === "translate_refinement",
    );
    const digestState = intent.includeDocumentDigest
      ? resolveDocumentDigest(state.editorChapter, context.sourceLanguageCode)
      : { digest: null, needsRefresh: false, revisionKey: "" };
    const documentDigest =
      digestState.needsRefresh && intent.includeDocumentDigest && intent.documentText.trim()
        ? {
          summary: intent.documentText,
          revisionKey: digestState.revisionKey,
        }
        : digestState.digest
          ? {
            summary: digestState.digest.summary,
            revisionKey: digestState.digest.revisionKey,
          }
          : null;
    const thread = currentEditorAssistantThread(state.editorChapter, context.threadKey);
    const requestPayload = buildAssistantTurnRequestPayload(
      intent,
      message,
      context,
      thread,
      providerId,
      modelId,
      glossaryResult.glossaryHints,
      documentDigest,
    );
    const payload = await invoke("run_ai_assistant_turn", {
      request: requestPayload,
      ...maybeInstallationPayload(),
    });

    if (!assistantRequestMatches(baseContext.chapterId, baseContext.threadKey, requestKey)) {
      return;
    }

    state.editorChapter = clearEditorAssistantPending(
      state.editorChapter,
      baseContext.threadKey,
      requestKey,
    );

    if (payload?.providerContinuation) {
      const providerModelKey = resolveProviderModelKey(providerId, modelId);
      state.editorChapter = applyEditorAssistantProviderContinuity(
        state.editorChapter,
        context.threadKey,
        providerModelKey,
        payload.providerContinuation,
      );
    }

    if (intent.includeDocumentDigest && payload?.assistantText && documentDigest?.revisionKey) {
      state.editorChapter = applyEditorAssistantDocumentDigest(
        state.editorChapter,
        context.sourceLanguageCode,
        {
          summary: payload.assistantText,
          revisionKey: documentDigest.revisionKey,
          createdAt: new Date().toISOString(),
        },
      );
    }

    const itemDetails = responseDetails(intent, context, providerId, modelId, requestPayload);
    state.editorChapter = appendEditorAssistantItems(
      state.editorChapter,
      context.threadKey,
      [
        intent.kind === "translate_refinement"
          ? createDraftTranslationMessage({
            assistantText: payload?.assistantText ?? "",
            promptText: payload?.promptText ?? "",
            draftTranslationText: payload?.draftTranslationText ?? "",
            details: itemDetails,
          }, context)
          : createAssistantMessage({
            assistantText: payload?.assistantText ?? "",
            promptText: payload?.promptText ?? "",
            details: itemDetails,
          }, context),
      ],
      {
        rowId: context.rowId,
        targetLanguageCode: context.targetLanguageCode,
      },
    );
    persistAssistantState();
    renderAssistantSidebarAtBottom(render);
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    if (errorMeansMissingAiKey(messageText)) {
      const { providerId } = resolveAiActionProviderAndModel("discuss");
      openAiMissingKeyModal(providerId);
      state.editorChapter = clearEditorAssistantPending(
        state.editorChapter,
        baseContext.threadKey,
        requestKey,
      );
      persistAssistantState();
      render?.();
      return;
    }

    if (!assistantRequestMatches(baseContext.chapterId, baseContext.threadKey, requestKey)) {
      return;
    }

    state.editorChapter = applyEditorAssistantFailed(
      state.editorChapter,
      baseContext.threadKey,
      requestKey,
      messageText,
    );
    persistAssistantState();
    renderAssistantSidebar(render);
  }
}

export async function applyEditorAssistantDraft(render, itemId, operations = {}) {
  const { updateEditorRowFieldValue, persistEditorRowOnBlur } = operations;
  if (
    !itemId
    || typeof updateEditorRowFieldValue !== "function"
    || typeof persistEditorRowOnBlur !== "function"
  ) {
    return;
  }

  const context = currentAssistantContext();
  if (!context?.threadKey) {
    return;
  }

  const thread = currentEditorAssistantThread(state.editorChapter, context.threadKey);
  const item = thread.items.find((entry) => entry.id === itemId && entry.type === "draft-translation");
  if (!item?.draftTranslationText) {
    return;
  }

  state.editorChapter = applyEditorAssistantItemApplying(
    state.editorChapter,
    context.threadKey,
    itemId,
  );
  renderAssistantSidebar(render);

  try {
    updateEditorRowFieldValue(
      context.rowId,
      context.targetLanguageCode,
      item.draftTranslationText,
    );
    renderAssistantSidebarAndBody(render);

    await persistEditorRowOnBlur(render, context.rowId, {
      commitMetadata: {
        operation: "ai-assistant-apply",
        aiModel: item.details?.modelId ?? "",
      },
    });

    state.editorChapter = applyEditorAssistantItemApplied(
      state.editorChapter,
      context.threadKey,
      itemId,
    );
    state.editorChapter = appendEditorAssistantItems(
      state.editorChapter,
      context.threadKey,
      [createApplyResultMessage("Draft translation applied to the active row.", context)],
      {
        rowId: context.rowId,
        targetLanguageCode: context.targetLanguageCode,
      },
    );
    persistAssistantState();
    renderAssistantSidebar(render);
    showNoticeBadge("Assistant draft applied.", render);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.editorChapter = applyEditorAssistantItemApplyFailed(
      state.editorChapter,
      context.threadKey,
      itemId,
      message,
    );
    persistAssistantState();
    renderAssistantSidebar(render);
  }
}

export function logEditorAssistantTranslation(payload = {}) {
  const threadKey = buildEditorAssistantThreadKey(
    payload.rowId,
    payload.targetLanguageCode,
  );
  if (!threadKey || !state.editorChapter?.chapterId) {
    return;
  }

  state.editorChapter = appendEditorAssistantItems(
    state.editorChapter,
    threadKey,
    [{
      id: createEditorAssistantItemId(),
      type: "translation-log",
      createdAt: new Date().toISOString(),
      text: payload.summary ?? "Translation applied.",
      summary: payload.summary ?? "Translation applied.",
      sourceLanguageCode: payload.sourceLanguageCode ?? null,
      targetLanguageCode: payload.targetLanguageCode ?? null,
      promptText: payload.promptText ?? "",
      details: {
        providerId: payload.providerId ?? "",
        modelId: payload.modelId ?? "",
        sourceLanguageLabel: payload.sourceLanguageLabel ?? "",
        targetLanguageLabel: payload.targetLanguageLabel ?? "",
        sourceText: payload.sourceText ?? "",
        glossarySourceText: payload.glossarySourceText ?? "",
        glossaryHints: payload.glossaryHints ?? [],
        translatedText: payload.translatedText ?? "",
        appliedText: payload.appliedText ?? "",
      },
    }],
    {
      rowId: payload.rowId,
      targetLanguageCode: payload.targetLanguageCode,
    },
  );
  if (payload.providerContinuation) {
    const providerModelKey = resolveProviderModelKey(payload.providerId, payload.modelId);
    state.editorChapter = applyEditorAssistantProviderContinuity(
      state.editorChapter,
      threadKey,
      providerModelKey,
      payload.providerContinuation,
    );
  }
  persistAssistantState();
}
