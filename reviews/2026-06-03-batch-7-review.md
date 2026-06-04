# Code Review — Batch 7: Content Storage (Glossary & QA)
<!-- vt.idd:local-review:batch-7 -->

**Date**: 2026-06-03
**Status**: Complete. One minor finding (parity-symmetric), open for fix.
**Scope**: glossary and QA-list on-disk storage, reviewed **together for parity**; TMX
import/export scrutinized for malformed-input handling
**Files**:

| File | Lines | Reviewed? |
|---|---:|---|
| `glossary_storage/mod.rs` | 1,748 | ✅ |
| `glossary_storage/tmx.rs` | 552 | ✅ |
| `glossary_storage/terms.rs` | 108 | ✅ |
| `glossary_storage/io.rs` | 60 | ✅ |
| `qa_list_storage/mod.rs` | 1,471 | ✅ |
| `qa_list_storage/tmx.rs` | 363 | ✅ |
| `qa_list_storage/terms.rs` | 108 | ✅ |
| `qa_list_storage/io.rs` | 60 | ✅ |
| **Total** | **~4,470** | |

---

## Executive Summary

| Severity | Count |
|---|---|
| Critical (C) | 0 |
| Security (S) | 0 |
| Major (M) | 0 |
| Minor (m) | 1 |
| **Total** | **1** |

Strong, security-conscious storage code. Mutations are **double-gated** (command-body
`ensure_installation_allows_*` plus the gated commit helper), TMX parsing handles malformed
input gracefully, and parity is excellent where the domains overlap. The one minor is
non-atomic content-file writes (git-recoverable).

---

## Parity result — ✅ good, with a legitimate domain asymmetry

- `io.rs` — identical between the two modules apart from one constant name. `terms.rs` —
  identical (normalized). Confirmed via token-normalized diff.
- `mod.rs` (1,748 vs 1,471) and `tmx.rs` (552 vs 363) **diverge by design, not drift**:
  glossaries are **bilingual** (source + target language, term variants/multiple segments per
  language) while QA lists are **single-language** with simpler entries. The extra glossary
  code is exactly that bilingual/variant handling. The **shared** structure — mutation gating,
  commit path, file layout, lifecycle — is line-for-line symmetric (e.g. the
  `ensure_installation_allows_*` gates sit at parallel positions in both `mod.rs` files).

This is the duplication the strategy's parity rule (and the just-added unification follow-up
note) is about: the one finding below has to be fixed in **two identical `io.rs` files** —
further evidence for consolidating glossary+QA behind one resource framework.

## Preliminary per-batch checks

### Standard V sweep
All `#[tauri::command]` functions in both modules are `async` + `spawn_blocking` (no
synchronous command performs file/git I/O on the IPC thread). ✅

### Swallowed / non-fatal error pass
- Term loading **tolerates a malformed individual term file** (the test fixtures write invalid
  JSON and the module skips them) — good resilience, analogous to the Batch 2 list-tolerance
  fix; one bad term file doesn't break the whole glossary/QA load.
- JSON/git read errors propagate via `?`. No non-fatal **defect signals** needing telemetry.

### Write-access gating — ✅ double-gated, symmetric
Every mutating storage command calls a backend gate in its command body —
`ensure_installation_allows_glossary_management` / `_writes` (and the `qa_list` equivalents) —
**and** commits through `git_commit_as_signed_in_user`, which itself runs
`ensure_repo_allows_writes`. So content storage has **no M1-style gap** (unlike the Batch 5/6
sync recovery paths). Both modules gate identically.

### TMX malformed-input handling — ✅ robust
`parse_tmx_glossary` / `parse_tmx_qa_list`:
- Validate the `.tmx` extension and UTF-8; strip a BOM.
- Parse via `quick_xml::Reader`; **all** parse/unescape errors propagate with `?` — no
  `unwrap`/`expect`/panic on malformed XML.
- `quick_xml` does not resolve external entities (**no XXE**) and does not amplify entity
  expansion (no "billion laughs"), and the input is bounded by the **25 MB import cap**
  (added in PR #18 to `import_tmx_*`/`inspect_tmx_*`). So the parse surface is well-contained.

---

## Findings

### m1 — Content-file writes are non-atomic (parity-symmetric)

**Severity**: Minor
**Files**: `glossary_storage/io.rs:53-60` and `qa_list_storage/io.rs` (identical)

`write_text_file` (the sink for `write_json_pretty` and gitattributes/TMX export) uses a bare
`fs::write` (truncate-then-write). A crash mid-write leaves a partial/corrupt working-tree file
(`glossary.json` / `qa-list.json`, individual term JSONs, exported TMX), which then fails to
parse on the next read.

Severity is low: these are **git-tracked** files committed immediately after writing, so a
corrupt working-tree copy is recoverable via `git checkout`. But it's the same class as Batch 1
**m3** / Batch 4 **m2**, and `util::atomic_replace` now exists for exactly this — content files
arguably deserve the same crash-safety as the broker/installation snapshots.

| Fix | Description | Rationale |
|---|---|---|
| **A ✓** | In `write_text_file`, write to a sibling `.tmp` then `util::atomic_replace(tmp, path)`. Apply to **both** `io.rs` files. | Crash-safe; consistent with the established atomic-write discipline |

**Recommended**: A (parity-symmetric — both files).

---

## Observations (not findings)

- **No explicit term/unit count cap in TMX import.** The parser builds one term per `<tu>` with
  no upper bound on count (contrast `project_import`'s `DOCX_MAX_IMPORTED_ROWS = 20,000`). It is
  bounded indirectly by the 25 MB file cap and `quick_xml`'s lack of entity amplification, so a
  pathological TMX is slow at worst, not catastrophic. A `MAX_IMPORTED_TERMS`-style cap would be
  a consistency nicety, not a security need — noting for a future hardening pass, not flagging.
- The `mod.rs`/`tmx.rs` size asymmetry is the bilingual-vs-monolingual domain difference, not a
  parity defect (verified the shared paths are symmetric).

---

## Resolution status

| Finding | Status | Notes |
|---|---|---|
| m1 | Open | Atomic content-file writes via `util::atomic_replace` in both `*/io.rs`; git-recoverable so low priority |

---

*Manual review following the Rust Review Strategy, Batch 7. Parity verified via
token-normalized diffs of each paired file; gating, commit path, atomic-write, and TMX
malformed-input surfaces checked directly.*
