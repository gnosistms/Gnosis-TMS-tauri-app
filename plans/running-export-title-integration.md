# Enable merged chapter-title editing in the running checkout

The development server on port 1431 runs this original checkout. PR 384 and its
merged PR 382 title editing code live in the isolated integration checkout, so
the running UI still has the older chapter buttons.

1. Compare the running book-export files with the validated integration versions.
2. Apply only the title-editing changes and accompanying book-export tests to
   this checkout, preserving unrelated unfinished work and its existing branch.
3. Verify the running frontend supports inline chapter titles, numbering, H1
   contents, and persisted per-language overrides. Check native export handling.

PR 384 already contains these changes; do not create a duplicate PR.

## Completed

Applied all merged export code to the original development checkout, including
PR 382 title editing and native title overrides. The PR 383 changes already
present locally were retained, and its audit configuration was applied. The
attribution prompt now uses the merged copy while retaining the additional local
focus behavior. Existing research studio, glossary-entry, and comment changes
remain in the development checkout.

Validation: 3,126 frontend tests and 25 workflow tests pass. Four browser checks
against the actual development server cover title editing, per-language
persistence, H1 contents, paragraph editing, and background redraw stability.
Export source files match the validated integration branch.

Stopped the old development supervisor and launched a new session using
`node scripts/launch-dev-session.mjs`. Tauri successfully launched the native
development binary and Vite on port 1431. The live server supplies the editable
chapter-title controls and integrated preview.
