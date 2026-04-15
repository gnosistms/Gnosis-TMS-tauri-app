import { invoke } from "./runtime.js";
import { showNoticeBadge } from "./status-feedback.js";
import {
  AI_ACTION_IDS,
  coerceAiActionPreferencesToSavedProviders,
  createAiProviderModelsState,
  extractAiActionPreferences,
  pickPreferredAiModelId,
  resolveEffectiveAiActionSelection,
} from "./ai-action-config.js";
import { saveStoredAiActionPreferences } from "./ai-action-preferences.js";
import {
  loadStoredAiSettingsAboutDismissed,
  saveStoredAiSettingsAboutDismissed,
} from "./ai-settings-preferences.js";
import {
  AI_PROVIDER_IDS,
  getAiProviderSavedMessage,
  normalizeAiProviderId,
} from "./ai-provider-config.js";
import {
  createAiSettingsAboutModalState,
  createAiModelErrorModalState,
  createAiReviewMissingKeyModalState,
  state,
} from "./state.js";

function actionConfigState() {
  return state.aiSettings.actionConfig;
}

function persistAiActionPreferences() {
  saveStoredAiActionPreferences(extractAiActionPreferences(actionConfigState()));
}

function replaceAiActionConfig(nextActionConfig) {
  state.aiSettings = {
    ...state.aiSettings,
    actionConfig: nextActionConfig,
  };
}

function resetAiModelValidationState(options = {}) {
  state.aiSettings = {
    ...state.aiSettings,
    modelValidationRequestId:
      options.bumpRequestId === true
        ? state.aiSettings.modelValidationRequestId + 1
        : state.aiSettings.modelValidationRequestId,
    modelErrorModal: createAiModelErrorModalState(),
  };
}

function createAiSettingsAboutModalStateForDisplay() {
  if (loadStoredAiSettingsAboutDismissed()) {
    return createAiSettingsAboutModalState();
  }

  return {
    ...createAiSettingsAboutModalState(),
    isOpen: true,
  };
}

function normalizeAiProbeErrorMessage(error) {
  if (error instanceof Error) {
    return error.message.trim();
  }

  return String(error ?? "").trim();
}

function aiProbeErrorLooksRateLimited(message) {
  const normalizedMessage = String(message ?? "").trim().toLowerCase();
  return (
    normalizedMessage.includes("rate limit")
    || normalizedMessage.includes("too many requests")
    || normalizedMessage.includes("resource has been exhausted")
    || normalizedMessage.includes("quota exceeded")
  );
}

function aiProbeErrorLooksQuotaOrBillingRelated(message) {
  const normalizedMessage = String(message ?? "").trim().toLowerCase();
  return (
    normalizedMessage.includes("insufficient_quota")
    || normalizedMessage.includes("current quota")
    || normalizedMessage.includes("billing")
    || normalizedMessage.includes("quota")
  );
}

function aiProbeErrorLooksAuthenticationRelated(message) {
  const normalizedMessage = String(message ?? "").trim().toLowerCase();
  return (
    normalizedMessage.includes("api key")
    && (
      normalizedMessage.includes("invalid")
      || normalizedMessage.includes("rejected")
      || normalizedMessage.includes("incorrect")
      || normalizedMessage.includes("missing")
      || normalizedMessage.includes("unauthorized")
      || normalizedMessage.includes("forbidden")
    )
  );
}

function aiProbeErrorLooksModelAccessRelated(message) {
  const normalizedMessage = String(message ?? "").trim().toLowerCase();
  return (
    normalizedMessage.includes("model")
    && (
      normalizedMessage.includes("not found")
      || normalizedMessage.includes("not available")
      || normalizedMessage.includes("not supported")
      || normalizedMessage.includes("permission denied")
      || normalizedMessage.includes("not allowed")
      || normalizedMessage.includes("access")
      || normalizedMessage.includes("deprecated")
      || normalizedMessage.includes("shut down")
    )
  );
}

export function explainAiModelProbeError(providerId, errorMessage) {
  const normalizedProviderId = normalizeAiProviderId(providerId);
  if (normalizedProviderId === "gemini" && aiProbeErrorLooksRateLimited(errorMessage)) {
    return "A rate limit on Gemini indicates that either you have not set up billing for your Google AI account or you have set up billing but you used up all the tokens that your usage plan allows in a given time period.";
  }
  if (aiProbeErrorLooksAuthenticationRelated(errorMessage)) {
    return "The saved API key appears to be invalid for this provider. Please update the key or select a different model.";
  }
  if (aiProbeErrorLooksQuotaOrBillingRelated(errorMessage)) {
    return "This account may not have billing enabled for that provider, or it may have exhausted its available quota. Please try selecting a different model.";
  }
  if (aiProbeErrorLooksModelAccessRelated(errorMessage)) {
    return "This model may not be available for this account, usage tier, or region. Please try selecting a different model.";
  }
  if (aiProbeErrorLooksRateLimited(errorMessage)) {
    return "This account is currently being rate limited for that model. Wait a moment and try again, or select a different model.";
  }

  return "Please try selecting a different model.";
}

