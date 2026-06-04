# Plan: Unify the Reasonable Parts of the Glossary + QA-List Frontend

## Status

Proposed — 2026-06-04. Companion to `glossary-qa-unification-plan.md` (which covers the
backend). Scopes the **frontend** glossary/QA duplication, which that plan assumed was
already done but is not. No implementation started.

## TL;DR

Unify the frontend by **growing the shared `src-ui/app/repo-resource/` framework** and folding
in only the modules that are genuinely duplicated — **not** by merging the paired leaf modules
wholesale. Most pairs have drifted and are 50–120%+ divergent, but for the Tier 2 candidates
that divergence is **~90% accidental implementation drift, only ~10% functional** — the
term-editing modules (the real fork) are glossary-only and stay separate.

Tier 1 pairs are already near-mirrors → collapse them directly. Tier 2 pairs are drifted →
**mirror them first, then collapse** (infrastructure-first), recreating the precondition that
made the backend collapse safe. Share the machinery, respect the bilingual-vs-monolingual fork
— the same conclusion the backend reached.

## Motivation

`src-ui/app/` has ~38 `glossary-*` modules and ~22 `qa-list-*` modules, with only
`repo-resource/{cache.js, query-controller.js}` (548 lines) shared so far. This duplication
carries the same costs as the backend did: the "review for parity" rule, and every fix applied
twice. But unlike the backend sync layer (99% identical), the frontend pairs were **not**
maintained as strict mirrors and have drifted, so a naive collapse is the wrong tool.

## What the code actually shows

Normalized divergence per paired module (glossary↔qa token-substituted, then diffed; figures
are approximate because JS naming drift is cruder than the Rust token-mirror test):

| Module pair | gloss LOC | ~divergent | Tier |
|---|---|---|---|
| `export-flow` | 66 | ~3% | 1 |
| `editor-query` | 70 | ~4% | 1 |
| `write-coordinator` | 121 | ~9% | 1 |
| `old-layout-discard-flow` | 141 | ~14% | 1 |
| `import-flow` | 905 | ~56% | 2 |
| `lifecycle-flow` | 493 | ~61% | 2 |
| `query` | 483 | ~78% | 2 |
| `discovery-flow` | 233 | ~86% | 2 |
| `cache` | 32 | ~93% | 3 (tiny) |
| `flow` | 69 | ~105% | 3 |
| `shared` | 426 | ~103% | 3 |
| `default-flow` | 104 | ~141% | 3 |
| `default-cache` | 54 | ~142% | 3 |
| `editor-flow` | 403 | ~121% | 3 |
| `repo-flow` | 823 | ~123% | 3 |
| `top-level-state` | 81 | ~213% | 3 |

Plus **8 glossary-only modules with no QA counterpart** (~2,000 lines): `term-draft` (688),
`term-sync` (375), `discovery` (358), `background-sync` (226), `ruby` (179),
`term-inline-markup-flow` (132), `term-write-coordinator` (30), `editor-navigation-source` (11).
QA has **zero** unpaired modules — glossary is strictly the superset. "Unification" here means
*QA adopts shared machinery glossary helped define*, not a symmetric merge.

`>100%` divergence means the diff has more changed lines than the file is long (both sides
differ) — i.e. these pairs share a *pattern*, not *code*.

### Functional difference vs implementation drift (Tier 2)

The raw divergence above overstates the *real* difference. Measuring what fraction of each
normalized diff actually touches the term model (source/target/variant/ruby/untranslated vs
text/notes) shows the Tier 2 dissimilarity is **~90% implementation drift, ~10% functional**:

| Module | term-model diff lines | total diff lines | functional | drift |
|---|---|---|---|---|
| `discovery-flow` | 0 | 202 | ~0% | ~100% |
| `query` | ~0 | 379 | ~0% | ~100% |
| `lifecycle-flow` | 14 | 289 | ~5% | ~95% |
| `import-flow` | 44 | 468 | ~9% | ~91% |

