# Progress bar on the redundancy checks page

1. Extend the existing request-scoped native progress event with the total number of footnote comparison batches and the number successfully completed. Keep the initial inventory and word-frequency stages indeterminate.
2. Show the approved amber bar between the export dialog header and its scrolling results. Update it in place, preserve image review controls, and freeze the last known position after an interruption. Hide the entire progress row as soon as results are ready, including cached results. Start retries with fresh progress.
3. Exercise native batch reporting, the frontend event lifecycle, and the export dialog in the browser. Check that progress and completion preserve the current review choices, focus, and scroll position.

## Verification

The frontend and native app built successfully. All 3,559 frontend tests, 26 workflow tests, and 1,153 native library tests passed. The native suite skipped 15 opt-in tests.

All 44 Chromium export workflows and all five WebKit redundancy workflows passed. The browser checks cover initial activity, measured batches, reduced motion, interruption, retry, and hiding the row on completion. They also exercise scrolling and image selection while the checks are running. The unused-code audit reported findings outside the changed modules.
