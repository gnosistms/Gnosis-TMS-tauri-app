# Globally Longest Glossary Matching — Lean Implementation Plan

Status: PLANNED — design only; no runtime code has been changed.

Supersedes the earlier, larger draft of the same name (written in a Codex
worktree, never committed to main). This revision keeps that draft's semantic
core — exhaustive occurrence discovery, a global priority tuple, greedy
occupancy selection, and shared JS/Rust golden fixtures — and deliberately
removes its content-hash matcher cache, shadow-comparison phase, raw row-match
LRU, and benchmark threshold program. The "Deliberately dropped" section at the
end records what was cut and why, so the cuts are not mistaken for oversights.

## Problem

Both glossary matchers select matches with a left-to-right, commit-at-each-start
scan: at each word position they accept the longest candidate that starts there
and jump past it.

- Frontend: `findLongestGlossaryMatches` in
  `src-ui/app/editor-glossary-highlighting.js`, fed by
  `buildLanguageGlossaryMatcher` (first-token buckets sorted by token count,
  then JS UTF-16 string length).
- Backend: `find_matched_glossary_terms` in `src-tauri/src/ai/mod.rs`, fed by
  `build_glossary_match_candidates` (same bucketing, tie-broken by Rust UTF-8
  byte length via `match_term.len()`). Locate by function name — `ai/mod.rs`
  is under active change (AI-review footnote work) and line numbers drift.

This is "longest at the current start", not "longest anywhere": an earlier
shorter match can occupy tokens needed by a later longer match (e.g. `The
Astral` claiming `Astral` before `astral plane` can match). The two runtimes
also disagree on the length tie-break (UTF-16 units vs UTF-8 bytes), so the
same glossary can select different terms in the editor and in backend derived
alignment.

Two adjacent correctness bugs were confirmed during review and are fixed first,
independently of the matcher rewrite (Part A):

1. **Cross-row bridging in batch derivation.** `prepare_ai_translated_glossary_batch`
   in `src-tauri/src/ai/mod.rs` joins the batch's source rows with `"\n\n"` and
   matches the combined text. The tokenizer treats every separator alike, so a
   glossary phrase can match across a row boundary.
2. **Naive substring redistribution.** `editor-derived-glossary-batch-flow.js`
   redistributes prepared derived entries to rows with
   `entry.context.sourceText.includes(prepared.sourceTerm)` — a plain substring
   check that matches `he` inside `theme` and ignores token boundaries.

## Coordination with in-flight work (as of 2026-08-03)

Two uncommitted change sets on `codex/project-transfer` touch the same files
and must land before Part B starts (rebase Part B on them; do not develop in
parallel):

1. **Chinese glossary highlighting fix** (`plans/chinese-glossary-highlighting-fix-plan.md`).
   Language-code comparison in `sectionMatchesLanguage`, the highlight cache
   key, and direct-versus-derived target precedence is now case-insensitive
   BCP-47 (`normalizedLanguageCodeForComparison` in
   `editor-glossary-highlighting.js`; `languageMatchesBaseCode` /
   `languageBaseCodesMatch` from `editor-language-utils.js`), and the backend
   canonicalizes newly stored glossary language codes
   (`normalize_glossary_language_code` in `glossary_storage/mod.rs`,
   `zh-hant` → `zh-Hant`). Consequences for Part B:
   - The new matcher wrapper and `glossary-token-matcher.js` must route every
     language-code comparison through these shared helpers. Raw string
     equality on codes would regress the fix — legacy glossary data still
     stores lowercase script subtags, and canonicalization only applies to
     newly written records.
   - Tokenizer-mode selection (the non-space-delimited language set) must be
     decided from the case-normalized base code, so `zh-hant`, `zh-Hant`, and
     `ZH_HANT` all select grapheme tokenization.
   - The Chinese-fix regression tests in `editor-glossary-highlighting.test.js`
     and `editor-glossary-highlight-cache.test.js` must keep passing untouched
     through the matcher swap.
