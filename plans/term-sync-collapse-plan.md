# Term Sync Collapse Plan

## Goal

Collapse the mirrored glossary and QA term-sync modules into one generic
`repo-resource/term-sync.js` factory while preserving the existing public exports
and call signatures.

## Steps

1. Extract the shared term-sync engine into `src-ui/app/repo-resource/term-sync.js`
   with descriptor hooks for editor state, term normalization, selected repo name,
   load command, term field construction, and user-facing copy.
2. Replace `glossary-term-sync.js` and `qa-term-sync.js` with thin descriptor
   adapters that re-export the same 11 functions under existing names.
3. Add focused QA coverage for `buildQaTermFromDraft` shape and run the existing
   glossary term-sync safety net plus full frontend tests.
