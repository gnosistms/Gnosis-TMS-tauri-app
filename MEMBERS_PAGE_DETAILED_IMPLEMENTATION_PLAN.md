# Members Page Detailed Implementation Plan

This plan expands `MEMBERS_PAGE_MODERNIZATION_PLAN.md` into concrete code changes by stage.

## Stage 1: Query Infrastructure

Update `src-ui/app/query-client.js` to add member query keys:

```js
export const memberKeys = {
  all: ["members"],
  byTeam: (teamId) => ["members", teamId ?? null],
};
```

Create `src-ui/app/member-query.js`.

Implement these exports:

- `createMembersQuerySnapshot({ members, discovery })`
- `applyMembersQuerySnapshotToState(snapshot, { teamId, isFetching })`
- `seedMembersQueryFromCache(team, { render })`
- `createMembersQueryOptions(team, { teamId, render })`
- `ensureMembersQueryObserver(render, team, options)`
- `invalidateMembersQueryAfterMutation(team, options)`
- `patchMemberQueryData(queryData, username, patch)`
- `removeMemberFromQueryData(queryData, username)`

Move or export `normalizeOrganizationMember` from `src-ui/app/team-members-flow.js`, so query loading and mutation code share the same normalization.

`createMembersQueryOptions` should:

- call `list_organization_members_for_installation`
- pass `installationId`, `orgLogin`, and `sessionToken`
- normalize the response
- persist members with `saveStoredMembersForTeam`
- return a members query snapshot

`applyMembersQuerySnapshotToState` should:

```js
state.users = visibleMembers;
state.userDiscovery = snapshot.discovery;
state.membersPage.isRefreshing = isFetching === true;
```

It must no-op when `state.selectedTeamId !== teamId`.

## Stage 2: Page State

Update `src-ui/app/state.js`:

- Add `membersPage: createResourcePageState()` to `state`.
- Reset `membersPage` in `resetSessionState()`.
- Keep `userDiscovery` for screen compatibility during the transition.

`membersPage` should be used for:

- background refresh state
- write-active state if needed
- refresh button spinning
- future row-action blocking logic

## Stage 3: Query-Backed Loading

Refactor `primeUsersForTeam` in `src-ui/app/team-members-flow.js`.

Expected behavior:

- Offline: keep current unavailable behavior.
- No installation: set `state.users = []` and `state.userDiscovery = { status: "ready", error: "" }`.
- Cached members exist: seed query data, set `state.users`, mark discovery ready.
- No cache: show fallback current user and set discovery loading.

Refactor `loadTeamUsers`:

- Call `seedMembersQueryFromCache`.
- Start or update an observer with `ensureMembersQueryObserver`.
- Remove direct remote invoke from `loadTeamUsers`; the query function owns fetching.
- Preserve stale-team protection in `applyMembersQuerySnapshotToState`.
- Preserve current `handleSyncFailure` behavior for lost access and auth failures.

## Stage 4: Member Write Coordinator

Create `src-ui/app/member-write-coordinator.js` using `createWriteIntentCoordinator`.

Export:

- `memberRoleIntentKey(teamId, username)`
- `memberRemovalIntentKey(teamId, username)`
- `memberOwnerPromotionIntentKey(teamId, username)`
- `memberInviteIntentKey(teamId, login)`
- `memberWriteScope(team)`
- `memberUserWriteScope(team, username)`
- `requestMemberWriteIntent(intent, operations)`
- `anyMemberWriteIsActive()`
- `applyMemberWriteIntentsToSnapshot(snapshot)`
- `clearConfirmedMemberWriteIntents(snapshot)`
- `resetMemberWriteCoordinator()`

Overlay behavior:

- Role intent patches the user role and sets `pendingMutation`.
- Remove intent removes the user from visible members.
- Owner promotion patches role to `Owner` and sets `pendingMutation`.
- Confirmed intents clear when refreshed data agrees with the pending mutation.

Coalescing:

- Same member role key should keep the latest desired role.
- Remove should supersede pending role changes for that user.
- Owner promotion should block or supersede ordinary role changes for that user.

## Stage 5: Admin Role Mutations

Replace `inflightAdminMembershipUsernames` in `src-ui/app/team-members-flow.js`.

`makeOrganizationAdmin` and `revokeOrganizationAdmin` should call a shared helper, for example:

```js
requestOrganizationAdminMembershipUpdate(render, username, shouldBeAdmin)
```

Implementation:

- Validate selected team and permissions.
- Capture previous member/user snapshot.
- Request a write intent with `memberRoleIntentKey(team.id, username)`.
- `applyOptimistic`:
  - patch query data
  - patch `state.users`
  - set role to `Admin` or `Translator`
  - set `pendingMutation: "makeAdmin"` or `"revokeAdmin"`
- `run`:
  - call `add_organization_admin_for_installation` or `revoke_organization_admin_for_installation`
- `onSuccess`:
  - clear pending state
  - call `loadUserTeams(render)`
  - call `invalidateMembersQueryAfterMutation`
  - show `Member role updated.`
- `onError`:
  - restore previous users
  - clear members status
  - show failure notice

## Stage 6: Remove Member

Update `confirmTeamMemberRemoval` in `src-ui/app/team-members-flow.js`.

