import { AI_PROVIDER_IDS, normalizeAiProviderId } from "./ai-provider-config.js";
import { normalizeStoredAiActionPreferences } from "./ai-action-config.js";
import { requireBrokerSession } from "./auth-flow.js";
import { invoke } from "./runtime.js";
import { state } from "./state.js";
import { classifySyncError } from "./sync-error.js";
import { saveStoredAiActionPreferences } from "./ai-action-preferences.js";
import { isReadOnlyViewerTeam } from "./resource-capabilities.js";
import {
  clearStoredTeamAiSnapshot,
  loadStoredTeamAiSnapshot,
  saveStoredTeamAiSnapshot,
} from "./team-ai-storage.js";

import {
  decryptTeamAiWrappedKey,
  encryptTeamAiPlaintext,
  generateTeamAiMemberKeypair,
} from "./team-ai-crypto.js";

const brokerPublicKeyCache = new Map();
const metadataRevisionReconciliations = new Map();
const providerSecretIssuances = new Map();

function normalizeOptionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizePositiveInteger(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function selectedTeam() {
  return state.teams.find((team) => team.id === state.selectedTeamId) ?? null;
}

function sameTeamAiContext(left, right) {
  return (
    left?.team?.id === right?.team?.id
    && left?.installationId === right?.installationId
    && left?.orgLogin === right?.orgLogin
    && left?.sessionToken === right?.sessionToken
    && left?.login === right?.login
  );
}

export function createEmptyTeamAiSecretsMetadata() {
  return {
    schemaVersion: 1,
    updatedAt: null,
    updatedBy: null,
    providers: Object.fromEntries(AI_PROVIDER_IDS.map((providerId) => [providerId, null])),
  };
}

export function createTeamAiSharedState() {
  return {
    teamId: null,
    status: "idle",
    error: "",
    isOwner: false,
    settings: null,
    secrets: createEmptyTeamAiSecretsMetadata(),
    settingsSaveStatus: "idle",
    settingsSaveError: "",
    lastInspectedTeamMetadataHeadOid: null,
  };
}

function normalizeTeamAiSettingsRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return {
    schemaVersion: normalizePositiveInteger(value.schemaVersion) ?? 1,
    updatedAt: normalizeOptionalString(value.updatedAt),
    updatedBy: normalizeOptionalString(value.updatedBy),
    actionPreferences: normalizeStoredAiActionPreferences(value.actionPreferences ?? null),
  };
}

function normalizeTeamAiProviderSecretMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const keyVersion = normalizePositiveInteger(value.keyVersion);
  const algorithm = normalizeOptionalString(value.algorithm);
  if (value.configured !== true || keyVersion === null || !algorithm) {
    return null;
  }

  return {
    configured: true,
    keyVersion,
    algorithm,
  };
}

function normalizeTeamAiSecretsMetadata(value) {
  const providers = value && typeof value === "object" && !Array.isArray(value)
    ? value.providers
    : null;

  return {
    schemaVersion: normalizePositiveInteger(value?.schemaVersion) ?? 1,
    updatedAt: normalizeOptionalString(value?.updatedAt),
    updatedBy: normalizeOptionalString(value?.updatedBy),
    providers: Object.fromEntries(
      AI_PROVIDER_IDS.map((providerId) => [
        providerId,
        normalizeTeamAiProviderSecretMetadata(providers?.[providerId]),
      ]),
    ),
  };
}

function normalizeTeamAiProviderCache(value) {
  return {
    apiKey: normalizeOptionalString(value?.apiKey),
    keyVersion: normalizePositiveInteger(value?.keyVersion),
  };
}

function localInstallationPayload() {
  const installationId = selectedTeam()?.installationId;
  return Number.isFinite(installationId) ? { installationId } : {};
}

export function selectedTeamAiContext() {
  const team = selectedTeam();
  if (
    !team
    || !Number.isFinite(team.installationId)
    || !normalizeOptionalString(team.githubOrg)
    || !state.auth.session?.sessionToken
  ) {
    return null;
  }

  return {
    team,
    installationId: team.installationId,
    orgLogin: team.githubOrg,
    login: state.auth.session.login,
    sessionToken: requireBrokerSession(),
    isOwner: team.canDelete === true,
  };
}

