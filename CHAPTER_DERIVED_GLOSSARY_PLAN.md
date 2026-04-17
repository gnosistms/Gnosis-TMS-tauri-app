# Chapter Derived Glossary Plan (Cancelled)

## Status

Cancelled. We will not implement this plan.

## Cancellation Note

The core problem is trust.

We can generate a derived glossary, but we cannot know whether we can trust it for a given translation context without running the derivation prompt for that specific translation and checking whether the derived terms differ from what is already stored.

That means the derivation step still has to be repeated at translation time in order to validate the cached result. Because of that, a derived glossary does not actually save the work it was meant to save. It adds complexity and bookkeeping, but it does not remove the need to re-derive the glossary terms when doing automated translation.

For that reason, this plan is cancelled.

## Goal

Reuse derived glossary entries across rows within a chapter while keeping the cache local to the current app installation.

This cache must:

- stay out of Git
- stay unshared between users
- preserve collisions where two different glossary-source terms map to the same derived source term
- still let the translation flow pick the best target-language variants for the active row

## Relation To The Existing Plan

This plan refines the cache scope described in `GLOSSARY_SOURCE_TRANSLATION_PLAN.md`.

The older plan assumed the derived glossary should stay row-local to avoid cross-row conflicts.
This plan changes that:

- preparation results should be reusable across the whole chapter
- conflict handling should be explicit instead of avoided by row scoping

The important change is:

- cache scope becomes chapter-local
- hint resolution remains row-sensitive

## Confirmed Product Rules

- The derived glossary cache is local-only.
  - It must not be written into project files.
  - It must not be pushed to Git.
  - It may be in memory only, or later persisted in app-local storage outside the repo.
- The cache is chapter-specific.
- The cache is tied to:
  - chapter id
  - translation source language
  - glossary source language
  - target language
  - glossary revision
- Derived entries should be reusable across rows in the same chapter.
- Distinct senses must not be flattened just because they share the same derived `sourceTerm`.
- We should not interleave target variant lists from different senses as the primary strategy.

## Core Design Decision

Do not treat the chapter-derived glossary as one flat matcher keyed only by derived `sourceTerm`.

Instead, build one chapter-local cache with two layers:

1. a shared sense layer
   - one entry per distinct derived sense
2. a row occurrence layer
   - which senses were actually observed in which rows

This allows reuse across rows without losing the distinction between:

- different glossary-source terms
- different target variant orderings
- different translator notes

## Why A Flat Chapter Matcher Would Be Wrong

Today the frontend glossary matcher merges entries that share the same normalized match tokens.
That is acceptable for the real glossary, but it is too aggressive for a chapter-derived glossary.

If two rows produce:

- derived source term `be` from glossary source term `ser`
- derived source term `be` from glossary source term `estar`

then a flat chapter matcher would collapse them into one candidate and combine:

- target variants
- notes
- provenance

That would blur distinct senses and weaken the ordering of target variants.

So the chapter-wide cache must preserve sense identity past the point where rows are merged together.

## Sense Identity

Each reusable derived sense should have a stable key.

Minimum viable sense key:

- `normalized(derived source term) + "::" + normalized(glossary source term)`

Preferred future sense key:

- original glossary term id, if we expose it through the preparation pipeline

The minimum viable key is enough to avoid the main collision problem.

## Proposed State Shape

Extend the editor with one chapter-local derived glossary cache, for example:

- `derivedGlossaryChapterCache`
  - `cacheKey`
  - `chapterId`
  - `translationSourceLanguageCode`
  - `glossarySourceLanguageCode`
  - `targetLanguageCode`
  - `glossaryRevisionKey`
  - `rowsById`
  - `sensesByKey`
  - `sourceIndex`

### `rowsById`

Keyed by row id.

Each row entry contains:

- `status`
- `error`
- `requestKey`
- `translationSourceText`
- `glossarySourceText`
- `glossarySourceTextOrigin`
- `senseKeys`

This says which shared senses were derived from that row.

### `sensesByKey`

Keyed by sense key.

Each sense contains:

- `senseKey`
- `sourceTerm`
- `glossarySourceTerm`
- `targetVariants`
- `notes`
- `occurrences`

Each occurrence contains:

- `rowId`
- `translationSourceText`
- optional source context metadata if we add it later

### `sourceIndex`

Keyed by normalized derived `sourceTerm`.

Each value is a list of `senseKey`s.

This lets us reuse already-known senses across rows without scanning the whole cache.

## Preparation Strategy

The chapter-wide cache does not need to be built with one giant model call.

The safest first version is:

