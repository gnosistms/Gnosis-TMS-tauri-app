# Backup & Restore Soft-Delete Implementation Plan

## Review Summary

This plan is workable if we keep the lifecycle rules centered in the app instead of relying on GitHub repository archive. GitHub archive blocks remote writes, but it does not stop users with an existing local clone from editing or committing locally, so it is out of scope for this feature.

The cleanest implementation is to reuse the existing viewer read-only architecture and generalize it. Today the app already blocks viewers through role capability helpers, action-router write blockers, and deeper flow guards. We should keep those layers, but make the policy answer the broader question: "Is this target writable right now?"

A target is not writable if the current user role cannot perform shared writes, the target is soft-deleted, any parent is soft-deleted, the app is offline for a shared write, or the page/write coordinator is busy.

## Goals

- Soft-deleted objects are read-only in the app.
- Children of soft-deleted objects are also read-only.
- Soft-deleted top-level repos do not perform normal clone, pull, push, or background sync.
- Refresh still checks shared metadata/remote state so restored resources can reappear.
- Hard-delete for teams and top-level repo resources is local-only and allowed for viewers.
- Hard-delete never deletes GitHub organizations or repositories.
- In-repo permanent deletes remain git commits for v1.
- GitHub archive and GitHub rulesets are out of scope.

## Soft-Delete Inventory

Soft-deleted objects currently represented by the app:

- Teams: `isDeleted`
- Projects/project repos: `lifecycleState: "deleted" | "softDeleted"`
- Glossaries/glossary repos: `lifecycleState: "deleted" | "softDeleted"`
- QA lists/QA repos: `lifecycleState: "deleted"`
- Project files/chapters: chapter `status: "deleted"` and repo `lifecycle.state: "deleted"`
- Editor rows/segments: `lifecycleState: "deleted"`

Objects that are not full soft-delete lifecycle resources today:

- Glossary terms: direct committed deletes, plus stale/remotely-deleted editor states.
- QA terms: direct committed deletes, plus stale/remotely-deleted editor states.

## Core Write Policy

Add a shared write policy module, for example `src-ui/app/resource-write-policy.js`.

The policy should return structured results:

```js
{
  allowed: true | false,
  reason: "allowed" | "viewer" | "softDeleted" | "parentSoftDeleted" | "offline" | "busy" | "missing",
  message: ""
}
```

Add generic lifecycle helpers:

- `isSoftDeletedResource(resource, kind)`
- `findSoftDeletedAncestor(context)`
- `readOnlyMessageFor(reason, kind)`
- `canLocalHardDeleteResource(team)`
- `canRestoreResource(team)`

Add family-specific policy helpers:

- `getTeamWritePolicy({ team, actionKind })`
- `getProjectWritePolicy({ team, project, chapter, row, actionKind })`
- `getGlossaryWritePolicy({ team, glossary, term, actionKind })`
- `getQaListWritePolicy({ team, qaList, term, actionKind })`

Keep `src-ui/app/resource-capabilities.js` as the role-level source of truth. The new policy layer should compose role permissions with lifecycle state instead of replacing role helpers everywhere.

## Parent-Child Read-Only Rules

If a team is soft-deleted:

- Block team rename, member management, resource creation, and shared writes.
- Allow team restore where existing restore permissions allow it.
- Allow local hard-delete for all roles, including Viewer.

If a project is soft-deleted:

- Block project rename and project soft-delete.
- Block adding files, adding translations, chapter rename, chapter soft-delete, chapter restore, chapter hard-delete, glossary link changes, editor row edits, row insert/delete/restore, AI review/translate, image edits, comments, and target-language changes.
- Allow project restore where existing restore permissions allow it.
- Allow local hard-delete for all roles, including Viewer.

If a chapter is soft-deleted:

- Block chapter rename, glossary link changes, opening writable editor controls, row insert/delete/restore, and all row content writes.
- Allow chapter restore and existing in-repo permanent delete according to existing project-file permissions.

If a row is soft-deleted:

- Block row text edits, image edits, comments, history restore, AI actions, markers, conflict writes, and style writes.
- Allow row restore and existing row permanent delete according to existing project-file permissions.

If a glossary is soft-deleted:

- Block glossary rename, default selection, import, term create/edit/delete, repair/rebuild, and shared writes.
- Allow glossary restore where existing restore permissions allow it.
- Allow local hard-delete for all roles, including Viewer.

If a QA list is soft-deleted:

- Block QA list rename, default selection, import, term create/edit/delete, and shared writes.
- Allow QA list restore where existing restore permissions allow it.
- Allow local hard-delete for all roles, including Viewer.

## UI Enforcement

Replace direct role-only checks in view models with policy-derived values where lifecycle ancestry matters.

For the editor screen:

- Resolve the current `{ team, project, chapter }` once in the editor view model.
- Compute `editorReadOnly` and `editorReadOnlyMessage`.
- Use that policy result to derive row flags:
  - `canEdit`
  - `canInsert`
  - `canSoftDelete`
  - `canRestore`
  - `canPermanentDelete`
  - `canReplaceSelect`
- If the project is soft-deleted, every row is non-editable even when the row lifecycle is active.
- If the chapter is soft-deleted, every row in that chapter is non-editable even when the row lifecycle is active.
- If the row is soft-deleted, only restore/permanent-delete controls can remain, subject to existing permissions.

For projects, glossaries, QA lists, and teams:

- Use policy-derived booleans to render edit controls.
- Keep download/export controls available unless the underlying local data is missing.
- Show a deleted/read-only warning when a deleted resource or child of a deleted resource is selected:
  - "This item is deleted and read-only. Restore it before making changes."
- Keep viewer-specific messages separate:
  - "Read-only users cannot modify project files."
  - "Read-only users cannot modify glossaries."
  - "Read-only users cannot modify QA lists."

## Action Router Enforcement

Refactor existing action-router blockers rather than adding hundreds of new per-button checks.

Project actions:

- Replace `blockReadOnlyProjectWrite` in `src-ui/app/actions/project-actions.js` with `blockProjectWriteAction`.
- Classify each project action as navigation, download/export, shared-write, restore, or local-hard-delete.
- Resolve project/chapter ids from the action string and call `getProjectWritePolicy`.

Translate/editor actions:

- Replace `blockReadOnlyWriteAction` in `src-ui/app/actions/translate-actions.js` with `blockEditorWriteAction`.
- Resolve the selected project/chapter from state and row id from action prefixes when present.
- Call `getProjectWritePolicy`.

Glossary actions:

- Replace the ad hoc `writeAction && !canManageGlossaries` block in `src-ui/app/actions/glossary-actions.js` with `blockGlossaryWriteAction`.
- Resolve glossary/term context and call `getGlossaryWritePolicy`.

QA actions:

- Replace the ad hoc `writeAction && !canManageQaLists` block in `src-ui/app/actions/qa-actions.js` with `blockQaWriteAction`.
- Resolve QA list/term context and call `getQaListWritePolicy`.

Local hard-delete actions should not be classified as shared writes. They remain available to viewers.

## Flow Guard Enforcement

Keep deeper guards as the final safety net, but route them through the same policy.

Project/chapter flows:

- Update `resolveChapterMutationContext` so active chapters under deleted projects are blocked.
- Keep allowing restore/permanent-delete behavior only for the exact lifecycle state where it is intended.
- Make chapter rename, chapter soft-delete, and chapter glossary-link changes reject parent-deleted projects.

Editor flows:

- Update `ensureEditorRowReadyForWrite` so it rejects when the current project, current chapter, or target row is soft-deleted.
- Reuse this guard for persistence, image edits, history restore, comments, row structure changes, AI writes, and conflict resolution.

Glossary flows:

- Update glossary term submit/delete/open-edit flows to reject when the selected glossary is soft-deleted.
- Keep glossary restore and local hard-delete as lifecycle actions outside term-edit policy.

QA flows:

- Update QA term submit/delete/open-edit flows to reject when the selected QA list is soft-deleted.
- Keep QA list restore and local hard-delete as lifecycle actions outside term-edit policy.

This ensures stale buttons, keyboard shortcuts, or direct action dispatches do not reach Tauri write commands.

## Local Hard-Delete Model

Add a local hard-delete tombstone store outside repo-backed/shared metadata, for example `src-ui/app/local-hard-delete-store.js`.

Tombstone shape:

```js
{
  installationId,
  resourceKind: "team" | "project" | "glossary" | "qaList",
  resourceId,
  repoName,
  fullName,
  deletedAt
}
```

Matching rules:

- Always scope by `installationId`.
- Prefer stable id match.
- Fall back to `repoName` or `fullName` when id is missing.

Tombstone behavior:

- Hide locally hard-deleted top-level resources while shared metadata still says they are deleted.
- Clear the tombstone automatically when refresh sees the same resource restored to active.
- Once cleared, normal sync can clone/rebuild the local repo if it is missing.

## Top-Level Hard Delete

Projects:

- Change `confirmProjectPermanentDeletion` so it no longer writes shared metadata tombstones.
- Stop calling `permanently_delete_gnosis_project_repo`.
- Purge only the local project repo/cache, add a local tombstone, remove local visible state, and refresh.

Glossaries:

- Change `confirmGlossaryPermanentDeletion` so it no longer calls `permanentlyDeleteRemoteGlossaryRepoForTeam`.
- Stop writing shared tombstone metadata for hard-delete.
- Purge only local glossary repo/cache, add a local tombstone, clear editor/default selection as needed, and refresh.

QA lists:

- Change `confirmQaListPermanentDeletion` so it no longer calls `deleteRemoteQaListRepo`.
- Purge only local QA list repo/cache, add a local tombstone, clear selected/default state as needed, and refresh.

Teams:

- Change `confirmTeamPermanentDeletion` so it never calls `delete_organization_for_installation`.
- Purge local installation data/cache, remove local stored team record, and add a local tombstone if needed to keep the soft-deleted team hidden locally.

Keep existing Tauri/broker remote-delete commands registered for compatibility, but normal UI flows must not call them.

## Sync Behavior

Project sync:

- Update project sync target building so soft-deleted projects are excluded from `reconcile_project_repo_sync_states`.
- Continue loading metadata/remote summaries for deleted projects so restore can be detected.

Glossary sync:

- Update metadata-backed glossary sync target building so deleted lifecycle records are excluded from `sync_gtms_glossary_repos`.
- Continue loading metadata/remote summaries for deleted glossaries.

QA list sync:

- Add equivalent lifecycle filtering before `sync_gtms_qa_list_repos`.
- Continue loading remote summaries and local metadata where available.

Restore detection:

- After metadata/remote summaries are merged, call tombstone cleanup for resources whose lifecycle is active.
- Restored resources re-enter normal sync targets and clone/rebuild if local repo data is missing.

Offline behavior:

- Local hard-delete is allowed offline.
- Restore and shared writes remain blocked offline.

## In-Repo Object Policy

Keep committed git delete behavior for v1:

- project file permanent delete,
- clear deleted files,
- editor row permanent delete,
- glossary term delete,
- QA term delete.

Do not create local tombstones for these in v1. Git history remains the recovery path for in-repo objects.

## Tests

Policy tests:

- Active child inside soft-deleted project is read-only.
- Active row inside soft-deleted chapter is read-only.
- Soft-deleted row is read-only inside an active project.
- Viewer read-only and deleted-object read-only return distinct messages.
- Local hard-delete is allowed for Viewer, Translator, Admin, and Owner.
- Shared writes remain denied for Viewer.

UI tests:

- Soft-deleted project disables chapter rename/delete/glossary selectors and editor actions.
- Soft-deleted chapter opens as read-only with row editing disabled.
- Soft-deleted glossary/QA list hides or disables term edit/delete/create.
- Local hard-delete actions appear for viewers on deleted top-level resources.

Action tests:

- Direct action strings for chapter rename/delete, row edit/delete, glossary term edit, and QA term edit are blocked when a parent is soft-deleted.
- Restore and local hard-delete actions are not blocked by the parent read-only policy when intentionally allowed.

Flow tests:

- `resolveChapterMutationContext` blocks active chapters under deleted projects.
- `ensureEditorRowReadyForWrite` blocks active rows under deleted project/chapter.
- Glossary and QA term submit/delete flows do not invoke Tauri when the parent is deleted.

Hard-delete tests:

- Project/glossary/QA/team hard-delete never invokes broker remote-delete commands.
- Hard-delete writes a local tombstone and purges local data only.
- Refresh hides locally hard-deleted resources while still deleted.
- Refresh clears local tombstones and restores sync eligibility when lifecycle becomes active.

Sync tests:

- Deleted projects/glossaries/QA lists are excluded from repo sync inputs.
- Active restored resources are included again.
- Missing local restored repos trigger normal clone/rebuild.

Regression:

- Keep in-repo permanent-delete tests passing.
- Run `npm test`.
- Run `cargo test` only if Rust lifecycle or purge commands change.

## Assumptions

- GitHub archive and GitHub rulesets are not part of this feature.
- Team hard-delete is local-only and must never delete the GitHub organization.
- Top-level repo hard-delete is local-only and must never delete GitHub repos.
- Viewers can hard-delete local top-level deleted resources because it affects only their machine.
- In-repo permanent deletes remain committed git deletes for v1.
- GitHub actions outside GnosisTMS are out of scope.
