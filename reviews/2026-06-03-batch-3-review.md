# Code Review — Batch 3: App Shell
<!-- vt.idd:local-review:batch-3 -->

**Date**: 2026-06-03
**Scope**: `src-tauri/src/` app shell — command registration, global state, the OAuth/install
callback server, path resolution, and storage helpers
**Files reviewed**:

| File | Lines |
|---|---|
| `main.rs` | 5 |
| `lib.rs` | 692 |
| `state.rs` | 43 |
| `callbacks.rs` | 466 |
| `window.rs` | 86 |
| `storage_paths.rs` | 59 |
| `store.rs` | 3 |
| `project_repo_paths.rs` | 208 |
| `short_path_names.rs` | 212 |
| `constants.rs` | 10 |
| `insecure_github_app_config.rs` | 8 |
| **Total** | **~1,792** |

**Review focus (per Rust Review Strategy)**: command registration, global state, progress
event emitters, path resolution, and a close look at `insecure_github_app_config.rs`.

---

## Executive Summary

| Severity | Count |
|---|---|
| Critical (C) | 0 |
| Security (S) | 0 |
| Major (M) | 1 |
| Minor (m) | 4 |
| **Total** | **5** |

A clean shell. Command registration is centralized and compile-checked, the callback
server's CSRF handling is correct, and `insecure_github_app_config.rs` is exactly what its
name and comment say — a non-secret, env-overridable broker URL (no finding).

The one Major is a familiar pattern: **`check_internet_connection` is a synchronous command
that does a 3-second blocking network call on the IPC thread** — the same Standard V
violation just fixed for the org-invite command (Batch 2 M2). The minors are surface- and
robustness-level: a registered-but-unused Stronghold plugin, an unbounded dropped-file read,
and two small hardening gaps in the localhost callback server.

---

## Findings

---

### M1 — `lib.rs:160-176`

**`check_internet_connection` blocks the IPC thread on a synchronous network call**

```rust
#[tauri::command]
fn check_internet_connection() -> bool {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(3))
        .build() ...;
    client.get("https://github.com") ... .send() ...   // blocking, on the IPC thread
}
```

