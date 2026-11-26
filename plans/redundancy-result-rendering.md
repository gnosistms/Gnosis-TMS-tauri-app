# Footnote results in the book redundancy check

1. Trace the native batch notifications through the mounted export dialog. Check whether an incoming batch builds or replaces the results list before the final report.
2. Update the progress bar in place and keep the footnote section stable until completion or interruption. Preserve the separate image checkpoint, review choices, and scroll position during project refreshes.
3. Exercise a run with cached findings, multiple comparison batches, and new final findings in the browser. Verify that completion publishes the footnote list once and that failure, retry, and navigation still work.

## Verification

Five batch events with eight image thumbnails triggered 80 thumbnail resolutions before the change and zero afterward. The initial footnote section stayed mounted through the last batch and a background refresh. The terminal report replaced it once. The image checkbox retained its value and focus, and the scroll position held.

All 44 Chromium project export workflows and all five WebKit redundancy workflows passed on a fresh dev server. The frontend build, 3,560 frontend tests, 26 workflow tests, and lint on the affected modules passed. The unused-code audit reported findings outside the affected modules.
