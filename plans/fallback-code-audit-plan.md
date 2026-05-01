# Fallback-Code Audit Plan

Date: 2026-05-01

## Goal

Find old fallback, legacy, and alternate-path code that static unused-code tools can miss because it is still imported, reachable, or guarded by constants, feature flags, runtime config, or error handling.

This is an evidence-gathering pass first. Do not remove code during the audit unless a separate implementation task explicitly asks for removal.

## Scope

Audit:

- JavaScript UI code
- Rust/Tauri commands and helpers
- build/config files
- local preview and dev-only code
- tests that may preserve obsolete fallback behavior

Treat offline, update, auth, migration, and recovery code as high-risk until reviewed. Those paths may look like fallbacks while still being intentional product behavior.

## Audit Steps

### 1. Create A Search Inventory

Search for terms that usually indicate fallback paths:

- `fallback`
- `legacy`
- `old`
- `compat`
- `deprecated`
- `temporary`
- `TODO remove`
- `remove later`
- `feature flag`
- `flag`
- `USE_`
- `ENABLE_`
- `DISABLE_`
- `if false`
- `if (false`
- `mock`
- `preview`
- `dev only`

Also search for mode and branch terms that may indicate alternate implementations:

- `offline`
- `online`
- `local`
- `remote`
- `sync`
- `migration`
- `recovery`
- `fallback`
- `legacy`

### 2. Inventory Feature Flags And Constants

Find constants and config values that select between implementations, especially booleans and mode strings.

For each one, record:

- name
- file and line
- current value
- whether the value can change at runtime
- branch, function, or module it enables
- whether the alternate branch is still intended

### 3. Audit Conditional Branches

Review branches controlled by fixed or effectively fixed values.

Classify each branch as:

- `active production path`
- `inactive fallback, removable`
- `inactive fallback, keep for recovery/migration`
- `dev/test-only, keep`
- `unclear, needs confirmation`

### 4. Audit Try/Catch Fallbacks

Search for `catch` blocks and fallback return paths that call alternate implementations or silently continue after failures.

For each fallback, record:

- primary path
- fallback path
- error condition that triggers fallback
- whether the fallback has tests
- whether the fallback is still needed

### 5. Audit Alternate Implementations

Look for pairs of modules or functions that appear to do the same job, such as:

- old/new flow files
- local/remote paths
- sync/background-sync variants
- old/new renderers
- old/new auth or setup flows
- duplicated storage or metadata paths

Compare call sites, current product behavior, tests, and comments before classifying.

### 6. Audit Offline/Online Branches Separately

Offline support is intentional, so classify these branches carefully:

- current offline feature
- old fallback from an earlier offline design
- disabled online operation
- migration/recovery path
- unclear behavior needing product confirmation

### 7. Run Runtime Coverage

Use browser/V8 coverage against representative flows, then inspect files/functions that are loaded but never executed.

Representative flows:

- launch app
- auth/login flow
- teams page
- projects page
- editor open/edit/save
- glossary page
- AI assistant flow where practical
- offline/reconnect flow
- update-required modal flow if practical

Coverage findings are candidates, not proof. A path may be valid even if the smoke flow did not exercise it.

### 8. Cross-Check Tests

For every candidate fallback path, search tests.

Classify tests as:

- still covering active product behavior
- covering migration/recovery behavior that should stay
- preserving obsolete fallback behavior
- unclear and needing product confirmation

If tests only preserve obsolete behavior, mark those tests as removal candidates together with the code.

## Report

Write findings to `plans/fallback-code-audit-report.md`.

Required sections:

- Summary
- Commands run
- Search terms used
- Feature flags and constants found
- Dead or likely-dead fallback branches
- Try/catch fallback paths
- Duplicate or alternate implementations
- Runtime coverage candidates
- Code to keep intentionally
- Tests that preserve fallback behavior
- Removal recommendations by confidence

## Candidate Confidence Levels

Use these confidence categories:

- **High confidence**: branch controlled by a fixed disabled value, no current product call path, no meaningful test coverage except obsolete behavior.
- **Medium confidence**: old fallback still technically callable, but product behavior appears superseded by a newer path.
- **Low confidence**: migration, recovery, offline, auth, sync, or update code where the branch may be intentionally rare.
- **Keep**: fallback is intentional and should remain documented.

## Recommended Removal Order For Later Cleanup

When the audit report is complete, remove candidates in separate, reviewable commits:

1. Fixed false flags and obviously dead branches.
2. Obsolete duplicate implementations with no active call path.
3. Old tests that only preserve removed fallback behavior.
4. Medium-confidence fallback paths after product confirmation.
5. Leave low-confidence migration/recovery/offline/auth/update paths until separately reviewed.

## Verification For Later Removal Work

For each removal commit:

- `npm run audit:unused`
- `npm test`
- `cargo check`
- `cargo test`
- `npm run build`
- targeted manual smoke test for the affected flow

For editor-related cleanup, also follow `AGENTS.md` virtualization rules:

- preserve smooth scrolling
- avoid full translate-body rerenders for row-level updates
- keep virtualization as the source of truth
- verify no blank gaps, spacer drift, or focus loss

