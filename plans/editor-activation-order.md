# Keep the latest row selection during delayed activation

## Plan

1. Give each field activation a monotonically increasing request number before loading the row; reject older completions before they change selection or editing state.
2. Add browser regression cases for delayed whitespace and text activation followed by a newer whitespace selection.
3. Run the regressions, adjacent selection/focus checks, and app/workflow checks.

## Validation

- Implemented request sequencing before the row-load await. Older activations can still refresh row data but cannot change selection, reopen editing, or replace sidebar context after a newer activation.
- Four browser regressions pass: delayed whitespace/text activation followed by selecting another row or reselecting the current row.
- Five adjacent browser checks pass: card whitespace selection and language pills in simulated macOS/Windows UI modes, plus the existing delayed-activation focus/footnote case.
- All 2,180 app tests and 23 workflow tests pass. ESLint and whitespace checks pass; the unused-code audit is unchanged from the preceding work.
