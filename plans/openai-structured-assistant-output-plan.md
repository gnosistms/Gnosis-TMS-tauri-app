# OpenAI Structured Assistant Output Plan

## Summary
For now, Gnosis TMS supports OpenAI as the production AI provider. Claude, DeepSeek, and Gemini remain planned providers, but we should not constrain the OpenAI implementation to a lowest-common-denominator API while OpenAI is the only provider actively used.

Implement OpenAI-specific Structured Outputs for AI Assistant turns. The goal is to make assistant responses more reliable by having OpenAI return schema-constrained JSON for `assistantText` and `draftTranslationText`, instead of relying only on prompt instructions and best-effort JSON parsing.

Non-OpenAI providers should keep the current prompt-plus-JSON parsing behavior until we have real users who need them.

## Current Flow
- `run_ai_assistant_turn()` in `src-tauri/src/ai/mod.rs` builds a full prompt.
- It calls `providers::run_prompt()` with an `AiPromptRequest`.
- `src-tauri/src/ai/providers/openai.rs` sends the prompt to OpenAI through the Responses API.
- OpenAI currently receives `text.format.type = "text"`.
- The app then tries to parse JSON from the returned text using `parse_assistant_structured_response()`.

This works, but it leaves response shape enforcement to the prompt. That is why the model can still repeat the draft inside `assistantText`, omit a field, or return commentary in a shape we need to repair after the fact.

## Target Behavior
- OpenAI assistant turns use OpenAI Structured Outputs.
- OpenAI returns schema-constrained JSON with:
  - `responseKind`
  - `assistantText`
  - `draftTranslationText`
- The app still stores and renders the same internal assistant transcript items.
- Other providers still use the current text response path.
- Translation, review, glossary preparation, and glossary alignment remain unchanged in the first implementation.

## Provider Policy
- OpenAI: supported now; use provider-specific features when they improve reliability.
- DeepSeek: planned later; OpenAI-compatible only for Chat Completions, not the OpenAI Responses API shape we use now. Later support can use `response_format: {"type":"json_object"}` with validation/retry, or strict beta tool calling if appropriate.
- Claude: planned later; implement with Anthropic-native structured/tool patterns when needed.
- Gemini: planned later; implement with Gemini-native structured output when needed.

## Implementation Plan

### 1. Add Output Format Metadata
Update `src-tauri/src/ai/types.rs`.

