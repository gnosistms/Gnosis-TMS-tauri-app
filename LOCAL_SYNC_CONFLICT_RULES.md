# Local-First Sync Conflict Rules

This document is the short, implementation-oriented companion to
[LOCAL_SYNC_CONFLICT_INVENTORY.md](/Users/hans/Desktop/GnosisTMS/LOCAL_SYNC_CONFLICT_INVENTORY.md).

The inventory lists many concrete conflict situations. This document reduces those situations to a small set of reusable rules that can drive code and UI behavior.

## Tree Model

All sync conflicts should be interpreted against this tree:

- `Team`
- `Project`
- `Chapter`
- `Row`

In other words:

`Team -> Project -> Chapter -> Row`

This tree is the foundation for conflict handling.

## Identity Rules

Every tree element should have:

- an immutable `id`
- an immutable `slug`
- a mutable human-readable `name`

This applies to:

- Team
- Project
- Chapter

For `Row`, the stable identity is just the row id.

The app should use UUIDv7 for stable object identity wherever possible.

That means:

- Team gets a stable app-level id
- Project gets a stable `project_id`
- Chapter gets a stable `chapter_id`
- Row gets a stable `row_id`

This prevents ambiguity when:

- an object is renamed
- an object is soft-deleted
- a new object is later created with the same human-readable name

So the app must never use the display name as the true identity of an object.

## Deletion Preservation Rule

For every user other than the actor who performs the delete, incoming deletes must be preserved locally as soft deletes.

That means:

- a deleted `Team` becomes a locally preserved deleted team
- a deleted `Project` becomes a locally preserved deleted project
- a deleted `Chapter` becomes a locally preserved deleted file/chapter
- descendants of a deleted parent are preserved along with that parent

So remote delete should not mean:

- "erase this object from every machine immediately"

Instead it should mean:

- "remove this object from the active tree and move it into local deleted state"

This gives the app a strong safety rule:

- one user may delete an object from GitHub
- but that action cannot hard-delete the object on other users' machines

The only place a true hard delete happens immediately is on the actor's side and on GitHub itself.

For all other users, the object becomes:

- locally preserved
- removed from active views
- available for future restore or purge workflows

## Rename Rule

Renaming must only update the human-readable name.

It must never change:

- object id
- slug
- parent linkage
- local repo/folder binding

This means:

- Team rename changes the GitHub organization `name`
- Project rename changes `project.json.title`
- Chapter rename changes `chapter.json.title`

Because rename never changes identity or path structure, rename conflicts become simple:

- if only one side changed the name: accept that change
- if both sides changed the name to the same value: no conflict
- if both sides changed the name to different values: newest value wins

So rename should not produce user-facing conflict UI.

## The Five Conflict Types

Almost every conflict in the app should map to one of these five types.

### 1. `ParentMissing`

Meaning:

- the object’s parent no longer exists or is no longer accessible

Examples:

- Team deleted while viewing Projects
- Project deleted while editing a Chapter
- Chapter deleted while editing a Row

Handling rule:

- stop normal save behavior in the active tree
- preserve the affected subtree in local deleted state
- switch the UI out of normal edit mode
- show that the parent object was deleted and moved out of the active tree

This is the main “higher level beats lower level” rule.

### 2. `ObjectMissing`

Meaning:

- the object itself no longer exists

Examples:

- Project deleted while viewing that project
- Chapter deleted while that chapter is open
- Row deleted while editing that row

Handling rule:

- stop normal operations on that object in the active tree
- preserve the object locally in deleted state
- if there is unsaved local work, preserve it with the deleted object
- remove or replace the object in visible active lists

### 3. `ConcurrentEdit`

Meaning:

- the same field on the same object changed in two places

Examples:

- two users rename the same project differently
- two users edit the same row text
- two users change the same review-state field differently

Handling rule:

- if the values are equal, resolve automatically
- if the field has a declared automatic merge rule, apply that rule and continue sync
- if the field is row translation text, materialize a row text-conflict payload and continue sync
- only row translation text should remain unresolved for later user action

### 4. `StructuralDivergence`

Meaning:

- the object tree or ordering changed incompatibly

Examples:

- chapter order changed in two places
- row order changed in two places
- rows were inserted/deleted/reordered concurrently

Handling rule:

- do not treat this like a plain text conflict
- for chapter order, newest value wins
- for row order, merge by stable row id and rewrite normalized `order_key` values
- only escalate to `SyncFailure` if the structure cannot be parsed or normalized

