# Stream AI prompt calls (Claude and OpenAI)

## Objective

Non-streaming prompt calls that receive no response bytes for 60 s are cut
off (diagnosed in `claude-opus-5-5-support.md`: both providers, reqwest and
curl alike; streaming the same request ran 131 s). Stream every Claude and
OpenAI prompt call so bytes flow continuously, without changing what the rest
of the app receives. Gemini and DeepSeek are unchanged (no keys to verify
live); probes and model listings stay non-streaming (short).

## Design

- The app still needs the complete answer before parsing, so each call reads
  the whole event stream (`response.text()`), then assembles it. No
  incremental UI.
- `ai/providers/sse.rs`: parse a server-sent-events body into
  `(event, data)` pairs (multi-line `data:`, `:` comments, CRLF).
- **Claude** (`stream: true` on prompt runs): collect content blocks by index
  (`content_block_start` type, `text_delta` text), `stop_reason` /
  `stop_details` and full `usage` from `message_delta`. Assemble the same
  response struct the non-streaming path parses, so refusal, max-token and
  empty-response handling stay in one place. An `error` event (e.g.
  `overloaded_error`) or a stream without `message_stop` is an error. After a
  mid-answer safety decline with server-side fallback, the stream keeps the
  partial text and the fallback model continues it, so joining text blocks in
  order is correct.
- **OpenAI** (`stream: true` added to the Responses payload): the terminal
  `response.completed` / `response.incomplete` event carries the full
  response object, which goes through the existing parser (output items,
  refusals, usage). `response.failed` and `error` events become errors; a
  stream with no terminal event is an error.
- **OpenAI refusal to stream** (e.g. an organization-verification rule for
  some models): a 400 whose message mentions streaming retries once without
  streaming and remembers the model for the rest of the session.
- The 60-second "stopped responding" message stays for any remaining
  non-streaming path.

## Tests

Unit: SSE parsing; Claude assembly (text + thinking + fallback blocks, stop
reason, usage, refusal, error event, truncated stream); OpenAI terminal-event
extraction (completed, failed, error, truncated) and the verification
detector; request bodies carry `stream`. Live (harness, ~$1): the 30-row
Claude `high` batch that previously failed at 61 s, plus a normal pass on
both providers.

Status: implemented and verified live (2026-09-25).

## Result

- Claude and OpenAI prompt calls stream; probes and model listings do not.
  Gemini and DeepSeek unchanged.
- Live: the 30-row Claude `high` batch that was cut off at 61 s completed in
  106 s ($0.35); a GPT-6 Astra `high` batch that was cut off at 60 s
  completed in 133 s; gpt-5.4 `none` batch 13 s (was 15 s). All parsed.
- The OpenAI stream-refusal fallback is unit-tested only (no account here
  refuses streaming).
- With streaming in place, Claude translation effort is set to `high`
  (review, assistant, and glossary alignment stay `medium`).
- Tests: Rust AI suite 118 passed (10 new); clippy clean on changed files.

## Review follow-up (2026-09-25)

- Prompt time limit raised to 600 s: reqwest's blocking client only has a
  total timeout (it covers reading the body), and 32K output tokens at high
  effort can exceed 300 s.
- Mid-stream read failures now say "<Provider> stopped responding before its
  response was complete…" (or the timeout message) instead of raw reqwest
  text; send/read error mapping is shared in `providers/mod.rs`.
- OpenAI `status: "incomplete"` (output limit, content filter) is an error,
  matching Claude's `max_tokens` handling, instead of returning partial text.
- OpenAI stream refusals are remembered per (API-key hash, model), not per
  model, so one team's unverified org does not disable streaming for another.
- A failed Claude capability lookup sends a plain request (no effort/schema)
  instead of assuming current-model support; concurrent cache misses share
  one lookup.
- Safety refusals go to Sentry as warnings with an `ai_refusal_category` tag
  and one fingerprint per command.
- Live smoke test after the changes: Claude and gpt-5.4 single + batch calls
  all succeeded.
