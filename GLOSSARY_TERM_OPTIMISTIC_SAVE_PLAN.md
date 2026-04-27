# Glossary Term Optimistic Save Plan

## Objective

Make glossary term edits feel immediate.

Today, saving a term can take 6-10 seconds because the UI waits for:

1. forced glossary editor repo sync,
2. local term upsert,
3. glossary repo sync to remote,
4. full glossary editor reload.

The target behavior is:

- user clicks Save,
- modal closes quickly,
- the term list immediately shows the edited term,
- background work syncs and confirms the change,
- stale remote/conflict cases are handled without silently losing the user's draft.
- if the user navigates back to the editor before the background save finishes, the save continues without pulling the user back to the glossary editor.

## Current Flow

The main save path is `submitGlossaryTermEditor` in:

- `src-ui/app/glossary-term-draft.js`

Current important safety behavior:

- `maybeStartGlossaryBackgroundSync(render, { force: true })` runs before upsert.
- If the term becomes `freshness: "stale"` or `remotelyDeleted`, save is blocked.
- The latest remote term is loaded before editing stale data.
- If post-upsert remote sync fails, `rollback_gtms_glossary_term_upsert` is attempted.
- The editor reloads via `loadSelectedGlossaryEditorData(render)`.

That safety should remain. The main change is the timing of the visible UI update.

## Non-Goals

- Do not remove stale remote detection.
- Do not remove rollback behavior after sync failure.
- Do not change the Tauri storage format.
- Do not rewrite glossary background sync broadly.
- Do not optimize delete in the first pass unless it naturally falls out of the same coordinator.
- Do not introduce TanStack Query to the glossary editor in this step.

## Target Design

Add a term-level optimistic write coordinator for glossary editor terms.

Each save creates a write intent keyed by:

```text
glossary-term:save:<glossaryId>:<termId-or-clientId>
```

The coordinator should:

- patch `state.glossaryEditor.terms` immediately,
- close the modal immediately,
- mark the visible term as pending,
- run the existing conservative sync/upsert/sync-confirm flow in the background,
- clear the pending marker after confirmation,
- rollback or reopen the modal if the background flow detects stale remote state or fails.

For existing terms, the optimistic patch replaces the visible term.

For new terms, create a temporary client term id, insert it immediately, then replace it with the real `termId` returned by `upsert_gtms_glossary_term`.

## New Term State Fields

Add lightweight UI-only fields to visible terms:

- `pendingMutation: "save" | "create" | null`
- `pendingError: string`
- `optimisticClientId: string | null`

These fields should not be persisted to glossary term JSON.

Rendering can use them later for subtle UI state. The first implementation can simply keep the row visible and avoid disabling the whole editor.

## Stage 1: Extract Pure Term Patch Helpers

Create helpers, probably in `src-ui/app/glossary-term-sync.js` or a new `src-ui/app/glossary-term-optimistic.js`:

- `buildGlossaryTermFromDraft(draftSnapshot, options)`
- `upsertVisibleGlossaryTerm(term, options)`
- `replaceOptimisticGlossaryTerm(clientId, confirmedTerm)`
- `markVisibleGlossaryTermPending(termId, mutation)`
- `markVisibleGlossaryTermConfirmed(termId, confirmedTerm)`
- `markVisibleGlossaryTermFailed(termId, message)`
- `removeVisibleGlossaryTerm(termId)`

Requirements:

- preserve current sort/order behavior unless the existing editor already sorts elsewhere,
- update `termCount` correctly for creates,
- normalize term shape through existing `normalizeGlossaryTerm`,
- avoid storing UI-only pending fields in local glossary term files.

Tests:

- existing term patch replaces visible term immediately,
- new term insert increments `termCount`,
- replacing temporary id with confirmed id does not duplicate the term,
- failed create removes or marks the optimistic row,
- failed update keeps the user-visible draft available for retry.

## Stage 2: Add A Glossary Term Write Coordinator

Add a small coordinator, likely:

- `src-ui/app/glossary-term-write-coordinator.js`

It can reuse `createWriteIntentCoordinator` from:

- `src-ui/app/write-intent-coordinator.js`

Scopes:

- existing/new term saves should serialize per glossary repo:

```text
glossary-repo:<installationId>:<repoName>
```

Reason:

- the repo head and rollback SHA are shared per glossary repo,
- two local term writes in the same glossary should not race each other through git sync/push.

Exports:

- `glossaryTermSaveIntentKey(glossaryId, termIdOrClientId)`
- `glossaryTermWriteScope(team, repoName)`
- `requestGlossaryTermWriteIntent(intent, operations)`
- `getGlossaryTermWriteIntent(key)`
- `anyGlossaryTermWriteIsActive()`
- `resetGlossaryTermWriteCoordinator()`

Tests:

- term writes in the same glossary serialize,
- term writes in different glossaries can run independently,
- same key coalesces to the latest draft,
- pending/running intents are not cleared by stale reloads.

## Stage 3: Make Save Optimistic

Change `submitGlossaryTermEditor`:

1. Validate permissions, tombstone state, source terms, and duplicate source terms synchronously as today.
2. Build a `draftSnapshot`.
3. Create an optimistic visible term.
4. Patch `state.glossaryEditor.terms` immediately.
5. Reset/close `state.glossaryTermEditor`.
6. Render.
7. Queue the background write intent.

The background write should still run:

1. `maybeStartGlossaryBackgroundSync(render, { force: true })`
2. stale/current-term check
3. `upsert_gtms_glossary_term`
4. `syncSingleGlossaryForTeam`
5. rollback if the remote sync reports an issue
6. confirmation patch using returned term data

Important change:

- Do not call `loadSelectedGlossaryEditorData(render)` on every successful save.
- Patch the confirmed returned term locally instead.
- Allow normal background sync to catch later external changes.

Tests:

- save closes modal before forced sync resolves,
- visible term updates before `upsert_gtms_glossary_term` resolves,
- successful upsert clears pending state without full editor reload,
- new term save shows immediately with temporary id and later gets confirmed id,
- no `load_gtms_glossary_editor_data` call on successful optimistic save.

## Stage 4: Handle Stale Remote During Background Save

If forced sync marks the same term stale before upsert:

- keep the user draft available,
- load the latest remote term,
- replace or mark the optimistic row as failed,
- reopen the modal with the latest remote term and a notice,
- include the user's attempted draft in state so it can be copied/reapplied.

Minimum acceptable first version:

- reopen the modal with the latest remote version and the existing remote-update notice,
- show a clear notice that the optimistic save was not committed,
- remove the pending marker from the optimistic row or replace it with the latest remote term.

Better follow-up:

- show a two-version conflict modal with "remote version" and "your attempted edit".

Tests:

- forced sync marks edited term stale, upsert is not called,
- modal reopens with remote term,
- optimistic visible term does not remain silently confirmed,
- user's attempted draft is still available in modal state or a retry buffer.

## Stage 5: Handle Upsert Or Remote Sync Failure

For failures before local upsert:

- keep/reopen the modal with the draft and error,
- mark or remove the optimistic row.

For failures after local upsert with `previousHeadSha`:

- call `rollback_gtms_glossary_term_upsert` as today,
- replace the visible row with rollback state if available,
- keep the user's draft in the modal with the rollback message.

Avoid a full editor reload unless rollback or state reconciliation requires it.

Tests:

- upsert failure restores modal with draft and error,
- remote sync failure calls rollback,
- rollback success marks visible state as not pending,
- rollback failure leaves an explicit error and does not show the term as confirmed.

## Stage 6: Background Sync Interaction

While a term write is pending/running:

- background sync should not overwrite the pending term row,
- if background sync reports that pending term changed remotely, mark the write as needing conflict handling rather than replacing it silently,
- exit sync should still run if there were local mutations.

Implementation options:

- Extend `markGlossaryTermsStale` to skip terms with `pendingMutation`.
- Or overlay active term write intents after background sync marks stale.

Prefer the smaller first step:

- if a term has `pendingMutation`, preserve its visible values and add `freshness: "stale"` only after the write finishes or fails.