### 5. `SyncFailure`

Meaning:

- sync could not complete, but the object model itself is not necessarily contradictory

Examples:

- push rejected
- pull failed
- GitHub App installation missing
- remote repo unavailable
- local repo lock busy

Handling rule:

- preserve local state
- mark the object or repo as unsynced
- allow safe read-only or local-only operations where possible
- block risky remote-dependent actions

## Generic Tree Rules

These are the most important implementation rules.

### Rule 0: Cross-Level Conflicts Resolve At The Lowest Affected Level

If two operations happen at different levels of the tree, the conflict is resolved at the lower level, not the higher one.

That means:

- the higher-level operation remains valid
- the lower-level operation must adapt

Examples:

- if a `Project` is deleted while a `Row` is being edited, the project deletion still stands
- if a `Team` is deleted while the user is viewing `Projects`, the team deletion still stands
- if a `Chapter` is deleted while a `Row` edit is open, the chapter deletion still stands

So cross-level conflicts should always be handled as an impact on the lowest affected object:

- `Team` vs `Project` -> handled at `Project`
- `Project` vs `Chapter` -> handled at `Chapter`
- `Chapter` vs `Row` -> handled at `Row`

This is the main dominance rule for the tree:

- higher-level operations dominate lower-level operations
- lower-level operations never invalidate higher-level operations

### Rule A: Higher-Level Deletion Dominates Lower-Level Editing

If a parent disappears, child edits cannot be saved normally.

This means:

- if `Team` disappears, all `Project`, `Chapter`, and `Row` editing under it is interrupted
- if `Project` disappears, all `Chapter` and `Row` editing under it is interrupted
- if `Chapter` disappears, all `Row` editing under it is interrupted

This should always be handled as `ParentMissing`, not as a separate special case per page.

Because of the deletion preservation rule, the preferred first response is:

- move the deleted subtree into local deleted state
- stop normal editing in the active tree
- preserve work for later restore/recovery

### Rule B: Identity Never Changes During Rename

Because slugs and ids are immutable:

- rename does not create path conflicts
- rename does not move an object to another parent
- rename never changes what object the UI is pointing at

So rename is always just:

`ConcurrentEdit(name)` or no conflict

### Rule C: Structural Changes and Content Changes Are Different

We should not mix these into one generic conflict path.

Structural changes:

- create child
- delete child
- reorder children
- move child

Content changes:

- edit row text
- edit notes
- change name
- change review state

This means:

- use `ConcurrentEdit` for same-field content conflicts
- use `StructuralDivergence` for order/tree conflicts

And more specifically:

- chapter order is safe to resolve with newest-wins
- row order is safe to resolve automatically by ordered merge and renormalization

### Rule D: Never Drop Unsaved Local Work

Whenever a conflict prevents a normal save:

- local edits must be preserved
- they may be stored as:
  - unsaved draft
  - orphan draft
  - unpushed local commit

But they must not be silently discarded.

### Rule E: Field-Level Merge Beats Whole-File Overwrite

Where possible:

- merge by field
- not by replacing an entire JSON file from stale state

Examples:

- project rename should only patch `title`
- chapter rename should only patch `title`
- row text save should only patch the row fields being changed

This keeps unrelated metadata edits from becoming false conflicts.

## How The Rules Apply By Level

## Team Level

Team conflicts should map like this:

- Team deleted -> `ObjectMissing`, but preserved locally as deleted team
- Team becomes inaccessible -> `ObjectMissing`
- App installation removed -> `SyncFailure`
- Team name changed in two places -> `ConcurrentEdit(name)`

Effects on descendants:

- Team deleted while in Projects/Users/Glossaries/Translate -> `ParentMissing`, with subtree preserved locally under deleted team state

## Project Level

Project conflicts should map like this:

- Project deleted -> `ObjectMissing`, but preserved locally as deleted project
- Project soft-deleted while open -> `ObjectMissing`
- Project name changed in two places -> `ConcurrentEdit(name)`
- Project added/removed/reclassified in list unexpectedly -> structural list update, usually not a conflict by itself
- Repo missing / push rejected / clone missing -> `SyncFailure`

Effects on descendants:

- Project deleted while in Translate -> `ParentMissing`, with chapter/row state preserved locally under deleted project state

## Chapter Level

Chapter conflicts should map like this:

- Chapter deleted -> `ObjectMissing`, but preserved locally as deleted chapter/file
- Chapter renamed in two places -> newest value wins
- Chapter order changed incompatibly -> newest value wins
- chapter metadata same-field change -> `ConcurrentEdit(field)`

