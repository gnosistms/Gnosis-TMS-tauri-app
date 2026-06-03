# Backend Development Guide

Rust/Tauri patterns for Gnosis TMS. See root `CLAUDE.md` for project overview and
`.vt/memory/foundational-principles.md` for architectural principles.

See `AGENTS_EVIDENCE.md` for verification notes and canonical source references that
support the guidance in this file.

## Stack

- Rust + Tauri 2
- SQLite via `rusqlite` with bundled feature (project search index only)
- `tauri-plugin-store` (local key-value persistent store)
- Git operations via bundled Git binary (invoked as a subprocess — no libgit2)
- GitHub REST API (via `src-tauri/src/github/`)
- Broker service (auth proxy for GitHub App tokens)

## Module Layout

```
src-tauri/src/
├── main.rs                    # Entry point — calls gnosis_tms_lib::run() only
├── lib.rs                     # Tauri command definitions + invoke_handler registration
├── state.rs                   # App state (store handle, auth, cached state)
├── store.rs                   # Local key-value persistent store (`tauri-plugin-store`)
├── broker.rs / broker_auth.rs # Broker service client and auth
├── github.rs / github/        # GitHub REST API client
├── callbacks.rs               # Tauri event emitters (progress, sync status)
├── repo_sync_shared.rs        # Shared git sync utilities
├── project_repo_sync.rs       # Project repo sync (push/pull/status)
├── glossary_repo_sync.rs      # Glossary repo sync
├── qa_list_repo_sync.rs       # QA list repo sync
├── project_import/            # DOCX, HTML, paste import pipeline
├── project_search/            # SQLite search index (trigram-based; indexer, query, schema)
├── team_metadata_local/       # Local metadata repo management
├── ai/                        # AI provider integration
└── updater.rs                 # App auto-updater
```

## Bundled Git Runtime

Git resolution is platform-specific — never assume a uniform path:

- **macOS**: Always uses a bundled Apple-signed Git. The archive
  (`resources/macos/git-runtime.tar.gz`) is extracted at startup into
  `app_config_dir/git/macos-runtime/<hash>/`. Never falls back to system Git.
- **Windows**: Prefers a bundled Git at `resource_dir/git/windows/`; falls back
  through `%LOCALAPPDATA%\Programs\Git`, GitHub Desktop's bundled git,
  `%ProgramFiles%\Git`, and finally `Command::new("git")` (PATH lookup).
- **Linux**: Always uses `Command::new("git")` — pure system PATH, no bundling.

When adding a new git invocation, use the same binary resolution path as existing
callers in `repo_sync_shared.rs` for the correct platform behaviour. Do not
hardcode `"git"` as a string — route through the resolved path on macOS/Windows.

Git archive staging on macOS requires specific handling — see commit `c37e183f`.

## Write Access Enforcement

Before any mutation to a project, glossary, or QA list repo, write access MUST be
verified against the GitHub App installation.

- `installation_access.rs` provides the write access check functions.
- **Content writes** (chapter/row saves): `ensure_repo_allows_writes` is called
  inside `git_commit_as_signed_in_user_with_metadata` in `git_commit.rs` — it runs
  inside the shared commit helper, not in the command body.
- **Resource management** (create/rename/delete project, glossary, QA list):
  `ensure_installation_allows_*` checks run in `team_metadata_local.rs` command
  bodies before the git/remote operation.

**Never assume a logged-in user has write access.** Even owners can have a GitHub App
installation in a degraded permission state. Check explicitly.

## Storage Patterns

### Storage Architecture

The app does not use a single central store. Data is distributed across several
independent mechanisms — know which owns what before adding persistence:

| Data | Mechanism | Owner |
|---|---|---|
| Resource metadata (project/glossary/QA lifecycle state) | Git repo files | `team_metadata_local/` |
| Broker session (token + display fields) | Plain JSON file (`broker-auth-session.json`) | `broker_auth_storage.rs` |
| Installation write-access snapshots | Plain JSON file per installation | `installation_access.rs` |
| AI provider secrets (API keys) | Stronghold encrypted store; deterministic SHA-256 key (accepted tradeoff — see F-VIII) | `ai_secret_storage.rs` |
| Full-text search index | SQLite database (`project-search.sqlite3`) | `project_search/` |
| Tauri plugin key-value store | JSON file store (`tauri-plugin-store`) | `store.rs` |

**F-VIII — Accepted at-rest security tradeoff**: The broker session token and the
Stronghold encryption key for AI provider secrets are stored in plain files accessible
to any process running as the local user. A motivated attacker with filesystem access
can read the session token and derive the Stronghold key. This is an explicit product
decision — see [F-VIII in foundational-principles.md](../.vt/memory/foundational-principles.md).
**Do not introduce OS keychain (`keyring`) integration to harden these storage paths.**
The `keyring` crate is not a dependency of this crate.

`store.rs` initializes `tauri-plugin-store` (a simple key-value JSON file store).
It is **not** a SQLite database. `rusqlite` is used exclusively by `project_search/`
for the search index.

**Transactions**: `project_search/indexer.rs` uses `rusqlite` transactions for search
index writes. The git-file-based metadata layer has no transaction support — mutations
must be designed for idempotency and recovery.

**Migrations**: Repo layout and metadata migrations are triggered on demand by the
JS frontend (via `list_pending_team_repo_layout_migrations`, `sync_local_team_metadata_repo`
commands), not automatically at startup. `repo_migrations.rs` and `team_repo_migrations.rs`
define migration steps; `lib.rs::setup()` does not call them.

### Metadata Repos

Resource lifecycle state (active, soft-deleted, tombstoned) is authoritative in the
team metadata repo, not only in cached local projections. The metadata repo is a git
repo on the GitHub org that the local metadata checkout mirrors.

Current invariant
- Tombstones for permanent deletes MUST be written to the metadata repo before the
  content repo is deleted from GitHub.
- `team_metadata_local/` owns local metadata repo reads and writes.
- Metadata repo state is authoritative for lifecycle when it conflicts with cached
  local projections.

Known divergence
- Project create still creates the remote GitHub repo before the metadata record is
  written, so metadata-first is not yet universal.

Architectural goal
- Write metadata before every remote content repo operation.

### Row Ordering

The row-order identifier has different names at different layers:

- Content file field: `structure.order_key`
- Editor payload field: `order_key`
- Search index column: `row_order_key`

The underlying value is a 32-character lowercase hexadecimal string encoding a
128-bit integer (e.g. `"00000000000000000000000000000001"`). Sorting is always
lexicographic string comparison, never numeric comparison. New key generation must
produce a value that sorts between the surrounding keys.

## Tauri Command Patterns

### Command Registration

Command handlers are defined with `#[tauri::command]` in their respective modules
(e.g. `project_import.rs`, `team_metadata_local.rs`, `broker_auth_storage.rs`,
`github/repos.rs`). All commands are **registered** in the single
`.invoke_handler(tauri::generate_handler![...])` call in `lib.rs`. `main.rs`
contains only `gnosis_tms_lib::run()`. New commands require:
1. `#[tauri::command]` attribute on the handler function in its domain module.
2. Registration in the `generate_handler![]` macro in `lib.rs`.
3. A corresponding `invoke("command_name", ...)` call in the relevant feature module
   in `src-ui/app/` — `runtime.js` is the `invoke` wrapper; individual call sites
   live across feature modules (e.g. `project-flow.js`, `glossary-repo-flow.js`).

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

### Search Index Schema

The project search schema is managed directly in `project_search/schema.rs` via
`ensure_project_search_schema`. There are no migration files and no explicit
index-version mechanism — schema changes involve updating `ensure_project_search_schema`
(which uses `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE`, and table-clearing as needed).
Do not look for migration files or a version number; there are none.
