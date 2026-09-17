# Release 0.8.116

## Plan

1. Bump the release metadata from 0.8.115 to 0.8.116.
2. Add release notes for the app-update restart guard and update-check feedback fixes merged in PR #330.
3. Run release-relevant validation, commit the release metadata on `main`, push it, and tag that exact commit as `v0.8.116`.

## Validation

- `npm test` — 2190 + 23 passing.
- `npm run audit:unused` — clean (same pre-existing findings as prior releases).
