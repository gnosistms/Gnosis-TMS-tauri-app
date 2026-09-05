import { invoke } from "./runtime.js";
import { selectedProjectsTeamInstallationId } from "./project-context.js";
import { clearNoticeBadge, getNoticeBadgeText, showNoticeBadge } from "./status-feedback.js";
import { isTransientAiProviderError } from "./editor-ai-batch-pool.js";
import {
  AI_ACTION_IDS,
  coerceAiActionPreferencesToSavedProviders,
  createAiProviderModelsState,
  extractAiActionPreferences,
  isDefaultAiModelIdForProvider,
  isGeminiProModelId,
  normalizeStoredAiActionPreferences,
  pickPreferredAiModelId,
  resolveEffectiveAiActionSelection,
} from "./ai-action-config.js";
import {
  loadStoredTeamAiActionPreferences,
  saveStoredAiActionPreferences,
} from "./ai-action-preferences.js";
import {
  loadStoredAiSettingsAboutDismissed,
  saveStoredAiSettingsAboutDismissed,
} from "./ai-settings-preferences.js";
import {
  AI_PROVIDER_IDS,
  getAiProviderActionLabel,
  getAiProviderConfig,
  getAiProviderSavedMessage,
  normalizeAiProviderId,
} from "./ai-provider-config.js";
import {
  formatAiProviderActionError,
  isOpenAiNoCreditsError,
} from "./ai-provider-error.js";
import {
  ensureSelectedTeamAiProviderReady,
  loadSelectedTeamAiSavedProviderIds,
  loadSelectedTeamAiState,
  persistSelectedTeamAiActionPreferences,
  saveSelectedTeamAiProviderSecret,
  selectedTeamAiAllowsEditing,
} from "./team-ai-flow.js";
import {
  createAiSettingsAboutModalState,
  createAiModelErrorModalState,
  createAiReviewMissingKeyModalState,
  createTeamAiSharedState,
  state,
} from "./state.js";

let settingsPageRequestId = 0;
let providerSecretRequestId = 0;
let providerSecretSaveRequestId = 0;
let providerSecretDraftRevision = 0;
let actionPreferencesRevision = 0;

function actionConfigState() {
  return state.aiSettings.actionConfig;
}

function teamSharedState() {
  return state.aiSettings.teamShared;
}

function selectedAiInstallationId() {
  return selectedProjectsTeamInstallationId();
}

function captureAiSettingsScope() {
  return {
    screen: state.screen,
    teamId: state.selectedTeamId,
    installationId: selectedAiInstallationId(),
    sessionToken: state.auth.session?.sessionToken,
  };
}

function isAiSettingsScopeCurrent(scope) {
  return (
    state.screen === scope.screen
    && state.selectedTeamId === scope.teamId
    && selectedAiInstallationId() === scope.installationId
    && state.auth.session?.sessionToken === scope.sessionToken
  );
}

function isAiSettingsProviderScopeCurrent(scope, providerId) {
  return (
    isAiSettingsScopeCurrent(scope)
    && normalizeAiProviderId(state.aiSettings.providerId) === normalizeAiProviderId(providerId)
  );
}

function maybeInstallationPayload() {
  const installationId = selectedAiInstallationId();
  return installationId === null ? {} : { installationId };
}

function withSelectedInstallation(request = {}) {
  const installationId = selectedAiInstallationId();
  return installationId === null ? request : { ...request, installationId };
}

function persistAiActionPreferences() {
  saveStoredAiActionPreferences(extractAiActionPreferences(actionConfigState()));
}

function resetAiActionConfigTransientState(currentActionConfig, options = {}) {
  return {
    ...currentActionConfig,
    availableProvidersStatus: "idle",
    availableProvidersError: "",
    savedProviderIds: options.clearSavedProviders === true ? [] : currentActionConfig.savedProviderIds,
    modelOptionsByProvider: Object.fromEntries(
      AI_PROVIDER_IDS.map((providerId) => [providerId, createAiProviderModelsState()]),
    ),
  };
}

function persistSharedAiActionPreferences(render) {
  actionPreferencesRevision += 1;
  void persistSelectedTeamAiActionPreferences(
    render,
    extractAiActionPreferences(actionConfigState()),
  );
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
    modelValidationStatus: "idle",
    modelValidationProviderId: "",
    modelErrorModal: createAiModelErrorModalState(),
  };
}

