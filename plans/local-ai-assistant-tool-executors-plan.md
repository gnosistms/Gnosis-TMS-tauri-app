# Local AI Assistant Tool Executor Implementation Plan

## summary
Build the local read-only tool executor layer used by the AI Assistant tool-calling flow. This layer defines provider-neutral tools, validates model-supplied arguments, reads context from the assistant request/editor state snapshot, and returns compact JSON results. It must not mutate rows, files, repo state, sync state, or assistant history directly.

## goals
- Provide one local executor registry shared by OpenAI, Claude, Gemini, and DeepSeek adapters.
- Keep all tools read-only and bounded.
- Make tool results compact enough to avoid replacing prompt bloat with tool-result bloat.
- Return predictable JSON result shapes for model use and Details rendering.
- Keep implementation independent from provider wire formats.

## non-goals
- Do not implement provider API request/response adapters here.
- Do not add write-capable tools.
- Do not auto-apply translations, row edits, glossary edits, repo commits, or sync actions.
- Do not expose arbitrary filesystem, network, shell, or Tauri command access.
- Do not let the model choose unrestricted row ranges or unlimited searches.

## current data sources
Executors should operate on a bounded assistant context snapshot assembled before the provider call. The snapshot should include only data the assistant is allowed to query:
- active row identity and text fields
- current source and target language metadata
- other language texts already available for the row
- current row ordering metadata needed for windows/search
- glossary hint source data available to the existing assistant flow
- document digest cache, if present
- concordance source data available to the existing assistant flow

If a tool needs data that is not present in the snapshot, prefer returning a structured unavailable result in the first implementation rather than reaching into unrelated global state.

## module boundaries
Add a Rust-side tool executor module near the AI assistant code:
- `src-tauri/src/ai/assistant_tools.rs`

Export:
- provider-neutral tool definition structs
- `assistant_tool_definitions()`
- `execute_assistant_tool(context, call)`
- individual executor functions
- result-size limiting helpers

Keep provider-specific schema conversion in provider adapter modules, not in this executor module.

## core types
Define provider-neutral structs:
- `AiAssistantToolDefinition`
  - `name`
  - `description`
  - `parameters_schema`
  - `result_limit`
- `AiAssistantToolCall`
  - `id`
  - `name`
  - `arguments_json`
- `AiAssistantToolResult`
  - `id`
  - `name`
  - `ok`
  - `result_json`
  - `error`
  - `truncated`

Define a local execution context:
- `AiAssistantToolContext`
  - active row data
  - ordered row window source, if available
  - language list and labels
  - glossary source data
  - document digest data
  - concordance data
  - limits

## validation rules
For every tool call:
- reject unknown tool names
- parse arguments as JSON object
- reject non-object arguments
- reject unknown argument fields when practical
- apply defaults only when explicitly defined
- clamp numeric limits to configured maximums
- normalize language codes and row IDs
- return structured errors instead of panicking

## result limit rules
Apply strict limits to every result:
- maximum rows returned by any row tool
- maximum search hits
- maximum glossary hints
- maximum concordance hits
- maximum characters per text field
- maximum total serialized result characters

If a result is truncated:
- set `truncated: true`
- include a concise `truncationReason`
- keep JSON valid and useful

## tool: get_active_row
Purpose:
Return the current editor row context.

Arguments:
- none

Result:
- row ID
- source language code and label
- target language code and label
- source text
- current target text
- text style, if available
- row status flags only if already safe to expose

Limits:
- truncate long source and target text fields

## tool: get_language_texts_for_row
Purpose:
Return available language texts for one row.

Arguments:
- `rowId`, optional; default active row
- `languageCodes`, optional array

Result:
- row ID
- language entries with code, label, role, and text

Validation:
- only allow active row in first implementation unless the snapshot includes other rows
- reject or return unavailable for unknown row IDs
- clamp language list length

## tool: get_row_window
Purpose:
Return nearby rows around the active row.

