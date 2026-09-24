# Claude Opus 5.5 support

## Objective

Make Claude (default model `claude-opus-5-5`) a first-class AI provider for AI
Settings and the Editor's AI Translate, AI Batch Translate, AI Review (single
and batch), and AI Assistant. Claude support was designed in but never tested
against a live model; the provider currently sends a bare prompt with an 8,192
token cap and relies on prompt wording for JSON.

Add-translation alignment stays OpenAI-only (out of scope).

## Findings that drive this plan

- `src-tauri/src/ai/providers/claude.rs` sends no structured-output schema.
  OpenAI gets strict schemas for every JSON format (`openai_text_format`);
  Claude relies on "Return only valid JSON" plus the tolerant parsers in
  `ai/mod.rs`. It also rejects `AiPromptOutputFormat::JsonSchema`.
- `CLAUDE_MAX_OUTPUT_TOKENS = 8192`. Only Claude has a cap (Anthropic requires
  `max_tokens`); OpenAI, Gemini, and DeepSeek send none. On Opus 5.5 thinking
  cannot be disabled and counts against `max_tokens`, so batch output
  truncates.
- No `effort` is sent. Opus 5.5 defaults to `medium`; `low` is the floor
  (thinking is always on). OpenAI `gpt-5.4` also gets no `reasoning.effort`,
  so it runs at its documented default of `none`.
- `stop_reason: "refusal"` (HTTP 200; Opus 5.5 runs cyber, bio and
  reasoning-extraction classifiers) is not handled and surfaces as "empty
  response" or malformed JSON.
- The model picker has no Claude default (`DEFAULT_MODEL_ID_BY_PROVIDER`),
  and `GET /v1/models` returns 20 models per page by default.
- The probe uses `max_tokens: 1`; it only checks HTTP status, so it should
  pass with always-on thinking, but needs confirming.
- AI Assistant sends the full transcript every turn, so Claude does not need
  `previous_response_id` continuity.

## Phase 1 — Claude correctness

1. **Shared schemas.** Move the JSON schemas out of `openai.rs` into
   `ai/providers/schemas.rs` (`schema_for(&AiPromptOutputFormat) ->
   Option<(name, Value)>`). OpenAI wraps them exactly as today (its request
   tests must stay green unchanged).
2. **Claude structured output.** Send
   `output_config.format = {type: "json_schema", schema}` for every non-Text
   format, including `JsonSchema`. Strip keywords Claude rejects (`minimum`,
   `maximum`, `multipleOf`, `minLength`, `maxLength`, …) recursively from the
   copy sent to Claude. The review parsers already validate footnote markers.
   Keep the prompt JSON instructions (other providers need them).
3. **Output budget.** Raise `max_tokens` to 32,000 for prompt runs. Thinking
   plus a 15-row batch fits well inside it; the 300 s non-streaming timeout
   stays. Streaming is future work if the timeout is ever hit.
4. **Effort.** Send `output_config.effort`, chosen per output format
   (translate / review / assistant / glossary alignment) from constants in
   `claude.rs`. Initial value `medium` everywhere, replaced by Phase 2
   results. Omit the `thinking` field (adaptive by default on Opus 5.5).
5. **Capability gating.** Older Claude models reject `effort` (Haiku 4.5,
   Sonnet 4.5) or lack structured outputs. `list_models` already calls the
   Models API; read each model's `capabilities` (`effort`,
   `structured_outputs`) into an in-process cache keyed by model ID. Prompt
   runs send `effort` / `output_config.format` only when supported; on a
   cache miss, fetch `GET /v1/models/{id}` once. Request `limit=1000` on the
   list call.
6. **Refusals.** Treat `stop_reason: "refusal"` as an error with a clear
   message (include `stop_details.category` when present). Opt in to
   server-side fallback (`fallbacks: "default"`, header
   `anthropic-beta: server-side-fallback-2026-07-01`) so a false positive
   retries on Anthropic's recommended fallback model instead of failing. Only
   `text` blocks are read, so `thinking` / `fallback` blocks are ignored.
