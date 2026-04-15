import {
  AI_PROVIDER_IDS,
  DEFAULT_AI_PROVIDER_ID,
  normalizeAiProviderId,
} from "./ai-provider-config.js";

export const AI_TRANSLATE_ACTION_IDS = ["translate1", "translate2"];
export const AI_ACTION_IDS = [...AI_TRANSLATE_ACTION_IDS, "review", "discuss"];

export const AI_ACTION_LABELS = {
  translate1: "Translate 1",
  translate2: "Translate 2",
  review: "Review",
  discuss: "Discuss",
};
const UNIFIED_TRANSLATE_ACTION_LABEL = "Translate";

const DEFAULT_PROVIDER_ID = DEFAULT_AI_PROVIDER_ID;
const DEFAULT_MODEL_ID_BY_PROVIDER = {
  openai: "gpt-5.4-mini",
};

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseOpenAiModelVersion(modelId, kind) {
  const normalizedModelId =
    typeof modelId === "string" && modelId.trim() ? modelId.trim() : "";
  const match = normalizedModelId.match(/^gpt-(\d+)(?:\.(\d+))?(?:-(pro|mini|nano))?$/);
  if (!match) {
    return null;
  }

  const family = match[3] ?? "general";
  if (family !== kind) {
    return null;
  }

  const major = Number.parseInt(match[1], 10);
  const minor = match[2] === undefined ? -1 : Number.parseInt(match[2], 10);
  if (!Number.isInteger(major) || !Number.isInteger(minor)) {
    return null;
  }

  return { major, minor, family };
}

function parseGeminiModelVersion(modelId) {
  const normalizedModelId =
    typeof modelId === "string" && modelId.trim() ? modelId.trim() : "";
  const match = normalizedModelId.match(
    /^gemini-(\d+)(?:\.(\d+))?-(pro|flash|flash-lite)(?:-preview(?:-(\d{2})-(\d{4}))?)?$/,
  );
  if (!match) {
    return null;
  }

  const major = Number.parseInt(match[1], 10);
  const minor = match[2] === undefined ? 0 : Number.parseInt(match[2], 10);
  const family = match[3];
  const previewRank = match[4] && match[5] ? 2 : normalizedModelId.includes("-preview") ? 1 : 0;
  const previewMonth = match[4] ? Number.parseInt(match[4], 10) : 0;
  const previewYear = match[5] ? Number.parseInt(match[5], 10) : 0;

  if (
    !Number.isInteger(major)
    || !Number.isInteger(minor)
    || !Number.isInteger(previewRank)
    || !Number.isInteger(previewMonth)
    || !Number.isInteger(previewYear)
  ) {
    return null;
  }

  return {
    major,
    minor,
    family,
    previewRank,
    previewYear,
    previewMonth,
  };
}

function compareParsedModelVersions(left, right) {
  if (!left && !right) {
    return 0;
  }
  if (!left) {
    return -1;
  }
  if (!right) {
    return 1;
  }
  if (left.major !== right.major) {
    return left.major - right.major;
  }
  return left.minor - right.minor;
}

function compareParsedGeminiVersions(left, right) {
  if (!left && !right) {
    return 0;
  }
  if (!left) {
    return -1;
  }
  if (!right) {
    return 1;
  }
  if (left.major !== right.major) {
    return left.major - right.major;
  }
  if (left.minor !== right.minor) {
    return left.minor - right.minor;
  }
  if (left.previewRank !== right.previewRank) {
    return left.previewRank - right.previewRank;
  }
  if (left.previewYear !== right.previewYear) {
    return left.previewYear - right.previewYear;
  }
  return left.previewMonth - right.previewMonth;
}

function pickLatestOpenAiModelIdByKind(options, kind) {
  let bestOptionId = "";
  let bestVersion = null;

  for (const option of Array.isArray(options) ? options : []) {
    const optionId = typeof option?.id === "string" ? option.id.trim() : "";
    const parsedVersion = parseOpenAiModelVersion(optionId, kind);
    if (!parsedVersion) {
      continue;
    }
    if (compareParsedModelVersions(parsedVersion, bestVersion) > 0) {
      bestVersion = parsedVersion;
      bestOptionId = optionId;
    }
  }

  return bestOptionId;
}