Arguments:
- `before`, optional integer, default `3`
- `after`, optional integer, default `3`
- `languageCodes`, optional array

Result:
- active row ID
- rows before/current/after in document order
- each row includes row ID, relative position, and requested language text snippets

Limits:
- clamp `before` and `after`, for example max `10` each
- truncate each text field

## tool: get_glossary_hints
Purpose:
Return glossary hints relevant to text.

Arguments:
- `text`, optional; default active row source text
- `sourceLanguageCode`, optional; default active source language
- `targetLanguageCode`, optional; default active target language
- `limit`, optional integer

Result:
- source term
- target variants
- notes, if present

Limits:
- clamp hint count
- truncate notes and variant lists

Implementation note:
In the first pass, reuse the glossary hints already assembled for the assistant request. Later, this can query the broader glossary index.

## tool: get_document_digest
Purpose:
Return the cached document digest or summary, if available.

Arguments:
- none initially

Result:
- digest text
- revision key
- created timestamp, if available
- `available: false` when no digest exists

Limits:
- truncate digest text to a configured max

## tool: search_rows
Purpose:
Search available row text snippets in the current chapter snapshot.

Arguments:
- `query`, required string
- `languageCode`, optional
- `limit`, optional integer

Result:
- hits with row ID, language code, label, snippet, and relative position if known

Validation:
- reject blank query
- require minimum query length, for example `2`
- clamp limit

Implementation note:
Use simple normalized substring search first. Do not add dependencies or complex indexing in this phase.

## tool: get_concordance_hits
Purpose:
Return concordance hits for a text or the active row text.

Arguments:
- `text`, optional; default active source text
- `languageCode`, optional; default active source language
- `limit`, optional integer

Result:
- compact concordance hit entries already available in the assistant context

Implementation note:
In the first pass, reuse `request.concordance_hits`. Later, this can query a broader concordance service.

## details and observability
Record tool activity for Details:
- tool name
- normalized arguments
- whether execution succeeded
- whether result was truncated
- compact result summary
- error message, if any

Do not store huge raw tool results in assistant history unless needed for debugging. Prefer compact summaries in UI state.

## safety rules
- All tools are read-only.
- Tools cannot access arbitrary paths, URLs, shell commands, or environment variables.
- Tools cannot call sync, import, export, translation, review, save, or commit operations.
- Tools cannot return secrets, provider API keys, installation tokens, or Git credentials.
- Tool results should be derived only from the current editor context snapshot.

## tests
Add Rust tests for:
- unknown tool returns structured error
- invalid JSON arguments return structured error
- numeric limits are clamped
- long text fields are truncated
- total result size cap is enforced
- `get_active_row` returns expected row data
- `get_language_texts_for_row` filters languages correctly
- `get_row_window` respects ordering and limits
- `get_glossary_hints` returns existing assistant glossary hints
- `get_document_digest` returns unavailable when missing
- `search_rows` finds normalized substring matches
- `get_concordance_hits` respects limit
- no executor mutates context data

## implementation order
1. Add provider-neutral tool definition and result structs.
2. Add `AiAssistantToolContext` and build it from the existing assistant request data.
3. Implement shared validation and truncation helpers.
4. Implement `get_active_row`.
5. Implement `get_language_texts_for_row`.
6. Implement `get_row_window`.
7. Implement `get_glossary_hints`.
8. Implement `get_document_digest`.
9. Implement `search_rows`.
10. Implement `get_concordance_hits`.
11. Add Details-friendly tool activity summaries.
12. Add Rust tests for all tools and safety/error paths.

## completion definition
This work is complete when:
- a provider-neutral registry exposes all initial assistant tools
- each tool can execute against a bounded local context snapshot
- all results are compact, valid JSON, and size-limited
- invalid model tool calls fail safely with structured errors
- no tool can mutate app state
- the executor layer is covered by focused Rust tests
