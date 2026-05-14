# Top-Level Projects And Glossaries Cache Restoration Plan

## Goal

Restore fast first paint for the Projects and Glossaries pages by showing cached page data immediately, then refreshing local/remote data in the background.

The old bug was not that caching existed. The bug was that cached data could be shown for the wrong team during team switches. The fix should be strict per-team cache ownership, not removing the cache.

## Git History Findings

### Projects

- Commit `4a6ff806` had the most relevant cache-first Projects path.
- In that version, `src-ui/app/project-flow.js` called `seedProjectsQueryFromCache()` before `ensureProjectsQueryObserver()` and `queryClient.fetchQuery()`.
- `seedProjectsQueryFromCache()` still exists today in `src-ui/app/project-query.js`, but current `src-ui/app/project-flow.js` no longer calls it.
- Current `loadTeamProjects()` clears `state.projects` in `primeProjectsLoadingState()`, launches search indexing, then waits for local repo discovery/query refresh. That is why Projects can feel blank/slow even though cache helpers exist.

### Glossaries

- Commit `e6329e9c` had cache-first Glossaries loading.
- In that version, `primeGlossariesLoadingState()` and `loadTeamGlossaries()` called `loadStoredGlossariesForTeam()` and applied cached glossaries immediately.
- Current Glossaries loading seeds from local repo summaries via `seedGlossariesQueryFromLocal()`, not from the persisted glossary cache.
- `loadStoredGlossariesForTeam()` still exists today in `src-ui/app/glossary-cache.js`, and `persistGlossariesForTeam()` still saves the cache through `src-ui/app/glossary-top-level-state.js`.

### Team-Scoped Cache Support

Current cache helpers already support the shape we need:

- `src-ui/app/team-cache.js`
  - `teamCacheKey(team)` uses `installationId`, then `githubOrg`, then `team.id`.
  - `loadTeamScopedCacheMap()` scopes storage by signed-in login through `scopedTeamStorageKey()`.
- `src-ui/app/project-cache.js`
  - `loadStoredProjectsForTeam(team)`
  - `saveStoredProjectsForTeam(team, snapshot)`
- `src-ui/app/glossary-cache.js`
  - `loadStoredGlossariesForTeam(team)`
  - `saveStoredGlossariesForTeam(team, glossaries)`

So the restoration should reuse this code rather than introduce a new storage system.

## Required Invariant

Never render cached Projects or Glossaries unless the cache key belongs to the selected team.

Every cache seed/apply path must check:

- current selected team id still matches the request team id
- cache key was derived from the same selected team object
- async refresh result still belongs to the current selected team before applying it

If no matching cache exists for the selected team, ignore all other cache entries and load normally. Show loading state while that normal load runs. Do not preserve the previous team's visible data.

This is intentionally strict:

- matching selected-team cache: render immediately, then refresh in the background
- missing selected-team cache: show loading, then load local/remote data
- wrong-team cache: never render it, even briefly

## Data Ownership Details

Add explicit visible-data ownership metadata to page state or nearby flow state.

Suggested additions to `createResourcePageState()` in `src-ui/app/resource-page-controller.js`:

```js
visibleTeamId: null,
visibleCacheKey: null,
cacheUpdatedAt: null,
```

Add small helper functions in the same module, or as local helpers in the Projects/Glossaries flows if that keeps the change smaller:

```js
export function setResourcePageDataOwner(pageState, {
  teamId,
  cacheKey,
  cacheUpdatedAt = null,
} = {}) {
  pageState.visibleTeamId = teamId ?? null;
  pageState.visibleCacheKey = cacheKey ?? null;
  pageState.cacheUpdatedAt = cacheUpdatedAt ?? null;
}

export function clearResourcePageDataOwner(pageState) {
  setResourcePageDataOwner(pageState);
}

export function resourcePageOwnsTeam(pageState, team) {
  return Boolean(
    pageState
    && team?.id
    && pageState.visibleTeamId === team.id
    && pageState.visibleCacheKey === teamCacheKey(team)
  );
}
```

If `teamCacheKey()` is not appropriate to import into the generic resource-page module, keep `resourcePageOwnsTeam()` page-specific and call the generic setter/clearer only.

When applying Projects or Glossaries data:

- set `visibleTeamId` to `team.id`
- set `visibleCacheKey` to `teamCacheKey(team)`
- set `cacheUpdatedAt` when data came from persisted cache

This lets the screen distinguish "cached data for this team" from stale in-memory data left by a prior team.

