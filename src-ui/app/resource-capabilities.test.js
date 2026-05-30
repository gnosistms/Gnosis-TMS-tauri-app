import test from "node:test";
import assert from "node:assert/strict";

import {
  canDownloadProjectFiles,
  canMutateProjectFiles,
  canManageTeamAiSettings,
  canPermanentlyDeleteProjectFiles,
  canCreateRepoResources,
  canPermanentlyDeleteRepoResources,
  isReadOnlyViewerTeam,
  shouldShowDeletedGlossaryPermanentDelete,
  shouldShowDeletedProjectPermanentDelete,
  shouldShowGlossaryCreationControls,
  shouldShowNewProjectButton,
} from "./resource-capabilities.js";

test("repo creation helpers allow admins and owners", () => {
  const ownerTeam = { membershipRole: "owner" };
  const adminTeam = { membershipRole: "admin" };
  const translatorTeam = { membershipRole: "translator" };

  assert.equal(canCreateRepoResources(ownerTeam), true);
  assert.equal(canCreateRepoResources(adminTeam), true);
  assert.equal(canCreateRepoResources(translatorTeam), false);

  assert.equal(shouldShowNewProjectButton(ownerTeam), true);
  assert.equal(shouldShowNewProjectButton(adminTeam), true);
  assert.equal(shouldShowNewProjectButton(translatorTeam), false);

  assert.equal(shouldShowGlossaryCreationControls(ownerTeam), true);
  assert.equal(shouldShowGlossaryCreationControls(adminTeam), true);
  assert.equal(shouldShowGlossaryCreationControls(translatorTeam), false);
});

test("local hard-delete repo resource helpers allow any team member", () => {
  const ownerTeam = { membershipRole: "owner" };
  const adminTeam = { membershipRole: "admin" };
  const translatorTeam = { membershipRole: "translator" };
  const viewerTeam = { membershipRole: "viewer" };

  assert.equal(canPermanentlyDeleteRepoResources(ownerTeam), true);
  assert.equal(canPermanentlyDeleteRepoResources(adminTeam), true);
  assert.equal(canPermanentlyDeleteRepoResources(translatorTeam), true);
  assert.equal(canPermanentlyDeleteRepoResources(viewerTeam), true);

  assert.equal(shouldShowDeletedProjectPermanentDelete(ownerTeam), true);
  assert.equal(shouldShowDeletedProjectPermanentDelete(adminTeam), true);
  assert.equal(shouldShowDeletedProjectPermanentDelete(translatorTeam), true);
  assert.equal(shouldShowDeletedProjectPermanentDelete(viewerTeam), true);

  assert.equal(shouldShowDeletedGlossaryPermanentDelete(ownerTeam), true);
  assert.equal(shouldShowDeletedGlossaryPermanentDelete(adminTeam), true);
  assert.equal(shouldShowDeletedGlossaryPermanentDelete(translatorTeam), true);
  assert.equal(shouldShowDeletedGlossaryPermanentDelete(viewerTeam), true);
});

test("deleted project file permanent delete is local-only for any team member", () => {
  const ownerTeam = { membershipRole: "owner" };
  const adminTeam = { membershipRole: "admin" };
  const translatorTeam = { membershipRole: "translator" };
  const viewerTeam = { membershipRole: "viewer" };

  assert.equal(canPermanentlyDeleteProjectFiles(ownerTeam), true);
  assert.equal(canPermanentlyDeleteProjectFiles(adminTeam), true);
  assert.equal(canPermanentlyDeleteProjectFiles(translatorTeam), true);
  assert.equal(canPermanentlyDeleteProjectFiles(viewerTeam), true);
});

test("viewer teams can download project files but cannot mutate resources", () => {
  const viewerTeam = {
    membershipRole: "viewer",
  };

  assert.equal(isReadOnlyViewerTeam(viewerTeam), true);
  assert.equal(canDownloadProjectFiles(viewerTeam), true);
  assert.equal(canMutateProjectFiles(viewerTeam), false);
  assert.equal(canPermanentlyDeleteProjectFiles(viewerTeam), true);
  assert.equal(canCreateRepoResources(viewerTeam), false);
});

test("AI settings visibility stays on the owner-only gate", () => {
  const ownerTeam = { membershipRole: "owner" };
  const adminTeam = { membershipRole: "admin" };
  const translatorTeam = { membershipRole: "translator" };

  assert.equal(canManageTeamAiSettings(ownerTeam), true);
  assert.equal(canManageTeamAiSettings(adminTeam), false);
  assert.equal(canManageTeamAiSettings(translatorTeam), false);
});