2. **AI-review footnote integrity work** in `src-tauri/src/ai/mod.rs` (~260
   changed lines, all in the review prompt/parse region). It does not touch
   the glossary matcher functions, but it moves line numbers and shows
   `ai/mod.rs` is under active churn — one more reason the matcher extraction
   into `glossary_matcher.rs` should happen early in Part B, keeping later
   matcher commits out of `mod.rs` merge traffic.

## Part A — Standalone bug-fix PR (ship first)

Small, independent of the matcher rewrite, delivers value even if Part B slips.

1. **Row-bounded batch matching.** Change the batch derived path so glossary
   matching runs per pivot row and the selected alignment items are deduplicated
   after per-row matching. Extend the batch request to carry ordered pivot texts
   (or match each already-carried row text independently before combining
   results). Do not rely on newlines, punctuation, or an invented sentinel that
   could collide with user text. Regression test: a two-token candidate whose
   tokens are the last word of row N and the first word of row N+1 must not
   match.
2. **Token-aware redistribution.** Replace the `String.includes` check with
   token-sequence containment using the existing exported tokenizer helpers
   (`tokenizeGlossaryTerm` / word tokenization from
   `editor-glossary-highlighting.js`). Regression tests: `he` must not match in
   `the theme`; hyphen/em-dash separated forms must still match.

Tests for Part A live in `editor-derived-glossary-batch-flow.test.js` and the
Rust tests in `ai/mod.rs`. No behavior change to single-row matching.

## Part B — Global matching

### Required semantics (unchanged from the original draft)

**Tokenization and equality.** No substring matching: a candidate matches only a
consecutive sequence of matchable tokens.

- Space-delimited frontend and current Rust behavior keep the
  `[\p{L}\p{M}\p{N}]+` tokenizer. The frontend keeps grapheme units for its
  non-space-delimited language set (`zh`, `ja`, `th`, `lo`, `km`, `my`, `bo`,
  `dz`), selected by case-normalized base code (see Coordination section). Do
  not change backend tokenization to add CJK parity in this project; document
  the difference.
- Punctuation and hyphens remain ignored separators: `astral-plane`,
  `astral plane`, and `astral—plane` all have the same two match tokens, while
  `astral` must not match inside `astrally`.
- Frontend keeps `toLocaleLowerCase(languageCode)`; Rust keeps default Unicode
  `char::to_lowercase`. Shared fixtures cover the common contract;
  runtime-specific tests pin known locale-sensitive differences.
- No accent folding, Unicode normalization, stemming, or punctuation-sensitive
  equality. Ruby base text and inline-markup base text handling stay as they
  are, with visible ranges mapped back through the existing utilities.

**Candidate identity.** Compilation merges exact duplicate normalized token
sequences before building the trie, preserving first-seen order for term IDs,
source/origin terms, target variants and per-variant notes, no-translation
data, translator/global notes, and footnotes — exactly the merge the two
matchers already perform. Sanitization and all tooltip/hint payload shapes stay
unchanged.

**Do not keep only the longest occurrence at each start.** For tokens
`A B C D E F G` with candidates `A B C D`, `A B`, and `C D E F G`: the globally
longer `C D E F G` wins and rejects `A B C D`, but the shorter same-start `A B`
is disjoint and must still be accepted. Phase-1 discovery must therefore emit
every terminal at every start.

**Global occurrence priority.** Every discovered occurrence gets an immutable
priority tuple:

1. Candidate token count, descending.
2. Candidate base-term length in Unicode scalar values, descending — counted on
   the sanitized/ruby-base glossary variant including its separators. Not JS
   UTF-16 units, not Rust bytes; those disagree for non-ASCII text. For
   duplicate normalized variants, use the greatest scalar length as the
   priority length while keeping metadata in first-seen order.
3. Occurrence start word/unit index, ascending.
4. Occurrence end word/unit index, ascending.
5. Normalized token-sequence key, ascending by scalar values.
6. Stable candidate ordinal from first-seen input order, ascending (defensive
   tie-break so `Map`/`HashMap` iteration order can never decide a match).

The priority uses the glossary variant, not the surface text, so changing `-`
to `—` in the input cannot change which term wins. Example: equal two-token
candidates `The Astral` and `astral plane` are decided by scalar length, so
`astral plane` wins the crossing overlap in `The Astral Plane`.