function pickLatestGeminiModelIdByFamily(options, family) {
  let bestOptionId = "";
  let bestVersion = null;

  for (const option of Array.isArray(options) ? options : []) {
    const optionId = typeof option?.id === "string" ? option.id.trim() : "";
    const parsedVersion = parseGeminiModelVersion(optionId);
    if (!parsedVersion || parsedVersion.family !== family) {
      continue;
    }
    if (compareParsedGeminiVersions(parsedVersion, bestVersion) > 0) {
      bestVersion = parsedVersion;
      bestOptionId = optionId;
    }
  }

  return bestOptionId;
}

export function createAiActionSelection(providerId = DEFAULT_PROVIDER_ID, modelId = "") {
  const normalizedProviderId = normalizeAiProviderId(providerId);
  const normalizedModelId =
    typeof modelId === "string" && modelId.trim()
      ? modelId.trim()
      : DEFAULT_MODEL_ID_BY_PROVIDER[normalizedProviderId] ?? "";

  return {
    providerId: normalizedProviderId,
    modelId: normalizedModelId,
  };
}

export function createAiActionPreferencesState() {
  const defaultSelection = createAiActionSelection();
  return {
    detailedConfiguration: false,
    unified: { ...defaultSelection },
    actions: Object.fromEntries(
      AI_ACTION_IDS.map((actionId) => [actionId, { ...defaultSelection }]),
    ),
  };
}

export function createAiProviderModelsState() {
  return {
    status: "idle",
    error: "",
    options: [],
    hasLoaded: false,
  };
}

export function createAiProviderModelsStateMap() {
  return Object.fromEntries(
    AI_PROVIDER_IDS.map((providerId) => [providerId, createAiProviderModelsState()]),
  );
}

export function createAiActionConfigurationState() {
  return {
    ...createAiActionPreferencesState(),
    availableProvidersStatus: "idle",
    availableProvidersError: "",
    savedProviderIds: [],
    modelOptionsByProvider: createAiProviderModelsStateMap(),
  };
}

export function normalizeAiActionSelection(value, fallback = createAiActionSelection()) {
  if (!isPlainObject(value)) {
    return { ...fallback };
  }

  const providerId = normalizeAiProviderId(value.providerId ?? fallback.providerId);
  const rawModelId =
    typeof value.modelId === "string" && value.modelId.trim()
      ? value.modelId.trim()
      : fallback.modelId;

  return {
    providerId,
    modelId: typeof rawModelId === "string" ? rawModelId.trim() : "",
  };
}

export function normalizeStoredAiActionPreferences(value) {
  const fallback = createAiActionPreferencesState();
  if (!isPlainObject(value)) {
    return fallback;
  }

  const unified = normalizeAiActionSelection(value.unified, fallback.unified);
  const detailedConfiguration = value.detailedConfiguration === true;
  const rawActions = isPlainObject(value.actions) ? value.actions : {};
  const actions = Object.fromEntries(
    AI_ACTION_IDS.map((actionId) => [
      actionId,
      normalizeAiActionSelection(rawActions[actionId], fallback.actions[actionId]),
    ]),
  );

  return {
    detailedConfiguration,
    unified,
    actions,
  };
}

export function extractAiActionPreferences(config) {
  return normalizeStoredAiActionPreferences(config);
}

export function resolveEffectiveAiActionSelection(config, actionId) {
  const normalizedConfig = normalizeStoredAiActionPreferences(config);
  return resolveEffectiveAiActionSelectionForNormalizedConfig(normalizedConfig, actionId);
}

function resolveEffectiveAiActionSelectionForNormalizedConfig(normalizedConfig, actionId) {
  if (!normalizedConfig.detailedConfiguration) {
    return normalizedConfig.unified;
  }

  return normalizedConfig.actions[actionId] ?? normalizedConfig.unified;
}

export function resolveVisibleAiTranslateActions(config) {
  const normalizedConfig = normalizeStoredAiActionPreferences(config);
  const visibleActionIds = normalizedConfig.detailedConfiguration
    ? AI_TRANSLATE_ACTION_IDS
    : [AI_TRANSLATE_ACTION_IDS[0]];

  return visibleActionIds.map((actionId) => ({
    actionId,
    label: normalizedConfig.detailedConfiguration
      ? AI_ACTION_LABELS[actionId] ?? UNIFIED_TRANSLATE_ACTION_LABEL
      : UNIFIED_TRANSLATE_ACTION_LABEL,
    selection: resolveEffectiveAiActionSelectionForNormalizedConfig(normalizedConfig, actionId),
  }));
}