Implementation:

- Keep current permission and member validation.
- Capture `previousUsers` and the removed member.
- Reset/close the modal immediately.
- Request a write intent with `memberRemovalIntentKey`.
- `applyOptimistic`:
  - remove the member from query data
  - remove the member from `state.users`
  - persist the optimistic member cache
- `run`:
  - call `remove_organization_member_for_installation`
- `onSuccess`:
  - invalidate members query
  - show `Member removed.`
- `onError`:
  - restore `previousUsers`
  - clear status
  - either reopen the modal with error or show a lower-right error notice

## Stage 7: Promote Owner

Update `confirmTeamMemberOwnerPromotion` in `src-ui/app/team-members-flow.js`.

Implementation:

- Keep current permission and member validation.
- Capture the previous member snapshot.
- Reset/close the modal immediately unless inline modal feedback is still required.
- Request a write intent with `memberOwnerPromotionIntentKey`.
- `applyOptimistic`:
  - patch member role to `Owner`
  - set `pendingMutation: "promoteOwner"`
- `run`:
  - call `promote_organization_owner_for_installation`
- `onSuccess`:
  - call `loadUserTeams(render)`
  - invalidate members query
  - show `Team owner promoted.`
- `onError`:
  - restore previous member state
  - clear status
  - show or reopen error state

## Stage 8: Invite

Update `src-ui/app/invite-user-flow.js`.

Do not optimistically add a normal member unless the backend confirms active membership. GitHub org invitations may stay pending, so a visible active member row could be misleading.

Implementation:

- Add members scoped status stages:
  - `Sending invitation...`
  - `Refreshing member list...` if a refresh is run
- On success:
  - keep current success-step behavior or close the modal, based on existing UX
  - show `Invitation sent.`
  - optionally invalidate members query
- On error:
  - clear members scoped status
  - keep modal error behavior

Invite can later move to the write coordinator. It does not need visible optimistic row changes in the first pass.

## Stage 9: Status Badges And Spinner

Update `src-ui/screens/users.js`.

Imports:

- `getStatusSurfaceItems` from `status-feedback.js`
- `anyMemberWriteIsActive` from `member-write-coordinator.js`

Change refresh action to:

```js
buildPageRefreshAction(state, state.pageSync, "refresh-page", {
  backgroundRefreshing: state.membersPage?.isRefreshing === true || anyMemberWriteIsActive(),
})
```

Pass this to `pageShell`:

```js
statusItems: getStatusSurfaceItems("members")
```

Add helpers in `src-ui/app/team-members-flow.js`:

- `showMembersStatus(render, text)` uses `showScopedSyncBadge("members", text, render)`
- `clearMembersStatus(render)` uses `clearScopedSyncBadge("members", render)`
- `showMembersNotice(render, text, durationMs)` uses `showNoticeBadge`

Use these helpers in loading, role update, removal, promotion, and invite paths.

Suggested active statuses:

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

## Stage 10: Cache Sanitation

Update `src-ui/app/member-cache.js`.

Strip transient fields before saving:

- `pendingMutation`
- `pendingError`
- `roleSyncPending`
- any future `optimistic*` fields

Add `src-ui/app/member-cache.test.js`.

Test that saved and loaded members do not retain transient pending fields.

## Stage 11: Row Rendering

Update `renderUserCard` in `src-ui/screens/users.js`.

Changes:

- Treat `pendingMutation` as the source of row pending state.
- Keep compatibility with `roleSyncPending` only during migration if needed.
- Disable only the affected row's actions.
- Add compact pending copy to role meta when useful:
  - `Admin · Updating...`
  - `Translator · Updating...`
  - `Owner · Promoting...`
  - `Removing...` only if the row remains visible during a removal rollback window

Avoid a broader card redesign.

## Stage 12: Tests

Add or update:

- `src-ui/app/member-query.test.js`
- `src-ui/app/member-write-coordinator.test.js`
- `src-ui/app/member-cache.test.js`
- `src-ui/app/team-members-flow.test.js`
- `src-ui/screens/users.test.js`

Coverage targets:

- Cached members render before remote refresh.
- Remote refresh updates cached members.
- Stale team refresh cannot overwrite current team.
- Admin role changes are optimistic.
- Repeated admin role changes coalesce to the latest requested role.
- Remove member is optimistic.
- Remove member rolls back on failure.
- Owner promotion refreshes teams and members.
- Member scoped statuses appear for load, role, remove, promote, and invite operations.
- Refresh spinner spins during active member writes.
- Member cache strips transient fields.
- Row actions remain enabled during safe background refreshes.
- Affected row actions are disabled during pending writes.

## Implementation Order

1. Add `memberKeys` and `member-query.js`.
2. Add `membersPage` state.
3. Sanitize member cache and add cache tests.
4. Convert `primeUsersForTeam` and `loadTeamUsers` to query-backed loading.
5. Add `member-write-coordinator.js`.
6. Move admin role changes onto the coordinator.
7. Move remove member onto the coordinator.
8. Move owner promotion onto the coordinator.
9. Add members scoped status helpers and wire `users.js` status surface.
10. Add refresh spinner behavior for member writes.
11. Instrument invite with scoped status and optional query invalidation.
12. Expand tests and run the full suite.
