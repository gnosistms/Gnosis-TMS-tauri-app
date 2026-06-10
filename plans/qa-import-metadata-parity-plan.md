# Plan: Fix QA-list import/create team-metadata-record parity gap

Self-contained brief for an agent with **no prior context**. Read top-to-bottom before
editing.

## 0. Problem (confirmed by tracing)

The glossary create/import flow writes and maintains the **authoritative team-metadata
record** across its lifecycle. The QA-list flow does **not** — `qa-list-import-flow.js`
is a less-complete parallel of `glossary-import-flow.js` and omits the metadata-record
steps entirely.

| Step | Glossary (`glossary-import-flow.js`) | QA (`qa-list-import-flow.js`) |
|---|---|---|
| Create | `upsertGlossaryMetadataRecord(...)` — "Saving team metadata…" (`:400`) | **missing** in `completeQaListCreateSynchronously` (`:241`) |
| Rollback on failed create | `deleteGlossaryMetadataRecord(...)` (`:323`) | **missing** in `rollbackStrictQaListCreate` (`:179`) |
| Verify after import | `refreshGlossaryMetadataRecords(...)` (`:199`) | **missing** in `verifyImportedQaListState` (`:134`) |

**Confirmed impact:** the full QA create chain — `submitQaListCreation` →
`completeQaListCreateSynchronously` → (`createRemoteQaListRepoForAvailableName`,
`prepareLocalQaListRepo`, `initialize_gtms_qa_list_repo`, `prepareLinkedLocalQaListRepo`,
`syncSingleQaListOrThrow`) → `reloadQaListsAfterWrite` — never calls
`upsertQaListMetadataRecord`. `syncSingleQaListOrThrow` only git-syncs;
`reloadQaListsAfterWrite` only re-discovers. So a QA list created this way has **no
authoritative team-metadata record at create time**, while a glossary does.

This violates the repo's "lifecycle is authoritative in team metadata" / "write metadata
before remote content repo operations" principle (`src-tauri/CLAUDE.md` → Metadata Repos)
and the glossary↔QA **parity rule** (`src-ui/CLAUDE.md`). QA lists only get a metadata
record lazily, on their first lifecycle mutation (rename/delete/restore via
`qa-list-lifecycle-flow.js`, which does call `upsertQaListMetadataRecord`).

The infrastructure already exists and is unused for this reason:
`upsertQaListMetadataRecord`, `deleteQaListMetadataRecord`, `refreshQaListMetadataRecords`
(all in `team-metadata-flow.js`). PR #89 deliberately kept `deleteQaListMetadataRecord` /
`refreshQaListMetadataRecords` instead of deleting them, pending this fix.

## 1. Pre-work — confirm intent (do this first; it gates the rest)

Before wiring, confirm this is a gap and not an intentional QA-only design:
- Check git history of `qa-list-import-flow.js` vs `glossary-import-flow.js` — was the
  metadata step ever present in QA and removed, or never added? (`git log -p --follow`)
- Confirm QA discovery/visibility actually depends on the metadata record (compare how
  `listLocalQaListMetadataRecords` / `listQaListMetadataRecords` feed the QA bin vs. how
  glossary uses its records). If QA discovery is purely remote-repo-driven and metadata
  records are only consulted for lifecycle, the user-visible impact may be limited to
  soft-delete/restore consistency — still worth fixing for parity, but scope accordingly.
- If it turns out intentional, the correct cleanup is instead to **delete**
  `deleteQaListMetadataRecord` + `refreshQaListMetadataRecords` (the inverse outcome).

## 2. The reference implementation (glossary)

Read these for the exact shape to mirror:
- `glossary-import-flow.js`
  - `linkedGlossaryMetadataRecord(glossary, remoteRepo)` (`:104`) — builds the record
  - `linkedGlossarySummary(...)` (`:124`)
  - `completeGlossaryCreateSynchronously` (`:365`) — upsert at `:400`
  - `rollbackStrictGlossaryCreate` (`:297`) — delete at `:323`
  - `verifyImportedGlossaryState` (`:189`) — refresh at `:199`
