# Editor Background Sync Plan

## Purpose

Background sync during editing exists for one reason:

- reduce merge conflicts on editor data

It does **not** exist to make the open editor page continuously reflect every disk change in real time.

That changes the design target:

- keep the editor usable and stable while open
- sync the repo in the background
- avoid silently overwriting newer remote changes
- only force user conflict resolution for translation text

## Product Decision

While the file editor is open, the editor UI should be treated as a **chapter snapshot**.

Background sync may update the local git repo on disk, but it should **not** try to live-refresh the whole editor page after every pull.

Instead:

1. sync runs in the background against the current repo
2. rows changed by sync are marked as stale in memory
3. before the user starts editing a clean row, the app reloads that row from disk
4. before saving a dirty row, the app checks whether the row became stale underneath the user

This gives us the main benefit we want:

- much lower merge-conflict risk

without the instability we do **not** want:

- whole-page rerenders during editing
- focus loss
- scroll jumps
- sidebar/body churn while typing

## Core Rules

### Rule 1: No Whole-Editor Refresh During Active Editing

A background pull/push must not replace the whole editor chapter state while the editor is open.

Allowed:

- repo sync in the background
- row-level stale markers
- non-invasive status badges

Not allowed:

- reloading the full chapter automatically
- replacing the visible row list during typing
- moving focus away from the active field

### Rule 2: Dirty Rows Must Never Be Overwritten Silently

If a row has unsaved local edits, background sync must not replace that row’s in-memory text.

If the same row changed on disk while the row is dirty:

- keep the local dirty row in memory
- mark it stale/conflicted for save-time handling

### Rule 3: Clean Rows Must Be Fresh Before Edit

If a row is clean and marked stale, the app must reload the latest row file from disk before turning that row into the active editable field.

That means the user should almost never begin typing into stale translation text.

### Rule 4: Save Must Be Concurrency-Aware

Every row save must verify that the row is still based on the latest known disk state.

If not:

- auto-resolve non-text differences
- materialize a conflict for translation text differences

### Rule 5: Only Translation Text Conflicts Remain User-Visible

Consistent with the conflict rules:

- translation text conflicts remain unresolved for user action
- all other row-level conflicts resolve automatically

## What Can Safely Be Stale In The UI

The editor snapshot can temporarily be stale in some display-only ways without breaking correctness.

Examples:

- comment counts
- unread comment state
- reviewed / please-check badge appearance
- source word counts
- search/filter result counts
- row ordering
- deleted-group structure
- newly inserted rows that arrived remotely

These may be visually behind the repo for a while, but they must be revalidated before any write that depends on them.

## What Must Be Fresh Before A Write

These must be checked against current disk state before the app writes:

- translation text
- reviewed flag
- please-check flag
- row lifecycle changes
- inserted row anchor context
- restore / permanent delete actions that depend on current row existence

## Row Freshness Model

Each loaded row should carry a freshness state in frontend memory.

Suggested fields:

- `baseCommitSha` or `chapterBaseCommitSha`
- `diskRevisionToken`
- `freshness`
  - `fresh`
  - `stale`
  - `dirty`
  - `staleDirty`
  - `conflict`

Recommended token:

- store the repo `HEAD` commit sha at chapter load
- also store a row-level revision token derived from the row file

The row token can be:

- a row file content hash
- or a row-local revision field if we add one later

For implementation simplicity, a row file content hash is the best first step.

## Scheduler Rules

These rules reflect the earlier product decisions.

### Normal Background Scheduling

When editing a file or glossary:

- after every `5` new local commits in that repo, call `maybeStartSync()`
- if sync conditions are not met, keep checking every `10` seconds

### Idle Requirement

Do not start sync until:

- the window has not scrolled for at least `10` seconds

### Forced Sync Points

Must sync when:

- entering the file editor
- exiting the file editor
- entering the glossary editor
- exiting the glossary editor

When editing a file or glossary:

- sync only that active repo
- do not sync unrelated repos

## Background Sync Behavior While The Editor Is Open

When `maybeStartSync()` runs for the active editor repo:

1. flush pending local row saves first
2. run git sync in the background
3. detect what changed on disk
4. update row freshness state in memory
5. do **not** replace the full editor chapter snapshot

The goal is:

- sync the repo
- track staleness
- defer visible row replacement until the user interacts with a specific row

## Structural Change Rules

Insertions and deletions should be handled more simply than text edits.

### Remote Insertions

Remote row insertions do **not** need to appear immediately in the open editor.

Handling:

- do not inject newly inserted rows into the open editor snapshot
- mark the chapter as having deferred structural changes
- show the new rows only after:
  - chapter reload
  - chapter reopen
  - explicit refresh

This is acceptable because not seeing a newly inserted row immediately does not create overwrite risk.

### Remote Deletions

Remote deletions win.

If a row is deleted remotely while the editor is open:

- do not silently keep treating that row as a normal editable row
- do not preserve local edits to that row if the deletion has already won remotely
- on the next save or row-level action, revalidate row existence

If the row no longer exists on disk:

- discard the local draft for that row
- treat the row as deleted
- remove it from active editing state

If the row still exists but its lifecycle is now deleted:

- discard the local draft for that row
- move the row into deleted state in the UI model

This matches the product decision:

- the user may temporarily see a stale deleted row in the snapshot
- but they do not get to save new edits onto a row that has already been deleted remotely

### No Live Structural Reshaping

While the editor is open:

- do not live-insert new rows into the list
- do not live-remove rows from the list during background sync

