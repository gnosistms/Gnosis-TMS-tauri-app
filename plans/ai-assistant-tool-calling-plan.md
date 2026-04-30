# Cross-Provider AI Assistant Tool-Calling Plan

## summary
Implement a provider-neutral tool-calling assistant flow for OpenAI, Claude, Gemini, and DeepSeek. The assistant should stop preloading every possible editor context field into each prompt and instead use read-only local tools to request context when needed.

This plan intentionally does not make OpenAI `previous_response_id` the center of the design. To keep behavior consistent across all four providers, each provider should receive a compact prompt, a bounded recent transcript, and the same logical set of read-only editor tools. Provider-specific code should translate that common request into each provider's tool-call wire format.

## goals
- Reduce prompt bloat across all supported AI providers.
- Remove duplicated current-user-message transcript entries.
- Omit empty prompt sections.
- Make editor context available on demand through read-only tools.
- Preserve existing assistant behavior while improving prompt efficiency.
- Keep translate, review, and bulk actions unchanged in the first pass.

## non-goals
- Do not add row editing or write-capable tools.
- Do not make tools available to background sync or file import paths.
- Do not replace all provider APIs with one universal external SDK.
- Do not require OpenAI `previous_response_id` for correctness.
- Do not change translation/review/bulk AI flows in this implementation.

## simple first implementation
Before implementing tool calling, ship a smaller cross-provider prompt cleanup for AI Assistant chat. This should keep the current one-request provider flow while making the prompt clearer and less wasteful.

### first assistant prompt
For the first model call in an assistant thread, send the payload in this order:

1. Source context.
2. Current target, only if non-empty.
3. Glossary, only if matching glossary hints exist.
4. `source_text`, repeated intentionally as the final context item.
5. Instruction or user request.

The source context should be a plain text block, not itemized with labels for each row:

```text
This is the source text in context with three lines before it and one after, provided to help you understand source_text more clearly:
[third previous source-language row]
[second previous source-language row]
[first previous source-language row]
[current source-language row]
[next source-language row]
```

The current row source text is intentionally included both in the context block and again as `source_text`. That redundancy is allowed because it shows where the source sits in context while still making the exact text to translate unambiguous.

The final default instruction should be:

```text
Translate source_text to target_language, taking into account the source_context and glossary information provided above.
```

If the user typed a custom request, use that custom request instead of the default instruction.

### subsequent assistant prompts
For later model calls in the same assistant thread, send:

1. The original first-turn payload once.
2. Complete conversation history after that first prompt.
3. The new user input as the final item.

Do not include the current user input inside the conversation history.

### prompt cleanup rules
- Do not include empty sections.
- Do not emit `Row window context: None.`, `Document digest: None.`, `Document revision key:`, or `Concordance hits: None.`.
- Do not repeat glossary outside the single glossary section.
- Do not repeat the same user message in both `User message` and `Recent transcript`.
- Keep the intentional source redundancy only in the source context block plus the final `source_text` field.
- Keep Details aligned with the actual payload sent.

### simple implementation tests
Add tests for:
- first prompt includes source context as one newline-separated block
- first prompt includes three previous source rows, current source row, and one next source row
- first prompt repeats current source only in context and final `source_text`
- default instruction appears only when no custom request exists
- custom request replaces the default instruction
- empty sections are omitted
- current user input is not duplicated in conversation history
- subsequent prompts include original payload once and new user input last

## provider-neutral assistant design
Every provider should receive the same logical assistant request:
- compact instructions
- current user message
- bounded recent transcript excluding the current user message
- provider-neutral tool definitions
- tool choice set to automatic
- assistant response contract requiring JSON output

The provider adapters should be responsible only for encoding and decoding this request in provider-specific format.

## prompt cleanup
Before adding tools, update the existing prompt construction so all providers benefit:
- remove the current user message from `Recent transcript`
- omit empty sections such as `Document digest: None.`
- omit empty `Document revision key`
- omit `Concordance hits: None.`
- stop displaying duplicated glossary/context blocks in Details
- cap transcript by item count and approximate character count
- keep recent assistant, user, draft, apply-result, and tool-event entries only when useful

## initial read-only tools
Start with a small bounded tool set:
- `get_active_row`
- `get_language_texts_for_row`
- `get_row_window`
- `get_glossary_hints`
- `get_document_digest`
- `search_rows`
- `get_concordance_hits`

Each tool should have:
- name
- description
- strict input schema
- local executor
- compact JSON result
- result-size limits
- clear error shape

## provider adapters
Implement the same logical tool loop for each provider.

### OpenAI
- Use the Responses API tool schema.
- Parse function call output items.
- Send function call outputs back to the model.
- Keep `previous_response_id` as an optional future optimization, not a required path.

### Claude
- Use Messages API tools with `input_schema`.
- Parse `tool_use` blocks.
- Send `tool_result` blocks back to the model.
- Continue sending bounded transcript because Claude has no OpenAI-style `previous_response_id`.

### Gemini
- Use `functionDeclarations`.
- Parse `functionCall` responses.
- Send `functionResponse` results back to the model.
- Keep transcript bounded and provider-neutral.

### DeepSeek
- Use OpenAI-compatible Chat Completions tool calls.
- Parse `tool_calls`.
- Send `tool` messages with matching tool call IDs.
- Keep transcript bounded and provider-neutral.

## assistant tool-call loop
In `run_ai_assistant_turn`:
1. Build the compact provider-neutral assistant request.
2. Send it through the selected provider adapter.
3. If the provider returns final assistant text, parse and return it.
4. If the provider returns tool calls, execute them locally.
5. Send tool outputs back through the same provider adapter.
6. Repeat until a final answer is returned or `MAX_TOOL_ROUNDS` is reached.

Use a low initial `MAX_TOOL_ROUNDS`, for example `3`, to avoid runaway loops.

## fallback behavior
If a provider or model errors on tool calling:
- retry once with tools disabled
- use a compact full-context fallback prompt
- show a Details note: `Tool calling unavailable for this request; used fallback prompt.`

If the model keeps requesting tools after the max round limit:
- stop the loop
- return a clear user-facing error
- include the attempted tool calls in Details for debugging

## Details UI
Update Details so it reflects the actual assistant execution:
- provider and model
- current user message
- compact transcript sent
- available tools
- tool calls made
- summarized tool results
- final model response or fallback note

Avoid showing duplicated context blocks as if they were separate prompts.

## tests
Add tests for:
- current user message is not duplicated in transcript
- empty sections are omitted
- tool schemas are generated from one provider-neutral definition set
- OpenAI adapter parses and sends tool calls
- Claude adapter parses and sends tool calls
- Gemini adapter parses and sends tool calls
- DeepSeek adapter parses and sends tool calls
- tool loop can execute more than one tool call
- tool loop stops at max rounds
- fallback prompt path works when tools fail
- Details displays tool activity accurately
- existing translate/review actions remain unchanged

## rollout
Ship in phases:
1. Simple first implementation: cleaned-up cross-provider assistant prompt with source context, final `source_text`, no empty fields, and no accidental duplication.
2. Provider-neutral tool schema and local executor registry.
3. OpenAI and DeepSeek adapters.
4. Claude adapter.
5. Gemini adapter.
6. Details UI cleanup and fallback polish.

## completion definition
This work is complete when:
- AI Assistant chat can use read-only editor tools on all four providers.
- The prompt no longer preloads unused row, glossary, document, and concordance sections.
- Current user messages are not duplicated in transcript.
- Details shows the compact prompt and tool activity clearly.
- Non-assistant AI flows continue to behave as before.
