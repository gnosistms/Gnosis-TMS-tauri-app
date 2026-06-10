# Code Review — Batch 9: AI Integration (9a Core + 9b Providers & Settings)
<!-- vt.idd:local-review:batch-9 -->

**Date**: 2026-06-10
**Status**: Complete. Findings reported; fixes not yet applied.
**Scope**: prompt building, structured-output contracts, provider HTTP clients, and AI
settings/secret-distribution storage. Special focus per strategy: secret leakage in
error paths.
**Files**:

| File | Lines | Reviewed? |
|---|---:|---|
| `ai/mod.rs` | 2,768 | ✅ (≈900 lines logic; remainder is a strong test suite) |
| `ai/types.rs` | 437 | ✅ |
| `ai/providers/mod.rs` | 64 | ✅ |
| `ai/providers/openai.rs` | 969 | ✅ |
| `ai/providers/gemini.rs` | 586 | ✅ |
| `ai/providers/claude.rs` | 268 | ✅ |
| `ai/providers/deepseek.rs` | 267 | ✅ |
| `team_ai.rs` | 667 | ✅ |
| **Total** | **~6,026** | (strategy said ~5,040; files have grown) |

Also traced (not in batch scope, needed for findings): `lib.rs` AI command wrappers,
`src-ui/app/runtime.js` invoke failure reporting, `src-ui/app/telemetry-scrub.js`,
`src-ui/app/editor-ai-assistant-flow.js` malformed-response handling.

---

## Executive Summary

| Severity | Count |
|---|---|
| Critical (C) | 0 |
| Security (S) | 2 |
| Major (M) | 1 |
| Minor (m) | 2 |
| **Total** | **5** |

Prompt construction is careful (tagged sections, history provenance labels, glossary
hint normalization) and very well tested. OpenAI is the flagship provider: strict JSON
schemas, refusal handling, `store: false`, continuation ids. The findings cluster in
exactly the area the strategy flagged — **error paths**: the Gemini key rides in the
URL and `reqwest` errors print URLs (S1); malformed assistant responses embed raw model
output + the full prompt in the command error string, which the frontend reports to
Sentry (S2); and the Claude provider silently truncates at a hardcoded 1,024 output
tokens (M1).

---

## Preliminary per-batch checks

### Standard V sweep — ✅ clean
All AI entry points are `#[tauri::command] async fn` + `spawn_blocking`: nine wrappers
in `lib.rs:186-287` and eleven commands in `team_ai.rs`. No synchronous command does
I/O in this batch.

### Swallowed / non-fatal error pass

| Site | Pattern | Classification |
|---|---|---|
| `providers/mod.rs:22` — `let _ = SHARED_HTTP_CLIENT.set(client)` | discarded race loser | Expected — `OnceLock` init race; the subsequent `get()` handles it. |
| `extract_api_error_message` in all four providers — `serde_json::from_str(...).ok()` | `.ok()` | Expected — non-JSON provider error bodies fall back to fixed messages. |
| `ai/mod.rs:1803` — `let _response_kind = ...` | unused binding | Dead code, not a swallowed error (see observations). |
| `run_ai_assistant_turn` retry on `is_missing_previous_response_error` | retried error | Expected — graceful continuation-id expiry recovery, good pattern. |
| Frontend `runtime.js` reporting of AI command rejections | — | **Defect signal in the other direction** — it reports too much, not too little; see S2. |

No sites need a new telemetry event.

### Secret handling in error paths (strategy focus)
- OpenAI / DeepSeek / Claude: keys travel in headers only; transport errors are
  normalized to fixed strings before the `reqwest::Error` (which can carry the URL) is
  ever formatted. ✅
- Gemini: **key travels in the URL query string** — see S1. ❌
- `team_ai.rs`: wrapped-key ciphertext only crosses the broker boundary; error paths
  return broker messages without echoing payloads; mock-broker tests pin the contract. ✅
- Provider API error bodies are surfaced via `extract_api_error_message` (provider-
  authored `error.message` only, never the raw body). ✅

### Write-access / permission gating — ✅ appropriate
`save_team_ai_settings` and `save_team_ai_provider_secret` gate on
`ensure_installation_allows_team_management`; issuance and member-side cache/keypair
commands gate on `ensure_installation_allows_team_ai_access`; the broker re-enforces
admin rights server-side (test pins the 403 message). `clear_team_ai_provider_cache`
is ungated, which is fine — clearing a local cache is harmless.

---

## Findings

### S1 — Gemini API key in the URL query string; `reqwest` error display includes URLs

**Severity**: Security
**Files**: `ai/providers/gemini.rs:116,273` (`.query(&[("key", api_key)])`)

