# Tier 2 Phase A — Execution Spec (mirror the drifted pairs)

Companion to `frontend-glossary-qa-unification-plan.md`. This is the concrete, decision-by-decision
spec for **Phase A** (converge each drifted Tier 2 pair into a mirror; Phase B collapse comes
after). It is grounded in a full read of the `discovery-flow` pair and its supporting helpers.

## How to execute (applies to every step)

- **`npm test` after every commit** — it is the only safety net (no type checker). 1238 tests today.
- **Keep refactor and feature-port commits separate.** A de-drift commit must not change behavior;
  a feature-port commit deliberately does and must be reviewed as such.
- **Bottom-up:** reconcile shared helpers first, then the flow module that consumes them.
- A pair is "mirrored" when a glossary↔qa token-substituted diff of the flow module is ~empty.

## Canonical decisions (resolve the drift — use these, don't re-litigate per pair)

1. **Staleness check → team match.** Use `selectedXTeamMatches(team)`.
   `glossarySyncVersion` is **dead code** (declared + reset to 0, never incremented; only compared
   in `glossary-discovery-flow.js:93`). Remove it; its check always passed, so removal is
   behavior-preserving.
2. **Plumbing baseline → the QA side.** `qa-list-top-level-state.js` (218 lines) is far more evolved
   than `glossary-top-level-state.js` (81). Adopt QA's helpers as canonical and bring glossary up:
   `currentXTeam`, `selectedXTeamMatches`, `applyXQueryDataForTeam`, `setResourcePageRefreshing`,
   and a `finally`-based badge/refreshing cleanup.
3. **Feature set → glossary's (richer).** Port these glossary-only behaviors INTO the QA flow:
   - sync-failure recovery via `handleSyncFailure(classifySyncError(error), {render, teamId, currentResource:true})` (both helpers are domain-agnostic);
   - surfacing `querySnapshot.syncIssue` and `discovery.brokerWarning` as notice badges;
   - the `options.seedFromCache === false` escape hatch in the prime step;
   - nuanced error-state preservation (keep discovery `ready` with retained broker/recovery messages when visible data exists; only go to `error` when the list is empty);
   - `state.XRepoSyncByRepoName = {}` resets on prime/error.

Net canonical shape = **QA's structure + cleaner helpers, carrying glossary's feature set.**

## Per-field divergence rulings (discovery-flow) — RESOLVED

Mirroring `discovery-flow` surfaced four genuine per-field behavior differences (caught by the
test suites), not just naming drift. These are the judgment calls that blocked handoff; they are
now decided so the mirror is mechanical:

- **R1 — clear the page data owner on a non-preserve / no-team load.** Glossary calls
  `clearResourcePageDataOwner`; QA doesn't. **Ruling: clear it in both** (glossary's behavior is
  correct — the page must not keep claiming another team's data). QA's prime gains
  `clearResourcePageDataOwner(state.qaListsPage)` in the non-preserve and no-team branches.
- **R2 — reset the selected id on a non-preserve / no-team load.** Glossary sets
  `selectedGlossaryId = null`; QA doesn't. **Ruling: reset in both.** QA gains
  `state.selectedQaListId = null` in those branches.
- **R3 — success-path persistence.** Glossary does `setQueryData + applySnapshot +
  persistGlossariesForTeam` (caches the write-intent-overlaid `state` list); QA's
  `applyQaListsQueryDataForTeam` caches the raw reconciled `queryData` with lifecycle-patch
  preservation, re-overlaying on next load. **Ruling: adopt QA's `applyXQueryDataForTeam` in both**
  (caching raw server data + re-applying optimistic patches is the correct model). This changes
  glossary's cache contents, and the glossary success path is under-tested — so **A5 must add a
  glossary success-path characterization test BEFORE the swap.**
- **R4 — per-repo sync tracking is NOT unified.** Glossary tracks
  `state.glossaryRepoSyncByRepoName` (per-repo sync status) and resets it in prime/error; QA has no
  such field or UI. This is a genuine **glossary-only feature**, not drift. **Ruling: leave it
  per-domain** — do NOT add `qaListRepoSyncByRepoName` to QA. In Phase B it becomes a per-domain
  descriptor hook (`resetRepoSyncState()`, a no-op for QA). The mirrored flows are therefore ~95%
  identical, with this as the documented functional residue.

With R1–R4 decided, the discovery mirror is a specified, mechanical task — **now suitable for GPT**
(with the mandatory R3 characterization test and Claude review), no longer Claude-only.

## Progress

