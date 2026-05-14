# Glossary And QA List Editor Cache Plan

## Goal

Speed up opening the glossary editor and QA list editor by showing the correct cached editor data immediately, then refreshing from local disk and related safety checks in the background.

The editor must never show cached data from another glossary/QA list, another repo, or another team.

## Design Direction

Use TanStack Query as the cache owner for glossary editor and QA list editor payloads. Keep `state.glossaryEditor` and `state.qaListEditor` as the visible UI state, but stop making them the only place where loaded editor terms live.

This matches the current direction for top-level Projects, Glossaries, and QA Lists: show exact cached data immediately, then refresh in the background.

TanStack Query should own only the loaded editor snapshot. It should not own editable UI state.

Do not store these in the query cache:

- glossary/QA term modal draft state
- search query
- transient loading/error UI state
- pending write status
- selected row or other editor-only UI state

Do not use a live `QueryObserver` to push editor cache updates directly into `state.glossaryEditor` in the first version. That pattern works better for read-mostly top-level list pages. The glossary editor is editable, so observer-driven updates would increase the risk of background refreshes overwriting visible edits.

Use this safer pattern instead:

1. `queryClient.getQueryData(key)` during open for immediate exact-cache display.
2. `queryClient.fetchQuery(options)` for the background refresh.
3. Let TanStack Query update the snapshot cache.
4. Explicitly call a guarded adapter like `maybeApplyGlossaryEditorSnapshot(payload, expectedContext)`.
5. The adapter either applies the fresh payload to visible state or leaves visible state alone.

## Query Key

Create strict keys:

```js
["glossaryEditor", team.installationId, glossaryId, repoName]
["qaListEditor", team.installationId, qaListId, repoName]
```

Do not include branch head in the first version. Including it would create more cache misses and reduce the speed benefit. Fresh background reloads will still correct stale data.

## New Query Helper

Add helper modules, likely `src-ui/app/glossary-editor-query.js` and `src-ui/app/qa-list-editor-query.js`, with parallel APIs:

- `glossaryEditorKeys.byGlossary(team, glossary)`
- `createGlossaryEditorQueryOptions(team, glossary)`
- `getCachedGlossaryEditorPayload(team, glossary)`
- `setCachedGlossaryEditorPayload(team, glossary, payload)`
- `removeGlossaryEditorQuery(team, glossary)`
- `qaListEditorKeys.byQaList(team, qaList)`
- `createQaListEditorQueryOptions(team, qaList)`
- `getCachedQaListEditorPayload(team, qaList)`
- `setCachedQaListEditorPayload(team, qaList, payload)`
- `removeQaListEditorQuery(team, qaList)`

The query functions should wrap the current Tauri commands:

- glossary: `load_gtms_glossary_editor_data`
- QA list: `load_gtms_qa_list_editor_data`

## Open Flow

Update `openGlossaryEditor` and `openQaListEditor`:

1. Resolve the requested glossary/QA list summary.
2. Set the selected editor id.
3. Set the editor screen.
4. Check TanStack Query for the exact editor cache key.
5. If exact cached payload exists, apply it to visible editor state and render `ready` immediately.
6. If no exact cache exists, keep the current loading state.
7. Start the real refresh after the first render.

The exact-cache check is the safety boundary. No fallback to the last opened glossary or QA list.

## Background Refresh Flow

After the initial render:

1. Run team-access refresh without blocking the cached display.
2. Run the tombstone check before applying fresh loaded data.
3. Fetch editor payload from disk through TanStack Query.
4. Update the query cache.
5. Apply the fresh payload only through the explicit guard adapter.

Do not let query cache updates automatically overwrite `state.glossaryEditor`.

## Guarded Apply Rules

Add adapters such as:

```js
maybeApplyGlossaryEditorSnapshot(payload, expectedContext, render)
maybeApplyQaListEditorSnapshot(payload, expectedContext, render)
```

`expectedContext` should be captured at refresh start:

```js
{
  installationId,
  teamId,
  glossaryId, // glossary only
  qaListId, // QA only
  repoName,
  navigationSource,
}
```

The adapter may apply the fresh payload to visible `state.glossaryEditor` only if all of these are true:

1. `state.screen === "glossaryEditor"`
2. the selected team still has the same `installationId`
3. the selected team still has the same `teamId`
4. `state.selectedGlossaryId === expectedContext.glossaryId`
5. `state.glossaryEditor.glossaryId === expectedContext.glossaryId`
6. `state.glossaryEditor.repoName === expectedContext.repoName`
7. the payload `glossaryId` matches `expectedContext.glossaryId`
8. no glossary term modal is open
9. no glossary term write is active
10. no glossary background sync operation is in progress
11. no locally dirty, optimistic, or pending term rows are visible
12. the tombstone check did not report that the glossary was deleted

If any of rules 1-7 fail, discard the visible apply silently. This means the user navigated away or opened a different glossary.

If any of rules 8-11 fail:

1. keep the TanStack Query cache updated
2. do not replace visible terms
3. show a scoped badge such as `Glossary refreshed. Finish the current edit to update the term list.`

If rule 12 fails, clear/block the editor with the existing deleted/error state instead of continuing to show cached data.

### Guard Predicate Implementation

Use explicit helper functions so the rules are testable:

- `glossaryEditorContextMatches(expectedContext)`
- `glossaryEditorHasOpenDraft()`
- `glossaryEditorHasActiveTermWrite()`
- `glossaryEditorHasActiveBackgroundSync()`
- `glossaryEditorHasPendingLocalTerms()`
- `canApplyGlossaryEditorSnapshot(expectedContext)`

Version 1 should use these exact predicates:

```js
function glossaryEditorContextMatches(expectedContext) {
  const selectedTeam = getSelectedTeamSomehow();
  return (
    state.screen === "glossaryEditor"
    && selectedTeam?.id === expectedContext.teamId
    && selectedTeam?.installationId === expectedContext.installationId
    && state.selectedGlossaryId === expectedContext.glossaryId
    && state.glossaryEditor?.glossaryId === expectedContext.glossaryId
    && state.glossaryEditor?.repoName === expectedContext.repoName
  );
}

function qaListEditorContextMatches(expectedContext) {
  const selectedTeam = getSelectedTeamSomehow();
  return (
    state.screen === "qaListEditor"
    && selectedTeam?.id === expectedContext.teamId
    && selectedTeam?.installationId === expectedContext.installationId
    && state.selectedQaListId === expectedContext.qaListId
    && state.qaListEditor?.qaListId === expectedContext.qaListId
    && state.qaListEditor?.repoName === expectedContext.repoName
  );
}

function glossaryEditorPayloadMatches(payload, expectedContext) {
  return (
    payload?.glossaryId === expectedContext.glossaryId
    && (
      !payload?.repoName
      || payload.repoName === expectedContext.repoName
    )
  );
}

function qaListEditorPayloadMatches(payload, expectedContext) {
  return (
    (payload?.qaListId === expectedContext.qaListId || payload?.id === expectedContext.qaListId)
    && (
      !payload?.repoName
      || payload.repoName === expectedContext.repoName
    )
  );
}

function glossaryEditorHasOpenDraft() {
  return state.glossaryTermEditor?.isOpen === true;
}

function qaListEditorHasOpenDraft() {
  return state.qaTermEditor?.isOpen === true;
}

function glossaryEditorHasActiveTermWrite() {
  return anyGlossaryTermWriteIsActive();
}

function qaListEditorHasActiveTermWrite() {
  return qaListTermWriteIsActive();
}

function glossaryEditorHasActiveBackgroundSync() {
  return glossaryBackgroundSyncIsActive() || glossaryBackgroundSyncNeedsExitSync();
}

function glossaryEditorHasPendingLocalTerms() {
  return (state.glossaryEditor?.terms ?? []).some((term) =>
    term?.pendingMutation === "save"
    || term?.pendingMutation === "create"
    || Boolean(term?.optimisticClientId)
    || Boolean(term?.pendingError)
  );
}

function qaListEditorHasPendingLocalTerms() {
  return (state.qaListEditor?.terms ?? []).some((term) =>
    term?.pendingMutation === "save"
    || term?.pendingMutation === "create"
    || Boolean(term?.optimisticClientId)
    || Boolean(term?.pendingError)
  );
}
```

