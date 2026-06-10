# Rust Review Strategy — src-tauri/src/

**Total**: ~45,700 lines across 65 files  
**Sessions**: 18 (some batches split across multiple sessions)  
**Review order**: Security-sensitive code first, then data integrity, then sync, then business logic

---

## Batch 1 — Auth & Security ★ COMPLETE
*~1,470 lines · 1 session*

```
broker.rs                        (235)
broker_auth.rs                    (93)
broker_auth_storage.rs            (66)
installation_access.rs           (444)
ai_secret_storage.rs             (576)
github/app_auth.rs                (54)
```

Review first. These files own token storage, broker authentication, and GitHub App
installation write-access gating. Any issues here affect the entire trust boundary.

**Review file**: `reviews/2026-06-02-review.md`  
**Findings**: 1 Critical, 4 Security, 7 Major, 7 Minor

---

## Batch 2 — GitHub API Layer COMPLETE
*~1,040 lines · 1 session*

```
github.rs                         (29)
github/orgs.rs                   (406)
github/repos.rs                  (245)
github/types.rs                  (358)
```

The HTTP client surface for all GitHub operations. Focus on error handling,
response tolerance (paginated lists, partial responses), and whether API failures
produce actionable error messages.

**Review record**: PR #7, closed 2026-06-03 after follow-up fixes landed  
**Findings**: 0 Critical, 0 Security, 2 Major, 4 Minor  
**Resolution**: All findings resolved 2026-06-03 via PRs #10, #11, #12, and #13.

---

## Batch 3 — App Shell
*~1,790 lines · 1 session*

```
main.rs                            (5)
lib.rs                           (692)
state.rs                          (43)
callbacks.rs                     (466)
window.rs                         (86)
storage_paths.rs                  (59)
store.rs                           (3)
project_repo_paths.rs            (208)
short_path_names.rs              (212)
constants.rs                      (10)
insecure_github_app_config.rs      (8)
```

Command registration (`lib.rs`), global app state, progress event emitters
(`callbacks.rs`), and path resolution. `insecure_github_app_config.rs` warrants
a close look despite its explicit naming.

---

## Batch 4 — Git Sync Infrastructure
*~1,470 lines · 1 session*

```
git_commit.rs                    (149)
local_repo_sync_state.rs         (233)
repo_sync_shared.rs              (718)
repo_layout_metadata.rs          (191)
repo_app_version.rs              (170)
```

Shared git primitives used by all three sync domains (projects, glossaries, QA
lists). Issues here propagate to all resource sync.

---

## Batch 5 — Project Sync + Migrations
*~3,510 lines · 1 session · REVIEW COMPLETE*

```
project_repo_sync.rs           (2,123)
repo_migrations.rs             (1,114)
team_repo_migrations.rs          (272)
```

The largest single file in the codebase. `project_repo_sync.rs` handles the most
complex sync state machine. Migrations are additive-only — verify that no existing
migration step is modified or reordered.

**Review file**: `reviews/2026-06-03-batch-5-review.md`
**Findings**: 0 Critical, 0 Security, 2 Major, 0 Minor
**Resolution**: Resolved in PR #22 by adding backend write checks for destructive
project recovery and a backup branch for divergent first-sync attach.

---

## Batch 6 — Glossary & QA Sync
*~1,985 lines · 1 session*

```
glossary_repo_sync.rs            (992)
qa_list_repo_sync.rs             (991)
```

Review these two together specifically for parity. Any divergence in sync behavior
between glossaries and QA lists is a latent bug (see foundational-principles.md F-VII
and AGENTS.md parity rule).

---

## Batch 7 — Content Storage
*~4,470 lines · 2 sessions*

### 7a: Glossary Storage (~2,470 lines)

```
glossary_storage/mod.rs        (1,748)
glossary_storage/tmx.rs          (552)
glossary_storage/terms.rs        (108)
glossary_storage/io.rs            (60)
```

### 7b: QA List Storage (~2,000 lines)

```
qa_list_storage/mod.rs         (1,471)
qa_list_storage/tmx.rs           (363)
qa_list_storage/terms.rs         (108)
qa_list_storage/io.rs             (60)
```

Review 7a then 7b, explicitly checking for parity. TMX import/export in both is
a format parsing surface worth scrutiny for malformed input handling.

> **📌 Follow-up after Batch 7 — unify glossary + QA under one resource framework.**
> The glossary and QA-list code is near-mirror-duplicated in both **sync**
> (`glossary_repo_sync.rs` / `qa_list_repo_sync.rs`, ~2,000 lines — confirmed near-identical
> in the Batch 6 review) and almost certainly **storage** (this batch's two `*_storage/`
> trees, ~4,470 lines). That duplication is the reason the "review for parity" rule exists and
> the reason a single finding (e.g. Batch 6 M1) has to be fixed twice. **Do not start the
> refactor before Batch 7 is reviewed** — the storage review completes the picture and informs
> the abstraction. Then: write a `plans/` doc for a trait-parameterized resource framework
> spanning **sync + storage** (shared engine + thin per-domain Tauri command wrappers; scope
> boundary vs. the more-complex `project_repo_sync.rs`; test/migration strategy), and implement
> as a deliberate refactor of the data-integrity-critical layer. The frontend already did this
> (`src-ui/app/repo-resource/`); the backend hasn't caught up.

