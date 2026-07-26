# Modal Keyboard Interaction Plan

**Status:** implemented (2026-07-26)

## Implementation Result

- Added shared delegated controllers for modal focus/default/cancel behavior and
  structured-choice keyboard navigation.
- Migrated interactive modal renderers to explicit dialog, default, cancel, and
  initial-focus declarations, including deliberate omissions for unsafe actions.
- Preserved control-local `Enter` behavior for multiline editors, native controls,
  composite widgets, and the WordPress search field.
- Integrated focus capture and reconciliation with both full-app and scoped modal
  rerenders.
- Added browser coverage for control-local Enter behavior, disabled defaults, focus
  trapping, structured choices, focus/selection preservation, and opener focus
  restoration.
- Follow-up review fixes centrally seed an unselected roving group with a keyboard
  tab stop, make document-method radiogroups select as arrow focus moves, and keep
  page-level shortcuts from acting behind an open dialog.
- Verified with `npm test`, `npm run lint:js`, and the complete
  `npm run test:browser` suite (124 passed, 1 benchmark skipped).

## Objective

Make interactive modal dialogs behave like coherent desktop dialogs:

- `Enter` activates the dialog's explicitly declared, enabled default action.
- `Escape` activates the explicitly declared cancel/close action when dismissal is
  allowed.
- `Tab` and `Shift+Tab` stay inside the topmost dialog.
- Focus moves into a newly opened dialog, survives DOM replacement while the dialog
  remains open, and returns to the control that opened it when the dialog closes.
- Arrow keys navigate only structured choice widgets such as segmented controls,
  radio-like groups, and language lists. They do not cycle through ordinary footer
  buttons.

The orange primary style and default keyboard behavior must agree, but color alone
must never determine behavior. Each modal state explicitly declares its semantics.

## Current State and Constraints

- More than 50 modal renderers emit similar `.modal-backdrop` / `.modal-card`
  structures, but only a few currently include `role="dialog"`, `aria-modal`, an
  accessible title relationship, or `autofocus`.
- `events/keyboard-shortcuts.js` contains a few modal-specific shortcuts (insert-link
  URL submission and glossary-term `Shift+Enter`), but there is no shared dialog
  interaction model.
- Native `<button>` elements already respond to `Enter` and `Space` while focused.
  The missing behavior is dialog-level default activation when focus is on a
  single-line field or the dialog itself.
- Full renders in `main.js` replace `app.innerHTML`. Three editor modal scopes
  (`AI Translate All`, `Derive Glossaries`, and `Insert Link`) can also replace only
  their own backdrop. A focus design must cover both paths without repeatedly
  stealing focus on progress or validation renders.
- `focused-input-state.js` restores a known field across full renders. The modal
  lifecycle must cooperate with it rather than introducing a second competing focus
  restorer.
- The shared listbox control already implements appropriate arrows, Home/End,
  Enter/Space, and Escape. Large language pickers and segmented controls do not yet
  share that behavior.
- Loading and status overlays use the same visual modal shell in places, but are not
  necessarily dismissible interactive dialogs.

## Design Principles

1. **Explicit semantics, centralized mechanics.** Renderers declare which element is
   the default, cancel, and initial-focus target. One controller implements keyboard
   and focus behavior.
2. **The topmost dialog owns modality.** When more than one dialog-like surface is
   present, only the last visible interactive dialog receives keyboard handling and
   traps focus.
3. **State determines safety.** A default marker may remain on a disabled control;
   the controller must never activate disabled, `aria-disabled`, busy, hidden, or
   disconnected controls.
4. **No CSS inference.** `.button--primary` remains a visual style. It does not
   automatically become the keyboard default because some primary actions are
   unavailable, transitional, or intentionally non-default.
5. **No modal-specific global key branches.** Ordinary `Enter`, `Escape`, and focus
   behavior belongs in the shared controller. Only genuinely special interactions,
   such as glossary-term `Shift+Enter`, remain in domain-specific code.
6. **Render replacement is a first-class lifecycle.** Opening, replacing, and closing
   a dialog are distinct events. Replacing an already-open dialog must preserve the
   active control rather than rerunning initial focus.