Implementation detail:

- Extend `applyProjectSnapshotToState(snapshot, options)` to accept `teamId`, `cacheKey`, and `cacheUpdatedAt`, then stamp `state.projectsPage`.
- Extend `applyProjectsQuerySnapshotToState(snapshot, options)` to pass those ownership fields through to `applyProjectSnapshotToState()`.
- Extend `applyGlossarySnapshotToState(snapshot, options)` the same way, stamping `state.glossariesPage`.
- Extend `applyGlossariesQuerySnapshotToState(snapshot, options)` to pass ownership fields through to `applyGlossarySnapshotToState()`.
- When clearing `state.projects`/`state.glossaries` because there is no selected-team cache, also clear the corresponding visible ownership metadata.
- Do not clear ownership metadata when a same-team refresh starts; that is how the page can keep rendering current cached data while `isRefreshing` is true.

## Cache Helper Updates

Update both cache loaders to return metadata:

### `src-ui/app/project-cache.js`

Return:

```js
{
  exists: true,
  cacheKey,
  updatedAt,
  projects,
  deletedProjects,
}
```

Keep the current `{ exists: false, projects: [], deletedProjects: [] }` shape for misses, but include `cacheKey` when available.

Miss shape:

```js
{
  exists: false,
  cacheKey,
  updatedAt: null,
  projects: [],
  deletedProjects: [],
}
```

### `src-ui/app/glossary-cache.js`

Return:

```js
{
  exists: true,
  cacheKey,
  updatedAt,
  glossaries,
}
```

Miss shape:

```js
{
  exists: false,
  cacheKey,
  updatedAt: null,
  glossaries: [],
}
```

This is mostly for guards/tests; the actual team isolation still comes from using `teamCacheKey(team)` to index the map.

Add an explicit check near every cache seed:

```js
const expectedCacheKey = teamCacheKey(team);
if (
  state.selectedTeamId !== teamId
  || !cached.exists
  || cached.cacheKey !== expectedCacheKey
) {
  return null;
}
```

This looks redundant because the loader indexes by `teamCacheKey(team)`, but it is useful defense against future refactors and makes the test assertions unambiguous.

## Projects Implementation

### Restore Cache Seeding

Restore the old `4a6ff806` behavior in `src-ui/app/project-flow.js`:

- Import `seedProjectsQueryFromCache` again from `src-ui/app/project-query.js`.
- Import `loadStoredGlossariesForTeam` from `src-ui/app/glossary-cache.js` if we still want Project page cache seeding to carry glossary data in the query snapshot.
- After building `queryOptionsContext`, call:

```js
seedProjectsQueryFromCache(selectedTeam, {
  ...queryOptionsContext,
  loadStoredProjectsForTeam,
  loadStoredChapterPendingMutations,
  loadStoredGlossariesForTeam,
});
```

Do this before `ensureProjectsQueryObserver()` and `queryClient.fetchQuery()`.

The seed function should be tightened before restoring the call:

- derive `expectedCacheKey = teamCacheKey(team)` inside `seedProjectsQueryFromCache()`
- return `null` without mutating query state or page state if `state.selectedTeamId !== teamId`
- return `null` without mutating state if `cachedProjects.cacheKey !== expectedCacheKey`
- pass `{ teamId, cacheKey: expectedCacheKey, cacheUpdatedAt: cachedProjects.updatedAt }` into `applyProjectsQuerySnapshotToState()`
- keep applying pending chapter mutations through `applyPendingMutations()` before rendering cached data
- set query data only for `projectKeys.byTeam(teamId)`

Also remove or guard the current glossary fallback that can use `state.glossaries` when `loadStoredGlossariesForTeam` is not provided. If the Projects seed needs glossaries, they must come from:

- `queryClient.getQueryData(glossaryKeys.byTeam(teamId))`, or
- `loadStoredGlossariesForTeam(team)` with a matching `cacheKey`

Do not pull glossary data from `state.glossaries` unless `state.glossariesPage.visibleTeamId === teamId` and `state.glossariesPage.visibleCacheKey === teamCacheKey(team)`.

### Avoid Blank First Paint

Modify `primeProjectsLoadingState(teamId)`:

- Determine whether existing visible projects belong to the same team.
- If same team and visible data exists, keep it while setting `isRefreshing = true`.
- If switching teams:
  - clear `state.projects`/`state.deletedProjects`
  - immediately try to seed the selected team's cache
  - if no selected-team cache exists, ignore other teams' cache entries and show loading while normal local/remote loading proceeds
