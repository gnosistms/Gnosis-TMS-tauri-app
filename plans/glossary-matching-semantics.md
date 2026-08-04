# Glossary Matching Semantics (Reference)

Reference for how glossary terms match text in both runtimes. The executable
contract is `tests/fixtures/glossary-matching/golden.json`, consumed by
`src-ui/app/glossary-token-matcher.test.js` and the tests in
`src-tauri/src/ai/glossary_matcher.rs`.

## Token boundaries

- Matching is token-based, never substring-based: `he` does not match inside
  `the` or `theme`; `astral` does not match inside `astrally`.
- Tokens are maximal runs of `\p{L}\p{M}\p{N}`. Punctuation, hyphens, em
  dashes, and all other separators are boundaries, not match characters:
  `astral-plane`, `astral plane`, and `astral—plane` are the same two-token
  sequence.
- The frontend uses grapheme units instead of words for the
  non-space-delimited language set (`zh`, `ja`, `th`, `lo`, `km`, `my`, `bo`,
  `dz`), selected by case-normalized base code. The backend has no grapheme
  mode; this difference is deliberate and pinned by fixture cases.
- Case folding differs by design: the frontend uses
  `toLocaleLowerCase(languageCode)`, the backend uses Rust
  `char::to_lowercase`. The Turkish fixture cases pin the divergence.
- There is no Unicode normalization, accent folding, or stemming: composed
  and decomposed forms are distinct, deliberately.

## Selection: globally longest, greedy

Under the `globalTrie` policy, both runtimes:

1. Compile merged candidates (exact duplicate normalized token sequences
   merge, metadata first-seen ordered, priority length = greatest Unicode
   scalar count among merged variants) into a token trie.
2. Discover every terminal occurrence in the text — nested and crossing
   overlaps included.
3. Sort occurrences by: token count desc, priority scalar length desc, start
   asc, end asc, normalized key asc, first-seen ordinal asc.
4. Greedily accept an occurrence only if none of its tokens is already
   occupied (bitset), then return accepted occurrences in source order.

This is the historical longest-first rule applied globally — NOT
maximum-total-coverage interval scheduling (pinned by the
`greedy-not-maximum-coverage` fixture). Equal-priority crossings resolve
leftmost-first. Repeated non-overlapping occurrences are all accepted;
downstream hint/alignment dedupe may still collapse repeated surface forms
after selection (first source-order occurrence supplies the surface term and
context).

The `legacy` policy is the historical left-to-right commit-at-each-start scan,
kept for rollback during the bake period.

## Policy lockstep

`GLOSSARY_MATCHER_POLICY` (JS: `src-ui/app/glossary-token-matcher.js`, Rust:
`src-tauri/src/ai/glossary_matcher.rs`) must be flipped in the same commit as
the fixture's `defaultPolicy` field — each runtime's tests assert its default
against the fixture, so frontend and backend can never straddle algorithms.

## Row boundaries

Batch operations match each row independently; a term can never match across
a row boundary (`glossary_source_texts` in the batch preparation request;
per-row matching in `find_matched_glossary_terms_in_texts`). Redistribution of
batch-derived entries to rows uses token-sequence containment
(`glossaryTermMatchesTokenSequence`), never `String.includes`.

## Benchmarks

`scripts/bench-glossary-matcher.mjs` (Node) and
`bench_glossary_matcher_policies` (`cargo test --release --lib
ai::glossary_matcher -- --ignored --nocapture`). Recorded results live in
`plans/glossary-global-longest-matching-plan.md`'s implementation log.