function isTeamAiContextCurrent(context) {
  return sameTeamAiContext(context, selectedTeamAiContext());
}

export function selectedTeamAiAllowsEditing() {
  return selectedTeamAiContext()?.isOwner === true;
}

export function currentTeamAiSharedState() {
  return state.aiSettings.teamShared ?? createTeamAiSharedState();
}

export function configuredSharedTeamAiProviderIds(teamShared = currentTeamAiSharedState()) {
  const normalizedSecrets = normalizeTeamAiSecretsMetadata(teamShared?.secrets);
  return AI_PROVIDER_IDS.filter((providerId) => normalizedSecrets.providers[providerId]?.configured);
}

async function loadLocalFallbackProviderIds(context) {
  if (!context?.isOwner) {
    return [];
  }

  const providerStatuses = await Promise.all(
    AI_PROVIDER_IDS.map(async (providerId) => {
      const apiKey = await invoke("load_ai_provider_secret", {
        providerId,
        installationId: context.installationId,
      });
      return typeof apiKey === "string" && apiKey.trim() ? providerId : null;
    }),
  );
  return providerStatuses.filter(Boolean);
}

function updateTeamAiSharedState(nextState, render) {
  state.aiSettings = {
    ...state.aiSettings,
    teamShared: nextState,
  };
  render?.();
}

function loadStoredTeamAiSnapshotForContext(context) {
  const snapshot = loadStoredTeamAiSnapshot(
    context?.installationId,
    context?.orgLogin,
    context?.login,
  );
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return null;
  }

  return {
    settings: normalizeTeamAiSettingsRecord(snapshot.settings),
    secrets: normalizeTeamAiSecretsMetadata(snapshot.secrets),
    lastInspectedTeamMetadataHeadOid: normalizeOptionalString(
      snapshot.lastInspectedTeamMetadataHeadOid,
    ),
  };
}

function persistTeamAiSnapshotForContext(context, teamShared) {
  if (!context) {
    return;
  }

  saveStoredTeamAiSnapshot(context.installationId, context.orgLogin, {
    settings: normalizeTeamAiSettingsRecord(teamShared?.settings),
    secrets: normalizeTeamAiSecretsMetadata(teamShared?.secrets),
    lastInspectedTeamMetadataHeadOid: normalizeOptionalString(
      teamShared?.lastInspectedTeamMetadataHeadOid,
    ),
  }, context.login);
}

function clearBrokerPublicKeyForContext(context) {
  if (!context) {
    return;
  }

  brokerPublicKeyCache.delete(`${context.sessionToken}:${context.installationId}`);
}

async function clearTeamAiLocalStateForContext(context) {
  if (!context) {
    return;
  }

  clearStoredTeamAiSnapshot(context.installationId, context.orgLogin, context.login);
  clearBrokerPublicKeyForContext(context);

  await Promise.allSettled(
    AI_PROVIDER_IDS.map((providerId) =>
      invoke("clear_team_ai_provider_cache", {
        installationId: context.installationId,
        providerId,
      })),
  );
}

function buildReadyTeamAiState(current, context, overrides = {}) {
  return {
    ...current,
    teamId: context.team.id,
    status: "ready",
    error: "",
    isOwner: context.isOwner,
    settings:
      current.teamId === context.team.id
        ? normalizeTeamAiSettingsRecord(current.settings)
        : null,
    secrets:
      current.teamId === context.team.id
        ? normalizeTeamAiSecretsMetadata(current.secrets)
        : createEmptyTeamAiSecretsMetadata(),
    settingsSaveStatus: current.teamId === context.team.id ? current.settingsSaveStatus : "idle",
    settingsSaveError: current.teamId === context.team.id ? current.settingsSaveError : "",
    lastInspectedTeamMetadataHeadOid:
      current.teamId === context.team.id
        ? normalizeOptionalString(current.lastInspectedTeamMetadataHeadOid)
        : null,
    ...overrides,
  };
}

function buildErroredTeamAiState(current, context, message) {
  return {
    ...createTeamAiSharedState(),
    teamId: context.team.id,
    status: "error",
    error: message,
    isOwner: context.isOwner,
    settingsSaveStatus: current.teamId === context.team.id ? current.settingsSaveStatus : "idle",
    settingsSaveError: current.teamId === context.team.id ? current.settingsSaveError : "",
  };
}