**Greedy selection, not optimal interval scheduling.** Sort occurrences by the
tuple, accept if no token in the span is occupied, reject otherwise. This is
the historical longest-first rule applied globally — it does not maximize total
coverage, and a golden fixture must pin the difference so a later refactor
cannot silently "improve" it into a dynamic-programming scheduler. Repeated
non-overlapping occurrences stay accepted; downstream hint/alignment dedupe
still collapses repeated surfaces after selection; highlighting renders every
accepted occurrence. Accepted occurrences are returned in source order.

### Design

Four explicit stages in both runtimes:

```text
raw glossary entries -> sanitize/tokenize/merge -> compiled token trie
input text -> tokenize once -> discover all terminal occurrences
           -> rank globally, select by occupancy -> accepted matches in source order
```

- **Frontend:** add `src-ui/app/glossary-token-matcher.js` holding the generic
  compiled trie, discovery, ranking, and occupancy selection. It imports (or is
  injected with) the existing language-aware tokenizer helpers — no duplicate
  tokenizers. Metadata merging, HTML, tooltips, target validation, and hint
  formatting stay in `editor-glossary-highlighting.js`.
  `findLongestGlossaryMatches` keeps its name and signature as a wrapper; rename
  to `findGloballyLongestGlossaryMatches` only after all callers/tests migrate
  and `npm run audit:unused` is clean.
- **Backend:** add `src-tauri/src/ai/glossary_matcher.rs`, declared from
  `ai/mod.rs`. It accepts already-sanitized candidates plus a tokenizer adapter
  and returns occurrence spans/candidate IDs — no AI provider types, so it is
  unit-testable without Tauri. AI request types, prompt construction, and
  alignment parsing stay in `ai/mod.rs`.
- **Trie:** intern normalized tokens to integer IDs once per matcher. Nodes
  store token-ID transitions (`Map`/`HashMap` first; only change representation
  if the benchmark shows a reason) and terminal candidate IDs. Candidates store
  token count, scalar priority length, ordinal, and an index into merged
  metadata stored once on the matcher. Occurrences are index records — they
  must not clone metadata. The Rust path currently clones a full
  `PreparedGlossaryCandidate` per match; replace with candidate IDs and clone
  only the final strings placed into the response/prompt.
- **Discovery:** tokenize input once; from each position follow transitions to
  the maximum candidate depth, emitting an occurrence for every terminal passed,
  not only the deepest.
- **Selection:** sort occurrence indexes by the priority tuple, then use a
  token-occupancy bitset (`Uint32Array` in JS, `Vec<u64>` in Rust — no new
  crate) to accept/reject. Collect accepted IDs and return them in source order.
  Optional micro-optimization, only if the benchmark motivates it: bucket by
  token count and sort within buckets (selection becomes effectively `O(M)`).
  Worst-case adversarial nesting (`a`, `a a`, `a a a`, …) can make discovery
  emit `O(N·D)` occurrences; the adversarial benchmark case observes this, and
  no silent cap may be added — any future limit must fail visibly.
- **Aho–Corasick: not planned.** Glossary phrases are 1–4 tokens deep, so the
  trie scan is effectively linear. Reconsider only if the benchmark shows
  discovery dominating on the 16k corpus, and record the evidence here first.

### Caching (simplified — no content hashing)

There is **no canonical fingerprint, no hash, no collision guard, and no
byte-bounded cache** in this plan. Compilation is cheap (a few ms for the real
737-term glossary; tens of ms for a hypothetical 16k corpus) and happens once
per glossary edit, so we recompile instead of proving cache identity:

- **Frontend:** the glossary model keeps holding its compiled matcher by object
  reference, exactly as today. A glossary edit/reload rebuilds the model and
  its matcher; chapter reopen recompiles. The existing rendered highlight cache
  (`editor-glossary-highlight-cache.js`, keyed partly by matcher object
  identity) continues to work unchanged — a new matcher object naturally
  invalidates it. Its revision-key helper is untouched.
- **Backend:** compile per preparation request. If profiling shows repeated
  compilation matters for batch flows, keep at most a single-entry cache of the
  last request's sanitized candidate list compared **by value**, holding an
  `Arc<CompiledGlossaryMatcher>` — equality by comparison, never by hash.
