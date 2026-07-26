# Existing Loading-Button Spinner Continuity Adoption

Status: implemented; automated verification complete, manual verification pending.

## Goal

Adopt the shared loading-spinner continuity mechanism for every existing,
hand-authored loading **button** without flattening the behavioral differences
between those buttons.

The continuity observer only tracks a spinner whose host has a stable
`data-loading-spinner-key`. Existing buttons produced by `loadingPrimaryButton`
or changed by `setImmediateLoadingButton` already satisfy that contract and are
outside this migration. The two pending-save spinners in the editor history and
review panes are status indicators rather than buttons and are also outside this
plan.

## Constraints

- Preserve each button's current action dispatch, native `disabled` behavior,
  `aria-disabled`, `aria-busy`, tooltip, variant, compact sizing, and custom
  content layout.
- A continuity key identifies one logical operation. It must not be derived from
  visible text, CSS classes, DOM position, or another mutable presentation detail.
- Do not make the observer infer keys for unkeyed spinners.
- Do not turn non-button activity indicators into buttons or couple them to the
  loading-button helper.
- Keep glossary and QA old-layout recovery behavior in parity.
- Do not add loading state to a button that does not currently have it.

## Shared UI Foundation

Before migrating individual buttons, extend `src-ui/lib/ui.js` with a standard
text loading-button renderer that supports the existing primary, secondary, and
error variants. Keep `loadingPrimaryButton` as a compatibility wrapper so the
already-migrated modal call sites do not churn.

The shared renderer must support only genuinely shared behavior:

- idle and loading labels;
- semantic operation/action key;
- variant (`primary`, `secondary`, or `error`);
- optional compact and additional classes;
- native disabled state and `aria-busy`;
- safe escaping of actions, keys, labels, and classes.

Custom-layout buttons may retain local markup. For those buttons, expose one
small escaping helper for the spinner-host key rather than forcing icon shells,
tooltips, drop zones, or multiple nested labels through a text-button API.
Avoid a generic options object with enough switches to reproduce arbitrary HTML;
that would hide rather than remove per-button requirements.

Add shared-helper tests proving:

- each supported variant emits the expected classes;
- loading markup has `data-action="noop"` when action suppression is requested,
  a stable `data-loading-spinner-key`, native `disabled`, and `aria-busy="true"`;
- idle markup retains the real action and does not emit loading attributes;
- optional compact/additional classes are preserved and escaped;
- the existing `loadingPrimaryButton` output remains compatible.

## Individual Button Plans

### 1. Offline banner “Reconnect”

Files:

- `src-ui/lib/ui.js`
- a screen-level test that renders `pageShell`, preferably the existing projects
  screen test because it already covers banner placement

Current behavior:

- secondary, compact button inside the shared page shell;
- loading state comes from `state.offline.reconnecting`;
- keeps `data-action="reconnect-online"` while reconnecting;
- uses `is-disabled` plus `aria-disabled`, but not native `disabled`;
- rerenders when reconnect begins, connection checks finish, or authentication
  restoration updates shared state.

Integration:

- Keep this as page-shell-specific markup unless the shared renderer can preserve
  its intentional non-native-disabled behavior without adding a one-off API flag.
- Use the semantic key `reconnect-online`.
- Add `aria-busy="true"` only while reconnecting.
- Preserve the current action attribute and click guard in
  `reconnectOnlineMode`; do not silently change it to `noop` or add native
  `disabled` as part of spinner adoption.

Tests:

- idle banner has the reconnect action and no loading key/busy state;
- reconnecting banner has the same action, key `reconnect-online`, spinner,
  `aria-busy="true"`, and its existing `aria-disabled`/class behavior;
- repeated reconnecting renders produce the same key.

### 2. Connection-failure modal “Reconnect”

Files:

- `src-ui/screens/connection-failure-modal.js`
- `src-ui/app/offline-connectivity.test.js`

Current behavior:

- secondary modal action;
- `state.connectionFailure.reconnecting` owns loading state;
- loading replaces the real action with `noop`, uses native `disabled`, and sets
  `aria-busy`;
- the companion “Go offline” action is also disabled during reconnect.

Integration:

- Migrate the reconnect button to the standard secondary loading-button renderer.
- Use `reconnect-from-connection-failure` as both the idle action and continuity
  key while retaining `noop` in loading markup.
- Preserve the companion-button disabling behavior and retry state machine.

Tests:

- extend the existing reconnecting-state test to assert the stable key;
- retain assertions for `noop`, native disabled, busy state, and disabled
  “Go offline” action;
- add an idle-state assertion that the loading key is absent.

### 3. Project-import upload drop zone

Files:

- `src-ui/screens/project-import-modal.js`
- `src-ui/screens/project-import-modal.test.js`

Current behavior:

- contains a conditional `button__spinner` branch in the upload drop-zone
  renderer;
- that branch is unreachable in current control flow because upload importing
  returns `renderProjectImportUploadProgressStep` before the upload panel is
  rendered;
