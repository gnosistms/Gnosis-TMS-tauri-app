# Code Review — Batch 10a: Chapter Editor Core
<!-- vt.idd:local-review:batch-10a -->

**Date**: 2026-06-10
**Status**: Complete. S1, M1, m1 resolved on `fix/batch-10a-review-findings`;
m2 deferred (see Resolution status).
**Scope**: editor load/save command bodies, row field three-way merge, row structure
(insert/lifecycle/permanent delete, order-key allocation), and the shared editor
helpers (word counts, language sanitization, row projection).
**Files**:

| File | Lines | Reviewed? |
|---|---:|---|
| `project_import/chapter_editor/mod.rs` | 1,669 | ✅ (types + load/init/purge commands; ~430 lines are tests) |
| `project_import/chapter_editor/shared.rs` | 765 | ✅ |
| `project_import/chapter_editor/row_fields.rs` | 1,230 | ✅ |
| `project_import/chapter_editor/row_structure.rs` | 474 | ✅ |
| **Total** | **~4,138** | (strategy said ~3,680; files have grown) |

Also traced (not in batch scope, needed for findings): `git_commit.rs` (commit
helper + write-access gate), `project_import/project_git.rs` (git/file helpers,
`find_chapter_path_by_id`, `repo_relative_path`), `project_import.rs` command
wrappers, `src-ui/app/editor-persistence-flow.js` (`rebaseRowTextInputForRun`,
base/local map construction).

**Strategy correction**: `chapter_editor/` contains two files the strategy never
listed — `chapter_selection.rs` (536) and `images.rs` (1,121). They are slotted
into the strategy as a new session **10d** so they don't fall through the cracks.
`images.rs` handles base64 upload, filenames, and on-disk file removal
(`remove_repo_file_from_disk`) — review it with finding S1 below in hand, since it
shares the unvalidated-id path pattern.

---

## Executive Summary

| Severity | Count |
|---|---|
| Critical (C) | 0 |
| Security (S) | 1 |
| Major (M) | 1 |
| Minor (m) | 2 |
| **Total** | **4** |

The editor core is in good shape where the strategy expected danger: the row-level
three-way merge (`merge_editor_string_maps_by`) is correct and well tested, including
the subtle cases (intentional clears vs. never-materialized blanks, footnote-marker
normalization before comparison). Order-key allocation honors the F-VII invariants
(32-char lowercase hex, midpoint insertion, explicit exhaustion error). The findings
are boundary problems, not algorithm problems: `row_id` flows into file paths without
validation — the exact pattern Batch 8 fixed for team-metadata ids (S1) — and every
mutation command writes files before the commit-time write-access/session gate runs,
so a failed gate strands a dirty working tree that breaks later pulls (M1).

---

## Preliminary per-batch checks

### Standard V sweep — ✅ clean
No `#[tauri::command]` exists inside `chapter_editor/`; all editor entry points are
`async fn` + `tauri::async_runtime::spawn_blocking` wrappers in `project_import.rs`
(the `*_sync` suffix convention marks the blocking bodies). The mechanical grep finds
zero synchronous commands in this batch's call graph.

### Swallowed / non-fatal error pass

| Site | Pattern | Classification |
|---|---|---|
| `shared.rs:6`, `mod.rs:988,1054`, `row_structure.rs:142,198,274` — `rev-parse HEAD .ok()` | `.ok()` | Expected — `chapter_base_commit_sha` is legitimately absent on a repo with no commits. |
| `mod.rs:1189` — `let _ = upsert_local_repo_sync_state(...)` | `let _ =` | Expected silence — best-effort sync-state bookkeeping at repo init; worst case the repo re-reconciles as never-synced. |
| `shared.rs:49,85` — word-count cache persist failures | `if let Err` | Expected silence by design (documented): viewers without write access are a clean no-op; the summary falls back to recomputing. Debug-only stderr is appropriate. |
| `shared.rs:162,166` — rollback best-effort restore/reset | `let _ =` | Expected — already inside a failure path; the original error is preserved and returned. |
| `row_fields.rs:437` — `let _ = clear_imported_editor_conflict_entry(...)` after a successful save | `let _ =` | **Non-fatal defect signal** — the save succeeded but a stale conflict overlay would persist in the UI with no developer visibility. Recommend a small Tauri event routed through `telemetry.js` (stable name e.g. `editor-conflict-entry-clear-failed`, scrubbed error string only — the entry id is a UUID, no content). |
| `row_fields.rs:119-121` — footnote marker `parse().ok().filter(...).unwrap_or(...)` | `.ok()` | Expected — lenient parse of user-authored footnote labels, falls back to positional numbering. |

