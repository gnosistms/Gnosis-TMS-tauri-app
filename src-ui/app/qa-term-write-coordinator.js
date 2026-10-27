// Track activity per repository so a save does not block another QA list's load.
const activeWrites = new Map();
const listeners = new Set();

function writeScope(team, qaList) {
  return team && qaList ? `${team.installationId}:${qaList.repoName || qaList.id || qaList.qaListId}` : "*";
}

export function anyQaTermWriteIsActive() {
  return activeWrites.size > 0;
}

export function beginQaTermWrite(team, qaList) {
  const scope = writeScope(team, qaList);
  activeWrites.set(scope, (activeWrites.get(scope) ?? 0) + 1);
}

export function endQaTermWrite(team, qaList) {
  const scope = writeScope(team, qaList);
  const count = (activeWrites.get(scope) ?? 0) - 1;
  if (count > 0) activeWrites.set(scope, count);
  else activeWrites.delete(scope);
  for (const listener of listeners) listener();
}

export function qaListTermWriteIsActive(team, qaList) {
  if (!team || !qaList) return anyQaTermWriteIsActive();
  return activeWrites.has("*") || activeWrites.has(writeScope(team, qaList));
}

export function waitForQaTermWritesToSettle(team, qaList) {
  if (!qaListTermWriteIsActive(team, qaList)) return Promise.resolve();
  return new Promise((resolve) => {
    const listener = () => {
      if (!qaListTermWriteIsActive(team, qaList)) {
        listeners.delete(listener);
        resolve();
      }
    };
    listeners.add(listener);
  });
}

export function resetQaTermWriteCoordinator() {
  activeWrites.clear();
  for (const listener of listeners) listener();
}
