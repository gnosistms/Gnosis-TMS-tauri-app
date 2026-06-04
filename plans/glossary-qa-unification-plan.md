# Plan: Unify Glossary + QA-List Behind One Resource Framework

## Status

Proposed — 2026-06-03. Trigger condition met (Batch 6 sync + Batch 7 storage both reviewed).
Implementation by GPT, phased; reviewed by Claude per phase.

## Motivation

Glossary and QA-list code is **near-mirror-duplicated** across two layers:

| Layer | Files | Duplication |
|---|---|---|
| Sync | `glossary_repo_sync.rs` / `qa_list_repo_sync.rs` (~2,000 lines) | Batch 6 confirmed: token-normalized diff clean apart from constant prefixes + one test wrap. 24 identical functions. |
| Storage | `glossary_storage/` vs `qa_list_storage/` (~4,470 lines) | Batch 7: `io.rs` + `terms.rs` identical; `mod.rs`/`tmx.rs` share all scaffolding and diverge only on the bilingual-vs-monolingual domain model. |

That duplication is the direct cause of two ongoing costs:
- **The "review for parity" rule** (strategy doc) exists solely to catch drift between the copies.
- **Every finding is fixed twice.** Batch 6 M1 (write-access gate) and Batch 7 m1 (atomic writes)
  each had to be applied to two near-identical files. The next such finding will too.

