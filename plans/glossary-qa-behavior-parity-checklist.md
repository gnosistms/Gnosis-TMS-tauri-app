# Glossary / QA Behavior Parity Checklist

Goal: catch QA/Glossary drift that file-level and function-level correspondence can miss. A QA function may have a matching glossary function and still render extra markup, use different cache semantics, or handle lifecycle state differently. This checklist verifies rendered behavior, branch-level intent, query/cache invariants, and regression coverage.

## Policy

- [ ] Every QA behavior that differs from Glossaries must be listed as an intentional exception.
- [ ] Every QA-only branch must be listed as an intentional exception.
- [ ] Every Glossary-only branch must be listed as an intentional exception.
- [ ] Terminology-only differences are allowed: `Glossary` -> `QA List`, `Term` -> `QA Term`.
- [ ] Data-model differences are allowed only where QA functionality requires them:
  - QA lists have one language instead of source + target.
  - QA terms have one text value plus notes instead of glossary source/target variants.
  - QA default state is per language instead of one default glossary per team.
  - QA TMX import rejects multi-language TMX files.

## Parity Ledger

- [ ] Every QA file names its Glossary counterpart.
- [ ] Every QA function names its Glossary counterpart.
- [ ] Every intentional difference has a reason.
- [ ] Any code branch not listed as an intentional difference is treated as drift.
- [ ] Any helper that exists only on one side is classified as:
  - [ ] terminology adaptation,
  - [ ] data-model adaptation,
  - [ ] intentional functional difference,
  - [ ] temporary implementation debt,
  - [ ] unintended drift to remove.

## Rendered UI Parity

Render Glossaries and QA Lists with equivalent fixtures, normalize terminology, and compare structure for these states:

- [ ] Initial loading.
- [ ] Loaded active records.
- [ ] Background refresh.
- [ ] Sync/progress badge active from the start of refresh.
- [ ] Sync error.
- [ ] Empty list.
- [ ] Deleted section hidden.
- [ ] Deleted section visible.
- [ ] Soft-deleted card.
- [ ] Restore in progress.
- [ ] Hard delete disabled.
- [ ] Hard delete enabled.

Specific UI checks:

- [ ] Deleted QA cards do not render a QA-only warning such as `This QA list is deleted.`
- [ ] Deleted cards rely on the same visual treatment and Restore/Delete actions in both pages.
- [ ] Card action order, disabled state, tooltip behavior, spinner behavior, and badge behavior match unless listed as intentional differences.
- [ ] Search, create/import buttons, refresh button, and page title layout follow the same shared header rules.
- [ ] Empty states use equivalent layout and tone after terminology normalization.

## Branch-Level Checks

For each corresponding render/helper function, inspect every conditional branch. Classify each `if`, ternary, fallback, or optional markup block as one of:

- [ ] copied equivalent,
- [ ] terminology adaptation,
- [ ] data-model adaptation,
- [ ] intentional functional difference,
- [ ] unintended drift.

Audit for suspicious one-off branches and markup names:

- [ ] `stateMarkup`
- [ ] `warning`
- [ ] `notice`
- [ ] `banner`
- [ ] `deleted message`
- [ ] `empty`
- [ ] `fallback`
- [ ] `placeholder`
- [ ] `disabledReason`
- [ ] `syncMessage`
- [ ] `statusMessage`

## Lifecycle Behavior Matrix

- [ ] Soft delete moves the item to the deleted section.
- [ ] Soft delete does not reopen the deleted section if it was closed or not visible before the click.
- [ ] Soft delete preserves the deleted section open if it was already open and visible before the click.
- [ ] Restore moves the item back to the active section.
- [ ] Restore does not create a duplicate active/deleted rendering.
- [ ] Hard delete removes the record from visible state and cache.
- [ ] Hard delete does not leave stale cached copies.
- [ ] Failed soft delete reverts optimistic state consistently.
- [ ] Failed restore reverts optimistic state consistently.
- [ ] Failed hard delete reverts or reports consistently.
- [ ] Refresh during soft delete does not duplicate same-id records.
- [ ] Refresh during restore does not duplicate same-id records.
- [ ] Cache hit followed by background refresh does not visibly roll back local lifecycle intent.
- [ ] Default behavior differs only by design: Glossary has team-wide default; QA List has per-language default.

## Query And Cache Parity

- [ ] Both pages use TanStack Query through the same intended abstraction path.
- [ ] No lifecycle mutation writes directly around the query layer unless documented as an intentional exception.
- [ ] Optimistic mutations update the same canonical cache entry instead of appending a second copy.
- [ ] Background refresh merges with pending local intent instead of racing it.
- [ ] Same-id conflicting lifecycle states are prevented by replace/update logic, not hidden by broad dedupe.
- [ ] Exact-id cache normalization is used only as a defensive invariant for already-corrupt query data.
- [ ] No dedupe by title, repo name, language, or other fuzzy fields.
- [ ] Query keys include the selected team identity and cannot show another team's cached resources.
- [ ] Cache reads are refused when the cache key does not match the selected team/resource.
- [ ] Editor caches are refused when the cache key does not match the selected glossary/QA list.

