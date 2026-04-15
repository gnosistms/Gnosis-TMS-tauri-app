# Glossary Source Translation Plan

## Goal

Allow the editor to reuse a glossary whose source language does not match the current translation source language, as long as the glossary target language matches the current target language.

This should work by deriving a temporary, row-local glossary in the translation source language and then feeding that derived glossary into the existing AI translation flow.

## Term Definitions

- `translation source language`
  - the language we want to translate from in the current editor row
- `glossary source language`
  - the source language of the linked glossary
- `target language`
  - the translation target language and the glossary target language

## Confirmed Product Rules

- The app must gracefully handle the case where no glossary is selected.
  - translation should still work
  - no glossary preparation step should run
  - no glossary-derived highlights should appear
- This feature is only relevant when:
  - the linked glossary exists
  - the glossary `target language` matches the current translation `target language`
  - the glossary `source language` does not match the current `translation source language`
- The derived glossary is:
  - row-local
  - in-memory only
  - not persisted to disk
  - allowed to differ between rows
- When the user clicks a translate action:
  - if the glossary source does not match the translation source, the app should prepare the derived glossary first when needed
  - if a valid cached derived glossary already exists for that row, reuse it
  - once the derived glossary is ready, run the normal translation flow
- The derived glossary terms should be underlined in the `translation source language` text so the user can hover and inspect the mapping quality.
- The “prepare glossary” step and the final “translate” step should be two separate app-level API calls.

## Core Design Decision

Do not translate the whole glossary source side into the translation source language ahead of time.

Instead:

1. derive only the glossary entries that appear relevant to the current row
2. derive them from the actual row text
3. keep them temporary and row-local
4. use them through the existing `glossaryHints` translation mechanism

This avoids polluting the real glossary with guessed source-language variants that may not match real usage in the current row.

## High-Level Flow

### 1. Decide Whether Source Translation Is Needed

If there is no linked glossary:

- skip all glossary-related preparation
- skip all glossary-derived highlighting
- run translation without glossary hints

If there is a linked glossary, then continue with the decision below.

If all of the following are true:

- the editor has a linked glossary
- the glossary `target language` matches the current `target language`
- the glossary `source language` differs from the current `translation source language`

then glossary source translation is needed.

Otherwise:

- if glossary source equals translation source, use the existing direct glossary flow
- if target languages do not match, do not use glossary help for this translation

### 2. Prepare Pivot Text In The Glossary Source Language

To detect which glossary entries matter for the current row, we need row text in the `glossary source language`.

Use:

- the existing row text in the `glossary source language`, if it is present and current enough for reuse
- otherwise, generate it from the current `translation source language` text with AI

This pivot text is also in-memory only for the preparation flow.

### 3. Match Glossary Terms In The Pivot Text

Run the existing glossary matcher against the pivot text in the `glossary source language`.

This yields the subset of glossary entries that appear relevant to the current row.

### 4. Map Those Matches Back To The Translation Source Language

For each matched glossary occurrence, determine which exact word or phrase in the original `translation source language` text corresponds to it.

This produces a row-local derived glossary entry:

- `sourceTerm`
  - exact substring from the `translation source language` text
- `targetVariants`
  - copied from the original glossary entry
- `notes`
  - copied from the original glossary entry
- `glossarySourceTerm`
  - the matched term from the `glossary source language`, retained for hover/debug visibility

### 5. Build A Row-Local Derived Glossary

Store the derived glossary for the row in memory, together with a matcher model for the `translation source language`.

This matcher is used only for:

- underlining the derived terms in the `translation source language`
- building `glossaryHints` for the final translation request

### 6. Run The Normal Translation Flow

Once the derived glossary is ready, run translation from the `translation source language` to the `target language` exactly as today, except the `glossaryHints` come from the derived glossary instead of the original glossary.

## Why The Cache Should Be Row-Local

The same glossary source term may map to different terms in the translation source language across different rows because of:

- context
- idiom
- tense
- paraphrase
- wording differences

So the derived glossary should not be chapter-global or glossary-global.

It should be cached per row to avoid having to solve conflicts between unrelated rows.

## Proposed State Shape

Extend `state.editorChapter` with a row-local derived glossary cache, for example:

- `derivedGlossariesByRowId`
  - keyed by row id
  - value contains:
    - `status`
    - `error`
    - `requestKey`
    - `translationSourceLanguageCode`
    - `glossarySourceLanguageCode`
    - `targetLanguageCode`
    - `translationSourceText`
    - `glossarySourceText`
    - `glossaryRevisionKey`
    - `entries`
    - `matcherModel`

Each derived entry should contain:

- `sourceTerm`
- `targetVariants`
- `notes`
- `glossarySourceTerm`

This state must not be persisted.

## Cache Validity Rules

Reuse the cached derived glossary for a row only when all of the following still match:

- row id
- `translation source language`
- `glossary source language`
- `target language`
- current `translation source language` text
- current `glossary source language` text used for preparation
- glossary revision / glossary content signature

If any of those change, rebuild the derived glossary for that row.

## API Shape

### App-Level API Call A: Prepare Derived Glossary

Add a dedicated prepare step, for example:

- `prepare_editor_ai_translated_glossary`

Inputs:

- row text in the `translation source language`
- optional existing row text in the `glossary source language`
- current glossary metadata and relevant terms
- language labels / codes

Outputs:

- derived glossary entries
- pivot text used for preparation
- any matcher-ready structure needed for UI highlights

Important:

- this is one app-level preparation call
- internally, it may use more than one model call if needed
- the UI should treat it as one distinct phase before final translation