Why: Tier 2 modules operate on resource **summaries, lifecycle, discovery, and import
orchestration** — domain-agnostic concerns. The bilingual-vs-monolingual term model barely
enters them; that irreducible fork lives in the Tier 3 editor/term modules. The high line
divergence is overwhelmingly *accidental*:

- **QA was modernized** to newer shared state helpers (`setResourcePageRefreshing`,
  `apply/persistGlossariesQueryDataForTeam`, `currentGlossaryTeam`/`selectedGlossaryTeamMatches`,
  a DRY'd lifecycle-mutation factory, `finally`-based cleanup).
- **Glossary kept older inline patterns** (direct `state.x = …` mutations, repeated cleanup) but
  also has **extra features QA lacks** — sync-failure recovery (`handleSyncFailure`), a
  write-intent overlay, cache-seed control.
- A large chunk is just **import reordering / different helper groupings**, which line-diff
  over-counts.

The genuinely functional ~10% is small and slots behind a domain descriptor: import **term
preview** (glossary shows source/target + variant notes; QA shows single text) and **summary
shape** (glossary source+target language; QA single language).

Two consequences:
1. The case for Tier 2 unification is *stronger* than the raw percentages suggest — most of the
   difference is accidental, which is exactly what unification removes.
2. The drift is **asymmetric** (each side missing the other's improvements) — that asymmetry is
   the parity-rule cost made visible. Unifying will surface and fix those gaps (e.g. QA likely
   lacks glossary's sync-failure recovery), so it is *not* a mechanical merge of near-twins.

## Principles (carried over from the backend)

1. **Share the framework, not the leaves.** Grow `repo-resource/`; keep thin domain modules.
2. **Respect the term-model fork.** Glossary = bilingual (source/target terms, variant notes,
   ruby, inline markup); QA = monolingual (single text + notes). Do not unify term editing.
3. **No type checker = more caution.** Vanilla JS has no compiler to catch a broken refactor;
   the 1,233-test JS suite is the only net. Favor small, high-confidence increments; run
   `npm test` after each. Per-change regression risk is higher and dedup payoff lower than the
   backend, so the bar for "worth it" is higher.
4. **Preserve module ownership** (`AGENTS.md`): `*-flow` = intent/navigation, `*-query` =
   cache/observers, `*-discovery-flow` = loading via injected publishers. Shared code must not
   blur these roles.
5. **Mirror before merge (Tier 2).** The backend collapse was safe and near-mechanical only
   because the two files were already near-mirror images. Drifted pairs must be *converged into
   mirrors first* (their own phase), then collapsed — see Tier 2. Keep pure refactors and
   feature-ports as separate, individually test-gated commits.

## Scope: three tiers

### Tier 1 — collapse now (low risk, genuine duplication)

`export-flow`, `editor-query`, `write-coordinator`, `old-layout-discard-flow`.

These are real token-mirrors (3–14% divergent), so they **skip the mirror phase** and collapse
directly. For each pair, extract one shared implementation into `repo-resource/` parameterized
by a small **frontend resource descriptor** (command names, resource-id key
`glossaryId`/`qaListId`, cache keys, display noun), and replace both domain modules with thin
adapters that pass their descriptor. This is the JS analogue of the backend's
`RepoResourceStorageDomain`, and a good warm-up that proves the descriptor pattern before Tier 2.

Deliverable: a `repo-resource/resource-descriptor.js` (or extend `query-controller.js`) plus
4 collapsed pairs. Each pair lands as its own commit, `npm test` green.

### Tier 2 — mirror, then collapse (two phases, infrastructure-first)

`import-flow`, `lifecycle-flow`, `query`, `discovery-flow`.

These are ~90% drift, ~10% functional (see above). Because they are *not* mirrors, do **not**
attempt a one-shot merge. Converge them first, then collapse — recreating the precondition that
made the backend collapse safe. This also keeps a no-type-checker refactor bisectable: a test
failure in Phase A is a reconciliation bug; in Phase B, a collapse bug.

**Phase A — mirror (both files stay; behavior preserved or improved).** Proceed
**bottom-up**: you cannot mirror a flow module while the two sides call diverged helpers, so
reconcile the shared infrastructure first.

1. **Reconcile shared infra.** Converge the diverged helper APIs in `*-top-level-state` and
   `*-query` to one canonical, best-of-both set (adopt QA's cleaner state abstractions; keep
   glossary's richer features). Each helper change is its own test-gated commit.
2. **Mirror each pair on top.** Adopt the same helpers, declaration order, and structure until a
   glossary↔qa token-substituted diff is ~empty. Port missing features **across both
   directions** (e.g. give QA glossary's sync-failure recovery) as separate, individually tested
   commits — these are deliberate behavior changes, not de-drift, and must be reviewed as such.

Phase A has standalone value: two mirrored files restore the parity property even if a pair is
never collapsed, and future drift becomes a visible diff.

**Phase B — collapse.** With each pair now near-identical, extract the shared core into
`repo-resource/` and replace both modules with thin descriptor adapters:

- `query` / `editor-query`: snapshot application, observer subscription, optimistic-mutation
  wiring → widen `query-controller.js`.
- `lifecycle-flow`: soft-delete/restore/rename/purge orchestration + permission gating +
  optimistic state → shared lifecycle helper; domain supplies labels.
- `discovery-flow`: repo enumeration, sync-state reconciliation, publish-via-injected-callback
  → shared loader; domain supplies the per-resource normalizer.
- `import-flow`: file pick, size-limit messaging, TMX inspect/confirm flow, progress, error
  surfacing → shared; the ~10% functional residue (term-preview rendering, term shape) becomes
  descriptor hooks.

Deliverable: Phase A converges the pairs (mergeable on its own); Phase B collapses them behind
the descriptor. One module-pair per PR (these are large), `npm test` green per step.

### Tier 3 — leave separate (domain-specific or not worth it)

`editor-flow`, `repo-flow`, `shared`, `top-level-state`, `default-flow`, `default-cache`,
`flow`, `cache` (tiny), and **all 8 glossary-only modules** (`term-draft`, `term-sync`,
`ruby`, `term-inline-markup-flow`, `term-write-coordinator`, `editor-navigation-source`,
`background-sync`, `discovery`).

Rationale: these encode the bilingual term editor, ruby annotations, inline markup, and
per-domain state/render wiring. They are >100% divergent or glossary-only. Forcing them
together is a leaky abstraction for little gain. (`cache`/`flow` are too small to be worth a
descriptor indirection even though same-shaped.)

## Sequencing

1. **Tier 1** first (lowest risk, proves the descriptor pattern). 4 small PRs or one batched.
2. Reassess: confirm the descriptor abstraction reads well before scaling it.
3. **Tier 2 Phase A — infra reconcile.** Converge `*-top-level-state` / `*-query` helper APIs
   (best-of-both). This unblocks mirroring every Tier 2 pair and is valuable on its own.
4. **Tier 2 Phase A — mirror each pair** (one pair per PR), de-drift + feature-port commits kept
   separate. Stop here is a coherent state (parity restored).
5. **Tier 2 Phase B — collapse each mirrored pair** behind the descriptor (one pair per PR),
   largest (`import-flow`) last.
6. **Tier 3:** explicitly **not** done — record the decision so future agents don't re-litigate.

## Out of scope

- The glossary-only term-editing stack (Tier 3) — permanent, by design.
- Backend changes (covered by `glossary-qa-unification-plan.md`; sync done, storage scaffolding
  in PR #33).
- The `screens/` layer and any editor-inline-markup modules.

## Verification

- `npm test` (1,233 tests) green after **every** increment — this is the only safety net.
- `npm run audit:unused` to catch exports orphaned by collapsing.
- Manual smoke per tier in `npm run tauri:dev`: create/rename/soft-delete/restore/import/export
  for both a glossary and a QA list; confirm editor load + term add/edit/delete still work.

## Expected payoff

Tier 1 + Tier 2 remove the parity burden from the high-churn flow/query/lifecycle/discovery
plumbing (~1,500–2,000 lines of duplication single-sourced) without touching the term model.
Tiers are independent, so value lands incrementally and the effort can stop at any tier
boundary with a coherent result.