Current-code signal sources:

- Open draft: `state.glossaryTermEditor?.isOpen === true`.
- Active term write: `anyGlossaryTermWriteIsActive()` from `src-ui/app/glossary-term-write-coordinator.js`.
- Dirty background sync: `glossaryBackgroundSyncNeedsExitSync()` from `src-ui/app/glossary-background-sync.js`.
- Active background sync currently needs a new read helper in `src-ui/app/glossary-background-sync.js`, probably:

```js
export function glossaryBackgroundSyncIsActive() {
  return sessionMatchesCurrentGlossary() && Boolean(glossaryBackgroundSyncSession.pendingSync);
}
```

- Pending local terms: `state.glossaryEditor.terms[*].pendingMutation`, `optimisticClientId`, and `pendingError`, which are preserved by `src-ui/app/glossary-term-sync.js`.

Do not count `freshness === "stale"` or `remotelyDeleted === true` as local edits. Those are remote freshness markers. They may affect editing behavior, but they should not by themselves block applying a fresh full-editor payload.

QA list current-code signal sources:

- Open draft: `state.qaTermEditor?.isOpen === true`.
- Active term write: there is not currently a QA term write coordinator equivalent to glossary term writes. Add a small QA list editor write state instead of relying only on modal state.
- Active background sync: QA list editor load currently performs `sync_gtms_qa_list_editor_repo` directly inside `loadSelectedQaListEditorData`; there is no recurring QA list background sync session yet. For version 1, the guarded apply only needs to know whether a QA editor refresh/save/delete operation started by this flow is active.
- Pending local terms: QA terms currently do not appear to preserve `pendingMutation`, `optimisticClientId`, or `pendingError` the way glossary terms do. If we add optimistic QA term writes later, use the same fields as glossary terms. For now, `state.qaTermEditor?.isOpen === true` plus the new active-write flag is the main overwrite guard.

Add these QA-specific helpers during implementation:

```js
function qaListEditorRefreshIsActive() {
  return state.qaListEditorRefresh?.isActive === true;
}

function qaListTermWriteIsActive() {
  return state.qaListEditorWrite?.isActive === true;
}
```

The exact storage can be different, but the behavior must be testable. Do not infer active writes only from `state.qaTermEditor.status` unless that status is reliably set before every save/delete await and cleared in `finally`.

If any of these signals are ambiguous during implementation, add the smallest read helper at the owner module instead of duplicating internal state checks in the query helper.

### Guard Result Shape

Make the guarded apply return an explicit result so tests can assert behavior:

```js
{
  applied: boolean,
  reason:
    | "applied"
    | "stale-context"
    | "payload-mismatch"
    | "open-draft"
    | "active-term-write"
    | "active-background-sync"
    | "pending-local-terms"
    | "tombstoned",
}
```

Recommended order:

1. Check context.
2. Check payload identity.
3. Check tombstone result.
4. Check open draft.
5. Check active term write.
6. Check active background sync.
7. Check pending local terms.
8. Apply payload.

Only show a badge for user-actionable deferrals:

- `open-draft`
- `active-term-write`
- `active-background-sync`
- `pending-local-terms`

Do not show a badge for `stale-context` or `payload-mismatch`; those are normal race outcomes after navigation.

Use editor-specific badge text:

- glossary: `Glossary refreshed. Finish the current edit to update the term list.`
- QA list: `QA list refreshed. Finish the current edit to update the term list.`

