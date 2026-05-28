# Soft-Deleted Repo Sync Performance Plan

## Summary
Soft-deleted repo skipping is primarily a performance optimization, not a strict security boundary. The app should avoid touching repos that it already knows are soft-deleted, but it should not slow down refresh, editor sync, or optimistic UI by fetching fresh team metadata before every operation.

The intended behavior is:
- Render immediately from local cache/local state.
- Use current local team metadata and in-memory state to skip known deleted repos.
- Do not fetch/pull/push/migrate repos that are already known to be deleted or tombstoned.
- Do not block useful sync just to prove a repo is still deleted.
- If stale metadata causes one unnecessary sync after another user soft-deletes a repo, accept that tradeoff; the next metadata refresh should make later refreshes skip it.

## Policy
- Treat soft-delete repo skipping as a best-effort speed optimization.
- Do not add fresh metadata requirements in front of every repo operation.
- Do not fail closed when metadata is temporarily unavailable if that would make normal refresh or editing slower.
- Distinguish local metadata reads from metadata sync:
  - use local metadata reads for fast deleted-resource filtering,
  - use normal metadata sync for ordinary refresh freshness,
  - do not call metadata sync only to decide whether to skip a resource repo.
- Keep viewer/read-only and soft-deleted write protections in the UI/write-policy layer.
- Keep local hard-delete behavior local-only.

## Shared Eligibility Helper
Create or reuse a shared helper for repo sync/migration eligibility.

A resource is not eligible for normal repo transport when any of these are true:
- `recordState === "tombstone"`
- `remoteState === "deleted"`
- `remoteState === "missing"`
- `lifecycleState === "deleted"`
- `lifecycleState === "softDeleted"`
- `status === "deleted"`

Use this helper for:
- project repo sync descriptors,
- glossary sync targets,
- QA list sync targets,
- team-resource migration scan inputs,
- editor/background sync local-state guards.

The helper should accept both metadata records and UI summaries. It should normalize casing and whitespace before comparison.

## Fast Local Metadata Reads
Add or expose no-sync metadata read paths for deleted-resource filtering:
- projects: use `listLocalProjectMetadataRecords(...)` or add an equivalent no-sync helper,
- glossaries: add `listLocalGlossaryMetadataRecords(...)` or add `listGlossaryMetadataRecords(team, { sync: false })`,
- QA lists: add `listLocalQaListMetadataRecords(...)` or add `listQaListMetadataRecords(team, { sync: false })`.

These reads should only inspect the already-local team metadata repo. They must not call `sync_local_team_metadata_repo`.

Use fresh metadata sync only in existing page refresh paths where it already happens for general discovery. Do not add new metadata sync calls solely to prove that a repo is deleted before skipping it.

## Project Refresh
- Keep the current immediate local render.
- Keep current team metadata loading behavior; do not wait longer than today before rendering.
- Ensure `buildProjectRepoSyncInput(...)` excludes known deleted/tombstoned projects.
- Keep project repo sync driven by current merged state.
- Do not show “Rebuilding local project repo state...” unless there is an actionable migration.
- If metadata is unavailable, keep cached/local projects visible and avoid adding new blocking checks.
- For fallback filtering, use this source precedence:
  1. current in-memory project state,
  2. cached project collection,
  3. local team metadata records read without sync,
  4. local hard-delete tombstones.
- Do not use GitHub remote repo listings alone to decide that a soft-deleted project is active.

## Glossary Refresh
- When metadata is available, build sync targets only from active/live/linked metadata records.
- When metadata is unavailable, keep the fast fallback, but exclude glossaries that are already known locally as deleted/tombstoned.
- Do not perform a fresh metadata pull solely to confirm soft-delete before syncing.
- Keep tombstone purge behavior for records already known from metadata.
- For fallback filtering, use this source precedence:
  1. current in-memory glossary state,
  2. cached glossary collection,
  3. local glossary metadata records read without sync,
  4. local hard-delete tombstones.
- Do not use GitHub remote repo listings alone to decide that a soft-deleted glossary is active.

