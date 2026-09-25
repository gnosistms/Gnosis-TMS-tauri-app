# AI Assistant: drop provider continuation, make turns prompt-cacheable

Replaces the AI Assistant part of Phase 3 in `claude-opus-5-5-support.md`.
Batch translate/review and glossary alignment are out of scope (see end).

## Why

Each AI Assistant turn rebuilds the full prompt: row context, glossary,
digest and the whole transcript (`build_assistant_prompt`,
`src-tauri/src/ai/mod.rs:1474`). Two problems follow.

1. **The OpenAI continuation link cannot work.** Every OpenAI request sends
   `store: false` (`ai/providers/openai.rs:285`), yet the assistant passes the
   previous turn's response ID as `previous_response_id`. OpenAI never stored
   that response, so turn 2 onward most likely fails with "previous response
   not found" and is retried without the link (`ai/mod.rs:2608`): an extra
   round trip per turn. A single-row Translate also seeds the thread's
   continuity with its own response ID (`logEditorAssistantTranslation`,
   `editor-ai-assistant-flow.js:1662`), so the first chat turn after a
   Translate has the same problem. If the link ever succeeded, the transcript
   would be billed twice: once from the chain and once in the prompt.

   Fixing the link instead of removing it would require `store: true` (OpenAI
   keeps project text for up to 30 days; unavailable under zero data
   retention) and a second, delta-only prompt builder used by OpenAI alone.
   It would not be cheaper: OpenAI bills the chained history as input on every
   turn, and cached-prefix discounts apply equally to a stateless prompt. The
   only loss is carried-over reasoning on reasoning models, and the default
   `gpt-5.4` runs at reasoning effort `none`.

2. **No turn can reuse the previous turn's prompt cache.** Parts that change
   every turn (the JSON-shape instruction, which differs between chat and
   refinement; `updated_source_text` / `updated_target_text`; concordance
   hits; the digest on digest turns) sit *before* the conversation history, so
   the repeated part of the prompt is never a stable prefix. Claude
   additionally caches nothing unless the request marks cache breakpoints, and
   the app sends the whole prompt as one text block.

## Target prompt layout

Three parts, in this order. The visible `promptText` stays the parts joined
with `\n\n`, exactly as today, so the debug view does not change.

| Part | Contents | Changes when |
|---|---|---|
| 1. Row context (stable) | Role and behaviour instructions; `<source_context>`; `<languages>`; `<reference_translations>`; `<glossary_info>`; `<source_text>`, `<source_footnote>`, `<source_image_caption>` | Row, glossary, or source text changes |
| 2. History (append-only) | One block per transcript entry (`- role: text`) | Grows by the previous turn's entries |
| 3. This turn (volatile) | Reply-language instruction; JSON-shape instruction for this `kind`; `<target_language_history>` (includes the current target text); `<updated_source_text>` / `<updated_target_text>`; `<document_digest>`; `<concordance_hits>`; the user action | Every turn |

Notes on placement:

- `<target_language_history>` moves to part 3 because applying a draft (the
  main refinement loop) changes the current target text. In part 1 it would
  throw away the cache on exactly the turns that follow an apply.
- `<document_digest>` moves to part 3 because only some turns include it, and
  the first digest turn sends the full chapter text. Including it in part 1
  would make that part differ between digest and non-digest turns.
- `<document_revision_key>` is removed from the prompt. It is an internal hash
  and tells the model nothing. The frontend still uses it to store the digest.
- The transcript is already append-only and never trimmed
  (`buildAssistantTranscriptEntries`, `editor-ai-assistant-flow.js:704`),
  which is what prefix caching needs. Keep it that way. Any future
  windowing must drop entries in whole-turn steps and accept a miss.
- Check that the reordered prompt still answers well, especially that the
  model uses the current target from part 3 rather than drafts in the history.
  Run the steps 5–6 verification before merging.

## Steps

### 1. Stop sending `previous_response_id` (backend and frontend)

- `ai/mod.rs` `run_ai_assistant_turn`: always send `previous_response_id:
  None`; delete the "previous response not found" retry and
  `is_missing_previous_response_error`.
- `editor-ai-assistant-flow.js`: drop `providerContinuation` from
  `buildAssistantTurnRequestPayload`; delete
  `resolveAssistantProviderContinuation` and the three
  `applyEditorAssistantProviderContinuity` call sites (lines ~1378, 1662,
  1721).

Commit: "Stop chaining AI Assistant turns through OpenAI response IDs".

### 2. Remove the dead continuation plumbing

Everything below only existed to feed step 1's link.

- `ai/types.rs`: remove `provider_continuation` from `AiAssistantTurnRequest`,
  `AiAssistantTurnResponse`, and `AiTranslationResponse`; remove
  `AiProviderContinuationMetadata`; remove `previous_response_id` from
  `AiPromptRequest` and `provider_response_id` from `AiPromptResponse`.
  Update every construction site (`ai/mod.rs`, `effort_eval.rs`,
  `providers/*.rs`, `project_import/chapter_editor/aligned_translation.rs`).
- `providers/openai.rs`: drop `previous_response_id` from
  `OpenAiResponsesRequest`; keep `store: false`.
- Frontend: remove `providerContinuation` from `editor-ai-translate-flow.js`
  (six payload sites) and `editor-ai-translate-all-flow.js:637`; remove
  `applyEditorAssistantProviderContinuity` and `providerContinuityByModelKey`
  from `editor-ai-assistant-state.js` and `state.js:713`. Persisted threads
  that still carry the field must load without error. The normalizer should
  just not copy it.