Tests:

- background sync during pending save does not overwrite visible optimistic values,
- background sync can still mark other terms stale,
- after save confirmation, later background sync can mark that term stale normally.

## Stage 7: Navigation-Away Behavior

Term writes must continue after leaving the glossary editor.

Current behavior is already mostly non-canceling: once `submitGlossaryTermEditor` starts, navigating away does not automatically abort its promise. The optimistic implementation should make that behavior explicit and safer.

Requirements:

- A queued/running term save continues if the user navigates from `glossaryEditor` back to `translate`.
- Completion must not change `state.screen`.
- Completion must not force a glossary editor render over the active editor screen.
- Completion must no-op visible glossary-editor patches if `state.glossaryEditor.glossaryId` no longer matches the write's original glossary id.
- Completion may update cached glossary data for that glossary if a cache layer exists.
- Success/failure can be surfaced with a notice badge, but it must not interrupt the editor.
- If the write fails after the user left the glossary editor, the user's draft must remain recoverable when they return to that glossary.

Implementation:

- Store `teamId`, `installationId`, `glossaryId`, `repoName`, and starting `screen` on each term write intent.
- Every visible-state apply path must guard:

```js
state.glossaryEditor?.glossaryId === intent.glossaryId
  && state.glossaryEditor?.repoName === intent.repoName
```

- Render calls from background completion should be scoped:
  - if still on `glossaryEditor` for the same glossary, render normally;
  - if on another screen, avoid a full render unless showing a global notice requires one.
- Do not call `loadSelectedGlossaryEditorData(render)` after a successful save if the user has left the glossary editor.
- If a failure needs the modal reopened but the user has left, store a recoverable failed draft keyed by glossary/term id and show it when that term is opened again.

Tests:

- Start a save, switch `state.screen` to `translate`, resolve the save, and assert `state.screen` remains `translate`.
- Start a save, switch to a different glossary, resolve the old save, and assert the new glossary editor state is not overwritten.
- Start a save, switch away, fail remote sync, and assert the failed draft is recoverable without opening a modal on the editor screen.
- Start two saves in the same glossary, navigate away, and assert they still serialize and complete in order.

Success criteria:

- Leaving the glossary editor never cancels a running term save.
- Background completion is scoped to the glossary that initiated the write.
- The editor screen is not visually interrupted by a glossary save finishing.

## Stage 8: UI Details

First pass:

- close modal immediately,
- keep the row visible,
- optionally show a small pending label/spinner in the term row actions area,
- keep Edit/Delete disabled only for that pending term, not the whole glossary editor.

Avoid:

- disabling the entire glossary editor during a term save,
- showing a blocking modal for the background push unless there is a conflict or error.

## Stage 9: Verification

Focused tests:

```sh
node --test --loader ./src-ui/test/raw-loader.mjs src-ui/app/glossary-background-sync.test.js src-ui/app/glossary-write-coordinator.test.js src-ui/screens/glossary-editor.test.js src-ui/screens/glossary-term-editor-modal.test.js
```

Full verification:

```sh
npm test
npm run build
```

Manual Tauri QA:

- edit an existing term and confirm the modal closes immediately,
- create a new term and confirm it appears immediately,
- save a term while remote sync is slow,
- save a term, immediately return to the translation editor, and confirm the save still completes,
- save a term, immediately return to the translation editor, and confirm the editor is not replaced by the glossary screen when the save finishes,
- save a term after another machine changed it,
- save a term while offline or with remote push failure,
- save a term, navigate away, force a sync failure, then return to the glossary and confirm the draft/error is recoverable,
- verify the term list does not flicker back to old data during background sync,
- verify the editor remains usable while one term is saving.

## Completion Definition

This work is complete when:

- glossary term save feels immediate on the happy path,
- successful saves no longer reload the whole glossary editor before updating the UI,
- stale remote term changes still block unsafe overwrites,
- failed background writes keep the user's draft recoverable,
- pending term rows are protected from background refresh overwrites,
- tests cover optimistic success, stale remote conflict, upsert failure, remote sync failure, and pending background sync interaction.
