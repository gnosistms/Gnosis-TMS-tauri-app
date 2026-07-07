# Auto re-derive pivot glossaries when translate rewrites the glossary source language

## Status (2026-07-07)

Implemented on `feat/batch-derive-glossaries` alongside the batching work.
Unit tests green (1635), knip clean. Manual pivot-glossary verification
pending, together with the batching work's own re-verification (see
`batch-derive-glossaries-plan.md`).

## Problem

A chapter can link a glossary whose source language differs from the
chapter's translate source (e.g. an es→vi glossary in an en-source chapter).
Derived ("pivot") glossary entries for en→vi are aligned through the row's
real es field text. Regenerating es (clear then Translate All → es) is
classified `"none"` by `glossaryUsageKindForPair` — the derivation machinery
never runs for that direction — so a row's cached en→vi derived entry keeps
pointing at the old pivot text and highlights do not recover until the user
manually re-runs Derive Glossaries.

## Design

Two hooks, both in the AI-translate family, both funnelling into one shared
helper:

- `refreshDerivedGlossariesForChangedGlossarySourceField`
  (`editor-derived-glossary-batch-flow.js`): given rows whose glossary
  source-language field was just rewritten, re-derives each row's PREVIOUSLY
  cached language pair via `ensureBatchDerivedGlossaries`
  (`useCurrentGlossarySourceText`, no pivot generation). Rows that never had
  a ready derived entry are skipped — this never derives spontaneously.
- Single-row translate (`editor-ai-translate-flow.js`): refresh runs AFTER
  the completion badge, so the extra AI round-trip never delays the
  user-visible finish. Callers can pass `suppressDerivedGlossaryRefresh`.
- Translate All (`editor-ai-translate-all-flow.js`): collects matching rows
  from BOTH the multi-row batch path and the single-row path (which passes
  the suppress option) and re-derives them in ONE combined call in a
  `finally` around the batch loop — one derivation call per run, never one
  per row. Singleton-only runs resolve a provider lazily for that call.
- The pair gate (`changedLanguageMatchesGlossarySource`) and the classifier
  share one `glossarySourceLanguageCodeForChapter` resolver exported from
  `editor-derived-glossary-flow.js`.

## Decision: no eager invalidation

An earlier iteration also deleted stale entries at the clear-translations and
history-restore call sites (and inside the refresh helper). Removed after a
multi-agent review established:

- Every content consumer of `derivedGlossariesByRowId` (highlight rendering,
  AI translate/assistant hints, batch derivation reuse) already checks
  staleness at read time by comparing the entry's stored pivot text against
  the row's current field — a stale entry can never render or be used, so
  eager deletion was cache hygiene, not correctness.
- Per-row removals re-normalize the whole entry map and rewrite the whole
  persistent cache per row — the same quadratic churn class as the
  2026-07-06 OOM incident (`95b4fa09`).
- Staleness is a text comparison, so an entry whose pivot text reverts to
  what it was derived from becomes valid again for free; deletion destroys
  that cache hit. (Covered by a test: refreshing an unchanged pivot returns
  `"cached"` with zero AI calls.)

Consequence for future flows that write the pivot field (bulk replace,
conflict merges, imports): missing this hook can never show wrong highlights;
worst case is highlights disappear for affected rows until a Derive
Glossaries run or a translate re-derives them.
