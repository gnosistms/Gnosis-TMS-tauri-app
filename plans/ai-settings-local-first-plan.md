# AI settings local-first loading

Show local API keys, saved action preferences and existing model options before
waiting for broker/provider requests. Keep cached controls usable during refresh.

1. Seed team metadata from the existing local snapshot and load local keys/provider
   presence first. Refresh team metadata and model options in the background.
2. Preserve cached models and saved selections during refresh and transient errors.
   Keep first-time discovery and explicit validation loading states distinct.
3. Guard pending reads against team/account changes, edited key drafts, and action
   preference saves. Passive discovery must not publish stale preferences.
4. Add deferred-response regression tests for immediate display, background errors,
   user edits and stale responses; run frontend checks and browser coverage if available.

Model options remain cached in the current session; after restart, the saved model
is displayed while the first provider discovery fills the list. Secrets remain in
the existing native encrypted store.

Status: complete.

Implemented local snapshot/key loading before remote refresh, usable cached model
options with inline refresh errors, and saved model display during first discovery.
Pending responses preserve edited drafts and newer preference saves, check account
and team scope, and release interrupted loading state for subsequent visits.

Validation:
- 2,030 frontend tests passed; focused AI tests passed again after the final guard change.
- All 17 workflow tests passed outside the sandbox (their local test servers were
  blocked by the sandbox on the initial run).
- Both Playwright checks passed using installed Chrome, with a temporary config
  because the bundled Playwright browser was unavailable. Screenshot inspected.
- Changed production modules pass ESLint; diff whitespace checks pass.
- Unused-code audit reports only existing issues outside this change.
