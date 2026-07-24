# Jump from editor to glossary term editing

Double-click an underlined glossary term in the translate editor to open that term
in the glossary term editor modal.

## Decisions (settled 2026-07-23)

- **Gesture:** double-click on the underlined term. Single click keeps its current
  behavior (focus the field with precise caret placement) with no added delay.
- **Hint:** a "Double click to edit" line at the bottom of the glossary hover card,
  in hint-style muted font, shown only to users who can manage glossary terms.
- **Duplicate matches:** two terms sharing one normalized match term should not
  exist (the term editor warns about redundant source terms). If it happens anyway,
  open the first contributing term — the one whose information leads on the hover
  card.
- **Derived AI underlines:** no term id, no hint, no gesture. Only underlines from
  the linked glossary are editable this way.
- **QA parity:** QA lists produce no editor underlines today, so there is nothing
  to mirror. The term-id threading pattern is kept generic so QA highlighting could
  reuse it later.

## Verified current behavior

- Underlines are `<mark data-editor-glossary-mark>` elements emitted by
  `buildHighlightMarkup` (`src-ui/app/editor-glossary-highlighting.js`) with
  `data-text-start`/`data-text-end` and tooltip payload attributes. They carry no
  term identity.
- Marks appear in two places: inside `[data-editor-display-text]` of the
  display-field button, and in the glossary highlight layer of a field stack with a
  live textarea. Marks are suppressed while a row is being edited
  (`suppressGlossaryWhileEditing` in `src-ui/app/editor-glossary-flow.js`).
- Single click flips the row into edit mode: pointerdown on the display-field
  button calls `setActiveEditorField(..., { openEditor: true })`
  (`src-ui/app/translate-editor-dom-events.js:346`); the document mousedown path
  runs `focusEditorFieldFromGlossaryMark` (`src-ui/app/events.js:84`). Either way
  the mark element is removed from the DOM before a second click arrives.
- Double-click-to-edit precedent: preview blocks show the notice
  "Double click to edit this text" on `event.detail === 1` and act in a `dblclick`
  handler (`src-ui/app/translate-editor-dom-events.js:341` and `:499`).
- The jump destination exists end to end: the `open-editor-glossary` action
  (`src-ui/app/actions/navigation-actions.js:117`) calls
  `openGlossaryEditor(render, id, { navigationSource: "editor", preferredGlossary })`,
  which gives the glossary screen a back button labeled with the chapter name
  (`src-ui/screens/glossary-editor.js:41`). `openGlossaryTermEditor(render, termId)`
  (`src-ui/app/glossary-term-draft.js:373`) opens the modal once
  `state.glossaryEditor.terms` is loaded. Navigating back to the chapter re-runs
  the chapter load, which reloads editor glossary state and refreshes underlines
  (`src-ui/app/navigation.js:340` → `loadSelectedChapterEditorData` →
  `loadEditorGlossaryState`).
- Hover card: `src-ui/app/events/glossary-tooltip.js`
  (`renderStructuredGlossaryTooltipBody`); styles under
  `.editor-glossary-info-card__*` in `src-ui/styles/base.css:857`.

## Step 1 — thread term ids into marks

In `src-ui/app/editor-glossary-highlighting.js`:

- `buildEditorGlossaryModel`: include `termId: term.termId` on the source and
  target entries.
- `buildLanguageGlossaryMatcher`: give each candidate an ordered-unique `termIds`
  list; the merge branch appends incoming ids the same way other ordered fields
  merge.
- `buildRowTargetMatcher`: carry `termIds` from the matched source candidate into
  the synthesized target entries so target-language underlines link back too.
- `buildEditorDerivedGlossaryModel`: deliberately do not set term ids.
- `buildHighlightMarkup`: when the candidate has term ids, emit
  `data-editor-glossary-term-id="<termIds[0]>"` on the mark.

Tests: extend the highlighting unit tests — term id present on source and target
marks, first-id-wins on merged candidates, absent for derived-model marks.

## Step 2 — double-click detection (as implemented)

New logic in `src-ui/app/events/glossary-tooltip.js`
(`handleGlossaryMarkDoubleClick`), called from the document **pointerdown**
handler in `src-ui/app/events.js`. Two findings from live verification forced
changes to the original mousedown/rectangle design:

- **Mousedown never fires for marks inside display fields.** The display-field
  pointerdown handler in `translate-editor-dom-events.js` calls `preventDefault()`,
  which suppresses the derived mouse events. Detection therefore runs on
  pointerdown, which always fires and still bubbles to the document.
