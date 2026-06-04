<!-- vt.idd:pr-review:pass-1 -->
## Code Review — PR #3: Batch 1 Rust review fixes: Auth & Security

> **Claude Code tip**: Ask here for deeper context on any finding before approving —
> e.g. "walk me through C1 option A", "what files does S1 touch?",
> "combine M2+M3 into one fix". The table rationale is a summary; Claude has
> full diff context.
>
> **Copilot review**: Integrated from review #4414809803. Copilot inline comments mapped: Cp1→M2, Cp2→M3, Cp3→m1, Cp4→m2, Cp5→D1. Manual review comment #4608522751 mapped: P1a→C1, P1b→S1, P2a→M1, P2b→S2.

| Severity | Count | IDs |
|----------|-------|-----|
| Critical (C) | 1 | C1 |
| Security (S) | 2 | S1, S2 |
| Major (M) | 3 | M1, M2, M3 |
| Minor (m) | 2 | m1, m2 |
| Documentation (D) | 1 | D1 |
| **Total** | **9** | |

---

## Findings

<!-- vt.idd:finding:C1 -->
<!-- vt.idd:recommended:C1:A -->
<details>
<summary><strong>C1 — Persisted GitHub login restore is broken after token split</strong> <em>(Critical · FG-1 · gnosistms review)</em></summary>

**C1 — Persisted GitHub login restore is broken after token split** *(Critical · FG-1)*

**File**: `src-ui/app/auth-storage.js:9` + `src-tauri/src/lib.rs:516` + `src-tauri/src/broker_auth_storage.rs:121`

**Description**: `auth-storage.js` still calls `load_broker_auth_session` and reads `session.sessionToken` on startup, but `lib.rs` no longer registers that command — only `get_broker_auth_profile` exists, which intentionally returns no token. On restart the app silently treats stored auth as absent, logging users out every time. This defeats the session-persistence goal of the broker auth flow.

| # | Approach | Rationale | Rec. |
|---|----------|-----------|:----:|
| A | Re-register `load_broker_auth_session` in `lib.rs` alongside `get_broker_auth_profile`; implement it to load the profile JSON and then fetch the session token from keychain, returning a combined session object. JS side unchanged. | Bridges the API gap with minimal blast radius — JS consumers and the existing `state.auth.session.sessionToken` contract remain intact. The keychain lookup is the only new logic. | ✓ |
| B | Update `auth-storage.js` to call `get_broker_auth_profile` and introduce a separate `get_broker_session_token` command; remove all JS references to `session.sessionToken` on the startup path. | Aligns the JS model with the new storage split, but requires auditing every `state.auth.session.sessionToken` reference across the UI — wider change than the severity warrants in this PR. | |
| C | Restore the token to the `get_broker_auth_profile` response by loading it from keychain before serializing. | Conflates profile (public metadata) with session token (secret), defeating the security separation this PR introduced. | |

- [x] A *(recommended)*
- [ ] B
- [ ] C
- [ ] Alternative: *(describe)*

</details>

---

<!-- vt.idd:finding:S1 -->
<!-- vt.idd:recommended:S1:A -->
<details>
<summary><strong>S1 — Installation access cache can authorize writes after sign-out</strong> <em>(Security · FG-2 · gnosistms review)</em></summary>

**S1 — Installation access cache can authorize writes after sign-out** *(Security · FG-2)*

**File**: `src-tauri/src/installation_access.rs:157,173`

**Description**: The function returns a cached `true` authorization snapshot at line 157 before the broker session is loaded at line 173. A cached entry with a current `cached_at` timestamp can pass the write gate for up to 60 seconds after sign-out or after the keychain token goes missing, allowing write operations to proceed without a live session.

| # | Approach | Rationale | Rec. |
|---|----------|-----------|:----:|
| A | Load and validate the broker session before the cache check at line 157; if the session is absent or invalid, return `false` immediately (fail-closed) regardless of cache state. | Direct, minimal, fail-closed. Enforces that authorization always requires a live session; the cache serves as a fast path only when the session is known-good. | ✓ |
| B | Bind the cache to the session: include a session-derived hash (e.g. HMAC of the token) as part of the cache key so a stale cache from a prior session naturally misses on sign-out. | Elegant but introduces new crypto material and complicates cache invalidation; overkill when a pre-check is sufficient. | |
| C | Hook the broker sign-out path to call `invalidate_installation_access_cache()`; clear-on-sign-out prevents stale authorization from persisting. | Addresses the symptom but requires coordinating with the sign-out flow in a separate location; misses the case where the keychain entry disappears without a formal sign-out. | |