Instead:

- defer insert visibility
- enforce delete-win behavior at validation time
- apply structural refresh later

## Row Activation Flow

When the user clicks into a row field:

1. determine whether the row is `fresh`, `stale`, `dirty`, or `staleDirty`
2. if `fresh`, proceed normally
3. if `stale` and not dirty:
   - load the latest row file from disk
   - update the in-memory row
   - then activate the field
4. if `staleDirty`:
   - do not replace local text
   - keep the user’s draft
   - show stale/conflict status
   - resolve on save
5. if the row was deleted remotely:
   - do not activate normal text editing
   - discard the local draft for that row if needed
   - move the row out of active editing state

## Save Flow

Before saving a dirty row:

1. load the latest row file from disk
2. compare it with the row’s `base` version and the local draft
3. classify the outcome

### Case A: No Remote Change

- save normally
- commit
- mark row fresh

### Case B: Remote Change Only In Non-Text Row Data

Examples:

- comments revision changed
- reviewed flag changed
- please-check changed

Handling:

- auto-merge non-text according to conflict rules
- save the local text on top of the merged row

### Case C: Remote Change Includes Translation Text

Handling:

- do not overwrite silently
- create row conflict state
- preserve:
- local draft
- latest disk text
- base text

This is the only unresolved editor conflict case.

### Case D: Row Was Deleted Remotely

Handling:

- deletion wins
- do not save the local draft
- discard local row text edits for that row
- treat the row as deleted or missing
- remove the row from active editing state

This is an intentional exception to the normal local-draft-preservation rule.

## Disk Change Detection

After a background sync completes, we need to know which rows became stale.

Recommended first implementation:

1. record chapter-level `HEAD` at load time
2. after sync, compare old `HEAD` to new `HEAD`
3. if unchanged, do nothing
4. if changed:
   - compute changed row ids for the open chapter
   - compute inserted row ids for the open chapter
   - compute deleted row ids for the open chapter
   - mark changed surviving rows stale in memory
   - mark the chapter as having deferred structural changes if inserted row ids are non-empty
   - mark deleted rows as remotely deleted for validation-time handling

This should be done without rebuilding the whole chapter state.

## UI Requirements

The UI should surface row freshness with minimal disruption.

### Needed Indicators

- row stale marker
- row text conflict marker
- optional repo sync status badge
- optional chapter-level deferred-structure marker

### Not Needed

- automatic row text replacement while the user is typing
- forced page reloads
- full-row modal interruptions for stale-but-clean rows

## Backend Requirements

The backend needs row-level helpers, not just chapter-level reloads.

Needed commands:

- load one row from disk
- compute row revision token
- read changed row ids for a chapter between two commits
- read inserted and deleted row ids for a chapter between two commits
- save a row with a concurrency check against a base token

The current whole-row write path is not enough by itself because it assumes the caller already has fresh row state.

## Frontend Requirements

The frontend editor state needs explicit freshness tracking.

Needed state additions:

- chapter repo base sha
- per-row revision token
- per-row freshness state
- per-row stale/conflict badge state
- per-row remotely deleted state
- chapter deferred-structure state
- pending sync scheduler state for the active repo

## Suggested Implementation Order

### Phase 1: Scheduler

- add per-repo local commit counting
- implement `maybeStartSync()`
- gate sync on:
  - repo-specific pending count
  - 10-second scroll idle
  - active screen

### Phase 2: Repo Sync Without Editor Reload

- run pull/push in background
- do not replace editor chapter state after sync
- track old/new repo `HEAD`

### Phase 3: Row Staleness Tracking

- add base sha and row revision tokens
- mark rows stale after sync when their files changed
- track inserted row ids and deleted row ids separately

### Phase 4: Reload-On-Activate

- before entering edit on a clean stale row, reload latest row from disk

### Phase 5: Structural Deferral And Delete-Win Validation

- defer visibility of remotely inserted rows
- validate remotely deleted rows on save and row actions
- discard local drafts for rows deleted remotely

### Phase 6: Save-Time Concurrency Check

- save row against a base token
- auto-merge non-text changes
- create text conflict state when needed

### Phase 7: Conflict UI

- show row text conflict state
- provide later conflict resolution workflow

## Relevant Existing Files

Frontend:

- `src-ui/app/editor-chapter-load-flow.js`
- `src-ui/app/editor-persistence-flow.js`
- `src-ui/app/input-handlers.js`
- `src-ui/app/state.js`
- `src-ui/app/editor-screen-model.js`
- `src-ui/app/project-discovery-flow.js`
- `src-ui/app/project-repo-sync-flow.js`

Backend:

- `src-tauri/src/project_import/chapter_editor.rs`
- `src-tauri/src/project_import/chapter_editor_comments.rs`
- `src-tauri/src/project_repo_sync.rs`

## Main Risk To Avoid

The dangerous version of this feature is:

- repo sync changes disk
- UI stays stale
- save path writes stale in-memory row state back over newer disk content

This plan is specifically designed to avoid that failure mode.

## Summary

The editor should behave like this:

- chapter view is a stable snapshot
- repo sync happens in background
- changed rows become stale, not auto-reloaded
- remotely inserted rows are deferred until later refresh
- remotely deleted rows win and discard local edits to those rows
- clean stale rows refresh before edit
- dirty stale rows resolve on save
- only translation text conflicts remain user-visible

That gives us the benefit of background git sync without turning the editor into a constantly mutating live view.
