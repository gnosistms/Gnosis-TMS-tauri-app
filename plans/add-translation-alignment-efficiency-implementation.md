# Add translation alignment efficiency implementation

Follow-up to add-translation-alignment-efficiency-audit.md. Preserve existing
source corridors, mismatch consent, exact text coverage, safe apply,
and the app's saved credential configuration. The approved local test key is
only for opt-in tests using synthetic fixtures.

## Work

1. Require complete section classifications and invalidate old job signatures.
2. Serialize only model-relevant unit/summary fields, keeping text, IDs and line
   boundaries. Compact prompt JSON; preserve internal metadata locally.
3. Restore budgeted split batches (up to 50 targets), with bounded concurrent
   batches, individual validation/checkpoints, and isolated retries for invalid
   or omitted items. Transport failures must not fan out into extra paid calls.
4. Move whole-job checkpoints to stage boundaries; retain per-response durable
   caches. Record request stage/model, bytes, duration, cache status and available
   provider token usage without text, prompts, keys, or provider error bodies.
5. Add deterministic regressions for classification completeness, batch budgets,
   validation/recovery, cache reuse and concurrency. Add opt-in synthetic live
   evaluation; run focused and full relevant checks.

Compatibility/row-call fusion and sparse long-document candidate selection are
evaluation-dependent follow-ups, not changes to ship without evidence. Keep the
current two-call short path and full source visibility in this implementation.

## Current behavior

The subsequent user instruction removes all punctuation/capitalization repair and
mid-sentence review behavior. See [the final no-editing implementation and current
validation](alignment-no-editing-and-review-plan.md). It supersedes the historical
split-response contract and split-stage measurements below. Batching and the
row-alignment input optimizations remain in place.

## Earlier efficiency validation

Implemented the five work items. The full job now checkpoints at phase boundaries;
individual validated responses remain durable. Split batches use up to 50 targets,
24,000 input bytes including instructions/schema, and an estimated 16,000 output
bytes. These byte guards are not exact token limits. An oversized indivisible
paragraph is isolated rather than truncated. At most four alignment provider
requests run concurrently across jobs. Other stages retain their existing order.

Each split target has a checkpoint keyed by the canonical single-target prompt,
schema, model and version. This deliberately makes validated independent results
reusable when failed groups are repartitioned. Invalid/omitted/duplicate items
are retried in smaller groups down to one target; provider/transport errors do
not trigger request fan-out. Final validation still blocks unsafe application.
The v5 job signature prevents previously accepted incomplete classifications
from bypassing the new validation through an old ready-to-apply job.

Request diagnostics go to the existing rotating `aligned-translation-apply.log`
under checkpoint `ai-request`. Fields include stage/model, job source/target counts,
prompt bytes, elapsed milliseconds, cache hit, result status, and optional provider
input/output/cached/reasoning token counts. No document contents, prompt strings,
API keys, or raw provider error bodies are logged. Missing usage remains null.
Usage fields follow the [OpenAI Responses reference](https://developers.openai.com/api/reference/typescript/resources/responses/methods/create).

### Deterministic checks

- Focused alignment suite: **32 passed**, two paid live tests ignored by default.
  Covers all original safe-split/corridor/cache/apply tests plus complete section
  classification, compact text-preserving prompts, one-request 20-target splits,
  per-item recovery, cache-only reruns, failed-item persistence, request limits,
  transport errors, oversize isolation, and global concurrency across jobs.
- Full Rust library suite: **672 passed**; three pre-existing ignored tests and
  the then-one new live test skipped. The later second live test and progress
  emission were verified with the focused suite and strict Clippy.
- Frontend application/screen suite: **2,125 passed**. Workflow suite: **23 passed**.
  Initial sandbox runs blocked loopback listeners in four Rust tests and four
  workflow tests; reruns with local network access passed.
- Strict Clippy across all targets and scoped Rust formatting passed.
- `git diff --check` passed. Unused-export audit reports only the existing three
  scripts, five browser-test imports, and `ensureEditorFootnoteEntry`; no alignment
  findings. No unrelated application files were changed.

### Live evaluation (synthetic content only)

Used the approved testing key from ignored `.env.local` with `gpt-5.4`. The app's
saved provider credentials/model settings were not modified. Two opt-in Rust
tests passed; the final run made five provider requests:

| Evaluation | Result |
| --- | --- |
| 40 English source units / 20 Spanish targets, compact alignment | All expected source-ID mappings correct; 1,847 input / 255 output tokens |
| Same alignment with the previous full-metadata payload | Identical mappings; 5,677 input / 255 output tokens |
| Split all 20 Spanish targets together | One request, no fallback; 1,859 input / 1,435 output tokens; about 11 seconds |
| Three Vietnamese paragraph splits together | All expected boundaries/content preserved; 498 input / 207 output tokens |
| Two Vietnamese subtitle continuations together | Both preserved without adding punctuation or capitalization; 418 input / 136 output tokens |

The row-alignment input reduction was **67.5%** on this fixture. This is an observed
token reduction, not a claim of the same saving on arbitrary documents or total
workflow latency. Compatibility remains a separate request. Tests also retain
structural coverage checks; live synthetic fixtures do not prove all-language
semantic accuracy.

The first network attempt was blocked by the sandbox and was rerun with network
access. The first live comparison then found that its fixture assertion was too
strict about inter-sentence whitespace ownership: all mappings/content/coverage
were correct, but some fragments included leading spaces. The assertion now
compares source-assigned text ignoring only outer whitespace, still requiring
exact original coverage and no unintended text adjustment. Production validation
was not loosened. The subsequent five-request evaluation passed.

To rerun explicitly, provide `OPENAI_API_KEY` securely in the environment and set
`GNOSIS_ALIGNMENT_EVAL_MODEL`, then run:

```sh
cargo test --manifest-path src-tauri/Cargo.toml --lib live_alignment_ -- --ignored --nocapture --test-threads=1
```

### Scope / remaining experiments

No release, installed-app rebuild, commits, or user chapter writes were performed.
The 50-unit row-alignment threshold and source overlap/corridor rules are retained.
Combined compatibility/alignment calls and sparse long-document matching remain
separate accuracy experiments. This implementation restores the lost split
batching and improves tokens/recovery without making those architectural changes.
