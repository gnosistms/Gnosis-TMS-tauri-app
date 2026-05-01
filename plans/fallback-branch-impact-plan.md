# Fallback Branch Impact Plan

Date: 2026-05-01

## Goal

Test each suspected fallback branch by temporarily disabling it, then measure what code becomes unused and what tests or builds break.

This is evidence gathering only. Do not keep temporary removals unless a later task explicitly asks to remove that branch for real.

## Candidate List

Start from `plans/fallback-code-audit-report.md`.

Initial candidates:

- download redesign preview files
- GitHub App Auth Test screen and actions
- old manual editor virtualizer path
- disabled glossary visible-layout reconciliation path
- editor regression/debug fixture path
- persistent-store legacy/browser fallback path

Treat migration, auth, update, offline, sync, and recovery code as high-risk until separately reviewed.

## Workflow

### 1. Create A Temporary Audit Branch Or Worktree

Use a temporary local branch or worktree so experimental branch removals do not pollute the main cleanup work.

Do not commit experimental removals unless separately requested.

### 2. Record Baseline

Record current baseline:

- `git status --short`
- `npm run audit:unused`
- `npm test`
- `npm run build`
- `cargo test`

If full verification is too slow, still record that the full command was skipped and which narrower command was used instead.

### 3. Test One Candidate At A Time

For each candidate:

- make the narrowest temporary edit that makes the fallback path impossible
- do not mix multiple candidates in one experiment
- preserve enough surrounding code for the app to compile unless the experiment is intentionally deleting a file or module

Examples:

- replace a feature constant with the current production value inline
- remove an `else` branch guarded by a fixed flag
- remove a screen registration and its direct imports
- delete a preview-only directory
- remove a legacy migration fallback after forcing the current storage path

### 4. Run Static Unused Detection

After each temporary edit, run:

- `npm run audit:unused`

Record:

- newly unused files
- newly unused exports
- newly unused dependencies
- whether Knip stayed clean

### 5. Run Verification

For each temporary edit, run the relevant checks:

- `npm test`
- `npm run build`
- `cargo test` when Rust/native code is touched

Use targeted tests first if useful, but record whether the full suite passed before marking a candidate as safe.

### 6. Collect Frontend Coverage

Add or use Playwright/V8 coverage for representative frontend flows.

Representative flows:

- app launch/start screen
- auth/session restore path where practical
- teams page
- projects page
- glossaries page
- editor open/edit/save
- editor scrolling and virtualization
- AI assistant path where practical
- offline/reconnect path

Coverage findings are evidence, not proof. A branch may be valid even if the chosen smoke flow does not execute it.

### 7. Classify Each Candidate

Use these classifications:

- `safe removal candidate`: Knip finds newly unused code and tests/build pass.
- `needs product decision`: technically removable, but may be diagnostic, archive, migration, or recovery behavior.
- `not removable`: tests/build break or current app flow still uses it.
- `coverage inconclusive`: not executed in coverage, but too rare or high-risk to remove based on coverage alone.

### 8. Restore Temporary Edits

After each candidate experiment:

- restore the working tree to the baseline state
- verify with `git status --short`
- then proceed to the next candidate

Do not leave experimental deletions mixed into unrelated cleanup work.

## Impact Report

Write results to `plans/fallback-branch-removal-impact-report.md`.

Required sections:

- Summary
- Baseline command results
- Candidates tested
- Temporary edit made for each candidate
- Knip findings after each edit
- tests/build results
- coverage notes
- final classification
- recommended removal order
- candidates not tested and why

## Removal Policy

This phase does not remove code permanently.

Actual removal should happen later in small, separate commits after the impact report is reviewed.

For editor virtualization or row patching removals, follow `AGENTS.md`:

- preserve smooth scrolling
- avoid full translate-body rerenders for ordinary row-level updates
- keep virtualization as the source of truth
- verify no visible blank gaps
- verify spacer heights remain correct
- verify focus is preserved for the active editor row
- verify textarea and image-driven height changes still reconcile correctly