function openAiModelErrorModal(providerId, bannerMessage) {
  state.aiSettings = {
    ...state.aiSettings,
    modelErrorModal: {
      ...createAiModelErrorModalState(),
      isOpen: true,
      banner: bannerMessage,
      message: explainAiModelProbeError(providerId, bannerMessage),
    },
  };
}

function readAiActionSelection(actionConfig, scopeId) {
  return scopeId === "unified"
    ? actionConfig.unified
    : actionConfig.actions[scopeId] ?? actionConfig.unified;
}

function replaceAiActionSelection(actionConfig, scopeId, nextSelection) {
  if (scopeId === "unified") {
    return {
      ...actionConfig,
      unified: nextSelection,
    };
  }

  return {
    ...actionConfig,
    actions: {
      ...actionConfig.actions,
      [scopeId]: nextSelection,
    },
  };
}

function visibleAiActionScopeIds(actionConfig) {
  return actionConfig.detailedConfiguration ? AI_ACTION_IDS : ["unified"];
}

function normalizeAiModelOptions(options) {
  const seenIds = new Set();
  const normalizedOptions = [];

  for (const option of Array.isArray(options) ? options : []) {
    const id = typeof option?.id === "string" ? option.id.trim() : "";
    if (!id || seenIds.has(id)) {
      continue;
    }
    seenIds.add(id);

    const label =
      typeof option?.label === "string" && option.label.trim()
        ? option.label.trim()
        : id;
    normalizedOptions.push({ id, label });
  }

  return normalizedOptions;
}

function invalidateAiProviderModels(providerId) {
  const normalizedProviderId = normalizeAiProviderId(providerId);
  const actionConfig = actionConfigState();
  replaceAiActionConfig({
    ...actionConfig,
    modelOptionsByProvider: {
      ...actionConfig.modelOptionsByProvider,
      [normalizedProviderId]: createAiProviderModelsState(),
    },
  });
}

function coerceActionConfigToSavedProviders(actionConfig, savedProviderIds) {
  const coercedPreferences = coerceAiActionPreferencesToSavedProviders(
    actionConfig,
    savedProviderIds,
  );

  return {
    ...actionConfig,
    ...coercedPreferences,
    modelOptionsByProvider: Object.fromEntries(
      AI_PROVIDER_IDS.map((providerId) => [
        providerId,
        savedProviderIds.includes(providerId)
          ? actionConfig.modelOptionsByProvider[providerId] ?? createAiProviderModelsState()
          : createAiProviderModelsState(),
      ]),
    ),
  };
}

function syncAiActionModelSelectionsForProvider(actionConfig, providerId, options) {
  const syncSelection = (selection) =>
    selection.providerId === providerId
      ? {
          ...selection,
          modelId: pickPreferredAiModelId(providerId, options, selection.modelId),
        }
      : selection;

  return {
    ...actionConfig,
    unified: syncSelection(actionConfig.unified),
    actions: Object.fromEntries(
      AI_ACTION_IDS.map((actionId) => [
        actionId,
        syncSelection(actionConfig.actions[actionId]),
      ]),
    ),
  };
}

