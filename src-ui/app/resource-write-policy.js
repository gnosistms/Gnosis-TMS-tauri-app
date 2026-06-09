import {
  canManageGlossaryResources,
  canManageProjects,
  canManageQaListResources,
  canManageTeam,
  canWriteChapters,
  canWriteGlossaries,
  canWriteQaLists,
} from "./resource-capabilities.js";

export const READ_ONLY_DELETED_MESSAGE =
  "This item is deleted and read-only. Restore it before making changes.";

export function isSoftDeletedResource(resource, kind = "") {
  if (!resource || typeof resource !== "object") {
    return false;
  }

  const normalizedKind = String(kind ?? "").trim();
  if (normalizedKind === "team") {
    return resource.isDeleted === true || resource.syncState === "deleted";
  }

  const lifecycleState = String(resource.lifecycleState ?? "").trim();
  const status = String(resource.status ?? "").trim();
  return (
    lifecycleState === "deleted"
    || lifecycleState === "softDeleted"
    || status === "deleted"
  );
}

export function readOnlyMessageFor(reason, kind = "item") {
  if (reason === "viewer") {
    if (kind === "glossary") {
      return "Read-only users cannot modify glossaries.";
    }
    if (kind === "qaList") {
      return "Read-only users cannot modify QA lists.";
    }
    return "Read-only users cannot modify project files.";
  }
  if (reason === "offline") {
    return "This action is not available while offline.";
  }
  if (reason === "busy") {
    return "Wait for the current refresh or write to finish.";
  }
  if (reason === "missing") {
    return "Could not find the selected item.";
  }
  return READ_ONLY_DELETED_MESSAGE;
}

function allowed() {
  return { allowed: true, reason: "allowed", message: "" };
}

function blocked(reason, kind) {
  return {
    allowed: false,
    reason,
    message: readOnlyMessageFor(reason, kind),
  };
}

export function canLocalHardDeleteResource(team) {
  return Boolean(team);
}

export function findSoftDeletedAncestor({
  team = null,
  project = null,
  chapter = null,
  glossary = null,
  qaList = null,
} = {}) {
  if (isSoftDeletedResource(team, "team")) {
    return { kind: "team", resource: team };
  }
  if (isSoftDeletedResource(project, "project")) {
    return { kind: "project", resource: project };
  }
  if (isSoftDeletedResource(chapter, "chapter")) {
    return { kind: "chapter", resource: chapter };
  }
  if (isSoftDeletedResource(glossary, "glossary")) {
    return { kind: "glossary", resource: glossary };
  }
  if (isSoftDeletedResource(qaList, "qaList")) {
    return { kind: "qaList", resource: qaList };
  }
  return null;
}

function roleAllowsProjectWrite(team) {
  return canWriteChapters(team);
}

function roleAllowsProjectManagement(team) {
  return canManageProjects(team);
}

function roleAllowsQaListWrite(team) {
  return canWriteQaLists(team);
}

export function getProjectWritePolicy({
  team = null,
  project = null,
  chapter = null,
  row = null,
  actionKind = "sharedWrite",
} = {}) {
  if (actionKind === "localHardDelete") {
    return canLocalHardDeleteResource(team) ? allowed() : blocked("missing", "project");
  }

  if (!team) {
    return blocked("missing", "project");
  }

  if (actionKind === "restoreProject") {
    return roleAllowsProjectManagement(team) ? allowed() : blocked("viewer", "project");
  }

  if (actionKind === "permanentChapter" || actionKind === "permanentRow") {
    return canLocalHardDeleteResource(team) ? allowed() : blocked("missing", "project");
  }

  if (actionKind === "restoreChapter" || actionKind === "restoreRow") {
    if (isSoftDeletedResource(team, "team") || isSoftDeletedResource(project, "project")) {
      return blocked("parentSoftDeleted", "project");
    }
    return (
      actionKind === "restoreChapter" ? roleAllowsProjectManagement(team) : roleAllowsProjectWrite(team)
    ) ? allowed() : blocked("viewer", "project");
  }

  const ancestor = findSoftDeletedAncestor({ team, project, chapter });
  if (ancestor) {
    return blocked(ancestor.kind === "project" || ancestor.kind === "team" ? "parentSoftDeleted" : "softDeleted", "project");
  }
  if (isSoftDeletedResource(row, "row")) {
    return blocked("softDeleted", "project");
  }

  return roleAllowsProjectWrite(team) ? allowed() : blocked("viewer", "project");
}

export function getGlossaryWritePolicy({
  team = null,
  glossary = null,
  actionKind = "sharedWrite",
} = {}) {
  if (actionKind === "localHardDelete") {
    return canLocalHardDeleteResource(team) ? allowed() : blocked("missing", "glossary");
  }
  if (!team) {
    return blocked("missing", "glossary");
  }
  if (actionKind === "restoreGlossary") {
    return canManageGlossaryResources(team) ? allowed() : blocked("viewer", "glossary");
  }
  if (isSoftDeletedResource(team, "team") || isSoftDeletedResource(glossary, "glossary")) {
    return blocked("softDeleted", "glossary");
  }
  return canWriteGlossaries(team) ? allowed() : blocked("viewer", "glossary");
}

export function getQaListWritePolicy({
  team = null,
  qaList = null,
  actionKind = "sharedWrite",
} = {}) {
  if (actionKind === "localHardDelete") {
    return canLocalHardDeleteResource(team) ? allowed() : blocked("missing", "qaList");
  }
  if (!team) {
    return blocked("missing", "qaList");
  }
  if (actionKind === "restoreQaList") {
    return canManageQaListResources(team) ? allowed() : blocked("viewer", "qaList");
  }
  if (isSoftDeletedResource(team, "team") || isSoftDeletedResource(qaList, "qaList")) {
    return blocked("softDeleted", "qaList");
  }
  return roleAllowsQaListWrite(team) ? allowed() : blocked("viewer", "qaList");
}
