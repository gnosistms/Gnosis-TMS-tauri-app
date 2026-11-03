# Catch identical footnotes attached to different words

Status: implemented on `claude/release-0.8.140`, released in 0.8.143.

## Problem

Footnote redundancy candidates come only from adjacent reversed contexts (the
text just before each marker). Two notes with identical text on unrelated
endings — a synonym, a translation, an inflected form ("dharma"/"dharmas") —
never become candidates, so the AI never sees them. The original design
(`book-redundancy-detection.md`, step 3, route 1) listed "hash identical
bodies, independent of context matches"; the performance rework
(`redundancy-runtime-performance.md`) dropped it together with the slow
all-pairs body comparisons.

## Change

- `candidates::groups` adds a second, linear route: bucket notes by their
  conservatively normalized body (`normalized`: NFC + whitespace only, keeping
  case, punctuation and numbers). Each bucket with two or more notes adds edges
  between consecutive members. No pairwise body comparisons. Notes with no
  alphanumeric text before the marker stay out, since a group needs a quotable
  anchor.
- Candidate groups become the connected components of the context and body
  edges (`CandidateGroup { members, edges }`). Components stay disjoint, so
  `restrict_partition` still forbids AI subgroups that span components, and a
  note matched both ways can join one AI subgroup with both neighbours.
- Batches, the cached-verdict lookup and the per-edge body hints use the
  explicit edge lists instead of `windows(2)` over a chain.
- The AI prompt says groups may come from identical note text, so members can
  be attached to different words, and that different words count as the same
  referent only when they name the same thing. Identical wording alone is still
  insufficient ("Ibid.", "See the previous chapter").
- The inventory digest gains a candidate-route version so cached reviews from
  before this change are recomputed once. Pair verdicts stay cached.

## Cost

One hash-map pass over the notes. AI calls grow by roughly one per 24 notes in
new identical-text buckets, once per book; verdicts are cached by pair.
Boilerplate notes repeated many times ("Ibid.") form large buckets that cost AI
calls on the first run and are rejected as context-dependent.

Measured with `local_corpus_candidate_timings` (Vietnamese, 2026-11-02):
`hnhh` has 453 notes, 5 identical-body sets, 56 candidate groups (largest 7)
and 7 meaning batches; `perfect-matrimony` has 242 notes and no identical
bodies. Grouping stays under 150 ms.

## Tests

- Identical bodies on different words group; distinct bodies do not.
- A note matched by context and by body joins one merged candidate group.
- Notes with empty contexts do not enter body buckets.
- Existing context-chain tests keep passing with edge lists.
- `restrict_partition` still rejects cross-group AI merges.
