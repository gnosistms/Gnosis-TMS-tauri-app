# Add translation alignment efficiency audit

## Scope and plan

Audit the Add translation import/alignment pipeline, specifically the reported
50-row short path, correctness, token use, and runtime. This is distinct from
AI Translate All and the existing untracked ai-batch-alignment-efficiency-audit.md.
Do not change application code or saved chapter data and do not make paid AI calls.

1. Trace backend calls, text-unit construction, frontend progress, and git history.
2. Check alignment/split validation, retries, caching, and provider request settings.
3. Run focused existing tests and deterministic offline probes for call counts
   and prompt overhead; distinguish evidence from unverified live-model behavior.
4. Record prioritized findings, accuracy-preserving improvements, and limitations.

## Result

Audited 2026-09-07 at `48c5728e` (0.8.104). The 50-unit short path is intact.
There **is** a recent performance regression in the subsequent paragraph-split
pass: commit `41f12e8e` (2026-09-06) changed one batched request into one serial
request per target paragraph requiring a split. The stronger validation added
by that commit is useful and must be retained; serial execution is separable
from those correctness improvements.

This establishes a slowdown mechanism, not the exact cause of the reported run:
the actual source/target unit counts, split count, selected model, and request
timings were not supplied or measured. No saved user translations were inspected.

## 1. Drift and current behavior

### Confirmed regression: splitting lost batching

Current `split_targets` (`src-tauri/src/project_import/chapter_editor/aligned_translation.rs:1566`)
loops over every alignment with multiple source IDs and completes its provider
request before starting the next. Its predecessor assembled all such targets
into `split_inputs` and made one `split_target_response` request. The new prompt
also adds sentence-boundary and punctuation/capitalization instructions.

For a fresh compatible job with both sides at most 50 units:

| Input shape | Before September 6 | Current |
| --- | ---: | ---: |
| 20 source / 20 target units, no split required | 2 calls | 2 calls |
| 40 source / 20 target units, 10 targets require splitting | 3 calls | 12 calls |
| 40 source / 20 target units, all 20 targets require splitting | 3 calls | 22 calls |
| 50 source / 50 target units, no split required | 2 calls | 2 calls |

Counts exclude retries, cache hits, extraction and application. They include the
compatibility request. The general short-path count is `2 + split_count`, compared
with `2 + (split_count > 0)` previously. Row count alone does not predict splits:
they are needed when a translated paragraph corresponds to multiple source rows.

### The 50-unit threshold did not shrink

`SECTION_SIZE = 50`, `SECTION_OVERLAP = 25` remain unchanged from the original app
implementation, `a243ea12` (2026-05-05). `is_single_block_unit_counts` at line 1007
requires **both** source and target counts to be at most 50. In this path:

1. `short_text_compatibility` makes one request with both complete texts.
2. `align_rows` makes one request covering the whole target block.
3. Splitting makes the additional calls described above.

The app has therefore always had more than one end-to-end call. The remembered
single call correctly describes the row-alignment stage. The older alignment-lab
single-chunk engine also describes one row-alignment call, followed by splitting.

Source units are nonempty texts from the selected source-language rows
(`source_units_from_rows`, line 673). Target units are nonblank newline-delimited
lines (`parse_target_units`, line 698), not sentences or visual wrapped lines.
A 20-line translation against 51 source rows takes the multi-section path.
Pasted/exported hard line breaks can also make target units exceed visible paragraphs.

For multi-section jobs, let S/T be source/target section counts, R the number of
target sections with selected source context, C conflicting targets, and K split
targets. A fresh completed job uses `S + 2T + R + C + K` calls. All these request
loops currently execute serially. With all sections matched, crossing from
50/50 to 51/51 units increases the base count from 2 to 8 before conflicts/splits.
This threshold behavior predates the September regression.

### The source-corridor change is an improvement worth preserving

The same September commit changed row alignment from one pass per source/target
section pair to one pass per target section with deduplicated combined source
context and neighboring windows (`collect_row_candidates`, line 1334). This
reduces artificial disagreements caused by incomplete source visibility. Existing
82-source/44-target tests exercise that failure mechanism. Reverting the whole
commit to recover speed would undo these improvements and safe split handling.

## 2. Correctness audit

### P2: incomplete section answers are accepted as if they were complete

`find_section_matches` (lines 1206–1219) rejects unknown or duplicate source IDs
but does not require every requested candidate to be returned. Its schema at
line 3074 permits an empty array. This contradicts the current prompt, which
explicitly asks for every source candidate with a match/no-match decision.

