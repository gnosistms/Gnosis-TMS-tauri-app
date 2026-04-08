# Stage 1 Review: App Shell, Global State, Bootstrapping, Routing, and Event Dispatch

## Findings

### P1. Session reset leaves stale selected ids behind, so a new login can inherit invalid team/project/chapter pointers

- `state` carries long-lived selection ids in [state.js:20](/Users/hans/Desktop/GnosisTMS/src-ui/app/state.js#L20), [state.js:21](/Users/hans/Desktop/GnosisTMS/src-ui/app/state.js#L21), [state.js:22](/Users/hans/Desktop/GnosisTMS/src-ui/app/state.js#L22), and [state.js:23](/Users/hans/Desktop/GnosisTMS/src-ui/app/state.js#L23).
- `hydrateStoredTeamState()` only assigns a fresh team id when `state.selectedTeamId` is `null`, per [state.js:91](/Users/hans/Desktop/GnosisTMS/src-ui/app/state.js#L91) through [state.js:97](/Users/hans/Desktop/GnosisTMS/src-ui/app/state.js#L97).
- `resetSessionState()` clears most session data, but it never resets `selectedTeamId`, `selectedProjectId`, `selectedGlossaryId`, or `selectedChapterId`; see [state.js:421](/Users/hans/Desktop/GnosisTMS/src-ui/app/state.js#L421) through [state.js:477](/Users/hans/Desktop/GnosisTMS/src-ui/app/state.js#L477).
- Both successful auth restore and fresh broker auth immediately rehydrate user-scoped stored data through [auth-flow.js:36](/Users/hans/Desktop/GnosisTMS/src-ui/app/auth-flow.js#L36) through [auth-flow.js:49](/Users/hans/Desktop/GnosisTMS/src-ui/app/auth-flow.js#L49) and [auth-flow.js:82](/Users/hans/Desktop/GnosisTMS/src-ui/app/auth-flow.js#L82) through [auth-flow.js:102](/Users/hans/Desktop/GnosisTMS/src-ui/app/auth-flow.js#L102).

Impact:
- Logging out and signing in as a different user can preserve selection ids from the previous user.
- If the next user does not own the same team/project/chapter ids, the app can point its loaders at nonexistent or unauthorized records and land on empty/error states for the wrong reason.

Recommendation:
- Fully reset all selection ids and expansion state that is logically scoped to the authenticated user inside `resetSessionState()`.

### P2. Page sync completion is asynchronous, but refresh paths do not await it, so the `upToDate` state is never reliably rendered

- `refreshCurrentScreen()` calls `completePageSync(render)` without `await` in [navigation.js:104](/Users/hans/Desktop/GnosisTMS/src-ui/app/navigation.js#L104) through [navigation.js:119](/Users/hans/Desktop/GnosisTMS/src-ui/app/navigation.js#L119).
- `completePageSync()` deliberately waits out a minimum spinner duration before mutating `state.pageSync` to `{ status: "upToDate" }`, as shown in [page-sync.js:19](/Users/hans/Desktop/GnosisTMS/src-ui/app/page-sync.js#L19) through [page-sync.js:31](/Users/hans/Desktop/GnosisTMS/src-ui/app/page-sync.js#L31).
- That function only triggers a render when it later resets back to idle, not when it first reaches `upToDate`; see [page-sync.js:28](/Users/hans/Desktop/GnosisTMS/src-ui/app/page-sync.js#L28) through [page-sync.js:31](/Users/hans/Desktop/GnosisTMS/src-ui/app/page-sync.js#L31).

Impact:
- The UI can render while the state is still `"syncing"`, then silently flip to `"upToDate"` without a render.
- Users may never see the intended “up to date” confirmation state even though the state machine records it.

Recommendation:
- `await completePageSync(render)` everywhere this lifecycle is used, or have `completePageSync()` render immediately after setting the `upToDate` state.

## Residual Risk

- Navigation/state orchestration is still spread across [main.js](/Users/hans/Desktop/GnosisTMS/src-ui/main.js), [navigation.js](/Users/hans/Desktop/GnosisTMS/src-ui/app/navigation.js), [events.js](/Users/hans/Desktop/GnosisTMS/src-ui/app/events.js), and action-specific modules. That is manageable, but future shell-level work will remain error-prone until more of the lifecycle is centralized behind a single navigation coordinator.
