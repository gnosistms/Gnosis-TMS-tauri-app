# Derived-glossary language rule (one predicate for "can this chapter derive?")

## Status (2026-09-06)

Implemented (uncommitted): shared rule in `editor-derived-glossary-flow.js`
(`resolveDerivedGlossaryPivotLanguage`, `derivedGlossaryUsageKindForPair`),
adopted by `resolveEditorDerivedGlossaryUsage`, Translate All's pair
classifier, and the Derive Glossaries modal config. Unit tests: 2110 pass,
knip clean for the touched files.

Motivated by a field run on the Gnosis VN `subtitles` project: an
EN-source / VI-target chapter linked to the ES→VI glossary. Translate All
classified every en→vi batch as `"derived"`, generated Spanish pivot text for
all 982 rows (one AI call per batch plus one git commit per row), wrote it
into an `es` column that does not exist in the chapter's language list, and
aligned glossary terms against that synthetic text.

## Problem

Two code paths decide whether a derived (pivot) glossary applies, and they
disagree about the pivot column:

| Path | Rule today |
|---|---|
| Derive Glossaries modal — `resolveEditorDeriveGlossariesConfig` (`editor-derive-glossaries-flow.js`) | `canDerive` requires the glossary source **and** target codes to be chapter languages, ≥3 languages, and ≥1 derivable language. |
| Translate All + single-row translate — `resolveEditorDerivedGlossaryUsage` and `glossaryUsageKindForPair` (`editor-derived-glossary-flow.js`, `editor-ai-translate-all-flow.js`) | Only checks target base code == glossary target and source base code != glossary source. If the glossary source language is not a chapter language it falls back to the bare code (`glossarySourceLanguage?.code ?? glossarySourceLanguageCode`) and derivation proceeds against a column that does not exist. |

The design (`plans/auto-rederive-pivot-glossary-plan.md`) is explicit that
derived entries "are aligned through the row's real es field text": the pivot
is a real language column of the chapter, and pivot-text generation fills
gaps in that column. Without the column there is nothing to derive through.

## Rule

For chapter `C` with linked glossary `G` (source `Gs`, target `Gt`), and a
translate pair `S → T` (chapter language objects):

1. `G` resolves both `Gs` and `Gt`, and has at least one active term.
2. `base(T) == Gt` — the pair targets the glossary's target language.
3. If `base(S) == Gs` the usage is **direct** (no derivation).
4. Otherwise the usage is **derived** only if `C.languages` contains a
   language whose base code is `Gs` — the **pivot column**. If no such
   column exists the usage is **none**.

Everything else about derivation (cached entries, staleness, pivot-text
generation) is unchanged; it simply never starts when rule 4 fails.

## Changes

1. `src-ui/app/editor-derived-glossary-flow.js`
   - Add `resolveDerivedGlossaryPivotLanguage(chapterState)` → the chapter
     language matching `glossarySourceLanguageCodeForChapter`, or `null`.
   - Add `derivedGlossaryUsageKindForPair(chapterState, sourceLanguage, targetLanguage)`
     → `"none" | "direct" | "derived"`, implementing rules 1–4 (term check
     excluded — kept where it is today so the pair classifier stays cheap).
   - `resolveEditorDerivedGlossaryUsage`: return `{ kind: "none" }` when the
     pivot language is missing; use the pivot language's `code` as the
     column code (no bare-code fallback).
2. `src-ui/app/editor-ai-translate-all-flow.js`
   - `glossaryUsageKindForPair` delegates to `derivedGlossaryUsageKindForPair`.
3. `src-ui/app/editor-derive-glossaries-flow.js`
   - `resolveEditorDeriveGlossariesConfig` reads the pivot language through
     `resolveDerivedGlossaryPivotLanguage` so the modal and the translate
     paths share the same resolution (behaviour unchanged).
4. Tests
   - New `src-ui/app/editor-derived-glossary-flow.test.js`: usage resolver
     returns `"none"` without a pivot column, `"derived"` with one (including
     a suffixed column such as `es-x-2`), `"direct"` when the source is the
     glossary source.
   - Extend the existing `glossaryUsageKindForPair` test in
     `editor-ai-translate-all-flow.test.js` with the missing-pivot case.
   - Translate All end-to-end: an en→vi chapter with an es→vi glossary and no
     `es` column makes one translation call and zero pivot-generation calls.

## Follow-ups (implemented 2026-09-06)

- **Inert-glossary notice.** `derivedGlossaryUnavailableReason` (in
  `derived-glossary-rule.js`, the pure module the rule moved to so screens
  can import it) yields a sentence only for the rule-4 failure — right target
  language, no pivot column. The Translate All modal shows it under the
  affected language checkbox. The Derive Glossaries toolbar button already
  hid itself through `canDerive`.
- **Grouped pivot saves.** `generatePivotTextBatches`
  (`editor-derived-glossary-batch-flow.js`) persists a chunk's generated
  pivot texts through `persistEditorRowsBatch` — one git commit per chunk —
  falling back to per-row `persistEditorRowOnBlur` when the batch persist is
  not wired. The per-row commits (one per second, ~260 in the field run) were
  the slowest part of a derived-glossary Translate All. Translate All already
  wired the batch persist; the Derive Glossaries modal now does too.
- QA lists have no derivation, so no parity change.