7. **Footer arrows are out of scope.** Arrow navigation is added only where the
   widget's semantics support it; `Tab` remains the way to move between Cancel and
   Confirm.

## Declarative Markup Contract

Add small attribute helpers rather than a monolithic modal HTML builder, because
existing dialogs have substantially different bodies and layouts.

An interactive dialog will have this shape:

```html
<section
  class="card modal-card ..."
  role="dialog"
  aria-modal="true"
  aria-labelledby="project-create-title"
  data-modal-dialog="project-create"
>
  <h2 id="project-create-title">Create A New Project</h2>
  <input data-modal-initial-focus />
  <button data-modal-cancel>Cancel</button>
  <button data-modal-default>Create Project</button>
</section>
```

Contract rules:

- `data-modal-dialog` has a stable, nonempty identifier for the logical dialog,
  including multi-step state where focus should be reinitialized when the step truly
  changes (for example `project-import:input` versus
  `project-import:language`).
- Every interactive dialog has `role="dialog"`, `aria-modal="true"`, and a unique
  `aria-labelledby` target. Add `aria-describedby` when a concise supporting
  description is useful; do not point it at a large interactive body.
- At most one enabled candidate is marked `data-modal-default`.
- At most one control is marked `data-modal-cancel`. Omit it for progress, forced
  update, migration, or other states that cannot safely close.
- `data-modal-initial-focus` is optional. Use it for the first editable field or the
  selected item in a choice dialog. Without it, the controller uses its documented
  fallback.
- Add `tabindex="-1"` to the dialog card so it can receive fallback focus when it has
  no enabled controls.
- Add `data-modal-enter-ignores-default` only to exceptional custom controls whose
  own `Enter` behavior cannot be identified from native semantics.

Extend the shared button helpers in `src-ui/lib/ui.js` with narrowly named options:

- `modalDefault`
- `modalCancel`
- `modalInitialFocus`

A small private attribute renderer keeps these options consistent across
`primaryButton`, `secondaryButton`, `errorButton`, and `loadingButton`. Hand-authored
buttons use the same data attributes directly. Loading variants preserve semantic
markers if useful for stable markup but remain disabled and therefore inert.

Do not make `primaryButton()` globally default: it is also used outside dialogs and
some dialogs contain more than one primary-looking operation.

## Shared Interaction Controller

Create `src-ui/app/events/modal-dialog.js` and register it once from
`registerAppEvents`.

The module owns:

- resolving the topmost visible `[data-modal-dialog]`;
- finding enabled, visible, tabbable descendants;
- validating default and cancel candidates;
- `Enter`, `Escape`, `Tab`, and `Shift+Tab` handling;
- focus entry, preservation, and restoration across render boundaries;
- pure exported predicates/helpers where practical so edge cases can be unit tested
  without duplicating the event logic.

### Event Ordering

Register the modal controller after existing keyboard shortcut, listbox, and
structured-choice handlers. It exits immediately when `event.defaultPrevented` is
true. This lets an open listbox consume `Escape`, arrow keys, or `Enter` before the
containing dialog sees the event.

The controller acts only when the event target belongs to the topmost dialog, except
for `Tab`: if focus has escaped due to a render or native webview behavior, `Tab`
redirects it into the topmost dialog.

### Enter

Activate the marked default with the button's native `.click()` so the existing
delegated action dispatcher remains the single action path.

Handle only unmodified `Enter` when:

- the event is not repeated, composing, or already prevented;
- the target is the dialog/card or a single-line text-like input;
- the target is not a textarea, contenteditable element, select, link, native button,
  listbox/choice option, or an element under
  `[data-modal-enter-ignores-default]`;
- no child popover/composite widget currently owns the keystroke;
- the default control is visible, connected, enabled, not `aria-disabled`, not busy,
  and does not dispatch `noop`.

Prevent the original event before clicking to avoid native form submission or a
second activation. Do not introduce implicit form submission in the first rollout;
the existing delegated `data-action` path remains authoritative.

Focused native buttons retain their browser behavior: `Enter` and `Space` activate
that specific button, not the dialog default.

### Escape