Add an internal enum:

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AiPromptOutputFormat {
    Text,
    AssistantTurnJson,
}
```

Add it to `AiPromptRequest`:

```rust
pub struct AiPromptRequest {
    pub provider_id: AiProviderId,
    pub model_id: String,
    pub prompt: String,
    pub previous_response_id: Option<String>,
    pub output_format: AiPromptOutputFormat,
}
```

Use `Text` everywhere by default except AI Assistant turns.

### 2. Keep Non-OpenAI Providers on Text
Update:
- `src-tauri/src/ai/providers/claude.rs`
- `src-tauri/src/ai/providers/deepseek.rs`
- `src-tauri/src/ai/providers/gemini.rs`

These providers should ignore `output_format` for now and keep their current behavior. Do not add provider-specific structured output for them in this pass.

### 3. Add OpenAI Structured Output Request Format
Update `src-tauri/src/ai/providers/openai.rs`.

The current `OpenAiTextFormat` only supports:

```json
{ "type": "text" }
```

Replace it with a serializable enum or struct shape that can emit either:

```json
{ "type": "text" }
```

or:

```json
{
  "type": "json_schema",
  "name": "assistant_turn_response",
  "strict": true,
  "schema": {
    "type": "object",
    "additionalProperties": false,
    "required": ["responseKind", "assistantText", "draftTranslationText"],
    "properties": {
      "responseKind": {
        "type": "string",
        "enum": ["translation_draft", "commentary", "mixed", "error"]
      },
      "assistantText": {
        "type": "string"
      },
      "draftTranslationText": {
        "anyOf": [
          { "type": "string" },
          { "type": "null" }
        ]
      }
    }
  }
}
```

Use the schema only when:

```rust
request.output_format == AiPromptOutputFormat::AssistantTurnJson
```

### 4. Use Structured Output for Assistant Turns
Update `run_ai_assistant_turn()` in `src-tauri/src/ai/mod.rs`.

When building the `AiPromptRequest`, set:

```rust
output_format: AiPromptOutputFormat::AssistantTurnJson
```

Do this for both:
- the first request with `previous_response_id`
- the fallback retry without `previous_response_id`

All other AI calls should use:

```rust
output_format: AiPromptOutputFormat::Text
```

### 5. Keep Prompt Compatible With Future Providers
Keep the current assistant prompt mostly intact for now, including the instruction to return JSON. This allows Claude, DeepSeek, and Gemini to keep working later through the generic parser.

However, refine the prompt copy to reduce duplication:
- Tell the model that if a draft translation is present, `draftTranslationText` must contain only the draft.
- Tell the model not to repeat the full draft in `assistantText`.
- Keep a concise explanation in `assistantText`.

### 6. Parse the Same Internal Shape
Update `AiAssistantStructuredResponse` in `src-tauri/src/ai/mod.rs`:

```rust
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiAssistantStructuredResponse {
    #[serde(default)]
    response_kind: Option<AiAssistantResponseKind>,
    assistant_text: String,
    #[serde(default)]
    draft_translation_text: Option<String>,
}
```

Add:

```rust
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
enum AiAssistantResponseKind {
    TranslationDraft,
    Commentary,
    Mixed,
    Error,
}
```

The UI does not need to use `responseKind` immediately. It exists for logging, future diagnostics, and future UI decisions.

### 7. Preserve Fallback Parsing
Keep `parse_assistant_structured_response()` tolerant:
- Parse direct JSON first.
- Keep code-fence stripping and object-slice fallback for non-OpenAI providers and older responses.
- Continue requiring `draftTranslationText` for `TranslateRefinement`.

This keeps the change low risk and avoids breaking future providers before they are actively supported.

### 8. Handle OpenAI Refusal and Empty Output
In `src-tauri/src/ai/providers/openai.rs`, inspect the Responses API output enough to detect refusal-style content if present.

If OpenAI refuses, return a clear error:

```text
OpenAI refused this request.
```

If OpenAI returns no usable output text, keep the existing clear empty-response error.

### 9. Tests
Add Rust tests for:
- OpenAI assistant request uses `json_schema` format.
- OpenAI translation/review/probe requests still use `text` format.
- The assistant schema includes `responseKind`, `assistantText`, and `draftTranslationText`.
- The schema uses `strict: true`.
- `parse_assistant_structured_response()` accepts the new structured response.
- `parse_assistant_structured_response()` still accepts the old response shape without `responseKind`.
- `TranslateRefinement` still rejects responses without a non-empty `draftTranslationText`.
- Missing `previous_response_id` fallback keeps `AssistantTurnJson` output format.

Add UI tests only if behavior changes. The expected UI behavior should remain:
- assistant text displays once
- draft translation displays in the draft block
- Apply button appears when `draftTranslationText` is present

### 10. Verification
Run:

```bash
cargo test ai::tests
cargo test ai::providers::openai::tests
node --test --loader ./src-ui/test/raw-loader.mjs src-ui/app/ai-review-and-settings.test.js src-ui/screens/translate-sidebar.test.js
npm run build
```

If the change touches shared AI request types enough to affect other providers, also run:

```bash
cargo test
npm test
```

## Deferred Work
- Do not implement DeepSeek structured output yet.
- Do not implement Claude structured output yet.
- Do not implement Gemini structured output yet.
- Do not add local assistant tools in this pass.
- Do not change Translate All, Review, glossary derivation, or glossary alignment output formats yet.

## Risks
- OpenAI schema support may vary by model. If a selected OpenAI model rejects `json_schema`, we should return a clear error and guide the user to pick a current supported OpenAI model.
- Some schema features may need adjustment to match OpenAI's supported JSON Schema subset.
- The prompt may still influence whether the model puts a full draft in `assistantText`; Structured Outputs enforces shape, not semantic quality. The schema plus prompt should substantially reduce failures, but tests should still cover cleanup behavior.

