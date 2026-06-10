# Batch 9 Review Fixes — AI Integration

Resolves the five findings from `reviews/2026-06-10-batch-9-review.md` (S1, S2, M1,
m1, m2). Branch: `fix/batch-9-review-findings`, stacked on `fix/batch-8-review-findings`
(PR #114) because the review docs build on that branch's strategy-table state. One
focused commit per finding.

## S1 — Gemini key out of the URL

- `ai/providers/gemini.rs`: authenticate with the `x-goog-api-key` header instead of
  `?key=...` in both `list_models` and `send_generate_content_request`. With the key
  out of the URL, reqwest's URL-bearing error display no longer matters here.
- `src-ui/app/telemetry-scrub.js`: defense-in-depth — add a Google `AIza...` key
  pattern to `SECRET_VALUE_PATTERNS` (+ test).

## S2 — Stop reporting document content on malformed assistant responses

- `src-ui/app/runtime.js::maybeReportCommandFailure`: when the rejection starts with
  `AI_ASSISTANT_MALFORMED_RESPONSE_JSON:`, report only the stable constant message.
  The full payload still flows to the caller for local display
  (`editor-ai-assistant-flow.js` is unchanged).
- The deeper contract change (move the malformed payload into the `Ok` channel) is
  deferred; this closes the leak.

## M1 — Claude truncation

- `ai/providers/claude.rs`: raise `max_tokens` from 1,024 to 8,192 for prompts (probe
  stays 1); deserialize `stop_reason` and return an explicit "cut off at the output
  limit" error when it is `max_tokens` instead of returning truncated text as success.
  Extract response normalization into a testable helper + tests.

## m1 — Per-request timeout for prompts

- `ai/providers/mod.rs`: `AI_PROMPT_TIMEOUT` (300s) const.
- Apply `RequestBuilder::timeout(AI_PROMPT_TIMEOUT)` to the four `run_prompt` POST
  paths only; `list_models` and probes keep the client default (45s). Gemini's shared
  `send_generate_content_request` gains a timeout parameter (probe passes the default).

## m2 — Native JSON enforcement where the provider supports it cheaply

- DeepSeek: `response_format: {"type":"json_object"}` for the named JSON output
  formats (prompts already contain the required "json" keyword).
- Gemini: `generationConfig.responseMimeType: "application/json"` for the named JSON
  output formats.
- Claude: intentionally left prompt-contract-only (native enforcement needs tool-use
  or prefill — a larger change); with M1's `stop_reason` check, truncation-induced
  malformed JSON now errors clearly. Documented as partial in the review.
- Request-shape helpers extracted and unit-tested for both providers.

## Verification

- `cargo test` (new tests: Claude stop-reason/truncation, Gemini/DeepSeek request
  shapes), `cargo clippy --lib`, `npm test` (scrub pattern + runtime reporting).