async function ensureAiProviderModelsLoaded(render, providerId, options = {}) {
  const normalizedProviderId = normalizeAiProviderId(providerId);
  let actionConfig = actionConfigState();

  if (!actionConfig.savedProviderIds.includes(normalizedProviderId)) {
    return [];
  }

  const currentModelsState =
    actionConfig.modelOptionsByProvider[normalizedProviderId] ?? createAiProviderModelsState();
  if (
    !options.force
    && currentModelsState.status === "ready"
    && currentModelsState.hasLoaded
    && currentModelsState.options.length > 0
  ) {
    return currentModelsState.options;
  }
  if (currentModelsState.status === "loading") {
    return currentModelsState.options;
  }

  actionConfig = {
    ...actionConfig,
    modelOptionsByProvider: {
      ...actionConfig.modelOptionsByProvider,
      [normalizedProviderId]: {
        ...currentModelsState,
        status: "loading",
        error: "",
      },
    },
  };
  replaceAiActionConfig(actionConfig);
  render?.();

  try {
    const optionsPayload = await invoke("list_ai_provider_models", {
      providerId: normalizedProviderId,
    });
    const normalizedOptions = normalizeAiModelOptions(optionsPayload);

    let nextActionConfig = actionConfigState();
    nextActionConfig = syncAiActionModelSelectionsForProvider(
      nextActionConfig,
      normalizedProviderId,
      normalizedOptions,
    );
    nextActionConfig = {
      ...nextActionConfig,
      modelOptionsByProvider: {
        ...nextActionConfig.modelOptionsByProvider,
        [normalizedProviderId]: {
          status: "ready",
          error: "",
          options: normalizedOptions,
          hasLoaded: true,
        },
      },
    };
    replaceAiActionConfig(nextActionConfig);
    persistAiActionPreferences();
    render?.();
    return normalizedOptions;
  } catch (error) {
    replaceAiActionConfig({
      ...actionConfigState(),
      modelOptionsByProvider: {
        ...actionConfigState().modelOptionsByProvider,
        [normalizedProviderId]: {
          status: "error",
          error: error instanceof Error ? error.message : String(error),
          options: [],
          hasLoaded: true,
        },
      },
    });
    render?.();
    return [];
  }
}

async function ensureVisibleAiProviderModelsLoaded(render) {
  const actionConfig = actionConfigState();
  const visibleProviderIds = new Set(
    visibleAiActionScopeIds(actionConfig)
      .map((scopeId) => readAiActionSelection(actionConfig, scopeId).providerId)
      .filter((providerId) => actionConfig.savedProviderIds.includes(providerId)),
  );

  if (visibleProviderIds.size === 0) {
    return;
  }

  await Promise.all(
    [...visibleProviderIds].map((providerId) => ensureAiProviderModelsLoaded(render, providerId)),
  );
}

export async function refreshAiSavedProviders(render, options = {}) {
  let actionConfig = actionConfigState();
  if (!options.suppressLoadingState) {
    actionConfig = {
      ...actionConfig,
      availableProvidersStatus: "loading",
      availableProvidersError: "",
    };
    replaceAiActionConfig(actionConfig);
    render?.();
  }

  try {
    const providerStatuses = await Promise.all(
      AI_PROVIDER_IDS.map(async (providerId) => {
        const apiKey = await invoke("load_ai_provider_secret", { providerId });
        return typeof apiKey === "string" && apiKey.trim() ? providerId : null;
      }),
    );
    const savedProviderIds = providerStatuses.filter(Boolean);

    let nextActionConfig = coerceActionConfigToSavedProviders(
      actionConfigState(),
      savedProviderIds,
    );
    nextActionConfig = {
      ...nextActionConfig,
      availableProvidersStatus: "ready",
      availableProvidersError: "",
      savedProviderIds,
    };
    replaceAiActionConfig(nextActionConfig);
    persistAiActionPreferences();
    render?.();
    await ensureVisibleAiProviderModelsLoaded(render);
  } catch (error) {
    replaceAiActionConfig({
      ...actionConfigState(),
      availableProvidersStatus: "error",
      availableProvidersError: error instanceof Error ? error.message : String(error),
    });
    render?.();
  }
}

export async function loadAiSettingsPage(render, options = {}) {
  state.aiSettings = {
    ...state.aiSettings,
    aboutModal: createAiSettingsAboutModalStateForDisplay(),
  };
  const providerId = normalizeAiProviderId(options.providerId ?? state.aiSettings.providerId);
  await Promise.all([
    loadAiProviderSecret(render, { providerId }),
    refreshAiSavedProviders(render),
  ]);
}

export function openAiKeyPage(render, options = {}) {
  const returnScreen =
    typeof options.returnScreen === "string" && options.returnScreen && options.returnScreen !== "aiKey"
      ? options.returnScreen
      : state.screen === "aiKey"
        ? state.aiSettings.returnScreen
        : state.screen;
  const providerId = normalizeAiProviderId(options.providerId ?? state.aiSettings.providerId);

  state.aiSettings = {
    ...state.aiSettings,
    providerId,
    returnScreen,
    error: "",
    successMessage: "",
    modelValidationRequestId: state.aiSettings.modelValidationRequestId + 1,
    aboutModal: createAiSettingsAboutModalStateForDisplay(),
    modelErrorModal: createAiModelErrorModalState(),
  };
  state.aiReviewMissingKeyModal = createAiReviewMissingKeyModalState();
  state.screen = "aiKey";
  render?.();
  void loadAiSettingsPage(render, { providerId });
}

