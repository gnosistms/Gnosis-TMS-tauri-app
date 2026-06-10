# Code Review — Batch 8: Team Metadata
<!-- vt.idd:local-review:batch-8 -->

**Date**: 2026-06-10
**Status**: Complete. All five findings resolved on `fix/batch-8-review-findings`
(see `plans/batch-8-review-fixes-plan.md`).
**Scope**: local team-metadata repo management — the metadata-first mutation lifecycle,
record building, repair/tombstone resolution, and the metadata repo's own git lifecycle
**Files**:

| File | Lines | Reviewed? |
|---|---:|---|
| `team_metadata_local.rs` | 636 | ✅ |
| `team_metadata_local/mutations.rs` | 709 | ✅ |
| `team_metadata_local/repair.rs` | 871 | ✅ |
| `team_metadata_local/records.rs` | 104 | ✅ |
| `team_metadata_local/repo.rs` | 226 | ✅ |
| **Total** | **~2,546** | |

(Strategy doc says ~2,475; files have grown slightly since it was written.)

---

## Executive Summary

| Severity | Count |
|---|---|
| Critical (C) | 0 |
| Security (S) | 1 |
| Major (M) | 2 |
| Minor (m) | 2 |
| **Total** | **5** |

The mutation lifecycle is well-gated (management gate in every mutating command body
**plus** `ensure_repo_allows_writes` inside the shared commit helper — double-gated like
Batch 7), all 14 commands are async + `spawn_blocking`, and the repair matcher is careful
about ambiguity (refuses to guess when more than one folder matches). The real problems
are at the edges: **unvalidated `resource_id` reaches `Path::join`** (S1), **one corrupt
record file bricks every listing and the repair scan itself** (M1), and **the metadata
repo has no divergence recovery** — concurrent team writers can wedge it permanently,
and the frontend downgrades that to a `console.warn` (M2).

---

## Preliminary per-batch checks

### Standard V sweep — ✅ clean
Mechanical enumeration (`grep -rzoP "#\[tauri::command\]\n\s*(pub\(crate\) )?fn [a-z_]+"`)
over the batch files returns **zero synchronous commands**. All 14 commands are `async`
and wrap their body in `tauri::async_runtime::spawn_blocking`, mapping the join error to
a clear message. ✅

### Swallowed / non-fatal error pass

| Site | Pattern | Classification |
|---|---|---|
| `team_metadata_local.rs:165,189,213` — `scan_local_*_repo_folders(...).unwrap_or_default()` in the three listing commands | swallowed `Result` | Borderline. Covers the legitimate "repo root doesn't exist yet" case, but also masks real I/O failures — every count silently becomes 0. Cosmetic impact only; **observation**, no telemetry needed. |
| `repair.rs:291,407,533,669` — `read_local_repo_sync_state(...).ok().flatten()` | `.ok()` | Expected silence — missing/corrupt sync state is exactly what the repair layer exists to recover from. |
| `repo.rs:200-206` — `current_branch_name` falls back to `"main"` | `.ok()` + default | Expected silence (fresh clone / detached HEAD edge). |
| `repo.rs:66-71` — `current_origin_remote_url` → `None` | `.ok()` | Expected — "missing origin" is a detected repair issue, not an error. |
| `mutations.rs:574,619,699` — `let _ = git_output(...)?` / `let _ = git_commit_...(...)?` | discarded `Ok` value only | Not swallowed — errors propagate via `?`. |
| Frontend `team-metadata-flow.js:350-358` — push conflict and best-effort sync failures → `console.warn` | fire-and-forget | **Non-fatal defect signal** — see M2. A wedged metadata repo is invisible to both user and developers. Should route through `telemetry.js` (stable operation name + scrubbed message; no org/repo identity needed). |

### Write-access gating — ✅ double-gated
Every mutating command body calls `ensure_installation_allows_{project,glossary,qa_list}_management`,
and commits go through `git_commit_as_signed_in_user_with_metadata`, which runs
`ensure_repo_allows_writes` ([git_commit.rs:84](../src-tauri/src/git_commit.rs)). One gating
asymmetry — see m2.

### Parity — ✅ symmetric, by brute force
The project/glossary/QA triplets (`build_*_record_value`, `inspect_*_repo_repairs`,
`unique_*_record_for_repo_name`, `find_*_repo_for_record`) are token-for-token symmetric
apart from domain fields (`sourceLanguage`/`targetLanguage` vs `language`) and the
glossary/QA embedded-id fallback (projects have no embedded id file — legitimate
asymmetry). But this symmetry is maintained by **triplication**: roughly 70% of
`mutations.rs` and `repair.rs` is the same code three times. This module belongs in the
scope of the post-Batch-7 unification follow-up (the strategy note currently scopes it to
sync + storage; team-metadata records are a third near-mirror surface).

---

## Findings

### S1 — `resource_id` reaches `Path::join` unvalidated → arbitrary `.json` write/delete outside the repo

