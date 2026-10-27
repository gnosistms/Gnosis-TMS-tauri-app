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

- `ai-provider-error.js`: a per-provider table of out-of-credits phrases,
  label and billing URL (OpenAI's existing URL; Claude
  `https://platform.claude.com/settings/billing`). `isOpenAiNoCreditsError`
  becomes `aiProviderNoCreditsInfo` / `isAiProviderNoCreditsError(providerId,
  message)`, which also recognise Claude's "credit balance is too low". `formatAiProviderActionError` and
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

## Results (2026-09-25)

Steps 1–3 and 5 are done. Step 4 was skipped: section matching is 3 of 15 calls per
chapter, and its repeated source-summary list is about 1K tokens, so caching
it would save cents.

### Bug found: Claude received schemas with fields in alphabetical order

`serde_json` sorts object keys, so every structured-output schema reached the
providers with its properties in alphabetical order instead of the order they
were written in. Claude generates structured output field by field in schema
order. Section matching therefore had to state `isMatch` before naming the
`sourceSectionId`, and in 5 of 10 replays of one real prompt Claude ended the
list after a single entry. Sent in written order, the same prompt was complete
10 of 10 times, and 16 of 16 through the app. The same sorting put `sourceIds`
before `targetId` in row alignment, the `reviewed` verdict before `rowId` and
the suggestions in Review All, and `translatedText` after the footnote and
caption in Translate All.

Fix: Claude and OpenAI requests serialize each schema's `properties` in the
order of its `required` list (`schemas::InAuthoredOrder`).

OpenAI was changed after an A/B check on `gpt-6-astra` as the app calls it (no
reasoning parameter; `effort_eval` gained a `default` effort for this), with
2 runs per order of HNHH ch. 3's Review All batches (9 planted errors, 21
clean rows) and Translate All batches:

| Review All | Alphabetical (before) | Written order (after) |
|---|---|---|
| Planted errors caught | 9/9, 9/9 | 9/9, 9/9 |
| Fixed with the original wording | 7/9, 7/9 | 7/9, 7/9 |
| Unneeded edits to clean rows | 8/21, 8/21 | 7/21, 7/21 |
| Failed batches | 0 | 0 |

Translate All: all batches valid; before/after text similarity 0.91, against
0.89 between two runs in the same order, so the change is within normal
variation. Main benefit: the model now writes its suggestions before the
`reviewed` verdict (with the verdict first, a `reviewed: true` answer
discards any suggestion that follows it) and states the row ID first.

Also added:
- Alignment asks once more when a response parses but fails validation
  (for example an incomplete list) before showing "Retry alignment". This
  applies to every provider; request errors are not retried.
- Section-matching and row-alignment prompts state the exact number of
  entries expected.

### Live results

HNHH chapter 3 (es source, en translation pasted as 91 paragraphs, 18 of
them two rows merged), every alignment stage through the app's prompt
builders, schemas and validators:

| | Claude Opus 5.5 (3 runs) | gpt-6-astra (1 run) |
|---|---|---|
| Row alignment correct | 91/91 each run | 91/91 |
| Rows with the correct text after splitting | 109/109 each run | 109/109 |
| Section-match agreement with the true overlap | 11/12 | 11/12 |
| Validation retries needed | 0 | 0 |
| Time | 91–94 s | 137 s |
| Tokens (input / output) | 112K / 8.2K | 66K / 5.4K |
| Cost | ≈ $0.61 | ≈ $0.93 |

Before the field-order fix, 3 of 5 Claude chapter runs failed at section
matching, even with the explicit count and one retry.

Synthetic live tests (`live_alignment_and_split_batch_evaluation`,
`live_alignment_boundary_evaluation`) pass on Claude, 2 of 2 runs each.

Regression check of the field-order change on the other Claude features
(`effort_eval`, HNHH ch. 3 input, Claude `medium`, 1 run): Review All caught
9/9 planted errors (before: 9/9), fixed 5/9 correctly (before: 6/9), edited
5/21 clean rows (before: 4/21); both Translate All batches returned valid
output. The differences are within single-run noise.

Total live spend for this work: ≈ $12.