function normalizeAiActionMenuLoadingProviderIds(providerIds) {
  const normalizedProviderIds = [];
  for (const providerId of Array.isArray(providerIds) ? providerIds : []) {
    const normalizedProviderId = normalizeAiProviderId(providerId);
    if (!normalizedProviderIds.includes(normalizedProviderId)) {
      normalizedProviderIds.push(normalizedProviderId);
    }
  }
  return normalizedProviderIds;
}

function updateAiActionMenuLoadingProviderIds(providerId, isLoading) {
  const normalizedProviderId = normalizeAiProviderId(providerId);
  const currentProviderIds = normalizeAiActionMenuLoadingProviderIds(
    state.aiSettings.actionMenuLoadingProviderIds,
  );
  const nextProviderIds = isLoading
    ? currentProviderIds.includes(normalizedProviderId)
      ? currentProviderIds
      : [...currentProviderIds, normalizedProviderId]
    : currentProviderIds.filter((currentProviderId) => currentProviderId !== normalizedProviderId);

  if (
    nextProviderIds.length === currentProviderIds.length
    && nextProviderIds.every((currentProviderId, index) => currentProviderId === currentProviderIds[index])
  ) {
    return;
  }

  state.aiSettings = {
    ...state.aiSettings,
    actionMenuLoadingProviderIds: nextProviderIds,
  };
}

export function aiActionControlsAreBusy(aiSettings = state.aiSettings) {
  const actionConfig = aiSettings?.actionConfig ?? actionConfigState();
  return (
    aiSettings?.teamShared?.status === "loading"
    || aiSettings?.teamShared?.settingsSaveStatus === "saving"
    || actionConfig.availableProvidersStatus === "loading"
    || aiSettings?.modelValidationStatus === "loading"
    || normalizeAiActionMenuLoadingProviderIds(aiSettings?.actionMenuLoadingProviderIds).length > 0
  );
}