export function selectionUsesSavedProvider(selection, savedProviderIds = []) {
  return savedProviderIds.includes(selection?.providerId);
}

export function coerceSelectionToSavedProviders(selection, savedProviderIds = []) {
  const normalizedSelection = normalizeAiActionSelection(selection);
  if (savedProviderIds.length === 0 || savedProviderIds.includes(normalizedSelection.providerId)) {
    return normalizedSelection;
  }

  return {
    providerId: savedProviderIds[0],
    modelId: "",
  };
}

export function coerceAiActionPreferencesToSavedProviders(config, savedProviderIds = []) {
  const normalizedConfig = normalizeStoredAiActionPreferences(config);
  return {
    ...normalizedConfig,
    unified: coerceSelectionToSavedProviders(normalizedConfig.unified, savedProviderIds),
    actions: Object.fromEntries(
      AI_ACTION_IDS.map((actionId) => [
        actionId,
        coerceSelectionToSavedProviders(normalizedConfig.actions[actionId], savedProviderIds),
      ]),
    ),
  };
}

export function pickPreferredAiModelId(providerId, options = [], fallbackModelId = "") {
  const normalizedFallback =
    typeof fallbackModelId === "string" && fallbackModelId.trim()
      ? fallbackModelId.trim()
      : "";
  const normalizedOptions = Array.isArray(options) ? options : [];

  if (normalizedFallback && normalizedOptions.some((option) => option?.id === normalizedFallback)) {
    return normalizedFallback;
  }

  if (normalizeAiProviderId(providerId) === "openai") {
    const fallbackKind =
      parseOpenAiModelVersion(normalizedFallback, "general")?.family
      ?? parseOpenAiModelVersion(normalizedFallback, "pro")?.family
      ?? parseOpenAiModelVersion(normalizedFallback, "mini")?.family
      ?? parseOpenAiModelVersion(normalizedFallback, "nano")?.family
      ?? "";
    if (fallbackKind) {
      const latestMatchingFamily = pickLatestOpenAiModelIdByKind(
        normalizedOptions,
        fallbackKind,
      );
      if (latestMatchingFamily) {
        return latestMatchingFamily;
      }
    }
  }
  if (normalizeAiProviderId(providerId) === "gemini") {
    const fallbackFamily = parseGeminiModelVersion(normalizedFallback)?.family ?? "";
    if (fallbackFamily) {
      const latestMatchingFamily = pickLatestGeminiModelIdByFamily(
        normalizedOptions,
        fallbackFamily,
      );
      if (latestMatchingFamily) {
        return latestMatchingFamily;
      }
    }
  }

  const defaultModelId = DEFAULT_MODEL_ID_BY_PROVIDER[normalizeAiProviderId(providerId)] ?? "";
  if (defaultModelId && normalizedOptions.some((option) => option?.id === defaultModelId)) {
    return defaultModelId;
  }

  if (normalizeAiProviderId(providerId) === "openai") {
    const latestMiniModelId = pickLatestOpenAiModelIdByKind(normalizedOptions, "mini");
    if (latestMiniModelId) {
      return latestMiniModelId;
    }
  }
  if (normalizeAiProviderId(providerId) === "gemini") {
    const latestFlashModelId = pickLatestGeminiModelIdByFamily(normalizedOptions, "flash");
    if (latestFlashModelId) {
      return latestFlashModelId;
    }
    const latestProModelId = pickLatestGeminiModelIdByFamily(normalizedOptions, "pro");
    if (latestProModelId) {
      return latestProModelId;
    }
    const latestFlashLiteModelId = pickLatestGeminiModelIdByFamily(
      normalizedOptions,
      "flash-lite",
    );
    if (latestFlashLiteModelId) {
      return latestFlashLiteModelId;
    }
  }

  return typeof normalizedOptions[0]?.id === "string" ? normalizedOptions[0].id : "";
}
