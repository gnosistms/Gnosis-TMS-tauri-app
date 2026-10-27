# Select translations from card whitespace

## Plan

1. Route primary clicks on translation-card whitespace through existing `setActiveEditorField` without opening an editor.
2. Resolve language by the rendered section dividers across the entire card, including outer padding and gaps. Preserve layout and existing control/text behavior.
3. Verify edge and divider clicks, selection indicators, sidebar context, language collapse, and switching away from an edited field in macOS/Windows browser UI modes; run app/workflow and existing editor regression checks.

## Validation

- Implemented whitespace selection through the existing activation flow, using rendered section borders to include all outer padding and inter-section gaps without layout changes.
- Browser tests pass in macOS and Windows UI modes (simulated in Chrome): one-pixel edge/divider checks, language collapse/reordering, selection indicators, History selection, text editing, and draft preservation when selecting another row.
- Four adjacent browser checks pass for persistent language pills, empty sidebar tabs, and image-upload dismissal.
- All 2,180 app tests and 23 workflow tests pass. ESLint has no errors; its existing unused `activeEditorControlRowId` warning remains. The unused-code audit matches the previous run exactly. Git whitespace checks pass.
