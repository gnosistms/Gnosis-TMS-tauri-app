# Add-translation alignment modal fixes

Fixes for the "Aligning and inserting" modal (`renderProjectAddTranslationModal`) and
its backend pipeline (`aligned_translation.rs`).

## Problems

1. **No click feedback on Continue.** The add-translation `continue-*` / `submit-*`
   actions sit in the plain `exactActions` map and never use `runWithImmediateLoading`,
   so during the async pre-flight setup (`ensureOpenAiReady`, provider checks) the
   button looks inert and users click it several times, each firing another preflight.
2. **Wrong modal for the single-block path.** When the whole file fits in one AI block
   (`source_units.len() <= SECTION_SIZE && target_units.len() <= SECTION_SIZE`, 50 each)
   the pipeline skips `summarize_sections`, `find_section_matches`, `select_corridor`
   (and effectively `resolve_conflicts`), but the modal always renders all 9 steps.
3. **Progress bars sit static, then jump.** Every stage emits `running` with
   `completed=0,total=1`, does a long AI/git call, then emits `complete` — so each bar
   goes 0%→100% with no motion. The single-block compatibility check
   (`short_text_compatibility`) and the final git commit (`apply_job_to_chapter`) emit
   **no** progress at all → long dead gaps, then a sudden jump to all-100% and close.
4. **Bar styling is bespoke.** `add-translation-progress__bar*` uses a green→blue
   gradient unlike the app's other AI progress bars (`ai-translate-all-modal__progress-*`,
   amber). Styling should be shared so future UI changes apply to all progress bars.

## Decisions (confirmed with user)

- Single-block modal shows **3 steps**: *Preparing text*, *Aligning translation*,
  *Applying translation*.
- Bar style converges on the **Translate-all amber bars**, extracted to a shared class.

## Changes

### A. Button feedback — `src-ui/app/actions/project-actions.js`
Move the four add-translation actions out of `exactActions` into the
`runWithImmediateLoading(event, label, …)` chain (same pattern as
`submit-project-creation`):
- `submit-project-add-translation-paste` → "Continue…"
- `continue-project-add-translation-language` → "Aligning…"
- `continue-project-add-translation-existing` → "Inserting…"
- `continue-project-add-translation-mismatch` → "Inserting…"

This swaps the clicked button to a disabled spinner (`data-action="noop"`) immediately,
bridging the gap until the progress modal renders and preventing duplicate firing.

### B. Backend flow flag + progress during the silent gap — `aligned_translation.rs`
- Add `single_block: bool` to `AlignmentJob`; compute once in
  `preflight_…_sync` from the unit counts; set on the job.
- Add `flow: String` (`"single"` / `"multi"`) with `#[serde(default)]` to
  `AlignmentProgressEvent`, and a `flow` field to `AlignedTranslationPreflightResponse`.
- Stamp `flow` on the initial `prepare_units` event and on the preflight response
  (the FE persists it, so intermediate events need not carry it; a small
  `emit_job_progress` helper can stamp it for job-scoped emits if cheap).
- In the single-block branch of `run_mismatch_preflight`, emit a `row_alignment`-stage
  `running` event before `short_text_compatibility` so the "Aligning translation" bar
  has an active stage to animate during that call.

### C. Modal: two step configs, flow-aware — `src-ui/screens/project-add-translation-modal.js`
- Keep `MULTI_STEPS` (current 9). Add `SINGLE_STEPS` (3) where each step matches a set
  of backend stageIds:
  - *Preparing text* ← `prepare_units`
  - *Aligning translation* ← `row_alignment`, `resolve_conflicts`, `split_targets`,
    `final_checks`, `preflight`, `mismatch_gate`
  - *Applying translation* ← `apply`
- Select the config from `modal.flow === "single"`.
- Generalize `resolveActiveProgressStepIndex` to take the active step list and match a
  step by its `stageIds` set (instead of the hard-coded id list).

### D. Flow state — `src-ui/app/project-add-translation-flow.js`
- Add `flow: ""` to `createProjectAddTranslationState()` (in `state.js`); `""` renders
  the multi list.
- In the progress listener, persist `modal.flow` when `payload.flow` is non-empty.
- In `runProjectAddTranslationPreflight`, set `flow` from `response.flow`.

### E. CSS — `src-ui/styles/modals.css`
- Extract the amber track/fill (currently on `ai-translate-all-modal__progress-track`
  / `…__progress-fill`) into a single source of truth via grouped selectors that also
  cover `add-translation-progress__bar` / `…__bar-fill` (no markup churn, one rule set
  to change later). Replace the green→blue gradient with the shared amber.
- Add an indeterminate "active" animation (moving highlight) used by the alignment
  modal's currently-running step, so the long AI/git gaps show motion instead of a
  dead bar. (Translate-all bars stay determinate.)

### F. Tests
- `project-add-translation-modal.test.js`: keep the multi test (set `flow:"multi"`);
  add a `flow:"single"` test asserting only the 3 step labels render and the
  multi-only labels (e.g. "Summarizing sections") are absent.
- `project-add-translation-flow.test.js`: assert `flow` persists from a progress event
  / preflight response if that module is covered there.

## Verification
- `npm test`, `npm run audit:unused`.
- Manual (needs OpenAI key + project): small file → 3-step modal; large file → 9-step
  modal; bars animate during gaps; amber styling; modal closes promptly; Continue shows
  a spinner immediately. Will note if the environment can't fully exercise the AI path.

## Out of scope
- No change to the alignment algorithm or stage semantics beyond the `flow` flag and the
  one added progress emit.
- Parity rule (glossary/QA) does not apply — add-translation is project-only.
