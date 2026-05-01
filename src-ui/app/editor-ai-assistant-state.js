import {
  createEditorAssistantChapterArtifactsState,
  createEditorAssistantState,
  createEditorAssistantThreadState,
} from "./state.js";

const EDITOR_ASSISTANT_ITEM_TYPES = new Set([
  "user-message",
  "assistant-message",
  "tool-event",
  "translation-log",
  "draft-translation",
  "apply-result",
]);

export function createEditorAssistantRequestKey(threadKey = "assistant") {
  const uniqueSuffix =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${threadKey}:${uniqueSuffix}`;
}

export function createEditorAssistantItemId() {
  return createEditorAssistantRequestKey("assistant-item");
}

export function buildEditorAssistantThreadKey(rowId, targetLanguageCode) {
  const normalizedRowId = typeof rowId === "string" ? rowId.trim() : "";
  const normalizedTargetLanguageCode =
    typeof targetLanguageCode === "string" ? targetLanguageCode.trim() : "";
  if (!normalizedRowId || !normalizedTargetLanguageCode) {
    return null;
  }

  return `${normalizedRowId}::${normalizedTargetLanguageCode}`;
}

function normalizePersistedObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function normalizeEditorAssistantItem(item) {
  const normalizedType = EDITOR_ASSISTANT_ITEM_TYPES.has(item?.type) ? item.type : "assistant-message";
  return {
    id:
      typeof item?.id === "string" && item.id.trim()
        ? item.id.trim()
        : createEditorAssistantItemId(),
    type: normalizedType,
    createdAt:
      typeof item?.createdAt === "string" && item.createdAt.trim()
        ? item.createdAt.trim()
        : new Date().toISOString(),
    text: typeof item?.text === "string" ? item.text : "",
    summary: typeof item?.summary === "string" ? item.summary : "",
    sourceLanguageCode:
      typeof item?.sourceLanguageCode === "string" && item.sourceLanguageCode.trim()
        ? item.sourceLanguageCode.trim()
        : null,
    targetLanguageCode:
      typeof item?.targetLanguageCode === "string" && item.targetLanguageCode.trim()
        ? item.targetLanguageCode.trim()
        : null,
    promptText: typeof item?.promptText === "string" ? item.promptText : "",
    draftTranslationText: typeof item?.draftTranslationText === "string" ? item.draftTranslationText : "",
    draftDiffHidden: item?.draftDiffHidden === true,
    applyStatus:
      item?.applyStatus === "applying" || item?.applyStatus === "applied" || item?.applyStatus === "error"
        ? item.applyStatus
        : "idle",
    applyError: typeof item?.applyError === "string" ? item.applyError : "",
    appliedAt:
      typeof item?.appliedAt === "string" && item.appliedAt.trim()
        ? item.appliedAt.trim()
        : null,
    details: normalizePersistedObject(item?.details),
  };
}

export function normalizeEditorAssistantThreadState(thread) {
  return {
    ...createEditorAssistantThreadState(),
    ...(thread && typeof thread === "object" ? thread : {}),
    rowId: typeof thread?.rowId === "string" && thread.rowId.trim() ? thread.rowId.trim() : null,
    targetLanguageCode:
      typeof thread?.targetLanguageCode === "string" && thread.targetLanguageCode.trim()
        ? thread.targetLanguageCode.trim()
        : null,
    items: (Array.isArray(thread?.items) ? thread.items : []).map((item) =>
      normalizeEditorAssistantItem(item),
    ),
    providerContinuityByModelKey: normalizePersistedObject(thread?.providerContinuityByModelKey),
    lastPromptedSourceText:
      typeof thread?.lastPromptedSourceText === "string"
        ? thread.lastPromptedSourceText
        : "",
    lastPromptedTargetText:
      typeof thread?.lastPromptedTargetText === "string"
        ? thread.lastPromptedTargetText
        : "",
    hasPromptedRowTextSnapshot: thread?.hasPromptedRowTextSnapshot === true,
    lastTouchedAt:
      typeof thread?.lastTouchedAt === "string" && thread.lastTouchedAt.trim()
        ? thread.lastTouchedAt.trim()
        : null,
  };
}

export function normalizeEditorAssistantChapterArtifacts(chapterArtifacts) {
  const nextArtifacts = {
    ...createEditorAssistantChapterArtifactsState(),
    ...(chapterArtifacts && typeof chapterArtifacts === "object" ? chapterArtifacts : {}),
  };
  const digests = normalizePersistedObject(nextArtifacts.documentDigestsBySourceLanguage);
  nextArtifacts.documentDigestsBySourceLanguage = Object.fromEntries(
    Object.entries(digests)
      .map(([sourceLanguageCode, digest]) => {
        const normalizedSourceLanguageCode =
          typeof sourceLanguageCode === "string" ? sourceLanguageCode.trim() : "";
        if (!normalizedSourceLanguageCode || !digest || typeof digest !== "object") {
          return null;
        }

        return [
          normalizedSourceLanguageCode,
          {
            sourceLanguageCode: normalizedSourceLanguageCode,
            summary: typeof digest.summary === "string" ? digest.summary : "",
            revisionKey: typeof digest.revisionKey === "string" ? digest.revisionKey : "",
            createdAt:
              typeof digest.createdAt === "string" && digest.createdAt.trim()
                ? digest.createdAt.trim()
                : null,
          },
        ];
      })
      .filter(Boolean),
  );
  return nextArtifacts;
}

export function normalizeEditorAssistantState(assistant) {
  const nextAssistant = {
    ...createEditorAssistantState(),
    ...(assistant && typeof assistant === "object" ? assistant : {}),
  };

  nextAssistant.status =
    nextAssistant.status === "sending"
    || nextAssistant.status === "thinking"
    || nextAssistant.status === "applying"
      ? nextAssistant.status
      : "idle";
  nextAssistant.error = typeof nextAssistant.error === "string" ? nextAssistant.error : "";
  nextAssistant.requestKey =
    typeof nextAssistant.requestKey === "string" && nextAssistant.requestKey.trim()
      ? nextAssistant.requestKey.trim()
      : null;
  nextAssistant.activeThreadKey =
    typeof nextAssistant.activeThreadKey === "string" && nextAssistant.activeThreadKey.trim()
      ? nextAssistant.activeThreadKey.trim()
      : null;
  nextAssistant.applyingItemId =
    typeof nextAssistant.applyingItemId === "string" && nextAssistant.applyingItemId.trim()
      ? nextAssistant.applyingItemId.trim()
      : null;
  nextAssistant.composerDraft =
    typeof nextAssistant.composerDraft === "string" ? nextAssistant.composerDraft : "";
  nextAssistant.threadsByKey = Object.fromEntries(
    Object.entries(normalizePersistedObject(nextAssistant.threadsByKey))
      .map(([threadKey, thread]) => {
        const normalizedThread = normalizeEditorAssistantThreadState(thread);
        const expectedThreadKey = buildEditorAssistantThreadKey(
          normalizedThread.rowId,
          normalizedThread.targetLanguageCode,
        );
        if (!expectedThreadKey || expectedThreadKey !== threadKey) {
          return null;
        }

        return [threadKey, normalizedThread];
      })
      .filter(Boolean),
  );
  nextAssistant.chapterArtifacts = normalizeEditorAssistantChapterArtifacts(
    nextAssistant.chapterArtifacts,
  );

  if (!nextAssistant.activeThreadKey || !(nextAssistant.activeThreadKey in nextAssistant.threadsByKey)) {
    nextAssistant.activeThreadKey = null;
  }

  return nextAssistant;
}

export function currentEditorAssistantThread(chapterState, threadKey) {
  const assistant = normalizeEditorAssistantState(chapterState?.assistant);
  if (!threadKey || !(threadKey in assistant.threadsByKey)) {
    return createEditorAssistantThreadState();
  }

  return assistant.threadsByKey[threadKey];
}

function replaceAssistantState(chapterState, nextAssistant) {
  if (!chapterState?.chapterId) {
    return chapterState;
  }

  return {
    ...chapterState,
    assistant: normalizeEditorAssistantState(nextAssistant),
  };
}

function nextThreadState(threadKey, existingThread, overrides = {}) {
  return normalizeEditorAssistantThreadState({
    ...createEditorAssistantThreadState(),
    ...existingThread,
    ...overrides,
    rowId: existingThread?.rowId ?? overrides.rowId ?? null,
    targetLanguageCode: existingThread?.targetLanguageCode ?? overrides.targetLanguageCode ?? null,
    lastTouchedAt: overrides.lastTouchedAt ?? new Date().toISOString(),
  });
}

export function applyEditorAssistantComposerDraft(chapterState, draft) {
  const assistant = normalizeEditorAssistantState(chapterState?.assistant);
  return replaceAssistantState(chapterState, {
    ...assistant,
    composerDraft: typeof draft === "string" ? draft : "",
  });
}

export function applyEditorAssistantActiveThreadKey(chapterState, threadKey) {
  const assistant = normalizeEditorAssistantState(chapterState?.assistant);
  return replaceAssistantState(chapterState, {
    ...assistant,
    activeThreadKey: threadKey,
  });
}

export function applyEditorAssistantPending(chapterState, threadKey, requestKey) {
  const assistant = normalizeEditorAssistantState(chapterState?.assistant);
  return replaceAssistantState(chapterState, {
    ...assistant,
    status: "sending",
    error: "",
    requestKey,
    activeThreadKey: threadKey,
  });
}

export function applyEditorAssistantThinking(chapterState, threadKey, requestKey) {
  const assistant = normalizeEditorAssistantState(chapterState?.assistant);
  if (assistant.requestKey !== requestKey || assistant.activeThreadKey !== threadKey) {
    return chapterState;
  }

  return replaceAssistantState(chapterState, {
    ...assistant,
    status: "thinking",
    error: "",
  });
}

export function applyEditorAssistantFailed(chapterState, threadKey, requestKey, error) {
  const assistant = normalizeEditorAssistantState(chapterState?.assistant);
  if (assistant.requestKey !== requestKey || assistant.activeThreadKey !== threadKey) {
    return chapterState;
  }

  return replaceAssistantState(chapterState, {
    ...assistant,
    status: "idle",
    error: typeof error === "string" ? error : "",
    requestKey: null,
  });
}

export function clearEditorAssistantPending(chapterState, threadKey, requestKey) {
  const assistant = normalizeEditorAssistantState(chapterState?.assistant);
  if (assistant.requestKey !== requestKey || assistant.activeThreadKey !== threadKey) {
    return chapterState;
  }

  return replaceAssistantState(chapterState, {
    ...assistant,
    status: "idle",
    error: "",
    requestKey: null,
  });
}

export function appendEditorAssistantItems(
  chapterState,
  threadKey,
  items,
  options = {},
) {
  if (!threadKey) {
    return chapterState;
  }

  const assistant = normalizeEditorAssistantState(chapterState?.assistant);
  const existingThread = currentEditorAssistantThread(chapterState, threadKey);
  const nextItems = [
    ...existingThread.items,
    ...(Array.isArray(items) ? items : []).map((item) => normalizeEditorAssistantItem(item)),
  ];
  const thread = nextThreadState(threadKey, existingThread, {
    rowId: options.rowId ?? existingThread.rowId,
    targetLanguageCode: options.targetLanguageCode ?? existingThread.targetLanguageCode,
    items: nextItems,
  });

  return replaceAssistantState(chapterState, {
    ...assistant,
    threadsByKey: {
      ...assistant.threadsByKey,
      [threadKey]: thread,
    },
    activeThreadKey: threadKey,
  });
}

export function updateEditorAssistantItem(chapterState, threadKey, itemId, updater) {
  if (!threadKey || !itemId || typeof updater !== "function") {
    return chapterState;
  }

  const assistant = normalizeEditorAssistantState(chapterState?.assistant);
  const existingThread = currentEditorAssistantThread(chapterState, threadKey);
  if (!existingThread.items.some((item) => item.id === itemId)) {
    return chapterState;
  }

  const thread = nextThreadState(threadKey, existingThread, {
    items: existingThread.items.map((item) =>
      item.id === itemId ? normalizeEditorAssistantItem(updater(item)) : item
    ),
  });

  return replaceAssistantState(chapterState, {
    ...assistant,
    threadsByKey: {
      ...assistant.threadsByKey,
      [threadKey]: thread,
    },
  });
}

export function applyEditorAssistantItemApplying(chapterState, threadKey, itemId) {
  const nextChapterState = updateEditorAssistantItem(chapterState, threadKey, itemId, (item) => ({
    ...item,
    applyStatus: "applying",
    applyError: "",
  }));
  const assistant = normalizeEditorAssistantState(nextChapterState?.assistant);
  return replaceAssistantState(nextChapterState, {
    ...assistant,
    status: "applying",
    applyingItemId: itemId,
    error: "",
  });
}

export function applyEditorAssistantItemApplied(chapterState, threadKey, itemId) {
  const nextChapterState = updateEditorAssistantItem(chapterState, threadKey, itemId, (item) => ({
    ...item,
    applyStatus: "applied",
    applyError: "",
    appliedAt: new Date().toISOString(),
  }));
  const assistant = normalizeEditorAssistantState(nextChapterState?.assistant);
  return replaceAssistantState(nextChapterState, {
    ...assistant,
    status: "idle",
    applyingItemId: null,
    error: "",
  });
}

export function applyEditorAssistantItemApplyFailed(chapterState, threadKey, itemId, error) {
  const nextChapterState = updateEditorAssistantItem(chapterState, threadKey, itemId, (item) => ({
    ...item,
    applyStatus: "error",
    applyError: typeof error === "string" ? error : "",
  }));
  const assistant = normalizeEditorAssistantState(nextChapterState?.assistant);
  return replaceAssistantState(nextChapterState, {
    ...assistant,
    status: "idle",
    applyingItemId: null,
    error: typeof error === "string" ? error : "",
  });
}

export function applyEditorAssistantProviderContinuity(
  chapterState,
  threadKey,
  providerModelKey,
  continuity,
) {
  if (!threadKey || !providerModelKey) {
    return chapterState;
  }

  const assistant = normalizeEditorAssistantState(chapterState?.assistant);
  const existingThread = currentEditorAssistantThread(chapterState, threadKey);
  const thread = nextThreadState(threadKey, existingThread, {
    providerContinuityByModelKey: {
      ...existingThread.providerContinuityByModelKey,
      [providerModelKey]: normalizePersistedObject(continuity),
    },
  });

  return replaceAssistantState(chapterState, {
    ...assistant,
    threadsByKey: {
      ...assistant.threadsByKey,
      [threadKey]: thread,
    },
  });
}

export function applyEditorAssistantPromptedRowTextSnapshot(
  chapterState,
  threadKey,
  sourceText,
  targetText,
) {
  if (!threadKey) {
    return chapterState;
  }

  const assistant = normalizeEditorAssistantState(chapterState?.assistant);
  const existingThread = currentEditorAssistantThread(chapterState, threadKey);
  const thread = nextThreadState(threadKey, existingThread, {
    lastPromptedSourceText: typeof sourceText === "string" ? sourceText : "",
    lastPromptedTargetText: typeof targetText === "string" ? targetText : "",
    hasPromptedRowTextSnapshot: true,
  });

  return replaceAssistantState(chapterState, {
    ...assistant,
    threadsByKey: {
      ...assistant.threadsByKey,
      [threadKey]: thread,
    },
  });
}

export function applyEditorAssistantDocumentDigest(
  chapterState,
  sourceLanguageCode,
  digest,
) {
  const normalizedSourceLanguageCode =
    typeof sourceLanguageCode === "string" ? sourceLanguageCode.trim() : "";
  if (!normalizedSourceLanguageCode || !digest || typeof digest !== "object") {
    return chapterState;
  }

  const assistant = normalizeEditorAssistantState(chapterState?.assistant);
  return replaceAssistantState(chapterState, {
    ...assistant,
    chapterArtifacts: {
      ...assistant.chapterArtifacts,
      documentDigestsBySourceLanguage: {
        ...assistant.chapterArtifacts.documentDigestsBySourceLanguage,
        [normalizedSourceLanguageCode]: {
          sourceLanguageCode: normalizedSourceLanguageCode,
          summary: typeof digest.summary === "string" ? digest.summary : "",
          revisionKey: typeof digest.revisionKey === "string" ? digest.revisionKey : "",
          createdAt:
            typeof digest.createdAt === "string" && digest.createdAt.trim()
              ? digest.createdAt.trim()
              : new Date().toISOString(),
        },
      },
    },
  });
}

export function extractPersistedEditorAssistantState(assistant) {
  const normalizedAssistant = normalizeEditorAssistantState(assistant);
  return {
    threadsByKey: normalizedAssistant.threadsByKey,
    chapterArtifacts: normalizedAssistant.chapterArtifacts,
  };
}