This is a non-`async` command performing a blocking `reqwest` GET (up to a 3s timeout)
directly on the command thread. It is invoked from `offline-connectivity.js:15`
(`await invoke("check_internet_connection")`). Every other I/O-bound command in the app
(all of `lib.rs`'s AI commands, the GitHub commands after Batch 2 M2) runs its blocking
work inside `spawn_blocking`. This one does not, so a slow or hung connection freezes the
IPC path for up to 3 seconds.

This is the same class of issue as Batch 2 **M2** (the org-invite command) and a violation
of the constitution's **Standard V (IPC Non-Blocking)**.

| Fix | Description | Rationale |
|---|---|---|
| **A ✓** | Make it `async` and wrap the client build + request in `tauri::async_runtime::spawn_blocking`, mapping the join error like the AI commands | Takes the blocking network call off the IPC thread; matches every sibling |

**Recommended**: A

---

### m1 — `lib.rs:486-493`

**The Stronghold Tauri *plugin* is registered (with a SHA-256 password hook) but unused**

```rust
.plugin(
    tauri_plugin_stronghold::Builder::new(|password| {
        Sha256::digest(password.as_bytes()).to_vec()
    })
    .build(),
)
```

Registering this plugin exposes the `plugin:stronghold|*` command surface to the webview
and installs a password-hashing hook. But **nothing in `src-ui/` calls the Stronghold
plugin** (a repo-wide search for `stronghold` in the frontend returns nothing), and the
backend's actual secret storage uses the `Stronghold` *struct* directly in
`ai_secret_storage.rs` (`use tauri_plugin_stronghold::stronghold::Stronghold;`) — which does
not require the plugin to be registered.

So this is dead registration: unnecessary IPC surface for the renderer, plus a second,
unrelated SHA-256 password scheme sitting next to the one in `ai_secret_storage.rs` that a
future reader will assume is connected (it isn't). Note: the weak KDF here is *not* a new
finding — it mirrors the accepted F-VIII tradeoff — the point is the registration appears
to serve nothing.

| Fix | Description | Rationale |
|---|---|---|
| **A ✓** | Confirm no Tauri capability/permission config grants `stronghold:*` to the webview and no JS path uses it, then remove the `tauri_plugin_stronghold::Builder` plugin registration. Keep the direct `Stronghold` struct usage in `ai_secret_storage.rs`. | Removes unused renderer surface and a misleading second password scheme |
| B | If the plugin must stay for a reason not visible here, add a comment explaining why it is registered despite no JS usage | Documents the intent |

**Recommended**: A after verification

---

### m2 — `window.rs:22-62`

**`read_local_dropped_file` reads an arbitrary path with no size limit**

The command reads any file path the renderer supplies and returns it base64-encoded. The
arbitrary-read capability itself is acceptable under the product threat model (the renderer
is trusted; this backs drag-and-drop import). The gap is the **absence of a size cap**: a
very large dropped file is read fully into memory and base64-encoded (~33% larger) before
crossing the IPC boundary, which can spike memory and stall the UI. There is also no
guard that the extension is one the app actually imports (the MIME map falls back to
`application/octet-stream` for anything).

| Fix | Description | Rationale |
|---|---|---|
| **A ✓** | Check `metadata.len()` against a sane cap (e.g. the largest supported import) and return a clear error above it, before reading | Bounds memory and IPC payload; gives the user an actionable message |
| B | Additionally reject extensions outside the supported import/image set | Tightens the surface; optional |

**Recommended**: A

---

### m3 — `callbacks.rs:114-141`

**Callback server has no socket read timeout; a stalled connection blocks all later callbacks**

`spawn_callback_server` runs a single-threaded `listener.incoming()` accept loop, and
`extract_request_target` calls a blocking `stream.read(...)` with no read timeout. The
server runs on its own OS thread (`lib.rs:698`), so it does not block the app — but a single
client that connects to `127.0.0.1:45873` and never sends a complete request will block the
accept loop, so **no subsequent OAuth / GitHub-App-install callback can be processed until
the app restarts**. On localhost the realistic trigger is a misbehaving browser/extension
rather than an attacker, but it is a real liveness gap.

| Fix | Description | Rationale |
|---|---|---|
| **A ✓** | Set `stream.set_read_timeout(Some(Duration::from_secs(_)))` before reading; on timeout, write a 408 and move on | Keeps the accept loop live; minimal change |
| B | Handle each accepted connection on a short-lived thread | More robust under concurrent connects; larger change |

**Recommended**: A (B if concurrent callbacks ever matter)

---

### m4 — `callbacks.rs:173-185`

**Request target is parsed from a single `read()` that may not contain the whole request line**

`extract_request_target` reads once into an 8 KiB buffer and parses the first line. A
TCP read can return fewer bytes than sent, so a request whose first line is split across
segments would yield a truncated target and a spurious 400. For a localhost redirect this
is unlikely, but it is a latent robustness bug.

| Fix | Description | Rationale |
|---|---|---|
| **A ✓** | Read in a loop until a `\r\n` (end of request line) is seen or the buffer cap is hit | Correct regardless of TCP segmentation |
| B | Document the single-read assumption if it is considered safe for localhost | Lower effort; preserves current behavior |

**Recommended**: A

---

## Fix Groups

### FG-1 — IPC responsiveness
**Priority**: Medium (contains M1) · **Findings**: M1
`lib.rs`. Move `check_internet_connection` off the IPC thread (mirror the Batch 2 M2 fix).

### FG-2 — Surface reduction
**Priority**: Low–Medium · **Findings**: m1, m2
Remove the unused Stronghold plugin; bound the dropped-file read.

### FG-3 — Callback server hardening
**Priority**: Low · **Findings**: m3, m4
`callbacks.rs`. Read timeout + full request-line read on the localhost callback socket.

---

## Swallowed / Non-Fatal Error Pass

Per the strategy's per-batch requirement, every `let _ =`, `.ok()`, `.unwrap_or(...)`, and
`if let Err` site in the batch was classified. **No non-fatal defect signals found** — all
are correctly either *expected silence* or *user-visible elsewhere*:

- **Expected silence**: best-effort UI event emits (`callbacks.rs:147/151`, `lib.rs:505/509/513`),
  response stream `write_all`/`flush` to a possibly-disconnected client (`callbacks.rs:169/170`),
  window focus/show/background cosmetics (`window.rs:8-10`, `lib.rs:693`), debug-log rotation
  best-effort (`lib.rs:313/314`), and dir-entry skips (`project_repo_paths.rs:140`).
- **Intended signal**: `check_internet_connection`'s `unwrap_or(false)` (`lib.rs:175`) — a
  network failure *is* the offline result, not a swallowed error.
- **`lib.rs:687`** `let _ = app.set_menu(menu)?;` is not a swallow — the `?` propagates the
  error; the `let _ =` only discards the `Ok` value.
- **One mild note (not a finding)**: `project_repo_paths.rs:27`
  `read_local_repo_sync_state(...).ok().flatten()` silently degrades to folder-name matching
  if a sync-state file is unreadable/corrupt. Acceptable as best-effort repo identification.

## What Was Done Well

- **`main.rs` is minimal** — entry point calls `gnosis_tms_lib::run()` only, as documented.
- **Centralized, compile-checked command registration** — every command is registered in the
  single `generate_handler!` in `lib.rs`; a missing handler fails to compile.
- **AI commands are uniformly `async` + `spawn_blocking`** with actionable join-error messages.
- **Menu wiring is consistent** — menu IDs (`sync-with-server`, `error-reporting`,
  `check-for-updates`) map to events emitted to the main window, which the frontend listens
  for (`events.js`).
- **Callback server CSRF handling is correct** — pending state is single-use (`.take()`) and
  compared to the returned `state` before acting; the install/auth handlers fail closed on
  missing state, token, login, or installation id.
- **No reflected XSS in callback HTML** — response pages interpolate only static strings; the
  GitHub `login` goes into the emitted *event* message, never the HTML.
- **`short_path_names.rs`** — thorough sanitization, truncation, and case-insensitive dedup,
  with good unit coverage.
- **`storage_paths.rs` / `project_repo_paths.rs`** — consistent installation-scoped layout;
  repo resolution prefers `resource_id` over folder name (covered by a test).
- **Updater public key is embedded at compile time** (`include_str!`) for signature
  verification (full updater review is Batch 12).
- **Callback server runs on a dedicated thread** (`std::thread::spawn`), so its blocking
  accept loop never touches the async runtime.
- **`insecure_github_app_config.rs`** — the "insecure" name is intentional and documented; it
  is a non-secret broker URL with an env override. No finding (consistent with the Batch 1
  note on `INSECURE_GITHUB_APP_BROKER_BASE_URL`).

---

## Resolution Status

All findings are **Open / Proposed** as of 2026-06-03.

| Finding | Status | Notes |
|---|---|---|
| M1 | Open | `check_internet_connection` → async + `spawn_blocking` |
| m1 | Open (verify) | Remove unused Stronghold plugin after confirming no capability/JS use |
| m2 | Open | Size-cap `read_local_dropped_file` |
| m3 | Open | Read timeout on the callback socket |
| m4 | Open | Read the full request line regardless of TCP segmentation |

---

*Manual review following the Rust Review Strategy, Batch 3. Findings produced by direct
reading of the eleven files plus their callers (`offline-connectivity.js`,
`project-import-flow.js`, `ai_secret_storage.rs`).*
