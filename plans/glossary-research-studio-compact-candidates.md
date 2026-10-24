# Compact step6 candidate review

Keep the acceptance study paused. Default step6 to meanings with compact lists of
translation checkboxes. Put usage notes, target spelling edits, preference controls
and inflection/add controls behind a per-meaning disclosure. Keep entry-wide
preference/general note/footnote in a separate collapsed disclosure. Reuse existing
scoped disclosure preservation so selections and open editors survive renders.

Preserve per-meaning checkbox applicability and shared notes/preference behavior.
Show each candidate once in the compact list; editing its text must refresh that
visible label without stealing focus. Verify collapsed/expanded visibility,
checkbox independence, edits and preference rerenders in browser fixtures; run
relevant unit tests, build/lint and full Studio browser regression. No paid AI calls.

Implemented default-collapsed per-meaning editors with translation checkboxes kept
visible in compact lists. Entry-wide notes, footnote and preference are collapsed
separately. Existing disclosure keys preserve open/closed choices across checkbox,
inflection and preference renders. Text edits update the compact labels and any
same-candidate editor fields in place without stealing focus. Per-meaning choices
and same-spelling shared-note behavior remain covered by browser regressions.

Validation:47focused tests,2,441app tests,37Studio browser tests,build,targetedlint
anddiffcheckpassed. Visually inspected /tmp/gnosis-studio-compact-candidates.png.
The browser harness now uses the same disclosure capture/restore lifecycle as the
app so editor preservation is tested accurately. No paid AI calls; real research
remains paused. No new exports/files affecting the earlier unused-audit baseline.
