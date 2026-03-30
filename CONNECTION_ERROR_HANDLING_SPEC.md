# Connection Error Handling Spec

This spec defines how Gnosis TMS should respond when a background sync, page refresh, or user-initiated mutation fails because of connection, authentication, permission, or resource-access problems.

The purpose of this spec is to make recovery behavior consistent across:

- Teams
- Projects
- Users
- future editor/chapter flows

## Principles

1. The app should classify failures before reacting to them.
2. The UI should guide the user toward the correct next action.
3. The app should interrupt the user only when necessary.
4. If a lost resource is not the current context, the app should silently reconcile local state when possible.
5. Offline mode is only for connection problems, not auth or permission problems.

## Error Classes

- `connection_unavailable`
  - The app cannot reach the required service.
  - Examples: no internet, cannot reach GitHub, cannot reach broker.

- `auth_invalid`
  - The app reached the server, but the user session is no longer valid.
  - Examples: expired session, revoked login, bad credentials, deleted account.

- `resource_access_lost`
  - The user is authenticated, but access to a specific team/project/resource was lost.
  - Examples: org deleted, membership revoked, project deleted elsewhere, GitHub App installation removed.

- `server_temporary`
  - The server is reachable, but the failure appears temporary.
  - Examples: transient 5xx, temporary upstream outage, retryable timeout.

- `unknown`
  - The error could not be classified confidently.

## Recovery Decision Table

| Condition | Class | User-facing action | UI transition | Rollback? | Retry? |
| --- | --- | --- | --- | --- | --- |
| No internet connection | `connection_unavailable` | Show exact message: `No internet connection` with `Reconnect` and `Work offline` | Stay on current screen until user chooses; if they choose offline, enter offline mode | Yes for in-flight writes | No automatic retry |
| Internet exists but broker unreachable | `connection_unavailable` | Show exact message: `Could not connect to Gnosis TMS server` with `Reconnect` and `Work offline` | Stay on current screen until user chooses; optional offline mode entry | Yes for in-flight writes | No automatic retry |
| Internet exists but GitHub unreachable | `connection_unavailable` | Show exact message: `Could not connect to GitHub` with `Reconnect` and `Work offline` | Stay on current screen until user chooses; optional offline mode entry | Yes for in-flight writes | No automatic retry |
| GitHub/broker reached, but login/session invalid | `auth_invalid` | Show `Your GitHub session is no longer valid. Please sign in again.` | Log out, clear session, return to start screen | Yes | No |
| Authenticated, but current team/org no longer accessible | `resource_access_lost` | Show `You no longer have access to this team.` | Navigate to Teams page and refresh team list | Yes | No |
| Authenticated, but current project no longer accessible | `resource_access_lost` | Show `This project is no longer available.` | Navigate to the Projects list for that team, or to Teams if the team is gone | Yes | No |
| Team disappears in background, but user is not currently working in it | `resource_access_lost` | No message | Silently remove it from team list | No visible rollback needed | No |
| Project disappears in background, but user is not currently working in it | `resource_access_lost` | No message | Silently remove it from project list | No visible rollback needed | No |
| Temporary server-side failure during sync | `server_temporary` | Show `Couldn’t sync. Please try again.` | Stay on current screen | Yes for writes | Optional manual retry; no auto retry for now |
| Unclassified failure | `unknown` | Show safe generic message with retry | Stay on current screen | Yes for writes | Manual retry only |

## Context Rules

### Current Resource Lost

If the resource that failed is the one the user is actively using, the app should interrupt and navigate to the nearest safe parent context.

Examples:

- user is on Projects page for a team that no longer exists
- user is editing a chapter in a project that was deleted
- user is viewing Users for a team whose membership was revoked

### Non-current Resource Lost

If the resource that failed is not the one the user is actively using, the app should silently reconcile local state and continue.

Examples:

- another team is deleted while the user is viewing a different team
- another project disappears while the user is editing a different project

## Mutation Policy

For now, optimistic mutations should be rolled back when background sync fails.

This applies to:

- rename
- soft delete
- restore
- permanent delete
- leave

Reason:

- offline mode is currently read-only
- the app does not yet support safely keeping unsynced writes pending across auth-loss or connection-loss scenarios

## Message Requirements

For `connection_unavailable`, the user-facing message should name the failed connection target when possible:

- `No internet connection`
- `Could not connect to GitHub`
- `Could not connect to Gnosis TMS server`

For `auth_invalid`, the user-facing message should explain that the session is no longer valid and that signing in again is required.

For `resource_access_lost`, the user-facing message should mention the lost resource only if it is the current context. Otherwise, no error message is needed.

## Out of Scope For This Spec

This spec does not yet define:

- background polling cadence
- offline editing with pending writes
- automatic retry backoff strategy
- conflict resolution between concurrent edits on multiple devices

Those can be added later without changing this classification model.
