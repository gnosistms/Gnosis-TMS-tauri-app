# Backend AGENTS Evidence

Supporting evidence for the guidance in `AGENTS.md`. This file is descriptive, not
directive.

## Verification Status

- Last verified: 2026-06-02
- Verified from: `972bdc92`

## Bundled Git Runtime

- Status: verified against code
- Canonical files:
  - `src-tauri/src/repo_sync_shared.rs`
  - `src-tauri/src/lib.rs`

## Storage Architecture

- Status: verified against code
- Canonical files:
  - `src-tauri/src/store.rs`
  - `src-tauri/src/project_search/schema.rs`
  - `src-tauri/src/credential_vault.rs` (2026-09-05: verified migration, OS-key
    adapter, session-only fallback, atomic writes and exclusive snapshot lock)
  - `src-tauri/src/credential_vault/os_store.rs` (non-interactive platform
    access; macOS lifetime guard and Linux zero prompt timeout)
  - `src-tauri/src/ai_secret_storage.rs`
  - `src-tauri/src/broker_auth_storage.rs`
  - `src-tauri/src/local_author.rs` (public attribution bound to the encrypted
    snapshot; local commits and comments do not require a token or OS unlock)
  - `src-tauri/src/team_ai.rs` (native issuance and delayed-write guards)

## Metadata Lifecycle

- Status: verified against code
- Canonical files:
  - `src-tauri/src/team_metadata_local.rs`
  - `src-tauri/src/github/repos.rs`

## Row Ordering

- Status: verified against code
- Canonical files:
  - `src-tauri/src/project_import/chapter_editor/shared.rs`
  - `src-tauri/src/project_search/schema.rs`

## Command Registration Boundary

- Status: verified against code
- Canonical files:
  - `src-tauri/src/lib.rs`
  - `src-ui/app/runtime.js`
