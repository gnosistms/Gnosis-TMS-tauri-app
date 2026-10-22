# Subtitle timestamp mismatch warning

Superseded by `subtitle-overlap-and-meaning-check.md`: both timestamp thresholds
are now 5%, with consented overlap matching and a sampled AI meaning check.

1. Compute unmatched incoming cues / total incoming cues under the repo lock.
   If strictly more than 30% are unmatched, return a warning without any writes.
2. Show the percentage and cue/new-row counts with Cancel and explicit Continue.
   Reuse the existing mismatch action, keeping subtitles entirely local.
3. Bind confirmation to the current match/insertion plan and recheck before apply,
   so a changed source or uploaded file requires a fresh warning.
4. Test threshold boundaries, confirmation/reconfirmation, cancel/no-write UI
   behavior, and successful continuation; run scoped backend/frontend checks.

## Result

Implemented a backend-enforced, pre-write warning for strictly more than 30%
unmatched incoming starts. The dialog reports percentage and counts, focuses
Cancel, and requires explicit continuation. Consent is bound to the current plan;
changed plans warn again. Late progress cannot dismiss the warning.

Validation: 10 Rust subtitle tests passed (one opt-in replay ignored), all 2,929
frontend app/screen tests passed, strict Rust Clippy and scoped ESLint passed,
and whitespace checks passed. Threshold tests cover below/equal/above 30%, 100%,
duplicate timestamps, explicit confirmation, and invalidated confirmation.
