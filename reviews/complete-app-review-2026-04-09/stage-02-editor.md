# Stage 2 Review: Editor UI, History, Virtualization, and Editor Persistence

## Findings

### P1. The editor can choose the wrong default source language when chapter selections have not been persisted yet

- `buildEditorScreenViewModel()` resolves the source language in [editor-screen-model.js:16](/Users/hans/Desktop/GnosisTMS/src-ui/app/editor-screen-model.js#L16) through [editor-screen-model.js:30](/Users/hans/Desktop/GnosisTMS/src-ui/app/editor-screen-model.js#L30).
- The fallback order is currently `selectedSourceLanguageCode -> chapter.selectedSourceLanguageCode -> languages[0] -> first role="source"`.
- That means an uninitialized chapter will default to whatever language happens to appear first in the array, even when a different language is explicitly marked with `role === "source"`.

Impact:
- The Source dropdown can show the wrong language on first open.
- Downstream UI that depends on source/target selection can start from the wrong assumption until the user manually corrects it or the selection is later persisted.

Recommendation:
- In `resolveSelectedLanguageCodes()`, prefer the role-based source language before the array-order fallback.

### P2. The virtualizer updates spacer heights after measuring real rows, but it does not rerender the row window when those measurements change which rows should be mounted

- The initial visible range is computed from cached/estimated heights in [editor-virtualization.js:138](/Users/hans/Desktop/GnosisTMS/src-ui/app/editor-virtualization.js#L138) through [editor-virtualization.js:176](/Users/hans/Desktop/GnosisTMS/src-ui/app/editor-virtualization.js#L176).
- After rendering, the code measures actual row heights in [editor-virtualization.js:180](/Users/hans/Desktop/GnosisTMS/src-ui/app/editor-virtualization.js#L180) through [editor-virtualization.js:196](/Users/hans/Desktop/GnosisTMS/src-ui/app/editor-virtualization.js#L196).
- If those real measurements imply a different `startIndex:endIndex` window, the code only updates spacer heights; it never rerenders `itemsContainer` with the corrected range.

Impact:
- On first render, after font-size changes, or after height-heavy content changes, the virtualized list can momentarily mount the wrong rows for the viewport.
- In the worst case, users can see missing/incorrect rows until the next scroll or resize event triggers another render pass.

Recommendation:
- After height measurement, recompute the window and rerender the item range if the measured range key differs from the one that was just rendered.

## Residual Risk

- The editor-history reducer in [editor-history.js](/Users/hans/Desktop/GnosisTMS/src-ui/app/editor-history.js) is much clearer than the old inline version, but it still has no table-driven tests. That reducer now owns author grouping, import labeling, marker-run compression, and current-entry matching; it is exactly the kind of logic that will regress quietly without explicit fixtures.