export async function loadSelectedTeamAiState(render, options = {}) {
  const context = selectedTeamAiContext();
  if (!context) {
    const current = currentTeamAiSharedState();
    if (current.teamId !== null || current.status !== "idle") {
      updateTeamAiSharedState(createTeamAiSharedState(), render);
    }
    return createTeamAiSharedState();
  }

  const current = currentTeamAiSharedState();
  if (
    options.force !== true
    && current.teamId === context.team.id
    && current.status === "ready"
    && !current.error
  ) {
    return current;
  }

  if (options.cacheOnly === true) {
    const storedSnapshot = loadStoredTeamAiSnapshotForContext(context);
    const nextState = buildReadyTeamAiState(current, context, {
      settings: storedSnapshot?.settings ?? null,
      secrets: storedSnapshot?.secrets ?? createEmptyTeamAiSecretsMetadata(),
      lastInspectedTeamMetadataHeadOid:
        storedSnapshot?.lastInspectedTeamMetadataHeadOid ?? null,
    });
    updateTeamAiSharedState(nextState, render);
    return nextState;
  }

  if (options.suppressLoadingState !== true) {
    updateTeamAiSharedState({
      ...current,
      teamId: context.team.id,
      status: "loading",
      error: "",
      isOwner: context.isOwner,
      settingsSaveError: current.teamId === context.team.id ? current.settingsSaveError : "",
      settingsSaveStatus: current.teamId === context.team.id ? current.settingsSaveStatus : "idle",
    }, render);
  }

  try {
    const [settingsPayload, secretsPayload] = await Promise.all([
      invoke("load_team_ai_settings", {
        installationId: context.installationId,
        orgLogin: context.orgLogin,
        sessionToken: context.sessionToken,
      }),
      invoke("load_team_ai_secrets_metadata", {
        installationId: context.installationId,
        orgLogin: context.orgLogin,
        sessionToken: context.sessionToken,
      }),
    ]);

    const nextState = {
      ...buildReadyTeamAiState(current, context),
      settings: normalizeTeamAiSettingsRecord(settingsPayload),
      secrets: normalizeTeamAiSecretsMetadata(secretsPayload),
    };
    persistTeamAiSnapshotForContext(context, nextState);
    if (!isTeamAiContextCurrent(context)) {
      return null;
    }
    updateTeamAiSharedState(nextState, render);
    return nextState;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const classified = classifySyncError(error);
    if (classified.type === "resource_access_lost") {
      await clearTeamAiLocalStateForContext(context);
      if (!isTeamAiContextCurrent(context)) {
        return null;
      }
      const nextState = buildErroredTeamAiState(current, context, message);
      updateTeamAiSharedState(nextState, render);
      throw error;
    }

    const storedSnapshot = loadStoredTeamAiSnapshotForContext(context);
    if (classified.type === "connection_unavailable" && storedSnapshot) {
      const nextState = buildReadyTeamAiState(current, context, {
        error: "Could not reach the GitHub App broker. Using the last known team AI settings.",
        settings: storedSnapshot.settings,
        secrets: storedSnapshot.secrets,
        lastInspectedTeamMetadataHeadOid:
          storedSnapshot.lastInspectedTeamMetadataHeadOid,
      });
      if (!isTeamAiContextCurrent(context)) {
        return null;
      }
      updateTeamAiSharedState(nextState, render);
      return nextState;
    }

    if (!isTeamAiContextCurrent(context)) {
      return null;
    }
    const nextState = buildErroredTeamAiState(current, context, message);
    updateTeamAiSharedState(nextState, render);
    throw error;
  }
}

export async function loadSelectedTeamAiSavedProviderIds(render, options = {}) {
  const context = selectedTeamAiContext();
  if (!context) {
    return [];
  }

  const teamShared = await loadSelectedTeamAiState(render, {
    suppressLoadingState: options.suppressLoadingState,
    force: options.force,
  });
  if (!teamShared) {
    return [];
  }
  const providerIds = new Set(configuredSharedTeamAiProviderIds(teamShared));
  for (const providerId of await loadLocalFallbackProviderIds(context)) {
    providerIds.add(providerId);
  }
  return [...providerIds];
}