- If a 16k frontend compile ever exceeds the long-task threshold in practice,
  scheduling it off the render path is a follow-up; editor rendering must never
  await a Tauri/network round trip for a matcher.

### Rollout

One policy constant with two values, `legacy` and `globalTrie`, defined once
per runtime and asserted equal through the shared fixture version so frontend
and backend can never straddle algorithms. No shadow mode, no sampling, no
telemetry counters. Implementation lands with the constant on `legacy`; the
flip to `globalTrie` is its own commit once the full test and benchmark
checklist passes on macOS and Windows. Rollback is either flipping the constant
in a patch release (both stacks together) or reverting the flip commit. There
is no data or repository migration; the derived-glossary staleness key gains
the matcher policy value so derived entries regenerate rather than mixing
algorithms.

Keep the legacy scan for one release cycle after the flip, then delete it,
retaining the slow exhaustive reference matcher in tests only.

### Consumer migration

All consumers switch in the same release, through the same wrapper — no
consumer gets a private overlap policy:

| Consumer | Notes |
|---|---|
| Editor direct source/target highlight | Every accepted occurrence renders; target gating and missing-target errors use merged candidate variants as today. Direct target highlights keep precedence over derived. |
| Derived source/target highlight | Provenance, notes, footnotes, no-translation, ruby handling unchanged. |
| Single-row AI Translate hints | Dedupe accepted matches by normalized surfaced `sourceTerm`; first source-order occurrence wins. |
| AI Translate All | Each row matched independently, then batch union — Part A guarantees no cross-row matches. |
| AI Review (meaning mode), AI assistant | Consume the same wrapper output; existing request-shape rules unchanged. |
| Backend derived alignment (single + batch) | Accepted occurrences become alignment prompt items in source order. |

While migrating, also remove the duplicate private
`buildDerivedGlossaryTermInputs` in `editor-ai-assistant-flow.js` in favor of
the exported helper from `editor-derived-glossary-flow.js` — two copies can
drift and produce different backend inputs.

**Pinned behavior change to watch:** the backend currently deduplicates surface
terms *during* the scan (`seen_surface_terms` in
`find_matched_glossary_terms`). Under
global selection, dedupe moves after selection, which can change which
occurrence supplies `glossary_source_context` for the alignment prompt. A
fixture must pin the new rule: first accepted occurrence in source order wins.

## Tests

### Shared golden fixtures

`tests/fixtures/glossary-matching/golden.json`, read by
`editor-glossary-highlighting.test.js` and by Rust via `include_str!`. Each
case carries: case ID, tokenizer profile, language code where relevant, ordered
candidate variants/metadata, input text, expected discovered occurrences,
expected accepted occurrences in source order, and winning candidate IDs.

Required cases:

1. `The Astral` vs `astral nodes` / `astral plane` / `astral sheath` — casing
   plus a crossing equal-token-count choice decided by scalar length.
2. `aspiring atoms` vs its component terms, occurrences in both orders, so a
   left-to-right scan cannot accidentally pass.
3. `A B C D` / `A B` / `C D E F G` — longer same-start rejected by a crossing
   winner while the shorter same-start survives.
4. Equal token and scalar lengths crossing — leftmost wins.
5. Exact same-span duplicate normalized terms — metadata merge order stable.
6. Punctuation/hyphen/em-dash separators, inside both input and glossary
   variant.
7. Composed vs decomposed Unicode — pinning the *absence* of normalization.
8. Locale-sensitive case: one frontend-only case, one Rust-only case where the
   adapters intentionally differ.
9. Non-space-delimited Japanese/Chinese with nesting and ruby base text —
   frontend-only. Include a mixed-case language-code variant (glossary stores
   `zh-hant`, editor column uses `zh-Hant`) so grapheme-mode selection and
   highlight-map keying stay case-insensitive after the matcher swap.
10. Repeated, adjacent, and punctuation-separated occurrences.
11. `he` must not match inside `the theme`.
12. No-translation candidates and candidates with ruby targets, notes, and
    footnotes — selection strips no payloads.
