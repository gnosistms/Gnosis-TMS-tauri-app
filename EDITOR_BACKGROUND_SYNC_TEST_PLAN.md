# Editor Background Sync Test Plan

## Purpose

This plan verifies that background sync reduces merge conflicts without destabilizing the open editor UI.

It covers both:

- translate editor row sync
- glossary editor term sync

## High-Risk Behaviors

1. Background sync must not replace the whole open editor snapshot.
2. Clean stale items must reload from disk before the user starts editing them.
3. Dirty in-memory edits must not be silently overwritten by background sync.
4. Save-time behavior must be concurrency-aware.
5. Remote deletions must stop normal editing behavior for the deleted item.

## Automated Coverage

### Frontend Unit Tests

Translate editor:

- row stale marking after repo sync
- save state transitions while rows are dirty, saving, or changed again during save
- navigation guards that flush dirty rows before leave/refresh

Glossary editor:

- changed terms are marked stale after glossary repo sync
- non-forced glossary sync is skipped while the term modal is open
- stale glossary terms reload from disk before editing
- glossary term save forces sync first and sends the user draft to the backend after that sync

### Browser Regression Tests

Translate editor:

- focus is preserved while typing and filtering
- dirty rows flush through the backend before cross-row actions
- structural edits keep scroll and virtualization stable

Current gap:

- glossary background sync does not yet have browser-level fixture coverage matching the translate editor harness

### Rust Verification

- `cargo check` must pass so the Tauri glossary sync commands are buildable

## Manual Test Scenarios

### Translate Editor

1. Open a chapter editor.
2. Leave the chapter idle long enough for background sync eligibility.
3. Confirm no full-page rerender, focus loss, or scroll jump occurs when sync runs.
4. Change a different copy of the same chapter on disk or from another machine.
5. Return to a clean stale row and confirm the row reloads before typing.
6. Start editing a row, introduce a remote change to that same row, then save.
7. Confirm only translation-text conflicts remain user-visible.

### Glossary Editor

1. Open a glossary editor and let the initial forced sync run.
2. Change a glossary term remotely.
3. Wait for background sync while the glossary page is idle.
4. Confirm the open glossary table does not fully rerender.
5. Click the changed term and confirm the modal opens with the latest disk copy.
6. Start editing a term, introduce a remote edit to that same term, then save.
7. Confirm the saved result reflects the user's modal draft.
8. Delete a term remotely, click it locally, and confirm the app stops normal editing and removes the stale row from the open snapshot.

## Commands

Run these checks after background sync changes:

```bash
npm test
npm run test:browser
cargo check --manifest-path src-tauri/Cargo.toml
```

## Exit Criteria

- unit tests pass
- browser regression tests pass
- Rust compile check passes
- manual glossary and translate smoke tests match the behaviors above