### Write-access / permission gating
Content writes gate through `ensure_repo_allows_writes` inside
`git_commit_as_signed_in_user_with_metadata` (`git_commit.rs:84`) as the backend
guide specifies — every mutation in this batch reaches it. However, the gate runs
**after** the command body has already written files and staged them; see M1.
`persist_chapter_source_word_counts_batch` (`shared.rs:108`) is the one path that
checks the gate *first* and rolls back on failure — it is the model the others
should follow. Read paths (`load_gtms_chapter_editor_data`, `load_gtms_editor_row`,
`list_local_gtms_project_files`) are correctly ungated.

---

## Findings

### S1 — `row_id` is interpolated into file paths without validation (read/write/delete outside the chapter)

**Severity**: Security
**Files**: `row_fields.rs:230-232,717-719,799-801,941-943`,
`row_structure.rs:100-102,219-221`, `mod.rs:1020-1022`

Every row command builds `chapter_path/rows/{row_id}.json` directly from the
client-supplied `row_id`. Nothing rejects path separators or `..`, so a crafted
`row_id` traverses:

- **Within the repo** (`../../<other-chapter>/rows/x`): `repo_relative_path`'s
  `strip_prefix` succeeds, so the command reads, rewrites, **commits**, or — via
  `permanently_delete_gtms_editor_row_sync` (`row_structure.rs:235`) —
  **deletes from disk** a row belonging to a different chapter than the one named
  in the input.
- **Outside the repo**: `repo_relative_path` does fail — but several commands only
  call it *after* mutating the file. `update_gtms_editor_row_field_flag_sync` writes
  at `row_fields.rs:747` and resolves the relative path at `:749`;
  `apply_gtms_editor_ai_review_result_sync` writes at `:866` before `:867`;
  `update_gtms_editor_row_text_style_sync` writes at `:966` before `:968`;
  `update_gtms_editor_row_lifecycle_sync` writes at `row_structure.rs:168` before
  `:170`; and `permanently_delete` removes the file at `:235` before `:249`. Any
  JSON file on disk that satisfies the (loose) shape checks can be modified or
  removed before the command errors.

The caveat from Batch 8 applies equally here: the webview is trusted app code, so
exploitation requires a compromised frontend. Batch 8 classified the identical
pattern in `team_metadata_local` as Security and fixed it
(`9bb2de65 Validate team-metadata resource ids before path resolution`); the editor
layer was not covered by that fix. Parity says this gets the same treatment.

