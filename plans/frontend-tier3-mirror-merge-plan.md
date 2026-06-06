# Plan: Tier 3 — mirror-then-merge the remaining glossary/QA pairs

Extends `frontend-glossary-qa-unification-plan.md`. Tier 1 (descriptor collapses) and Tier 2
(the four flow pairs: discovery, lifecycle, query, import) are **done** and on `main`. This plan
re-opens **Tier 3**, which the original plan deferred as "too dissimilar / domain-specific."

## Why re-open Tier 3

The Tier 2 lesson holds here too: **diff-distance ≠ functional distance.** A pair can look very
different yet be functionally equivalent (implementation drift), or be intended-equivalent yet have
*actually* drifted apart (latent bug). Both are mirror/merge candidates. Only genuine **term-model**
coupling (bilingual glossary: source/target + ruby; monolingual QA: one language) justifies permanent
separation.

Two corrections to the original Tier 3 record, found during reassessment:

1. **The "8 glossary-only modules" claim was wrong.** QA has a parallel term stack: `qa-term-draft`,
   `qa-term-sync`, `qa-term-inline-markup-flow`, `qa-term-write-coordinator` all exist (the earlier
   check used the wrong `qa-list-*` prefix; QA term modules use `qa-term-*`). These are **pairs**, not
   glossary-only. Only 4 modules are truly glossary-only: `glossary-ruby`,
   `glossary-editor-navigation-source`, `glossary-background-sync`, `glossary-discovery`.
2. **Ruby is a parity gap, not a domain difference** (see "Ruby parity" below).

## Method

Per pair: token-normalized diff (`glossary`/`qaList`→`RES`) for residual size; exported-surface
`comm`; and a **term-model coupling probe** (`sourceLanguage|targetLanguage|ruby|variant|language|
languageCode|EMPTY_TARGET`). Low coupling + high residual ⇒ drift ⇒ merge. High coupling ⇒ justified.

## Verdicts (all Tier 3 pairs)

| Pair | g/q lines | Norm. residual | term-model refs (g/q) | Verdict |
|---|---|---|---|---|
| **repo-flow** | 830/711 | 1015 | 4/3 | **MERGE — top value.** Repo CRUD is domain-agnostic. |
| **term-sync** | 375/366 | 97 | 2/0 | **MERGE.** Repo/term sync plumbing, agnostic. |
| **term-write-coordinator** | 30/45 | 29 | **0/0** | **MERGE.** Write serialization, fully agnostic; QA larger ⇒ a parity gap one way. |
| **top-level-state** | 192/218 | 84 | low | **MERGE after reconcile.** Drift + QA-only rollback/create helpers = glossary parity gaps. |
| **cache** | 32/32 | ~5 | 0 | **MERGE (trivial).** Already config-shaped; only the normalizer name differs. |
| **term-inline-markup-flow** | 132/111 | 73 | 16/1 | **PARTIAL.** Toggle core already shared (`toggleInlineMarkupSelection`); residue = textarea/lane detection (bilingual lanes vs single field). |
| editor-flow | 403/499 | 488 | 30/28 | **Justified** (bilingual term grid + ruby vs monolingual snapshot). Small shared seams only. |
| shared | 426/223 | 431 | total | **Justified** (ruby/variant vs language). **But fix `selectedTeam()` drift — a real bug.** |
| term-draft | 688/331 | 859 | 45/1 | **Justified** (deeply bilingual: source/target/variants). |
| default-flow | 104/107 | ~full | per-language vs per-team | **Justified** (monolingual ⇒ per-language default). |
| default-cache | 54/61 | ~full | per-language vs per-team | **Justified** (same). |
| flow | 69/64 | barrel | n/a | **Neutral** — re-export manifest; only ordering drift. Leave. |

Truly glossary-only (no twin, out of scope for mirroring): `glossary-editor-navigation-source`,
`glossary-background-sync`, `glossary-discovery`. `glossary-ruby` is also twin-less but is **term-model
agnostic** and already imported by QA — see Ruby parity.

## Work plan

Reuse the proven Phase-A→B cadence per pair: **mirror** (converge to a token-substituted near-empty
diff; port best-of-both **both directions** as separate reviewed commits — these are deliberate
behavior changes), then **collapse** behind a `repo-resource/<concern>.js` factory with documented
residue as named descriptor hooks. One pair per PR, `npm test` green per commit, `audit:unused` clean,
GPT implements on its own branch, Claude reviews + merges.