async function ensureBrokerPublicKey(context) {
  const cacheKey = `${context.sessionToken}:${context.installationId}`;
  if (brokerPublicKeyCache.has(cacheKey)) {
    return brokerPublicKeyCache.get(cacheKey);
  }

  const payload = await invoke("load_team_ai_broker_public_key", {
    sessionToken: context.sessionToken,
  });
  const normalizedPayload = {
    algorithm: normalizeOptionalString(payload?.algorithm) ?? "",
    publicKeyPem: normalizeOptionalString(payload?.publicKeyPem) ?? "",
  };
  brokerPublicKeyCache.set(cacheKey, normalizedPayload);
  return normalizedPayload;
}

async function ensureTeamAiMemberKeypair(context) {
  const existing = await invoke("load_team_ai_member_keypair", {
    installationId: context.installationId,
  });
  if (
    normalizeOptionalString(existing?.publicKeyPem)
    && normalizeOptionalString(existing?.privateKeyPem)
  ) {
    return existing;
  }

  const generated = await generateTeamAiMemberKeypair();
  await invoke("save_team_ai_member_keypair", {
    installationId: context.installationId,
    publicKeyPem: generated.publicKeyPem,
    privateKeyPem: generated.privateKeyPem,
  });
  return generated;
}

async function issueAndCacheTeamAiProviderSecret(context, providerId, render) {
  const memberKeypair = await ensureTeamAiMemberKeypair(context);
  let issuedSecret = null;
  try {
    issuedSecret = await invoke("issue_team_ai_provider_secret", {
      installationId: context.installationId,
      orgLogin: context.orgLogin,
      providerId,
      memberPublicKeyPem: memberKeypair.publicKeyPem,
      sessionToken: context.sessionToken,
    });
  } catch (error) {
    const classified = classifySyncError(error);
    if (classified.type === "resource_access_lost") {
      await clearTeamAiLocalStateForContext(context);
      if (isTeamAiContextCurrent(context)) {
        updateTeamAiSharedState(
          buildErroredTeamAiState(
            currentTeamAiSharedState(),
            context,
            error instanceof Error ? error.message : String(error),
          ),
          render,
        );
      }
    }
    if (classified.type === "connection_unavailable") {
      throw new Error("The team AI key could not be issued right now.");
    }
    throw error;
  }
  const apiKey = await decryptTeamAiWrappedKey(
    issuedSecret.wrappedKey,
    memberKeypair.privateKeyPem,
  );
  if (!isTeamAiContextCurrent(context)) {
    return {
      ok: false,
      reason: "stale",
    };
  }
  await invoke("save_team_ai_provider_cache", {
    installationId: context.installationId,
    providerId,
    apiKey,
    keyVersion: issuedSecret.keyVersion,
  });
  return {
    ok: true,
    source: "broker-issue",
    keyVersion: issuedSecret.keyVersion,
  };
}

