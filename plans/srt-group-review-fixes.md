# Fix the three sentence-group review findings

1. Guard structured sentence drafts before any Apply mutation, even in Standard
   view. Require Group fragments to apply those drafts, retain the draft on
   failure, and keep membership/snapshot validation in grouped mode. Verify that
   returning to grouped mode applies the original per-cue assignments atomically.
2. Freeze group membership for unsaved drafts and an unchanged open textarea
   (so a save cannot change its marker meanings while the user keeps typing).
   Regroup after closing a clean textarea. Ignore stale clean sessions
   in display projections, and rebuild clean sessions from current cue text when
   editing resumes (including typing in an already-open clean textarea). Preserve
   dirty and force-save drafts, their original concurrency bases, and delayed-save
   behavior. Cover target updates, source punctuation changes, and marker identity.
3. Permit source-language grammar review while retaining distinct source/target
   validation for translation and meaning review. Grammar review needs no derived
   translation glossary preparation. Verify a complete grouped review request.
4. Add focused unit and browser regressions, run affected editor tests and the
   subtitle suite, and check lint, unused findings, and the production build.

Status: complete.

- Sentence-draft Apply is rejected before any text/attachment mutation in
  Standard view. The draft remains available; returning to grouped mode either
  saves the captured per-cue assignments or rejects a changed sentence snapshot.
- Clean stale sessions no longer override canonical text. Resuming a clean edit
  rebuilds its markers and concurrency bases from the current cues; dirty and
  force-save drafts keep their captured text and bases. An open clean editor
  retains its boundaries after saving until blur; structural regrouping on blur
  uses the existing body-render/scroll-anchor path.
- Source-language grammar review sends the complete sentence through the existing
  review batch path. Meaning review still requires distinct source and target.
- All 2,967 frontend tests pass, including 88 focused editor/grouping tests.
  All 31 subtitle browser cases pass across the full suite and focused reruns
  after correcting fixture group-card refresh and the save trigger. Regressions
  cover Standard-view rejection/retry, stale drafts, open and closed clean
  sessions, refreshed concurrency bases, grammar/meaning validation, and continued
  source editing followed by punctuation regrouping.
- Production build, scoped ESLint, and whitespace checks pass. The unused audit
  retains its existing 345 files, 5 unresolved imports, and 32 exports; none of
  the new helpers adds an unused finding. Build retains its chunk-size warning.
- Browser AI calls are mocked. No live AI request, backend change, or native
  macOS/Windows platform verification was performed for these fixes.
