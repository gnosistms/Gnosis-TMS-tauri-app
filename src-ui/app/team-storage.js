const GITHUB_APP_TEAMS_STORAGE_KEY = "gnosis-tms-github-app-teams";

export function loadStoredGithubAppTeams() {
  try {
    const storedValue = window.localStorage?.getItem(GITHUB_APP_TEAMS_STORAGE_KEY);
    if (!storedValue) {
      return [];
    }

    const teams = JSON.parse(storedValue);
    return Array.isArray(teams) ? teams : [];
  } catch {
    return [];
  }
}

export function saveStoredGithubAppTeams(teams) {
  try {
    window.localStorage?.setItem(GITHUB_APP_TEAMS_STORAGE_KEY, JSON.stringify(teams));
  } catch {}
}

export function updateStoredGithubAppTeam(teamId, updates) {
  const nextTeams = loadStoredGithubAppTeams().map((team) =>
    team.id === teamId ? { ...team, ...updates } : team,
  );
  saveStoredGithubAppTeams(nextTeams);
}

export function mergeTeams(primaryTeams, secondaryTeams = []) {
  const mergedTeams = new Map();
  [...secondaryTeams, ...primaryTeams].forEach((team) => {
    mergedTeams.set(team.id, team);
  });
  return [...mergedTeams.values()];
}
