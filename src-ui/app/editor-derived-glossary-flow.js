import {
  applyEditorDerivedGlossaryEntry,
  buildEditorDerivedGlossaryContext,
  buildEditorGlossaryRevisionKey,
  editorDerivedGlossaryIsStale,
  resolveEditorDerivedGlossarySourceText,
  resolveReadyEditorDerivedGlossaryEntry,
} from "./editor-derived-glossary-state.js";
import { saveStoredEditorDerivedGlossaryEntryForChapter } from "./editor-derived-glossary-cache.js";
import { buildEditorDerivedGlossaryModel } from "./editor-glossary-highlighting.js";
import { extractGlossaryRubyBaseText } from "./glossary-ruby.js";
import { selectedProjectsTeam, selectedProjectsTeamInstallationId } from "./project-context.js";
import { invoke } from "./runtime.js";
import { findEditorRowById } from "./editor-utils.js";
import { languageBaseCode } from "./editor-language-utils.js";
import { state } from "./state.js";

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

export function readRowFieldText(row, languageCode) {
  if (!languageCode) {
    return "";
  }

  return typeof row?.fields?.[languageCode] === "string"
    ? row.fields[languageCode]
    : String(row?.fields?.[languageCode] ?? "");
}

function sanitizeTermList(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
}

export function buildDerivedGlossaryTermInputs(glossaryState) {
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

export function buildCurrentDerivedGlossaryContext(
  context,
  glossaryState,
  glossarySourceLanguageCode,
  options = {},
) {
  const currentGlossarySourceText =
    typeof options?.glossarySourceText === "string"
      ? options.glossarySourceText
      : readRowFieldText(context.row, glossarySourceLanguageCode);
  return buildEditorDerivedGlossaryContext({
    translationSourceLanguageCode: context.sourceLanguageCode,
    glossarySourceLanguageCode,
    targetLanguageCode: context.targetLanguageCode,
    translationSourceText: context.sourceText,
    glossarySourceText: currentGlossarySourceText,
    glossarySourceTextOrigin:
      options?.glossarySourceTextOrigin === "row"
      || options?.glossarySourceTextOrigin === "generated"
        ? options.glossarySourceTextOrigin
        : currentGlossarySourceText.trim() ? "row" : "generated",
    glossaryRevisionKey: buildEditorGlossaryRevisionKey(glossaryState),
  });
}

export function buildLoadingDerivedGlossaryState(
  requestKey,
  derivedContext,
  retainedDerivedEntry = null,
) {
  if (retainedDerivedEntry) {
    return {
      ...retainedDerivedEntry,
      status: "loading",
      error: "",
      requestKey,
    };
  }

  return {
    status: "loading",
    error: "",
    requestKey,
    ...derivedContext,
    entries: [],
    matcherModel: null,
  };
}

export function buildDerivedGlossaryState({
  glossaryState,
  sourceLanguage,
  targetLanguage,
  requestKey,
  derivedContext,
  payload = {},
}) {
  const glossarySourceText =
    typeof payload?.glossarySourceText === "string"
      ? payload.glossarySourceText
      : derivedContext.glossarySourceText;
  const entries = Array.isArray(payload?.entries) ? payload.entries : [];
  return {
    status: "ready",
    error: "",
    requestKey,
    ...derivedContext,
    glossarySourceText,
    entries,
    matcherModel: buildEditorDerivedGlossaryModel({
      sourceLanguage,
      targetLanguage,
      entries,
      glossaryId: glossaryState?.glossaryId ?? null,
      repoName: glossaryState?.repoName ?? "",
      title: glossaryState?.title ?? "",
    }),
  };
}

export function resolvePreparedDerivedGlossaryContext(glossaryUsage, payload = {}) {
  const glossarySourceText =
    typeof payload?.glossarySourceText === "string"
      ? payload.glossarySourceText
      : glossaryUsage?.derivedContext?.glossarySourceText ?? "";
  const shouldStoreInRow = glossarySourceText.trim().length > 0;

  return {
    ...glossaryUsage.derivedContext,
    glossarySourceText,
    glossarySourceTextOrigin:
      shouldStoreInRow
        ? "row"
        : glossaryUsage?.derivedContext?.glossarySourceTextOrigin ?? "generated",
  };
}

export function resolveEditorDerivedGlossaryUsage(context, options = {}) {
  const glossaryState = context.chapterState?.glossary ?? null;
  const glossaryModel = glossaryState?.matcherModel ?? null;
  const glossarySourceLanguageCode = resolveLanguageCode(
    glossaryState?.sourceLanguage ?? glossaryModel?.sourceLanguage,
  );
  const glossaryTargetLanguageCode = resolveLanguageCode(
    glossaryState?.targetLanguage ?? glossaryModel?.targetLanguage,
  );

  if (
    !glossarySourceLanguageCode
    || !glossaryTargetLanguageCode
    || glossaryTargetLanguageCode !== languageBaseCode(context.targetLanguage)
    || glossarySourceLanguageCode === languageBaseCode(context.sourceLanguage)
  ) {
    return {
      kind: "none",
    };
  }

  const glossaryTerms = buildDerivedGlossaryTermInputs(glossaryState);
  if (glossaryTerms.length === 0) {
    return {
      kind: "none",
    };
  }

  const glossarySourceLanguage = (Array.isArray(context.chapterState?.languages) ? context.chapterState.languages : [])
    .find((language) => languageBaseCode(language) === glossarySourceLanguageCode);
  const glossarySourceColumnCode = glossarySourceLanguage?.code ?? glossarySourceLanguageCode;
  const currentGlossarySourceText = readRowFieldText(context.row, glossarySourceColumnCode);
  const {
    glossarySourceText: preparationGlossarySourceText,
    glossarySourceTextOrigin: preparationGlossarySourceTextOrigin,
  } = options.useCurrentGlossarySourceText === true
    ? {
      glossarySourceText: currentGlossarySourceText,
      glossarySourceTextOrigin: currentGlossarySourceText.trim() ? "row" : "generated",
    }
    : resolveEditorDerivedGlossarySourceText(
      context.row,
      context.sourceLanguageCode,
      glossarySourceColumnCode,
    );
  const derivedContext = buildCurrentDerivedGlossaryContext(
    context,
    glossaryState,
    glossarySourceColumnCode,
    {
      glossarySourceText: preparationGlossarySourceText,
      glossarySourceTextOrigin: preparationGlossarySourceTextOrigin,
    },
  );
  const cachedDerivedEntry = resolveReadyEditorDerivedGlossaryEntry(
    context.chapterState,
    context.rowId,
  );

  return {
    kind: "derived",
    glossaryState,
    glossaryTerms,
    glossarySourceLanguageCode: glossarySourceColumnCode,
    glossarySourceLanguageLabel: resolveLanguageLabel(
      glossaryState?.sourceLanguage ?? glossaryModel?.sourceLanguage,
      glossarySourceLanguageCode,
    ),
    derivedContext,
    preparationGlossarySourceText,
    preparationGlossarySourceTextOrigin,
    cachedDerivedEntry,
    cachedDerivedEntryIsStale:
      cachedDerivedEntry ? editorDerivedGlossaryIsStale(cachedDerivedEntry, derivedContext) : true,
  };
}

function withSelectedInstallation(request = {}) {
  const installationId = selectedProjectsTeamInstallationId();
  return installationId === null ? request : { ...request, installationId };
}

function syncPreparedDerivedGlossarySourceTextToRow(
  render,
  context,
  glossaryUsage,
  derivedContext,
  updateEditorRowFieldValue,
) {
  const glossarySourceLanguageCode = glossaryUsage?.glossarySourceLanguageCode ?? "";
  if (
    !glossarySourceLanguageCode
    || typeof updateEditorRowFieldValue !== "function"
    || derivedContext?.glossarySourceTextOrigin !== "row"
  ) {
    return false;
  }

  const currentRow = findEditorRowById(context.rowId, state.editorChapter);
  const currentGlossarySourceText = readRowFieldText(currentRow, glossarySourceLanguageCode);
  if (currentGlossarySourceText === derivedContext.glossarySourceText) {
    return false;
  }

  updateEditorRowFieldValue(
    context.rowId,
    glossarySourceLanguageCode,
    derivedContext.glossarySourceText,
  );
  return true;
}

async function generateMissingGlossarySourceText({
  invokeImpl,
  providerId,
  modelId,
  glossaryUsage,
  generationSourceText,
  generationSourceLanguageLabel,
  targetLanguageLabel,
}) {
  const payload = await invokeImpl("run_ai_translation", {
    request: withSelectedInstallation({
      providerId,
      modelId,
      text: generationSourceText,
      sourceLanguage: generationSourceLanguageLabel,
      targetLanguage: glossaryUsage.glossarySourceLanguageLabel,
    }),
  });
  return typeof payload?.translatedText === "string" ? payload.translatedText : "";
}

export async function prepareEditorDerivedGlossaryForContext({
  render,
  context,
  glossaryUsage,
  providerId,
  modelId,
  requestKey,
  retainedDerivedEntry = null,
  updateEditorRowFieldValue,
  persistEditorRowOnBlur,
  persistGlossarySourceImmediately = false,
  generateMissingGlossarySourceTextWhenMissing = false,
  syncGlossarySourceTextToRow = true,
  renderDerivedGlossaryState,
  renderOptions = {},
  requestStillCurrent = () => true,
  sourceStillCurrent = () => true,
  generationSourceText = context?.sourceText ?? "",
  generationSourceLanguageLabel = context?.sourceLanguageLabel ?? "",
  operations = {},
}) {
  const invokeImpl = typeof operations.invoke === "function" ? operations.invoke : invoke;

  state.editorChapter = applyEditorDerivedGlossaryEntry(
    state.editorChapter,
    context.rowId,
    buildLoadingDerivedGlossaryState(
      requestKey,
      glossaryUsage.derivedContext,
      retainedDerivedEntry,
    ),
  );
  renderDerivedGlossaryState?.("loading", renderOptions);

  let glossarySourceText = glossaryUsage.preparationGlossarySourceText;
  if (!glossarySourceText.trim() && generateMissingGlossarySourceTextWhenMissing) {
    glossarySourceText = await generateMissingGlossarySourceText({
      invokeImpl,
      providerId,
      modelId,
      glossaryUsage,
      generationSourceText,
      generationSourceLanguageLabel,
      targetLanguageLabel: context.targetLanguageLabel,
    });
    if (!requestStillCurrent()) {
      return { ok: false, skipped: true };
    }
  }

  const payload = await invokeImpl("prepare_editor_ai_translated_glossary", {
    request: withSelectedInstallation({
      providerId,
      modelId,
      translationSourceText: context.sourceText,
      translationSourceLanguage: context.sourceLanguageLabel,
      glossarySourceLanguage: glossaryUsage.glossarySourceLanguageLabel,
      targetLanguage: context.targetLanguageLabel,
      glossarySourceText,
      glossaryTerms: glossaryUsage.glossaryTerms,
    }),
  });

  if (!requestStillCurrent()) {
    return { ok: false, skipped: true };
  }
  if (!sourceStillCurrent()) {
    return { ok: false, skipped: true, sourceChanged: true };
  }

  const preparedPayload = {
    ...payload,
    glossarySourceText:
      typeof payload?.glossarySourceText === "string"
        ? payload.glossarySourceText
        : glossarySourceText,
  };
  const resolvedPreparedDerivedContext = resolvePreparedDerivedGlossaryContext(
    glossaryUsage,
    preparedPayload,
  );
  const preparedDerivedContext = syncGlossarySourceTextToRow
    ? resolvedPreparedDerivedContext
    : {
      ...resolvedPreparedDerivedContext,
      glossarySourceTextOrigin:
        glossaryUsage.preparationGlossarySourceTextOrigin === "row"
          ? "row"
          : "generated",
    };
  const wrotePreparedGlossarySourceText = syncGlossarySourceTextToRow
    ? syncPreparedDerivedGlossarySourceTextToRow(
      render,
      context,
      glossaryUsage,
      preparedDerivedContext,
      updateEditorRowFieldValue,
    )
    : false;
  if (wrotePreparedGlossarySourceText) {
    renderDerivedGlossaryState?.("source", renderOptions);
    if (
      persistGlossarySourceImmediately
      && typeof persistEditorRowOnBlur === "function"
    ) {
      await persistEditorRowOnBlur(render, context.rowId, {
        commitMetadata: {
          operation: "ai-translation",
          aiModel: modelId,
        },
      });
      if (!requestStillCurrent()) {
        return { ok: false, skipped: true };
      }
    }
  }

  const preparedDerivedGlossaryNeedsPersist =
    syncGlossarySourceTextToRow &&
    !persistGlossarySourceImmediately
    && preparedDerivedContext.glossarySourceTextOrigin === "row"
    && (
      glossaryUsage.derivedContext.glossarySourceTextOrigin !== "row"
      || wrotePreparedGlossarySourceText
    );
  const derivedEntry = buildDerivedGlossaryState({
    glossaryState: glossaryUsage.glossaryState,
    sourceLanguage: context.sourceLanguage,
    targetLanguage: context.targetLanguage,
    requestKey,
    derivedContext: preparedDerivedContext,
    payload: preparedPayload,
  });
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
  renderDerivedGlossaryState?.("ready", renderOptions);

  return {
    ok: true,
    derivedEntry,
    preparedDerivedGlossaryNeedsPersist,
    wrotePreparedGlossarySourceText,
  };
}