On unmodified, non-composing, non-repeated `Escape`, click the marked cancel control
only when it is enabled. If no cancel control is declared, do nothing.

Consequences:

- Loading states can disable their Cancel button and automatically become
  non-dismissible.
- Forced/blocking dialogs omit the marker.
- Escape never guesses from button text, backdrop presence, or action-name prefixes.
- Backdrop-click dismissal remains unchanged and is not added as part of this work.

### Focus Trap

For `Tab` and `Shift+Tab`:

- compute the current enabled/visible tabbable controls on each keypress so dynamic
  states are respected;
- wrap last-to-first and first-to-last;
- if there are no tabbable controls, focus the dialog card;
- ignore elements that are disabled, hidden, inert, or inside hidden subtrees.

Do not install sentinel elements or modify application state. The controller owns
only DOM focus.

## Focus Lifecycle and Render Integration

Expose a small lifecycle API from the modal controller:

```js
const modalSnapshot = captureModalRenderState(app);
// existing full or scoped DOM replacement
reconcileModalRenderState(app, modalSnapshot);
```

The snapshot records:

- active dialog ID, if any;
- a stable locator and selection state for the focused element inside that dialog;
- a stable locator for the element focused outside the dialog before opening;
- the controller's existing opener record for the active dialog.

Use locators based on explicit data attributes, `data-action`, and other stable
identifiers—not DOM indexes or button labels. Reuse the selection capture/restore
ideas in `focused-input-state.js`; extract a small shared focus-locator helper if doing
so prevents duplicate selector/selection code.

Reconciliation rules:

1. **No dialog → dialog:** record the opener, then focus
   `[data-modal-initial-focus]`; otherwise focus the first enabled editable control,
   selected choice, default control, cancel control, first tabbable control, or the
   card, in that order.
2. **Same dialog ID → same dialog ID:** restore the previously focused control and
   selection. If it no longer exists or became disabled, use the initial-focus
   fallback without returning to the opener.
3. **Dialog ID A → dialog ID B:** treat B as a new logical dialog step and initialize
   its focus, while preserving the original outside opener for eventual close.
4. **Dialog → no dialog:** restore the opener if its locator resolves to an enabled
   connected element. Otherwise, leave focus on the screen's existing restoration
   path; never force focus to `body`.

Integrate this pair around:

- the full `app.innerHTML` replacement in `renderWithOptions`;
- each modal-only replacement function in `main.js`;
- any additional scoped renderer discovered during implementation that can add,
  replace, or remove an interactive dialog.

Order full-render reconciliation after `restoreFocusedInputState()` so the modal
controller makes the final decision only when a modal transition occurred. For an
unchanged modal, preserve the already-restored valid field instead of focusing it a
second time.

Avoid `autofocus` in migrated renderers. It can re-steal focus whenever `innerHTML`
recreates a still-open modal; the lifecycle controller replaces it.

## Structured Choice Navigation

Keep `events/listbox-control.js` as the owner of the existing shared listbox.

Add `src-ui/app/events/roving-choice.js` for choice groups that are rendered as
buttons rather than through `renderListboxControl`. Its contract should be
declarative and usable outside modals:

- `data-roving-choice-group`
- `data-roving-choice-axis="horizontal|vertical|both"`
- `data-roving-choice-option`
- semantic state through `role="radio"` / `aria-checked`, or
  `role="option"` / `aria-selected`, as appropriate;
- one selected option at `tabindex="0"` and other enabled options at
  `tabindex="-1"`.

Behavior:

- horizontal groups use Left/Right; vertical lists use Up/Down; `both` may use all
  four;
- Home/End move to first/last enabled option;
- navigation wraps and skips disabled options;
- focus movement does not automatically invoke an action unless the group explicitly
  opts into selection-follows-focus;
- Enter/Space invokes the focused option through its native click;
- nested listbox handling wins through `defaultPrevented`.

Adopt it for:

- project import/add-translation input-mode segmented controls;
- modal language-picker lists;
- other modal radio-like button groups found in the renderer audit.

Do not attach it to `.modal__actions`. Existing editor/header segmented controls may
adopt the helper in a separate parity pass if they use the same semantics, but they
are not required to ship modal keyboard support.

