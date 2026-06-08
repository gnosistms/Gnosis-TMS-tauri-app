# Handoff: Add-translation alignment modal fixes

Self-contained implementation brief for an agent with **no prior context** on this work.
Read this top-to-bottom before editing. A companion design doc lives at
`plans/add-translation-alignment-modal-fixes-plan.md`; this file is the authoritative
spec.

## 0. What this feature is

Gnosis TMS is a Tauri desktop app. The "Add translation" flow lets a user paste a
translated version of a file; the backend uses an OpenAI model to **align** the pasted
text against the existing source rows, then inserts it. While that runs, a modal titled
**"Aligning and inserting / Please wait"** shows a numbered list of progress steps, each
with its own progress bar. The UI should treat the whole backend preparation/alignment
pipeline as user-visible work. "Preflight" is an internal implementation term only; do
not leave the user staring at a button spinner while the app is doing AI or git work.

- Backend pipeline: `src-tauri/src/project_import/chapter_editor/aligned_translation.rs`
- Backend command wrappers: `src-tauri/src/project_import.rs` (`preflight_…` line ~201,
  `apply_…` line ~214), registered in `src-tauri/src/lib.rs` (`generate_handler!`).
- Backend → frontend progress is a Tauri event named `aligned-translation-progress`
  (`EVENT_NAME`, aligned_translation.rs:22).
- Frontend modal renderer: `src-ui/screens/project-add-translation-modal.js`
- Frontend flow / state / event listener: `src-ui/app/project-add-translation-flow.js`
- Frontend modal state factory: `src-ui/app/state.js` → `createProjectAddTranslationState`
  (line 363)
- Action dispatch: `src-ui/app/actions/project-actions.js`
- Styles: `src-ui/styles/modals.css`

### Architecture rules you MUST respect (from repo CLAUDE.md/AGENTS.md)
- Frontend is **vanilla ES modules**, no framework. State lives in a plain `state`
  object (`src-ui/app/state.js`); UI re-renders by calling the injected `render`
  callback after mutating state.
- Backend structs that cross the IPC boundary use `#[serde(rename_all = "camelCase")]`
  — Rust `stage_id` becomes JS `stageId`, etc.
- **Scope discipline:** only touch what this brief describes.
- This feature is **project-only**; the glossary/QA "parity" rule does NOT apply.
- Run `npm test` and `npm run audit:unused` before declaring done.

## 1. The four problems to fix

### Problem 1 — Continue button gives no feedback (user clicks several times)
The add-translation `continue-*` / `submit-*` actions are registered in the plain
`exactActions` map in `project-actions.js` and do **not** use the existing
`runWithImmediateLoading` helper. So between the click and the moment the progress modal
renders, the button looks inert (it awaits `ensureOpenAiReady` and provider checks
first), and repeated clicks each fire another preflight.

The fix is two-part:
- The clicked button must show immediate loading feedback.
- The progress modal must open as soon as the alignment operation begins, and it must
  surface all backend preparation/alignment steps that used to be called "preflight".
  The user-facing UI should not expose "preflight" as a separate concept.

### Problem 2 — Wrong modal for the "single-block" path
The pipeline has two paths, decided by unit counts vs. `SECTION_SIZE` (= 50,
aligned_translation.rs:23):

- **Single-block** (`source_units.len() <= 50 && target_units.len() <= 50`): the whole
  file fits one AI block. The pipeline SKIPS `summarize_sections`,
  `find_section_matches`, `select_corridor`, and effectively `resolve_conflicts`. See
  `run_mismatch_preflight` (aligned_translation.rs:792) short-circuit at line 797, and
  `run_remaining_alignment` (line 831) single-corridor branch at line 836.
- **Multi-block**: all stages run.

The modal (`project-add-translation-modal.js`) always renders all 9 steps regardless.

**Decision (confirmed):** for single-block, show a **3-step** modal:
*Preparing text → Aligning translation → Applying translation.*

