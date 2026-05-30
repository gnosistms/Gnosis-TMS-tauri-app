import test from "node:test";
import assert from "node:assert/strict";

import {
  canDownload,
  canLocalHardDelete,
  canManageGlossaryResources,
  canManageMembers,
  canManageProjects,
  canManageQaListResources,
  canManageTeam,
  canWriteChapters,
  canWriteGlossaries,
  canWriteQaLists,
  deriveTeamCapabilities,
  normalizeAccountRole,
} from "./permissions.js";

test("normalizes app account roles and GitHub member aliases", () => {
  assert.equal(normalizeAccountRole("Viewer"), "viewer");
  assert.equal(normalizeAccountRole("read_only"), "viewer");
  assert.equal(normalizeAccountRole("member"), "translator");
  assert.equal(normalizeAccountRole("Translator"), "translator");
  assert.equal(normalizeAccountRole("Admin"), "admin");
  assert.equal(normalizeAccountRole("Owner"), "owner");
});

test("viewer capabilities allow download and local hard-delete only", () => {
  const team = { membershipRole: "viewer" };

  assert.equal(canDownload(team), true);
  assert.equal(canLocalHardDelete(team), true);
  assert.equal(canWriteChapters(team), false);
  assert.equal(canWriteGlossaries(team), false);
  assert.equal(canWriteQaLists(team), false);
  assert.equal(canManageProjects(team), false);
  assert.equal(canManageGlossaryResources(team), false);
  assert.equal(canManageQaListResources(team), false);
  assert.equal(canManageMembers(team), false);
  assert.equal(canManageTeam(team), false);
});

test("translator capabilities allow content writes but not resource or team management", () => {
  const team = { membershipRole: "translator" };

  assert.equal(canDownload(team), true);
  assert.equal(canLocalHardDelete(team), true);
  assert.equal(canWriteChapters(team), true);
  assert.equal(canWriteGlossaries(team), true);
  assert.equal(canWriteQaLists(team), true);
  assert.equal(canManageProjects(team), false);
  assert.equal(canManageGlossaryResources(team), false);
  assert.equal(canManageQaListResources(team), false);
  assert.equal(canManageMembers(team), false);
  assert.equal(canManageTeam(team), false);
});

test("admin capabilities allow content and resource management but not members or team settings", () => {
  const team = { membershipRole: "admin" };

  assert.equal(canWriteChapters(team), true);
  assert.equal(canWriteGlossaries(team), true);
  assert.equal(canWriteQaLists(team), true);
  assert.equal(canManageProjects(team), true);
  assert.equal(canManageGlossaryResources(team), true);
  assert.equal(canManageQaListResources(team), true);
  assert.equal(canManageMembers(team), false);
  assert.equal(canManageTeam(team), false);
});

test("owner capabilities allow every shared operation", () => {
  const capabilities = deriveTeamCapabilities({ membershipRole: "owner" });

  assert.equal(capabilities.canWriteChapters, true);
  assert.equal(capabilities.canWriteGlossaries, true);
  assert.equal(capabilities.canWriteQaLists, true);
  assert.equal(capabilities.canManageProjects, true);
  assert.equal(capabilities.canManageGlossaryResources, true);
  assert.equal(capabilities.canManageQaListResources, true);
  assert.equal(capabilities.canManageMembers, true);
  assert.equal(capabilities.canManageTeam, true);
});

test("legacy booleans are used only when role is missing", () => {
  assert.equal(deriveTeamCapabilities({ canDelete: true }).canManageTeam, true);
  assert.equal(deriveTeamCapabilities({ canManageProjects: true }).canManageProjects, true);
  assert.equal(
    deriveTeamCapabilities({ membershipRole: "translator", canDelete: true }).canManageTeam,
    false,
  );
  assert.equal(
    deriveTeamCapabilities({ membershipRole: "viewer", canManageProjects: true }).canManageProjects,
    false,
  );
  assert.equal(
    deriveTeamCapabilities({ membershipRole: "unexpected-role", canDelete: true }).canManageTeam,
    false,
  );
  assert.equal(
    deriveTeamCapabilities({ membershipRole: "unexpected-role", canManageProjects: true }).canManageProjects,
    false,
  );
  assert.equal(
    deriveTeamCapabilities({ membershipRole: "unexpected-role", canDelete: true }).canDownload,
    true,
  );
});