## QA List Refresh
- Mirror glossary behavior.
- Replace stale comments/guards that imply QA lists do not have metadata parity.
- Use QA list metadata records for deleted/tombstone filtering when available.
- When metadata is unavailable, preserve fast fallback behavior but exclude QA lists already known locally as deleted/tombstoned.
- For fallback filtering, use this source precedence:
  1. current in-memory QA list state,
  2. cached QA list collection,
  3. local QA list metadata records read without sync,
  4. local hard-delete tombstones.
- Do not use GitHub remote repo listings alone to decide that a soft-deleted QA list is active.

## Migration
- Normal migration should skip repos currently known as deleted, soft-deleted, or tombstoned.
- Keep migration scanner filtering deleted resources.
- Do not fetch/pull/push deleted repos for migration.
- Reuse one pending migration scan result for both UI status and migration execution.
- Do not add a separate pre-scan just to decide whether to show the migration modal.
- If the scan returns no actionable migrations, do not show “Rebuilding local project repo state...”.
- If old-layout deleted repos become unreadable in practice, add a separate local-only read migration path:
  - only runs against an existing local repo,
  - does not fetch, pull, or push,
  - does not update remote state,
  - exists only to make the local deleted repo readable.
- Do not implement local-only deleted-repo migration until a real unreadable case is confirmed.

## Editor And Background Sync
- Do not fetch fresh team metadata before editor background sync.
- Add cheap local-state guards:
  - project editor background sync stops if current project or chapter is already marked deleted in app state,
  - glossary background sync stops if the current glossary is already marked deleted in app state,
  - QA list editor sync stops if the current QA list is already marked deleted in app state.
- If normal metadata refresh later marks the open resource deleted, stop further background sync and surface read-only state.
- When background sync is blocked because the resource is known deleted:
  - do not close the editor,
  - do not force a reload,
  - preserve the visible content,
  - mark the editor/resource read-only,
  - let normal navigation or refresh reconcile the final visible state.
- Do not slow down normal active editing.

## Backend Backstop
- Add lifecycle fields to frontend sync descriptors where practical:
  - `lifecycleState`,
  - `recordState`,
  - `remoteState`,
  - `status`.
- Backend sync commands should cheaply skip descriptors that are already marked deleted/tombstoned by the command payload.
- The backend skip should be local to the payload/current local state and should not fetch team metadata.
- Use a non-error result such as `skippedDeleted` or `upToDate` with a message so callers do not surface failure badges for intentional skips.
- Do not make backend sync commands pull fresh team metadata before every operation.
- If adding lifecycle fields to a specific descriptor becomes too invasive, defer that backend backstop for that resource type rather than adding fresh metadata pulls.

## Tests
- Project sync target tests:
  - deleted/tombstoned projects are excluded,
  - active projects still sync without waiting for fresh metadata.
- Glossary sync target tests:
  - known deleted glossaries are excluded,
  - metadata-unavailable fallback does not include known local deleted glossaries.
- QA list sync target tests:
  - known deleted QA lists are excluded,
  - QA metadata tombstone behavior matches glossary behavior.
- Migration tests:
  - deleted project/glossary/QA candidates are not submitted as actionable migrations,
  - missing local repos do not produce migration modals.
- Editor/background sync tests:
  - background sync does not run when the currently open resource is already marked deleted,
  - active editor resources still sync without a fresh team metadata pull.
- Negative command-call tests:
  - known deleted project editor state does not invoke `sync_gtms_project_editor_repo`,
  - known deleted glossary editor state does not invoke `sync_gtms_glossary_editor_repo`,
  - known deleted QA list editor state does not invoke `sync_gtms_qa_list_editor_repo`,
  - known deleted glossaries are not passed to `sync_gtms_glossary_repos`,
  - known deleted QA lists are not passed to `sync_gtms_qa_list_repos`.

## Expected Result
- Refresh stays fast.
- Known soft-deleted repos are skipped in the common case.
- Optimistic UI remains responsive.
- The app avoids unnecessary repo transport when local metadata already says a resource is deleted.
- Stale metadata may allow one unnecessary sync, which is acceptable under this policy.