## Dialog Safety Classification

Audit every interactive modal state and record it in a test fixture or table during
implementation. Classify each state before annotating it:

| Class | Default behavior | Escape behavior | Initial focus |
|---|---|---|---|
| Create/rename/simple form | Submit when enabled | Cancel | First field |
| Typed-name destructive confirmation | Destructive action only after exact-match gate enables it | Cancel while idle | Confirmation field |
| Ungated consequential confirmation | Explicit product decision; use Cancel/no default if accidental activation would be costly | Cancel | Cancel or explanatory card |
| Informational one-action dialog | Dismiss/continue action | Same action only if dismissal is safe | Action |
| Multi-step choice/configuration | Current step's Continue/Save when valid | Current step's Cancel/Back when allowed | Selected choice or first field |
| Loading/progress/forced action | No default | None unless an enabled Cancel/Stop is intentionally supported | Cancel/Stop, otherwise card |

Specific rules:

- Existing orange actions intended as the default should receive
  `data-modal-default`; if a consequential action should not respond to `Enter`,
  revise its visual/default treatment rather than silently contradicting the orange
  cue.
- Typed-name delete dialogs may keep Delete as the default because it is disabled
  until the confirmation matches. Pressing Enter before that point does nothing.
- A `Stop` action during AI work is not automatically a cancel action; mark it only
  when Escape-to-stop is an intentional product decision.
- Update-installing, navigation-loading, image-caption-translation, and similar
  status surfaces are not interactive dialogs unless they expose a real control.
  Use `role="status"`/`aria-live`/`aria-busy` as appropriate and exclude them from
  the modal controller.
- Apply identical classifications to glossary and QA-list counterparts to preserve
  required parity.

## Accessibility and Visual Treatment

- Add a shared `:focus-visible` ring for `.button`, segmented-control buttons,
  language options, and other migrated custom controls. Use an outline/ring distinct
  from the persistent orange default styling so keyboard focus and default action are
  not conflated.
- Do not remove native outlines unless the shared replacement is present.
- Ensure disabled controls use both native `disabled` and existing visual disabled
  treatment where applicable.
- Keep title IDs unique when multiple renderer strings are present in one screen
  output.
- Use `aria-busy` for progress states and avoid announcing every DOM replacement as
  a newly opened dialog.
- Background page content should not be reachable through Tab while an interactive
  modal is open. Native `inert` on the non-modal screen subtree may be considered
  only if it can be applied without hiding sibling global status surfaces; the focus
  trap is the required baseline.

## Implementation Sequence

### 1. Build and test the shared contract

- Add modal attribute rendering support to `lib/ui.js`.
- Add `events/modal-dialog.js` with candidate validation, key handling, focus
  traversal, and lifecycle capture/reconciliation.
- Register it from `events.js` in the required event order.
- Add the render lifecycle calls in `main.js`.
- Add shared focus-visible styles.

At this stage, behavior is dormant for unannotated dialogs.

### 2. Pilot representative dialogs

Migrate one dialog from each important category:

- project creation (single-line form);
- project permanent deletion (gated destructive form);
- editor row insertion (multiple explicit choices);
- editor insert-link (existing bespoke Enter/Escape behavior and scoped rendering);
- a non-dismissible progress/status surface.

Verify the abstraction before touching the full modal inventory. Remove the
insert-link-specific unmodified Enter/Escape branch only after shared behavior has
equivalent coverage. Retain glossary-term `Shift+Enter` as an explicit specialized
shortcut.

### 3. Migrate the complete modal inventory

- Annotate global overlays mounted by `main.js`.
- Annotate projects, teams, glossary, QA, editor, AI settings, and member-management
  dialogs.
- Handle every state of multi-step renderers such as project import, add translation,
  editor export, AI review/translation, setup, and update flows.
- Convert dialog titles to stable IDs and remove migrated `autofocus`.
- Apply glossary/QA parity in the same change set.
- Record intentional no-default/no-cancel states so omissions are reviewable rather
  than accidental.

### 4. Add structured choice keyboard behavior