export async function loadAiProviderSecret(render, options = {}) {
  const providerId = normalizeAiProviderId(options.providerId ?? state.aiSettings.providerId);
  const shouldClearDraft = providerId !== state.aiSettings.providerId;

  state.aiSettings = {
    ...state.aiSettings,
    status: "loading",
    error: "",
    successMessage: "",
    providerId,
    apiKey: shouldClearDraft ? "" : state.aiSettings.apiKey,
    modelValidationRequestId: state.aiSettings.modelValidationRequestId + 1,
    modelErrorModal: createAiModelErrorModalState(),
  };
  render?.();

  try {
    const apiKey = await invoke("load_ai_provider_secret", { providerId });
    state.aiSettings = {
      ...state.aiSettings,
      status: "ready",
      error: "",
      successMessage: "",
      providerId,
      apiKey: typeof apiKey === "string" ? apiKey : "",
      hasLoaded: true,
    };
  } catch (error) {
    state.aiSettings = {
      ...state.aiSettings,
      status: "error",
      error: error instanceof Error ? error.message : String(error),
      successMessage: "",
      providerId,
      hasLoaded: true,
    };
  }

  render?.();
}

export function updateAiProviderSecretDraft(nextValue) {
  state.aiSettings = {
    ...state.aiSettings,
    apiKey: typeof nextValue === "string" ? nextValue : "",
    error: "",
    successMessage: "",
    modelErrorModal: createAiModelErrorModalState(),
  };
}

export async function selectAiProvider(render, nextProviderId) {
  const providerId = normalizeAiProviderId(nextProviderId);
  if (
    state.aiSettings.status === "loading"
    || state.aiSettings.status === "saving"
    || (
      providerId === state.aiSettings.providerId
      && state.aiSettings.hasLoaded
      && !state.aiSettings.error
    )
  ) {
    return;
  }

  await loadAiProviderSecret(render, { providerId });
}

export async function saveAiProviderSecret(render) {
  const providerId = normalizeAiProviderId(state.aiSettings.providerId);
  const apiKey = typeof state.aiSettings.apiKey === "string" ? state.aiSettings.apiKey : "";
  const successMessage = getAiProviderSavedMessage(providerId);

  state.aiSettings = {
    ...state.aiSettings,
    status: "saving",
    error: "",
    successMessage: "",
    providerId,
    modelValidationRequestId: state.aiSettings.modelValidationRequestId + 1,
    modelErrorModal: createAiModelErrorModalState(),
  };
  render?.();

  try {
    await invoke("save_ai_provider_secret", {
      providerId,
      apiKey,
    });

    state.aiSettings = {
      ...state.aiSettings,
      status: "ready",
      error: "",
      successMessage,
      providerId,
      apiKey: apiKey.trim(),
      hasLoaded: true,
    };
    showNoticeBadge(successMessage, render);

    const shouldReturnToTranslate =
      state.aiSettings.returnScreen === "translate" && Boolean(state.selectedChapterId);
    if (shouldReturnToTranslate) {
      state.aiReviewMissingKeyModal = createAiReviewMissingKeyModalState();
      const { openTranslateChapter } = await import("./translate-flow.js");
      await openTranslateChapter(render, state.selectedChapterId);
      return;
    }

    if (state.screen === "aiKey") {
      invalidateAiProviderModels(providerId);
      await refreshAiSavedProviders(render, { suppressLoadingState: true });
    }
  } catch (error) {
    state.aiSettings = {
      ...state.aiSettings,
      status: "error",
      error: error instanceof Error ? error.message : String(error),
      successMessage: "",
      providerId,
      hasLoaded: true,
    };
  }

  render?.();
}

export function updateAiActionDetailedConfiguration(render, nextValue) {
  resetAiModelValidationState({ bumpRequestId: true });
  const nextDetailedConfiguration = nextValue === true;
  const currentActionConfig = actionConfigState();

  let nextActionConfig = {
    ...currentActionConfig,
    detailedConfiguration: nextDetailedConfiguration,
  };

  if (!nextDetailedConfiguration) {
    const reviewSelection = resolveEffectiveAiActionSelection(
      {
        ...currentActionConfig,
        detailedConfiguration: true,
      },
      "review",
    );
    nextActionConfig = {
      ...nextActionConfig,
      unified:
        currentActionConfig.unified.modelId
        && currentActionConfig.savedProviderIds.includes(currentActionConfig.unified.providerId)
          ? currentActionConfig.unified
          : reviewSelection,
    };
  }

  replaceAiActionConfig(nextActionConfig);
  persistAiActionPreferences();
  render?.();
  void ensureVisibleAiProviderModelsLoaded(render);
}