export function getAiActionControlsBusyMessage(aiSettings = state.aiSettings) {
  if (aiSettings?.teamShared?.status === "loading") {
    return "Loading team AI settings...";
  }

  if (aiSettings?.teamShared?.settingsSaveStatus === "saving") {
    return "Saving team AI settings...";
  }

  if (aiSettings?.modelValidationStatus === "loading") {
    return `Checking the selected ${getAiProviderActionLabel(aiSettings.modelValidationProviderId)} model...`;
  }

  const loadingProviderIds = normalizeAiActionMenuLoadingProviderIds(
    aiSettings?.actionMenuLoadingProviderIds,
  );
  if (loadingProviderIds.length === 1) {
    return `Loading ${getAiProviderActionLabel(loadingProviderIds[0])} models...`;
  }
  if (loadingProviderIds.length > 1) {
    return "Loading AI models...";
  }

  if (aiSettings?.actionConfig?.availableProvidersStatus === "loading") {
    return "Loading saved AI providers...";
  }

  if (Object.values(aiSettings?.actionConfig?.modelOptionsByProvider ?? {})
    .some((models) => models.isRefreshing)) {
    return "Refreshing AI models...";
  }

  return "";
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

function applyAiActionPreferences(nextPreferences) {
  const normalizedPreferences = normalizeStoredAiActionPreferences(nextPreferences);
  replaceAiActionConfig({
    ...actionConfigState(),
    ...normalizedPreferences,
  });
}

function normalizeAiActionPreferencesSnapshot(value) {
  return JSON.stringify(normalizeStoredAiActionPreferences(value));
}

function applyAiActionPreferencesWithOptionalRender(nextPreferences, render, options = {}) {
  const normalizedPreferences = normalizeStoredAiActionPreferences(nextPreferences);
  const changed =
    normalizeAiActionPreferencesSnapshot(actionConfigState())
    !== normalizeAiActionPreferencesSnapshot(normalizedPreferences);
  if (changed) {
    applyAiActionPreferences(normalizedPreferences);
  }
  if (options.persist !== false) {
    persistAiActionPreferences();
  }
  if (changed) {
    render?.();
  }
  return changed;
}

export function applyStoredSelectedTeamAiActionPreferences(render) {
  const installationId = selectedAiInstallationId();
  if (installationId === null) {
    return false;
  }

  const storedPreferences = loadStoredTeamAiActionPreferences(undefined, installationId);
  const hasStoredActionPreferences =
    normalizeAiActionPreferencesSnapshot(storedPreferences)
    !== normalizeAiActionPreferencesSnapshot(null);
  if (!hasStoredActionPreferences) {
    return false;
  }

  applyAiActionPreferencesWithOptionalRender(storedPreferences, render, {
    persist: false,
  });
  return true;
}

function persistSharedAiActionPreferencesIfNeeded(render, actionConfig = actionConfigState()) {
  if (!selectedTeamAiAllowsEditing()) {
    return;
  }

  const nextActionPreferences = extractAiActionPreferences(actionConfig);
  const currentSharedActionPreferences = teamSharedState()?.settings?.actionPreferences ?? null;
  if (
    currentSharedActionPreferences
    && (
      normalizeAiActionPreferencesSnapshot(currentSharedActionPreferences)
      === normalizeAiActionPreferencesSnapshot(nextActionPreferences)
    )
  ) {
    return;
  }

  void persistSelectedTeamAiActionPreferences(render, nextActionPreferences);
}

function getAiKeyWorkingBadgeText(providerId) {
  return `This ${getAiProviderConfig(providerId).label} key is working`;
}

function getAiKeyNotWorkingBadgeText(providerId) {
  return `This ${getAiProviderConfig(providerId).label} key is not working`;
}

const AI_KEY_CHECKING_BADGE_TEXT = "Checking key...";

function getAiKeyCheckUnreachableBadgeText(providerId) {
  return `Couldn't reach ${getAiProviderConfig(providerId).label} to check this key — try again later`;
}

// The "Checking key..." badge is persistent (no auto-hide), so every exit
// path between showing it and showing a result badge must clear it. Guarded
// by text so a badge shown later by another flow is left alone.
function clearAiKeyCheckingBadge(render) {
  if (getNoticeBadgeText() !== AI_KEY_CHECKING_BADGE_TEXT) {
    return;
  }
  clearNoticeBadge();
  render?.({ scope: "status-surface" });
}

function missingTeamAiProviderMessage(providerId, reason, teamName = "") {
  const label = getAiProviderActionLabel(providerId);
  if (reason === "member_missing") {
    const teamLabel = teamName ? ` for ${teamName}` : "";
    return `Ask the team owner to configure a shared ${label} key${teamLabel} before using this AI action.`;
  }

  return `No ${label} API key is saved yet. Open the AI Settings page and save one first.`;
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
  if (isOpenAiNoCreditsError(normalizedProviderId, errorMessage)) {
    return "Add credits at https://platform.openai.com/settings/organization/billing/ and try again.";
  }
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
  const normalizedProviderId = normalizeAiProviderId(providerId);
  const noCredits = isOpenAiNoCreditsError(normalizedProviderId, bannerMessage);
  const displayBanner = noCredits
    ? ""
    : formatAiProviderActionError(normalizedProviderId, bannerMessage);
  state.aiSettings = {
    ...state.aiSettings,
    modelErrorModal: {
      ...createAiModelErrorModalState(),
      isOpen: true,
      eyebrow: noCredits ? "OPENAI BILLING" : "AI MODEL ERROR",
      title: noCredits
        ? "Your OpenAI account has run out of credits."
        : "The AI model you selected is not working",
      banner: displayBanner,
      message: explainAiModelProbeError(normalizedProviderId, bannerMessage),
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

function normalizeAiModelOptions(providerId, options) {
  const seenIds = new Set();
  const normalizedOptions = [];
  const normalizedProviderId = normalizeAiProviderId(providerId);

  for (const option of Array.isArray(options) ? options : []) {
    const id = typeof option?.id === "string" ? option.id.trim() : "";
    if (!id || seenIds.has(id)) {
      continue;
    }
    if (normalizedProviderId === "gemini" && isGeminiProModelId(id)) {
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
  const syncSelection = (selection) => {
    if (selection.providerId !== providerId) {
      return selection;
    }
    if (providerId === "openai" && selection.modelId) {
      if (options.some((option) => option?.id === selection.modelId)) {
        return selection;
      }
      // A chosen model that fell out of the recommended list stays selected —
      // model selections never upgrade automatically. Only the never-configured
      // default sentinel repicks from the current list.
      if (!isDefaultAiModelIdForProvider(providerId, selection.modelId)) {
        return selection;
      }
      return {
        ...selection,
        modelId: pickPreferredAiModelId(providerId, options),
      };
    }
    return {
      ...selection,
      modelId: pickPreferredAiModelId(providerId, options, selection.modelId),
    };
  };

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
  const scope = captureAiSettingsScope();
  let actionConfig = actionConfigState();

  if (!actionConfig.savedProviderIds.includes(normalizedProviderId)) {
    updateAiActionMenuLoadingProviderIds(normalizedProviderId, false);
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
    updateAiActionMenuLoadingProviderIds(normalizedProviderId, false);
    return currentModelsState.options;
  }
  if (currentModelsState.status === "loading" || currentModelsState.isRefreshing) {
    return currentModelsState.options;
  }

  const hasCachedModels = currentModelsState.options.length > 0;
  const preferencesRevision = actionPreferencesRevision;
  updateAiActionMenuLoadingProviderIds(normalizedProviderId, !hasCachedModels);
  const pendingModelsState = {
    ...currentModelsState,
    status: hasCachedModels ? "ready" : "loading",
    isRefreshing: true,
    error: "",
  };
  const requestIsCurrent = () => isAiSettingsScopeCurrent(scope)
    && actionConfigState().modelOptionsByProvider[normalizedProviderId] === pendingModelsState;
  actionConfig = {
    ...actionConfig,
    modelOptionsByProvider: {
      ...actionConfig.modelOptionsByProvider,
      [normalizedProviderId]: pendingModelsState,
    },
  };
  replaceAiActionConfig(actionConfig);
  render?.();

  try {
    const ensureProviderResult = await ensureSelectedTeamAiProviderReady(render, normalizedProviderId);
    if (!requestIsCurrent()) {
      return [];
    }
    if (!ensureProviderResult?.ok) {
      if (ensureProviderResult?.reason === "stale" || !isAiSettingsScopeCurrent(scope)) {
        return [];
      }
      replaceAiActionConfig({
        ...actionConfigState(),
        modelOptionsByProvider: {
          ...actionConfigState().modelOptionsByProvider,
          [normalizedProviderId]: {
            status: "error",
            error: missingTeamAiProviderMessage(
              normalizedProviderId,
              ensureProviderResult?.reason,
              ensureProviderResult?.teamName,
            ),
            options: [],
            hasLoaded: true,
          },
        },
      });
      render?.();
      return [];
    }

    const optionsPayload = await invoke("list_ai_provider_models", {
      providerId: normalizedProviderId,
      ...maybeInstallationPayload(),
    });
    const normalizedOptions = normalizeAiModelOptions(normalizedProviderId, optionsPayload);
    if (!requestIsCurrent()) {
      return [];
    }

    let nextActionConfig = actionConfigState();
    if (preferencesRevision === actionPreferencesRevision) {
      nextActionConfig = syncAiActionModelSelectionsForProvider(
        nextActionConfig,
        normalizedProviderId,
        normalizedOptions,
      );
    }
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
    if (options.persistPreferences !== false) {
      persistSharedAiActionPreferencesIfNeeded(render, nextActionConfig);
    }
    render?.();
    return normalizedOptions;
  } catch (error) {
    if (!requestIsCurrent()) {
      return [];
    }
    replaceAiActionConfig({
      ...actionConfigState(),
      modelOptionsByProvider: {
        ...actionConfigState().modelOptionsByProvider,
        [normalizedProviderId]: {
          status: hasCachedModels ? "ready" : "error",
          error: error instanceof Error ? error.message : String(error),
          options: currentModelsState.options,
          hasLoaded: true,
        },
      },
    });
    render?.();
    return [];
  } finally {
    const latestModelsState = actionConfigState().modelOptionsByProvider[normalizedProviderId];
    // Navigation can make the response stale without replacing this cache.
    // Release its loading marker so returning to the page can try again.
    if (latestModelsState === pendingModelsState) {
      replaceAiActionConfig({
        ...actionConfigState(),
        modelOptionsByProvider: {
          ...actionConfigState().modelOptionsByProvider,
          [normalizedProviderId]: { ...currentModelsState, isRefreshing: false },
        },
      });
    }
    if (latestModelsState === pendingModelsState
      || (isAiSettingsScopeCurrent(scope) && !latestModelsState?.isRefreshing)) {
      updateAiActionMenuLoadingProviderIds(normalizedProviderId, false);
      render?.();
    }
  }
}

async function ensureVisibleAiProviderModelsLoaded(render, options = {}) {
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
    [...visibleProviderIds].map((providerId) => ensureAiProviderModelsLoaded(render, providerId, options)),
  );
}

export async function refreshAiSavedProviders(render, options = {}) {
  const scope = captureAiSettingsScope();
  let actionConfig = actionConfigState();
  if (!options.suppressLoadingState && actionConfig.availableProvidersStatus !== "ready") {
    actionConfig = {
      ...actionConfig,
      availableProvidersStatus: "loading",
      availableProvidersError: "",
    };
    replaceAiActionConfig(actionConfig);
    render?.();
  }

  try {
    const savedProviderIds = selectedAiInstallationId() !== null && state.auth.session?.sessionToken
      ? await loadSelectedTeamAiSavedProviderIds(render, {
          suppressLoadingState: true,
          force: options.forceTeamState === true,
          cacheOnly: options.cacheOnly === true,
        })
      : (
        await Promise.all(
          AI_PROVIDER_IDS.map(async (providerId) => {
            const apiKey = await invoke("load_ai_provider_secret", {
              providerId,
              ...maybeInstallationPayload(),
            });
            return typeof apiKey === "string" && apiKey.trim() ? providerId : null;
          }),
        )
      ).filter(Boolean);

    let nextActionConfig = coerceActionConfigToSavedProviders(
      actionConfigState(),
      savedProviderIds,
    );
    if (!isAiSettingsScopeCurrent(scope)) {
      return;
    }
    nextActionConfig = {
      ...nextActionConfig,
      availableProvidersStatus: "ready",
      availableProvidersError: "",
      savedProviderIds,
    };
    replaceAiActionConfig(nextActionConfig);
    persistAiActionPreferences();
    if (options.persistPreferences !== false) {
      persistSharedAiActionPreferencesIfNeeded(render, nextActionConfig);
    }
    render?.();
    if (!options.skipModels) {
      await ensureVisibleAiProviderModelsLoaded(render, options);
    }
  } catch (error) {
    if (!isAiSettingsScopeCurrent(scope)) {
      return;
    }
    replaceAiActionConfig({
      ...actionConfigState(),
      availableProvidersStatus: actionConfigState().savedProviderIds.length > 0 ? "ready" : "error",
      availableProvidersError: error instanceof Error ? error.message : String(error),
    });
    render?.();
  }
}

export async function ensureSharedAiActionConfigurationLoaded(render) {
  const scope = captureAiSettingsScope();
  if (selectedAiInstallationId() === null || !state.auth.session?.sessionToken) {
    return;
  }

  applyStoredSelectedTeamAiActionPreferences(render);
  const teamShared = await loadSelectedTeamAiState(render, {
    suppressLoadingState: true,
    cacheOnly: true,
  });
  if (!teamShared || !isAiSettingsScopeCurrent(scope)) {
    return;
  }
  const sharedActionPreferences = teamShared?.settings?.actionPreferences ?? null;
  if (sharedActionPreferences) {
    applyAiActionPreferencesWithOptionalRender(sharedActionPreferences, render);
    return;
  }

}

export async function loadAiSettingsPage(render, options = {}) {
  const scope = captureAiSettingsScope();
  const requestId = ++settingsPageRequestId;
  const requestIsCurrent = () => requestId === settingsPageRequestId && isAiSettingsScopeCurrent(scope);
  state.aiSettings = {
    ...state.aiSettings,
    aboutModal: createAiSettingsAboutModalStateForDisplay(),
  };
  const providerId = normalizeAiProviderId(options.providerId ?? state.aiSettings.providerId);
  applyStoredSelectedTeamAiActionPreferences(render);
  const keyLoad = loadAiProviderSecret(render, { providerId });
  const sharedTeamMode = selectedAiInstallationId() !== null && state.auth.session?.sessionToken;
  if (sharedTeamMode) {
    await ensureSharedAiActionConfigurationLoaded(render);
  }
  if (!requestIsCurrent()) {
    await keyLoad;
    return;
  }
  // Read local provider presence before issuing network requests. Discovery here
  // must not publish potentially stale cached action preferences back to the team.
  await refreshAiSavedProviders(render, {
    cacheOnly: true,
    skipModels: true,
    persistPreferences: false,
  });
  if (!requestIsCurrent()) {
    await keyLoad;
    return;
  }
  const preferencesRevision = actionPreferencesRevision;
  const modelLoad = ensureVisibleAiProviderModelsLoaded(render, {
    force: true,
    persistPreferences: false,
  });
  if (sharedTeamMode) {
    try {
      const teamShared = await loadSelectedTeamAiState(render, {
        force: true,
        suppressLoadingState: true,
      });
      if (!teamShared || !requestIsCurrent()) {
        await Promise.all([keyLoad, modelLoad]);
        return;
      }
      if (
        actionPreferencesRevision === preferencesRevision
        && teamShared?.settings?.actionPreferences
      ) {
        applyAiActionPreferencesWithOptionalRender(
          teamShared.settings.actionPreferences,
          render,
        );
      }
      await refreshAiSavedProviders(render, {
        suppressLoadingState: true,
        cacheOnly: true,
        persistPreferences: false,
      });
    } catch {
      // Leave the existing page state in place so the screen can render the broker error inline.
    }
  }
  await Promise.all([keyLoad, modelLoad]);
}

export function openAiKeyPage(render, options = {}) {
  const returnScreen =
    typeof options.returnScreen === "string" && options.returnScreen && options.returnScreen !== "aiKey"
      ? options.returnScreen
      : state.screen === "aiKey"
        ? state.aiSettings.returnScreen
        : state.screen;
  const providerId = normalizeAiProviderId(options.providerId ?? state.aiSettings.providerId);
  const switchingTeams =
    state.aiSettings.teamShared?.teamId !== null
    && state.aiSettings.teamShared.teamId !== state.selectedTeamId;

  state.aiSettings = {
    ...state.aiSettings,
    providerId,
    returnScreen,
    error: "",
    successMessage: "",
    modelValidationRequestId: state.aiSettings.modelValidationRequestId + 1,
    aboutModal: createAiSettingsAboutModalStateForDisplay(),
    modelErrorModal: createAiModelErrorModalState(),
    ...(switchingTeams
      ? {
          status: "idle",
          apiKey: "",
          apiKeyIsSaved: false,
          hasLoaded: false,
          teamShared: createTeamAiSharedState(),
          actionMenuLoadingProviderIds: [],
          actionConfig: resetAiActionConfigTransientState(state.aiSettings.actionConfig, {
            clearSavedProviders: true,
          }),
        }
      : {}),
  };
  state.aiReviewMissingKeyModal = createAiReviewMissingKeyModalState();
  state.screen = "aiKey";
  render?.();
  void loadAiSettingsPage(render, { providerId });
}

export async function loadAiProviderSecret(render, options = {}) {
  const providerId = normalizeAiProviderId(options.providerId ?? state.aiSettings.providerId);
  const shouldClearDraft = providerId !== state.aiSettings.providerId;
  const scope = captureAiSettingsScope();
  const requestId = ++providerSecretRequestId;
  const draftRevision = providerSecretDraftRevision;
  const hasCachedKey = !shouldClearDraft && state.aiSettings.hasLoaded;
  const preserveDraft = !shouldClearDraft
    && !state.aiSettings.apiKeyIsSaved
    && Boolean(state.aiSettings.apiKey);
  const requestIsCurrent = () => requestId === providerSecretRequestId
    && isAiSettingsProviderScopeCurrent(scope, providerId);

  state.aiSettings = {
    ...state.aiSettings,
    status: state.aiSettings.status === "saving" ? "saving" : hasCachedKey ? "ready" : "loading",
    error: "",
    successMessage: "",
    providerId,
    apiKey: shouldClearDraft ? "" : state.aiSettings.apiKey,
    apiKeyIsSaved: shouldClearDraft ? false : state.aiSettings.apiKeyIsSaved,
    modelValidationRequestId: state.aiSettings.modelValidationRequestId + 1,
    modelErrorModal: createAiModelErrorModalState(),
  };
  render?.();

  try {
    const apiKey = await invoke("load_ai_provider_secret", {
      providerId,
      ...maybeInstallationPayload(),
    });
    if (!requestIsCurrent()) {
      return;
    }
    state.aiSettings = {
      ...state.aiSettings,
      status: state.aiSettings.status === "saving" ? "saving" : "ready",
      error: "",
      successMessage: "",
      providerId,
      // Only unsaved drafts belong in the UI. Never retain a loaded secret in
      // settings state or put it in the password input's DOM value.
      apiKey: preserveDraft || providerSecretDraftRevision !== draftRevision
        ? state.aiSettings.apiKey
        : "",
      apiKeyIsSaved: preserveDraft || providerSecretDraftRevision !== draftRevision
        ? state.aiSettings.apiKeyIsSaved
        : typeof apiKey === "string" && Boolean(apiKey.trim()),
      hasLoaded: true,
    };
  } catch (error) {
    if (!requestIsCurrent()) {
      return;
    }
    if (state.aiSettings.status === "saving") return;
    state.aiSettings = {
      ...state.aiSettings,
      status: hasCachedKey ? "ready" : "error",
      error: error instanceof Error ? error.message : String(error),
      successMessage: "",
      providerId,
      hasLoaded: true,
    };
  }

  render?.();
}

export function updateAiProviderSecretDraft(nextValue) {
  providerSecretDraftRevision += 1;
  state.aiSettings = {
    ...state.aiSettings,
    apiKey: typeof nextValue === "string" ? nextValue : "",
    apiKeyIsSaved: false,
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
  if (state.aiSettings.apiKeyIsSaved || !state.aiSettings.apiKey?.trim()) return;
  return persistAiProviderSecret(render, false);
}

export async function removeAiProviderSecret(render) {
  if (!state.aiSettings.apiKeyIsSaved) return;
  return persistAiProviderSecret(render, true);
}

async function persistAiProviderSecret(render, remove) {
  if (state.aiSettings.status === "saving") return;
  providerSecretRequestId += 1;
  const saveRequestId = ++providerSecretSaveRequestId;
  const providerId = normalizeAiProviderId(state.aiSettings.providerId);
  const apiKey = remove ? "" : state.aiSettings.apiKey;
  const scope = captureAiSettingsScope();
  const draftRevision = providerSecretDraftRevision;
  const preferencesRevision = actionPreferencesRevision;
  // A save belongs to this credential and draft, not to the visible screen.
  const saveIsCurrent = () => isAiSettingsProviderScopeCurrent(
    { ...scope, screen: state.screen }, providerId,
  ) && providerSecretDraftRevision === draftRevision
    && providerSecretSaveRequestId === saveRequestId;
  const successMessage = remove
    ? `${getAiProviderActionLabel(providerId)} key removed.`
    : getAiProviderSavedMessage(providerId);
  let checking = !remove;

  clearNoticeBadge();
  state.aiSettings = {
    ...state.aiSettings,
    status: "saving",
    error: "",
    successMessage: "",
    modelValidationRequestId: state.aiSettings.modelValidationRequestId + 1,
    modelErrorModal: createAiModelErrorModalState(),
  };
  render?.();

  try {
    let verifiedModels = [];
    if (!remove) {
      showNoticeBadge(AI_KEY_CHECKING_BADGE_TEXT, render, null);
      // This request checks the candidate directly; model-cache state and the
      // stored team credential cannot satisfy or recover its authentication.
      const models = await invoke("validate_ai_provider_secret", {
        providerId,
        apiKey: apiKey.trim(),
      });
      if (!saveIsCurrent()) return;
      verifiedModels = normalizeAiModelOptions(providerId, models);
      checking = false;
    }

    if (scope.installationId !== null && scope.sessionToken) {
      await saveSelectedTeamAiProviderSecret(render, providerId, apiKey);
    } else {
      await invoke(remove ? "clear_ai_provider_secret" : "save_ai_provider_secret", {
        providerId,
        ...(remove ? {} : { apiKey }),
        ...(scope.installationId === null ? {} : { installationId: scope.installationId }),
      });
    }
    if (!saveIsCurrent()) return;
    providerSecretRequestId += 1;

    // Finalize before any refresh and even when the user has left Settings.
    // A failed removal never reaches this point, so its saved state is retained.
    state.aiSettings = {
      ...state.aiSettings,
      status: "ready",
      error: "",
      successMessage,
      apiKey: "",
      apiKeyIsSaved: !remove,
      hasLoaded: true,
    };
    invalidateAiProviderModels(providerId);
    if (!remove) {
      let nextActionConfig = coerceActionConfigToSavedProviders(actionConfigState(), [
        ...new Set([...actionConfigState().savedProviderIds, providerId]),
      ]);
      if (preferencesRevision === actionPreferencesRevision) {
        nextActionConfig = syncAiActionModelSelectionsForProvider(
          nextActionConfig, providerId, verifiedModels,
        );
      }
      replaceAiActionConfig({
        ...nextActionConfig,
        modelOptionsByProvider: {
          ...nextActionConfig.modelOptionsByProvider,
          [providerId]: { status: "ready", error: "", options: verifiedModels, hasLoaded: true },
        },
      });
      persistAiActionPreferences();
    }
    if (!isAiSettingsProviderScopeCurrent(scope, providerId)) return;
    showNoticeBadge(remove ? successMessage : getAiKeyWorkingBadgeText(providerId), render);

    await refreshAiSavedProviders(render, {
      suppressLoadingState: true,
      forceTeamState: true,
      skipModels: !remove,
    });
    if (!saveIsCurrent() || !isAiSettingsProviderScopeCurrent(scope, providerId)) return;

    const shouldReturnToTranslate =
      state.aiSettings.returnScreen === "translate" && Boolean(state.selectedChapterId);
    if (shouldReturnToTranslate) {
      state.aiReviewMissingKeyModal = createAiReviewMissingKeyModalState();
      const { openTranslateChapter } = await import("./translate-open-chapter-flow.js");
      await openTranslateChapter(render, state.selectedChapterId);
      return;
    }
  } catch (error) {
    if (!saveIsCurrent()) return;
    providerSecretRequestId += 1;
    state.aiSettings = {
      ...state.aiSettings,
      status: "error",
      error: error instanceof Error ? error.message : String(error),
      successMessage: "",
      hasLoaded: true,
    };
    if (checking && isAiSettingsProviderScopeCurrent(scope, providerId)) {
      showNoticeBadge(
        isTransientAiProviderError(error)
          ? getAiKeyCheckUnreachableBadgeText(providerId)
          : getAiKeyNotWorkingBadgeText(providerId),
        render,
      );
    }
  } finally {
    if (providerSecretSaveRequestId === saveRequestId) clearAiKeyCheckingBadge(render);
    render?.();
  }
}

export function updateAiActionDetailedConfiguration(render, nextValue) {
  if (aiActionControlsAreBusy()) {
    return;
  }
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
  persistSharedAiActionPreferences(render);
  render?.();
  void ensureVisibleAiProviderModelsLoaded(render);
}

export function updateAiActionProvider(render, scopeId, nextProviderId) {
  if (aiActionControlsAreBusy()) {
    return;
  }
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
  persistSharedAiActionPreferences(render);
  render?.();
  void ensureAiProviderModelsLoaded(render, providerId);
}

export async function updateAiActionModel(render, scopeId, nextModelId) {
  if (aiActionControlsAreBusy()) {
    return;
  }
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
    modelValidationStatus: modelId ? "loading" : "idle",
    modelValidationProviderId: modelId ? providerId : "",
    modelErrorModal: createAiModelErrorModalState(),
  };
  replaceAiActionConfig(
    replaceAiActionSelection(currentActionConfig, scopeId, nextSelection),
  );
  persistAiActionPreferences();
  persistSharedAiActionPreferences(render);
  render?.();

  if (!modelId) {
    return;
  }

  try {
    await invoke("probe_ai_provider_model", {
      request: withSelectedInstallation({
        providerId,
        modelId,
      }),
    });
  } catch (error) {
    if (state.aiSettings.modelValidationRequestId !== modelValidationRequestId) {
      return;
    }

    openAiModelErrorModal(providerId, normalizeAiProbeErrorMessage(error));
    render?.();
  } finally {
    if (state.aiSettings.modelValidationRequestId !== modelValidationRequestId) {
      return;
    }

    state.aiSettings = {
      ...state.aiSettings,
      modelValidationStatus: "idle",
      modelValidationProviderId: "",
    };
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
  const isOwner = selectedAiInstallationId() === null || selectedTeamAiAllowsEditing();
  const teamName = state.teams.find((team) => team.id === state.selectedTeamId)?.name ?? "";
  state.aiReviewMissingKeyModal = {
    ...createAiReviewMissingKeyModalState(),
    isOpen: true,
    providerId: normalizeAiProviderId(providerId),
    reason: isOwner ? "owner_missing" : "member_missing",
    teamName,
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