- Tests to update: `openai.rs` (`openai_assistant_prompt_request_uses_strict_json_schema_output_format`
  asserts `/previous_response_id`), `editor-ai-assistant-cache.test.js`
  (~77, ~127), `ai-review-and-settings.test.js` (~884–919). Add one cache test:
  a stored thread containing `providerContinuityByModelKey` loads cleanly
  and does not keep the field.

Commit: "Remove unused AI provider continuation metadata".

### 3. Reorder the assistant prompt into three parts

- Split `build_assistant_prompt` into a builder that returns
  `AssistantPromptParts { context: String, history: Vec<String>, turn:
  String }` in the order above. `build_assistant_prompt` becomes the joined
  string. Drop `<document_revision_key>`.
- Rust tests: part order; stable part identical across two turns that differ
  only in user message, concordance hits, target text and digest; history is
  a strict prefix-extension between consecutive turns; joined text equals the
  prompt sent to non-Claude providers.

This step alone lets OpenAI (≥1,024-token prefixes), DeepSeek and Gemini
reuse the repeated part automatically.

Commit: "Order AI Assistant prompt from stable context to per-turn input".

### 4. Claude cache breakpoints for assistant turns

- `ai/types.rs`: add `prompt_blocks: Option<Vec<AiPromptBlock>>` to
  `AiPromptRequest`, where `AiPromptBlock { text: String, cache: bool }`.
  `prompt` stays the joined text; providers other than Claude ignore
  `prompt_blocks`. Only the assistant sets it; all other callers pass `None`.
- `providers/claude.rs`: when `prompt_blocks` is set, send the user message
  `content` as an array of text blocks instead of one string. Put the `\n\n`
  separators inside the block texts so the model sees the same text as
  today. Set `cache_control: {"type": "ephemeral"}` (5-minute TTL) on:
  - the last block of part 1 (row context), and
  - the last history block, when the history is non-empty.
  That is 2 of the 4 allowed breakpoints. Each turn adds ~2–5 history blocks,
  well inside the 20-block lookback, so turn N's history breakpoint finds
  turn N-1's entry.
- Parts shorter than the model's minimum (512 tokens on Opus 5, 1,024 on
  Sonnet 5, 4,096 on Haiku 4.5) silently do not cache and cost nothing extra.
- Use the 5-minute TTL, not 1-hour: every read refreshes it, and gaps between
  turns in one row thread are normally minutes. A 1-hour write costs 2×
  instead of 1.25×.
- `claude.rs` tests: blocks and breakpoint placement; no `cache_control` when
  `prompt_blocks` is `None` (batch paths unchanged); separators preserved.

Cost trade-off: a thread with only one turn pays a 1.25× write on the cached
parts and never reads them back. Each follow-up turn within 5 minutes reads
them at 0.1×. Caching comes out ahead once more than about 28% of first turns
get a follow-up. Refinement threads ("refine in chat") are built for
follow-ups, so caching starts on the first turn. Step 5 measures whether that
holds.

Commit: "Cache AI Assistant row context and history on Claude".

### 5. Record cache usage

- Claude: `execute_prompt` already returns the usage report, but
  `run_prompt` discards it (`claude.rs:374`). OpenAI returns
  `input_tokens_details.cached_tokens`. For assistant turns, `eprintln!` one
  line per call (the backend's existing logging style): provider, model,
  input, cache-read, cache-write / cached tokens. No prompt text.
- Enough to confirm hits in a `npm run tauri:dev` session. Decide separately
  whether it should reach Sentry or a settings-page diagnostic.

Commit: "Log AI Assistant cache usage".

### 6. Live verification (needs API keys and spend approval, ~$0.20)

In `npm run tauri:dev`, on one row, Claude Opus 5.5 then OpenAI `gpt-5.4`:

1. Ask a question, ask a follow-up, apply a refinement draft, ask again.
2. Expected on Claude: turn 1 writes; turn 2 reads part 1 and writes the
   history; after the apply, part 1 and history are still read (the target
   is in part 3); a turn 5+ minutes later writes again.
3. Expected on OpenAI: no "previous response not found" retry; `cached_tokens`
   > 0 once the stable prefix passes 1,024 tokens.
4. Compare the answers before and after the reorder on the same questions
   for obvious regressions (the model ignoring the applied target, answering
   about an older draft).

## Tests

- `cargo test` in `src-tauri` (AI module and providers).
- `npm test`.
- No browser-test changes expected. The assistant UI and stored thread shape
  stay the same apart from the removed field.

## Risks

- **Answer quality after reordering.** The model now sees the history
  before the current target text. Step 6.4 checks this. If quality drops,
  add a one-line note in part 3 that the current target text supersedes
  drafts in the history, rather than moving the target back into part 1.
- **Old persisted threads.** They still carry `providerContinuityByModelKey`.
  The step 2 load test covers them.
- **Claude block split changes the text the model sees.** Guarded by the
  separator test in step 4.

## Out of scope (from the caching audit)

- Glossary alignment resends the full batch text for every 8 matched terms
  (`GLOSSARY_ALIGNMENT_BATCH_SIZE`, `ai/mod.rs:2401`). Raising or removing the
  chunk size is cheaper than caching it. Separate plan.
- Batch Translate/Review preambles (~500–800 tokens, shared only across
  parallel batches that start together): not worth caching.
- OpenAI `prompt_cache_key`: revisit after step 5 shows real hit rates.