### Problem 3 — Bars sit static during long calls, then jump; modal seems to close late
Each stage emits a `running` event with `completed=0,total=1`, performs a long AI or git
call, then emits `complete` — so every bar jumps 0%→100% with nothing in between.
Two stages emit **no** progress at all:
- single-block `short_text_compatibility` (a full AI call), called inside
  `run_mismatch_preflight` at line ~798, emits nothing.
- the final git commit in `apply_job_to_chapter` (called from the apply command around
  line 521) runs between the `apply` "running 0/1" and "complete 1/1" emits.

Result: long dead gaps, then a sudden snap to all-100% immediately before the modal
closes. One current frontend bug makes this worse: the progress listener ignores every
event until `modal.jobId` is already known, but the job id first arrives in those early
events. The frontend must accept the first progress event for the active add-translation
operation, store its job id, then strictly match later events to that job id. (The modal
closes when the apply IPC promise resolves — see `applyProjectAddTranslation`, flow file
line ~372.)

### Problem 4 — Progress bar styling is bespoke
`add-translation-progress__bar` / `__bar-fill` (modals.css:116–131) use a green→blue
gradient. The app's other AI progress bars — `ai-translate-all-modal__progress-track` /
`__progress-fill` (modals.css:1420–1434) — use an **amber** gradient with a bordered
track. **Decision (confirmed):** converge the alignment bars onto the amber style,
extracted to a shared rule set so future changes apply to all progress bars at once.

## 2. Implementation tasks

### Task A — Immediate spinner on Continue/Submit buttons
File: `src-ui/app/actions/project-actions.js`

There is an existing helper `runWithImmediateLoading(event, label, action)` (imported
from `../action-helpers.js`, defined in `src-ui/app/action-helpers.js`). It swaps the
clicked button to a disabled spinner (`data-action="noop"`), waits one paint, then runs
the action. It is already used for `submit-project-creation`, `submit-project-rename`,
etc. in the `handleProjectAction` body (around line 366+).

Currently these four live in the `exactActions` object (lines ~257–260):

```js
"submit-project-add-translation-paste": () => submitProjectAddTranslationPaste(render),
"continue-project-add-translation-language": () => continueProjectAddTranslationLanguage(render),
"continue-project-add-translation-existing": () => continueProjectAddTranslationWithExistingText(render),
"continue-project-add-translation-mismatch": () => continueProjectAddTranslationAfterMismatch(render),
```

**Change:** remove these four from `exactActions` and handle them in the
`handleProjectAction` body with `runWithImmediateLoading`, e.g.:

```js
if (action === "submit-project-add-translation-paste") {
  await runWithImmediateLoading(event, "Continue...", () => submitProjectAddTranslationPaste(render));
  return true;
}
if (action === "continue-project-add-translation-language") {
  await runWithImmediateLoading(event, "Aligning...", () => continueProjectAddTranslationLanguage(render));
  return true;
}
if (action === "continue-project-add-translation-existing") {
  await runWithImmediateLoading(event, "Inserting...", () => continueProjectAddTranslationWithExistingText(render));
  return true;
}
if (action === "continue-project-add-translation-mismatch") {
  await runWithImmediateLoading(event, "Inserting...", () => continueProjectAddTranslationAfterMismatch(render));
  return true;
}
```

