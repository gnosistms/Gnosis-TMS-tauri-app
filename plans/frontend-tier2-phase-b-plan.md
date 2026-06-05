# Plan: Tier 2 Phase B — collapse the mirrored flow pairs behind one shared engine

Follows `frontend-tier2-phase-a-spec.md` (Phase A converged the four glossary/QA flow pairs into
mirrors). Phase B collapses each mirrored pair so glossary and QA each become a **thin descriptor
adapter** over one shared implementation in `src-ui/app/repo-resource/` — the same pattern Tier 1
used (`createRepoResourceTmxExport(config)`, etc.) and the backend used (`RepoResourceDomain`).

## Goal / non-goals

- **Goal:** one shared `repo-resource/<concern>.js` per flow concern, parameterized by a per-domain
  **resource descriptor**; `glossary-<concern>.js` / `qa-list-<concern>.js` shrink to a descriptor +
  thin re-exports. A fix lands once; the parity rule retires for the flow layer too.
- **Non-goal:** unifying the **term model** (bilingual glossary vs monolingual QA) or other documented
  residue. Those become explicit per-domain **descriptor hooks**, not shared code.
- **Non-goal:** touching `screens/`, editor-inline-markup, or the project resource.

## Foundations already in place (from Phase A / Tier 1)

- `repo-resource/`: `query-controller.js` (459 — a shared query *engine* both query modules already
  use), `resource-descriptor.js` (shared `resourceId`/`selectedTeam`), `cache.js`, `editor-query.js`,
  `export-flow.js`, `write-coordinator.js`, `old-layout-discard-flow.js` (Tier 1 collapses).
- Per-domain descriptors: `glossary-resource-descriptor.js` / `qa-list-resource-descriptor.js`
  (currently just `collectionField` + `resourceIdField`). **Phase B grows these** with the flow hooks.

## The descriptor (extended for Phase B)

Grow each per-domain descriptor with the hooks the flow engines need — naming the residue explicitly:

- **identity/page:** `collectionField`, `resourceIdField`, page-state accessor (`glossariesPage`),
  discovery-state field + `createDiscoveryState`, badge scope (`"glossaries"`/`"qa"`), display noun.
- **query/cache helpers** (already exist per domain): `applyQueryDataForTeam`, `currentTeam`,
  `selectedTeamMatches`, `seedFromCache`, `seedFromLocal`, query options/observer, `persistForTeam`.
- **residue hooks (the key Phase-B move):**
  - `resetRepoSyncState()` — glossary clears `glossaryRepoSyncByRepoName`; **no-op for QA** (R4).
  - `loadRemoteSnapshot` — glossary's carries `onRecoveryDetected` recovery; QA's is simpler (keep
    per-domain; the engine just calls the descriptor's).
  - term-model: `buildMetadataRecord`, `mapTermRecord`, language/init payload shaping (lifecycle/import).
- **mutation hooks:** `commitLifecycleMutation`, `upsertForTeam`, `makeDefaultIfFirst`,
  blocked-message builders.

## Per-pair collapse — order by readiness (each its own PR, `npm test` green per commit)

1. **`query` — finish what's started (lowest effort).** Both modules already run on
   `createRepoResourceQueryController`. The residual `glossary-query.js`/`qa-list-query.js` are mostly
   per-domain *config* + helpers passed to the controller. Phase B here = push more shared config into
   the engine/descriptor and thin the two files; little new engine work. Good warm-up that proves the
   descriptor-extension approach.
2. **`discovery-flow` — the worked template (cleanly mirrored, smallest: 227/222).** Extract
   `createRepoResourceDiscoveryFlow(descriptor)` → `{ primeLoadingState, loadTeam }`. Residue via the
   `resetRepoSyncState` (R4) + `loadRemoteSnapshot` hooks. The two files become descriptor + re-exports.
   This pair sets the flow-factory pattern for the rest.
3. **`lifecycle-flow` (bigger: 522/518, more hooks).** Extract
   `createRepoResourceLifecycleFlow(descriptor)` → rename/softDelete/restore/permanent-delete/toggle.
   Term-model via `buildMetadataRecord` + commit hooks; `resource-lifecycle-engine.js` is already shared.
4. **`import-flow` — partial by design (term-model-dominated, per the Phase-A import rulings).** Collapse
   only the shared plumbing (file pick, size-limit messaging, progress, error surfacing, prepare/reload)
   behind a thin engine; leave TMX/drag-drop/preview/2-language init as per-domain (descriptor hooks).
   Lowest collapse ratio — set expectations accordingly.

## Risk & method (no type checker)

- The Phase-A mirrors + the test coverage now on **both** sides of every pair are the safety net.
- **Per pair, one PR, `npm test` green after every commit.** Land the shared engine + both thin adapters
  together per pair (an adapter referencing a not-yet-extracted engine can't be half-shipped).
- Keep the engine a **pure factory** (`create…(descriptor)` returning the domain functions) so the
  public exports (`loadTeamGlossaries`, etc.) and their call sites are unchanged — `navigation.js`,
  `events/native-drops.js`, etc. keep working untouched.
- **`npm run audit:unused`** after each (collapsing orphans exports).
- Verify-by-mirror: after collapse, the per-domain file should be ~descriptor + re-exports; the shared
  engine is the single source.

## Ownership

Claude does the per-pair prep (descriptor-hook design + the first/template collapse for `discovery-flow`),
then GPT can replicate the factory pattern for the remaining pairs with Claude review — same cadence as
Phase A. `query` (config-thinning) and `import-flow` (partial) are bounded enough for GPT with review.

## Definition of done (Phase B)

Each of the four flow concerns has one shared `repo-resource/` engine; `glossary-<concern>.js` /
`qa-list-<concern>.js` are thin descriptor adapters; documented residue lives behind named descriptor
hooks (not duplicated code); `npm test` + `audit:unused` green. The glossary/QA flow layer is then
single-sourced end to end (Tier 1 + Phase B), and the "review for parity" rule retires for it.