| Fix | Description |
|---|---|
| **A ✓** | Add a `validated_row_json_path(chapter_path, row_id)` helper that rejects empty ids and any id containing `/`, `\`, or `..` (row ids are UUIDs; a strict charset check `[0-9a-zA-Z_-]` is simplest), and route all eight call sites through it. Mirrors the Batch 8 fix. |
| B | Defense in depth: resolve `repo_relative_path` (the escape check) *before* the first write in the five late-check commands listed above. Cheap reordering, worth doing alongside A. |

### M1 — Mutation commands strand a dirty working tree when the commit gate fails

**Severity**: Major
**Files**: all mutation paths in `row_fields.rs` and `row_structure.rs`
(e.g. `row_fields.rs:396-422,646-656,747-769,866-885,1049-1059`,
`row_structure.rs:46-66,168-192,235-268`)

Every editor mutation follows *write file(s) → `git add` → commit helper*, and the
commit helper is where the write-access snapshot check and the signed-in-session
check live (`git_commit.rs:84-86`). Both checks can fail in normal operation — a
degraded GitHub App installation, or a session that expired/signed out mid-edit
("Sign in with GitHub before creating local commits."). When they do, the command
returns an error but the modified row files remain on disk and staged. Consequences:

- The next pull/rebase in that repo fails or refuses ("local changes would be
  overwritten"), wedging background sync until something cleans the tree.
- Multi-file commands are worse: `clear_gtms_editor_reviewed_markers_sync` and
  `update_gtms_editor_row_fields_batch_sync` write *N* files before the single
  commit, and the batch path can also fail midway through its own loop (a missing
  row file at `row_fields.rs:599` aborts after earlier rows were already written —
  those aren't even staged).
- The stranded content silently diverges from what the user sees after the error
  (the UI reverts the optimistic state; the disk doesn't).

`persist_chapter_source_word_counts_batch` (`shared.rs:97-169`) demonstrates the
codebase already considers this a hard requirement for read-path writes — its
comment says the repo "must not be able to leave the repo dirty" and it implements
check-first + full rollback. The user-initiated mutation paths have strictly higher
stakes and no such protection.

| Fix | Description |
|---|---|
| **A ✓** | Hoist the cheap preflight to the top of each mutation command: `ensure_repo_allows_writes(app, &repo_path)` + the signed-in-session check (both are local file reads) before the first `write_text_file`. This eliminates the two *expected* failure modes. |
| B | For residual failures (git identity, git itself), capture original file contents and roll back written files + `git reset -q --` on commit error, as the word-count batch helper does. Most valuable for the two multi-file commands. |

### m1 — Stale safety comment on the word-count batch helper

**Severity**: Minor
**File**: `shared.rs:104-107`

The comment justifying the rollback design states "the commit helper commits
everything staged (no pathspec)", but `git_commit_as_signed_in_user_with_metadata`
*does* pass a pathspec (`git_commit.rs:142-144`, `commit -- <paths>`), and every
caller in this batch supplies one. The rollback itself is still correct and needed
(a leftover dirty file breaks later pulls), but the stated reason — sweep into
unrelated commits — is no longer how the helper behaves. In a data-integrity-critical
layer the safety comments should match the mechanism, especially since M1's fix will
likely be modeled on this helper.

### m2 — Row save cost scales with chapter size

**Severity**: Minor
**Files**: `row_fields.rs:235` (`load_word_counts` on every save),
`project_git.rs:164-197` (`find_chapter_path_by_id` reads every `chapter.json`)

Every single-row save re-reads **every row file in the chapter** to rebuild the
word-count map (then applies a delta to it), and every editor command linearly scans
all chapter folders, parsing each `chapter.json`, to resolve the chapter path. For a
multi-thousand-row chapter this makes each autosave O(chapter) in file reads plus a
`git log` for version metadata. The saves are serialized through the frontend queue,
so slow saves back up the queue rather than racing. Given the recent effort to cache
`source_word_count` precisely so list refreshes stop re-reading rows, the save path
deserves the same treatment eventually — e.g. compute the response's word counts
from the delta against the counts the editor already holds, or cache per-chapter
counts. Not urgent; flagged so the cost is a decision, not an accident.

---

## Observations (not findings)

- **Three-way merge contract**: a key missing from the local map whose base value is
  non-empty is treated as an intentional clear (`merge_editor_string_maps_by`). The
  frontend upholds this by always sending complete maps
  (`cloneRowFields(currentRow.fields)` / `rebaseRowTextInputForRun`,
  `editor-persistence-flow.js:290-309`), but nothing on the Rust side documents
  that a partial map silently erases languages. Worth a doc comment on the merge
  helpers; a future caller sending only the edited language would corrupt data
  quietly.
- **Order-key hygiene**: `parse_order_key_hex` accepts uppercase hex (and a leading
  `+` via `from_str_radix`) while generation emits lowercase and all ordering is
  lexicographic — a stored uppercase key would sort differently than it parses.
  The app never generates such keys; only a concern if foreign tools write rows.
- **No backend serialization of git operations**: editor writes are serialized by
  the frontend queue (`invokeQueuedEditorWriteCommand`), but a background sync
  (pull) and an editor commit in the same repo can still race at the `index.lock`
  level. Worth keeping in mind when reviewing 10b/`git_conflicts.rs`, which is where
  sync-time conflicts land.
- **Batch replace has no concurrency check**: `update_gtms_editor_row_fields_batch_sync`
  blindly overwrites (no base maps), unlike the single-row save. Acceptable today
  because all local writers funnel through the same queue and remote changes arrive
  via git merge, but the asymmetry is undocumented.
- **Debug logging prints document content** (`log_row_save_merge_conflict` dumps
  base/local/current field maps). Correctly gated to `cfg!(debug_assertions)` —
  fine, just don't lift the gate.
- **`insert_gtms_editor_row_sync` returns pre-insert word counts**
  (`row_structure.rs:77` uses the rows loaded before the insert). Correct only
  because a new row is always empty; a comment would keep it that way.
- Direct `git_output(... "rev-parse" ...)` calls in `mod.rs:988,1054` duplicate the
  `current_repo_head_sha` helper used elsewhere — trivial consistency nit.

---

## Resolution status

| Finding | Status | Notes |
|---|---|---|
| S1 | Resolved | `validated_row_json_path` (single-component allowlist, mirrors the Batch 8 fix) routes all row-path constructions; the repo-relative escape check now runs before the first write in the late-check commands. Unit tests added. |
| M1 | Resolved | New `ensure_local_commit_preconditions` (write access + session) runs before the first write via `write_row_files_and_commit`, which also rolls back written files and unstages on any later failure. Batch and clear-reviewed-markers prepare all updates before writing; permanent delete preflights and restores deletions from the index on commit failure. |
| m1 | Resolved | `persist_chapter_source_word_counts_batch` refactored onto `write_row_files_and_commit`; comment now states the real hazard (stranded dirty chapter.json breaks pulls). |
| m2 | Deferred | Needs a design decision (chapter-level count cache or response-contract change so saves return deltas) — both touch the frontend contract. Out of scope for a findings branch; revisit if large-chapter save latency surfaces. |

---

*Manual review following the Rust Review Strategy, Batch 10 session 1 of 4 (10a).
The S1 late-write ordering was verified line-by-line in each command body; the M1
gate placement was verified against `git_commit.rs:84-86`; the merge-contract
observation was verified against the frontend payload construction in
`editor-persistence-flow.js`.*