- [x] A *(recommended)*
- [ ] B
- [ ] C
- [ ] Alternative: *(describe)*

</details>

---

<!-- vt.idd:finding:S2 -->
<!-- vt.idd:recommended:S2:A -->
<details>
<summary><strong>S2 — Stronghold migration permanently destroys unreadable snapshots</strong> <em>(Security · FG-3 · gnosistms review)</em></summary>

**S2 — Stronghold migration permanently destroys unreadable snapshots** *(Security · FG-3)*

**File**: `src-tauri/src/ai_secret_storage.rs:269`

**Description**: During migration, if neither the new keychain key nor the legacy key can open an existing snapshot, the code removes the snapshot file and creates a fresh one. A transient keychain unavailability (system restart during migration, OS credential store locked, keychain entry temporarily missing) causes saved AI provider secrets and team keypairs to be silently and permanently destroyed.

| # | Approach | Rationale | Rec. |
|---|----------|-----------|:----:|
| A | Replace `fs::remove_file` with a rename to a timestamped `.bak` path (e.g. `stronghold-snapshot.YYYYMMDDHHMMSS.bak`), then propagate an explicit error so the caller can surface a recovery prompt to the user. | Preserves the data for manual recovery, creates a visible audit trail, and forces the error to the surface rather than silently succeeding with data loss. | ✓ |
| B | Propagate the error upward without touching the file; let the caller decide whether to delete, rename, or prompt. | Correctly separates concerns but leaves the deletion decision up to callers who may not all handle it safely. | |
| C | Retain the file in place and return a structured error with the snapshot path included; log a warning with recovery instructions. | Safe, but does not create the `.bak` copy that option A provides — a subsequent successful migration could overwrite the original. | |

- [x] A *(recommended)*
- [ ] B
- [ ] C
- [ ] Alternative: *(describe)*

</details>

---

<!-- vt.idd:finding:M1 -->
<!-- vt.idd:recommended:M1:A -->
<details>
<summary><strong>M1 — Clearing a personal AI key fails silently after backend validation tightening</strong> <em>(Major · FG-3 · gnosistms review)</em></summary>

**M1 — Clearing a personal AI key fails silently after backend validation tightening** *(Major · FG-3)*

**File**: `src-ui/app/ai-settings-flow.js:887,907` + `src-tauri/src/ai_secret_storage.rs:338`

**Description**: The clear-key UI path in `ai-settings-flow.js` detects an empty key at line 887 but still calls `save_ai_provider_secret` with `apiKey: ""` at line 907. The backend now rejects blank values at line 338, so clearing a personal API key through the existing UI returns an error instead of deleting the key. The user sees a failure on a routine action.

| # | Approach | Rationale | Rec. |
|---|----------|-----------|:----:|
| A | In `ai-settings-flow.js`, detect the empty-key case at line 887 and route to `clear_ai_provider_secret` instead of `save_ai_provider_secret`. | Minimal JS change; keeps the backend's strict blank-rejection intact, which is the correct security posture for `save_*`. | ✓ |
| B | Restore blank-means-delete behavior in `ai_secret_storage.rs` by treating an empty `api_key` argument as a deletion request. | Simpler backend fix, but re-introduces ambiguity: an accidental empty save would silently delete rather than error, which is worse for observability. | |
| C | Add a new Tauri command `delete_ai_provider_key` and wire both the clear-key UI path and any empty-submit guard to it. | More explicit API surface, but duplicates functionality already exposed by `clear_ai_provider_secret`; unnecessary unless there is a meaningful semantic difference. | |

- [x] A *(recommended)*
- [ ] B
- [ ] C
- [ ] Alternative: *(describe)*

</details>

---

<!-- vt.idd:finding:M2 -->
<!-- vt.idd:recommended:M2:A -->
<details>
<summary><strong>M2 — atomic_write() fails on Windows when broker profile already exists</strong> <em>(Major · FG-1 · Copilot)</em></summary>

**M2 — atomic_write() fails on Windows when broker profile already exists** *(Major · FG-1 · Copilot)*

**File**: `src-tauri/src/broker_auth_storage.rs:30`

**Description**: `atomic_write()` uses `fs::rename()` to place the `.tmp` file. On Windows, `std::fs::rename` fails with an error if the destination path already exists. After the first successful profile save, every subsequent update will fail, leaving the old profile in place and potentially leaving `.tmp` files behind.