Omitted answers therefore become implicit negative matches. `collect_row_candidates`
generates empty source-ID sets without an AI row call for sections with no corridor.
Targets exclusive to such a section can be inserted as unmatched text; overlapping
targets can instead trigger extra conflict requests. The 40% mismatch gate does
not necessarily catch this.

Offline reproduction using the actual validation body and candidate collector:
82 source / 82 target units create three sections each. An empty answer for the
first target section passes validation. If the other two target sections match
all source sections, the unmatched percentage is only 33.3% target / 0% source,
so the warning gate does not fire. Targets 1–25 receive only empty source IDs,
even when the synthetic fixture has exact corresponding source rows.

Require the returned candidate-ID set to equal the requested set, or deliberately
redesign the request and validation as a positive-only sparse protocol. Retry
incomplete classification before treating omitted answers as no-match. This is
an existing correctness gap, not established as a new September regression.

### Protections that are working

- Row alignment requires every target exactly once and rejects unknown source or
  target IDs (`validate_alignments`, line 2723).
- Split validation requires exact original fragments in order, coverage of every
  non-whitespace character and matched source ID, valid word boundaries where
  applicable, and preservation of normalized word content in adjusted text.
  Unsafe splits and lexical rewrites stop application (`validate_split_response`,
  line 1678; `final_checks`, line 1752).
- Unsplit many-source alignments cannot silently duplicate the entire paragraph
  across rows (`build_row_translation_plan`, line 2087).
- Apply reloads and validates under the repository lock, preserves existing target
  content, batches changed row files into one commit, and retains rollback behavior.
- Per-request caches validate cached answers before reuse and retain successful
  work across late failures; invalid answers are not cached. These are new benefits.

These checks establish structural integrity, not semantic translation accuracy.
A wrong but structurally valid source-ID mapping can still pass. Likewise,
word preservation alone does not prove that punctuation/case edits preserve
meaning. Original text and adjustment review flags are retained. There was no
live-model semantic evaluation in this audit.

## 3. Token efficiency

### Remove internal bookkeeping from model inputs

Compatibility (line 1052), summaries (line 1114), row alignment (line 2713), and
conflict resolution (line 1519) serialize full `AlignmentUnit` values. These
include a 64-character `textHash`, durable `rowId` UUID or null, and
`originalLineNumber` alongside the required `id` and `text`. Section matching
likewise sends internal summary content hashes.

Keep hashes and row IDs in local state/cache signatures; do not send them to the
model. Preserve all source/target text and absolute numeric IDs. Keep line-number
or boundary information only where it actually conveys structure. Compact JSON
also avoids repeated indentation in the prompt string.

Illustrative offline input-payload measurements (20 source + 20 target units,
where original line number equals ID):

| Characters per unit | Current pretty JSON | Compact ID/text JSON | Byte reduction |
| --- | ---: | ---: | ---: |
| 50 | 10,092 | 2,815 | 72.1% |
| 200 | 16,092 | 8,815 | 45.2% |
| 800 | 40,092 | 32,815 | 18.2% |

Removing metadata alone saves 6,222 bytes per payload in these fixtures, before
compacting whitespace. Compatibility and alignment both resend this payload.
These are **bytes of synthetic prompt input**, not measured tokens, billing,
or whole-request percentages; schemas, instructions, output, and reasoning are
excluded. UUIDs/hashes have no matching information the model needs.

### Recover split batching without relaxing validation

Every split repeats the same long instruction block and schema. Group independent
targets under a bounded input/output budget, retain explicit target/source IDs,
and run the existing exact-fragment and word-preservation checks for each target.
Retain successful validated results and isolate failed groups/targets for retries.
Do not restore the old permissive split validator.

### Potential second-stage savings, requiring accuracy evaluation

- Combine compatibility and row alignment for short files in one structured
  response. Preserve mismatch consent before applying anything; test partial
  translations, unrelated texts, and both positive and negative gate decisions.
  This removes a whole-text resend and a round trip, but changes model behavior.
- Multi-section matching sends every source summary for every target summary,
  giving O(S×T) summary input and classification output. The lab describes sparse
  candidates, adaptive expansion, and an ordered corridor; the app currently
  uses all candidates and independent top-three selection. Treat this as a
  separately evaluated improvement, with wide-search fallback for displaced,
  reordered, or partial translations. A narrow positional band alone is unsafe.
