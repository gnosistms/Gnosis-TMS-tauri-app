# Code Review — Batch 4: Git Sync Infrastructure
<!-- vt.idd:local-review:batch-4 -->

**Date**: 2026-06-03
**Scope**: `src-tauri/src/` shared git primitives used by all three sync domains
(projects, glossaries, QA lists)
**Files reviewed**:

| File | Lines |
|---|---|
| `git_commit.rs` | 149 |
| `local_repo_sync_state.rs` | 233 |
| `repo_sync_shared.rs` | 718 |
| `repo_layout_metadata.rs` | 191 |
| `repo_app_version.rs` | 170 |
| **Total** | **~1,461** |

**Review focus (per Rust Review Strategy)**: shared git primitives — issues here propagate
to all resource sync. Emphasis on the commit/write-gate path, git runtime isolation,
transport-token handling, and forward-compatibility.

---

## Executive Summary

| Severity | Count |
|---|---|
| Critical (C) | 0 |
| Security (S) | 0 |
| Major (M) | 0 |
| Minor (m) | 2 |
| **Total** | **2** |

This is well-built, security-conscious infrastructure. The write-access gate runs first
in the shared commit helper; the git runtime is isolated from the user's global config and
credential helpers; the installation transport token is passed via an ephemeral
environment config rather than written to disk; commit metadata goes through `Command`
args (no shell); and there's a forward-compatibility guard that stops an older app from
overwriting newer-format repo data. No Critical/Security/Major findings.

The two minors are an invariant/doc mismatch on the macOS git fallback and a couple of
non-atomic local-state writes.

---

## Findings

---

### m1 — `repo_sync_shared.rs:106-112` (and `git_command`)

**macOS falls back to system `git`, contradicting the "never fall back to system Git" invariant**

When the bundled runtime is resolved, `git_command()` uses `RESOLVED_GIT_EXECUTABLE`. When
it is not, the non-Windows branch runs:

```rust
#[cfg(not(windows))]
{
    let mut command = Command::new("git"); // system git on PATH
    configure_git_isolation(&mut command);
    command
}
```

On macOS this is reached whenever `prepare_macos_git_runtime` returns `Ok(None)` (archive
not bundled) or fails (and `initialize_git_runtime` silently swallows that — `lib.rs`
calls it for its side effects only). But `src-tauri/AGENTS.md` states macOS **"Always uses
a bundled Apple-signed Git … Never falls back to system Git."** So the code and the
documented invariant disagree.

In a correct release the archive is bundled, so this only triggers on a broken install or
in dev — but on macOS, system `git` may be absent and invoking it can trigger the Xcode
Command Line Tools install prompt, or silently use a different git than intended.

| Fix | Description | Rationale |
|---|---|---|
| **A ✓** | On macOS, when no bundled runtime is resolved, return a clear error from `git_command`'s callers (or make `git_command` fallible on macOS) instead of `Command::new("git")` | Enforces the documented invariant; fails with an actionable message rather than a surprise CLT prompt |
| B | Keep the dev-friendly fallback but **update AGENTS.md** to say macOS falls back to system git when the bundled runtime is unavailable | Lower effort; makes the doc match reality (weaker guarantee) |

**Recommended**: A in release builds (B is acceptable only if the fallback is genuinely wanted).

---

### m2 — `repo_layout_metadata.rs:98`, `local_repo_sync_state.rs:146`

**Non-atomic writes for repo layout metadata and local sync state**

Both `write_repo_layout_metadata` and `upsert_local_repo_sync_state` write with a bare
`fs::write` (truncate-then-write). A crash mid-write leaves a partial/empty file that fails
to parse on the next read. This is the same class the Batch 1 **m3** fix addressed for the
broker/installation snapshots — and `util::atomic_replace` now exists for exactly this.

Severity is low: `repo.json` is git-tracked (recoverable via checkout) and
`gnosis-sync-state.json` lives in `.git/` as a regenerable local cache. But for consistency
with the atomic-write discipline established elsewhere, both should use the helper.

