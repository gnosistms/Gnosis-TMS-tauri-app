# Code Review — Batch 6: Glossary & QA Sync
<!-- vt.idd:local-review:batch-6 -->

**Date**: 2026-06-03
**Status**: Complete. One Major finding (parity-symmetric across both files), open for fix.
**Scope**: per-domain glossary and QA-list repo sync, reviewed **together for parity**
**Files**:

| File | Lines | Reviewed? |
|---|---:|---|
| `glossary_repo_sync.rs` | 992 | ✅ |
| `qa_list_repo_sync.rs` | 991 | ✅ |
| **Total** | **~1,983** | |

**Review focus (per Rust Review Strategy)**: review the two together for **parity** —
divergence in sync behavior between glossaries and QA lists is a latent bug (F-VII / AGENTS.md
parity rule). Also the standard per-batch checks, and consistency with the Batch 5
`project_repo_sync.rs` findings (M1 write-access gate, M2 first-sync backup).

---

## Parity result — ✅ excellent

A token-normalized diff of the two files (mapping `glossary`/`qa_list`/`QaList`/… → a common
token) is **clean apart from the constant-name prefixes** (`GLOSSARY_*` vs `QA_LIST_*`, same
values) and **one trivial test line-wrap**. Both files expose the same 24 functions in the same
order with identical logic. Parity is honored as well as anywhere in the codebase — any fix
below must be applied **symmetrically to both files**.

## Preliminary per-batch checks

### Standard V sweep (synchronous commands doing I/O)
Each file has 3 `#[tauri::command]` functions, all `async`, each wrapping its git work in
`tauri::async_runtime::spawn_blocking` (3 async / 3 spawn_blocking per file). ✅ No command
performs git/network I/O on the IPC thread.

### Swallowed / non-fatal error pass
- `clone_*_repo:840` — `let _ = git_output(repo_path, &["checkout", "-B", &branch_name], None)`
  runs **only when the remote head is empty** (freshly created empty remote on a fresh clone),
  so there is no local work to lose. Benign.
- The normal sync path surfaces rebase failures via `abort_rebase_after_failed_pull` (aborts
  the rebase and returns the error). Surfaced, not swallowed.
- No non-fatal **defect signals** requiring a telemetry event.

---

## Findings

### M1 — Old-layout discard recovery lacks a backend write-access gate (both glossary and QA)

**Severity**: Major (data integrity)
**Files / lines**:
- `src-tauri/src/glossary_repo_sync.rs:315-367` (`discard_old_layout_gtms_glossary_repos_sync`)
- `src-tauri/src/qa_list_repo_sync.rs` (`discard_old_layout_gtms_qa_list_repos_sync`, identical)

This is the **direct parity-analog of Batch 5 M1**, which was fixed for projects in PR #22 but
**not propagated to glossaries or QA lists.**

`discard_old_layout_gtms_glossary_repos_sync` resolves each repo path, then calls the shared
destructive helper `discard_local_old_layout_changes_and_adopt_remote` (line 354), which resets
the local working copy to the remote and discards local old-layout changes. Neither the async
command wrapper nor the `_sync` body calls any backend write-access guard
(`ensure_repo_allows_writes` / `ensure_installation_allows_glossary_writes` /
`ensure_installation_allows_qa_list_writes`) before that destructive local adoption. A
repo-wide search confirms **no `ensure_*_writes` call exists anywhere in either file.**

Same framing as Batch 5 M1: this is **local data integrity**, not remote tampering — the
operation only mutates the local checkout (no push), so a read-only user can't alter shared
data with it. The risks are (1) **local data loss** — a direct Tauri invocation, bypassing the
UI's confirmation, can discard local glossary/QA work; and (2) **consistency** — projects now
gate this exact recovery path, but glossaries and QA lists don't, which is itself a parity
violation against the just-merged project fix.

**Recommended fix** (apply symmetrically to both files):
- Add a backend write-access check before the destructive adoption. The `_sync` functions
  already have `input.installation_id`, so the domain-correct gate is
  `ensure_installation_allows_glossary_writes(app, input.installation_id)?` /
  `ensure_installation_allows_qa_list_writes(app, input.installation_id)?` (these exist in
  `installation_access.rs`; all content-write gates resolve to the same content-write check, so
  this is functionally equivalent to the `ensure_repo_allows_writes` used by the project fix —
  the resource-named gate is just clearer here). Place it before the loop, or per-repo after
  path resolution.
- Add tests covering permission denial for the old-layout discard flow in **both** glossary and
  QA modules (mirroring the project fix's coverage).

---

## What was NOT a problem (and why M2 does not apply)

- **No Batch 5 M2 analog.** Glossary/QA sync has no "attach a locally-initialized repo to
  remote" path and no force-overwrite recovery. `sync_*_repo` clones when the repo is absent and
  otherwise does `pull --rebase` + `push`, aborting (and surfacing the error) on rebase failure —
  it never force-adopts remote over a divergent local head. This is **safer** than the project
  sync model, so there is no silent-commit-loss path to guard. Good.
- **App-version forward-compat guard present** — `enforce_remote_*_app_version` is called before
  adopting remote changes in both the sync and clone paths, matching `project_repo_sync.rs`.
- **No overwrite-conflict command** here (projects have one); not needed given the safer model.

---

## Resolution status

| Finding | Status | Notes |
|---|---|---|
| M1 | Open | Add `ensure_installation_allows_glossary_writes` / `_qa_list_writes` before the destructive old-layout discard in both files; add permission-denial tests. Parity-symmetric. |

---

*Manual review following the Rust Review Strategy, Batch 6. Parity verified via a
token-normalized full-file diff; findings cross-checked against the Batch 5 project-sync
findings (M1/M2) and their PR #22 fixes.*