export async function ensureSelectedTeamAiProviderReady(render, providerId, options = {}) {
  const normalizedProviderId = normalizeAiProviderId(providerId);
  const context = selectedTeamAiContext();

  const localApiKey = await invoke("load_ai_provider_secret", {
    providerId: normalizedProviderId,
    ...localInstallationPayload(),
  });
  if (!context) {
    return typeof localApiKey === "string" && localApiKey.trim()
      ? { ok: true, source: "local" }
      : { ok: false, reason: "missing" };
  }
  if (!isTeamAiContextCurrent(context)) {
    return { ok: false, reason: "stale" };
  }
  if (isReadOnlyViewerTeam(context.team)) {
    return { ok: false, reason: "read_only" };
  }

  const teamShared = await loadSelectedTeamAiState(render, {
    suppressLoadingState: true,
    force: options.forceTeamStateRefresh === true,
    cacheOnly: options.forceTeamStateRefresh !== true,
  });
  if (!teamShared) {
    return {
      ok: false,
      reason: "stale",
    };
  }
  if (!isTeamAiContextCurrent(context)) {
    return { ok: false, reason: "stale" };
  }
  const providerMetadata = normalizeTeamAiSecretsMetadata(teamShared?.secrets).providers[normalizedProviderId];
  if (providerMetadata?.configured) {
    const cachedProviderSecret = normalizeTeamAiProviderCache(
      await invoke("load_team_ai_provider_cache", {
        installationId: context.installationId,
        providerId: normalizedProviderId,
      }),
    );
    if (!isTeamAiContextCurrent(context)) {
      return { ok: false, reason: "stale" };
    }
    if (
      options.forceProviderSecretRefresh !== true
      && cachedProviderSecret.apiKey
    ) {
      return {
        ok: true,
        source: "team-cache",
        keyVersion: cachedProviderSecret.keyVersion,
      };
    }

    const issuanceKey = `${context.installationId}:${normalizedProviderId}:${providerMetadata.keyVersion}`;
    if (providerSecretIssuances.has(issuanceKey)) {
      return providerSecretIssuances.get(issuanceKey);
    }
    const issuance = issueAndCacheTeamAiProviderSecret(
      context,
      normalizedProviderId,
      render,
    );
    providerSecretIssuances.set(issuanceKey, issuance);
    try {
      return await issuance;
    } finally {
      if (providerSecretIssuances.get(issuanceKey) === issuance) {
        providerSecretIssuances.delete(issuanceKey);
      }
    }
  }

  if (context.isOwner && typeof localApiKey === "string" && localApiKey.trim()) {
    return {
      ok: true,
      source: "local-fallback",
    };
  }

  return {
    ok: false,
    reason: context.isOwner ? "owner_missing" : "member_missing",
    teamName: context.team.name ?? context.orgLogin,
  };
}

function metadataSyncMatchesContext(team, context) {
  return (
    Number.isFinite(team?.installationId)
    && team.installationId === context?.installationId
    && String(team?.githubOrg ?? "").trim().toLowerCase()
      === String(context?.orgLogin ?? "").trim().toLowerCase()
  );
}

async function reconcileTeamAiMetadataRevision(context, headOid) {
  const storedSnapshot = loadStoredTeamAiSnapshotForContext(context);
  if (storedSnapshot?.lastInspectedTeamMetadataHeadOid === headOid) {
    return false;
  }

  const payload = await invoke("load_local_team_ai_metadata_snapshot", {
    installationId: context.installationId,
  });
  if (
    normalizeOptionalString(payload?.currentHeadOid) !== headOid
    || !isTeamAiContextCurrent(context)
  ) {
    return false;
  }

  const current = currentTeamAiSharedState();
  const settings = normalizeTeamAiSettingsRecord(payload?.settings);
  const secrets = normalizeTeamAiSecretsMetadata(payload?.secrets);
  const nextState = {
    ...buildReadyTeamAiState(current, context),
    settings,
    secrets,
    lastInspectedTeamMetadataHeadOid:
      storedSnapshot?.lastInspectedTeamMetadataHeadOid ?? null,
  };
  persistTeamAiSnapshotForContext(context, nextState);
  updateTeamAiSharedState(nextState, null);
  saveStoredAiActionPreferences(
    settings?.actionPreferences ?? null,
    context.login,
    context.installationId,
  );
  state.aiSettings = {
    ...state.aiSettings,
    actionConfig: {
      ...state.aiSettings.actionConfig,
      ...normalizeStoredAiActionPreferences(settings?.actionPreferences ?? null),
    },
  };

  let reconciliationSucceeded = true;
  const providerIdsToReconcile = isReadOnlyViewerTeam(context.team)
    ? []
    : AI_PROVIDER_IDS;
  for (const providerId of providerIdsToReconcile) {
    const providerMetadata = secrets.providers[providerId];
    const cached = normalizeTeamAiProviderCache(
      await invoke("load_team_ai_provider_cache", {
        installationId: context.installationId,
        providerId,
      }),
    );
    if (!isTeamAiContextCurrent(context)) {
      return false;
    }
    if (!providerMetadata?.configured) {
      if (cached.apiKey || cached.keyVersion !== null) {
        try {
          await invoke("clear_team_ai_provider_cache", {
            installationId: context.installationId,
            providerId,
          });
        } catch {
          reconciliationSucceeded = false;
        }
      }
      continue;
    }
    if (
      cached.apiKey
      && cached.keyVersion === providerMetadata.keyVersion
    ) {
      continue;
    }
    if (state.offline?.isEnabled === true) {
      reconciliationSucceeded = false;
      continue;
    }
    try {
      const result = await ensureSelectedTeamAiProviderReady(null, providerId, {
        forceProviderSecretRefresh: true,
      });
      if (!result?.ok || result.keyVersion !== providerMetadata.keyVersion) {
        reconciliationSucceeded = false;
      }
    } catch {
      reconciliationSucceeded = false;
    }
  }

  if (!reconciliationSucceeded || !isTeamAiContextCurrent(context)) {
    return false;
  }
  const completedState = {
    ...currentTeamAiSharedState(),
    lastInspectedTeamMetadataHeadOid: headOid,
  };
  persistTeamAiSnapshotForContext(context, completedState);
  updateTeamAiSharedState(completedState, null);
  return true;
}