| Fix | Description | Rationale |
|---|---|---|
| **A ✓** | Write to a sibling `.tmp` and `util::atomic_replace(tmp, dest)` in both functions | Crash-safe; consistent with `broker_auth_storage.rs` / `installation_access.rs` |

**Recommended**: A

---

## Standard V sweep — synchronous commands doing I/O

**No `#[tauri::command]` functions exist in this batch** — these are all internal helpers.
The commands that consume them live in the per-domain sync modules (`project_repo_sync.rs`,
Batch 5). Nothing to enforce here.

## Swallowed / Non-Fatal Error Pass

All `let _ =` / `.ok()` / `.unwrap_or(...)` sites classify as **expected silence** or
already-surfaced:

- Git runtime preparation (`initialize_git_runtime`, macOS extract/prune, Windows
  discovery) swallows errors by design and falls back — **except** that on macOS the
  fallback is the system-git path flagged in **m1**. Worth noting the silent failure there
  is the mechanism behind m1.
- `read_current_head_oid` `.ok()` → `None` for a repo with no `HEAD` (expected, e.g. fresh repo).
- `set_local_git_config_if_needed` treats a missing local config value as empty and then
  sets it (correct).
- `abort_rebase_after_failed_pull` folds any abort failure into the returned error string
  (user-visible).

No non-fatal **defect signals** requiring a telemetry event.

---

## What Was Done Well

- **Write gate is first in the commit helper** — `git_commit_as_signed_in_user_with_metadata`
  calls `ensure_repo_allows_writes` before anything else, exactly as the architecture requires.
- **Git runtime isolation** — `configure_git_isolation` sets a private `HOME`,
  `XDG_CONFIG_HOME`, and `GIT_CONFIG_GLOBAL`, disables the credential helper
  (`credential.helper =`), sets `GIT_TERMINAL_PROMPT=0` / `GCM_INTERACTIVE=Never`, and
  removes `SSH_ASKPASS`/`GIT_ASKPASS` — preventing interference from the user's git config
  and any interactive hang.
- **Transport token handling** — the installation token is injected via ephemeral
  `GIT_CONFIG_COUNT/KEY/VALUE` env (`http.extraHeader: AUTHORIZATION: basic …`) rather than
  written to an on-disk git config, and it does not appear in error strings. Good least-exposure choice.
- **Commit metadata via separate `-m` args** — operation/migration/status/AI-model/version
  trailers are passed as distinct arguments, never interpolated into a shell.
- **Forward-compatibility guard** — `repo_app_version.rs` reads the `GTMS-App-Version`
  trailer on the remote tip and refuses to sync when the remote was written by a newer app,
  preventing an old client from clobbering newer-format data. Tolerant version parsing.
- **macOS runtime extraction is careful** — hash-addressed directory, staged extraction +
  atomic rename with a fallback, `chmod 0755`, and stale-runtime pruning.
- **Tolerant deserialization** — `LocalRepoSyncState` and `RepoLayoutMetadataFile` use
  `Option` / `#[serde(default)]`, so older/newer state files don't hard-fail.
- **No `unwrap()`/`expect()` in production paths**; good unit coverage (transport auth header,
  version comparison, missing-remote-ref detection, layout round-trip, repo-kind aliases).

---

## Resolution Status

All findings are **Open / Proposed** as of 2026-06-03.

| Finding | Status | Notes |
|---|---|---|
| m1 | Open | Reconcile macOS system-git fallback with the documented invariant (enforce or document) |
| m2 | Open | Use `util::atomic_replace` for repo-layout-metadata and local-sync-state writes |

---

*Manual review following the Rust Review Strategy, Batch 4. Findings produced by direct
reading of the five files plus their callers/consumers (`git_commit.rs` → `installation_access`,
`project_repo_paths.rs`).*
