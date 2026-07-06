# Repo Migration System Hardening Plan

> **Status (2026-07-05): COMPLETE.** All five phases implemented on
> `fix/repo-migration-hardening` (one commit per phase). Phase 5.2 (version
> compare dedup) was absorbed by the Phase 3 registry refactor, which deleted
> the dead resolver along with its private copies; Phase 5.4 (stale comment)
> was absorbed by the Phase 1 move of the normalizer into
> `chapter_editor/shared.rs`. Phase 4.2 deviates from the sketch below:
> no backup branch is created — the worktree is verified clean (including
> untracked files) before an in-place layout migration starts, so
> `reset --hard` + `clean -fd` on failure provably restores the starting
> state and a branch of HEAD would add nothing but litter.

## Summary

A code review of the repo versioning/migration system (2026-07-05, covering
`repo_migrations.rs`, `repo_layout_metadata.rs`, `repo_app_version.rs`,
`team_repo_migrations.rs`, both sync modules, and the frontend migration flow)
found one blocker and nine hardening items. The blocker — the 0.8.56
chapter-settings migration never ran for head-equal repos because
`inspect_project_repo_state` did not force `outOfSync` for it — is already
fixed with a regression test
(`snapshot_forces_transport_sync_while_chapter_settings_migration_pends`).

This plan covers the remaining findings, ordered by risk. Each phase is
independently shippable; none blocks the 0.8.56 release, but Phases 1–2
should land soon after it because they close recurrence paths for the exact
bug 0.8.56 fixes.

## Phase 1 — Normalize legacy chapter-settings shapes at the write site

**Finding:** The 0.8.56 migration is one-shot. A teammate still on ≤0.8.55 can
make local commits that write `"settings": null` / `"linked_glossaries": null`
(the version gate blocks their sync, not their local commits). After they
update, those commits push into a repo whose `appliedMigrations` already
contains `0.8.56`, so the nulls are never normalized again and the targeted
chapter.json updaters fail with "not a JSON object" — permanently.

