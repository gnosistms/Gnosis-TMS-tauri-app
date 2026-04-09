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

- The glossary lifecycle rewrite itself is already landed in local/app history:
  - `b07fdd3` implemented glossary lifecycle and repo-backed glossary flows.
  - `b540bcd` fixed the glossary creation/import rollback bug found in review.
  - `5c1a451` hardened the glossary editor and added a client-side fallback when the broker is missing glossary routes.
- The live GitHub App broker is still missing the glossary repo routes. Verified responses against the production broker:
  - `GET /api/github-app/installations/{installation_id}/gnosis-projects` returns `401 Unauthorized` without a token, which shows the project route exists.
  - `GET /api/github-app/installations/{installation_id}/gnosis-glossaries` returns `404 Cannot GET ...`.
  - `POST /api/github-app/gnosis-glossaries` and `DELETE /api/github-app/gnosis-glossaries` also return `404`.
- Important constraint for the next thread:
  - this repository is the desktop/Tauri app only; it does not contain the broker server route implementations, so the missing glossary broker endpoints cannot be fixed here.
  - from this repo, the only possible change is client behavior around that broker failure.
- Current desktop-app behavior:
  - committed fallback: the Glossaries page can continue showing local glossary data instead of dropping into a full-page error when the broker glossary routes are missing.
  - uncommitted follow-up: the broker failure is also being promoted from a transient notice into persistent page state so the warning stays visible until a successful refresh clears it.
- Current uncommitted glossary-related files:
  - [glossary-discovery-flow.js](/Users/hans/Desktop/GnosisTMS/src-ui/app/glossary-discovery-flow.js)
  - [state.js](/Users/hans/Desktop/GnosisTMS/src-ui/app/state.js)
  - [glossaries.js](/Users/hans/Desktop/GnosisTMS/src-ui/screens/glossaries.js)
- Separate uncommitted editor/history fix also in flight:
  - [editor-history.js](/Users/hans/Desktop/GnosisTMS/src-ui/app/editor-history.js)
  - [translate-flow.js](/Users/hans/Desktop/GnosisTMS/src-ui/app/translate-flow.js)
  - [editor-history.test.js](/Users/hans/Desktop/GnosisTMS/src-ui/app/editor-history.test.js)
  - purpose: keep an expanded history group open while new edits / reviewed / please-check commits arrive.
