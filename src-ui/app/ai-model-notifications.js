import { loadStoredTeamAiActionPreferences } from "./ai-action-preferences.js";
import {
  aiModelHistory, recordAiModelList, saveAiModelCheckSources, selectedAiProviderIds,
  startAiModelHistoryCheck,
} from "./ai-model-history.js";
import { canManageTeam } from "./permissions.js";
import { handleNavigation } from "./navigation.js";
import { invoke } from "./runtime.js";
import { authSessionGeneration, state } from "./state.js";
import { classifySyncError } from "./sync-error.js";
import { isTransientAiProviderError } from "./editor-ai-batch-pool.js";
import { ensureOwnedTeamAiModelCheckKey } from "./team-ai-flow.js";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const NOTICE_SELECTOR = '[data-modal-dialog="ai-model-notification"]';
let activeNotice = null;
let settingsVisit = null;

function onlineLogin() {
  if (state.offline.isEnabled || state.auth.status !== "success" || !state.auth.session?.sessionToken) return "";
  return state.auth.session.login?.trim().toLowerCase() ?? "";
}

function isOwnedTeam(team) {
  return Number.isSafeInteger(team?.installationId) && team.installationId > 0 && team.githubOrg
    && !team.isDeleted && team.syncState !== "unconfirmed" && canManageTeam(team);
}

function localProviders(login, installationId) {
  return selectedAiProviderIds(loadStoredTeamAiActionPreferences(login, installationId, { useDefaults: false }));
}

function providersForSource(login, team, source) {
  const local = localProviders(login, team.installationId);
  // A settings edit or metadata sync since the weekly lookup takes precedence.
  return source && local.join() === source.local.join() ? source.selected : local;
}

export async function checkForNewAiModels(onDiscovery, now = Date.now()) {
  const login = onlineLogin();
  if (!invoke || !login || state.orgDiscovery.status !== "ready" || state.teamsPage.isRefreshing) return;
  const history = aiModelHistory(login);
  if (history.checkedAt && now >= history.checkedAt && now - history.checkedAt < WEEK_MS) return;
  const teams = state.teams.filter(isOwnedTeam).sort((a, b) => a.installationId - b.installationId);
  if (!teams.length) return;
  // Reserve the weekly attempt before the first await, including across restarts.
  startAiModelHistoryCheck(login, now);
  const generation = authSessionGeneration;
  const checkIsCurrent = () => generation === authSessionGeneration && login === onlineLogin()
    && aiModelHistory(login).checkedAt === now;
  const stillOwns = (team) => checkIsCurrent() && state.teams.some((item) =>
    item.installationId === team.installationId && item.githubOrg === team.githubOrg && isOwnedTeam(item));
  const sources = { ...history.sources };
  const candidates = new Map();
  for (const team of teams) {
    if (!stillOwns(team)) continue;
    const { installationId, githubOrg: orgLogin } = team;
    const before = localProviders(login, installationId);
    let settings;
    try {
      settings = await invoke("load_team_ai_settings", {
        installationId, orgLogin, sessionToken: state.auth.session.sessionToken, ownerOnly: true,
      });
    } catch {
      // A failed settings read cannot establish which providers to query.
      continue;
    }
    if (!stillOwns(team)) continue;
    const local = localProviders(login, installationId);
    const selected = settings?.actionPreferences && before.join() === local.join()
      ? selectedAiProviderIds(settings.actionPreferences) : local;
    sources[installationId] = { selected, local };
    for (const providerId of selected) {
      if (!candidates.has(providerId)) candidates.set(providerId, []);
      candidates.get(providerId).push(team);
    }
  }
  if (!checkIsCurrent()) return;
  saveAiModelCheckSources(login, sources);
  for (const [providerId, owners] of candidates) {
    for (const team of owners) {
      const { installationId, githubOrg: orgLogin } = team;
      const eligible = () => stillOwns(team)
        && providersForSource(login, team, sources[installationId]).includes(providerId);
      if (!eligible()) continue;
      const context = { login, team, installationId, orgLogin, sessionToken: state.auth.session.sessionToken };
      try {
        if (!await ensureOwnedTeamAiModelCheckKey(context, providerId, eligible) || !eligible()) continue;
        // Tauri fetches, filters and compares IDs on its native blocking pool.
        // This task never enters a foreground loading or navigation flow.
        const models = await invoke("list_ai_provider_models", {
          installationId, providerId, noticeKnownIds: aiModelHistory(login).providers[providerId]?.knownIds ?? [],
        });
        if (!eligible()) continue;
        recordAiModelList(login, providerId, models);
        break;
      } catch (error) {
        // A different team's key can fix an account error. An outage can wait
        // for next week without repeating the failed request for every team.
        if (isTransientAiProviderError(error) || classifySyncError(error).type === "connection_unavailable") break;
      }
    }
  }
  if (checkIsCurrent()) onDiscovery?.();
}