Confirm `handleProjectAction(action, event)` already receives `event` (it does — see the
existing `runWithImmediateLoading(event, …)` call sites). Keep the imports of those four
functions (they're already imported near the top of the file).

### Task B — Backend `flow` flag + progress during the silent compatibility call
File: `src-tauri/src/project_import/chapter_editor/aligned_translation.rs`

**B1. `AlignmentJob` struct (line 187).** Add a field. The job is serialized to disk and
re-read from cache (`save_job` / `read_json_file`), so it MUST be backward-compatible:

```rust
#[serde(default)]
single_block: bool,
```

**B2. `AlignmentProgressEvent` struct (lines 60–74)** — uses `#[serde(rename_all =
"camelCase")]`. Add:

```rust
#[serde(default)]
flow: String,
```

Update `progress_event(...)` (lines 2300–2328) to set `flow: String::new()` in the
returned struct (keeps existing callers compiling).

**B3. `AlignedTranslationPreflightResponse` struct (lines 87–102)** — add a `flow: String`
field, and set it in `preflight_response(...)` (lines 2282–2298) from the job, e.g.
`flow: flow_label(job).to_string()` where `flow_label` returns `"single"` or `"multi"`.

Add a tiny helper:

```rust
fn flow_label(job: &AlignmentJob) -> &'static str {
    if is_single_block_job(job) { "single" } else { "multi" }
}

fn is_single_block_job(job: &AlignmentJob) -> bool {
    job.source_units.len() <= SECTION_SIZE && job.target_units.len() <= SECTION_SIZE
}
```

Do not rely only on the cached `job.single_block` field to compute the response flow.
Older cached jobs deserialize `single_block` as `false` because of `#[serde(default)]`,
even if their unit counts are single-block. Deriving from the units keeps old cached jobs
correct. The stored field is still useful for explicit cache readability and future
debugging.

**B4. Compute `single_block` in `preflight_…_sync` (lines 280–420).** `source_units` and
`target_units` are built at lines 327–328. Compute once:

```rust
let single_block =
    source_units.len() <= SECTION_SIZE && target_units.len() <= SECTION_SIZE;
```

Set `single_block` on the `AlignmentJob` you build at lines 388–415.

**B5. Stamp `flow` on the first `prepare_units` event (lines 345–354).** That event is
emitted before the job struct exists, but `single_block` is already computed. After
building the `progress` event there, set `progress.flow = if single_block { "single" }
else { "multi" }.to_string();` before `emit_progress`.

This first event is important: it gives the frontend both the `jobId` and the correct
single/multi step list before any long AI work starts. If you add a small
`emit_job_progress(app, job, ...)` wrapper, have it stamp `flow` from `flow_label(job)` on
all job-scoped emits.

**B6. Emit an "aligning" running event before the silent compatibility call.** In
`run_mismatch_preflight` (line 792), the single-block branch (line 797) calls
`short_text_compatibility(job, api_key)?` with no progress emit. Add, immediately before
that call, an emit using stage id `row_alignment` (which the frontend maps to the
"Aligning translation" step — see Task C):

```rust
emit_progress(
    app,
    &progress_event(
        &job.job_id,
        "row_alignment",
        "Aligning translation",
        "running",
        Some(0),
        Some(1),
        "Aligning your translation",
    ),
);
```

(Stamp `.flow = "single"` on it too if you added a helper; not required.)

Do **not** otherwise change the alignment algorithm. Internally the command/response may
still use names such as "preflight"; the UI must map those stages into the visible
alignment process rather than hiding them behind a generic waiting state.

### Task C — Modal: two step configs, flow-aware rendering
File: `src-ui/screens/project-add-translation-modal.js`

Current state: a single `ALIGNMENT_PROGRESS_STEPS` array (lines 96–106) of 9
`{id, label}` entries; `resolveActiveProgressStepIndex(progress)` (lines 168–183) maps
`progress.stageId` to an index by matching `step.id === stageId`, with special-cases for
`"preflight"` and `"mismatch_gate"`; `renderProgressModal(modal)` (lines 185–205) maps
over the array.

**Changes:**

1. Replace the single array with two configs. Give each step a set of backend stage ids
   it represents:

```js
const MULTI_STEPS = [
  { id: "prepare_units", label: "Preparing text units", stageIds: ["prepare_units"] },
  { id: "summarize_sections", label: "Summarizing sections", stageIds: ["summarize_sections"] },
  { id: "find_section_matches", label: "Finding section matches", stageIds: ["find_section_matches"] },
  { id: "select_corridor", label: "Choosing the best matches", stageIds: ["select_corridor"] },
  { id: "row_alignment", label: "Aligning paragraphs", stageIds: ["row_alignment"] },
  { id: "resolve_conflicts", label: "Resolving conflicts", stageIds: ["resolve_conflicts"] },
  { id: "split_targets", label: "Splitting combined target rows", stageIds: ["split_targets"] },
  { id: "final_checks", label: "Final checks", stageIds: ["final_checks", "preflight", "mismatch_gate"] },
  { id: "apply", label: "Applying translation", stageIds: ["apply"] },
];

const SINGLE_STEPS = [
  { id: "prepare_units", label: "Preparing text", stageIds: ["prepare_units"] },
  {
    id: "aligning",
    label: "Aligning translation",
    stageIds: [
      "row_alignment", "resolve_conflicts", "split_targets",
      "final_checks", "preflight", "mismatch_gate",
    ],
  },
  { id: "apply", label: "Applying translation", stageIds: ["apply"] },
];

function progressStepsForFlow(flow) {
  return flow === "single" ? SINGLE_STEPS : MULTI_STEPS;
}
```

2. Rewrite `resolveActiveProgressStepIndex` to take the active step list and match by the
   `stageIds` set, but preserve the old status-sensitive `preflight` behavior:

```js
function resolveActiveProgressStepIndex(progress, steps) {
  const stageId = typeof progress?.stageId === "string" ? progress.stageId : "";
  if (!stageId) return -1;
  if (stageId === "preflight" && progress?.status !== "complete") {
    return steps.findIndex((step) => step.id === "prepare_units");
  }
  return steps.findIndex((step) => step.stageIds.includes(stageId));
}
```

   This keeps running/resumed `preflight` on the first visible step while complete
   `preflight` and `mismatch_gate` map to final checks/aligning through `stageIds`.

3. In `renderProgressModal`, pick the config from `modal.flow` and pass `steps` through to
   `resolveActiveProgressStepIndex`, the `.map(...)` over steps, and `renderProgressStep`
   / `progressStepPercent` (which currently take `(step, progress, index, activeIndex)` —
   no change needed beyond iterating the chosen list):

```js
const steps = progressStepsForFlow(modal.flow);
const activeIndex = resolveActiveProgressStepIndex(progress, steps);
// … steps.map((step, index) => renderProgressStep(step, progress, index, activeIndex))
```

4. Add an "active/running" CSS hook so the running step animates (Task E). In
   `renderProgressStep`, the element already gets `is-active` when
   `index === activeIndex && progress?.status !== "complete"`. Add an extra class when the
   active step is running and its bar is not yet determinate-complete, e.g. append
   `add-translation-progress__step--indeterminate` (or set it on the `__bar`) so CSS can
   target it. Keep the existing `is-active` / `is-complete` classes.

   Because `renderProgressStep` currently writes an inline width style, the indeterminate
   case must also avoid or override `style="width: 0%"`. Prefer conditional markup:
   determinate steps keep `style="width: ${roundedPercent}%"`; indeterminate steps render
   the fill without an inline width so CSS can provide the animated 40% sweep.

`modal.flow` will be `""` until the first event/response arrives; `progressStepsForFlow`
treats anything other than `"single"` as multi, so the default is the full list.

### Task D — Frontend flow state + event wiring
Files: `src-ui/app/state.js`, `src-ui/app/project-add-translation-flow.js`

**D1.** In `createProjectAddTranslationState()` (state.js:363) add `flow: "",` to the
returned object.

**D2.** In `project-add-translation-flow.js`:
- The progress listener `registerProjectAddTranslationProgress` (lines ~94–111) currently
  ignores every event unless `payload.jobId === modal.jobId`. That drops the first
  `prepare_units` event because `modal.jobId` is still empty. Change the guard:
  - If `modal.jobId` is non-empty, keep strict `payload.jobId === modal.jobId` matching.
  - If `modal.jobId` is empty, accept the first event only when the modal is open,
    `payload.jobId` is non-empty, and `modal.step` is `"aligning"` or `"applying"`.
  - Store `jobId: modal.jobId || payload.jobId` and
    `flow: payload.flow ? payload.flow : modal.flow` when applying the event.
  - Ignore events with no `payload.jobId`.
- In `runProjectAddTranslationPreflight` (lines ~257–370), the success branch builds
  `next` from `response` (lines ~327–342). Add `flow: response?.flow || state.projectAddTranslation.flow || ""`
  to `next` so the authoritative flow from the preflight response is stored.
- When the user confirms the language and `runProjectAddTranslationPreflight` starts,
  move immediately into the progress modal before invoking the backend:
  `step: "aligning"`, `status: "running"`, `error: ""`, and optimistic
  `prepare_units` progress. This makes the backend preparation/alignment work visible as
  part of the process. The optimistic progress can leave `flow` empty; the first real
  `prepare_units` event should arrive quickly and switch the modal to the correct single
  or multi step list.

The immediate button spinner from Task A is still required. It covers the click-to-modal
gap while provider/key checks run; the progress modal covers the actual preparation,
alignment, and apply work.

### Task E — CSS: shared amber bars + active animation
File: `src-ui/styles/modals.css`

Goal: one source of truth for progress-bar color/shape, shared by the Translate-all bars
and the alignment bars; alignment's running step also animates.

1. The amber styling currently on `.ai-translate-all-modal__progress-track` (lines
   1420–1427) and `.ai-translate-all-modal__progress-fill` (lines 1429–1434):

```css
.ai-translate-all-modal__progress-track {
  width: 100%; height: 10px; overflow: hidden;
  border: 1px solid rgba(166, 108, 45, 0.22);
  border-radius: 999px;
  background: rgba(255, 247, 233, 0.82);
}
.ai-translate-all-modal__progress-fill {
  height: 100%; border-radius: inherit;
  background: linear-gradient(90deg, rgba(198, 113, 0, 0.82), rgba(240, 142, 0, 0.92));
  transition: width 160ms ease;
}
```

   Make these a shared rule set. Simplest no-markup-churn approach: use grouped selectors
   so both the track classes and both fill classes share the same declarations, e.g.:

```css
.ai-translate-all-modal__progress-track,
.add-translation-progress__bar {
  /* shared track: border + amber-tinted background + pill radius */
}
.ai-translate-all-modal__progress-fill,
.add-translation-progress__bar-fill {
  /* shared amber gradient + transition */
}
```

   Then DELETE the green→blue gradient from `.add-translation-progress__bar-fill`
   (current line 129) and the old standalone `.add-translation-progress__bar` background
   (line 121). Keep alignment-specific positioning that differs from the translate-all
   bars: the alignment `__bar` is `position: relative; height: 8px;` and `__bar-fill` is
   absolutely positioned (`position:absolute; inset:0 auto 0 0; width:0`). Preserve those
   structural rules; only the **color/border/background/gradient** should come from the
   shared set. (If grouped selectors get awkward because of the absolute-vs-block fill
   difference, instead define CSS custom properties — e.g. `--progress-fill-gradient`,
   `--progress-track-bg`, `--progress-track-border` — on a shared `:root`/modal scope and
   reference them from both components. Either way: one place to change the palette.)

2. Add an indeterminate animation for the alignment modal's active running step so long
   AI/git gaps show motion. Target the class you added in Task C (e.g.
   `.add-translation-progress__step--indeterminate .add-translation-progress__bar-fill`)
   with a keyframe that animates a moving highlight or sweeps width, e.g.:

```css
@keyframes add-translation-progress-indeterminate {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(250%); }
}
.add-translation-progress__step--indeterminate .add-translation-progress__bar-fill {
  /* show a partial fill that sweeps; keep amber */
  width: 40%;
  animation: add-translation-progress-indeterminate 1.1s ease-in-out infinite;
}
```

   Tune to taste; the requirement is visible motion while a stage is running with no
   determinate fraction. Determinate steps (real completed/total) keep the width-based
   fill. Ensure the indeterminate fill is not defeated by an inline `width: 0%` style
   from the renderer.

## 3. Tests

### Update `src-ui/screens/project-add-translation-modal.test.js`
- The existing test "add translation progress modal shows full staged progress" (line
  108) renders without a `flow` → defaults to multi, so it should still pass. To be
  explicit, you may add `flow: "multi"` to that fixture's `projectAddTranslation`.
- The "cached preflight" test (line 143) uses stageId `"preflight"`; with multi it must
  still map to "Final checks" at 100% — verify the `stageIds` set keeps that assertion
  passing.
- **Add a new test** for the single-block modal: fixture with `flow: "single"` and a
  running `row_alignment` progress; assert the 3 labels ("Preparing text", "Aligning
  translation", "Applying translation") render and that multi-only labels (e.g.
  "Summarizing sections", "Finding section matches", "Choosing the best matches") are
  **absent**.

### Update `src-ui/app/project-add-translation-flow.test.js`
- If it covers `registerProjectAddTranslationProgress` / preflight, add an assertion that
  `state.projectAddTranslation.flow` is set to `"single"` after a progress event or
  preflight response carrying `flow: "single"`, and persists across a later event that
  omits `flow`.
- Add a regression test for first-event job locking: start with an open modal in
  `step: "aligning"` and empty `jobId`, dispatch an `aligned-translation-progress` event
  with `jobId` and `flow`, and assert the modal stores that `jobId`, stores the flow, and
  renders progress. Then dispatch an event for a different `jobId` and assert it is
  ignored.
- Add or update a test showing that confirming the language moves into the progress modal
  before awaiting the backend response, so the formerly "preflight" work is visible.

### Optional Rust test
If `aligned_translation.rs` has a `#[cfg(test)]` module, a small unit test for
`flow_label` / `single_block` computation is welcome but not required.

## 4. Verification

```bash
npm test              # Node unit tests — must pass
npm run audit:unused  # no new unused-export regressions
cargo check           # Rust compile check — required because aligned_translation.rs changes
```

Manual (needs an OpenAI key configured in AI Settings + a real project repo, via
`npm run tauri:dev`):
1. **Single-block:** paste a short translation into a small file → modal shows only the
   3 steps; the "Aligning translation" bar animates during the AI call; bars are amber;
   modal closes promptly after "Applying translation".
2. **Multi-block:** paste a long translation (>50 source rows and >50 pasted lines) →
   modal shows all 9 steps; the active step animates through each AI call.
3. **Continue button:** click Continue on the language picker → the button immediately
   shows a spinner and cannot be re-clicked.

If the environment can't reach OpenAI, state that the AI path wasn't exercised and rely
on unit tests + code review.

## 5. Files you will touch (summary)
- `src-tauri/src/project_import/chapter_editor/aligned_translation.rs` (Tasks B)
- `src-ui/app/actions/project-actions.js` (Task A)
- `src-ui/screens/project-add-translation-modal.js` (Task C)
- `src-ui/app/project-add-translation-flow.js` (Task D)
- `src-ui/app/state.js` (Task D1)
- `src-ui/styles/modals.css` (Task E)
- `src-ui/screens/project-add-translation-modal.test.js` (Task 3)
- `src-ui/app/project-add-translation-flow.test.js` (Task 3)

## 6. Gotchas
- `AlignmentJob` is cached to disk; the new field **must** be `#[serde(default)]` or
  cached jobs from older runs fail to deserialize.
- IPC structs are camelCase on the JS side: Rust `flow` → JS `payload.flow` /
  `response.flow`; Rust `stage_id` → `stageId`.
- The frontend persists `flow` across events — do not reset it to `""` when an event
  omits it. Only a fresh modal (`createProjectAddTranslationState`) clears it.
- Keep the alignment bar's structural CSS (relative bar + absolute fill); share only the
  palette so it doesn't visually break.
- Don't disable user actions for background work and don't bypass the existing render
  flow — follow the patterns already in these files.