- the active upload UI is a progress screen with a progress bar and cancellable
  action, not a loading button.

Integration:

- Do not add a continuity key to unreachable markup.
- Remove the `isImporting` parameter and dormant spinner/disabled branches from
  `renderProjectImportUploadPanel`.
- Preserve the dedicated upload progress step, its cancel action, and progressbar
  accessibility.
- If product behavior later restores an importing drop zone, treat that as a new
  design decision with its own stable batch/operation key.

Tests:

- retain the existing upload-progress test proving importing upload mode has a
  progressbar and no drop zone;
- add an idle upload-panel assertion that it has no spinner, loading class, busy
  state, or loading key;
- keep the progress cancellation assertions intact.

### 4. AI Translate action buttons

Files:

- `src-ui/screens/translate-sidebar.js`
- `src-ui/screens/translate-sidebar.test.js`

Current behavior:

- custom secondary button with provider icon shell, model/provider copy, tooltip,
  and action-specific loading state;
- keeps `data-action="run-editor-ai-translate:<actionId>"` while disabled;
- loading visibility is scoped to row, source language, target language, and
  action state;
- already sets native disabled, `aria-disabled`, and `aria-busy`;
- may rerender as editor selection and AI request state change.

Integration:

- Preserve the custom markup rather than forcing it through the text-button helper.
- While loading, add a key based on the semantic action:
  `run-editor-ai-translate:<actionId>`.
- Do not include provider/model labels or tooltip text in the key.
- Keep the real action attribute, current native-disabled behavior, icon-shell
  layout, provider icon replacement, and tooltip.
- Confirm that action IDs are unique among simultaneously rendered translate
  buttons. The current `translate1`/`translate2` identifiers satisfy this.

Tests:

- extend the existing loading-button test to assert the expected keyed action;
- assert the second configured action receives a distinct key;
- retain action, icon-shell, tooltip, disabled, and busy-state assertions;
- assert idle AI translate buttons do not emit loading keys.

### 5. AI Review mode buttons

Files:

- `src-ui/screens/translate-review-pane.js`
- `src-ui/screens/translate-sidebar.test.js`

Current behavior:

- primary buttons for full review and spelling/grammar review;
- only the active review mode remains visible while a request is loading;
- loading markup changes the action to `noop`, preserves
  `data-ai-review-mode`, and keeps its tooltip;
- current loading markup is native disabled but lacks `aria-busy`;
- the request state is scoped to row and language and can rerender as review
  state changes.

Integration:

- Use the standard primary loading-button renderer only if it can preserve the
  review-mode attribute and tooltip without weakening either. Otherwise retain
  this small custom renderer and add the host key locally.
- Use the original semantic action as the key:
  `review-editor-text-now:meaning` or
  `review-editor-text-now:grammar`.
- Retain `noop` during loading and add `aria-busy="true"`.
- Do not key from the visible label because the label gains an ellipsis in loading
  state.

Tests:

- extend the existing full-review loading test with the meaning key, `noop`,
  busy state, review-mode attribute, tooltip, and native disabled assertions;
- add or extend grammar-loading coverage with the distinct grammar key;
- verify the inactive mode is still hidden during a request;
- verify idle review buttons have real actions and no loading keys.

### 6. Editor row merge loading button

Files:

- `src-ui/screens/editor-row-merge-modal.js`
- add a focused `src-ui/screens/editor-row-merge-modal.test.js`

Current behavior:

- idle state offers separate “Previous” and “Next” primary buttons;
- loading state replaces both with one “Merging...” primary button;
- `mergeRowModal.status` owns loading state but does not store submitted
  direction;
- loading markup uses `noop` and native disabled, but lacks `aria-busy`;
- row flushing and write-readiness checks occur before loading state begins.

Integration:

- Use the standard primary loading-button renderer for the single loading button.
- Use the neutral semantic operation key `merge-editor-rows`; do not mislabel the
  spinner as the previous or next action when direction is not retained in modal
  state.
- Preserve the two-button idle layout and availability checks.
- Do not expand modal state solely for spinner identity. Store submitted direction
  only if a separate product requirement needs it.
- Add busy state to the loading button while leaving cancel disabled as today.

Tests:

- idle modal renders available previous/next actions and no loading key;
- loading modal renders exactly one spinner button with key
  `merge-editor-rows`, `noop`, native disabled, and busy state;
- adjacency-dependent disabled behavior is unchanged;
- error state returns to the directional controls.

### 7. Project old-layout “Discard my changes”

Files:

- `src-ui/screens/project-old-layout-discard-modal.js`
- `src-ui/screens/project-old-layout-discard-modal.test.js`

Current behavior:

- error/destructive variant;
- `projectOldLayoutDiscard.status` owns loading state;
- loading markup changes the action to `noop` and disables both confirm and
  cancel, but lacks busy state;
- operation remains scoped to the project stored in modal state.

Integration:

- Migrate to the standard error loading-button renderer.
- Use `confirm-project-old-layout-discard` as the continuity key.
- Preserve destructive styling, `noop`, native disabled, disabled cancel, label,
  and error rendering.