**Severity**: Security (defense-in-depth; reachable only via IPC from our own webview)
**Files**: `team_metadata_local/repo.rs:108-110` (`resource_record_path`),
`team_metadata_local.rs` upsert/delete commands, `mutations.rs:589-629,676-709`

`resource_record_path` does `resource_directory_path(...).join(format!("{resource_id}.json"))`
with the id taken directly from command input. The upsert/delete commands never validate
it. A `project_id` like `../../../../Users/hans/target` produces a path outside the
metadata repo, and **the lexical guard does not catch it**: `Path::strip_prefix` in
`relative_repo_path` compares components lexically, so
`repo/resources/projects/../../../target.json` still "starts with" the repo prefix and
passes. Consequences:

- `upsert_local_record` runs `fs::create_dir_all` + `fs::write` **before** computing the
  relative path — attacker-controlled JSON written to any `*.json` path the user can write.
- `delete_local_record` runs `fs::remove_file` on the resolved path — arbitrary `.json`
  deletion.
- A traversal that stays inside the repo (e.g. `../../manifest`) additionally gets
  staged and **committed and pushed** to the team's metadata repo.
- `lookup_local_team_metadata_tombstone` reads arbitrary `.json` files (impact limited to
  a boolean).

The exploit requires a compromised/XSS'd frontend, but the editor renders rich
translated content imported from DOCX/HTML, so "the webview only sends well-formed ids"
is not a boundary worth relying on. Same posture as Batch 1's defense-in-depth findings.

| Fix | Description | Rationale |
|---|---|---|
| **A ✓** | Make `resource_record_path` return `Result` and validate the id centrally: trimmed, non-empty, and matching a safe charset (e.g. `[A-Za-z0-9._-]`, rejecting `.`/`..`, path separators). All callers already return `Result<_, String>`. | One choke point fixes upsert, delete, lookup, and repair; matches how `kind` is already allowlisted in `lookup`/`repair`. |

### M1 — One malformed record file fails every listing command *and* the repair scan

**Severity**: Major
**Files**: `team_metadata_local/records.rs:25-41`, used by all three
`list_local_gnosis_*_metadata_records` commands and by
`inspect_and_migrate_local_repo_bindings` / `repair_local_repo_binding`

`list_local_metadata_records` `collect()`s `Result`s, so a single unreadable or
unparsable `*.json` in the records directory fails the whole listing. The record structs
are also strict — most fields are required (`GithubProjectMetadataRecord` has
`#[serde(default)]` only on `chapter_count`), so a record missing one key fails the
parse. Failure modes that produce exactly this: a torn write (see m1 below), a teammate
on a different app version writing a record without a newer required field, or a
hand-edited file. Impact compounds: the projects/glossaries/QA screens all break, **and
the repair tooling breaks too**, because `inspect_and_migrate_local_repo_bindings` and
`repair_local_repo_binding` call the same listing — the layer whose job is recovering
from partial failure cannot run when a record is corrupt.

This contradicts the established tolerance pattern (Batch 2 list-tolerance fix; Batch 7's
per-term-file tolerance in glossary/QA storage).

| Fix | Description | Rationale |
|---|---|---|
| **A ✓** | Skip unparsable record files in `list_local_metadata_records`, emitting a small Tauri event routed through `telemetry.js` (stable op name, e.g. `team-metadata.record.parse-failed`, plus a scrubbed error — no file contents, file name is a resource id so include at most the id). Optionally surface skipped records as a `corruptRecord` repair issue in the inspect scan. | One bad record degrades to one missing row instead of a dead screen; the repair layer regains the ability to see (and eventually fix) the corruption. |
| B | Also add `#[serde(default)]` to non-essential record fields. | Forward-compatibility for schema evolution across app versions. |

### M2 — Team-metadata repo has no divergence recovery; concurrent writers wedge it silently

**Severity**: Major
**Files**: `team_metadata_local/repo.rs:178-226` (`pull_local_metadata_repo` /
`push_local_metadata_repo`), frontend `src-ui/app/team-metadata-flow.js:330-372`

The metadata repo is multi-writer (every manager on the team), but its sync is
ff-only-pull + plain-push with no merge/rebase path. The wedge sequence:

1. Manager B pulls, commits locally; manager A pushes in the race window.
2. B's push fails non-fast-forward → frontend `console.warn`s and **reports success** to
   the caller (`requirePushSuccess` defaults to false).
3. Every subsequent B-side pull now fails (`--ff-only`, diverged), every push fails
   (non-ff). The best-effort sync failure before each mutation is also just warned.
4. B keeps committing on the diverged branch indefinitely. B's listings serve
   increasingly stale teammate data; B's lifecycle writes (including **tombstones**, which
   the metadata-first invariant depends on) never reach the team. Nothing is surfaced to
   the user, and nothing reaches telemetry.

The content-repo sync layer (Batch 5) has explicit divergence handling (backup branch,
recovery flows); the metadata repo — the *authoritative* lifecycle store — has none.
`abort_rebase_after_failed_pull` only cleans up; it does not resolve.