---

## Batch 8 — Team Metadata REVIEW COMPLETE
*~2,475 lines · 1 session*

```
team_metadata_local.rs           (624)
team_metadata_local/mutations.rs (708)
team_metadata_local/repair.rs    (820)
team_metadata_local/records.rs   (104)
team_metadata_local/repo.rs      (217)
```

The metadata-first mutation lifecycle lives here. `repair.rs` (820 lines) is the
most complex — it handles recovery from partial failures and tombstone resolution.

**Review file**: `reviews/2026-06-10-batch-8-review.md`
**Findings**: 0 Critical, 1 Security, 2 Major, 2 Minor
**Resolution**: All resolved 2026-06-10 on `fix/batch-8-review-findings`
(resource-id validation, tolerant record listing + telemetry, metadata-repo
divergence rebase recovery, atomic record writes, domain-agnostic push gate).

---

## Batch 9 — AI Integration REVIEW COMPLETE
*~5,040 lines · 2 sessions (reviewed in one pass)*

### 9a: AI Core (~3,280 lines)

```
ai/mod.rs                      (2,775)
ai/types.rs                      (437)
ai/providers/mod.rs               (64)
```

### 9b: AI Providers + Settings (~2,425 lines)

```
ai/providers/openai.rs           (969)
ai/providers/gemini.rs           (586)
ai/providers/claude.rs           (268)
ai/providers/deepseek.rs         (267)
team_ai.rs                       (667)
```

Prompt handling, structured output schemas, and streaming responses. Check for
secret leakage in error paths. `team_ai.rs` owns AI settings storage (reviewed
alongside providers for context).

**Review file**: `reviews/2026-06-10-batch-9-review.md`
**Findings**: 0 Critical, 2 Security, 1 Major, 2 Minor
**Resolution**: All resolved 2026-06-10 on `fix/batch-9-review-findings` (Gemini key
moved to header + scrub pattern; content-free malformed-response telemetry; Claude
output cap raised with explicit truncation error; 300s prompt timeout; native JSON
modes on Gemini/DeepSeek — Claude enforcement deferred, documented in review).

---

## Batch 10 — Chapter Editor (the deep end)
*~8,450 lines · 3 sessions*

### 10a: Editor Core (~3,680 lines)

```
project_import/chapter_editor/mod.rs         (1,639)
project_import/chapter_editor/shared.rs        (597)
project_import/chapter_editor/row_fields.rs    (966)
project_import/chapter_editor/row_structure.rs (475)
```

### 10b: Git Conflict Resolution + History (~2,720 lines)

```
project_import/chapter_editor/git_conflicts.rs (1,460)
project_import/chapter_editor/history.rs       (1,262)
```

### 10c: Aligned Translation + Export (~3,970 lines)

```
project_import/chapter_editor/aligned_translation.rs (2,602)
project_import/chapter_editor/chapter_export.rs      (1,369)
```

`aligned_translation.rs` (lexicographic key generation, merge logic) and
`git_conflicts.rs` (semantic conflict detection) are the most algorithmically
dense files in the codebase. Review 10b and 10c with the foundational
principles (F-V, F-VII) in hand.

---

## Batch 11 — Import Pipeline
*~6,325 lines · 3 sessions*

### 11a: Import Core + Chapter Lifecycle (~2,300 lines)

```
project_import.rs                           (649)
project_import/project_git.rs               (210)
project_import/link_import.rs               (440)
project_import/chapter_lifecycle.rs         (466)
project_import/chapter_editor_comments.rs   (532)
```

### 11b: HTML Import (~2,430 lines)

```
project_import/chapter_import/mod.rs        (1,192)
project_import/chapter_import/html.rs       (1,237)
```

The HTML parser is a significant attack surface for malformed or adversarial
input. Review for input validation and sanitization.

### 11c: Other File Formats (~2,015 lines)

```
project_import/chapter_import/docx.rs        (617)
project_import/chapter_import/write_gtms.rs  (771)
project_import/chapter_import/xlsx.rs        (299)
project_import/chapter_import/txt.rs         (112)
project_import/chapter_import/languages.rs   (216)
```

---

## Batch 12 — Project Search + Updater
*~2,680 lines · 1 session*

```
project_search/mod.rs       (425)
project_search/indexer.rs   (603)
project_search/query.rs     (249)
project_search/scoring.rs   (284)
project_search/schema.rs    (166)
project_search/refresh.rs   (161)
project_search/discovery.rs (133)
updater.rs                  (656)
```