| # | Approach | Rationale | Rec. |
|---|----------|-----------|:----:|
| A | Before `fs::rename(&tmp_path, &path)`, call `let _ = fs::remove_file(&path)` (ignoring `ENOENT`); then rename. | One-line fix, no new dependencies. This is the canonical cross-platform pattern for atomic file replacement when `rename` is used directly. | ✓ |
| B | Extract the pre-remove + rename pair into a shared `atomic_write(src, dst)` helper in `util.rs` and call it from both `broker_auth_storage.rs` and `installation_access.rs` (see M3). | Eliminates duplication between M2 and M3, but couples the two fix groups; only worthwhile if both are being fixed in the same pass. | |
| C | Wrap the rename in a retry: on failure, `remove_file` destination and retry once before returning the error. | Adds complexity for no benefit over A; the pre-remove and rename can already be done atomically in sequence. | |

- [x] A *(recommended)*
- [ ] B
- [ ] C
- [ ] Alternative: *(describe)*

</details>

---

<!-- vt.idd:finding:M3 -->
<!-- vt.idd:recommended:M3:A -->
<details>
<summary><strong>M3 — atomic_write() fails on Windows when installation snapshot already exists</strong> <em>(Major · FG-2 · Copilot)</em></summary>

**M3 — atomic_write() fails on Windows when installation snapshot already exists** *(Major · FG-2 · Copilot)*

**File**: `src-tauri/src/installation_access.rs:347`

**Description**: Same Windows rename semantics issue as M2, but in the installation access snapshot writer. Snapshot refreshes will error on the second write, blocking the cache update and potentially preventing the write gate from seeing fresh authorization state.

| # | Approach | Rationale | Rec. |
|---|----------|-----------|:----:|
| A | Same pre-remove pattern as M2-A: `let _ = fs::remove_file(&path)` before `fs::rename`. If M2 extracted a shared `atomic_write()` helper to `util.rs`, call it here instead of duplicating. | Consistent fix with M2; the `util.rs` reuse note keeps the door open for deduplication without forcing it. | ✓ |
| B | Use `tempfile::NamedTempFile::persist()`, which handles Windows rename semantics internally via `MoveFileExW(MOVEFILE_REPLACE_EXISTING)`. | Correct and idiomatic, but adds a new dependency and is heavier than a one-line pre-remove. | |
| C | Apply only the minimal pre-remove fix to this file, independent of M2. | Correct, but leaves two copies of the same pattern in the codebase. | |

- [x] A *(recommended)*
- [ ] B
- [ ] C
- [ ] Alternative: *(describe)*

</details>

---

<!-- vt.idd:finding:m1 -->
<!-- vt.idd:recommended:m1:A -->
<details>
<summary><strong>m1 — Unconditional diagnostic logging leaks scope identifiers in production</strong> <em>(Minor · FG-4 · Copilot)</em></summary>

**m1 — Unconditional diagnostic logging leaks scope identifiers in production** *(Minor · FG-4 · Copilot)*

**File**: `src-ui/app/repo-write-queue.js:46`

**Description**: `logRepoWriteDiagnostic()` emits `console.info` on every queue event (queued/running/succeeded/failed), unconditionally. In production this is noisy and includes internal scope identifiers (installation ID, project ID, repo slug) that a user or third-party browser extension could observe in DevTools.

| # | Approach | Rationale | Rec. |
|---|----------|-----------|:----:|
| A | Gate `logRepoWriteDiagnostic()` behind a `DEBUG_REPO_WRITE` flag checked via `localStorage` (e.g. `localStorage.getItem('gnosis:debug:repoWrite')`). | Consistent with the opt-in debug pattern already present elsewhere in the codebase; available for troubleshooting without always emitting in production. | ✓ |
| B | Remove the diagnostic logging entirely. | Loses the troubleshooting value the logging was added for; too aggressive. | |
| C | Strip the scope identifiers from the log entries, keeping operation type and status only. | Reduces information leakage but still produces noisy logs in production; does not solve the volume problem. | |

- [x] A *(recommended)*
- [ ] B
- [ ] C
- [ ] Alternative: *(describe)*

</details>

---

<!-- vt.idd:finding:m2 -->
<!-- vt.idd:recommended:m2:A -->
<details>
<summary><strong>m2 — High-frequency editor write logging includes chapter/row identifiers</strong> <em>(Minor · FG-5 · Copilot)</em></summary>

