import test from "node:test";
import assert from "node:assert/strict";

import {
  canManageTeamAiSettings,
  canPermanentlyDeleteProjectFiles,
  canCreateRepoResources,
  canPermanentlyDeleteRepoResources,
  shouldShowDeletedGlossaryPermanentDelete,
  shouldShowDeletedProjectPermanentDelete,
  shouldShowGlossaryCreationControls,
  shouldShowNewProjectButton,
} from "./resource-capabilities.js";

test("owner-only repo creation helpers allow only owners", () => {
  const ownerTeam = { canDelete: true, canManageProjects: true };
  const adminTeam = { canDelete: false, canManageProjects: true };
  const translatorTeam = { canDelete: false, canManageProjects: false };

  assert.equal(canCreateRepoResources(ownerTeam), true);
  assert.equal(canCreateRepoResources(adminTeam), false);
  assert.equal(canCreateRepoResources(translatorTeam), false);

  assert.equal(shouldShowNewProjectButton(ownerTeam), true);
  assert.equal(shouldShowNewProjectButton(adminTeam), false);
  assert.equal(shouldShowNewProjectButton(translatorTeam), false);

  assert.equal(shouldShowGlossaryCreationControls(ownerTeam), true);
  assert.equal(shouldShowGlossaryCreationControls(adminTeam), false);
  assert.equal(shouldShowGlossaryCreationControls(translatorTeam), false);
});

test("owner-only permanent delete helpers allow only owners", () => {
  const ownerTeam = { canDelete: true, canManageProjects: true };
  const adminTeam = { canDelete: false, canManageProjects: true };
  const translatorTeam = { canDelete: false, canManageProjects: false };

  assert.equal(canPermanentlyDeleteRepoResources(ownerTeam), true);
  assert.equal(canPermanentlyDeleteRepoResources(adminTeam), false);
  assert.equal(canPermanentlyDeleteRepoResources(translatorTeam), false);

  assert.equal(shouldShowDeletedProjectPermanentDelete(ownerTeam), true);
  assert.equal(shouldShowDeletedProjectPermanentDelete(adminTeam), false);
  assert.equal(shouldShowDeletedProjectPermanentDelete(translatorTeam), false);

  assert.equal(shouldShowDeletedGlossaryPermanentDelete(ownerTeam), true);
  assert.equal(shouldShowDeletedGlossaryPermanentDelete(adminTeam), false);
  assert.equal(shouldShowDeletedGlossaryPermanentDelete(translatorTeam), false);
});

test("deleted project file permanent delete stays on the project-management gate", () => {
  const ownerTeam = { canDelete: true, canManageProjects: true };
  const adminTeam = { canDelete: false, canManageProjects: true };
  const translatorTeam = { canDelete: false, canManageProjects: false };

  assert.equal(canPermanentlyDeleteProjectFiles(ownerTeam), true);
  assert.equal(canPermanentlyDeleteProjectFiles(adminTeam), true);
  assert.equal(canPermanentlyDeleteProjectFiles(translatorTeam), false);
});

test("AI settings visibility stays on the owner-only gate", () => {
  const ownerTeam = { canDelete: true, canManageProjects: true };
  const adminTeam = { canDelete: false, canManageProjects: true };
  const translatorTeam = { canDelete: false, canManageProjects: false };

  assert.equal(canManageTeamAiSettings(ownerTeam), true);
  assert.equal(canManageTeamAiSettings(adminTeam), false);
  assert.equal(canManageTeamAiSettings(translatorTeam), false);
});