- Implement and register `roving-choice.js`.
- Correct semantics and roving tabindex for modal segmented controls and large
  language lists.
- Confirm that listbox popovers still consume their own keys before the dialog.
- Leave ordinary action rows on Tab navigation.

### 5. Remove duplication and document the convention

- Delete modal-specific Enter/Escape branches that are now exactly represented by
  the shared contract.
- Keep specialized modified-key shortcuts and domain editing behavior.
- Add a concise "Modal dialogs" section to `src-ui/AGENTS.md` describing required
  attributes, default/cancel safety, focus lifecycle ownership, and the prohibition
  on ad hoc global handlers.

## Verification

### Unit and source tests

Add focused tests for:

- topmost-dialog resolution;
- enabled/visible/default/cancel candidate validation;
- Enter acceptance and every rejection condition (textarea, contenteditable,
  button, select, modifier, repeat, composition, prevented event, disabled/busy/noop
  default);
- Escape with enabled, disabled, and absent cancel controls;
- forward and reverse Tab wrapping, disabled/hidden skipping, and no-control fallback;
- open, same-ID replacement, step transition, close, missing-opener, and selection
  restoration lifecycle cases;
- arrow wrapping, axis restrictions, Home/End, disabled skipping, manual activation,
  and selection-follows-focus opt-in;
- UI helpers emitting modal attributes without changing non-modal button markup;
- every migrated interactive modal state having a stable dialog ID, labelled title,
  no duplicate default/cancel markers, and an intentional safety classification.

Prefer behavioral tests over broad source-regex tests. Source tests are acceptable
only for guarding declarative renderer contracts that are otherwise expensive to
instantiate.

### Browser integration

Add a small modal keyboard fixture or extend an existing app fixture to prove in a
real DOM:

1. Open a form dialog from a button; focus lands in its field.
2. Enter submits once when valid and does nothing when the default is disabled.
3. Enter in a textarea inserts/retains a newline and does not submit.
4. Enter/Space on focused Cancel activates Cancel, not the default.
5. Escape closes an idle dismissible dialog and does nothing in a blocking state.
6. Tab and Shift+Tab cannot leave the topmost dialog.
7. A validation/progress rerender preserves the focused field and selection.
8. Closing restores focus to the opening control after a full render.
9. A scoped editor-modal replacement follows the same lifecycle.
10. An open listbox consumes Escape before the dialog closes.
11. Arrow keys navigate a structured choice group but do not move between footer
    buttons.
12. Only the topmost of two deliberately stacked fixture dialogs responds.

### Commands and manual checks

- `npm test`
- `npm run test:browser`
- `npm run audit:unused`
- Manually verify keyboard behavior in the Tauri app on macOS and Windows, including
  Return versus numpad Enter, IME composition, visible focus rings, and focus
  restoration after dialogs opened from virtualized/editor content.

## Acceptance Criteria

- Every interactive modal state has explicit dialog, default, cancel, and focus
  semantics; intentional omissions are documented by classification.
- Return activates exactly one enabled declared default from eligible contexts and
  never submits from multiline/custom editing contexts.
- Escape closes only dialogs that explicitly permit it.
- Focus never tabs into the background, is not stolen on a same-dialog rerender, and
  returns to the opener when possible.
- Loading, busy, disabled, and `noop` controls cannot be keyboard-activated.
- Arrow keys work for declared structured choices and never cycle through ordinary
  modal footer buttons.
- Existing action dispatch, loading-button behavior, editor selection restoration,
  listbox behavior, glossary/QA parity, and background rendering remain intact.
- The implementation introduces one shared modal interaction controller and one
  reusable structured-choice controller, with no per-modal document-level keydown
  handlers.

## Out of Scope

- Changing which business operations require confirmation.
- Adding backdrop-click dismissal.
- Redesigning modal copy or visual layout beyond focus-visible treatment and any
  default-style correction required for semantic honesty.
- Adding arrow navigation to ordinary buttons or all segmented controls throughout
  the app.
- Replacing the delegated `data-action` dispatcher with native form submission.
- Reworking non-modal menus, editor text-navigation shortcuts, or global application
  shortcuts.
