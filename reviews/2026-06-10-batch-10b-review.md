# Code Review — Batch 10b: Git Conflict Resolution + History
<!-- vt.idd:local-review:batch-10b -->

**Date**: 2026-06-10
**Status**: Review complete. Findings not yet resolved.
**Scope**: semantic conflict resolution for editor rows and chapter metadata
(`git_conflicts.rs`), and the editor's git-history surface — field history, history
restore, batch-replace undo, and row version metadata (`history.rs`).
**Files**:

| File | Lines | Reviewed? |
|---|---:|---|
| `project_import/chapter_editor/git_conflicts.rs` | 1,686 | ✅ (~700 logic, ~360 tests) |
| `project_import/chapter_editor/history.rs` | 1,262 | ✅ (~900 logic, ~250 tests) |
| **Total** | **~2,948** | (strategy said ~2,720; files have grown) |

Also traced (not in batch scope, needed for findings): `project_repo_sync.rs`
(`build_semantic_conflict_resolution_plan` / `apply_semantic_conflict_resolution_plan`
— the rebase-time callers), `project_import.rs` history/undo command wrappers,
`installation_access.rs` (`ensure_installation_allows_chapter_writes`),
`images.rs` (`with_repo_file_rollback` and the snapshot helpers history depends on),
and the 10a `validated_row_json_path` / `write_row_files_and_commit` helpers.

---

## Executive Summary

| Severity | Count |
|---|---|
| Critical (C) | 0 |
| Security (S) | 1 |
| Major (M) | 1 |
| Minor (m) | 2 |
| **Total** | **4** |

The semantic merge — the file the strategy flagged as one of the two most
algorithmically dense — is in genuinely good shape. The three-way row merge, the
chapter-metadata merge, the "remote wins on overlap" scalar rule, the safer-on-
disagreement flag merge, and the deletion-wins lifecycle rule are all consistent and
backed by a strong test suite; derived `source_word_count` is correctly dropped so it
recomputes post-merge. The conflict *journaling* (write remote to disk, keep local in
a git-dir journal, overlay both for the editor) is a clean design. The history reader
parses `cat-file --batch` framing defensively (size-overflow and truncation checks)
and only trusts GitHub noreply emails for author logins.

The findings are the same two boundary problems 10a had, in the files 10a didn't
touch — plus two smaller items. `history.rs` builds row paths from an unvalidated
`row_id` (S1, the 10a fix didn't reach here), and the batch-replace undo writes N row
files with no rollback if the commit fails (M1) — while `restore_*` in the same file
demonstrates the correct rollback pattern.

---

## Preliminary per-batch checks

### Standard V sweep — ✅ clean
No `#[tauri::command]` lives in either file. All entry points are `async fn` +
`spawn_blocking` wrappers in `project_import.rs` (`load_gtms_editor_field_history`,
`restore_gtms_editor_field_from_history`, `reverse_gtms_editor_batch_replace_commit`);
the conflict resolvers are called only from `project_repo_sync.rs`, already off the
IPC thread. Mechanical grep finds zero synchronous commands.

### Swallowed / non-fatal error pass

| Site | Pattern | Classification |
|---|---|---|
| `history.rs:117` — `let _ = apply_editor_text_style_update(...)?` | `let _ =` on a `?` expr | Expected — the `?` propagates errors; the `let _` only discards the `(style, changed)` tuple, which is recomputed below. Not a swallowed error. |
| `history.rs:163` — `.unwrap_or(true)` on field-changed check | `unwrap_or` | Expected — a missing field defaults to "changed", which conservatively clears the preview cache. |
| `history.rs:482-485,966-973` — `parts.next().unwrap_or_default()` | `unwrap_or` | Expected — tolerant parsing of git's own `%x1f`-delimited log format; the commit sha (the one load-bearing field) is validated non-empty before use. |
| `git_conflicts.rs` `*.unwrap_or_default()` field reads | `unwrap_or` | Expected — absent language fields legitimately default to empty before the three-way merge. |
| `git_conflicts.rs:1325-1327` — `current_unix_timestamp` `.ok().map().unwrap_or(0)` | `.ok()` | Expected — a pre-epoch clock yields timestamp 0; the value is advisory journal metadata. |
| `project_repo_sync.rs:939` — `repo_has_imported_editor_conflicts(...).unwrap_or(false)` | `unwrap_or` | **Borderline** — a journal read failure is treated as "no conflicts", which could let a sync proceed as if clean. Out of this batch's file scope (it's a sync-side call), but worth a glance in a future `project_repo_sync` pass; the `:1031` caller uses `?` correctly. |

No site in the two batch files needs a new telemetry event.