- Keep overlap until evaluated. It contributes repeated tokens but provides
  recovery context. Retain the recent source-context deduplication.

## 4. General efficiency

1. **Bounded concurrency is the lowest semantic-risk latency improvement.**
   Independent splits can use the exact same prompts concurrently. The same is
   true of summaries and independent section/row requests within each stage,
   with stage barriers before dependent work. Use a shared bounded request pool;
   keep checkpoint writes coordinated and merges deterministic. Do not hold the
   chapter/repository write lock while awaiting AI calls. Parallelizing conflicts
   also helps long documents, but cannot explain a true single-target-window run:
   that run has no overlapping target candidates to disagree.
2. **Checkpoint less work.** `run_cached_json_prompt` (line 2627) serializes and
   atomically writes/fsyncs the entire job before checking whether the individual
   response is cached. It repeats this even for identical state or cache hits.
   Checkpoint actual state changes, keep per-response durability, and avoid
   copying all source/target text for every request. This is secondary to network
   latency and needs profiling before making timing claims.
3. **Budget by text size as well as rows.** Fifty long paragraphs can be large.
   Combined source corridors may contain up to about 300 distinct source units
   for three distant interior matches, plus 50 target units. There is no prompt
   token budget in this pipeline. Add input/output-aware limits while retaining
   enough source context to avoid reintroducing false conflicts.
4. **Measure provider work explicitly.** The provider response type currently
   discards usage; alignment has no per-request elapsed-time/cache-hit diagnostics.
   Existing logs mainly time the apply/commit stage. Record stage, model,
   source/target counts, prompt size, usage when available, latency, cache hit,
   and retry reason without document contents. Then distinguish splitting,
   provider latency, and disk/application time in a real incident.
5. **Model selection can change latency independently.** Alignment inherits
   the `translate1` setting (`project-add-translation-flow.js:191`). The local
   OpenAI request builder sets no explicit reasoning option and no output-token
   cap. No claim about actual model defaults or model changes in the reported
   run is established here. Instrument first; evaluate any model/effort change.

The shared HTTP client already reuses connections. Apply already groups writes
into one commit rather than committing per translated paragraph. The command
runs on `spawn_blocking` and emits progress; the invoke promise waits for
completion, but the frontend is not synchronously frozen. Those are not the
serial split-request cause.

## Recommended order

1. Enforce complete section-match answers and retain all current safe-split checks.
2. Remove irrelevant prompt hashes/UUIDs; add per-stage timing/call-count evidence.
3. Introduce bounded concurrent split calls, then budgeted split batches with
   per-target validation/recovery. Compare exact mapping and preserved target
   content against representative bilingual fixtures before shipping batching.
4. Evaluate combined short-path compatibility/alignment, then long-document
   candidate selection and checkpoint optimization separately.

Do not assume equal row counts imply positional alignment, drop overlap blindly,
or loosen validation just to make a run faster.

## Verification and limits

- `cargo test --manifest-path src-tauri/Cargo.toml --lib aligned_translation::tests`:
  **22 passed** (includes safe splits, source corridor, cache recovery and locking).
- `node --test --import ./src-ui/test/register-raw-loader.mjs
  src-ui/app/project-add-translation-flow.test.js
  src-ui/screens/project-add-translation-modal.test.js`: **26 passed**.
  The initial direct Node invocation lacked the repository's raw-SVG loader and
  failed during imports; rerunning with the configured loader passed.
- **5 temporary offline Rust probes passed**, using current topology functions
  and the section validation body extracted verbatim. They confirm one row call
  at 20/50 units, asymmetric threshold behavior, invalid row-ID rejection,
  acceptance of incomplete section answers, and the unmatched-prefix consequence.
  The harness substitutes only a dummy unused content hash and minimal data
  structs; it does not exercise Tauri/network/storage end to end. Probe source:
  `/private/tmp/gnosis-alignment-audit-pcgmzj0n/probe.rs`.
- Synthetic JSON sizes were measured offline with Python; no tokenizer or paid
  provider was used. Historical batching was verified against `41f12e8e^`, and
  the original 50-unit/compatibility behavior against `a243ea12`.
- `git diff --check` passed. Only this audit document was added. The pre-existing
  untracked AI Translate All audit remains untouched. No application changes,
  installed-app rebuild, saved translation writes, or live AI requests were made.