Effects on descendants:

- Chapter deleted while editing row -> `ParentMissing`, with row state preserved locally under deleted chapter state

## Row Level

Row conflicts should map like this:

- Row deleted -> `ObjectMissing`, but preserved locally as deleted row if local state exists
- same row translation text changed locally/remotely -> `ConcurrentEdit(field)`, materialized as row text-conflict state
- same non-text row field changed locally/remotely -> `ConcurrentEdit(field)`, auto-resolved by field rule
- row order changed incompatibly -> `StructuralDivergence`, auto-resolved
- save/push failure -> `SyncFailure`

This is the only place where true user-visible conflict resolution should remain necessary.

The only unresolved row-level conflict class should be:

- row translation text conflict

## Minimal Resolution Policies

To keep the implementation simple at first, we should use these default policies.

### `ParentMissing`

Default behavior:

- exit normal edit mode in the active tree
- preserve local draft or subtree in deleted state
- show deleted-parent notice
- do not auto-recreate parent

### `ObjectMissing`

Default behavior:

- remove object from normal active UI lists
- preserve it locally in deleted state
- preserve unsaved local data if any
- allow future restore/purge flow where appropriate

### `ConcurrentEdit`

Default behavior:

- if the field is a human-readable name, newest value wins
- if the field has an automatic rule in [MERGE_CONFLICT_DATA_TYPES.md](/Users/hans/Desktop/GnosisTMS/MERGE_CONFLICT_DATA_TYPES.md), apply it silently
- if the field is row translation text, store base/local/remote values in the row conflict payload and require later user resolution in the editor

### `StructuralDivergence`

Default behavior:

- if the divergence is chapter order, newest value wins
- if the divergence is row order, merge order automatically and rewrite normalized `order_key` values
- if structure cannot be parsed or normalized, abort the rebase and mark the repo unsynced

### `SyncFailure`

Default behavior:

- keep local data
- mark object/repo unsynced
- retry later
- do not discard work

## Suggested Implementation Shape

The code should eventually use a shared conflict representation like:

```ts
type ConflictType =
  | "ParentMissing"
  | "ObjectMissing"
  | "ConcurrentEdit"
  | "StructuralDivergence"
  | "SyncFailure";
```

And a shared payload shape like:

```ts
type Conflict = {
  type: ConflictType;
  level: "team" | "project" | "chapter" | "row";
  objectId: string;
  parentId?: string;
  field?: string;
  localValue?: unknown;
  remoteValue?: unknown;
  message: string;
};
```

This lets page code stay simple:

- detect conflict
- map it to one of the five types
- render the appropriate UI

## What This Simplifies

Instead of writing unique rules for:

- project deleted while editing row
- chapter deleted while editing row
- team deleted while editing row

we write one rule:

- `ParentMissing`

And because delete is preserved locally, that rule now has a simple default response:

- move the affected lower-level work into deleted state instead of losing it

Instead of treating rename as a true conflict across Team / Project / Chapter, we write one rule:

- names are mutable labels only
- ids/slugs are stable
- newest name wins

Instead of treating all order conflicts the same, we split them:

- chapter order -> newest wins
- row order -> ordered merge plus renormalization

Instead of writing unique rename logic for:

- team rename
- project rename
- chapter rename

we write one rule:

- rename only changes display name
- conflict is `ConcurrentEdit(name)`

That is the main simplification.

## Automatic Background Sync Triggers

For project, glossary, and editor repos, the normal background-sync trigger is:

- after 5 unsynced local commits in that repo, mark the repo `sync pending` and call `maybeStartSync()`

Once a repo is `sync pending`, it stays due for sync until a successful
`pull --rebase` / `push` clears that state.

## Automatic Background Sync Gating

Threshold-driven background sync should not run the moment a local commit is
created.

For project, glossary, and editor repos, threshold-driven background
`pull --rebase` / `push` should run only when all of these are true:

- there are no unsaved in-memory editor changes
- there is no local write operation in flight
- there is no other sync job already running for that repo
- the relevant window/scroll container has not scrolled for at least 10 seconds

Any scroll event should reset the 10-second timer.

This is a scheduling rule, not a conflict-resolution rule. Its purpose is to
reduce the chance that the app rebases local commits while the user is actively
reading, navigating, or editing nearby content.

## Mandatory Editor Boundary Sync

The app must also trigger a sync attempt when:

- entering the file editor
- exiting the file editor
- entering the glossary editor
- exiting the glossary editor