### Write-access / permission gating
History reads (`load_gtms_editor_field_history`) are ungated — correct. The two
mutating commands (`restore_*`, `reverse_*`) preflight
`ensure_installation_allows_chapter_writes` in the wrapper before the sync body runs,
and the repo-level `ensure_repo_allows_writes` still runs inside the commit helper.
Note the wrapper gate is **installation-scoped** (`ensure_installation_allows_content_writes`),
not repo-scoped — it catches the common "this installation can't write content" case
early but is not a substitute for the repo check (which stays in the commit helper).
This matters for M1: the early gate narrows, but does not close, the dirty-tree window.

---

## Findings

### S1 — `history.rs` builds row paths from an unvalidated `row_id`

**Severity**: Security
**Files**: `history.rs:22-24` (`load_gtms_editor_field_history_sync`),
`history.rs:65-67` (`restore_gtms_editor_field_from_history_sync`)

Both commands construct `chapter_path/rows/{row_id}.json` straight from the
client-supplied `input.row_id` — the exact pattern 10a finding S1 fixed everywhere in
`row_fields.rs` / `row_structure.rs` / `mod.rs`, but `history.rs` is a 10b file and was
not in that change set, so the two history sites still interpolate the raw id. A
crafted `row_id` containing `..` traverses to another chapter's row (or, for the
read-only history command, to any `*.json` under the repo — its contents then flow out
through `git show <commit>:<path>`). `restore_*` additionally **writes and commits** the
resolved file, so traversal there is a write primitive.

Same trust caveat as 10a: the webview is trusted app code, so exploitation needs a
compromised frontend. But this is a literal coverage gap in an already-shipped fix, and
the helper already exists.

| Fix | Description |
|---|---|
| **A ✓** | Route both sites through the existing `validated_row_json_path(&chapter_path, &input.row_id)` from `shared.rs` (already `pub(super)`, reachable via `use super::*`). One-line change each; drop the now-redundant `if !row_json_path.exists()` ordering concerns since validation precedes existence. |

### M1 — Batch-replace undo strands written rows when the commit fails

**Severity**: Major
**File**: `history.rs:306-453` (`reverse_gtms_editor_batch_replace_commit_sync`),
specifically the write loop at `:389` and the commit at `:417-439`

