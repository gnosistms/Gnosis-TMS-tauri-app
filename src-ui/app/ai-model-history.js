import { AI_ACTION_IDS } from "./ai-action-config.js";
import { AI_PROVIDER_IDS } from "./ai-provider-config.js";
import { readPersistentValue, writePersistentValue } from "./persistent-store.js";

const keyFor = (login) => `gnosis-tms-ai-model-history:${login.trim().toLowerCase()}`;
const emptyHistory = () => ({ checkedAt: 0, sources: {}, providers: {} });
let cachedKey;
let cachedHistory;

export function aiModelHistory(login) {
  const key = keyFor(login);
  if (key !== cachedKey) {
    cachedHistory = readPersistentValue(key, null) ?? emptyHistory();
    cachedKey = key;
  }
  return cachedHistory;
}

function save(login, history) {
  cachedKey = keyFor(login);
  cachedHistory = history;
  writePersistentValue(cachedKey, history);
}

export function selectedAiProviderIds(preferences) {
  const selections = preferences?.detailedConfiguration
    ? AI_ACTION_IDS.map((id) => preferences.actions?.[id])
    : [preferences?.unified];
  return AI_PROVIDER_IDS.filter((id) => selections.some((item) => item?.providerId === id));
}

export function startAiModelHistoryCheck(login, checkedAt) {
  save(login, { ...aiModelHistory(login), checkedAt });
}

export function saveAiModelCheckSources(login, sources) {
  save(login, { ...aiModelHistory(login), sources });
}

// Re-read at commit: a dropdown or notice may have been seen while the native
// worker was fetching. Compare model IDs, since a provider can rename a label.
export function recordAiModelList(login, providerId, models, { viewed = false } = {}) {
  if (!login || !AI_PROVIDER_IDS.includes(providerId) || !Array.isArray(models)) return;
  const history = aiModelHistory(login);
  const previous = history.providers[providerId];
  const known = new Set(previous?.knownIds);
  const listed = new Map();
  for (const model of models) {
    const id = model?.id?.trim();
    if (id && !listed.has(id)) listed.set(id, model.label?.trim() || id);
  }
  if (viewed && !listed.size) return;
  let pending;
  if (!previous || viewed) {
    for (const id of listed.keys()) known.add(id);
    pending = (previous?.pending ?? []).filter(({ id }) => !listed.has(id));
  } else {
    // Retain only discoveries still offered. They become known when displayed.
    pending = Array.from(listed, ([id, label]) => ({ id, label })).filter(({ id }) => !known.has(id));
  }
  if (previous && known.size === previous.knownIds.length
    && JSON.stringify(pending) === JSON.stringify(previous.pending)) return;
  save(login, {
    ...history,
    providers: { ...history.providers, [providerId]: { knownIds: [...known], pending } },
  });
}