export function reconcileSelectedTeamAiAfterMetadataSync(team, syncInfo) {
  const context = selectedTeamAiContext();
  const headOid = normalizeOptionalString(syncInfo?.currentHeadOid);
  if (!context || !headOid || !metadataSyncMatchesContext(team, context)) {
    return Promise.resolve(false);
  }
  const storedSnapshot = loadStoredTeamAiSnapshotForContext(context);
  if (storedSnapshot?.lastInspectedTeamMetadataHeadOid === headOid) {
    return Promise.resolve(false);
  }
  const key = `${context.login}:${context.installationId}:${headOid}`;
  if (metadataRevisionReconciliations.has(key)) {
    return metadataRevisionReconciliations.get(key);
  }
  const reconciliation = reconcileTeamAiMetadataRevision(context, headOid);
  metadataRevisionReconciliations.set(key, reconciliation);
  const clearReconciliation = () => {
    if (metadataRevisionReconciliations.get(key) === reconciliation) {
      metadataRevisionReconciliations.delete(key);
    }
  };
  void reconciliation.then(clearReconciliation, clearReconciliation);
  return reconciliation;
}

const rejectedProviderKeyRefreshes = new Map();

export async function refreshSelectedTeamAiProviderAfterAuthenticationError(
  providerId,
  options = {},
) {
  const normalizedProviderId = normalizeAiProviderId(providerId);
  const context = selectedTeamAiContext();
  if (!context) {
    return false;
  }
  if (isReadOnlyViewerTeam(context.team)) {
    return false;
  }
  if (
    Number.isFinite(options.installationId)
    && options.installationId !== context.installationId
  ) {
    return false;
  }

  const refreshKey = `${context.installationId}:${normalizedProviderId}`;
  if (rejectedProviderKeyRefreshes.has(refreshKey)) {
    return rejectedProviderKeyRefreshes.get(refreshKey);
  }

  const refresh = (async () => {
    const rejectedCache = normalizeTeamAiProviderCache(
      await invoke("load_team_ai_provider_cache", {
        installationId: context.installationId,
        providerId: normalizedProviderId,
      }),
    );
    const secretsPayload = await invoke("load_team_ai_secrets_metadata", {
      installationId: context.installationId,
      orgLogin: context.orgLogin,
      sessionToken: context.sessionToken,
    });
    const secrets = normalizeTeamAiSecretsMetadata(secretsPayload);
    const providerMetadata = secrets.providers[normalizedProviderId];
    const nextState = {
      ...buildReadyTeamAiState(currentTeamAiSharedState(), context),
      secrets,
    };
    persistTeamAiSnapshotForContext(context, nextState);
    if (!isTeamAiContextCurrent(context)) {
      return false;
    }
    updateTeamAiSharedState(nextState, null);
    if (
      !providerMetadata?.configured
      || providerMetadata.keyVersion === rejectedCache.keyVersion
    ) {
      return false;
    }
    const result = await ensureSelectedTeamAiProviderReady(null, normalizedProviderId, {
      forceProviderSecretRefresh: true,
    });
    return result?.ok === true;
  })();
  rejectedProviderKeyRefreshes.set(refreshKey, refresh);
  try {
    return await refresh;
  } finally {
    if (rejectedProviderKeyRefreshes.get(refreshKey) === refresh) {
      rejectedProviderKeyRefreshes.delete(refreshKey);
    }
  }
}

