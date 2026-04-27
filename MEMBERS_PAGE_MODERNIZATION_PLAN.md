# Members Page Modernization Plan

## Current Flow

The members page still uses the older state and mutation pattern:

- `state.users` stores visible members.
- `state.userDiscovery` stores load and error state.
- `state.pageSync` drives the refresh spinner.
- `team-members-flow.js` performs direct remote calls and manual cache writes.
- Admin role changes are partly optimistic, but use `inflightAdminMembershipUsernames` instead of a reusable write queue.
- Remove, promote owner, and invite flows are mostly modal-driven direct mutations followed by reloads.
- Status feedback is mostly silent except modal loading states and error notices.

## Goals

- Move members loading to the same query-backed pattern used by projects and glossaries.
- Add a serialized, coalescing write coordinator for member operations.
- Make safe member operations optimistic.
- Show scoped lower-right status badge progress for member background work.
- Spin the Members page refresh icon while member writes or refreshes are active.
- Keep controls enabled during safe refreshes and disable only affected rows/actions when possible.
- Keep persistent member cache free of transient UI/write fields.

## Stage 1: Add Query-Backed Members State

Create `src-ui/app/member-query.js`, following the shape of `project-query.js` and `glossary-query.js`.

Responsibilities:

- Define a query key such as `["members", teamId]`.
- Load cached members first through `loadStoredMembersForTeam`.
- Fetch remote members through `list_organization_members_for_installation`.
- Normalize remote members using the existing `normalizeOrganizationMember` behavior.
- Persist successful snapshots with `saveStoredMembersForTeam`.
- Expose helpers for:
  - `getMembersQueryData(teamId)`
  - `setMembersQueryData(teamId, snapshot)`
  - `invalidateMembersQueryAfterMutation(team, options)`
  - applying optimistic overlays for pending writes

Keep `state.users` as the rendered snapshot during the transition so `users.js` does not need a broad rewrite.

## Stage 2: Add Members Page State

Add `membersPage: createResourcePageState()` or a similarly small members-specific page state in `state.js`.

Use it to track:

- refresh in progress
- write in progress
- whether row actions should be blocked
- whether query refetch is active in the background

Keep `state.userDiscovery` initially for screen compatibility, but let query results drive its values.

## Stage 3: Refactor Member Loading

Update `loadTeamUsers` and `primeUsersForTeam` to use the query layer.

Expected behavior:

- Navigation to Members renders cached members immediately when available.
- Remote refresh starts in the background.
- The refresh button spinner stays active while remote load runs.
- Offline and no-installation teams keep their current fallback behavior.
- Stale responses for an old selected team cannot overwrite the current members page.

## Stage 4: Add a Serialized Member Write Coordinator

Create `src-ui/app/member-write-coordinator.js` using `createWriteIntentCoordinator`.

Suggested scopes:

- Team-wide membership scope: `members:${installationId}`
- Per-user admin role scope: `members:${installationId}:role:${username}`
- Invite scope: `members:${installationId}:invite`
- Remove/promote scope: `members:${installationId}:membership:${username}`

Coordinate these operations:

- make admin
- revoke admin
- remove member
- promote owner
- invite member, if queued submit behavior is useful
- possibly leave team if it should share the Members page status surface

Coalescing rules:

- Repeated admin role changes for the same username should keep the latest desired role.
- Remove should supersede pending role changes for that user.
- Promote owner should block or supersede ordinary admin role changes for that user.
- Invite can serialize at team scope, but identical usernames can coalesce.

## Stage 5: Make Member Mutations Optimistic

### Admin Role Changes

- Replace `inflightAdminMembershipUsernames` with a write intent.
- Immediately update the member row role to `Admin` or `Translator`.
- Mark the row with `pendingMutation: "makeAdmin"` or `pendingMutation: "revokeAdmin"`.
- Disable only that row's relevant actions while pending.
- On success, clear pending fields and refresh members/teams.
- On failure, restore the previous role and show a notice.

### Remove Member

- Close the modal immediately after confirmation.
- Optimistically remove the user from `state.users`.
- Keep the previous member snapshot for rollback.
- Run remote removal in the coordinator.
- Refresh members after success.
- Restore the user on failure.

### Promote Owner

- Close the modal immediately after confirmation unless the current UX needs inline modal feedback.
- Optimistically mark the member as `Owner` with `pendingMutation: "promoteOwner"`.
- Run remote promotion.
- Refresh teams and members on success, because team permissions may change.
- Roll back on failure.

### Invite Member

- Show progress while sending the invitation.
- Show a success notice when the invitation is sent.
- Refresh members only if the API makes invited users visible as members.
- Do not optimistically add a normal member unless the backend confirms membership immediately. GitHub org invites may stay pending, so showing them as active members would be misleading.

## Stage 6: Wire Members Status Badges

Use the existing scoped status badge infrastructure.

- Scope: `members`
- Screen: `src-ui/screens/users.js`
- Render with `getStatusSurfaceItems("members")`
- Keep the one orange style already used by the shared status surface

Suggested status stages:

- `Loading members...`
- `Refreshing member list...`
- `Updating member role...`
- `Removing member...`
- `Promoting team owner...`
- `Refreshing team access...`
- `Sending invitation...`

Suggested completion notices:

- `Member role updated.`
- `Member removed.`
- `Team owner promoted.`
- `Invitation sent.`

## Stage 7: Spin Refresh During Background Member Work

Update `renderUsersScreen`:

- Import `anyMemberWriteIsActive` from the new member write coordinator.
- Call:

```js
buildPageRefreshAction(state, state.pageSync, "refresh-page", {
  backgroundRefreshing: anyMemberWriteIsActive(),
})
```

- Pass `statusItems: getStatusSurfaceItems("members")` to `pageShell`.
- Keep `noticeText: getNoticeBadgeText()` for global notices until the global surface is fully unified.

## Stage 8: Clean Persistent Member Cache

Update `member-cache.js` to strip transient fields before saving:

- `pendingMutation`
- `pendingError`
- `roleSyncPending`
- optimistic/in-flight metadata

Add cache tests mirroring the project cache tests.

## Stage 9: Update Row Rendering

Update `renderUserCard` in `users.js`:

- Treat `pendingMutation` as the source of row pending state instead of `roleSyncPending`.
- Keep action disabling local to the affected row.
- Optionally append compact pending copy to the role meta:
  - `Admin · Updating...`
  - `Translator · Removing...`
  - `Owner · Promoting...`

Keep the visual changes minimal and avoid a card redesign.

## Stage 10: Tests

Add or update tests for:

- Cached members render immediately, then remote refresh updates them.
- Stale member refresh does not overwrite after team switch.
- Admin role changes are optimistic and coalesced.
- Remove member optimistically removes and rolls back on failure.
- Promote owner refreshes teams and members.
- Member writes spin the refresh button.
- Members status surface renders scoped progress.
- Member cache strips transient pending fields.
- Controls remain enabled during safe background refresh.
- Conflicting actions are disabled only when necessary.

## Implementation Order

1. Add `member-query.js` and member cache sanitation.
2. Convert `loadTeamUsers` and `primeUsersForTeam` to query-backed loading.
3. Add `member-write-coordinator.js`.
4. Move admin role changes onto the coordinator.
5. Move remove and owner promotion onto the coordinator.
6. Add members scoped status badges and refresh spinner.
7. Decide whether invite should be queued or only status-instrumented.
8. Expand tests and run the full suite.