- **The mark is already detached when the first click is recorded.** The
  display-field handler flips the row into edit mode synchronously, so by the time
  the document-level handler runs, `getBoundingClientRect()` on the mark returns a
  zero rectangle. The record therefore stores the first click's coordinates, and
  the second click matches when it lands within a small slop distance (8 px) of
  the first — the standard double-click approach, immune to detachment and layout
  shift.

Flow:

- On pointerdown over a mark with `data-editor-glossary-term-id`: record
  `{ termId, clientX, clientY, time }`, then let the normal focus behavior proceed.
- On the next pointerdown within 500 ms and within the slop distance (or with
  `event.detail >= 2` where the webview provides it — not reliable on pointerdown):
  - if the target is still a mark with a term id, jump with that id;
  - otherwise jump with the recorded id (the normal case — the row flipped and the
    second click landed on the textarea).
- Before jumping: check `canManageGlossaries()` — without permission the second
  click keeps its native behavior. On jump: `event.preventDefault()` (suppresses
  word selection in the textarea), hide the tooltip, dispatch the action from
  Step 3.
- Accepted behavior: the row briefly enters edit mode between the two clicks.
  Focus alone does not modify the row, and navigation runs the usual dirty-row
  flush, so nothing is lost.

## Step 2b — carry the term id through the display-text renderer

Found during verification: `renderSanitizedInlineMarkupWithEditorHighlightState`
and `renderSanitizedInlineMarkupWithGlossaryHighlightHtml`
(`src-ui/app/editor-inline-markup/highlights.js`) re-parse the glossary highlight
HTML into ranges and re-emit the marks with a fixed attribute list, which silently
dropped the new attribute. `parseGlossaryHighlightRanges` now also reads
`data-editor-glossary-term-id` and `renderGlossaryMark` re-emits it.

## Step 3 — jump action

In `src-ui/app/actions/navigation-actions.js`, a suffix action
`open-editor-glossary-term:{termId}` mirroring `open-editor-glossary`:

- Guard on `resolveSelectedChapterGlossary()` exactly as the existing action does.
- **Close the field editor the first click opened** (found in field testing): the
  chapter reload on return preserves `mainFieldEditor`, so without this the
  double-clicked field came back from the glossary still in open-editor mode —
  which suppresses its glossary underline and, unfocused, is nearly
  indistinguishable from a static field. The action calls
  `collapseEditorMainField` before navigating, and `setActiveEditorField` gained
  a guard so an activation still in flight cannot reopen the editor after the
  screen has switched.
- `await openGlossaryEditor(render, id, { navigationSource: "editor", preferredGlossary })`.
- If the screen is still `glossaryEditor`, status is `ready`, and
  `findGlossaryTermById(termId, state.glossaryEditor)` finds the term, call
  `openGlossaryTermEditor(render, termId)`.
- Otherwise show a notice badge ("This term is no longer in the glossary.").
  `openGlossaryTermEditor` re-checks permission and write policy itself, so its
  notices remain the safety net.

## Step 4 — hint line in the hover card

- `renderStructuredGlossaryTooltipBody` appends
  `<p class="editor-glossary-info-card__hint">Double click to edit</p>` when the
  hovered mark carries `data-editor-glossary-term-id` AND
  `canManageGlossaries(selectedTeam())` is true. The permission check runs at
  tooltip render time, not at highlight build time, so capability changes apply
  without invalidating the highlight cache.
- Wording follows the existing preview notice ("Double click to edit this text"),
  shortened to "Double click to edit".
- CSS in `src-ui/styles/base.css` next to the other info-card styles, following
  the existing muted hint conventions (compare `__origin`: color
  `rgba(74, 45, 19, 0.64)`, small size, weight 500, top margin separating it from
  the content above).

## Testing

- Unit: term id threading (Step 1 cases).
- DOM/source tests for the tooltip hint following the existing glossary-tooltip
  test patterns: hint shown with permission + term id, hidden without permission,
  hidden on derived marks.
- Manual, both macOS and Windows (double-click cadence follows the system
  double-click speed, and Windows behavior must be checked per repo rules):
  - double-click on a source-language underline and a target-language underline;
  - marks inside the display button and marks in the overlay layer;
  - viewer/translator without glossary-manage rights sees no hint and no jump;
  - derived AI underline shows no hint;
  - term deleted remotely → notice badge, no modal;
  - back button returns to the chapter with scroll preserved and the edited term's
    new data visible in underline and hover card.

## Out of scope

- QA list parity (no QA underlines exist in the editor).
- Opening the term modal in place over the translate screen (the modal flow in
  `glossary-term-draft.js` is written against the glossary screen state; a later
  refactor could decouple it).
- Anchoring the hover card / making it clickable.