13. A greedy result that differs from maximum-total-coverage scheduling.
14. Duplicate normalized variants of different scalar lengths — greatest length
    is the priority length, metadata order stays first-seen.
15. Empty terms/text, all-punctuation terms, no-match text.

### Unit tests (both runtimes)

- Trie contains every terminal; merges only identical normalized sequences.
- Discovery returns nested and crossing terminals at every start.
- Comparator is total and independent of insertion/iteration order.
- Bitset overlap checks at word boundaries 31/32 and 63/64.
- Accepted matches never overlap; every rejection overlaps an earlier accepted
  higher-priority occurrence.
- Property test: small random token alphabets compared against a deliberately
  slow exhaustive reference implementation, same deterministic seed corpus in
  JS and Rust.

### Integration tests

- Frontend: extend `editor-glossary-highlighting.test.js` with the golden
  cases; verify highlight/tooltip/missing-target output when the global winner
  differs from the old leftmost winner; verify hint consumers
  (`ai-review-and-settings.test.js`, batch request, assistant, translate-all
  tests) receive the global set with existing dedupe order;
  `editor-glossary-highlight-cache.test.js` confirms a rebuilt matcher object
  invalidates the rendered cache.
- Backend: port the duplicate-source-term test onto the shared fixture; assert
  single and batch preparation send accepted occurrences to alignment in source
  order, that a rejected overlap never reaches the prompt, that post-selection
  dedupe follows the pinned rule above, and that UTF-8 context slicing stays on
  char boundaries.
- Browser smoke test: one editor regression fixture with the Astral +
  aspiring-atoms glossary; assert direct highlights, mocked Translate,
  Translate All, meaning Review, assistant hints, and mocked derived alignment
  all reflect the same selected set.

## Benchmarks (before/after evidence, not a threshold program)

One script per runtime, checked into `scripts/` (Node) and a criterion bench
(Rust). Corpora: the real 737-term glossary snapshot (or its deterministic
anonymized generator if the content cannot be committed) and one generated
~16k-term corpus with common-prefix families. Workloads: a typical 100-token
row, a 2,000-token row, a realistic batch chunk, a no-match text, and one
overlap-heavy adversarial case.

Record medians (30 iterations after warm-up) for compile, uncached match, and
batch match, before and after the change, plus machine and commit SHA, in this
plan's implementation log. Single acceptance rule: **normal and no-match
workloads must not regress more than 20% versus the captured legacy baseline
(excluding compilation)**; overlap-heavy cases may legitimately do more work.
`npm test` and `cargo test` must not run timing assertions.

## Deliberately dropped from the original draft

Recorded so these are read as decisions, not omissions:

- **Canonical fingerprint / hash / collision-guarded matcher caches** — cut.
  Recompiling on glossary edit costs milliseconds; hashing added the plan's
  riskiest correctness surface (collision → wrong matches) to save time nobody
  loses. Object identity plus rebuild-on-edit already invalidates correctly.
- **Raw row-match LRU below the rendered cache** — deferred. The existing
  400-row rendered cache absorbs re-render cost; per-row uncached matching is
  microseconds-to-a-millisecond. Revisit only if the benchmark shows repeated
  matching across consumers actually costs something.
- **Phase 3 shadow mode** (sampled dual-compute, privacy-safe counters) — cut.
  Golden fixtures plus property tests against the exhaustive reference in both
  runtimes provide the confidence; this is a local-first desktop app, not a
  server fleet.
- **Three-way policy with `globalTrieShadow`** — reduced to two-way.
- **Benchmark threshold tables** (p95 gates per workload, memory gates across
  20 revisions, reference-machine protocol) — reduced to before/after medians
  with one 20% regression rule.
- **Token-level Aho–Corasick and its decision gate** — not planned; see Design.

## Documentation updates (when implementation lands)

- `docs/glossary-matching.md`: token boundaries, punctuation/hyphen treatment,
  globally longest greedy selection, tie rules, and the distinction from both
  substring matching and optimal interval scheduling.
