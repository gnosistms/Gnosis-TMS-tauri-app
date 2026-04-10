# Projects / Glossaries Page Rewrite Plan

Status as of April 10, 2026:

- this plan supersedes the old top-level page-flow direction in `local-first-repo-management-plan.md`
- the goal is a complete rewrite of the Projects and Glossaries pages
- simplicity and stability are priority #1
- the top-level page model no longer includes `pendingCreate` or resume-setup behavior

## Carry-Forward Assumptions

These decisions remain in force from the earlier refactor work:

- resource identity is stable-ID-based, not repo-name-based
- repo names are mutable metadata, not identity
- metadata/tombstone rules still apply
- top-level repo creation and permanent delete are owner-only
- only data inside git repos should remain local-first/optimistic

## New Core Rules

1. Refresh blocks all top-level writes.
2. Top-level create / rename / soft-delete / restore / permanent-delete are not optimistic.
3. A top-level write is only complete after the mutation finishes and a refresh completes.
4. Cached/local data is allowed only for read-only initial display and read fallback.
5. Local-first behavior remains allowed only for repo-internal content:
   - project chapters/files
   - glossary terms/content
6. The UI should look the same as before, but the implementation should be treated as a full rewrite.

## Replacement Strategy

This rewrite must be done as slice replacement, not helper extraction.

Rules:

- a new simple path may exist beside a legacy path only briefly
- once one top-level slice works end-to-end, delete the old slice immediately
- do not keep both optimistic and non-optimistic top-level systems alive longer than necessary
- do not keep compatibility shims just to preserve old top-level orchestration

Execution order:

1. replace one complete vertical slice
2. switch callers to the new slice
3. delete the old slice in the same pass when feasible
4. then move to the next slice

The first target is Glossaries top-level lifecycle, because it is simpler than Projects.
Projects follow after the glossary top-level cutover is complete.

## Top-Level Page Model

Top-level Projects and Glossaries pages should share one simple controller model.

Shared page state:

- `cachedData`
- `visibleData`
- `isRefreshing`
- `writeState`
- `selectedItemId`
- modal state
- `error`
- `notice`

Derived rules:

- if `isRefreshing === true`, disable create / rename / delete / restore / permanent-delete
- if `writeState !== "idle"`, disable create / rename / delete / restore / permanent-delete

No top-level pending mutation queue.
No top-level rollback engine.
No top-level optimistic local hide/show.

## Controller Responsibilities

The new shared top-level controller should own:

- initial cache-backed load
- refresh
- create
- rename
- soft-delete
- restore
- permanent-delete
- modal loading/error states
- global write-disable policy during refresh/write
- post-write full refresh

Per-resource adapters should only provide:

- labels/messages
- modal field names
- backend commands
- resource-specific data shaping
- post-success selection/open behavior

Projects may additionally layer chapter/file display on top.
Glossaries may additionally layer glossary-editor open behavior on top.

## Repo Boundary

Top-level resource lifecycle:

- slow
- synchronous
- server-synced
- non-optimistic

Repo-internal content operations:

- may remain local-first
- may remain optimistic where appropriate

This boundary must stay explicit in the rewrite.

## Staged Implementation

### Stage A: Freeze Legacy Top-Level Page Flows

- stop extending the old top-level optimistic page-flow code
- treat old top-level project/glossary page logic as legacy
- keep it only until the replacement is ready

Expected outcome:

- no more complexity is added to the old top-level page system

### Stage B: Build Shared Non-Optimistic Top-Level Controller

Status on 2026-04-10:

- started
- added a new shared controller foundation in `src-ui/app/resource-page-controller.js`
- the controller now covers:
  - cache-backed first load followed by refresh
  - explicit refresh
  - write submission that waits for mutation then refresh
  - write-disable checks during refresh/write
- added focused tests in `src-ui/app/resource-page-controller.test.js`
- added page-level controller state to global app state:
  - `state.projectsPage`
  - `state.glossariesPage`
- the Projects and Glossaries screens now already honor page-level write-disable state so refresh can block visible write controls
- existing project/glossary load flows now toggle the new page-level refresh state, even before the full rewrite lands
- glossary top-level `rename`, `softDelete`, and `restore` no longer go through the optimistic queue when triggered from the current page flow; they now use synchronous mutate-then-refresh handling on top of the new page controller state
- strict metadata-push mode now exists in `team-metadata-flow.js` so rewritten top-level page writes can fail instead of silently warning when metadata server sync does not complete
- glossary top-level create now has a strict synchronous path for the standard “new glossary” modal:
  - local bootstrap
  - remote repo creation
  - strict metadata push
  - glossary repo sync
  - full refresh
  - then success/open
