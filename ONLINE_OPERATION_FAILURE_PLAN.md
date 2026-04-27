# Online Operation Failure Handling Plan

## Context

Gnosis TMS already has pieces of connection failure handling:

- `src-ui/app/sync-error.js` classifies failures such as `connection_unavailable`, `auth_invalid`, `resource_access_lost`, `server_temporary`, and `unknown`.
- `src-ui/app/sync-recovery.js` handles classified failures and can open the existing connection failure modal.
- `src-ui/screens/connection-failure-modal.js` offers the user a way to enter offline mode.

The current problem is inconsistent adoption. Some top-level refresh paths call `handleSyncFailure()`, while optional side-loads can handle errors locally before the shared recovery policy sees them. The Projects page glossary side-load is one example: it converts a broker/network failure into `projectDiscovery.glossaryWarning`, so the page shows an inline warning but never offers offline mode.

The goal is to detect connection failures consistently at operation boundaries without making low-level API code UI-aware or scattering duplicate catch blocks across the app.

## Design Principles

1. Keep low-level modules UI-free.
2. Classify errors once, then apply a shared policy.
3. Wrap page-level operations and feature-level sync boundaries, not every `invoke()` call.
4. Preserve local data and inline warnings for optional side-load failures.
5. Show modal prompts for user-triggered foreground operations, not routine background sync.
6. Avoid duplicate prompts when multiple parallel requests fail together.

## Proposed Architecture

Add a shared online operation helper:

```js
await runOnlineOperation({
  render,
  source: "projects",
  trigger: "user-refresh",
  promptOffline: true,
  background: false,
  run: () => loadSomethingOnline(),
});
```

The helper should:

- run the supplied async operation
- catch errors
- classify via `classifySyncError(error)`
- route classified failures through a shared policy
- return a structured result when requested
- let callers preserve existing local fallback behavior

## New Module

Create `src-ui/app/online-operation.js`.

Suggested exports:

```js
export async function runOnlineOperation(options) {}
export async function handleOnlineOperationFailure(classification, options) {}
export function shouldPromptForOfflineMode(classification, options) {}
```

Suggested options:

- `render`
- `source`
- `trigger`
- `background`
- `promptOffline`
- `teamId`
- `currentResource`
- `onConnectionFailure`
- `onError`
- `run`

Suggested result shape:

```js
{
  ok: true,
  value,
}
```

or:

```js
{
  ok: false,
  error,
  classification,
  handled,
}
```

## Failure Policy

`handleOnlineOperationFailure()` should centralize this policy:

- `app_update_required`
  - Use the existing app update flow.

- `auth_invalid`
  - Use existing session-expired handling.

- `resource_access_lost`
  - Use existing current-resource versus non-current-resource behavior.

- `connection_unavailable`
  - If `background === true`, do not open a modal. Prefer scoped status or notice feedback.
  - If `promptOffline !== true`, do not open a modal. Return the classification so callers can show inline warnings.
  - If the app is already offline, do not prompt.
  - If a connection failure modal is already open, do not reopen it.
  - Otherwise open the existing connection failure modal.

- `server_temporary` and `unknown`
  - Do not offer offline mode by default.
  - Let the caller show existing inline error or status feedback.

## Prompt De-duplication

Use existing modal state as the first de-duplication guard:

```js
if (state.connectionFailure?.isOpen) {
  return true;
}
```

If needed, add a small state field later:

```js
state.connectionFailure.lastSource = "projects";
```

Do not overbuild this unless duplicate prompts are observed in tests.

## Projects Page Fix

Start with the Projects page because it has the known failure path.

### Current behavior

In `src-ui/app/project-discovery-flow.js`, the Projects page refresh runs multiple requests together:

- remote project list
- project metadata
- local repo repair inspection
- glossary side-load

The glossary side-load failure becomes `glossaryWarning` and is rendered inline. That preserves useful page data, but it bypasses the offline prompt.

### Desired behavior

When the Projects page refresh is user-triggered and the glossary side-load fails due to connection loss:

- keep cached projects visible
- keep the inline glossary warning
- open the existing connection failure modal once
- allow the user to enter offline mode

### Implementation shape

Update the glossary side-load handling so it returns structured failure information:

```js
{
  glossaries,
  syncIssue,
  brokerWarning,
  failureClassification,
}
```

Then the parent Projects refresh should call the shared failure policy if `failureClassification.type === "connection_unavailable"` and the refresh is foreground/user-triggered.

## Migration Targets

After the Projects path is fixed, migrate top-level operation boundaries:

- Projects refresh/load
- Glossaries refresh/load
- Teams refresh/load
- Members refresh/load
- AI settings load
- GitHub App test page load
- editor background sync paths with `background: true`
- glossary editor background sync paths with `background: true`

Do not migrate low-level helpers directly:

- `runtime.invoke`
- cache/storage modules
- repo sync helpers
- metadata helpers
- individual GitHub/broker wrapper functions

Those should continue to throw normal errors.

## Test Plan

Add focused tests for:

1. Primary Projects refresh connection failure opens the offline prompt.
2. Projects glossary side-load connection failure opens the offline prompt while preserving inline warning.
3. Projects glossary side-load non-connection warning stays inline and does not open the prompt.
4. Background sync connection failure does not open the modal.
5. Duplicate parallel connection failures open only one modal.
6. Existing auth-invalid handling still logs out and does not offer offline mode.
7. Existing app-update-required handling still shows the app update flow and does not offer offline mode.
8. Existing resource-access-lost handling still navigates to the safe parent context.

## Rollout Order

1. Add `src-ui/app/online-operation.js` and unit tests for policy decisions.
2. Convert Projects refresh and glossary side-load to use the shared policy.
3. Add Projects regression tests for the screenshot scenario.
4. Convert the other top-level refresh/load paths.
5. Convert background sync paths with `background: true`.
6. Run targeted tests for affected screens.
7. Run `npm run test`.
8. Run `npm run build`.

## Deferred Decisions

- Whether background sync should show a scoped notice every time or throttle repeated notices.
- Whether the connection failure modal should include the failed target name and source.
- Whether offline mode should become writable in the future.
- Whether to add retry/backoff for server-temporary errors.