| Fix | Description | Rationale |
|---|---|---|
| **A ✓** | Backend: on ff-only pull failure due to divergence, retry with `pull --rebase origin <branch>`; records are one-file-per-resource JSON, so concurrent edits to *different* resources rebase cleanly (the common case). On rebase conflict (same record), abort and apply record-level last-writer-wins by re-reading both sides — or at minimum return a distinct "diverged" error code. | Restores self-healing for the common concurrent-team case without inventing a new state machine. |
| B | Frontend: stop downgrading push conflicts to `console.warn` — route through `telemetry.js` and surface a "metadata out of sync" indicator so a wedged repo is at least visible. | The current behavior violates "report outcomes faithfully" — the user believes the rename/delete propagated. Do this even if A ships. |

### m1 — Record writes are non-atomic

**Severity**: Minor
**File**: `team_metadata_local/mutations.rs:609-616`

`upsert_local_record` writes the record with a bare `fs::write` (truncate-then-write). A
crash mid-write leaves a torn `*.json` — which, per M1, currently bricks all listings
rather than costing one record. Same class as Batch 1 m3 / Batch 4 m2 / Batch 7 m1;
`util::atomic_replace` exists for exactly this.

| Fix | Description |
|---|---|
| **A ✓** | Write to a sibling `.tmp`, finalize with `util::atomic_replace` — same transform as Batch 7's resolution. |

### m2 — Metadata push is gated by the *project* management capability only

**Severity**: Minor
**File**: `team_metadata_local.rs:621-636`

`push_local_team_metadata_repo` calls `ensure_installation_allows_project_management`,
but the push publishes glossary and QA-list record commits too. An installation whose
project permission is degraded but whose glossary/QA management is intact can create
local glossary/QA metadata commits (their upsert gates pass) that can then never be
pushed — local-only lifecycle state, a mini-M2. The inverse also holds: the
project-management gate alone authorizes publishing glossary/QA mutations. The gate is
defense-in-depth (transport-token auth is the real boundary), so severity is minor.

| Fix | Description |
|---|---|
| **A ✓** | Pass if *any* of the three management gates passes (the push is domain-agnostic), or add a dedicated `ensure_installation_allows_team_metadata_push` that expresses that. |

---

## Observations (not findings)

- **`createdAt`/`updatedAt`/`deletedBy` are never populated by the builders** — they
  preserve an existing value or write `Null`, and no caller supplies them, so records
  created by this code carry null timestamps and a null `deletedBy` forever (while
  `createdBy`/`updatedBy` *are* set from the broker login). If git history is the
  intended time authority, the fields are dead weight; if not, they're silently broken.
  Worth a deliberate decision during the unification refactor.
- **`merge_previous_repo_names` dedupes case-sensitively**, but GitHub repo names are
  case-insensitive — `Repo-A` and `repo-a` can both end up in `previousRepoNames`, and
  the repair matchers (`unique_*_record_for_repo_name`, `candidate_repo_names`) also
  compare case-sensitively. On macOS/Windows (case-insensitive filesystems) a
  differently-cased folder will fail to match its record and show as `strayLocalRepo`.
- **Triplication**: see parity section — add `team_metadata_local` to the scope of the
  planned glossary/QA backend unification.
- `mutations.rs` places `delete_local_record` after the `#[cfg(test)]` module behind
  `#[allow(clippy::items_after_test_module)]` — style only.
- The repair matcher's refusal to repair on ambiguous matches
  (`match_scanned_repo_for_record` erroring on >1 hit) is exactly right for a recovery
  layer — guess-free repair.

---

## Resolution status

| Finding | Status | Notes |
|---|---|---|
| S1 | Resolved | `resource_record_path` validates ids against a single-component allowlist and returns `Result`; traversal regression tests added. |
| M1 | Resolved | Tolerant listing (`TolerantRecordListing`) skips corrupt record files; skips reported via the existing `backend-nonfatal-telemetry` event (`team-metadata.records.list` / `record_parse_failed`). |
| M2 | Resolved | Diverged `--ff-only` pulls retry with a local `git rebase origin/<branch>` (verified against a scratch diverged-clone setup); rebase conflicts abort with a distinct error. Frontend reports swallowed push/sync failures through `telemetry.js`. A visible "metadata out of sync" UI indicator was deferred — with rebase recovery the wedge self-heals on the next pull. |
| m1 | Resolved | `upsert_local_record` writes through the shared atomic `write_text_file` helper. |
| m2 | Resolved | Push accepts any of the three management capabilities with one clear all-denied message. |

---

*Manual review following the Rust Review Strategy, Batch 8. Cross-checked against the
frontend orchestration in `team-metadata-flow.js` (pull/commit/push lifecycle) and the
shared commit gate in `git_commit.rs`. The S1 traversal was verified against
`Path::strip_prefix`'s lexical semantics rather than assumed.*
