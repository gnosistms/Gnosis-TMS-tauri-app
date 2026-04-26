# App Modernization Plan

## Goal

Continue the Glossaries TanStack Query work in small, reversible steps that improve perceived speed and consistency without weakening repo-sync safety.

This plan assumes the completed Glossaries first pass:

- glossary list refresh is query-backed
- local glossary summaries seed cold opens
- stale-team snapshots are guarded
- glossary rename, soft delete, and restore are optimistic
- shared team metadata record writes are serialized through the central queue
- heavier repo operations remain conservative during refresh

## Principles

- Prefer page-by-page migration over broad rewrites.
- Keep repo conflict, tombstone, and repair semantics in existing domain flows.
- Use TanStack Query for cache, refresh, invalidation, optimistic UI, and stale-result guarding.
- Keep heavy repo operations pessimistic unless their rollback story is explicit.
- Add tests at each boundary before loosening UI guards.

## Phase 1: Projects Page TanStack Query Migration

Migrate the Projects page using the same shape as Glossaries.

Deliverables:

- Query keys and observer helpers for project list data.
- Local-first project summary seed before repo-backed refresh.
- Stale selected-team guard for query snapshots and recovery callbacks.
- Query-backed refresh and invalidation.
- Optimistic rename, soft delete, and restore.
- Reuse the central team metadata write queue.
- Keep import/create, repair/rebuild, and permanent delete conservative at first.

Success criteria:

- Project list opens with cached/local data quickly.
- Rename/delete/restore update optimistically.
- Refresh snapshots do not overwrite pending optimistic lifecycle patches.
- Existing project repo conflict and repair behavior is unchanged.

## Phase 2: Metadata Revision Checks

Add an explicit metadata base revision to query snapshots and write inputs.

Deliverables:

- Include team-metadata repo head SHA or equivalent revision in metadata list/query data.
- Pass the visible base revision into metadata writes.
- Detect revision mismatch before or during write.
- Surface a clear conflict/retry message when another app instance changed metadata.

Success criteria:

- The in-app queue protects one running app instance.
- Revision checks protect against multiple app instances or external metadata changes.
- Conflict handling is explicit instead of relying only on push failure behavior.

## Phase 3: Query-Backed Import/Create Completion

Keep the heavy repo operation pessimistic, but update query cache immediately after success.

Deliverables:

- On successful project/glossary create or import, append or replace the new resource in the relevant query cache.
- Avoid a full list refresh solely to show the new resource.
- Still run verification/refresh in the background where needed.
- Roll back local cache insertion only if post-create verification proves the resource is unusable.

Success criteria:

- Create/import feels immediate after the backend operation succeeds.
- The user does not wait for a full repo list refresh just to see the new card.
- Safety checks still catch broken local/remote binding states.

## Phase 4: Permanent Delete Cleanup State

Keep permanent delete non-optimistic, but make progress and completion state query-aware.

Deliverables:

- Represent tombstone/purge progress in query cache while deletion runs.
- Remove or mark deleted resources coherently after success.
- Keep failure states visible without requiring a full reload.
- Preserve existing confirmation and permission rules.

Success criteria:

- Permanent delete remains safe and explicit.
- The UI reflects deletion progress without jumping through a full page reload.
- Failed deletes leave enough state for retry or diagnosis.

## Phase 5: Shared Resource Lifecycle Helpers

Extract shared lifecycle wiring only after Projects and Glossaries have matching query patterns.

Deliverables:

- Small helper APIs for lifecycle query patching, rollback, and pending patch preservation.
- Shared tests for rename/delete/restore behavior.
- Keep project-specific and glossary-specific repo operations outside the generic helper.

Success criteria:

- Less duplication between Projects and Glossaries.
- The abstraction stays narrow and easy to revert.
- Domain-specific repo behavior remains readable.

## Phase 6: Background Refresh Policy

Make background refresh less intrusive.

Deliverables:

- Distinguish user-initiated refresh from background refresh in page progress UI.
- Avoid taking over page-level progress for background refreshes unless there is a user-visible consequence.
- Keep lifecycle actions available during safe refresh states.
- Preserve existing blocking behavior for heavy repo actions.

Success criteria:

- The app feels less busy during routine background sync.
- Foreground operations still show clear progress.
- Recovery, conflict, and required-update states remain visible.

## Phase 7: Dev Diagnostics

Add lightweight diagnostics for query/cache and metadata queue state.

Deliverables:

- Dev-only helpers or panel showing active query keys, fetching state, pending mutations, and metadata queue state.
- Logging around query invalidation and refresh preservation of optimistic patches.
- Minimal instrumentation that can be disabled or stripped from production behavior.

Success criteria:

- Query migrations are easier to debug.
- Race conditions become observable.
- Diagnostics do not affect production UX.

## Suggested Order

1. Projects page TanStack Query migration.
2. Metadata revision checks.
3. Query-backed import/create completion.
4. Permanent delete cleanup state.
5. Shared lifecycle helper extraction.
6. Background refresh policy cleanup.
7. Dev diagnostics.

## Non-Goals For Now

- Rewriting repository sync logic.
- Making permanent delete optimistic.
- Allowing repair/rebuild during refresh without a separate safety review.
- Introducing new dependencies beyond the existing TanStack Query core dependency.
- Broad UI redesigns unrelated to query/cache behavior.