- Do not keep previous-team data while loading another team.

If `primeProjectsLoadingState()` cannot safely read the team object, keep it as a pure loading primer and perform cache seeding immediately after it in navigation/load flow, before the first render where possible.

Preferred concrete shape:

```js
export function primeProjectsLoadingState(teamId = state.selectedTeamId, {
  team = selectedTeamById(teamId),
  seedFromCache = true,
  render,
} = {}) {
  state.selectedTeamId = teamId ?? state.selectedTeamId;

  const ownsVisibleTeam = resourcePageOwnsTeam(state.projectsPage, team);
  if (ownsVisibleTeam && state.projects.length > 0) {
    state.projectsPage.isRefreshing = true;
    state.projectDiscovery = loadingDiscoveryState();
    return { preservedVisibleData: true, seededFromCache: false };
  }

  clearProjectListStateAndOwner();

  if (seedFromCache) {
    const cachedSnapshot = seedProjectsQueryFromCache(team, { ...context, render });
    if (cachedSnapshot) {
      return { preservedVisibleData: false, seededFromCache: true };
    }
  }

  setEmptyProjectsLoadingSnapshot(teamId);
  return { preservedVisibleData: false, seededFromCache: false };
}
```

The exact helper names can differ, but the ordering matters:

1. select the team
2. decide whether visible data belongs to that same team
3. clear wrong-team data before any render
4. seed selected-team cache before the first post-navigation render
5. fall back to empty loading state only when there is no selected-team cache

`loadTeamProjects()` currently calls `primeProjectsLoadingState(teamId)` and then `render?.()`. That is the right place to ensure cache seeding has already happened.

One practical detail: `seedProjectsQueryFromCache()` needs most of the same dependencies that are currently assembled in `queryOptionsContext`, but `queryOptionsContext` is built after the first `render?.()`. To avoid rendering a blank list first, extract that object construction into a helper such as `createProjectQueryOptionsContext(selectedTeam, previousProjectSnapshot, render)` and call it before priming/rendering:

```js
const queryOptionsContext = createProjectQueryOptionsContext(
  selectedTeam,
  previousProjectSnapshot,
  render,
);

const primeResult = primeProjectsLoadingState(selectedTeam.id, {
  team: selectedTeam,
  queryOptionsContext,
  render,
});
void refreshProjectSearchIndex(render, selectedTeam.id).catch(() => {});
render?.();
```

Then reuse the same `queryOptionsContext` for `ensureProjectsQueryObserver()` and `createProjectsQueryOptions()`. That keeps the cache seed and the live refresh using the same mutation overlays, lifecycle preservation, and reconciliation callbacks.

### Current-Result Guards

Keep existing team guards:

- `applyProjectsQuerySnapshotToState(snapshot, { teamId })` already ignores mismatched selected teams.
- `loadTeamProjects()` and `loadRepoBackedProjectsForTeam()` already use selected team checks.

Add tests around the cache seed path specifically, because this is where the old cross-team flash happened.

When async refresh finishes, `applyProjectsQuerySnapshotToState()` should still be the only path that writes query results to page state. The ownership fields should be set from the same `teamId/cacheKey` options used by the selected-team guard, not inferred from whatever team happens to be selected later.

### Integrate With Word Count Plan

The Projects word-count background plan should build on this:

- cached Projects snapshot may include old `sourceWordCounts`
- cheap local repo listing should not wipe those counts
- background word-count refresh updates the app-level project cache

The cache restoration can be implemented first. It will improve first paint even before the background word-count work lands.

## Glossaries Implementation

### Restore Cache-First Seed

Add a cache seed function to `src-ui/app/glossary-query.js`, similar to `seedProjectsQueryFromCache()`:

```js
export function seedGlossariesQueryFromCache(team, {
  teamId = team?.id,
  loadStoredGlossariesForTeam,
  render,
} = {}) { ... }
```

Behavior:

- call `loadStoredGlossariesForTeam(team)`
- if no cache exists, return `null`
- create a `createGlossariesQuerySnapshot({ glossaries: cached.glossaries, status: "ready" })`
- set query data for `glossaryKeys.byTeam(teamId)`
- call `applyGlossariesQuerySnapshotToState(snapshot, { teamId, isFetching: true })`
- stamp `state.glossariesPage.visibleTeamId` / `visibleCacheKey` if those fields are added
- render

Concrete behavior:

```js
export function seedGlossariesQueryFromCache(team, {
  teamId = team?.id,
  loadStoredGlossariesForTeam,
  render,
} = {}) {
  const expectedCacheKey = teamCacheKey(team);
  const cached = loadStoredGlossariesForTeam?.(team);

  if (
    state.selectedTeamId !== teamId
    || !cached?.exists
    || cached.cacheKey !== expectedCacheKey
  ) {
    return null;
  }

  const snapshot = applyGlossaryWriteIntentOverlay(createGlossariesQuerySnapshot({
    glossaries: cached.glossaries,
    status: "ready",
  }));

  queryClient.setQueryData(glossaryKeys.byTeam(teamId), snapshot);
  applyGlossariesQuerySnapshotToState(snapshot, {
    teamId,
    isFetching: true,
    cacheKey: expectedCacheKey,
    cacheUpdatedAt: cached.updatedAt,
  });
  render?.();
  return snapshot;
}
```

`seedGlossariesQueryFromLocal()` should also pass ownership metadata when it applies same-team local summaries. Local summaries are not persisted-cache data, so `cacheUpdatedAt` should be `null`, but `visibleTeamId` and `visibleCacheKey` should still identify the selected team.

### Use Cache Before Local Repo Scan

Update `src-ui/app/glossary-discovery-flow.js`:

- Import `loadStoredGlossariesForTeam`.
- Import and call `seedGlossariesQueryFromCache()` before `seedGlossariesQueryFromLocal()`.
- If cached data exists, render it and wait a paint before local repo scan/remote refresh.
- Keep `seedGlossariesQueryFromLocal()` as the next layer, because it can reflect local repo changes not yet in the persisted cache.

Desired order:

1. cached glossaries for selected team
2. local glossary repo summaries
3. remote/team metadata/glossary repo refresh

The current `loadTeamGlossaries()` sequence renders and waits a paint before local seeding. Change the sequence so the synchronous cache seed happens before that first render:

1. select team and clear wrong-team visible data
2. try `seedGlossariesQueryFromCache(team, ...)`
3. render cached data, or render loading if there was no selected-team cache
4. wait for next paint
5. run `seedGlossariesQueryFromLocal(team, ...)`
6. start/await the query refresh

This preserves responsiveness without delaying local repo discovery.

### Avoid Wrong-Team Preservation

Update `primeGlossariesLoadingState(teamId, options)`:

- Preserve visible data only if it belongs to the same team/cache key.
- On team switch, do not show previous team's `state.glossaries`.
- Try selected-team cache immediately.
- If no selected-team cache exists, ignore other teams' cache entries and show loading while normal local/remote loading proceeds.

`primeGlossariesLoadingState()` currently preserves visible data when `options.preserveVisibleData === true` and `state.glossaries.length > 0`. Tighten that condition to:

```js
const canPreserveVisibleData =
  options.preserveVisibleData === true
  && resourcePageOwnsTeam(state.glossariesPage, team)
  && state.glossaries.length > 0;
```

If this check fails, clear `state.glossaries`, `state.selectedGlossaryId`, and the glossary page ownership fields before rendering.

### Term Count Follow-Up

The Glossaries screen does not render `termCount`, but non-display code still uses it:

- default glossary replacement after deletion
- import safety checks
- editor/top-level synchronization after term edits

For cache-first list rendering, cached `termCount` is good enough. Local repo summary can keep the recent cheap file-count improvement or eventually skip term counting entirely for list load.

## Navigation Integration

Current navigation primes pages before async loads:

- `open-team:` in `src-ui/app/actions/navigation-actions.js`
- `open-team-glossaries:` in `src-ui/app/actions/navigation-actions.js`
- `handleNavigation("projects")` in `src-ui/app/navigation.js`
- `handleNavigation("glossaries")` in `src-ui/app/navigation.js`

Update these paths so the first render after team selection uses selected-team cache when available.

Important rule:

- Never call `render()` after changing `selectedTeamId` with prior team's visible data still present.
- A cache miss for the selected team must fall through to the normal load path, not to any fallback cache from another team.

Implementation options:

1. Make `primeProjectsLoadingState()` and `primeGlossariesLoadingState()` responsible for cache seeding.
2. Or add explicit `prime...FromCache()` calls in navigation before render.

Prefer option 1 if it stays clean, because all navigation paths already call the prime functions.

Keep query-cache ownership separate from persisted-cache ownership:

- TanStack-style query keys such as `projectKeys.byTeam(team.id)` and `glossaryKeys.byTeam(team.id)` already isolate in-memory query data by team id.
- The persisted cache key should still be stored on page state because `team.id` alone is not enough to distinguish GitHub installation/org fallback changes.
- Navigation should never read directly from the global page arrays to decide whether data is reusable. It should ask the page ownership metadata.

## Tests

### Projects Tests

Add or update tests in `src-ui/app/project-query.test.js`, `src-ui/app/navigation.test.js`, or a focused cache test:

- `seedProjectsQueryFromCache` applies only selected-team cache.
- Switching from Team A to Team B with only Team A cached clears projects or shows Team B cache, never Team A.
- Switching to Team B with Team B cache renders Team B projects before query refresh resolves.
- Query refresh result for Team A is ignored after switching to Team B.
- Cached snapshot preserves pending chapter mutations through `applyPendingMutations`.
- Cached snapshot uses cached glossaries only from the selected team.
- `primeProjectsLoadingState()` clears wrong-team visible projects before the first render.
- `primeProjectsLoadingState()` preserves same-team visible projects while setting `isRefreshing`.
- `seedProjectsQueryFromCache()` returns `null` and leaves state unchanged when the cached result has a mismatched `cacheKey`.
- `seedProjectsQueryFromCache()` does not use `state.glossaries` from a previous team.

### Glossaries Tests

Add or update tests in `src-ui/app/glossary-query.test.js` and `src-ui/app/glossary-discovery-flow.test.js`:

- `seedGlossariesQueryFromCache` applies selected-team cache.
- Switching teams does not show previous team's glossaries.
- Team B cached glossaries render before local repo summary resolves.
- Local repo summaries can replace cached data for the same team.
- Remote refresh result for Team A is ignored after switching to Team B.
- `primeGlossariesLoadingState()` preserves visible data only when `visibleTeamId` and `visibleCacheKey` match the selected team.
- `seedGlossariesQueryFromCache()` returns `null` and leaves state unchanged when the cached result has a mismatched `cacheKey`.
- `seedGlossariesQueryFromLocal()` stamps same-team ownership metadata when it replaces cached data.

### Cache Helper Tests

Update `src-ui/app/project-cache.test.js` and add/extend glossary cache tests:

- cache keys differ by installation id
- cache keys differ by org/team fallback
- cache maps are scoped by active storage login
- load functions expose `cacheKey` and `updatedAt`
- transient write fields remain stripped from project cache, as covered by the existing project-cache tests

### Manual Checks

- Switch from Team A to Team B where both have cached data: Team B appears immediately.
- Switch from Team A to Team C where Team C has no cache: loading state appears, not Team A.
- Corrupt or mismatched cache key for Team C: cache is ignored and Team C loads normally.
- Refresh Projects: cached data remains visible while background refresh runs.
- Refresh Glossaries: cached data remains visible while background refresh runs.

## Implementation Order

1. Add visible team/cache ownership fields and setter/clearer helpers to resource page state.
2. Thread ownership options through `applyProjectSnapshotToState()`, `applyProjectsQuerySnapshotToState()`, `applyGlossarySnapshotToState()`, and `applyGlossariesQuerySnapshotToState()`.
3. Add cache metadata return fields to project/glossary cache loaders, including metadata on misses.
4. Tighten `seedProjectsQueryFromCache()` so it validates `selectedTeamId`, `cacheKey`, and selected-team glossary data before mutating query/page state.
5. Make Projects priming/cache seeding safe for team switches, then restore the `seedProjectsQueryFromCache()` call in `project-flow.js`.
6. Add `seedGlossariesQueryFromCache()` to `glossary-query.js`.
7. Use glossary cache seeding in `glossary-discovery-flow.js` before local repo seeding and before the first post-navigation render.
8. Update navigation/prime tests so team switches cannot render prior-team data.
9. Add focused cache helper tests.
10. Run focused Node tests, then `npm run build`.

## Acceptance Criteria

- Projects page displays cached selected-team data immediately when available.
- Glossaries page displays cached selected-team data immediately when available.
- Switching teams never shows another team's Projects or Glossaries, even briefly.
- Missing or mismatched selected-team cache falls back to normal local/remote loading.
- Cached data is replaced by local/remote refresh results in the background.
- Existing local-first discovery, repo repair, metadata recovery, and query invalidation flows still work.
- The implementation reuses the existing cache/query code instead of introducing a parallel cache system.