export function startAiModelNotifications(syncNotice) {
  if (!invoke) return;
  const wake = () => {
    syncNotice();
    void checkForNewAiModels(syncNotice);
  };
  // The minute tick only checks the local deadline. It also covers sign-in
  // after startup and machines that sleep through the weekly deadline.
  window.setTimeout(wake, 15_000);
  window.setInterval(wake, 60_000);
  window.addEventListener("focus", wake);
  document.addEventListener("visibilitychange", wake);
}

function canShowForOwner(login) {
  return login && state.screen !== "teams" && state.screen !== "start"
    && isOwnedTeam(state.teams.find((team) => team.id === state.selectedTeamId));
}

function stillUsesProvider(login, providerId) {
  const { sources } = aiModelHistory(login);
  return state.teams.some((team) => isOwnedTeam(team)
    && providersForSource(login, team, sources[team.installationId]).includes(providerId));
}

export function currentAiModelNotice() {
  if (!activeNotice) return null;
  const login = onlineLogin();
  return authSessionGeneration === activeNotice.generation && login === activeNotice.login
    && canShowForOwner(login) && stillUsesProvider(login, activeNotice.providerId)
    ? activeNotice : null;
}

export function dismissAiModelNotice() {
  activeNotice = null;
}

export async function openAiModelNoticeSettings(render) {
  const canOpen = Boolean(currentAiModelNotice());
  dismissAiModelNotice();
  // Let the owner use Settings before offering another provider's notice.
  settingsVisit = "opening";
  try {
    render({ scope: "ai-model-notice" });
    if (canOpen && state.screen !== "aiKey") await handleNavigation("aiKey", render);
  } finally {
    settingsVisit = canOpen && state.screen === "aiKey" ? "open" : null;
  }
}

export function syncAiModelNotice(root, patch) {
  if (activeNotice) {
    if (currentAiModelNotice()) return;
    dismissAiModelNotice();
    if (root.querySelector(NOTICE_SELECTOR)) patch(null);
  }
  if (settingsVisit === "opening" || (settingsVisit === "open" && state.screen === "aiKey")) return;
  settingsVisit = null;
  const login = onlineLogin();
  if (!login) return;
  const pending = Object.entries(aiModelHistory(login).providers).filter(([, entry]) => entry.pending.length);
  if (!pending.length || !canShowForOwner(login) || state.orgDiscovery.status !== "ready" || state.teamsPage.isRefreshing) return;
  const doc = root.ownerDocument;
  if (doc.hidden || !doc.hasFocus() || doc.querySelector("[data-modal-dialog]")
    || doc.activeElement?.matches("[data-ai-settings-model-select]")) return;
  const next = pending.find(([providerId]) => stillUsesProvider(login, providerId));
  if (!next) return;
  const [providerId, { pending: models }] = next;
  activeNotice = { login, providerId, models, generation: authSessionGeneration };
  patch(activeNotice);
  // A discovery stays pending across navigation/restarts until its modal mounts
  // in a visible owner workspace. Seeing it once is enough, even before Ignore.
  if (root.querySelector(NOTICE_SELECTOR)) recordAiModelList(login, providerId, models, { viewed: true });
  else dismissAiModelNotice();
}