Unifying makes the parity rule unnecessary (one implementation can't drift from itself) and
collapses ~6,000+ duplicated lines to one shared engine plus thin per-domain glue. The
**frontend already did this** (`src-ui/app/repo-resource/`); the backend hasn't caught up.

## Goals

- One shared implementation of the glossary/QA **sync** state machine and **storage**
  scaffolding (lifecycle, gating, commit, file layout, repo resolution).
- Per-domain code reduced to the genuinely-divergent bits (the bilingual term/TMX model) plus
  thin Tauri command wrappers.
- **Zero behavior change** and **zero on-disk format change** — this is an internal refactor.

## Non-goals

- **No on-disk format change** — `glossary.json` / `qa-list.json` / term files / TMX stay as-is.
- **No behavior change** — pure restructuring; existing tests must pass unchanged (or with only
  mechanical signature edits).
- **Project sync is out of scope.** `project_repo_sync.rs` is more complex (first-sync attach,
  conflict-overwrite recovery, semantic editor conflicts) and is *not* a mirror of glossary/QA.
  It can adopt shared primitives opportunistically later, but it is **not** unified here.
- **No frontend change** — the JS `repo-resource/` framework already exists.
- **`team_metadata_local`** (Batch 8) is a separate layer; not in scope.

## What is shared vs per-domain

### Genuinely per-domain (stays specialized)
- **Resource identity:** `RepoKind::Glossary` vs `::QaList` (already exists, Batch 4), content
  file name (`glossary.json` vs `qa-list.json`), Tauri command names.
- **Domain model:** glossaries are **bilingual** (source + target language, term *variants* /
  multiple segments per language); QA lists are **single-language** with simpler entries. This is
  the only substantive logic difference (it's why `tmx.rs`/`mod.rs` differ in size).
- **Typed records:** `Stored{Glossary,QaList}File` / `Stored*TermFile` / language-info shapes,
  and the `*RepoSyncDescriptor` / `*RepoSyncInput` / `*Response` types.

### Shared (collapses to one implementation)
- **All of sync** — `sync_repos`, `sync_editor_repo`, `discard_old_layout_repos`, `sync_repo`,
  `clone_repo`, `ensure_origin_remote`, `enforce_remote_app_version`, `mark_repo_synced`,
  `inspect_repo_state`, `snapshot_from_sync_error`, `find_repo_path`, status constants
  (currently duplicated `GLOSSARY_*`/`QA_LIST_*` with **identical values** → one shared set).
- **All of `io.rs` and `terms.rs`** (already byte-identical modulo a constant).
- **Storage scaffolding in `mod.rs`** — lifecycle (initialize / rename / soft-delete / restore /
  purge), write-access gating, commit path, repo/file layout, term file read/skip-malformed.

## Design

A `RepoResource` trait carries the per-domain knobs; the shared sync + storage logic is generic
over it. Sketch (names illustrative):

```rust
pub(crate) trait RepoResource {
    const KIND: RepoKind;
    const CONTENT_FILE: &'static str;             // "glossary.json" / "qa-list.json"
    type SyncDescriptor;                          // per-domain descriptor
    fn ensure_management_allowed(app: &AppHandle, installation_id: i64) -> Result<(), String>;
    fn ensure_writes_allowed(app: &AppHandle, installation_id: i64) -> Result<(), String>;
    fn local_repo_root(app: &AppHandle, installation_id: i64) -> Result<PathBuf, String>;
    // domain hooks for the bilingual/monolingual differences:
    fn parse_tmx(file_name: &str, bytes: &[u8]) -> Result<Self::ParsedImport, String>;
    fn export_tmx(/* domain file */) -> Result<String, String>;
    // ...term-model hooks as needed
}
```

- The shared engine functions become generic: `fn sync_repos<R: RepoResource>(...)`,
  `fn discard_old_layout_repos<R: RepoResource>(...)`, storage lifecycle helpers, etc.
- **Tauri commands stay concrete and separate** (they need distinct names for `invoke()` and
  `generate_handler!`): `sync_gtms_glossary_repos` becomes a 1-line wrapper calling
  `sync_repos::<GlossaryResource>(...)`; same for QA. This preserves the registered command
  surface and the frontend contract exactly.
- Preserve or deliberately update non-command Rust consumers. `team_repo_migrations.rs`
  currently imports `find_glossary_repo_path` and `find_qa_list_repo_path`, so the
  implementation should keep those wrappers or update that caller when `find_repo_path` becomes
  generic.
- Generics (monomorphization) keep it zero-cost and avoid dynamic dispatch.

The bilingual TMX/term model stays per-domain behind trait methods (`parse_tmx` / `export_tmx`
and the term-shape hooks), since that is the real divergence — don't force a single term model.

## Phasing (each phase independently shippable + reviewable)

1. **Sync unification.** Collapse `glossary_repo_sync.rs` + `qa_list_repo_sync.rs` into one
   generic engine + two thin command-wrapper modules. Lowest risk: Batch 6 proved they're
   near-identical, and the recent M1 fix means they're already in sync. Start here.
2. **Storage scaffolding unification.** Share `io.rs`, `terms.rs`, and the `mod.rs` lifecycle /
   gating / commit / layout via the trait; keep `tmx.rs` parse/export and the term-shape logic
   per-domain behind trait hooks.
3. **(Optional, later)** Deeper term-model unification if it proves worthwhile after Phases 1–2.
   May not be worth it given the genuine bilingual/monolingual difference.

## Risk & safety

- This is the **data-integrity-critical** layer; treat it as a deliberate refactor.
- **Safety net = the existing tests** — sync recovery tests (`project`/glossary/qa), storage
  round-trip + TMX + term-tolerance tests, and the new atomic-write/gate tests from Batches 6–7.
  These must pass unchanged. Add tests for the generic engine once; per-domain behavior is
  exercised through the existing suites.
- No migration: on-disk formats and the IPC command surface are unchanged.
- Land each phase as its own PR; verify `cargo test` green and re-run the parity-relevant checks.

## Acceptance criteria

- Net Rust line reduction in the glossary/QA sync + storage area (one engine, not two copies).
- A future glossary/QA finding is fixable in **one** place, not two.
- All pre-existing tests pass; no behavior or on-disk-format change.
- The strategy doc's "review these two together for parity" guidance for sync/storage can be
  retired (replaced by "review the shared engine + the thin wrappers"); update it when Phase 2 lands.

## References

- `reviews/2026-06-03-batch-6-review.md` (sync parity), `reviews/2026-06-03-batch-7-review.md`
  (storage parity), and the follow-up note in `reviews/Rust_Review_Strategy.md` (Batch 7).
- Frontend precedent: `src-ui/app/repo-resource/`.
- Shared primitives already extracted: `repo_sync_shared.rs` (Batch 4), `repo_layout_metadata.rs`
  (`RepoKind`), `installation_access.rs` (`ensure_installation_allows_{glossary,qa_list}_*`).