### Query/Cache Boundary Inventory

For Glossaries and QA Lists, list every cache/state write entry point and verify the same invariant on both sides.

- [ ] Inventory every `queryClient.setQueryData(...)` call.
- [ ] Inventory every `apply*QuerySnapshotToState(...)` call.
- [ ] Inventory every resource-specific helper that writes query data, such as `apply*QueryDataForTeam(...)`.
- [ ] Inventory every cache seed path:
  - cache seed,
  - local disk seed,
  - remote fetch result,
  - observer update,
  - manual refresh,
  - mutation invalidation/refetch,
  - create/import/upsert helper.
- [ ] For each entry point, mark whether it goes through:
  - [ ] the shared repo-resource query controller,
  - [ ] a resource-specific reconciled helper,
  - [ ] a raw direct query write,
  - [ ] a raw direct page-state write.
- [ ] Any raw direct query write from fetched/cache/local data must be treated as suspicious until it proves it preserves pending/local lifecycle intent first.
- [ ] Fetched snapshots must enter visible state through one reconciled query boundary.
- [ ] No refresh/load path may apply a fetched snapshot to query cache or page state before preserving current pending/local lifecycle intent.
- [ ] No page-specific helper may bypass the shared preservation path unless listed as an intentional exception with a regression test.

### Refresh Apply Path Parity

Compare the full call graph for each resource operation, not just the function names that exist.

- [ ] Glossary refresh call graph is documented from page action to final state write.
- [ ] QA List refresh call graph is documented from page action to final state write.
- [ ] Glossary mutation invalidation/refetch call graph is documented from mutation settle to final state write.
- [ ] QA List mutation invalidation/refetch call graph is documented from mutation settle to final state write.
- [ ] Glossary cache/local/remote seed call graph is documented.
- [ ] QA List cache/local/remote seed call graph is documented.
- [ ] Any different link in a corresponding call graph has an explicit reason.
- [ ] A stale fetched snapshot cannot overwrite:
  - pending soft delete,
  - settled local soft-delete intent,
  - pending restore,
  - settled local restore intent,
  - pending rename,
  - settled local rename intent,
  - pending create,
  - settled local create intent.
- [ ] The newest local user intent wins over older network/cache snapshots.
- [ ] Network/cache snapshots clear local lifecycle intent only when they confirm the same final state.

### State Overlay And Preservation Checks

- [ ] Both resources apply pending mutation overlays before rendering stale fetched data.
- [ ] Both resources preserve settled local lifecycle intent until the server/local metadata agrees.
- [ ] Both resources clear confirmed write intents only after the incoming snapshot confirms the intended value.
- [ ] Both resources reject duplicate same-id summaries at query snapshot creation, mutation input, mutation output, and prepared refresh snapshot boundaries.
- [ ] Duplicate detection throws loudly in tests; it is not replaced by silent dedupe.
- [ ] The visible page state is derived from canonical query data plus overlays, not from an unrelated side cache.

## Action And Control Parity

Shared actions should have the same placement, disabled logic, tooltip behavior, spinner behavior, and badge behavior:

- [ ] Refresh.
- [ ] Create.
- [ ] Import.
- [ ] Download/export.
- [ ] Rename.
- [ ] Open.
- [ ] Soft delete.
- [ ] Restore.
- [ ] Hard delete.
- [ ] Default / Make default.

Allowed differences:

- [ ] QA default/make-default applies only within the same language.
- [ ] QA import accepts only single-language TMX input.
- [ ] QA list cards show one language instead of source -> target.

## Editor-Origin Navigation Parity

Compare the path from the chapter editor into the Glossary Editor and QA List Editor. This is separate from top-level page parity because these actions must preserve editor context and avoid blocking the user's transition out of the chapter editor.

- [ ] Glossary and QA editor buttons both open from the chapter editor without waiting for remote sync.
- [ ] Both paths apply a cached editor payload before starting refresh.
- [ ] Both paths render the destination editor immediately when a valid cached/default resource exists.
- [ ] Any required discovery step is documented:
  - Glossary uses the chapter `linkedGlossary`.
  - QA uses the active/default QA list for the selected target language.
- [ ] QA discovery uses same-team cached QA lists before loading from disk/network.
- [ ] Repo sync does not block the first destination-editor render unless listed as an intentional correctness requirement.
- [ ] The destination editor refreshes in the background after the initial cached render.
- [ ] Back-navigation/source context behavior matches:
  - filename label is preserved,
  - editor scroll position is saved/restored,
  - the transition does not wait for a chapter save before the glossary/QA editor is usable.