export function updateAiActionProvider(render, scopeId, nextProviderId) {
  resetAiModelValidationState({ bumpRequestId: true });
  const providerId = normalizeAiProviderId(nextProviderId);
  const currentActionConfig = actionConfigState();
  if (!currentActionConfig.savedProviderIds.includes(providerId)) {
    return;
  }

  const currentSelection = readAiActionSelection(currentActionConfig, scopeId);
  const providerModelsState =
    currentActionConfig.modelOptionsByProvider[providerId] ?? createAiProviderModelsState();
  const nextSelection = {
    providerId,
    modelId:
      currentSelection.providerId === providerId
        ? currentSelection.modelId
        : providerModelsState.status === "ready"
          ? pickPreferredAiModelId(providerId, providerModelsState.options)
          : "",
  };

  const nextActionConfig = replaceAiActionSelection(
    currentActionConfig,
    scopeId,
    nextSelection,
  );
  replaceAiActionConfig(nextActionConfig);
  persistAiActionPreferences();
  render?.();
  void ensureAiProviderModelsLoaded(render, providerId);
}

export async function updateAiActionModel(render, scopeId, nextModelId) {
  const currentActionConfig = actionConfigState();
  const currentSelection = readAiActionSelection(currentActionConfig, scopeId);
  const providerId = normalizeAiProviderId(currentSelection.providerId);
  const requestedModelId = typeof nextModelId === "string" ? nextModelId.trim() : "";
  const providerModelsState =
    currentActionConfig.modelOptionsByProvider[providerId] ?? createAiProviderModelsState();
  const modelId =
    providerModelsState.status === "ready"
      ? pickPreferredAiModelId(providerId, providerModelsState.options, requestedModelId)
      : requestedModelId;
  const modelValidationRequestId = state.aiSettings.modelValidationRequestId + 1;
  const nextSelection = {
    ...currentSelection,
    modelId,
  };

  state.aiSettings = {
    ...state.aiSettings,
    modelValidationRequestId,
    modelErrorModal: createAiModelErrorModalState(),
  };
  replaceAiActionConfig(
    replaceAiActionSelection(currentActionConfig, scopeId, nextSelection),
  );
  persistAiActionPreferences();
  render?.();

  if (!modelId) {
    return;
  }

  try {
    await invoke("probe_ai_provider_model", {
      request: {
        providerId,
        modelId,
      },
    });
  } catch (error) {
    if (state.aiSettings.modelValidationRequestId !== modelValidationRequestId) {
      return;
    }

    openAiModelErrorModal(providerId, normalizeAiProbeErrorMessage(error));
    render?.();
  }
}

export function resolveAiActionProviderAndModel(actionId) {
  const resolvedActionId =
    typeof actionId === "string" && actionId.trim() ? actionId.trim() : "review";
  const selection = resolveEffectiveAiActionSelection(actionConfigState(), resolvedActionId);
  return {
    providerId: normalizeAiProviderId(selection.providerId),
    modelId: typeof selection.modelId === "string" ? selection.modelId.trim() : "",
  };
}

export function resolveAiReviewProviderAndModel() {
  return resolveAiActionProviderAndModel("review");
}

export function openAiMissingKeyModal(providerId) {
  state.aiReviewMissingKeyModal = {
    ...createAiReviewMissingKeyModalState(),
    isOpen: true,
    providerId: normalizeAiProviderId(providerId),
  };
}

export function openAiReviewMissingKeyModal() {
  const { providerId } = resolveAiReviewProviderAndModel();
  openAiMissingKeyModal(providerId);
}

export function closeAiReviewMissingKeyModal() {
  state.aiReviewMissingKeyModal = createAiReviewMissingKeyModalState();
}

export function updateAiSettingsAboutModalDontShowAgain(nextValue) {
  state.aiSettings = {
    ...state.aiSettings,
    aboutModal: {
      ...state.aiSettings.aboutModal,
      dontShowAgain: nextValue === true,
    },
  };
}

export function dismissAiSettingsAboutModal(render) {
  if (state.aiSettings.aboutModal?.dontShowAgain === true) {
    saveStoredAiSettingsAboutDismissed(true);
  }

  state.aiSettings = {
    ...state.aiSettings,
    aboutModal: createAiSettingsAboutModalState(),
  };
  render?.();
}

export function closeAiModelErrorModal() {
  state.aiSettings = {
    ...state.aiSettings,
    modelErrorModal: createAiModelErrorModalState(),
  };
}