## Avoiding Negative Consequences

### Stale Cached Terms

Cached terms may be stale for a few seconds. This is acceptable if the background refresh updates them quickly and visibly.

Show status feedback while refreshing, such as:

- `Loading cached glossary...`
- `Refreshing glossary terms...`
- `Glossary terms updated.`
- `Loading cached QA list...`
- `Refreshing QA terms...`
- `QA terms updated.`

### Wrong Glossary Data

Prevent this with the strict query key:

- team installation id
- glossary/QA list id
- repo name

Never read from cache if any key component differs.

### Overwriting User Edits

Before applying refreshed payload to visible state, run the guarded apply rules above.

If local edit activity exists:

1. Update the TanStack Query cache.
2. Do not replace `state.glossaryEditor.terms` wholesale.
3. Show a status badge explaining that the glossary refreshed in the background and will update after the current edit/save completes.

### Deleted Glossary

Cached data may briefly display for a glossary or QA list that was deleted elsewhere. Keep write paths strict:

- save/delete still check permissions
- save/delete still check tombstones
- background refresh/tombstone check clears or blocks the editor when deletion is discovered

Glossary already has `ensureGlossaryNotTombstoned`. QA lists need the equivalent guard before this cache design is considered complete. If QA lists do not currently have a tombstone guard, add `ensureQaListNotTombstoned` or document why QA list permanent deletion cannot race in the same way.

### Permission Changes

Team access refresh should not block showing cached terms, but it must still update permissions. If access was revoked, disable controls or redirect once the access refresh completes.

## Invalidation

Remove or invalidate the matching glossary editor query when:

- glossary is soft-deleted
- glossary is permanently deleted
- glossary repo binding is repaired
- local glossary repo is rebuilt
- glossary import overwrites/recreates a glossary
- glossary summary identity changes in a way that changes `glossaryId` or `repoName`

Term saves/deletes should update or invalidate the matching editor query so the cache does not immediately reintroduce stale data later.

Remove or invalidate the matching QA list editor query when:

- QA list is soft-deleted
- QA list is permanently deleted
- QA list repo binding is repaired
- local QA list repo is rebuilt
- QA list import overwrites/recreates a QA list
- QA list summary identity changes in a way that changes `qaListId` or `repoName`

QA term saves/deletes should update or invalidate the matching editor query so the cache does not immediately reintroduce stale data later.

Preferred term write behavior:

- On successful term save/delete, patch the matching query cache with the same resulting term list/count that visible state uses.
- If patching safely is awkward, invalidate/remove the matching editor query.
- Do not leave old cache data in place after a successful visible edit.

## Tests

Add tests for:

- exact cache match opens editor as `ready` immediately
- cache from another glossary/QA list is not shown
- cache from another team is not shown
- cache with different repo name is not shown
- background refresh replaces cached terms when no local edits exist
- background refresh does not overwrite visible terms when an edit is in progress
- background refresh does not overwrite visible terms when term write is active
- background refresh does not overwrite visible terms when background sync is active
- background refresh result is discarded after switching glossary/QA list
- background refresh result is discarded after switching team
- tombstone discovery after cached display transitions the editor to the deleted/error state
- lifecycle delete/invalidation removes the matching editor cache

Run these as separate glossary and QA list cases where the underlying signals differ. Do not assume a glossary-only guard automatically protects QA list editor state.

## Open Questions

- Should cached display show a subtle badge immediately, or only show the normal refresh badge?
- Should we preserve glossary editor search query when applying cached payload?
- Should the cache survive app restart, or only live in TanStack Query memory for this first version?
- Which existing glossary term pending markers should count as `glossaryEditorHasPendingLocalTerms()`?
- Do we already have enough exported background sync state, or do we need a new read helper?
- Should QA list editor get a small write coordinator like glossary terms, or a simpler `qaListEditorWrite` state flag?
- Does QA list lifecycle currently have a tombstone guard equivalent to glossaries, or do we need to add one first?