### Stream 1 — Mergeable, ordered by value/risk
1. **repo-flow** (headline). Reconcile heavy drift + asymmetric helpers: QA has `qaListRepoDescriptor`
   + `normalizeRemoteQaListRepo` glossary lacks; glossary has `repairGlossaryRepoBinding` /
   `rebuildGlossaryLocalRepo` QA lacks; naming drift (`getXSyncIssueMessage`,
   `listLocalXSummariesForTeam` vs `listLocalXForTeam`); `createRemoteXRepo` split 1-vs-2. Collapse
   behind `repo-resource/repo-flow.js`; the ~4 language fields become a `buildSummaryRecord` hook.
2. **term-sync** — agnostic sync plumbing; reconcile the 97-line drift, collapse.
3. **term-write-coordinator** — tiny, agnostic; investigate why QA is larger (parity gap), converge,
   collapse (or share outright).
4. **top-level-state** — resolve ordering + normalizer-name drift; **evaluate QA-only helpers**
   (`createQaResourceId`, `syncSingleQaListOrThrow`, `qaListCreationRollbackMessage`,
   `repoBackedQaTermRollbackInput`) as glossary parity gaps (create/import rollback safety, mostly
   agnostic — glossary likely should have them). Reconcile discovery-snapshot shaping. Then collapse.
5. **cache** — trivial; fold in once a descriptor exists from the above.

### Stream 2 — Partial collapse (term-model residue as hooks)
6. **term-inline-markup-flow** — share the markup toggle orchestration; leave textarea/lane detection
   (bilingual source/target lanes vs single field) as a descriptor hook. Low ratio by design.

### Stream 3 — Ruby parity (feature port, do early — small and high-value)

QA already has ruby **editing** (`toggleQaTermInlineStyle` → shared `toggleInlineMarkupSelection`),
**rendering** (`qa-list-editor.js` via `renderGlossaryRubyTermListHtml`/`extractGlossaryRubyVisibleText`),
and **base-text extraction** (`qa-term-draft.js`). The gap is **sanitization-on-persist**: glossary
runs `sanitizeGlossaryRubyMarkup` in both its write path and `normalizeGlossaryTerm`; QA does a bare
`.trim()` in `submitQaTermEditor` (`qa-term-draft.js`) and `normalizeQaTerm` (`qa-list-shared.js`), so
QA can persist unsanitized ruby markup. Fix, following glossary as the example:

- `qa-list-shared.js#normalizeQaTerm`: sanitize the term `text` via the ruby sanitizer (mirror
  `normalizeGlossaryTerm`).
- `qa-term-draft.js#submitQaTermEditor`: sanitize `text` before building the save payload (mirror
  glossary's `sanitizeEditableTerms`).
- Add QA characterization tests mirroring `glossary-ruby` round-trip expectations.
- `notes` stays plain (ruby applies to term text only, matching the editor's ruby target).

**Refactor opportunity (do as part of this):** rename `glossary-ruby.js` → a neutral shared module
(e.g. `term-ruby.js` or `repo-resource/ruby.js`) with non-domain names, since every function except
`targetTextContainsGlossaryVariantExactRuby` (bilingual) is term-model-agnostic and QA already imports
it directly. Keep that one bilingual helper glossary-side.

### Stream 4 — Latent correctness fixes (independent of merging; do regardless)
- **`selectedTeam()` divergence** in `*-shared.js`: glossary takes a `teamId` param and returns `null`
  on miss; QA ignores params and falls back to `state.teams[0]`. Same-named utility that should be
  identical — the silent fallback can mask a wrong-team bug. Decide correct behavior and converge.

## Confirmed permanent (record so it isn't re-litigated)

`editor-flow`, `shared` (core), `term-draft`, `default-flow`, `default-cache`, `flow` (manifest), and
the 3 glossary-only editor/sync/discovery modules.

### Default model — RESOLVED (product-confirmed): per-team glossary vs per-language QA is correct

The `default-flow`/`default-cache` divergence is **intended design, not drift** — confirmed by the
product owner. Rationale: a glossary is **bilingual**, so any "default" would have to be keyed by
*language pair*; a chapter with n languages has (n choose 2) pairs, which makes multiple defaults
unmanageable — hence **one default glossary per team**. A QA list is **monolingual**, so **one default
QA list per language** is both simple and correct. These two are **permanently Tier 3** — do not mirror
or merge them.

## Definition of done

Stream 1–2 pairs each have one shared `repo-resource/` engine with thin descriptor adapters; ruby is at
parity and its util module is neutrally named; `selectedTeam()` is converged; `npm test` + `audit:unused`
green. The justified-permanent set is documented above. The glossary/QA frontend is then single-sourced
except for the irreducible bilingual term-editing core.
