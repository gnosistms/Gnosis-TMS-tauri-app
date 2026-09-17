# Release 0.8.115

## Plan

1. Bump the release metadata from 0.8.114 to 0.8.115.
2. Add release notes for the AI Assistant / AI Translate glossary-readiness fixes merged in PR #328 and PR #329.
3. Run release-relevant validation, commit the release metadata on `main`, push it, and tag that exact commit as `v0.8.115`.

## Validation

- `npm test` — 2184 + 23 passing.
- `npm run audit:unused` — clean (same pre-existing findings as prior releases).
