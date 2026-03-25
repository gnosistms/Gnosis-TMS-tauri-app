const TEAM_RECORDS_STORAGE_KEY = "gnosis-tms-team-records";
const LEGACY_GITHUB_APP_TEAMS_STORAGE_KEY = "gnosis-tms-github-app-teams";

function normalizeTeamRecord(team) {
  if (!team || typeof team !== "object") {
    return null;
  }

  const githubOrg =
    typeof team.githubOrg === "string" && team.githubOrg.trim()
      ? team.githubOrg.trim()
      : null;
  if (!githubOrg) {
    return null;
  }

  return {
    id:
      typeof team.id === "string" && team.id.trim()
        ? team.id.trim()
        : githubOrg,
    name:
      typeof team.name === "string" && team.name.trim()
        ? team.name.trim()
        : githubOrg,
    githubOrg,
    ownerLogin:
      typeof team.ownerLogin === "string" && team.ownerLogin.trim()
        ? team.ownerLogin.trim()
        : githubOrg,
    installationId:
      Number.isFinite(team.installationId) ? team.installationId : null,
    orgCreatedAt:
      typeof team.orgCreatedAt === "string" && team.orgCreatedAt.trim()
        ? team.orgCreatedAt
        : null,
    syncState:
      typeof team.syncState === "string" && team.syncState.trim()
        ? team.syncState
        : "active",
    statusLabel:
      typeof team.statusLabel === "string" ? team.statusLabel : "",
    lastSeenAt:
      typeof team.lastSeenAt === "string" && team.lastSeenAt.trim()
        ? team.lastSeenAt
        : null,
  };
}

function teamIdentityKey(team) {
  return team.githubOrg.toLowerCase();
}

export function loadStoredTeamRecords() {
  try {
    const localStorage = window.localStorage;
    const storedValue = localStorage?.getItem(TEAM_RECORDS_STORAGE_KEY);
    if (!storedValue) {
      const legacyTeams = loadLegacyGithubAppTeams(localStorage);
      if (legacyTeams.length) {
        saveStoredTeamRecords(legacyTeams);
        return legacyTeams;
      }
      return [];
    }

    const teams = JSON.parse(storedValue);
    if (!Array.isArray(teams)) {
      return [];
    }

    return teams
      .map(normalizeTeamRecord)
      .filter(Boolean);
  } catch {
    return [];
  }
}

function loadLegacyGithubAppTeams(localStorage = window.localStorage) {
  try {
    const storedValue = localStorage?.getItem(LEGACY_GITHUB_APP_TEAMS_STORAGE_KEY);
    if (!storedValue) {
      return [];
    }

    const teams = JSON.parse(storedValue);
    if (!Array.isArray(teams)) {
      return [];
    }

    return teams
      .map(normalizeTeamRecord)
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function saveStoredTeamRecords(teams) {
  try {
    const merged = new Map();
    teams
      .map(normalizeTeamRecord)
      .filter(Boolean)
      .forEach((team) => {
        const key = teamIdentityKey(team);
        const existing = merged.get(key);
        merged.set(key, existing ? { ...existing, ...team } : team);
      });
    window.localStorage?.setItem(
      TEAM_RECORDS_STORAGE_KEY,
      JSON.stringify([...merged.values()]),
    );
  } catch {}
}

export function upsertStoredTeamRecords(teams) {
  const existingTeams = loadStoredTeamRecords();
  const merged = new Map(
    existingTeams.map((team) => [teamIdentityKey(team), team]),
  );

  teams
    .map(normalizeTeamRecord)
    .filter(Boolean)
    .forEach((team) => {
      const key = teamIdentityKey(team);
      const previous = merged.get(key);
      merged.set(key, previous ? { ...previous, ...team } : team);
    });

  const nextTeams = [...merged.values()];
  saveStoredTeamRecords(nextTeams);
  return nextTeams;
}

export function updateStoredTeamRecord(teamId, updates) {
  const nextTeams = loadStoredTeamRecords().map((team) =>
    team.id === teamId ? normalizeTeamRecord({ ...team, ...updates }) : team,
  );
  saveStoredTeamRecords(nextTeams);
  return nextTeams;
}

export function loadStoredGithubAppTeams() {
  return loadStoredTeamRecords();
}

export function saveStoredGithubAppTeams(teams) {
  saveStoredTeamRecords(teams);
}

export function updateStoredGithubAppTeam(teamId, updates) {
  return updateStoredTeamRecord(teamId, updates);
}

export function mergeTeams(primaryTeams, secondaryTeams = []) {
  const mergedTeams = new Map();
  [...secondaryTeams, ...primaryTeams]
    .map(normalizeTeamRecord)
    .filter(Boolean)
    .forEach((team) => {
      const key = teamIdentityKey(team);
      const existing = mergedTeams.get(key);
      mergedTeams.set(key, existing ? { ...existing, ...team } : team);
    });
  return [...mergedTeams.values()];
}