- **A3 done** — dead `glossarySyncVersion`/`teamSyncVersion` removed (PR #37, merged).
- **A4 (sync-failure recovery) done** — ported into QA (PR #39, merged).
- **QA discovery test coverage added** (PR #38, merged) — safety net on the QA side.
- Remaining: A1, A2, the rest of A4 (`syncIssue`/`brokerWarning` surfacing, `seedFromCache`
  option — **NOT** the repoSync reset, per R4), A5 (+ its char test), A6.

## Residual cleanup (noted, not blocking)

`handleSyncFailure(..., { currentResource: true })` carries project-specific cleanup inside the
shared helper. Glossary and now QA both use that path, so it's consistent — but if we later want
resource-specific recovery state for projects/glossaries/QA lists, factor that out. Not a Tier 2
blocker.

## Phase A for the `discovery-flow` pair (the worked template — do this first)

Ordered, each its own commit:

- **A1 — glossary-query parity.** Add `persistGlossariesQueryDataForTeam(team, queryData)` mirroring
  `persistQaListsQueryDataForTeam`. (Glossary currently persists via `persistGlossariesForTeam(team)`
  off `state.glossaries`; after snapshot application these are equivalent, but the queryData form is
  what `applyXQueryDataForTeam` needs.) Pure addition. Confirm `applyGlossariesQuerySnapshotToState`
  and `preserveGlossaryLifecyclePatchesInSnapshot` already exist (they do).
- **A2 — glossary-top-level-state parity.** Add `currentGlossaryTeam()`, `selectedGlossaryTeamMatches(team)`,
  and `applyGlossariesQueryDataForTeam(team, queryData, render, {isFetching})` — direct mirrors of the
  QA versions (lines 20–32, 126–143 of `qa-list-top-level-state.js`). Pure additions.
- **A3 — drop dead sync-version (refactor commit).** Remove `glossarySyncVersion` from `state.js`
  (decl + reset) and rewrite `isGlossaryLoadCurrent` to `selectedGlossaryTeamMatches(team)`. Behavior-
  preserving (the version never changed).
- **A4 — port features into QA (feature-port commits, one per feature).** Add to `qa-list-discovery-flow.js`:
  sync-failure recovery in the catch (**done, #39**); `syncIssue`/`brokerWarning` surfacing after
  apply; the `seedFromCache` option in prime; the nuanced error-state branch; plus R1 (clear data
  owner) and R2 (reset selected id). **Do NOT add `qaListRepoSyncByRepoName`** (R4 — glossary-only).
- **A5 — rewrite glossary-discovery-flow to the canonical shape (refactor commit).** First **add a
  glossary success-path characterization test** (R3 changes cache contents and that path is
  under-covered). Then switch to `setResourcePageRefreshing`, `applyGlossariesQueryDataForTeam`
  (R3), `currentGlossaryTeam`/`selectedGlossaryTeamMatches`, and a `finally` cleanup — matching QA's
  structure. Keep glossary's `glossaryRepoSyncByRepoName` reset (R4 residue).
- **A6 — verify mirror.** Token-substituted diff of the two flow modules should be ~empty apart from
  the R4 per-repo-sync residue. `npm test` green.

Owner: **GPT, with Claude review** — now that R1–R4 are decided and both sides have test coverage,
this is a specified mechanical task (no longer judgment-heavy). Mandatory: the R3 characterization
test lands before the R3 swap.

## Phase A for the remaining pairs — GPT handoff

Once `discovery-flow` is mirrored as the template, hand each remaining pair to GPT with a tight,
self-contained brief. Per-pair brief shape:

> Make `qa-list-<X>.js` and `glossary-<X>.js` mirror each other, following the pattern already applied
> to `*-discovery-flow.js`. Use the canonical helpers (`selectedXTeamMatches`, `setResourcePageRefreshing`,
> `applyXQueryDataForTeam`, etc.). Where one side has a feature the other lacks, port it across as a
> SEPARATE commit (list the specific features after diffing). Do NOT collapse into a shared module yet
> (that is Phase B). `npm test` must pass after every commit. Deliver: refactor commits + feature-port
> commits, and a token-substituted diff showing the two files are ~mirrors.

Pairs, in order (smallest/safest first):

- **`lifecycle-flow`** (493/518, ~5% functional). Mostly import/helper drift. Reconcile to the QA
  lifecycle-mutation factory + shared query helpers. Feature-diff for any rename/delete/restore guard
  one side has and the other lacks.
- **`query`** (483/510, ~0% functional). Reconcile helper decomposition: QA has a DRY'd
  `createLifecycleMutationOptions` + `upsert`/`persist` helpers; glossary has `applyWriteIntentOverlay`
  + `preservePendingLifecyclePatches`. Pick the QA decomposition as canonical; port glossary's overlay
  logic if it has no QA equivalent. **Highest cross-module blast radius — review carefully.**
- **`import-flow`** (905/827, ~9% functional). Largest. The functional residue is the term preview
  (bilingual columns vs single text) — leave that domain-specific behind a small hook; mirror the file
  pick / size-limit / TMX inspect-confirm / progress / error-surfacing plumbing.

Each pair: Claude reviews GPT's mirror before it lands.

## Lifecycle-flow rulings (RESOLVED — GPT-ready)

Prep on the `lifecycle-flow` pair shows it is **not** a clean mechanical mirror like discovery —
it has genuine functional/data forks. Both flows already share `resource-lifecycle-engine.js`
(orchestration); the divergence is in the per-domain glue. **Unlike discovery, the canonical side
is QA** (more correct/evolved) — the mirror brings *glossary up to QA*. And **QA lifecycle is
untested** (glossary has 3 tests) → add `qa-list-lifecycle-flow.test.js` characterization tests FIRST.

- **L1 (data fix) — soft-delete metadata `lifecycleState` = `"deleted"`, not `"softDeleted"`.**
  Canonical per `resource-lifecycle-engine.js` (`project ? "softDeleted" : "deleted"`) and QA.
  Glossary writes `"softDeleted"` in **both** `glossary-lifecycle-flow.js` (glossaryMetadataRecord,
  ~line 97) and `glossary-import-flow.js` (~line 148) — fix both to `"deleted"`. Safe today (every
  reader accepts both), removes a latent inconsistency. **Own commit + test.**
- **L2 — commit guard throws.** Glossary's commit silently `return`s on a missing resource; QA
  `throw`s "Could not find…". Adopt throw in glossary.
- **L3 — non-repo-backed fallback.** QA's commit branches `if (teamSupportsXRepos && repoName) {
  metadata-first } else { local-only }`; glossary always takes the repo path. Adopt QA's branch.
- **L4 — trigger repo sync after lifecycle mutations.** QA calls `triggerXRepoSync` after
  rename/softDelete/restore; glossary doesn't. Adopt in glossary (prompt propagation; parity).
  Behavior addition → cover with a test.
- **L5 — `previousRepoNames` in the metadata record.** QA tracks it; glossary doesn't. Add to
  glossary's metadata record.
- **L6 — term-model language fields stay per-domain** (glossary `sourceLanguage`/`targetLanguage`;
  QA `language`). Residue, like discovery R4. Not unified.
- **L7 — use the `repoBackedXInput` helper.** QA builds invoke input via `repoBackedQaListInput`;
  glossary inlines `{installationId, glossaryId, repoName}`. Adopt the helper in glossary.

**Prereq helpers (A1/A2-equivalent — add to glossary, mirroring QA, before the L-changes):**
`repoBackedGlossaryInput`, `triggerGlossaryRepoSync`, `ensureGlossariesQueryDataForTeam` in
`glossary-top-level-state.js`. (Glossary already has `makeGlossaryDefaultIfFirst`,
`currentGlossaryTeam`, `selectedGlossaryTeamMatches`, `applyGlossariesQueryDataForTeam`.)

**Order for GPT:** (0) add QA lifecycle characterization tests; (1) add prereq glossary helpers;
(2) L1 fix + test (own commit, both files); (3) bring glossary commit/record up to QA — L2, L3,
L4 (+test), L5, L7 as feature-port commits; (4) verify token-substituted diff ~empty apart from
the L6 residue. `npm test` green per commit. Owner: **GPT with Claude review** (decisions resolved).

## Lifecycle-flow completion follow-up (after PR #46)

PR #46 landed L1–L7 (correct, regression-free, QA tests + the L1 data fix). Review surfaced the
mirror is **not yet complete** — two functional divergences my L1–L7 rulings missed, plus the
"~empty diff" bar (step 4) wasn't met. A small follow-up finishes lifecycle:

- **L8 — rename guards on the expected (non-deleted) resource.** QA's `submitQaListRename` passes
  `isExpectedResource: (r) => Boolean(r) && r.lifecycleState !== "deleted"` to
  `guardTopLevelResourceAction`; glossary's `submitGlossaryRename` omits it (so it wouldn't refuse
  renaming a soft-deleted glossary). **Ruling: adopt QA's guard in glossary.** (Glossary's
  delete/restore already gate on lifecycle state; only rename is missing it.) Behavior change → test.
- **L9 — align rename validation ordering.** QA checks the empty-title case *before* the
  permission/tombstone guard; glossary checks it *after*. **Ruling: match QA** — empty-title check
  first in glossary's `submitGlossaryRename`. Test.
- **Structural alignment (explicit).** The token-substituted diff is still ~153 lines, almost
  entirely **import order/grouping** and **shared-helper naming/position** drift
  (`commitGlossaryMutationStrict` vs `commit…LifecycleMutation`; `lifecycleActionBlockedMessage`
  defined early vs late). Rename the glossary commit/guard helpers to match QA's names, move them to
  the same positions, and reorder imports so a glossary↔qa token-substituted diff is ~empty apart
  from the L6 residue. Required before Phase B collapse. (Pure refactor — its own commit.)

Owner: GPT with Claude review. `npm test` green per commit; keep the refactor (renames/reordering)
separate from the L8/L9 behavior changes.

> **Process note for the remaining pairs (`query`, `import-flow`):** deeper Claude prep up front —
> read the guard/validation internals, not just the top-level functions, so divergences like L8/L9
> are caught *before* handoff — and make "align imports + helper names/positions to a clean
> token-diff" an explicit itemized instruction rather than relying on the "~empty diff" criterion.

## Query-flow rulings (RESOLVED — GPT-ready)

Deep read of `glossary-query.js` (493) vs `qa-list-query.js` (510). Both are well-tested (16 / 15) —
no QA-coverage front-load. **Crucial correction to the first prep pass:** the query layer is far more
unified than feared — **both modules are built on the shared `createRepoResourceQueryController`**, so
divergence is in the per-domain controller *config* + a few helpers, not two competing engines.

- **Q-FEAT-1 — RESOLVED as trivial drift (earlier "high-stakes" call was a misread).**
  `preservePendingGlossaryLifecyclePatches` is **not** an 88-line distinct function — it's a **3-line
  wrapper** (`return preserveGlossaryLifecyclePatchesInSnapshot(...)`); QA uses a 1-line `const` alias.
  Cosmetic. The two `preserve…InSnapshot` fns are otherwise near-identical (softDelete/restore/rename)
  — the **only** real difference is QA's extra **`create`** intent branch, which belongs to Q-FEAT-2.
  *Ruling:* make `preservePending…` a const alias in glossary too (match QA); the preserve fns are
  already mirrors once the `create` branch is added (see Q-FEAT-2).
- **Q-FEAT-2 — the one genuine feature gap: glossary lacks QA's optimistic-create/upsert path.**
  QA has `upsertQaListQueryData`, `upsertQaListForTeam`, the `create` branch in its preserve fn, and
  call sites in `qa-list-import-flow.js` / `qa-list-editor-flow.js`. Glossary has none. *Ruling, split
  in two:* **(a) in the query mirror, additively add** `upsertGlossaryQueryData` + the `create` intent
  branch to `glossary-query`'s preserve fn — inert without callers (glossary has no `create` intent
  yet), so it's safe parity that makes the two query modules mirror; **(b) defer the call-site wiring**
  (`upsertGlossaryForTeam` in glossary import/editor flows) to the **`import-flow`** pair, where the
  create/import path lives.
- **Q-FEAT-3 — `selectedId` on query-snapshot apply: canonical = QA (no fallback in the query path).**
  Glossary's `applyGlossariesQuerySnapshotToState` *delegates* to `top-level-state.applyGlossarySnapshotToState`,
  which auto-selects the first active glossary; QA's *inlines* and does **not** touch `selectedQaListId`.
  Not yanking the user's selection during a background observer refresh is the safer behavior, and the
  `selectedId` reset is already owned by `prime` (R2) and `removeFromState`. *Ruling: glossary adopts
  QA's inline apply* (set `state.glossaries` directly, `setResourcePageDataOwner`, the showDeleted
  check, **no** `selectedId` fallback). This is a behavior change → **add a glossary characterization
  test first** asserting the query-apply path no longer re-selects first-active.

Reconcilable drift (align to QA's cleaner form): persist source (glossary's `persistSnapshot:
persistGlossariesForTeam` off `state` vs QA's `(team, snapshot) => save…(team, snapshot.qaLists)`);
`setRefreshing` inline vs `setResourcePageRefreshing` helper; the `applyWriteIntentOverlay` controller
hook (glossary passes it; QA folds the overlay into `applySnapshotToState`); `createDiscoverySnapshot`
extracted (QA) vs inlined (glossary); plus the usual import/naming/position alignment to a ~empty diff.

**Status: query is GPT-ready.** Order: (0) confirm both test suites green; (1) reconcilable-drift
refactor (align config + helpers + apply-snapshot to QA's inline form) — Q-FEAT-3 char test lands
before the apply-snapshot change; (2) Q-FEAT-2(a) additive `upsertGlossaryQueryData` + `create` branch;
(3) `preservePending` alias; (4) structural alignment to ~empty token-diff. Q-FEAT-2(b) is explicitly
out of scope (import-flow). Owner: GPT with Claude review.

## Import-flow rulings (RESOLVED — GPT-ready)

Detailed read of `glossary-import-flow.js` (905) vs `qa-list-import-flow.js` (827). Normalized diff is
**468 lines** — by far the largest — and the read confirms it is **dominated by legitimate term-model
residue**, not reconcilable drift. **Architecture decision: do NOT force a full token-mirror on this
pair.** Goal = targeted parity (one real gap) + coverage; accept the large term-model residue. This
matches the original frontend plan's tiering (import-flow is the most divergent pair).

- **I1 (open question RESOLVED) — QA's JS-side TMX parsing is per-domain residue, NOT a parity gap.**
  Both domains have drag-drop import (`handleDropped{Glossary,QaList}ImportFile/Path`, wired in
  `events/native-drops.js`). QA parses TMX **client-side** (`parseQaListTmx`, ~80 lines: DOMParser,
  rejects multi-language, builds a single-language list) for a snappy optimistic drag-drop; glossary
  routes TMX through the **backend** (`inspect_tmx_glossary_import` / `import_tmx_to_gtms_glossary_repo`,
  bilingual source+target). A JS *bilingual* parser in glossary would duplicate backend logic (incl.
  gnosis props) — **don't add it.** Leave the JS-parse + drag-drop + bilingual-vs-mono preview + 2-language
  init as documented residue. This is the bulk of the 468.
- **Hidden-forks scan — clean.** The non-term-model behavioral diff is structural drift (prepare
  base-vs-`prepareLinked…`-wrapper; `reloadAfterWrite` operation params; the `…SummariesForTeam`
  naming suffix from `glossary-shared`) plus two glossary-only link/repair helpers
  (`linkedGlossaryMetadataRecord`, `repairIssueMatchesImportedGlossary`). **No new L8/L9-style "one
  validates, the other doesn't" forks.** None block the one parity fix.
- **I2 / Q-FEAT-2b (the single genuine parity gap) — glossary gains optimistic create/import insert.**
  QA's create/import `onSuccess` does `upsertQaListForTeam(team, result.qaList, null, { preserveCreate:
  true })` + `makeQaListDefaultIfFirst`; glossary only `makeGlossaryDefaultIfFirst` + reloads. Prereqs
  confirmed present: `ensureGlossariesQueryDataForTeam`, `upsertGlossaryQueryData` (#53),
  `applyGlossariesQueryDataForTeam`, `makeGlossaryDefaultIfFirst`. **Only `upsertGlossaryForTeam` is
  missing.** Steps: (1) add `upsertGlossaryForTeam(team, glossary, render, options)` to
  `glossary-top-level-state.js`, a direct mirror of QA's `upsertQaListForTeam`; (2) wire glossary's two
  `onSuccess` sites (~603 create, ~847 import) to also `upsertGlossaryForTeam(team, <glossary result>,
  null, { preserveCreate: true })`. **Caveat to verify during impl:** glossary's create `onSuccess` uses
  `result.glossaryId` — confirm the result also carries the full glossary summary object (QA uses
  `result.qaList`); if not, build it before upserting. Behavior change → test.
- **I3 — QA import-flow is UNTESTED** (glossary has 5) → add `qa-list-import-flow.test.js`
  characterization tests FIRST.
- **De-scoped (low ROI):** the structural/import-naming drift and a full token-mirror. Most of the diff
  is legitimate residue; collapsing import-flow in Phase B will use a thin per-domain hook, not a merge.

**Status: import-flow is GPT-ready** with a *narrow* scope. Order: (1) QA characterization tests; (2)
Q-FEAT-2b — `upsertGlossaryForTeam` + the two `onSuccess` sites (+test); done. The term-model residue
and structural drift are accepted, not mirrored. Owner: GPT with Claude review. **This closes the last
Tier 2 pair's Phase-A judgment work** (Q-FEAT-2b also closes the query deferral).

## Definition of done (Phase A)

All four Tier 2 flow pairs are token-substitution mirrors (functional residue only), every step landed
green, and the diverged supporting helpers (`*-top-level-state`, `*-query`) expose a single canonical
API. Phase B (collapse behind the descriptor) then becomes the mechanical step it was for Tier 1.