- `glossary-lifecycle-flow.js:124` — `writeMetadata: upsertGlossaryMetadataRecord` (the
  lifecycle path that QA already mirrors at `qa-list-lifecycle-flow.js:126`)

## 3. Task — wire the QA metadata-record lifecycle

In `src-ui/app/qa-list-import-flow.js`:

1. **Build a QA metadata record.** Add a `linkedQaListMetadataRecord(qaList, remoteRepo)`
   helper mirroring `linkedGlossaryMetadataRecord`. The QA create already constructs
   `linkedQaList` inline (`completeQaListCreateSynchronously`, ~`:266`) — derive the record
   from that + `remoteRepo`. Match the field shape `upsertQaListMetadataRecord` /
   `buildMetadataRecord` (see `qa-list-repo-flow.js:117`) expects.

2. **Upsert on create.** In `completeQaListCreateSynchronously`, after the local repo is
   initialized/linked and before (or right after) the sync — mirror glossary ordering
   (glossary upserts *before* the final link/sync, after init) — add:
   ```js
   showResourceCreateProgress(render, "Saving team metadata...");
   await upsertQaListMetadataRecord(team, linkedQaListMetadataRecord(linkedQaList, remoteRepo), { requirePushSuccess: true });
   ```
   Apply the same to the **TMX-import create path** (`importQaListFile`, ~`:600`), which has
   its own create+rollback block (`:627`).

3. **Delete on rollback.** In `rollbackStrictQaListCreate` (`:179`), after the local purge,
   add the metadata cleanup mirroring glossary `:323`:
   ```js
   try {
     await deleteQaListMetadataRecord(team, qaListId, { requirePushSuccess: true });
   } catch (error) {
     rollbackError ??= error;
   }
   ```

4. **Refresh on verify.** In `verifyImportedQaListState` (`:134`), mirror glossary's
   `refreshGlossaryMetadataRecords` usage (`:199`) — accept an injectable
   `operations.refreshQaListMetadataRecords ?? refreshQaListMetadataRecords` and call it
   where glossary does.

5. **Imports.** Add `upsertQaListMetadataRecord`, `deleteQaListMetadataRecord`,
   `refreshQaListMetadataRecords` from `team-metadata-flow.js`.

Keep parity exact: ordering, `requirePushSuccess: true`, and error handling should match
the glossary flow so the two stay aligned.

## 4. Tests

Mirror the glossary import/create tests for QA (`qa-list-import-flow.test.js` if present,
else add). Assert:
- successful QA create calls `upsertQaListMetadataRecord` with the expected record
- a failed create triggers `rollbackStrictQaListCreate` which calls
  `deleteQaListMetadataRecord`
- `verifyImportedQaListState` calls the (injected) refresh
- TMX-import create path also upserts

Use the same injection pattern the glossary tests use (`operations.*` overrides).

## 5. Verification

```bash
npm test
npm run audit:unused   # deleteQaListMetadataRecord + refreshQaListMetadataRecords now USED
```
After this lands (plus #88/#89), the app-code unused-exports list should reach **0**.

Manual (`npm run tauri:dev`): create a QA list; confirm a team-metadata record is written
(local team-metadata repo + pushed), matching glossary behavior; force a create failure
and confirm the metadata record is rolled back.

## 6. Scope / rules

- Own PR. Title e.g. "Write QA-list team-metadata records on create (glossary parity)".
- Files: `qa-list-import-flow.js` (+ its test), no backend change expected (the
  `upsert/delete/refresh` commands already exist).
- Respect parity: this *is* the parity fix — do not introduce new glossary/QA drift.
- This is the one item from the unused-export audit that is a **behavior fix**, not a
  cleanup; treat it as a bug fix with tests, not a deletion.

## 7. Gotcha

`completeQaListCreateSynchronously` and the TMX-import path (`importQaListFile`) are **two
separate create code paths** that both call `rollbackStrictQaListCreate`. Wire the upsert
into **both**, or imported QA lists will still miss their metadata record.
