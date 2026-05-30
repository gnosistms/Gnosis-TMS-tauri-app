import { canEditProjectFileContent } from "./resource-capabilities.js";
import {
  findSoftDeletedAncestor,
  getProjectWritePolicy,
  isSoftDeletedResource,
  readOnlyMessageFor,
} from "./resource-write-policy.js";
import { findChapterContextById, selectedProjectsTeam } from "./project-context.js";
import { invoke } from "./runtime.js";
import { state } from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";

export const EDITOR_PERMISSION_DENIED_MESSAGE =
  "Cannot save changes: your account type cannot edit chapter content.";

export function createEditorWritePermissionSnapshot() {
  return {
    teamId: null,
    installationId: null,
    projectId: null,
    chapterId: null,
    membershipRole: "",
    canEditProjectFiles: false,
    capturedAt: null,
    source: "",
  };
}

export function createEditorWriteLockState() {
  return {
    status: "idle",
    reason: "",
    message: "",
    lockedAt: null,
  };
}

export function captureEditorWritePermissionSnapshot({ team, project, chapter } = {}) {
  return {
    teamId: team?.id ?? null,
    installationId: Number.isFinite(team?.installationId) ? team.installationId : null,
    projectId: project?.id ?? null,
    chapterId: chapter?.id ?? null,
    membershipRole: String(team?.membershipRole ?? team?.role ?? "").trim(),
    canEditProjectFiles: currentTeamAllowsEditorWrite(team),
    capturedAt: new Date().toISOString(),
    source: "open-chapter",
  };
}

export function normalizeEditorWritePermissionSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return createEditorWritePermissionSnapshot();
  }

  return {
    ...createEditorWritePermissionSnapshot(),
    teamId: snapshot.teamId ?? null,
    installationId: Number.isFinite(snapshot.installationId) ? snapshot.installationId : null,
    projectId: snapshot.projectId ?? null,
    chapterId: snapshot.chapterId ?? null,
    membershipRole: String(snapshot.membershipRole ?? "").trim(),
    canEditProjectFiles: snapshot.canEditProjectFiles === true,
    capturedAt: typeof snapshot.capturedAt === "string" ? snapshot.capturedAt : null,
    source: typeof snapshot.source === "string" ? snapshot.source : "",
  };
}

export function normalizeEditorWriteLockState(writeLock) {
  if (!writeLock || typeof writeLock !== "object") {
    return createEditorWriteLockState();
  }

  return {
    ...createEditorWriteLockState(),
    status: writeLock.status === "locked" ? "locked" : "idle",
    reason: typeof writeLock.reason === "string" ? writeLock.reason : "",
    message: typeof writeLock.message === "string" ? writeLock.message : "",
    lockedAt: typeof writeLock.lockedAt === "string" ? writeLock.lockedAt : null,
  };
}

export function editorWriteLockIsActive(editorChapter = state.editorChapter) {
  return normalizeEditorWriteLockState(editorChapter?.writeLock).status === "locked";
}

export function editorSessionCanWrite(editorChapter = state.editorChapter) {
  if (editorWriteLockIsActive(editorChapter)) {
    return false;
  }

  const snapshot = normalizeEditorWritePermissionSnapshot(editorChapter?.writePermissionSnapshot);
  if (!snapshot.source && !snapshot.capturedAt) {
    return currentTeamAllowsEditorWrite(selectedProjectsTeam());
  }
  return snapshot.canEditProjectFiles === true;
}

export function currentTeamAllowsEditorWrite(team) {
  return canEditProjectFileContent(team);
}

export function assertEditorWritePermissionForContext({
  team = null,
  project = null,
  chapter = null,
  row = null,
  actionKind = "sharedWrite",
} = {}) {
  const lifecyclePolicy = getProjectLifecycleWritePolicy({
    team,
    project,
    chapter,
    row,
    actionKind,
  });
  if (!lifecyclePolicy.allowed) {
    throw new Error(lifecyclePolicy.message || readOnlyMessageFor(lifecyclePolicy.reason, "project"));
  }

  if (actionKind === "localHardDelete" || currentTeamAllowsEditorWrite(team)) {
    return { allowed: true, reason: "allowed", message: "" };
  }

  const policy = getProjectWritePolicy({
    team,
    project,
    chapter,
    row,
    actionKind,
  });
  if (policy.reason === "viewer" || !currentTeamAllowsEditorWrite(team)) {
    throw permissionDeniedError();
  }

  throw new Error(policy.message || readOnlyMessageFor(policy.reason, "project"));
}

export function getProjectLifecycleWritePolicy({
  team = null,
  project = null,
  chapter = null,
  row = null,
  actionKind = "sharedWrite",
} = {}) {
  if (actionKind === "localHardDelete" || actionKind === "permanentRow") {
    return { allowed: true, reason: "allowed", message: "" };
  }

  if (!team || !project || !chapter) {
    return {
      allowed: false,
      reason: "missing",
      message: readOnlyMessageFor("missing", "project"),
    };
  }

  if (actionKind === "restoreRow") {
    if (isSoftDeletedResource(team, "team") || isSoftDeletedResource(project, "project")) {
      return {
        allowed: false,
        reason: "parentSoftDeleted",
        message: readOnlyMessageFor("parentSoftDeleted", "project"),
      };
    }
    return { allowed: true, reason: "allowed", message: "" };
  }

  const ancestor = findSoftDeletedAncestor({ team, project, chapter });
  if (ancestor) {
    return {
      allowed: false,
      reason: ancestor.kind === "project" || ancestor.kind === "team" ? "parentSoftDeleted" : "softDeleted",
      message: readOnlyMessageFor("softDeleted", "project"),
    };
  }

  if (isSoftDeletedResource(row, "row")) {
    return {
      allowed: false,
      reason: "softDeleted",
      message: readOnlyMessageFor("softDeleted", "project"),
    };
  }

  return { allowed: true, reason: "allowed", message: "" };
}