7. **Probe.** Raise the probe `max_tokens` to 16 for headroom; the result is
   still judged by HTTP status only.
8. **Default model.** `DEFAULT_MODEL_ID_BY_PROVIDER.claude = "claude-opus-5-5"`
   in `src-ui/app/ai-action-config.js`. Existing explicit selections are left
   alone (selections never auto-upgrade).
9. **Tests.** Rust unit tests for Claude request bodies (format present per
   output format, stripped keywords, effort gating, no `thinking` field),
   refusal handling, and response parsing with leading `thinking` blocks.
   Frontend test for the Claude default model.

## Phase 2 — Effort calibration (live, costs money; needs approval)

Build an `#[ignore]`d Rust test harness (`ai/effort_eval.rs`, run with
`cargo test effort_eval -- --ignored --nocapture`) that:

- reads `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` from the environment (never
  from the app's key store);
- builds prompts with the app's real builders (single translate, batch
  translate, single review, batch review, one assistant turn) over a sample
  chapter plus glossary hints;
- runs Claude Opus 5.5 at `low`, `medium`, `high` and, for comparison, OpenAI
  `gpt-5.4` at its current `none` and at `low`;
- records per run: latency, input / output / cached tokens, estimated cost,
  schema validity, truncation or refusal, and the output text;
- writes a side-by-side blind report (effort labels hidden) for the user to
  judge translation quality.

Choose the lowest effort per action that matches the best quality, and write
it into the Phase 1 constants. Decide separately whether OpenAI should send an
explicit `reasoning.effort`.

Inputs needed from the user: API keys exported in the shell, a representative
sample chapter and language pair(s) (the `gnosis-es-vi.tmx` fixture can supply
glossary terms), and approval of the estimated spend before running.

## Phase 3 — Prompt caching (both providers)

Measure first with the Phase 2 harness (cached-token counts), then:

- **Where caching can pay:** the AI Assistant (large stable context
  followed by a growing conversation) and repeated single-row actions on the
  same chapter. Batch prompts share only the instruction preamble across
  batches (glossary hints are deduped per batch), which is likely below the
  Claude 512-token / OpenAI 1,024-token minimums. Confirm its size before
  investing there.
- **Prompt order:** move per-turn variable sections (`updated_source_text`,
  `updated_target_text`) after the stable context in the assistant prompt so
  the cacheable prefix is as long as possible.
- **Claude:** caching matches at content-block boundaries, so the prompt
  needs a stable/variable split. Add an optional cacheable-prefix boundary to
  `AiPromptRequest`, send the prefix as its own text block with
  `cache_control: {type: "ephemeral"}`, and the rest as a second block.
- **OpenAI:** automatic already; add a stable, non-identifying
  `prompt_cache_key` (action + language pair) to improve routing on `gpt-5.4`.
- Verify with `cache_read_input_tokens` (Claude) / `cached_tokens` (OpenAI).

## Commits

One per phase step group: schemas refactor; Claude request changes and tests;
frontend default; effort harness; effort constants; caching.

## Out of scope / noted

- Add-translation alignment remains OpenAI-only.
- With OpenAI continuity (`previous_response_id`), the assistant also resends
  the full transcript in the prompt, so prior turns are sent twice. Worth a
  separate look for cost.

Status: Phase 1 implemented (not yet verified against the live API). Phase 2
harness built (`src-tauri/src/ai/effort_eval.rs`); awaiting API keys, sample
data, and spend approval. Phase 3 not started.

## Progress notes

- Phase 1: shared schemas in `ai/providers/schemas.rs`; Claude sends
  `output_config.format` + `effort`, `max_tokens` 32,000, refusal errors,
  `fallbacks: "default"` on Opus 5 / Fable 5 families, capability gating from
  the Models API (`limit=1000`), probe `max_tokens` 16. Frontend defaults
  Claude to `claude-opus-5-5`, else the newest listed Opus. Tests: Rust AI
  107 passed; frontend unit 2,270 passed.
- Phase 2: `claude::run_prompt_with_effort` and
  `openai::run_prompt_with_reasoning_effort` are test-only hooks; OpenAI's
  request gained an unset `reasoning` field.
