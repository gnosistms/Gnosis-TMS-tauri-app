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

## Phase A for the `discovery-flow` pair (the worked template — do this first, by hand)

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
  sync-failure recovery in the catch; `syncIssue`/`brokerWarning` surfacing after apply; the
  `seedFromCache` option in prime; the nuanced error-state branch; `qaListRepoSyncByRepoName` reset.
  After this, QA's flow is feature-complete vs glossary.
- **A5 — rewrite glossary-discovery-flow to the canonical shape (refactor commit).** Switch to
  `setResourcePageRefreshing`, `applyGlossariesQueryDataForTeam`, `currentGlossaryTeam`/
  `selectedGlossaryTeamMatches`, and a `finally` cleanup — matching QA's structure exactly.
- **A6 — verify mirror.** Token-substituted diff of the two flow modules should be ~empty (only the
  genuinely-functional residue remains). `npm test` green.

Owner: **Claude** (judgment-heavy: best-of-both + feature ports). This pair establishes the template.

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

## Definition of done (Phase A)

All four Tier 2 flow pairs are token-substitution mirrors (functional residue only), every step landed
green, and the diverged supporting helpers (`*-top-level-state`, `*-query`) expose a single canonical
API. Phase B (collapse behind the descriptor) then becomes the mechanical step it was for Tier 1.