- `src-ui/AGENTS.md` and `src-tauri/AGENTS.md`: glossary matching invariants —
  all highlight and hint consumers use the shared matcher; discovery keeps
  overlaps; no consumer implements private selection; frontend/backend policy
  constants must match.
- Root `AGENTS.md` key locations: the two new matcher modules.
- `AGENTS_EVIDENCE.md` files: canonical source references.
- Comments in `editor-ai-batch-request.js`,
  `editor-derived-glossary-batch-flow.js`, and `src-tauri/src/ai/mod.rs`
  stating the row-boundary and global-selection behavior.

## Definition of done

- Part A shipped: batch matching is row-bounded and redistribution is
  token-aware, with regression tests.
- Both runtimes discover every relevant overlap and select identical results on
  the shared golden fixtures with the specified deterministic priority.
- All fifteen fixture families pass; property tests pass against the exhaustive
  reference in both runtimes with shared seeds.
- All consumers (direct/derived highlighting, target gating, Translate,
  Translate All, meaning Review, assistant, backend single/batch alignment)
  switch together behind the two-way policy; the pinned dedupe-order fixture
  passes.
- Benchmark before/after medians recorded here; the 20% regression rule holds.
- Policy flipped to `globalTrie` in its own commit after macOS and Windows test
  passes; legacy code scheduled for deletion one release later.
- `npm test`, targeted browser tests, `npm run lint:js`,
  `npm run audit:unused`, Rust unit tests, `cargo fmt --check`, and strict
  Clippy pass.

## Implementation log

Implemented 2026-08-03 (Part A and Part B in one change set; policy default
`legacy` per rollout plan — the flip to `globalTrie` is a later one-line commit
touching both runtime constants plus the fixture's `defaultPolicy`).

Deviations from this plan, all recorded deliberately:

- The semantics reference lives at `plans/glossary-matching-semantics.md`, not
  `docs/glossary-matching.md` — `docs/` is the public website source, not an
  internal docs tree.
- The Rust benchmark is an `#[ignore]`d test
  (`bench_glossary_matcher_policies`) rather than a criterion bench — no new
  crate, run via `cargo test --release --lib ai::glossary_matcher --
  --ignored --nocapture`.
- The duplicate `buildDerivedGlossaryTermInputs` consolidation in
  `editor-ai-assistant-flow.js` was left out of this change set (scope
  discipline: no behavior interaction with the matcher swap); tracked as a
  follow-up.

Benchmark results (Apple Silicon dev machine, Darwin 25.5.0, 2026-08-03,
synthetic corpora from the seeded generators in the bench tools):

JS (`node scripts/bench-glossary-matcher.mjs`; compile = full glossary model
build including both matchers and metadata):

| Workload | 737 terms legacy | 737 globalTrie | 16k legacy | 16k globalTrie |
|---|---:|---:|---:|---:|
| compile (model build) | 13.7 ms | — | 273.6 ms | — |
| typical 100-token row | 0.030 ms | 0.025 ms | 0.034 ms | 0.017 ms |
| long 2000-token row | 0.391 ms | 0.384 ms | 0.872 ms | 0.348 ms |
| no-match 250-token row | 0.038 ms | 0.033 ms | 0.034 ms | 0.033 ms |
| overlap-heavy row | 0.026 ms | 0.039 ms | 0.087 ms | 0.042 ms |

Rust (release; match figures include per-request candidate compilation, which
dominates):

| Workload | 737 legacy | 737 globalTrie | 16k legacy | 16k globalTrie |
|---|---:|---:|---:|---:|
| compile only | 1.79 ms | — | 14.3 ms | — |
| typical 100-token row | 0.86 ms | 0.76 ms | 14.3 ms | 14.3 ms |
| long 2000-token row | 1.07 ms | 1.07 ms | 15.0 ms | 14.7 ms |

Conclusions: the 20% regression rule passes everywhere (globalTrie is equal or
faster on every workload except a 0.013 ms overlap-heavy delta at 737 terms,
within the overlap-heavy exemption). Aho–Corasick remains unjustified —
discovery is nowhere near dominating. The one number worth watching is the 16k
frontend model build (274 ms once per glossary edit); if a real glossary ever
approaches that size, schedule compilation off the render path as the plan
already anticipates.
