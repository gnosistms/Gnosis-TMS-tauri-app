# Projects Page Chapter Mutations: Uniform Optimistic Flow

## Goal

Setting statuses and glossaries (and any chapter/project mutation on the
projects page) should be clickable as fast as the user can move: optimistic in
the UI, saved locally, synced to the remote in the background — through one
shared pipeline, with no interaction-breaking re-renders and no transient
value reverts.

## Findings (audit 2026-07-05)

The architecture underneath is already unified and sound. Status and glossary
selects both flow through `requestProjectWriteIntent` (versioned intents,
one-at-a-time per repo scope via `write-intent-coordinator.js` +
`repo-write-queue.js`), apply optimistic state + a pending flag, and are
layered onto every incoming query snapshot until a snapshot provably contains
the written value (`applyProjectWriteIntentsToSnapshot` +
`clearConfirmedProjectWriteIntents` / `intentMatchesSnapshot`). The Rust
commands (`update_gtms_chapter_workflow_status`,
`update_gtms_chapter_glossary_links`) are symmetric metadata writes — nothing
backend-side forces two workflows.

The user-visible breakage lives at the interaction seam:

1. **Async gap before the optimistic write.**
   `persistChapterGlossaryLinks` / `persistChapterWorkflowStatus` first
   `await resolveChapterMutationContext(...)`, which awaits
   `ensureProjectNotTombstoned` — a Tauri round-trip — before
   `applyOptimistic` runs. Between the select's `change` event and the state
   write, the new value exists only in the DOM. Any render in that window
   redraws the select from state and **visibly reverts the pick**; the value
   then flips forward when the context resolves.

2. **A stream of full re-renders during a click burst.** Each write triggers
   `showProjectsStatus(render, ...)` renders at apply and success, and its
   deferred repo sync (debounced 2.5 s **per project**) emits more
   ("Syncing project repo…", "Refreshing file list…", success notice) — each
   a full `innerHTML` re-render. A native `<select>` whose element is
   replaced while its popup is open **closes**. Working across projects, the
   per-project debounce guarantees syncs fire mid-burst.

3. **Near-duplicated code.** `persistChapterWorkflowStatus` and
   `persistChapterGlossaryLinks` are ~75-line copies differing only in field,
   command, and strings — the drift risk that produced this bug class.

Rename / delete / restore already use the same intent pipeline (modal-driven,
no dropdown exposure); hard-delete and clear-deleted-files are local-only
modal flows. They keep their UX but adopt the shared helpers where they
overlap.

## Design

### D1: Optimistic apply becomes synchronous with the click

For metadata writes (status, glossary), run the synchronous guards (context
lookup, `ensureChapterMutationAllowed`, `getProjectWritePolicy`) inline, and
move the `ensureProjectNotTombstoned` check **inside the intent's `run`**
(before the invoke, still inside the serialized queue). `applyOptimistic`
then executes in the same task as the `change` event — no window in which a
render can show the stale value. A tombstoned project fails the intent
through the existing `onError` revert path.

### D2: One shared metadata-write helper

`persistChapterMetadataField(render, chapterId, spec)` in
`project-chapter-flow.js`, where `spec` provides: intent type + key builder,
chapter patch/revert (field + pending-flag names), the Tauri command + input
builder, and status/notice strings. `updateChapterWorkflowStatus` and
`updateChapterGlossaryLinks` become thin adapters (normalize/validate value,
then call the helper). Any future chapter field (e.g. QA list link — parity)
is a spec, not a fork.

### D3: Render hold while a projects-page select is engaged

New `projects-render-hold.js`: while `document.activeElement` is a
`data-chapter-status-select` / `data-chapter-glossary-select` element on the
projects screen, full renders are **deferred**, not dropped. `render()` in
main.js consults it: if held, it records a pending render and returns.
Flushes happen on: the select's `change` (after the input handler has applied
the optimistic state — so the user's own action still renders immediately),
`blur`/`focusout`, screen/team change, and a safety timeout (4 s) so a
focused-but-idle select can't stall updates indefinitely. Held renders are
coalesced into one full render at flush.

This protects the open dropdown from *all* render sources — write status
badges, sync progress, query snapshots, background refreshes — without
special-casing any of them.

### D4: Team-level quiet-period for the deferred repo sync

Replace the per-project debounce trigger with a shared per-team quiet-period:
every metadata write (any project) re-arms one 2.5 s timer; on fire, the
pending projects sync sequentially through the existing
`scheduleProjectRepoSyncAfterLocalWrite` (per-project, serialized on their
repo scopes). A click burst across projects yields zero mid-burst syncs and
one sync wave at the end. Dirty projects are tracked in a per-team map so
nothing is lost.

### D5: Status-badge noise reduction

`showProjectsStatus` calls during a burst each trigger a full render. With D3
they no longer interrupt, and coalescing at flush time absorbs the rest — no
separate throttling needed. (Row-scoped patch rendering, the editor's
`renderEditorRowScoped` analogue, is noted as a future optimization; the
virtualized window already makes full renders cheap.)

## Implementation

1. `projects-render-hold.js` + main.js integration + flush wiring in
   events.js input handling; unit tests for hold/flush semantics.
2. `persistChapterMetadataField` helper; port status + glossary onto it;
   move tombstone check into `run`; delete the two duplicated functions.
3. Deferred-sync quiet period (team-scoped dirty set + single timer).
4. Audit pass over rename/lifecycle/hard-delete flows for shared-helper
   adoption where they overlap (resolve context, status strings) — no UX
   changes.
5. Tests:
   - Unit: render-hold semantics; metadata spec adapters (value
     normalization, equality short-circuit).
   - Browser (projects-page.spec.js): selecting a glossary updates the pill
     synchronously in the same task; a full render arriving while a select
     is focused does not replace the select element (hold) and lands after
     blur; rapid alternating status/glossary selections across rows all
     stick (fixture + mocked invoke for the two metadata commands).

## Out of scope

- Editor-screen mutations (own pipeline).
- Row-scoped patch rendering for the projects list (future optimization).
- Backend changes — none needed; commands are already symmetric.