function permissionDeniedError(message = EDITOR_PERMISSION_DENIED_MESSAGE) {
  const error = new Error(message);
  error.code = "EDITOR_PERMISSION_DENIED";
  error.isEditorPermissionDenied = true;
  return error;
}

export function isEditorPermissionDeniedError(error) {
  if (error?.isEditorPermissionDenied === true || error?.code === "EDITOR_PERMISSION_DENIED") {
    return true;
  }

  const message = String(error?.message ?? error ?? "").toLowerCase();
  return (
    message.includes("read-only")
    || message.includes("read only")
    || message.includes("viewer")
    || message.includes("cannot mutate project files")
    || message.includes("cannot modify project files")
    || message.includes("permission denied")
    || message.includes("forbidden")
  );
}

export function setEditorPermissionWriteLock({
  message = EDITOR_PERMISSION_DENIED_MESSAGE,
  reason = "roleChangedToViewer",
} = {}) {
  if (!state.editorChapter?.chapterId) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    writeLock: {
      status: "locked",
      reason,
      message,
      lockedAt: new Date().toISOString(),
    },
    rows: applyEditorPermissionLockToPendingRows(state.editorChapter.rows, message),
  };
}

export function clearEditorPermissionWriteLock() {
  if (!state.editorChapter?.chapterId) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    writeLock: createEditorWriteLockState(),
  };
}

export function applyEditorPermissionLockToPendingRows(rows = [], message = EDITOR_PERMISSION_DENIED_MESSAGE) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    if (!row || typeof row !== "object") {
      return row;
    }

    const nextRow = { ...row };
    if (nextRow.saveStatus === "saving" || nextRow.saveStatus === "dirty") {
      nextRow.saveStatus = "error";
      nextRow.saveError = message;
    }
    if (nextRow.markerSaveState?.status === "saving") {
      nextRow.markerSaveState = {
        ...nextRow.markerSaveState,
        status: "error",
        error: message,
      };
    }
    if (nextRow.textStyleSaveState?.status === "saving") {
      nextRow.textStyleSaveState = {
        ...nextRow.textStyleSaveState,
        status: "error",
        error: message,
      };
    }
    return nextRow;
  });
}

export function handleEditorPermissionDenied(error, render) {
  if (!isEditorPermissionDeniedError(error)) {
    return false;
  }

  const message = EDITOR_PERMISSION_DENIED_MESSAGE;
  setEditorPermissionWriteLock({ message });
  showNoticeBadge(message, render, 3600);
  render?.();
  return true;
}

export function assertCurrentEditorWritePermission({ actionKind = "sharedWrite", rowId = null } = {}) {
  return assertEditorWritePermission({ actionKind, rowId, useSessionSnapshot: false });
}

export function assertEditorSessionWritePermission({ actionKind = "sharedWrite", rowId = null } = {}) {
  return assertEditorWritePermission({ actionKind, rowId, useSessionSnapshot: true });
}

function assertEditorWritePermission({
  actionKind = "sharedWrite",
  rowId = null,
  useSessionSnapshot = false,
} = {}) {
  const editorChapter = state.editorChapter;
  if (!editorChapter?.chapterId) {
    throw new Error(readOnlyMessageFor("missing", "project"));
  }

  if (editorWriteLockIsActive(editorChapter)) {
    throw permissionDeniedError(normalizeEditorWriteLockState(editorChapter.writeLock).message);
  }

  const team = selectedProjectsTeam();
  const context = findChapterContextById(editorChapter.chapterId);
  const row = rowId && Array.isArray(editorChapter.rows)
    ? editorChapter.rows.find((item) => item?.rowId === rowId || item?.id === rowId)
    : null;

  if (useSessionSnapshot) {
    const lifecyclePolicy = getProjectLifecycleWritePolicy({
      team,
      project: context?.project ?? null,
      chapter: context?.chapter ?? null,
      row,
      actionKind,
    });
    if (!lifecyclePolicy.allowed) {
      throw new Error(lifecyclePolicy.message || readOnlyMessageFor(lifecyclePolicy.reason, "project"));
    }
    if (editorSessionCanWrite(editorChapter)) {
      return { allowed: true, reason: "allowed", message: "" };
    }
  }

  return assertEditorWritePermissionForContext({
    team,
    project: context?.project ?? null,
    chapter: context?.chapter ?? null,
    row,
    actionKind,
  });
}

export async function invokeEditorWriteCommand(command, payload, options = {}) {
  try {
    assertCurrentEditorWritePermission(options);
  } catch (error) {
    if (handleEditorPermissionDenied(error, options.render)) {
      throw permissionDeniedError();
    }
    throw error;
  }
  try {
    return await invoke(command, payload);
  } catch (error) {
    if (handleEditorPermissionDenied(error, options.render)) {
      throw permissionDeniedError();
    }
    throw error;
  }
}