export async function saveSelectedTeamAiProviderSecret(render, providerId, apiKey) {
  const normalizedProviderId = normalizeAiProviderId(providerId);
  const context = selectedTeamAiContext();
  if (!context) {
    throw new Error("Select a signed-in team before saving a shared AI key.");
  }
  if (!context.isOwner) {
    throw new Error("Only the team owner can change shared AI keys.");
  }

  const normalizedApiKey = typeof apiKey === "string" ? apiKey.trim() : "";
  let secretsPayload = null;
  if (!normalizedApiKey) {
    secretsPayload = await invoke("save_team_ai_provider_secret", {
      installationId: context.installationId,
      orgLogin: context.orgLogin,
      providerId: normalizedProviderId,
      wrappedKey: null,
      clear: true,
      sessionToken: context.sessionToken,
    });
    await invoke("clear_team_ai_provider_cache", {
      installationId: context.installationId,
      providerId: normalizedProviderId,
    });
    await invoke("clear_ai_provider_secret", {
      providerId: normalizedProviderId,
      installationId: context.installationId,
    });
  } else {
    const brokerPublicKey = await ensureBrokerPublicKey(context);
    const wrappedKey = await encryptTeamAiPlaintext(
      normalizedApiKey,
      brokerPublicKey.publicKeyPem,
    );
    secretsPayload = await invoke("save_team_ai_provider_secret", {
      installationId: context.installationId,
      orgLogin: context.orgLogin,
      providerId: normalizedProviderId,
      wrappedKey,
      clear: false,
      sessionToken: context.sessionToken,
    });
    const normalizedSecrets = normalizeTeamAiSecretsMetadata(secretsPayload);
    const keyVersion = normalizedSecrets.providers[normalizedProviderId]?.keyVersion ?? null;
    if (keyVersion !== null) {
      await invoke("save_team_ai_provider_cache", {
        installationId: context.installationId,
        providerId: normalizedProviderId,
        apiKey: normalizedApiKey,
        keyVersion,
      });
    }
  }

  const nextTeamShared = {
    ...buildReadyTeamAiState(currentTeamAiSharedState(), context, {
      isOwner: true,
    }),
    secrets: normalizeTeamAiSecretsMetadata(secretsPayload),
  };
  persistTeamAiSnapshotForContext(context, nextTeamShared);
  if (!isTeamAiContextCurrent(context)) {
    return nextTeamShared.secrets;
  }
  updateTeamAiSharedState(nextTeamShared, render);
  return nextTeamShared.secrets;
}

export async function persistSelectedTeamAiActionPreferences(render, actionPreferences) {
  const context = selectedTeamAiContext();
  if (!context || !context.isOwner) {
    return null;
  }

  updateTeamAiSharedState({
    ...currentTeamAiSharedState(),
    teamId: context.team.id,
    isOwner: true,
    settingsSaveStatus: "saving",
    settingsSaveError: "",
  }, render);

  try {
    const settingsPayload = await invoke("save_team_ai_settings", {
      installationId: context.installationId,
      orgLogin: context.orgLogin,
      actionPreferences,
      sessionToken: context.sessionToken,
    });
    const nextTeamShared = {
      ...buildReadyTeamAiState(currentTeamAiSharedState(), context, {
        isOwner: true,
        settingsSaveStatus: "idle",
        settingsSaveError: "",
      }),
      settings: normalizeTeamAiSettingsRecord(settingsPayload),
    };
    persistTeamAiSnapshotForContext(context, nextTeamShared);
    if (!isTeamAiContextCurrent(context)) {
      return nextTeamShared.settings;
    }
    updateTeamAiSharedState(nextTeamShared, render);
    return nextTeamShared.settings;
  } catch (error) {
    if (!isTeamAiContextCurrent(context)) {
      return null;
    }
    updateTeamAiSharedState({
      ...currentTeamAiSharedState(),
      teamId: context.team.id,
      isOwner: true,
      settingsSaveStatus: "error",
      settingsSaveError: error instanceof Error ? error.message : String(error),
    }, render);
    return null;
  }
}