- glossary TMX import now follows the same strict mutate-then-refresh model instead of local-first/background-sync
- glossary permanent delete now has a strict synchronous mutate-then-refresh path with no optimistic local hide
- the old glossary top-level pending-mutation queue, replay-on-load path, and glossary pending-create auto-resume/in-flight suppression path have been removed
- project top-level `rename`, `softDelete`, and `restore` now use strict mutate-then-refresh page writes instead of the optimistic top-level queue
- project permanent delete now uses the same strict mutate-then-refresh path as glossaries
- the old project top-level pending-mutation queue and its cache-backed replay path have been removed
- top-level `pendingCreate` / resume-setup state has now been removed from the shared page model, discovery shaping, resolution banners, and screen gating
- current rewrite direction is net-negative again: delete legacy top-level slices as soon as the synchronous replacement lands
- latest focused cleanup remains net-negative (`218 insertions, 644 deletions`) and `project-flow.js` is down to `2046` lines
- old local-first create helpers were removed from `resource-create-flow.js`, leaving only the shared create-entry guard used by the strict rewrite
- unused optimistic permanent-delete helpers were removed from `resource-lifecycle-engine.js`
- current focused rewrite diff across the active simplification files is now `192 insertions, 1085 deletions`
- project strict create was collapsed further by deleting one-off create helper layers inside `project-flow.js`
- repetitive selected-team lookups were also collapsed back onto the existing `selectedProjectsTeam()` helper instead of being repeated inline
- current focused rewrite diff across the active simplification files is now `202 insertions, 1133 deletions`
- the repeated chapter mutation skeleton in `project-flow.js` (`rename`, `delete`, `restore`, `permanentDelete`, glossary-link persistence) was collapsed into one internal helper without introducing another module

- create a brand-new shared controller for top-level resource pages
- controller surface should cover:
  - `loadFromCacheThenRefresh`
  - `refresh`
  - `create`
  - `rename`
  - `softDelete`
  - `restore`
  - `permanentDelete`
- build it without using the old optimistic mutation queue

Expected outcome:

- one shared simple controller exists for top-level page lifecycle

### Stage C: Rebuild Projects Page On The New Controller

Status on 2026-04-10:

- started
- project top-level `rename`, `softDelete`, and `restore` are already on strict mutate-then-refresh page writes
- project permanent delete is also now on the strict mutate-then-refresh path
- the old project top-level pending-mutation queue and replay path are gone
- the old project pending-create / resume-setup path is gone from the page model
- strict project create remains in place, but more delete-first cleanup is still needed inside `project-flow.js`
- `project-flow.js` is now at `1908` lines in the current worktree after removing dead top-level rewrite scaffolding and collapsing repeated chapter mutation machinery

- rewrite the Projects page top-level flow from scratch
- keep the UI appearance the same
- use cache-backed initial render plus authoritative refresh
- disable top-level writes during refresh
- wait for mutation completion plus refresh before showing success
- keep chapter/file rendering as a separate project-only adapter concern

Expected outcome:

- Projects no longer rely on the old top-level optimistic page flow

### Stage D: Rebuild Glossaries Page On The New Controller

Status on 2026-04-10:

- started
- glossary top-level `create`, `TMX import`, `rename`, `softDelete`, `restore`, and `permanentDelete` now have strict mutate-then-refresh paths
- the old glossary top-level optimistic queue, replay path, and pending-create/resume path are gone
- the remaining glossary rewrite work is to keep deleting any leftover legacy top-level scaffolding now that the synchronous path exists

Replacement note:

- do not keep the old glossary top-level optimistic queue/replay path once the new synchronous path covers the same actions
- delete old glossary top-level queue, replay, rollback, and speculative visible-state code as each action family is replaced

- rewrite the Glossaries page top-level flow from scratch
- keep the UI appearance the same
- use the same shared controller as Projects
- keep glossary-specific open/editor behavior in the adapter only
- follow the same refresh/write blocking rules as Projects

Expected outcome:

- Projects and Glossaries share one top-level interaction model

### Stage E: Delete Legacy Top-Level Optimistic Machinery

- remove the old top-level optimistic mutation queue and replay paths
- remove obsolete top-level optimistic helpers/modules
- keep only repo-internal local-first logic
- delete per-resource legacy code as part of each slice cutover, not only at the very end

Expected outcome:

- total code size and conceptual complexity drop

### Stage F: Rewrite Verification

- test cache-backed initial load
- test refresh disables all top-level writes
- test create / rename / soft-delete / restore / permanent-delete all wait for completion plus refresh
- test top-level write failures do not speculatively change visible state
- test repo-internal content editing still keeps local-first behavior
- run:
  - `npm test`
  - `npm run build`
  - `cargo check`

Expected outcome:

- the rewritten pages are simpler, deterministic, and stable

## Non-Goals

- do not preserve the old top-level optimistic mutation queue
- do not preserve top-level optimistic rollback/replay behavior
- do not preserve top-level speculative local visibility changes
- do not make top-level page actions local-first

## Definition of Done

Done means:

- Projects and Glossaries top-level pages are non-optimistic
- refresh blocks all top-level writes
- top-level writes only complete after mutation plus refresh
- UI looks the same as before
- project/glossary top-level behavior shares one controller
- local-first behavior exists only for data inside repos
