import test from "node:test";
import assert from "node:assert/strict";

import {
  READ_ONLY_DELETED_MESSAGE,
  getGlossaryWritePolicy,
  getProjectWritePolicy,
  getQaListWritePolicy,
  isSoftDeletedResource,
} from "./resource-write-policy.js";

const writerTeam = {
  id: "team-1",
  installationId: 1,
  canManageProjects: true,
  canDelete: true,
};

const viewerTeam = {
  ...writerTeam,
  membershipRole: "viewer",
};

const translatorTeam = {
  id: "team-2",
  installationId: 2,
  membershipRole: "translator",
};

const adminTeam = {
  id: "team-3",
  installationId: 3,
  membershipRole: "admin",
};

test("soft-delete helper detects team, top-level, chapter, and row states", () => {
  assert.equal(isSoftDeletedResource({ isDeleted: true }, "team"), true);
  assert.equal(isSoftDeletedResource({ lifecycleState: "softDeleted" }, "project"), true);
  assert.equal(isSoftDeletedResource({ lifecycleState: "deleted" }, "glossary"), true);
  assert.equal(isSoftDeletedResource({ status: "deleted" }, "chapter"), true);
  assert.equal(isSoftDeletedResource({ lifecycleState: "active" }, "project"), false);
});

test("active child inside soft-deleted project is read-only", () => {
  const policy = getProjectWritePolicy({
    team: writerTeam,
    project: { id: "project-1", lifecycleState: "deleted" },
    chapter: { id: "chapter-1", status: "active" },
    row: { rowId: "row-1", lifecycleState: "active" },
  });

  assert.equal(policy.allowed, false);
  assert.equal(policy.reason, "parentSoftDeleted");
  assert.equal(policy.message, READ_ONLY_DELETED_MESSAGE);
});

test("viewer read-only and deleted-object read-only return distinct reasons", () => {
  const viewerPolicy = getProjectWritePolicy({
    team: viewerTeam,
    project: { id: "project-1", lifecycleState: "active" },
  });
  const deletedPolicy = getProjectWritePolicy({
    team: writerTeam,
    project: { id: "project-1", lifecycleState: "active" },
    row: { rowId: "row-1", lifecycleState: "deleted" },
  });

  assert.equal(viewerPolicy.allowed, false);
  assert.equal(viewerPolicy.reason, "viewer");
  assert.match(viewerPolicy.message, /Read-only users/);
  assert.equal(deletedPolicy.allowed, false);
  assert.equal(deletedPolicy.reason, "softDeleted");
  assert.equal(deletedPolicy.message, READ_ONLY_DELETED_MESSAGE);
});

test("viewer can local hard-delete top-level resources", () => {
  const policy = getProjectWritePolicy({
    team: viewerTeam,
    project: { id: "project-1", lifecycleState: "deleted" },
    actionKind: "localHardDelete",
  });

  assert.equal(policy.allowed, true);
});

test("translator can write chapter, glossary, and QA content", () => {
  assert.equal(getProjectWritePolicy({ team: translatorTeam }).allowed, true);
  assert.equal(getGlossaryWritePolicy({ team: translatorTeam }).allowed, true);
  assert.equal(getQaListWritePolicy({ team: translatorTeam }).allowed, true);
});

test("translator cannot manage resources but admin can", () => {
  assert.equal(
    getProjectWritePolicy({ team: translatorTeam, actionKind: "restoreProject" }).allowed,
    false,
  );
  assert.equal(
    getGlossaryWritePolicy({ team: translatorTeam, actionKind: "restoreGlossary" }).allowed,
    false,
  );
  assert.equal(
    getQaListWritePolicy({ team: translatorTeam, actionKind: "restoreQaList" }).allowed,
    false,
  );

  assert.equal(
    getProjectWritePolicy({ team: adminTeam, actionKind: "restoreProject" }).allowed,
    true,
  );
  assert.equal(
    getGlossaryWritePolicy({ team: adminTeam, actionKind: "restoreGlossary" }).allowed,
    true,
  );
  assert.equal(
    getQaListWritePolicy({ team: adminTeam, actionKind: "restoreQaList" }).allowed,
    true,
  );
});