Search indexer correctness and `row_order_key` lexicographic ordering. `updater.rs`
is security-relevant — review for update integrity (signature verification, download
source validation).

---

## Every Batch Review

Each Rust review batch must include a pass over swallowed and non-fatal errors.
Search for patterns such as `let _ =`, `.ok()`, `.unwrap_or(...)`,
`if let Err(error) = ...`, ignored event emits, and fire-and-forget background
work. Classify each site as one of:

- expected silence (for example user cancellation, offline state, permission denial,
  conflict state, validation failure, or a deliberately optional UI notification);
- user-visible elsewhere (the command already fails through `invoke()`, so
  `runtime.js` reports the rejected command and duplicate telemetry is noise);
- non-fatal defect signal (the user-facing operation continues, but developers need
  visibility into the failure).

For non-fatal defect signals, recommend a small Tauri event routed through
`src-ui/app/telemetry.js` instead of failing the command or reporting directly from
Rust. Rust does not talk to Sentry in Phase 1. Telemetry events must carry only a
stable operation name and a scrubbed/scrubbable error string; never include command
payloads, document text, translation content, glossary/QA content, API keys, session
tokens, GitHub identity, or full local file paths.

Do not recommend telemetry for expected control flow. Do not add per-call-site Sentry
reporting for normal failed commands, because the frontend `invoke()` wrapper already
reports rejected commands through the consent-gated telemetry path.

### Standard V sweep: synchronous commands doing I/O

Each batch must also enumerate every `#[tauri::command]` whose `fn` is **not** `async`
and confirm it performs no long-running I/O on the IPC path. Standard V already prohibits
blocking the IPC path; this sweep is the **detection step** that makes the rule
enforceable. (Added 2026-06-03 after a cross-batch miss — the rule existed but was never
checked mechanically; see `2026-06-03-batch-3-review.md`. This is a check, not a new
guardrail: the principle already lives in the constitution as Standard V.)

The enumeration is mechanical:

```
grep -rzoP "#\[tauri::command\]\n\s*(pub\(crate\) )?fn [a-z_]+" src-tauri/src
```

Classify each synchronous command by what its body does:

- **OK to stay synchronous**: URL/string building, mutex locks, and small *local* file
  reads/writes (e.g. a tiny JSON session file).
- **Must move to `async` + `tauri::async_runtime::spawn_blocking`**: any blocking network
  call (`reqwest`), git subprocess, or large/remote file-system work. Map the join error
  to a clear `Result`/fallback, matching the existing async commands.

The fix is the same transform applied to Batch 2 M2 (`invite_user_to_organization_for_installation`).

---

## Summary

| Batch | Domain | Lines | Sessions | Status |
|---|---|---|---|---|
| 1 | Auth & Security ★ | 1,470 | 1 | ✅ `2026-06-02-review.md` — all findings resolved 2026-06-03 (see Resolution Status) |
| 2 | GitHub API | 1,040 | 1 | ✅ PR #7 closed — all findings resolved 2026-06-03 via PRs #10, #11, #12, #13 |
| 3 | App Shell | 1,790 | 1 | ✅ `2026-06-03-batch-3-review.md` — 0C/0S/1M/4m, all resolved via PRs #15, #16 |
| 4 | Git Shared | 1,470 | 1 | ✅ `2026-06-03-batch-4-review.md` — 0C/0S/0M/2m, all findings resolved via PR #21 |
| 5 | Project Sync + Migrations | 3,510 | 1 | ✅ `2026-06-03-batch-5-review.md` — 0C/0S/2M/0m, all resolved via PR #22 |
| 6 | Glossary & QA Sync | 1,985 | 1 | ✅ `2026-06-03-batch-6-review.md` — 0C/0S/1M/0m, resolved in PR #23 |
| 7 | Content Storage | 4,470 | 2 | ✅ `2026-06-03-batch-7-review.md` — 0C/0S/0M/1m, resolved in PR #25 |
| 8 | Team Metadata | 2,475 | 1 | ✅ `2026-06-10-batch-8-review.md` — 0C/1S/2M/2m, all resolved on `fix/batch-8-review-findings` |
| 9 | AI Integration | 5,040 | 2 | ✅ `2026-06-10-batch-9-review.md` — 0C/2S/1M/2m, all resolved on `fix/batch-9-review-findings` |
| 10 | Chapter Editor | 8,450 | 3 | — |
| 11 | Import Pipeline | 6,325 | 3 | — |
| 12 | Search + Updater | 2,680 | 1 | — |
| **Total** | | **~45,700** | **18** | |

## Naming Convention

Review files are saved as `reviews/YYYY-MM-DD-review.md`. For batches run on the
same date, append the batch number: `reviews/2026-06-02-batch-2-review.md`.
