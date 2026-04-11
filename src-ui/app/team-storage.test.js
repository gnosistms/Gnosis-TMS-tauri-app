import test from "node:test";
import assert from "node:assert/strict";

import {
  clearActiveStorageLogin,
  loadStoredTeamRecords,
  saveStoredTeamRecords,
  setActiveStorageLogin,
} from "./team-storage.js";
import {
  readPersistentValue,
  removePersistentValue,
  writePersistentValue,
} from "./persistent-store.js";

const TEAM_RECORDS_STORAGE_KEY = "gnosis-tms-team-records";

function scopedTeamKey(login) {
  return `${TEAM_RECORDS_STORAGE_KEY}:${login.trim().toLowerCase()}`;
}

function organizationTeam(overrides = {}) {
  return {
    id: "team-org",
    name: "Org Team",
    githubOrg: "org-team",
    ownerLogin: "owner",
    accountType: "Organization",
    canDelete: true,
    canManageMembers: true,
    canManageProjects: true,
    installationId: 1,
    grantedAppPermissions: {
      members: "write",
      administration: "write",
      custom_properties: "write",
      contents: "write",
      metadata: "read",
    },
    ...overrides,
  };
}

function personalTeam(overrides = {}) {
  return {
    id: "team-user",
    name: "Personal Team",
    githubOrg: "personal-team",
    ownerLogin: "owner",
    accountType: "User",
    canDelete: true,
    canManageMembers: true,
    canManageProjects: true,
    installationId: 2,
    ...overrides,
  };
}

test("loadStoredTeamRecords prunes stale non-org team records from persisted storage", () => {
  const login = `team-storage-load-${Date.now()}`;
  const storageKey = scopedTeamKey(login);
  const validTeam = organizationTeam();
  const stalePersonalInstall = personalTeam();

  setActiveStorageLogin(login);
  writePersistentValue(storageKey, [validTeam, stalePersonalInstall]);

  const loadedTeams = loadStoredTeamRecords(login);
  const persistedTeams = readPersistentValue(storageKey, []);

  assert.equal(loadedTeams.length, 1);
  assert.equal(loadedTeams[0].githubOrg, validTeam.githubOrg);
  assert.deepEqual(
    persistedTeams.map((team) => team.githubOrg),
    [validTeam.githubOrg],
  );

  removePersistentValue(storageKey);
  clearActiveStorageLogin();
});

test("saveStoredTeamRecords never persists non-org team records", () => {
  const login = `team-storage-save-${Date.now()}`;
  const storageKey = scopedTeamKey(login);
  const validTeam = organizationTeam({ githubOrg: "org-team-2", id: "team-org-2" });
  const stalePersonalInstall = personalTeam({ githubOrg: "personal-team-2", id: "team-user-2" });

  setActiveStorageLogin(login);
  saveStoredTeamRecords([validTeam, stalePersonalInstall], login);

  const persistedTeams = readPersistentValue(storageKey, []);

  assert.equal(persistedTeams.length, 1);
  assert.equal(persistedTeams[0].githubOrg, validTeam.githubOrg);
  assert.equal(persistedTeams[0].accountType, "Organization");

  removePersistentValue(storageKey);
  clearActiveStorageLogin();
});
