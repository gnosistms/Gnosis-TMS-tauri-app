import { srtGroupForRow, srtGroupingEnabled } from "./editor-srt-grouping.js";
import { selectedProjectsTeam, findChapterContextById } from "./project-context.js";
import { assertCurrentEditorWritePermission } from "./editor-write-permission.js";
import { createQueuedEditorWritePermissionContext, invokeQueuedEditorWriteCommand, assertQueuedEditorRowsReady, editorChapterInvalidationKey } from "./editor-queued-write.js";
import { requestEditorOperation } from "./editor-operation-queue.js";
import { projectRepoScope } from "./repo-write-queue.js";
import { ensureEditorRowReadyForWrite } from "./editor-row-sync-flow.js";
import { renderEditorRowScoped } from "./editor-row-scoped-render.js";
import { showNoticeBadge } from "./status-feedback.js";
import { state } from "./state.js";

// Return true when this was a group action (including a failed group action),
// so callers cannot accidentally fall through and change just the first cue.
export async function applySrtGroupAction(render, rowId, action, options, operations) {
  const chapter = state.editorChapter;
  if (!srtGroupingEnabled(chapter)) return false;
  const members = srtGroupForRow(chapter, rowId);
  if (members.length < 2) return false;
  if (!(await operations.flushDirtyEditorRows(render))) return true;
  const team = selectedProjectsTeam();
  const context = findChapterContextById(chapter.chapterId);
  if (!context?.project?.name || !Number.isFinite(team?.installationId)) return true;
  try {
    for (const member of members) {
      assertCurrentEditorWritePermission({ rowId: member.rowId, actionKind: "sharedWrite" });
      if (!(await ensureEditorRowReadyForWrite(render, member.rowId))) return true;
    }
    const code = options.languageCode;
    const flagKey = action === "please-check" ? "pleaseCheck" : "reviewed";
    const enabled = action === "reviewed"
      ? !members.every((row) => row.fieldStates?.[code]?.reviewed === true)
      : !members.some((row) => row.fieldStates?.[code]?.[flagKey] === true);
    const repoScope = projectRepoScope({ team, project: context.project });
    const input = {
        installationId: team.installationId, projectId: context.project.id,
        repoName: context.project.name, chapterId: chapter.chapterId,
        commitMessage: `Update subtitle group ${action}`, operation: action === "delete" ? "delete" : "field-status",
        rows: members.map((row) => ({ rowId: row.rowId, fields: {}, baseFields: {},
          ...(action === "reviewed" || action === "please-check" ? { fieldFlags: { [code]: { [action]: enabled } } } : {}),
          ...(action === "delete" ? { lifecycleState: "deleted" } : {}),
          ...(action === "text-style" ? { textStyle: options.textStyle } : {}),
        })),
    };
    const permissionContext = createQueuedEditorWritePermissionContext({ team, project: context.project, chapter: context.chapter });
    const requested = requestEditorOperation({ repoScope, chapterScope: `${repoScope}:${chapter.chapterId}`,
      kind: "subtitleGroupAction", value: { input, permissionContext },
      metadata: { chapterId: chapter.chapterId, rowIds: members.map((row) => row.rowId) },
      invalidationKeys: [editorChapterInvalidationKey(repoScope, chapter.chapterId)],
    }, { run: async ({ value }) => {
      assertQueuedEditorRowsReady({ chapterId: chapter.chapterId, rowIds: members.map((row) => row.rowId), forbidPendingText: true });
      return invokeQueuedEditorWriteCommand("update_gtms_editor_row_fields_batch", { input: value.input }, value.permissionContext, render);
    } });
    const payload = await requested.promise;
    if (payload?.conflicts?.length) throw new Error("A subtitle has a conflict. Refresh or resolve it before changing the group.");
    if (state.editorChapter?.chapterId !== chapter.chapterId) return true;
    for (const saved of payload.rows ?? []) {
      operations.updateEditorChapterRow(saved.rowId, (row) => ({ ...row,
        fieldStates: saved.fieldStates ?? row.fieldStates,
        persistedFieldStates: saved.fieldStates ?? row.persistedFieldStates,
        textStyle: saved.textStyle ?? row.textStyle,
        persistedTextStyle: saved.textStyle ?? row.persistedTextStyle,
        lifecycleState: saved.lifecycleState ?? row.lifecycleState,
        lastUpdate: saved.lastUpdate ?? row.lastUpdate,
      }));
    }
    state.editorChapter = { ...state.editorChapter,
      wordCounts: payload.wordCounts ?? state.editorChapter.wordCounts,
      chapterBaseCommitSha: payload.chapterBaseCommitSha ?? state.editorChapter.chapterBaseCommitSha,
    };
    operations.applyEditorSelectionsToProjectState(state.editorChapter);
    if (action === "delete") render?.({ scope: "translate-body" });
    else renderEditorRowScoped(render, members.map((row) => row.rowId), "srt-group-action");
    render?.({ scope: "translate-sidebar" });
  } catch (error) {
    showNoticeBadge(error?.message ?? String(error), render);
  }
  return true;
}