### App-Level API Call B: Run Translation

Reuse the existing translation call:

- `run_ai_translation`

Inputs:

- current translation request
- derived `glossaryHints`

This keeps the final translation step aligned with the current implementation.

## Transport Reuse

When one translate action triggers several sequential AI calls, the backend should reuse a persistent transport connection where possible instead of creating a brand-new HTTP client/connection for each step.

This matters in the chained flow:

- `translation source language` -> `glossary source language` pivot translation
- glossary term back-mapping into the `translation source language`
- final `translation source language` -> `target language` translation

Implementation guidance:

- prefer one long-lived provider client per provider configuration instead of building a fresh client for each request
- rely on transport reuse such as keep-alive / pooled connections / HTTP/2 where supported
- do not rely on provider-specific conversational session state carrying across calls
- keep each logical step explicit and deterministic even if the transport is reused underneath

Important:

- the app-level flow should still be modeled as separate preparation and translation steps
- connection reuse is a performance optimization and transport policy, not a change to the product behavior
- if consecutive steps use different providers, different hosts, or incompatible client settings, fall back gracefully to separate connections

## Batching Strategy For Back-Mapping

Do not force one API call per matched glossary term.

But also do not force one giant prompt containing every matched term in a large row.

Recommended compromise:

- gather matched glossary terms from the pivot text
- align them back to the translation source text in small batches
- size those batches conservatively for smaller models

Why:

- one call per term creates too much latency
- one huge prompt increases drift risk and prompt brittleness
- small batches give a better quality / latency tradeoff

The alignment prompt should allow:

- exact source-language substring
- or `null` when no confident mapping exists

Uncertain matches should be skipped rather than guessed.

## Highlighting And Hover UX

Once the derived glossary is ready, underline the matched terms in the `translation source language` text just as glossary terms are underlined today in the direct glossary-source flow.

Hover cards for these derived highlights should show:

- the derived `translation source language` term
- `targetVariants`
- `notes`
- the originating `glossary source language` term

Showing the originating glossary source term is important for judging whether the derivation worked.

## Translation Button Behavior

When the user clicks a translate action:

### Case 1. Direct Glossary Match

If glossary `source language` equals `translation source language`:

- skip the derived-glossary preparation flow
- build direct hints from the existing glossary as today
- translate

### Case 2. Derived Glossary Needed

If glossary `source language` differs from `translation source language`:

- check for a valid cached derived glossary for the row
- if valid, use it
- if missing or stale, run the prepare step first
- once ready, run the final translation step

This should present to the user as:

1. prepare glossary
2. translate

## Failure Behavior

If preparation fails:

- do not silently fall back to a direct glossary flow that does not apply
- surface a clear error for the prepare step
- do not run the final translation step with bad or missing derived hints unless the product explicitly decides to allow a no-glossary fallback

Recommended initial behavior:

- fail visibly
- let the user retry

## Implementation Shape In The Current Codebase

### Frontend

Likely touch points:

- `src-ui/app/editor-ai-translate-flow.js`
  - add the “prepare derived glossary if needed” phase before `run_ai_translation`
- `src-ui/app/state.js`
  - add row-local derived glossary cache state
- `src-ui/app/editor-ai-translate-state.js`
  - potentially add preparation status/error state if we want the UI to distinguish preparation from translation
- `src-ui/app/editor-glossary-highlighting.js`
  - add helpers to build matcher models and tooltip payloads for the derived row-local glossary
- `src-ui/app/editor-glossary-flow.js`
  - apply row-local derived highlights to the translation source language field

### Backend

Likely touch points:

- new preparation command in Tauri
  - derive pivot text when needed
  - match glossary-source terms
  - align matched terms back to the translation source language
- existing translation path in `src-tauri/src/ai/mod.rs`
  - unchanged except it receives derived `glossaryHints`

## Staged Implementation Plan

### Stage 1. State And Data Model

- add row-local in-memory derived glossary state
- define the entry shape
- define cache invalidation rules

Deliverable:

- stable frontend state model for derived glossaries

### Stage 2. Preparation Command

- add the app-level preparation command
- support:
  - reuse of existing glossary-source row text when available
  - pivot translation when not available
  - glossary term matching in the glossary source language
  - back-mapping into the translation source language

Deliverable:

- one row can produce a derived glossary result in memory

### Stage 3. Translation Flow Integration

- update translate-button flow to:
  - decide whether preparation is needed
  - reuse or rebuild derived glossaries
  - pass derived hints into the existing translation request

Deliverable:

- translation uses derived glossary hints when needed

### Stage 4. Highlighting And Hover Validation

- build row-local matcher models for derived glossaries
- underline derived terms in the translation source language
- show hover cards with provenance

Deliverable:

- user can inspect the quality of the derived glossary mapping

### Stage 5. Tests

Add tests for:

- no-op path when glossary source equals translation source
- no-op path when glossary target does not equal translation target
- cache reuse when all inputs are unchanged
- cache invalidation when:
  - translation source text changes
  - glossary source text changes
  - glossary revision changes
  - source/target language selection changes
- translation flow waits for prepare step before final translation
- derived highlights appear in the translation source language
- hover payload includes originating glossary source term

Deliverable:

- confidence that derivation, caching, and highlighting work together

## Recommended Starting Point

Start with:

1. state shape for derived row-local glossaries
2. preparation command that returns derived entries
3. basic integration into the translate-button flow

After that:

4. add source-language underlines and hover provenance

Reason:

- the translation path should work before we polish the inspection UX
- once the state and preparation outputs are stable, the highlight layer becomes straightforward