1. keep the existing per-row preparation API
2. store each prepared row result into the chapter cache
3. merge shared senses into `sensesByKey`
4. reuse them from other rows later

This gives chapter-wide reuse while keeping the current backend preparation flow intact.

Possible later enhancement:

- background-prewarm remaining rows in the chapter after load

But the cache model should not depend on doing all rows in one request.

## Lookup Strategy For The Active Row

When translating one row, resolve derived glossary hints in this order:

### 1. Use senses observed directly in the current row

If `rowsById[rowId]` already has matching `senseKeys`, prefer those first.

This is the highest-confidence case.

### 2. Reuse chapter-wide senses for the same derived source term

If the current row has no direct prepared result yet, look up:

- normalized source term
- candidate `senseKeys` from `sourceIndex`

This is the chapter-wide reuse path.

### 3. Rank multiple senses instead of merging them blindly

If more than one sense shares the same derived source term:

- do not interleave their `targetVariants`
- do not flatten them into one candidate

Instead, rank them.

Initial ranking rules:

1. senses observed in the current row
2. senses observed in nearby rows
3. senses observed more often in the chapter
4. fallback to preserving multiple hints in ranked order

## AI Hint Model Changes

The current AI hint shape only carries:

- `sourceTerm`
- `targetVariants`
- `notes`

That is not enough for a chapter-wide collision-safe model because two senses may share the same `sourceTerm`.

So the runtime hint model should be extended with:

- `glossarySourceTerm`
  - or an equivalent `senseKey`

Recommended shape:

- `sourceTerm`
- `glossarySourceTerm`
- `targetVariants`
- `notes`

This allows the prompt to preserve sense separation instead of showing two indistinguishable hints with the same `sourceTerm`.

## Prompting Rule For Collisions

If multiple hints share the same `sourceTerm`, the prompt should state that:

- multiple candidate senses may exist
- hints are ordered best-first
- `glossarySourceTerm` explains which original glossary sense each candidate came from
- later candidates should only be used when the higher-ranked sense does not fit the row context

This is much safer than merging target variant lists from multiple senses.

## Matching And Highlighting Rule

The shared chapter cache should not be turned into one global derived matcher that merges by token string alone.

Instead:

- keep shared senses in the chapter cache
- build a row-specific matcher view at lookup time
- include only the senses selected for that row

This keeps the UI and translation hints aligned with the active row instead of collapsing everything chapter-wide.

## Cache Invalidation Rules

Invalidate or rebuild the chapter-derived cache when any of these change:

- chapter id
- translation source language
- glossary source language
- target language
- glossary revision key

Invalidate or rebuild one row entry when any of these change:

- row text in the translation source language
- row text in the glossary source language used for preparation
- row deletion / row id removal

When one row is invalidated:

- remove its `senseKeys` from `rowsById[rowId]`
- keep shared senses only if they are still referenced by some other row

## Implementation Steps

### 1. Introduce chapter-level cache state

Add a new editor state shape for:

- `rowsById`
- `sensesByKey`
- `sourceIndex`

Keep it local-only and do not persist it into repo-backed data.

### 2. Preserve sense identity through the pipeline

When row preparation returns entries, store them as separate senses keyed by:

- derived `sourceTerm`
- glossary `glossarySourceTerm`

Do not merge only on derived `sourceTerm`.

### 3. Aggregate per-row results into the shared cache

When a row finishes preparation:

- write or update `rowsById[rowId]`
- merge shared senses into `sensesByKey`
- update `sourceIndex`

### 4. Build row-specific matcher views from the chapter cache

At highlight time and hint-build time:

- resolve the best senses for the active row
- build a temporary matcher view from those senses only

### 5. Extend the AI hint schema and prompt

Add `glossarySourceTerm` or equivalent provenance so repeated `sourceTerm`s remain distinguishable.

### 6. Add reuse fallback for untranslated rows

If a row has no direct prepared result yet:

- try chapter-wide sense reuse first
- only prepare the row immediately if reuse is insufficient

### 7. Add tests for collisions

Add tests covering:

- two glossary-source terms mapping to the same derived source term
- reuse across rows when there is only one known sense
- ranked multi-sense fallback when there are collisions
- no interleaving of variant lists across distinct senses
- prompt output that preserves provenance for duplicate `sourceTerm`s

## Recommended First Delivery

The first safe delivery should do this:

1. keep backend preparation row-based
2. aggregate results into a chapter-local shared cache
3. reuse only exact sense matches across rows
4. extend the hint schema with `glossarySourceTerm`
5. avoid list interleaving

That gets the reuse benefit without forcing an aggressive chapter-wide merge strategy too early.