These boundary-triggered sync attempts bypass:

- the 5-commit threshold
- the 10-second no-scroll gate

But they still must respect the safety constraints above:

- flush unsaved in-memory editor changes first when leaving an editor
- wait for any in-flight local write operation to finish
- serialize with any already-running sync job for that repo

If a mandatory boundary sync cannot complete, the app should preserve local
work, mark the repo unsynced, and surface the failure instead of silently
skipping it.

## Editor Sync Scope

When the user is entering or leaving an editor, the sync scope must stay narrow.

- entering or leaving the file editor should sync only the currently edited project repo
- entering or leaving the glossary editor should sync only the currently edited glossary repo

Editor entry/exit must not trigger a team-wide sync of unrelated project repos or
glossary repos.

## Production Merge Resolution Plan

### 1. One Conflict-Capable Sync Pipeline Per Repo Type

- project repos and glossary repos already sync through `pull --rebase` and `push`
- team metadata currently uses `pull --ff-only`; before shipping automatic conflict resolution, move it onto the same conflict-capable rebase pipeline
- all repo types should share the same outer sync flow and differ only in the typed file resolver that handles conflicted paths

### 2. Sync Loop

1. `maybeStartSync(repo)` acquires a per-repo sync lock.
2. Confirm the sync gating rules are still satisfied.
3. Run `git pull --rebase origin <branch>` or the equivalent fetch-plus-rebase flow.
4. If rebase stops on conflicts, list the unmerged paths.
5. Resolve each conflicted path using stage `1` / `2` / `3` blobs and the rules in [MERGE_CONFLICT_DATA_TYPES.md](/Users/hans/Desktop/GnosisTMS/MERGE_CONFLICT_DATA_TYPES.md).
6. `git add` every resolved file and run `git rebase --continue`.
7. Repeat until rebase completes or an unhandled path forces `git rebase --abort`.
8. Run `git push origin <branch>`.
9. If push is rejected because remote advanced again, retry the cycle once from the top.

### 3. File Resolver Contract

- input: repo type, relative path, base blob, local blob, remote blob
- parse JSON into the typed object model for that repo
- merge by stable IDs and field rules, never by raw line merge
- recompute all derived fields before writing
- serialize canonical JSON and stage the file
- if a file is unknown, malformed, or missing required stable IDs, fail closed and abort the sync

### 4. Manual Translation Text Conflicts

When the conflicting field is `fields[language].plain_text`:

- do not leave raw Git conflict markers in the file
- write a normal JSON row file that preserves:
  - `base_text`
  - `local_text`
  - `remote_text`
  - `detected_at`
  - the conflicting language code
- set row or field `textConflictState = unresolved`
- keep one display value in `plain_text`; use the rebasing local value so the user never loses their last local text
- force `reviewed = false`
- force `please_check = true`
- complete the rebase and push normally

### 5. Repo State After Translation Conflicts

- a repo with unresolved row translation conflicts is still `synced`, not `sync failed`
- unresolved work lives on the row data and drives the `Has conflict` filter
- `SyncFailure` is only for transport failures, unhandled files, malformed data, or resolver failures

### 6. Repo Coverage

- team metadata repo: project and glossary metadata records auto-resolve with the metadata rules
- project repos: chapter metadata, row order, review flags, comments, delete/restore, and derived counters auto-resolve; only row translation text becomes manual
- glossary repos: term variants, notes, footnotes, lifecycle, and derived flags auto-resolve

### 7. User Resolution Flow

- the editor opens rows with `textConflictState = unresolved`
- the conflict UI shows local, remote, and base text
- the user can accept local, accept remote, or write a merged text
- saving the resolution writes the chosen `plain_text`, clears the conflict payload, keeps `reviewed = false`, and leaves `please_check` unchanged until the user decides otherwise

### 8. Failure Policy

- never leave a repo in `rebase in progress` state when sync returns control
- if every conflicted path is resolved, finish the rebase and push
- if any conflicted path cannot be resolved automatically, abort the rebase, preserve local commits, and mark the repo unsynced with a concrete error

### 9. Test Plan

- unit tests for each rule group against base/local/remote triples
- resolver tests for representative team metadata, project row, row comment, and glossary term files
- sync tests where `pull --rebase` produces:
  - pure automatic resolution
  - unresolved row translation text conflict that still ends in successful push
  - malformed or unknown files that abort and mark `SyncFailure`
- editor tests for the `Has conflict` filter and the conflict-resolution flow
