# Stage 4 Review: Projects, Files, Glossary Linking, and Project-Page Flows

## Findings

### P1. File-level mutating actions are exposed and executable without the permission checks used for project-level mutations

- The projects screen always renders file-level `Rename` and `Delete` actions for active files, regardless of the current user’s permissions; see [projects.js:147](/Users/hans/Desktop/GnosisTMS/src-ui/screens/projects.js#L147) through [projects.js:149](/Users/hans/Desktop/GnosisTMS/src-ui/screens/projects.js#L149).
- The glossary-link dropdowns are likewise enabled for any online user, with only offline-mode disabling applied in [projects.js:145](/Users/hans/Desktop/GnosisTMS/src-ui/screens/projects.js#L145) through [projects.js:146](/Users/hans/Desktop/GnosisTMS/src-ui/screens/projects.js#L146).
- The underlying flow methods do not re-check the team capability either:
  - file rename modal opening in [project-flow.js:793](/Users/hans/Desktop/GnosisTMS/src-ui/app/project-flow.js#L793) through [project-flow.js:823](/Users/hans/Desktop/GnosisTMS/src-ui/app/project-flow.js#L823)
  - file rename submit in [project-flow.js:1014](/Users/hans/Desktop/GnosisTMS/src-ui/app/project-flow.js#L1014) through [project-flow.js:1099](/Users/hans/Desktop/GnosisTMS/src-ui/app/project-flow.js#L1099)
  - file soft delete in [project-flow.js:1321](/Users/hans/Desktop/GnosisTMS/src-ui/app/project-flow.js#L1321) through [project-flow.js:1382](/Users/hans/Desktop/GnosisTMS/src-ui/app/project-flow.js#L1382)
  - file restore in [project-flow.js:1384](/Users/hans/Desktop/GnosisTMS/src-ui/app/project-flow.js#L1384) through [project-flow.js:1445](/Users/hans/Desktop/GnosisTMS/src-ui/app/project-flow.js#L1384)
  - chapter glossary-link updates in [project-flow.js:1187](/Users/hans/Desktop/GnosisTMS/src-ui/app/project-flow.js#L1187) through [project-flow.js:1241](/Users/hans/Desktop/GnosisTMS/src-ui/app/project-flow.js#L1241)

Impact:
- A user without file-management rights can still be offered mutating controls and can dispatch those actions.
- Even if the backend eventually rejects some of them, the frontend currently performs optimistic local state mutations first in several cases, which is the wrong trust boundary for permission enforcement.

Recommendation:
- Apply the same capability checks to file-level actions that already protect project-level actions.
- Hide or disable the controls in the UI and re-check permission again in the flow/action layer before any optimistic mutation or backend call.

### P2. Offline blocking is incomplete for file-level actions, so several mutating controls remain clickable and fall through to failing runtime calls

- Offline mode blocks `delete-deleted-file:` in [offline-policy.js:25](/Users/hans/Desktop/GnosisTMS/src-ui/app/offline-policy.js#L25) through [offline-policy.js:37](/Users/hans/Desktop/GnosisTMS/src-ui/app/offline-policy.js#L37), but it does not block:
  - `rename-file:`
  - `delete-file:`
  - `restore-file:`
- The UI also leaves those actions enabled in the projects screen:
  - active file rename/delete in [projects.js:147](/Users/hans/Desktop/GnosisTMS/src-ui/screens/projects.js#L147) through [projects.js:149](/Users/hans/Desktop/GnosisTMS/src-ui/screens/projects.js#L149)
  - deleted file restore in [projects.js:178](/Users/hans/Desktop/GnosisTMS/src-ui/screens/projects.js#L178)

Impact:
- In offline mode, users can still trigger file mutations that the app cannot actually perform.
- That produces unnecessary runtime failures and makes the offline UX feel inconsistent because some project mutations are blocked early while others are allowed to fail later.

Recommendation:
- Add all file-level mutation prefixes to the offline policy and mirror that policy in the projects UI by disabling the corresponding controls when offline.

## Residual Risk

- [project-flow.js](/Users/hans/Desktop/GnosisTMS/src-ui/app/project-flow.js) is now a large multi-responsibility module containing loading, optimistic mutation application, deleted-item handling, glossary linking, file rename/delete/restore flows, and sync orchestration. It is still understandable, but it is close to the point where a new feature in this slice will be safer if chapter/file mutations are split out from project-level mutations and loading/reconciliation logic.
