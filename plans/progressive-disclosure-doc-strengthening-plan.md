# Progressive Disclosure Documentation Strengthening Plan

## Background

The repository's progressive-disclosure guidance is useful, but it still relies on
implicit trust in prose summaries. Recent review work showed that even small wording
drift in these files can mislead an agent into the wrong storage layer, field name,
or ownership boundary.

The next improvement is structural: make the guidance more self-verifying and more
explicit about which statements describe current implementation reality versus
architectural intent.

## Goals

- Keep the directive guidance files concise and focused on instructions.
- Move verification metadata and canonical source references into adjacent
  `AGENTS_EVIDENCE.md` files instead of embedding evidence in the guidance prose.
- Distinguish current invariants from architectural goals where the codebase has
  known divergences.
- Tighten identifier and storage wording so cross-layer names are stated literally
  instead of summarized loosely.

## Scope

- `AGENTS.md`
- `src-ui/AGENTS.md`
- `src-tauri/AGENTS.md`
- `.vt/memory/foundational-principles.md`

## Plan

1. Add adjacent `AGENTS_EVIDENCE.md` files next to each guidance document and the
   foundational principles document.
2. Move verification metadata and canonical source references for state-management,
   write-intent, storage, command-boundary, and metadata-lifecycle rules into those
   evidence files.
3. Keep the main guidance documents concise by replacing inline verification blocks
   with brief references to the adjacent evidence file.
4. Split principles that mix present behavior and intended architecture into
   explicit current invariant / architectural goal / known divergence wording.
5. Tighten storage and identifier language where the code uses different names at
   different layers (`structure.order_key`, `order_key`, `row_order_key`; SQLite
   search index versus `tauri-plugin-store`).
6. Review the resulting diff for drift, redundancy, and uncommitted status.