The undo writes each restored row file to disk inside the loop (`write_text_file`,
`:389`), accumulates the paths, then `git add` + commits once (`:413-439`). There is no
rollback: if the commit fails — expired/absent session ("Sign in with GitHub before
creating local commits."), missing git identity, repo-level write-access loss, or a
mid-loop `write_text_file` failure after earlier rows were written — the modified row
files are left on disk (and, post-`add`, staged). That dirty tree then breaks the next
pull/rebase in the repo, the same wedge 10a M1 documented.

The wrapper's early `ensure_installation_allows_chapter_writes` catches the *common*
no-content-write case before any write, which narrows the window — but the
session/identity/repo checks all run late, inside the commit helper, so the window is
real. Tellingly, the **sibling command in this same file** — `restore_*` — does this
correctly: it snapshots the affected files and wraps the write+commit in
`with_repo_file_rollback` (`history.rs:194-285`), which restores disk and index on any
error. The undo path simply doesn't.

| Fix | Description |
|---|---|
| **A ✓** | Route the undo through the 10a `write_row_files_and_commit` helper: build a `PreparedRowFileWrite` per restored row (with `original_text` = the current on-disk text already read at `:372`), and let the helper preflight the gates, write-all, commit, and roll back on any failure. This also fixes the mid-loop stranding (prepare-all-then-write) and removes the manual `git add` + `rev-parse` dance. |
| B | Alternatively, wrap the existing loop in `with_repo_file_rollback` with per-row snapshots, matching `restore_*`. A is preferred for consistency with the 10a fix and because it preflights rather than writes-then-rolls-back. |

### m1 — IPC `commit_sha` flows into git revision args unguarded

**Severity**: Minor
**File**: `history.rs:328-330,368,628,673-682,783-786`

`restore_*` and `reverse_*` take a `commit_sha` from IPC and splice it directly into
git revision arguments: `git rev-parse {sha}^`, `git log --format=%H {sha}..HEAD`,
`git show {sha}:{path}`, `git show -s --format=%B {sha}`, `git show {parent}:{path}`.
None validate the sha or use a `--` end-of-options guard, so a value beginning with `-`
is parsed as an option rather than a revision. These are all read-only plumbing
commands, so the blast radius is small (a malformed/over-broad read or an error, not a
write), and the frontend only ever sends shas the backend returned — but a
compromised-webview value like `--output=...` or `-S...` is worth denying by
construction.

| Fix | Description |
|---|---|
| **A ✓** | Validate `commit_sha` as a hex object id (e.g. `^[0-9a-fA-F]{7,64}$`) at the top of both commands before any git call — cheap and matches the S1 "validate ids from IPC" posture. |
| B | Where the form allows it, separate options from revisions (e.g. `git show -s --format=%B -- <sha>` is not valid for a rev, but `rev-parse --verify <sha>^{commit}` first, then use the resolved full oid downstream). A is simpler and sufficient. |

### m2 — Local-only edits to non-merge row fields make the whole rebase unresolvable

**Severity**: Minor
**File**: `git_conflicts.rs:979-991` (`local_row_change_is_unsupported`),
`:1007-1068` (`strip_supported_row_merge_keys`)

The semantic row merge only knows how to merge a fixed set of fields (order_key,
lifecycle.state, and per-language plain_text/footnote/image_caption/image/flags).
`local_row_change_is_unsupported` strips those, then refuses (errors out the entire
rebase resolution) if the local stage still differs from both base and remote in any
*other* field. Notably, `editor_comments` and `editor_comments_revision` live in the
row file and are **not** in the supported set — so a row that the local user added a
comment to, when the remote also edited that row's text, trips the "unsupported
local-only changes remain" error and aborts the semantic resolution for the whole
pull. The user is pushed to manual conflict handling for what is, semantically, two
independent edits (a comment and a translation).

This is a conservative-by-design refusal, not a data-loss bug — and comment+text
collisions on the same row may be rare. But comments are a first-class editor feature
and a plausible coincidence during active review.

| Fix | Description |
|---|---|
| **A** | Add `editor_comments` / `editor_comments_revision` to `strip_supported_row_merge_keys` and merge them (append/union by `comment_id`, max of revisions) the way the other slices are merged. Largest change; best UX. |
| **B ✓** | Cheaper interim: strip comments from the "unsupported" comparison and take one side deterministically (remote, consistent with the scalar rule) so a comment edit no longer blocks the merge, with the known tradeoff that a concurrently-added local comment may be dropped. Document whichever is chosen. |
| C | At minimum, document the limitation (a code comment on `strip_supported_row_merge_keys` listing what intentionally is *not* merged and why it blocks). |

---

## Observations (not findings)

- **Three-way row merge structure is sound**: both `remote_value` and `local_value`
  start from the remote stage's JSON (`git_conflicts.rs:683-684`) and then overlay
  their respective per-slice maps, so the journaled "local" row carries remote's
  non-field attributes — which is consistent precisely because any divergence in those
  attributes would have already errored via `local_row_change_is_unsupported` (see m2).
  Both sides receive the same merged order_key and lifecycle, so the two journal rows
  never disagree on position.
- **`merge_field_flags` is safer-on-disagreement** (both sides touched → `reviewed:false,
  please_check:true`). Good call for a review tool; well tested.
- **`cat-file --batch` history read** (`history.rs:804-916`) is the efficient path
  (one subprocess for all commits) and validates object type, size overflow, and output
  truncation before slicing — careful work on a binary protocol.
- **`author_login_from_email`** only derives a login from `users.noreply.github.com`
  addresses, ignoring arbitrary domains — avoids attributing commits to a spoofed login.
- **Journal is stored in the git dir** (`imported_editor_conflict_journal_path` →
  `resolve_repo_git_dir`), so it travels with the repo but never commits — correct for
  transient local conflict state.
- **Sync-side apply writes git-derived paths** (`apply_semantic_conflict_resolution_plan`
  `fs::write` on the unmerged-stage path). The path originates from git's index, not
  IPC, and git rejects traversal in index entries, so this is lower-risk than the S1
  IPC path — not flagged, but noted for the eventual `project_repo_sync` review.
- **`build_editor_field_history_entries` dedupe** keeps the oldest present revision as
  the baseline and collapses unchanged intermediates, including style/footnote-only
  changes — the test suite pins these edge cases well.

---

## Resolution status

| Finding | Status | Notes |
|---|---|---|
| S1 | Open | |
| M1 | Open | |
| m1 | Open | |
| m2 | Open | |

---

*Manual review following the Rust Review Strategy, Batch 10 session 2 of 4 (10b). The
S1 path-construction sites were verified line-by-line; the M1 rollback gap was verified
by contrast with `restore_*`'s `with_repo_file_rollback` usage in the same file and the
wrapper-level gate in `project_import.rs`; the m2 refusal was traced through
`strip_supported_row_merge_keys` against `StoredRowFile`'s `editor_comments` fields.*
