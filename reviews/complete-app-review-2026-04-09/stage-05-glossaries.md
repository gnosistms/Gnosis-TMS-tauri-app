# Stage 5 Review: Glossary Creation, Editor/Search Flows, and Modal UI

## Findings

### P1. Glossary term mutations are not permission-gated in either the UI or the flow layer

- The glossary editor always renders `+ New Term`, `Edit`, and `Delete` controls with no capability check in [glossary-editor.js:57](/Users/hans/Desktop/GnosisTMS/src-ui/screens/glossary-editor.js#L57) through [glossary-editor.js:69](/Users/hans/Desktop/GnosisTMS/src-ui/screens/glossary-editor.js#L69) and [glossary-editor.js:88](/Users/hans/Desktop/GnosisTMS/src-ui/screens/glossary-editor.js#L88) through [glossary-editor.js:99](/Users/hans/Desktop/GnosisTMS/src-ui/screens/glossary-editor.js#L88).
- The action layer dispatches those mutations directly in [glossary-actions.js:47](/Users/hans/Desktop/GnosisTMS/src-ui/app/actions/glossary-actions.js#L47) through [glossary-actions.js:60](/Users/hans/Desktop/GnosisTMS/src-ui/app/actions/glossary-actions.js#L60).
- The underlying term editor/delete flows also do not re-check team capability before writing:
  - modal open in [glossary-term-draft.js:13](/Users/hans/Desktop/GnosisTMS/src-ui/app/glossary-term-draft.js#L13) through [glossary-term-draft.js:31](/Users/hans/Desktop/GnosisTMS/src-ui/app/glossary-term-draft.js#L31)
  - term submit in [glossary-term-draft.js:105](/Users/hans/Desktop/GnosisTMS/src-ui/app/glossary-term-draft.js#L105) through [glossary-term-draft.js:140](/Users/hans/Desktop/GnosisTMS/src-ui/app/glossary-term-draft.js#L140)
  - term delete in [glossary-editor-flow.js:112](/Users/hans/Desktop/GnosisTMS/src-ui/app/glossary-editor-flow.js#L112) through [glossary-editor-flow.js:130](/Users/hans/Desktop/GnosisTMS/src-ui/app/glossary-editor-flow.js#L112)

Impact:
- Any user who can open the glossary editor can attempt glossary-term mutations, even though glossary creation/import is permission-gated elsewhere via [glossary-import-flow.js:19](/Users/hans/Desktop/GnosisTMS/src-ui/app/glossary-import-flow.js#L19) through [glossary-import-flow.js:29](/Users/hans/Desktop/GnosisTMS/src-ui/app/glossary-import-flow.js#L29).
- This creates an inconsistent trust boundary and invites accidental or unauthorized glossary edits.

Recommendation:
- Reuse the same capability check used for glossary creation/import on term add/edit/delete.
- Hide or disable the mutating controls in the UI and re-check capability again before invoking any write command.

### P2. The glossaries list still presents Download/Rename/Delete as normal actions even though all three are placeholders

- The glossaries screen renders `Download`, `Rename`, and `Delete` as ordinary actions in [glossaries.js:53](/Users/hans/Desktop/GnosisTMS/src-ui/screens/glossaries.js#L53) through [glossaries.js:57](/Users/hans/Desktop/GnosisTMS/src-ui/screens/glossaries.js#L57).
- But their handlers are still `showGlossaryFeatureNotReady(...)` placeholders in [glossary-actions.js:62](/Users/hans/Desktop/GnosisTMS/src-ui/app/actions/glossary-actions.js#L62) through [glossary-actions.js:73](/Users/hans/Desktop/GnosisTMS/src-ui/app/actions/glossary-actions.js#L73).

Impact:
- The UI advertises finished glossary-management capabilities that do not exist yet.
- That raises the support/debug burden because failures here are not implementation bugs so much as misleading product affordances.

Recommendation:
- Either hide/disable these actions until implemented or clearly mark them as unavailable rather than rendering them as standard text actions.

## Residual Risk

- The glossary slice still lacks a single shared capability helper for “can mutate glossary data.” Creation/import, term editing, and list actions currently each make their own decision or none at all, which will get harder to reason about as glossary features expand.

## Handoff Update (2026-04-09)

- Important repo split for the next thread:
  - desktop app repo: `/Users/hans/Desktop/GnosisTMS`
  - broker repo: `/Users/hans/Desktop/gnosis-tms-github-app-broker`
  - the broker repo is separate git history and separate deployment target; App Platform pulls from that broker repo, not from this desktop app repo.
- Broker status:
  - the missing glossary broker endpoints were implemented and pushed in the broker repo at commit `c5a73d0` (`Add glossary repo routes to broker`).
  - if glossary sync still fails in production, the next thread should inspect deployment state or logs in the broker deployment first, not re-debug only the desktop app.
- Already committed in the desktop app repo:
  - `b07fdd3` implemented glossary lifecycle and repo-backed glossary flows.
  - `b540bcd` fixed the glossary creation/import rollback bug found in review.
  - `5c1a451` hardened the glossary editor and added a client-side fallback when the broker is missing glossary routes.
  - `cb70623` persisted glossary broker warnings and editor-history expansion state.
- Current uncommitted app-side follow-up work:
  - shared page-sync controller replaces the separate Projects-specific sync helper
  - shared repo slug helper is used by both project and glossary creation/import
  - Projects now surfaces glossary sync/broker problems as persistent page warning state instead of swallowing them
  - shared Rust repo-sync transport helpers now back both project and glossary git sync modules
- Current uncommitted files most relevant to that refactor:
  - [project-flow.js](/Users/hans/Desktop/GnosisTMS/src-ui/app/project-flow.js)
  - [projects.js](/Users/hans/Desktop/GnosisTMS/src-ui/screens/projects.js)
  - [glossary-repo-flow.js](/Users/hans/Desktop/GnosisTMS/src-ui/app/glossary-repo-flow.js)
  - [page-sync.js](/Users/hans/Desktop/GnosisTMS/src-ui/app/page-sync.js)
  - [state.js](/Users/hans/Desktop/GnosisTMS/src-ui/app/state.js)
  - [repo-names.js](/Users/hans/Desktop/GnosisTMS/src-ui/app/repo-names.js)
  - [sync-state.js](/Users/hans/Desktop/GnosisTMS/src-ui/app/sync-state.js)
  - [repo_sync_shared.rs](/Users/hans/Desktop/GnosisTMS/src-tauri/src/repo_sync_shared.rs)
  - [project_repo_sync.rs](/Users/hans/Desktop/GnosisTMS/src-tauri/src/project_repo_sync.rs)
  - [glossary_repo_sync.rs](/Users/hans/Desktop/GnosisTMS/src-tauri/src/glossary_repo_sync.rs)
- Latest local verification for the uncommitted refactor:
  - `npm test`: passed
  - `npm run build`: passed
  - `cargo check`: passed
