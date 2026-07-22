# PDF Paper Size Preference Plan

## Goal

Use A4 as the initial PDF export paper size and remember the signed-in user's most
recent valid paper-size selection across chapters and app restarts.

## Implementation

1. Add a login-scoped PDF paper-size preference to the existing editor export
   defaults persistence module.
2. Seed new export modal state with A4, then restore a valid saved preference when
   opening the modal.
3. Persist each valid paper-size selection immediately without changing the existing
   per-chapter successful-export defaults or WordPress overwrite memory.
4. Update renderer fallbacks and regression tests for first-run, persistence, invalid
   stored values, and cross-chapter restoration.

## Verification

- Run editor export defaults, flow, and modal renderer tests.
- Run the full frontend test suite and production build.
- Confirm the diff does not touch unrelated export behavior.
