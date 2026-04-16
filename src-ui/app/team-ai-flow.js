import { AI_PROVIDER_IDS, normalizeAiProviderId } from "./ai-provider-config.js";
import { normalizeStoredAiActionPreferences } from "./ai-action-config.js";
import { requireBrokerSession } from "./auth-flow.js";
import { invoke } from "./runtime.js";
import { state } from "./state.js";
import { classifySyncError } from "./sync-error.js";
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
  };
}

function persistTeamAiSnapshotForContext(context, teamShared) {
  if (!context) {
    return;
  }

  saveStoredTeamAiSnapshot(context.installationId, context.orgLogin, {
    settings: normalizeTeamAiSettingsRecord(teamShared?.settings),
    secrets: normalizeTeamAiSecretsMetadata(teamShared?.secrets),
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
    updateTeamAiSharedState(nextState, render);
    return nextState;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const classified = classifySyncError(error);
    if (classified.type === "resource_access_lost") {
      await clearTeamAiLocalStateForContext(context);
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
      });
      updateTeamAiSharedState(nextState, render);
      return nextState;
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

  const teamShared = await loadSelectedTeamAiState(render, {
    suppressLoadingState: true,
  });
  const providerMetadata = normalizeTeamAiSecretsMetadata(teamShared?.secrets).providers[normalizedProviderId];
  if (providerMetadata?.configured) {
    const cachedProviderSecret = normalizeTeamAiProviderCache(
      await invoke("load_team_ai_provider_cache", {
        installationId: context.installationId,
        providerId: normalizedProviderId,
      }),
    );
    if (
      cachedProviderSecret.apiKey
      && cachedProviderSecret.keyVersion === providerMetadata.keyVersion
    ) {
      return {
        ok: true,
        source: "team-cache",
        keyVersion: providerMetadata.keyVersion,
      };
    }

    const memberKeypair = await ensureTeamAiMemberKeypair(context);
    let issuedSecret = null;
    try {
      issuedSecret = await invoke("issue_team_ai_provider_secret", {
        installationId: context.installationId,
        orgLogin: context.orgLogin,
        providerId: normalizedProviderId,
        memberPublicKeyPem: memberKeypair.publicKeyPem,
        sessionToken: context.sessionToken,
      });
    } catch (error) {
      const classified = classifySyncError(error);
      if (classified.type === "resource_access_lost") {
        await clearTeamAiLocalStateForContext(context);
        updateTeamAiSharedState(
          buildErroredTeamAiState(
            currentTeamAiSharedState(),
            context,
            error instanceof Error ? error.message : String(error),
          ),
          render,
        );
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
    await invoke("save_team_ai_provider_cache", {
      installationId: context.installationId,
      providerId: normalizedProviderId,
      apiKey,
      keyVersion: issuedSecret.keyVersion,
    });
    return {
      ok: true,
      source: "broker-issue",
      keyVersion: issuedSecret.keyVersion,
    };
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
      }),
      settings: normalizeTeamAiSettingsRecord(settingsPayload),
    };
    persistTeamAiSnapshotForContext(context, nextTeamShared);
    updateTeamAiSharedState(nextTeamShared, render);
    return nextTeamShared.settings;
  } catch (error) {
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