**Fix:** Defense at the read/write site. In the targeted chapter.json
updaters in `src-tauri/src/project_import/chapter_editor/` (the code paths
that error with "The chapter settings are not a JSON object" / "The chapter
linked glossaries are not a JSON object"):

1. Extract `normalize_chapter_settings_value` from `repo_migrations.rs` into a
   shared location both call sites can use (e.g. `chapter_editor/shared.rs`,
   re-exported for the migration).
2. Before rejecting a non-object `settings`/`linked_glossaries`, run the
   normalizer on the loaded chapter value. If it changed the value, proceed
   with the edit on the normalized shape (the subsequent write persists it).
3. Keep the hard error only for shapes the normalizer cannot repair
   (e.g. `settings` is a string with meaningful-looking content — today it
   drops any non-object; that stays correct because only `null` shapes were
   ever produced by our serializers).

**Tests:** Unit test the updater against a chapter file with
`"settings": null` and with `"linked_glossaries": null` — both must succeed
and leave normalized JSON on disk. Keep the existing migration tests green.

## Phase 2 — Make unreadable repo metadata fail safe

**Finding:** `repo_requires_0810_migration` treats a metadata *parse error*
the same as *missing metadata* (`Ok(None) | Err(_) => true`,
`repo_migrations.rs`). If a future app ever bumps `schemaVersion` past 1, or
the file is corrupted, an older client concludes the repo needs the 0.8.10
**layout rewrite** and will rename folders in data it cannot read. The only
guard is the commit-trailer version gate, which fails open when the remote
head commit lacks a trailer (GitHub web edits, merge commits, external
tools). `repo_requires_0856_migration` has the opposite semantics
(`Err(_) => false`) — the asymmetry itself is a trap for future migrations.

**Fix:**

1. Introduce a three-state read in `repo_layout_metadata.rs`:
   `Missing`, `Readable(RepoLayoutMetadata)`, `Unreadable(String)`.
2. `repo_requires_0810_migration` / `ref_requires_0810_migration` /
   `repo_requires_0856_migration`: `Missing` keeps today's behavior
   (0810 → true, 0856 → false). `Unreadable` returns a hard error that
   surfaces as a sync error naming the metadata file — never "migrate".
3. Callers (`sync_repo`, `clone_repo`, `sync_project_repo`,
   `inspect_project_repo_state`, `team_repo_migrations.rs`) propagate the
   error into the existing `syncError` snapshot status rather than panicking
   or migrating.
4. Add a test: metadata with `schemaVersion: 2` must produce a sync error,
   not a migration attempt, in both the 0810 and 0856 checks.

**Note:** Do not change the trailer gate itself in this phase; it stays a
best-effort early warning. Phase 2 makes the metadata file the authoritative
line of defense, which is the correct layering (the metadata travels with the
data; trailers only describe the last writer).

## Phase 3 — Drive migration dispatch from the registry (kill the dead code)

**Finding:** `ordered_repo_migrations()`, `RepoMigrationDecision`, and
`resolve_pending_repo_migrations` are `#[cfg_attr(not(test), allow(dead_code))]`
— production dispatch is hand-wired per call site. That is exactly how the
0.8.56 migration got wired into `sync_project_repo` but missed
`inspect_project_repo_state` and the fresh-clone path.

**Fix:**

1. Define a migration descriptor the registry returns:
   `{ id, applies_to: RepoKind bitset, forces_out_of_sync: bool, run: fn }`.
2. Replace the per-site `repo_requires_0810_migration` /
   `repo_requires_0856_migration` calls with one
   `pending_repo_migrations(repo_path, repo_kind) -> Result<Vec<&Descriptor>>`
   used by: both snapshot functions, `sync_repo`, `clone_repo`,
   `sync_project_repo`, and `team_repo_migrations.rs`.
3. The 0810 layout migration keeps its special orchestration
   (adopt-remote / discard flow / modal scan) via a flag on the descriptor;
   content migrations like 0856 run inline in registry order.
4. Delete `resolve_pending_repo_migrations` or wire it in as the
   implementation of the above — either way, no more test-only "design".
5. Adding migration N+1 must require touching exactly two places: the
   registry entry and its `run` function. Verify by writing a no-op test
   migration in a unit test that shows every dispatch site picks it up.

**Scope note:** This is the largest phase (touches ~6 files) and is pure
refactor — behavior must be identical before/after. Do it in its own PR with
no functional changes mixed in.

## Phase 4 — Migration robustness (smaller backend items)

1. **Corrupt chapter.json must not brick sync.**
   `migrate_project_repo_to_0856` propagates `read_json_value` errors, so one
   unparseable file fails every future sync of the repo. Change to
   skip-and-report: collect per-file errors, emit a telemetry event (via the
   existing non-fatal backend error event path), still record the marker if
   at least the parse-able files were normalized. A file we cannot parse is a
   file the normalizer has nothing to fix.
2. **Mid-flight 0810 failure wedges the repo.** In-place layout migration
   renames chapter folders before committing; a failure partway leaves a
   dirty worktree that `ensure_clean_repo_for_layout_migration` then blocks
   with advice ("save or discard") the user cannot follow. Create a backup
   branch first (reuse `create_project_head_backup_branch`), and on failure
   `reset --hard` + `clean -fd` back to the pre-migration state so the next
   attempt starts clean.
3. **Serialize sync entry points per repo.** The reconcile path guards
   against double-sync via the `SYNCING` snapshot store, but the editor sync
   path (`sync_gtms_project_editor_repo_sync`) does not consult it — two git
   processes can race on the same repo (`index.lock` failures; migration
   `status --porcelain` → `add -A` TOCTOU can also sweep a concurrent editor
   write into a migration commit). Add a per-repo-path mutex map in Rust that
   both entry points lock around the git-mutating section.

## Phase 5 — Frontend/consistency cleanups

1. **Stop hardcoding the migration target version in JS.**
   `TEAM_REPO_LAYOUT_MIGRATION_TARGET_VERSION = "0.8.10"` in
   `team-resource-migration-flow.js` keys the persisted clean-verdict cache;
   a future modal-class migration that forgets to bump it is silently skipped
   forever. Key the verdict on the `targetVersion` the backend scan already
   returns: perform the (cheap) local-only part of the scan decision by
   fetching the backend target version first, or persist the verdict keyed by
   the last scan's returned `targetVersion` and invalidate when the backend
   value differs.
2. **Deduplicate `compare_app_versions`/`parse_version_parts`** — identical
   copies in `repo_migrations.rs` and `repo_app_version.rs`. Keep the
   `repo_app_version.rs` copy, import it from `repo_migrations.rs`.
3. **Typo:** "Syncronizing" → "Synchronizing" in three user-visible modal
   strings in `team-resource-migration-flow.js`.
4. **Stale test comment** in `repo_migrations.rs`
   (`normalize_chapter_settings_leaves_modern_files_untouched`): it calls
   `"glossary": null` "the current cleared-link shape", but since the
   skip-serializing fix the current serializer omits the key. Keep the
   behavior (tolerate null), fix the comment.

## Explicitly out of scope / accepted

- **Trailer gate reads only the last commit** (fails open on trailer-less
  commits from GitHub web UI / merges). Accepted: Phase 2 makes metadata the
  authoritative guard; scanning more history costs a git call per sync for
  marginal benefit.
- **Version-gate lockout on release** (first 0.8.56 client to sync each repo
  stamps a head commit that blocks all ≤0.8.55 clients until they update).
  This is the system working as designed; note it in the 0.8.56 release
  notes/support docs rather than changing behavior.
- **serde_json key reordering** when migrations rewrite chapter.json
  (alphabetized keys vs. struct order): cosmetic one-time diff churn,
  consistent with what 0.8.10 already did.

## Sequencing

| Phase | Risk closed | Size | Depends on |
|---|---|---|---|
| 1 — write-site normalization | Recurrence of the 0.8.56 bug | S | — |
| 2 — fail-safe metadata reads | Old client rewriting future-format data | M | — |
| 3 — registry-driven dispatch | Next migration repeating finding #1 | L | best after 2 |
| 4 — robustness items | Wedged/bricked repos, sync races | M | 4.1 easiest first |
| 5 — cleanups | Latent frontend trap + polish | S | — |

Phases 1, 2, and 5 are independent and can be picked up in any order.
Phase 3 should follow Phase 2 so the registry is built on the three-state
metadata read from the start.
