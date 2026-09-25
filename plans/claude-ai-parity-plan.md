# Claude parity: every AI function that works with OpenAI works with Claude

Goal (from the user): Claude support exists so Claude can do everything GPT
can do in Gnosis TMS. Stacked on `claude/ai-assistant-prompt-caching`
(PR #342), which added `AiPromptRequest::prompt_blocks`.

## Inventory (2026-09-25)

Every AI command the frontend invokes, and whether Claude can run it today:

| Feature | Command | Claude today |
|---|---|---|
| Translate (one row) | `run_ai_translation` | Yes (`providers::run_prompt`) |
| Translate All | `run_ai_translation_batch` | Yes |
| Review (one row) | `run_ai_review` | Yes |
| Review All | `run_ai_review_batch` | Yes |
| AI Assistant | `run_ai_assistant_turn` | Yes, with prompt caching (PR #342) |
| Derived glossary, one row / batch | `prepare_editor_ai_translated_glossary(_batch)` | Yes |
| Model list, key check, model probe | `list_ai_provider_models`, `validate_ai_provider_secret`, `probe_ai_provider_model` | Yes |
| Team-shared API keys | `*_team_ai_*` | Yes (provider-generic) |
| **Add-translation alignment** | `preflight_/apply_aligned_translation_to_gtms_chapter` | **No: blocked** |
| **Out-of-credits error message** | frontend `ai-provider-error.js`, `ai-settings-flow.js` | **No: OpenAI only** |

Found by sweeping for direct provider calls outside `ai/providers/`, for
`AiProviderId::OpenAi` checks, and for `"openai"` checks in `src-ui`.
The remaining `"openai"` branches in `ai-action-config.js` (model-family
defaults) and `screens/ai-key.js` (key instructions) are per-provider
equivalents that Claude already has.

### Why alignment was OpenAI-only

Added with the feature (`a243ea12`, 2026-05-05). Alignment needs output that
matches caller-supplied JSON schemas (`AiPromptOutputFormat::JsonSchema`), and
at the time the Claude provider rejected those. PR #341 added Claude
structured outputs (`output_config.format`) and `claude_compatible_schema`,
which strips the keywords Claude rejects. All five alignment schemas
(compatibility, section summary, section matches, row alignment, target
splits) use only `minimum`, `maximum` and `minLength` beyond plain types. Those
are stripped, and the alignment validators already enforce them after
parsing. What is left is two hard-coded checks and a direct OpenAI call.

## Steps

### 1. Alignment runs on Claude (backend)

- `aligned_translation.rs:308`: allow OpenAI and Claude. Other providers get
  "Add translation currently requires OpenAI or Claude." The model-missing
  message stops naming OpenAI.
- `providers/mod.rs`: add `run_prompt_with_usage(request, key) ->
  (AiPromptResponse, Option<Value>)`, dispatching to OpenAI (usage serialized)
  and Claude (the usage its stream already returns). Other providers return
  `None` usage.
- `run_json_prompt` (`aligned_translation.rs:2599`): call it instead of
  `providers::openai::run_prompt_with_usage`. `log_alignment_request` takes
  `Option<&Value>` usage, so the log records Claude's cache fields too.
- Provider-neutral error text: "OpenAI returned invalid … JSON" and the four
  "GPT returned/aligned/did not return …" validation messages become "The AI
  model …".
- The request-result cache key already includes provider and model, so an
  OpenAI result is never reused for a Claude job.
- Effort: alignment uses `JsonSchema`, which Claude runs at `medium`
  (`effort_for`). It is the only `JsonSchema` caller. Keep `medium` unless the
  step 5 comparison shows `low` holds accuracy.

### 2. Alignment runs on Claude (frontend)

- `project-add-translation-flow.js`: replace the `providerId !== "openai"`
  check with an OpenAI-or-Claude check and the matching message; rename
  `ensureOpenAiReady` to `ensureAlignmentProviderReady`.

### 3. Out-of-credits message for Claude

Anthropic returns HTTP 400 `invalid_request_error`, "Your credit balance is too
low to access the Anthropic API…". The app shows it as a raw "Claude returned
an error: …". OpenAI's equivalent gets a clear message, a billing link and a
billing modal.

- `ai-provider-config.js`: add `billingUrl` for OpenAI (existing URL) and
  Claude (`https://platform.claude.com/settings/billing`).
- `ai-provider-error.js`: `isOpenAiNoCreditsError` becomes
  `isAiProviderNoCreditsError(providerId, message)`, which also recognises
  Claude's "credit balance is too low". `formatAiProviderActionError` and
  `classifyAiProviderOperationalError` ("quota_exhausted") use it with the
  provider's name and billing URL.
- `ai-settings-flow.js`: `explainAiModelProbeError` and the model-error modal
  use the provider's billing URL and label ("CLAUDE BILLING").

### 4. Claude caching for section matching (optional, after parity)

Section matching sends the full source-summary list, identical for every
target section, before the changing target section. On Claude that prefix can
be cached with `prompt_blocks`. OpenAI does not reuse it (PR #342 findings).
Do this only if step 5 shows the prefix is above Claude's minimum and the
stage is a meaningful share of cost.

### 5. Verification

- Unit tests: provider check (OpenAI and Claude pass, Gemini rejected);
  `run_prompt_with_usage` dispatch; every alignment schema converted by
  `claude_compatible_schema` keeps its required fields and contains no
  unsupported keywords; frontend credit-error detection per provider.
- Live (ignored) tests, provider chosen by `GNOSIS_ALIGNMENT_EVAL_PROVIDER`:
  - the existing synthetic row-alignment, split and boundary tests
    (`efficiency_tests.rs`), on Claude;
  - one call per remaining schema (compatibility, summary, section matching);
  - real data: HNHH chapter 3's English column split into sentences and
    aligned back to its Spanish rows, where the correct row for each sentence
    is known. Compare Claude Opus 5.5 with `gpt-6-astra` on accuracy, time and
    cost.
  Estimated spend: under $3.

## Commits

1. Alignment provider dispatch and checks (steps 1–2).
2. Claude out-of-credits message (step 3).
3. Live tests and results (step 5), recorded here.
4. Section-matching cache, only if step 4 is justified.