- [ ] Loading-only interstitials are allowed only when no valid same-team cached/default resource exists.
- [ ] There is a regression test comparing editor Glossary button vs editor QA button:
  - cached data available -> no loading-only interstitial,
  - no cached/default resource -> loading or QA page fallback is acceptable,
  - remote sync starts after the first destination-editor render.
- [ ] Any blocking operation in one editor-origin path but not the other is classified as:
  - [ ] terminology adaptation,
  - [ ] data-model adaptation,
  - [ ] intentional functional difference,
  - [ ] temporary implementation debt,
  - [ ] unintended drift to remove.

## CSS And Class Parity

- [ ] QA cards use the same shared card/status/deleted classes as Glossaries.
- [ ] QA deleted state uses the same deleted styling as Glossaries.
- [ ] No QA-only CSS class exists for shared states unless documented.
- [ ] Gutter, spacing, button, tooltip, loading, and deleted-state styles come from shared classes.
- [ ] Textarea/input/modal styles match equivalent glossary modal controls unless the data model requires a different layout.

## Regression Tests

Every glossary lifecycle test should have a QA list equivalent unless behavior is intentionally different.

- [ ] Deleted card DOM parity test catches QA-only warnings/messages.
- [ ] Soft delete keeps closed deleted section closed.
- [ ] Soft delete preserves open deleted section when already visible.
- [ ] Restore does not duplicate same-id records.
- [ ] Refresh during delete does not duplicate same-id records.
- [ ] Refresh during restore does not duplicate same-id records.
- [ ] Failed delete/restore does not leave contradictory lifecycle state.
- [ ] Cache seed followed by background refresh preserves pending local lifecycle intent.
- [ ] Query cache cannot contain both active and deleted visible summaries for the same id after mutation flow completes.
- [ ] Stale refresh after optimistic soft delete keeps the item deleted.
- [ ] Stale refresh after settled soft delete keeps the local delete intent until server/local metadata agrees.
- [ ] Stale refresh after optimistic restore keeps the item active.
- [ ] Stale refresh after settled restore keeps the local restore intent until server/local metadata agrees.
- [ ] Stale refresh after optimistic rename keeps the local title.
- [ ] Stale refresh after settled rename keeps the local title until server/local metadata agrees.
- [ ] Stale refresh after local create keeps the created item visible until server/local metadata agrees.
- [ ] A test fails if fetched snapshots are applied through a raw `setQueryData` path that bypasses lifecycle preservation.
- [ ] QA per-language default behavior has paired tests for same-language and different-language lists.
- [ ] QA single-language TMX import failure has a regression test.

## Review Gate

Before accepting QA/Glossary parity work, answer these for every changed file:

- [ ] Is there any QA-only branch? If yes, is it in the exceptions list?
- [ ] Is there any Glossary-only branch? If yes, is it in the exceptions list?
- [ ] Can equivalent fixtures render structurally equivalent UI after terminology normalization?
- [ ] Are mutation/cache updates going through the same shared path?
- [ ] Has every cache/state write entry point been inventoried and checked for lifecycle preservation?
- [ ] Has every refresh/load/mutation invalidation call graph been compared end-to-end?
- [ ] Do paired tests cover the changed behavior?
- [ ] Is any dedupe exact-id-only and defensive, rather than a substitute for correct update flow?
- [ ] Does any refresh/load path bypass TanStack Query or write directly to page state?

## Error That Motivated This Checklist

The QA Lists page rendered an extra deleted-state warning (`This QA list is deleted.`) with no corresponding Glossary behavior and no QA-specific requirement. The earlier file/function checklist did not catch it because the function structure existed, but the rendered branch was extra. This checklist would catch that via:

- rendered deleted-card DOM parity,
- branch-level classification of `stateMarkup`,
- QA-only warning/notice audits,
- review gate requiring every QA-only branch to be listed as an intentional exception.

## Query Race Error That Expanded This Checklist

The QA Lists page could soft-delete an active QA list, move it to the deleted section, then pop it back to active after a stale refresh completed. The shared mutation controller was mostly aligned with Glossaries, but QA still had a resource-specific refresh/apply helper that wrote incoming query data directly enough to bypass lifecycle preservation. A function-level parity check missed this because the functions existed; the actual call graph and cache write boundary differed.

This checklist should catch that class of bug via:

- inventorying every `queryClient.setQueryData(...)` and `apply*QueryDataForTeam(...)` entry point,
- requiring fetched snapshots to pass through a reconciled query boundary,
- comparing refresh and mutation invalidation call graphs end-to-end,
- testing stale refresh after optimistic and settled local lifecycle intents,
- rejecting silent dedupe as a substitute for correct replace/update flow.
