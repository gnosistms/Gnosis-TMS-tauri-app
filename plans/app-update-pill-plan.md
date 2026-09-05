# App Update Pill Plan

## Goal

Add a compact Codex-style orange update pill beside the team name in page headers,
keep it visible after an optional startup update is deferred, check for updates once
per hour, and show native updater download progress in the pill.

## Implementation

1. Extend the existing updater state/flow with download progress, a single native
   progress listener, and an hourly background-check scheduler that preserves the
   startup prompt behavior while later checks remain unobtrusive.
2. Emit throttled download byte progress from the Rust updater during every download
   attempt, including retry resets and completion.
3. Add a reusable page-header update-pill renderer using the shared accent CSS
   variables and a vendored open-source Lucide/Feather download SVG, then place it
   beside the subtitle/team name on every page shell.
4. Update focused frontend and Rust tests, run formatting/static checks, and verify
   the rendered page-header markup and updater state transitions.

## Review follow-up

1. Split download from installation; require an explicit restart action, flush
   editor changes and reject restart while durable write queues remain active.
2. Guard concurrent checks/downloads/installs in both frontend and native code,
   and invalidate checks when a required-update signal arrives.
3. Persist known availability independently of authentication and retain it on
   errors/platform-unavailable responses until a successful current-version check.
4. Provide a shared progress surface on every screen and patch progress without
   remounting editor content. Add regression tests for these transitions.

## Verification results

- Full JavaScript suite: 2,018 tests plus 13 workflow tests passed.
- Rust updater: 14 tests passed; formatting and strict all-targets clippy passed.
- Three browser tests passed using installed Chrome (the configured Playwright
  headless-shell executable is missing locally): offline persistence, ten-screen
  badge coverage/focus preservation, and 25px pill/13px icon/restart-action sizing.
- Reviewed the rendered header screenshot; production Vite build passed.
- JavaScript lint has 64 existing warnings, no errors. Unused-export audit still
  reports unrelated benchmark/dev-launcher scripts and an editor-footnotes export.
- No real packaged-app installation/restart was performed. That remains release
  smoke-test coverage on macOS and Windows.
