# Spec: QA list editor background sync (parity with glossary)

## Why

Glossary's term editor runs a periodic background sync of its GitHub repo while open
(`glossary-background-sync.js`), so a user editing a glossary sees teammates' remote changes mid-edit
instead of only colliding at save time. The **project chapter editor has the same pattern** (3-min
cadence). The **QA list editor is the lone repo-backed collaborative editor without it** —
`qaListEditorHasActiveBackgroundSync()` is a hardcoded `return false`.

Ruling (recorded in `frontend-tier3-mirror-merge-plan.md`): the background-sync mechanism is **generic
repo-backed-editor plumbing, not glossary-term-model-specific**. QA lists are equally GitHub-repo-backed
and collaboratively editable — QA's own `submitQaTermEditor` already bails with *"This QA term changed on
GitHub…"*, proving it faces the same conflict exposure, just reactively. So QA lacking background sync is
an **unjustified parity gap**. This spec closes it.

## Scope: frontend-only mirror port (dependencies already exist)

- **Backend already done:** `sync_gtms_qa_list_editor_repo` exists (`qa_list_repo_sync.rs:63`, registered
  in `lib.rs:652`) — the exact mirror of `sync_gtms_glossary_editor_repo`. No Rust work.
- **QA term-sync staleness already exists** (currently dead): `markQaTermsStale`, `applyQaTermsStale`,
  `loadQaTermFromDisk`, `ensureQaTermReadyForEdit` in `qa-term-sync.js` — full mirrors of glossary's,
  never driven because nothing calls them yet.
- **Snapshot-apply gate already wired:** `canApplyQaListEditorSnapshot` already consults
  `qaListEditorHasActiveBackgroundSync()` — it just always gets `false` today.
- **Missing piece = the session driver** (`qa-background-sync.js`) + its wiring.

## Implementation: mirror `glossary-background-sync.js` → `qa-background-sync.js`

Faithful 1:1 mirror (it's the proven template), with these per-domain substitutions:
- session keyed on `state.qaListEditor.qaListId`; screen guard `state.screen === "qaListEditor"`.
- `selectedQaList`/`selectedTeam` from `qa-list-shared.js`; `markQaTermsStale` from `qa-term-sync.js`.
- `invoke("sync_gtms_qa_list_editor_repo", { input, sessionToken })`.
- skip-while-editing checks `state.qaTermEditor?.isOpen === true`.
- export the same surface, renamed: `maybeStartQaListBackgroundSync`,
  `noteQaListBackgroundSyncScrollActivity`, `startQaListBackgroundSyncSession`,
  `markQaListBackgroundSyncDirty`, `qaListBackgroundSyncNeedsExitSync`, `qaListBackgroundSyncIsActive`,
  `syncAndStopQaListBackgroundSyncSession`. Keep the 10s idle constant.

### Wiring — mirror glossary's exact sites

| Glossary site | QA mirror |
|---|---|
| `glossary-editor-flow.js:349` `startGlossaryBackgroundSyncSession` (on editor open) | `qa-list-editor-flow.js` editor-open path |
| `glossary-editor-flow.js:315` `syncAndStop…` (on editor exit) | QA editor-exit path |
| `glossary-editor-flow.js:113` `…IsActive() \|\| …NeedsExitSync()` | **fix** `qaListEditorHasActiveBackgroundSync()` stub to return real state |
| `glossary-editor-flow.js:395` `markGlossaryBackgroundSyncDirty` | QA term-change path |
| `glossary-term-draft.js:278` `maybeStart…({force:true})` after save | `qa-term-draft.js` after `submitQaTermEditor` success |
| `glossary-term-draft.js:364` `markGlossaryBackgroundSyncDirty` | `qa-term-draft.js` |
| `navigation.js:170/203/300/377` start/stop/needsExit/maybeStart | QA editor branches in `navigation.js` |
| `main.js:672` `noteGlossaryBackgroundSyncScrollActivity()` on scroll | add `qaListEditor` branch in the `main.js` scroll handler |

### Tests
Mirror `glossary-background-sync.test.js` (16 tests) → `qa-background-sync.test.js`: session
start/stop, 10s idle-gate, skip-while-term-modal-open, dirty-tracking + exit-sync, `markQaTermsStale`
applied from the sync payload, sync-failure handling, stale-session no-op.

## Decoupling note (important — do NOT scope-creep)

QA keeps its **existing synchronous-write + manual-counter** model. Background sync **skips while the
term-edit modal is open** (`state.qaTermEditor.isOpen`), and QA's synchronous save holds the modal open
until done — so background sync never races an in-flight QA write. Therefore this port does **not**
require adopting glossary's write-intent-coordinator architecture. The `term-write-coordinator` collapse
remains a **separate** item (ruled justified-for-now); do not fold it in here.

## Ownership / sequencing

One PR. GPT implements the faithful mirror + wiring + tests; `npm test` green per commit;
`audit:unused` clean (this also retires the dead `markQaTermsStale`/`applyQaTermsStale` exports by
finally using them); own branch; Claude reviews against the glossary template. Low risk — faithful
mirror of a production feature with all backend/term-sync/snapshot-apply dependencies already present.