Gemini requests authenticate via `?key=<API key>` instead of the `x-goog-api-key`
header Google supports. Two consequences:

1. **Key reaches user-visible errors and telemetry.** `reqwest::Error`'s `Display`
   appends ` for url (<full URL>)` — verified in reqwest 0.12.28's `error.rs:268`,
   query string not redacted. The `send()` failures are safely normalized to fixed
   strings, but the **body-read failures** are not:
   `gemini.rs:125,285` format the raw `reqwest::Error` into the returned message
   (`"Could not read the Gemini response: {error}"`). A mid-body network failure
   therefore produces an error containing `...?key=AIza...`, which the frontend
   `invoke()` wrapper reports to Sentry — and `telemetry-scrub.js`'s
   `SECRET_VALUE_PATTERNS` has **no pattern for Google `AIza...` keys**, so the scrub
   does not catch it.
2. Keys in URLs are also exposed to any TLS-terminating middlebox/proxy logging, which
   header credentials avoid in common logging configurations.

| Fix | Description |
|---|---|
| **A ✓** | Send the key via the `x-goog-api-key` header for both `list_models` and `send_generate_content_request`; keep `pageSize`/`pageToken` as query params. |
| B | Also format body-read failures through `normalize_transport_error`-style fixed strings (all four providers format raw `reqwest::Error` on `.text()` failures — only Gemini's contains a secret, but the hygiene applies generally). |
| C | Defense-in-depth: add `AIza[0-9A-Za-z_-]{30,}` to `SECRET_VALUE_PATTERNS` in `telemetry-scrub.js`. |

### S2 — Malformed assistant responses leak document content into Sentry

**Severity**: Security (privacy — violates the telemetry plan's hard constraint)
**Files**: `ai/mod.rs:1022-1031` (`format_ai_assistant_malformed_response_error`),
`src-ui/app/runtime.js:107-115`, `src-ui/app/telemetry.js:197-210`

When the assistant returns unparsable JSON, `run_ai_assistant_turn` rejects with
`AI_ASSISTANT_MALFORMED_RESPONSE_JSON:{"message":...,"rawResponse":<full model
output>,"promptText":<full prompt>}`. The frontend deliberately parses this prefix
(`editor-ai-assistant-flow.js:688`) to show the raw response to the user — that part is
fine, it's the user's own content shown locally.

The problem: `runtime.js`'s `invoke()` wrapper reports **every** rejected command via
`reportCommandFailure`, which sends the error message to Sentry truncated to 200 chars.
The prefix + JSON scaffolding consume ~115 chars, so **up to ~85 chars of raw model
output over the user's document** leave the machine on every malformed response.
`telemetry-scrub.js` redacts secrets and home-dir usernames, not content — its own
header says document/translation content must *never* be transmitted. The consent gate
limits exposure but does not license content exfiltration.

| Fix | Description |
|---|---|
| **A ✓** | In `maybeReportCommandFailure` (`runtime.js`), detect the `AI_ASSISTANT_MALFORMED_RESPONSE_JSON:` prefix and report only the stable constant (e.g. `"AI assistant returned a malformed response"`) — keep the full payload flowing to the caller for local display. |
| B | Longer term: stop encoding content into the error channel — return the malformed case in the `Ok` payload (e.g. `AiAssistantTurnResponse` with a `malformed: true` + raw fields) so the error string is content-free by construction. Larger contract change; A closes the leak now. |

### M1 — Claude provider hard-caps output at 1,024 tokens and ignores truncation

**Severity**: Major
**File**: `ai/providers/claude.rs:148` (`max_tokens: 1024`)

Every Claude request — translation, review, assistant turn — is sent with
`max_tokens: 1024`, and the response parser ignores `stop_reason`. A translation of a
long row (especially CJK/Vietnamese targets where tokens-per-character run high), a
meaning-review of long sections, or an assistant JSON turn that exceeds 1,024 output
tokens is **silently truncated**:

- Plain-text translation: the user gets half a translation presented as complete —
  data-quality failure with no error.
- JSON formats (`AssistantTurnJson`, `ReviewJson`, …): truncation produces unparsable
  JSON → the malformed-response path → which is also the S2 leak path.

The other providers set no output cap on real prompts (`openai.rs` `max_output_tokens:
None`, `deepseek.rs` `max_tokens: None`); only probes are capped. Claude is the outlier.

| Fix | Description |
|---|---|
| **A ✓** | Raise `max_tokens` to a generous ceiling (the Messages API requires the field; e.g. 8,192 or the model maximum), keeping the probe at 1. |
| B | Parse `stop_reason` and return a distinct "the response was cut off" error when it is `max_tokens`, instead of returning truncated text as success. Do both A and B. |

### m1 — One blanket 45-second timeout for all AI requests

**Severity**: Minor
**File**: `ai/providers/mod.rs:19`

The shared client's 45s total-request timeout applies to every provider call. Long
translations on reasoning-heavy models (the OpenAI shortlist is gpt-5.4+; Gemini
previews) routinely exceed 45s of generation, and the prompts here are large (row
window, history, glossary JSON). The user sees "timed out, try again" on requests that
would have succeeded; there is no streaming to keep the connection productive and no
per-request override. Suggest a higher ceiling for `run_prompt` (e.g. 180–300s via
`RequestBuilder::timeout`) while keeping 45s for `list_models`/probes.

### m2 — Structured output is prompt-contract-only on Gemini, Claude, and DeepSeek

**Severity**: Minor
**Files**: `ai/providers/gemini.rs`, `claude.rs`, `deepseek.rs` (`run_prompt`)

The named JSON formats (`AssistantTurnJson`, `TranslationSectionsJson`, `ReviewJson`,
`GlossaryAlignmentJson`) are enforced as a real schema only on OpenAI. The other three
providers receive the same prompts but rely entirely on "Return only valid JSON" plus
the lenient fence-stripping parser. All three have native enforcement available
(Gemini `generationConfig.responseSchema` / `responseMimeType`, DeepSeek
`response_format: json_object`, Claude tool-use or assistant prefill). Prompt-only
JSON works most of the time, but every miss lands in the malformed-response path (and,
for assistant turns, the S2 reporting path). Worth wiring per-provider enforcement when
these providers get attention; not a correctness bug today because the parser and
malformed-error handling exist.

---

## Observations (not findings)

- **`normalize_review_response` is production dead code** (`openai.rs:547-562`,
  `#[cfg_attr(not(test), allow(dead_code))]`) — kept only for tests. The tests it
  serves actually exercise `extract_suggested_text`; they could call a test-local
  helper and the production attribute could go.
- **`let _response_kind`** (`ai/mod.rs:1803`) — `responseKind` is required in the
  OpenAI schema, deserialized, then ignored. Either use it (e.g. trust it over the
  empty-draft heuristics) or drop it from the schema.
- **Model shortlist version floors are hardcoded** (`gpt-5.4`+; Gemini Flash/Lite only,
  Pro hidden; `gpt-*-pro` hidden). Reasonable product choices, but they will age — a
  new provider naming scheme (like the `gpt-6` test acknowledges) silently changes the
  picker. Tests document intent well.
- **Glossary alignment fans out sequentially** (`prepare_ai_translated_glossary`):
  N/8 batches × up to 45s each, serial, plus an optional pivot translation first. Off
  the IPC thread (fine), but a long chapter with many glossary hits can take minutes
  with no progress events. Candidate for a progress event or parallel batches later.
- `load_ai_provider_secret` returns the raw key to the frontend and
  `save_team_ai_provider_cache` accepts one — consistent with the **F-VIII accepted
  tradeoff**; not flagged (per `src-tauri/AGENTS.md`, do not harden these paths with
  keychain integration).
- The assistant prompt embeds git author names/logins from row history into the
  provider request (`authorName=`, `authorLogin=` metadata lines). That is user content
  going to a third-party AI provider the user explicitly configured — acceptable, but
  worth remembering if a "minimal data to providers" mode is ever requested.
- Parity note: the four providers share noticeable boilerplate (error envelopes,
  normalize/transport/probe helpers are 90% identical). A shared helper module would
  shrink ~300 lines and make S1-class divergences (one provider authenticating
  differently) more visible.

---

## Resolution status

| Finding | Status | Notes |
|---|---|---|
| S1 | Open | Gemini key → `x-goog-api-key` header; optionally scrub pattern + fixed-string body-read errors |
| S2 | Open | Strip content from the reported message for `AI_ASSISTANT_MALFORMED_RESPONSE_JSON:` rejections |
| M1 | Open | Raise Claude `max_tokens`; surface `stop_reason: max_tokens` as an explicit error |
| m1 | Open | Longer per-request timeout for `run_prompt` |
| m2 | Open | Native structured-output enforcement on Gemini/DeepSeek/Claude |

---

*Manual review following the Rust Review Strategy, Batch 9 (both sessions in one
pass). The S1 URL-display claim was verified against reqwest 0.12.28's vendored
`error.rs`; the S2 reporting path was traced end-to-end through `runtime.js` →
`telemetry.js` → `telemetry-scrub.js` (no content scrubbing, 200-char cap).*
