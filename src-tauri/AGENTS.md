# Backend Development Guide

Rust/Tauri patterns for Gnosis TMS. See root `CLAUDE.md` for project overview and
`.vt/memory/foundational-principles.md` for architectural principles.

## Stack

- Rust + Tauri 2
- SQLite via Tauri's SQLite plugin (local persistent store, full-text search index)
- Git operations via bundled Git binary (invoked as a subprocess — no libgit2)
- GitHub REST API (via `src-tauri/src/github/`)
- Broker service (auth proxy for GitHub App tokens)

## Module Layout

```
src-tauri/src/
├── main.rs                    # Entry point, Tauri command registration
├── state.rs                   # App state (store handle, auth, cached state)
├── store.rs                   # SQLite local persistent store
├── broker.rs / broker_auth.rs # Broker service client and auth
├── github.rs / github/        # GitHub REST API client
├── callbacks.rs               # Tauri event emitters (progress, sync status)
├── repo_sync_shared.rs        # Shared git sync utilities
├── project_repo_sync.rs       # Project repo sync (push/pull/status)
├── glossary_repo_sync.rs      # Glossary repo sync
├── qa_list_repo_sync.rs       # QA list repo sync
├── project_import/            # DOCX, HTML, paste import pipeline
├── project_search/            # SQLite FTS5 search index (indexer, query, schema)
├── team_metadata_local/       # Local metadata repo management
├── ai/                        # AI provider integration
└── updater.rs                 # App auto-updater
```

## Bundled Git Runtime (CRITICAL)

The app bundles its own Git binary. There is no dependency on any system-installed Git.

- Git commands MUST be invoked via the bundled binary path, never `git` from PATH.
- The bundled Git path is resolved at runtime via Tauri's resource directory.
- macOS releases bundle Apple-signed Git (`c255a757 Bundle Apple Git for macOS`).
- Git archive staging on macOS requires specific handling — see `c37e183f`.

**Never assume `git` resolves from PATH.** If you add a new git invocation, use the
same binary resolution path as the existing callers in `repo_sync_shared.rs`.

## Write Access Enforcement

Before any mutation to a project, glossary, or QA list repo, write access MUST be
verified against the GitHub App installation.

- `installation_access.rs` provides the write access check.
- `5a962431 Enforce installation write access before repo mutations` is the canonical
  pattern for this check.
- Write access checks happen in Tauri commands before the git operation — not inside
  the sync helpers.

**Never assume a logged-in user has write access.** Even owners can have a GitHub App
installation in a degraded permission state. Check explicitly.

## Storage Patterns

### Local Store (SQLite via `store.rs`)

The local store is the persistence layer for: team records, project metadata, glossary
metadata, QA list metadata, auth tokens, and pending-create state.

- Store reads are synchronous from the Tauri command thread.
- All mutations are transactional — use transactions for multi-step writes.
- Schema migrations are applied at startup in `repo_migrations.rs` and
  `team_repo_migrations.rs`.

### Metadata Repos

Resource lifecycle state (active, soft-deleted, tombstoned) is authoritative in the
team metadata repo, not only in the local store. The metadata repo is a git repo on
the GitHub org that the local store mirrors.

- Write metadata BEFORE the remote content repo operation (metadata-first — see F-VI
  in foundational principles).
- Tombstones for permanent deletes MUST be written to the metadata repo before the
  content repo is deleted from GitHub.
- `team_metadata_local/` owns local metadata repo reads and writes.

### Row Ordering

Editor content files store rows with a `row_order_key` field — a lexicographic string
key (e.g. `"a0"`, `"a0V"`, `"a1"`). Sorting rows uses lexicographic string comparison,
never numeric comparison. New key generation must produce a string that sorts between
the surrounding keys.

See `project_search/indexer.rs` for how `row_order_key` is indexed and sorted in the
search index.

## Tauri Command Patterns

### Command Registration

All public commands are registered in `main.rs`. New commands require:
1. `#[tauri::command]` attribute on the handler function.
2. Registration in the `.invoke_handler(tauri::generate_handler![...])` call.
3. A corresponding `invoke("command_name", ...)` call in `src-ui/app/runtime.js`.

### Error Handling

Commands return `Result<T, String>` where the `String` is a user-facing error message.
- Use `?` to propagate errors from internal functions that return `Result<_, String>`.
- Provide specific, actionable error messages — "GitHub App does not have write access
  to this repository" is better than "permission error".
- Do not leak internal paths, tokens, or stack traces in error strings.

### Progress Reporting

Long-running commands (git push/pull, imports, search indexing) emit progress via
Tauri events (`callbacks.rs`) rather than blocking until complete.

```rust
// Emit progress to the frontend
app_handle.emit("sync-progress", SyncProgressPayload { ... })?;
```

The JS frontend listens for these events and updates UI state. Commands that emit
events MUST document which event names they emit.

## Rust Conventions

- No `unwrap()` or `expect()` in production paths — use `?` or explicit error handling.
- No blocking I/O in async contexts — spawn blocking work with `tauri::async_runtime::spawn_blocking`.
- Cross-platform path handling: normalize separators when comparing paths from git
  history. Windows git history may contain backslashes.
- Prefer `serde_json::Value` for dynamic git file content; use typed structs for
  SQLite rows and API responses.

## Common Mistakes

### GitHub API

- **Check broker permissions before assuming write access.** A GitHub App installation
  may have reduced permissions. `github_app_permissions.js` (frontend) and
  `installation_access.rs` (backend) both validate this — do not skip either.
- **GitHub installation repository list responses** are paginated and may omit repos
  in degraded states — tolerate missing repos gracefully (`e1312a69`).

### Git Operations

- **Windows path separators in git history** — paths stored during earlier Windows
  sessions may use backslashes. Normalize before comparing. (`345123ff`)
- **macOS Git archive staging** requires special handling that differs from Linux
  behavior. Test archive operations on macOS. (`c37e183f`)

### SQLite

- Migration files run in order at startup. Adding a new migration step MUST be
  additive — never modify an existing migration that may have already run on a
  user's machine.
- The search index schema (`project_search/schema.rs`) is rebuilt on demand.
  Changes to the schema require an index version bump to trigger a rebuild.
