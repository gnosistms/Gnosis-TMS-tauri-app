# Plan: Unify the Reasonable Parts of the Glossary + QA-List Frontend

## Status

Proposed — 2026-06-04. Companion to `glossary-qa-unification-plan.md` (which covers the
backend). Scopes the **frontend** glossary/QA duplication, which that plan assumed was
already done but is not. No implementation started.

## TL;DR

Unify the frontend by **growing the shared `src-ui/app/repo-resource/` framework** and folding
in only the modules that are genuinely duplicated — **not** by merging the paired leaf modules
wholesale. Most pairs have drifted and are 50–120%+ divergent; the term-editing modules are
glossary-only. Share the machinery, respect the bilingual-vs-monolingual fork — the same
conclusion the backend reached.

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

## Scope: three tiers

### Tier 1 — collapse now (low risk, genuine duplication)

`export-flow`, `editor-query`, `write-coordinator`, `old-layout-discard-flow`.

These are real token-mirrors (3–14% divergent). For each pair, extract one shared
implementation into `repo-resource/` parameterized by a small **frontend resource descriptor**
(command names, resource-id key `glossaryId`/`qaListId`, cache keys, display noun), and replace
both domain modules with thin adapters that pass their descriptor. This is the JS analogue of
the backend's `RepoResourceStorageDomain`.

Deliverable: a `repo-resource/resource-descriptor.js` (or extend `query-controller.js`) plus
4 collapsed pairs. Each pair lands as its own commit, `npm test` green.

### Tier 2 — extract the shared core, keep domain specifics

`import-flow`, `lifecycle-flow`, `query`, `discovery-flow`.

Each is ~40–60% common plumbing wrapped around domain-specific bits. Do **not** merge the
files; instead harvest the shared half into `repo-resource/` helpers and have both domain
modules call them:

- `query` / `editor-query`: snapshot application, observer subscription, optimistic-mutation
  wiring → already partly in `query-controller.js`; widen it.
- `lifecycle-flow`: soft-delete/restore/rename/purge orchestration + permission gating +
  optimistic state → shared lifecycle helper; domain supplies labels and the resource shape.
- `discovery-flow`: repo enumeration, sync-state reconciliation, publish-via-injected-callback
  → shared loader; domain supplies the per-resource normalizer.
- `import-flow`: file pick, size-limit messaging, TMX inspect/confirm flow, progress, error
  surfacing → shared; the term-preview rendering and term-shape stay domain-specific.

Deliverable: shared helpers in `repo-resource/`; each domain module shrinks to domain glue.
One module-pair per PR (these are large), `npm test` green per step.

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

1. Land Tier 1 first (lowest risk, proves the descriptor pattern). 4 small PRs or one batched.
2. Reassess: confirm the descriptor abstraction reads well before scaling it.
3. Tier 2 one pair at a time, largest (`import-flow`, `repo-flow-adjacent query`) last.
4. Tier 3: explicitly **not** done — record the decision so future agents don't re-litigate.

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