- Add `aria-busy="true"` in loading state.

Tests:

- add loading-state coverage for error classes, stable key, `noop`, native
  disabled, busy state, and disabled cancel;
- retain idle copy/action and closed-state tests;
- verify an error/idle rerender removes loading attributes and restores the real
  action.

### 8. Glossary and QA old-layout “Discard my changes”

Files:

- `src-ui/screens/repo-old-layout-discard-modal.js`
- `src-ui/screens/glossary-old-layout-discard-modal.js`
- `src-ui/screens/qa-list-old-layout-discard-modal.js`
- add focused renderer tests for both adapters or one parameterized shared-renderer
  test plus adapter-key assertions

Current behavior:

- shared error/destructive renderer with injected close and confirm actions;
- glossary and QA have distinct modal state and action names;
- loading uses `noop`, native disabled, and disabled cancel, but lacks busy state;
- shared resource flow owns loading/error transitions.

Integration:

- Migrate the shared renderer to the standard error loading-button renderer.
- Pass the injected `confirmAction` through as the continuity key so glossary and
  QA operations remain distinct:
  `confirm-glossary-old-layout-discard` and
  `confirm-qa-list-old-layout-discard`.
- Preserve resource-specific labels, copy, action routing, queue scopes, and
  glossary/QA parity.
- Add `aria-busy="true"` in loading state.

Tests:

- exercise idle and loading output for both glossary and QA adapters;
- assert distinct stable keys and confirm actions;
- assert destructive styling, `noop`, native disabled, busy state, disabled
  cancel, and resource-specific copy;
- verify error state restores the correct resource-specific action.

### 9. Project-conflict “Overwrite and resolve”

Files:

- `src-ui/screens/projects.js`
- `src-ui/screens/projects.test.js`
- replace or supplement the shallow source-only assertion in
  `src-ui/screens/projects-source.test.js`

Current behavior:

- error/destructive button on the projects screen rather than in a modal;
- `projectRepoConflictRecovery.status` owns loading state;
- loading button is native disabled but has no `data-action`, `aria-busy`, or
  continuity key;
- the operation may span queueing, backend overwrite, and project-list reload.

Integration:

- Use the standard error loading-button renderer if its optional class support
  preserves `project-conflict-recovery__button`.
- Use `overwrite-conflicted-project-repos` as the continuity key and `noop` as the
  loading action.
- Preserve offline/sync/write gating in idle state and existing recovery copy.
- Add `aria-busy="true"` during the entire recovery loading interval.
- Do not clear the key during intermediate status text or projects-list renders;
  state should remain loading until the existing flow completes or fails.

Tests:

- render a conflict recovery in idle state and assert action, destructive/custom
  classes, and gating;
- render the same recovery in loading state and assert stable key, spinner,
  `noop`, native disabled, busy state, and custom class;
- render an error state and assert the real action returns with the error text;
- keep the source-copy test only for copy that cannot be exercised through the
  renderer fixture.

## Cross-Cutting Verification

Add a source-level inventory test covering the known hand-authored
`button__spinner` renderers. Its purpose is to make newly introduced raw loading
buttons visible in review, not to parse arbitrary HTML with a fragile broad
regular expression. Maintain an explicit list of the permitted locations:

- the shared helper implementation;
- AI Translate custom markup;
- AI Review custom markup, if it cannot use the shared helper;
- the explicitly excluded non-button pending-save indicators in
  `translate-history-pane.js` and `translate-review-pane.js`;
- no project-import drop-zone exception after its dormant branch is removed.

The test should fail when another production renderer introduces
`button__spinner` without either using the shared helper or being added to the
reviewed custom-renderer list.

Run:

1. focused helper and renderer tests for every integration above;
2. `npm test`;
3. `npm run lint:js` plus direct ESLint coverage for changed shared files outside
   the script's `app/` and `screens/` globs;
4. `npm run build`;
5. `npm run audit:unused`, distinguishing pre-existing findings from regressions;
6. `git diff --check`.

Manual verification should cover at least:

- project transfer under frequent progress rerenders;
- one reconnect path;
- AI Translate and both AI Review modes;
- editor row merge;
- project and glossary/QA discard recovery;
- project-conflict overwrite through at least two visible progress/status renders.

For each, confirm the spinner rotates continuously, the button cannot dispatch a
second operation, its visual variant and layout do not change, and completion or
failure starts the next operation with a fresh spinner phase.

## Recommended Implementation Order

1. Add and test the standard multi-variant loading-button foundation while
   retaining `loadingPrimaryButton`.
2. Migrate the connection-failure, project discard, shared glossary/QA discard,
   merge, and conflict-overwrite standard text buttons.
3. Integrate the offline banner while preserving its distinct action/disabled
   semantics.
4. Add stable keys to the custom AI Translate and AI Review buttons.
5. Remove the unreachable project-import drop-zone spinner branch.
6. Add the explicit raw-spinner inventory test.
7. Run focused, full, build, audit, and manual verification.