**m2 — High-frequency editor write logging includes chapter/row identifiers** *(Minor · FG-5 · Copilot)*

**File**: `src-ui/app/editor-queued-write.js:171`

**Description**: `invokeQueuedEditorWriteCommand()` logs start/success/failure via `console.info` for every queued write, unconditionally. These events are high-frequency during active editing and include chapter and row identifiers.

| # | Approach | Rationale | Rec. |
|---|----------|-----------|:----:|
| A | Same debug-flag gate as m1: check a `gnosis:debug:editorWrite` localStorage key before emitting. | Symmetric with m1; consistent opt-in pattern across the two write-queue logging sites. | ✓ |
| B | Remove the logging. | Loses troubleshooting value; same concern as m1-B. | |
| C | Reduce to a single per-operation counter log (no identifiers), only on failure. | Compromise, but inconsistent with the pattern in m1-A and harder to use for diagnosing queue ordering issues. | |

- [x] A *(recommended)*
- [ ] B
- [ ] C
- [ ] Alternative: *(describe)*

</details>

---

<!-- vt.idd:finding:D1 -->
<!-- vt.idd:recommended:D1:A -->
<details>
<summary><strong>D1 — PR title and description do not reflect UI/editor scope</strong> <em>(Documentation · FG-6 · Copilot)</em></summary>

**D1 — PR title and description do not reflect UI/editor scope** *(Documentation · FG-6 · Copilot)*

**File**: PR description (title + body)

**Description**: The PR title ("Batch 1 Rust review fixes: Auth & Security") and description focus entirely on authentication and security. The PR also includes substantial JS/editor changes: repo write queue prioritization, pending-local-save UX, navigation/close guards, and WordPress clipboard serialization. This mismatch complicates rollback scoping and reviewer mental model.

| # | Approach | Rationale | Rec. |
|---|----------|-----------|:----:|
| A | Update the PR title to reflect both tracks (e.g. "Batch 1: Auth/security hardening + editor write durability") and add a brief summary of the UI/editor changes to the description body. | Accurate scope description reduces reviewer confusion and makes rollback targeting unambiguous. | ✓ |
| B | Keep the title; add a collapsible "Also included: UI/editor changes" section to the description body. | Lower friction, but the title still misleads anyone triaging by title alone (e.g. in git log or release notes). | |
| C | Accept the current description. | Not recommended — the scope mismatch is large enough to affect rollback and bisect decisions. | |

- [x] A *(recommended)*
- [ ] B
- [ ] C
- [ ] Alternative: *(describe)*

</details>

---

## Fix Groups

**FG-1** — `broker_auth_storage.rs` · `auth-storage.js` · `lib.rs` · C1, M2 · _Soft boundary (shared file, different regions)_

> Fix C1 before M2 — C1 adds the `load_broker_auth_session` command to `lib.rs`; M2 modifies `broker_auth_storage.rs:30`. Both changes touch the auth storage module but at non-overlapping locations.

- [ ] Fix
- [ ] Acknowledge
- [ ] Defer

---

**FG-2** — `installation_access.rs` · S1, M3 · _Soft boundary (same file, different regions: line 157 vs line 347)_

- [ ] Fix
- [ ] Acknowledge
- [ ] Defer

---

**FG-3** — `ai_secret_storage.rs` · `ai-settings-flow.js` · S2, M1 · _Soft boundary (shared file, different functions)_

> S2 modifies the migration path; M1 modifies the save path. Both touch `ai_secret_storage.rs` at non-overlapping call sites. Fix S2 first — the migration error handling sets the expected behavior that M1's UI routing should be consistent with.

- [ ] Fix
- [ ] Acknowledge
- [ ] Defer

---

**FG-4** — `repo-write-queue.js` · m1 · _Hard boundary_

- [ ] Fix
- [ ] Acknowledge
- [ ] Defer

---

**FG-5** — `editor-queued-write.js` · m2 · _Hard boundary_

- [ ] Fix
- [ ] Acknowledge
- [ ] Defer

---

**FG-6** — PR description · D1 · _Hard boundary_

- [ ] Fix
- [ ] Acknowledge
- [ ] Defer

---

<!-- vt.idd:pr-review:approve -->
## Approve and Proceed

All findings reviewed? Check the box to authorize fix execution.

- [ ] **Approve and proceed** — I have reviewed all findings and dispositions above. Execute fixes per the checked dispositions.
<!-- /vt.idd:pr-review:approve -->

<!-- vt.idd:pr-review:pass-1 -->
