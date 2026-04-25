# Team Owner Promotion Plan

## Goal
Add owner promotion and safer owner leave behavior on the Members page.

Requested behavior:
- Team owners can promote another member to team owner.
- Promotion requires a confirmation modal.
- Owners can leave a team only when the team has two or more owners.
- The `Make owner` button sits next to `Make Admin` on each eligible member card.
- Owners cannot remove other owners through this app. If an owner wants to leave, they must click `Leave` themselves.

## Current Flow
The Members page is rendered in `src-ui/screens/users.js`.

Member role changes are handled in `src-ui/app/team-members-flow.js`:
- `makeOrganizationAdmin`
- `revokeOrganizationAdmin`
- `openTeamMemberRemoval`
- `confirmTeamMemberRemoval`

User actions are routed in `src-ui/app/user-actions.js`.

Existing confirmation modals use small screen modules, for example:
- `src-ui/screens/team-member-remove-modal.js`
- `src-ui/screens/teams/leave-modal.js`

The Tauri command layer currently exposes organization admin, member removal, and leave commands in:
- `src-tauri/src/github/orgs.rs`
- `src-tauri/src/github.rs`
- `src-tauri/src/lib.rs`

The narrowest safe change surface is to extend the existing member action flow, add one modal state, add one modal renderer, and add one new Tauri command plus one new broker endpoint for owner promotion.

## Implementation Plan

### 1. Add owner capability helpers
Add a small shared helper module, for example `src-ui/app/team-member-permissions.js`, so the Members screen, member flow, and leave flow can use the same rules without coupling the team flow back to the members flow.

- `isCurrentUserOwner(state, selectedTeam)`
- `countOwners(users)`
- `canPromoteOwners(selectedTeam, users)`
- `canCurrentOwnerLeaveTeam(selectedTeam, users)`

Owner capability should use the existing owner-level team capability where possible, currently represented by `selectedTeam.canDelete === true`.

Owner count should come from the loaded members list, not from a new team-record field in this first implementation.

### 2. Update member card actions
Update `src-ui/screens/users.js`.

Show `Make owner` only when:
- selected team has a GitHub App installation
- selected team is not offline
- current user is a team owner
- target user is not the current user
- target user is not already an owner

Place `Make owner` next to the admin-role action group:
- for translators, next to `Make Admin`
- for admins, next to `Revoke Admin`

Pass explicit render options into `renderUserCard`, such as `canPromoteOwners`, instead of making each card inspect global state.

Keep `Remove` hidden for users whose role is `Owner`. This must include other owners, preserving the app-level rule that owners cannot kick other owners through the app.

### 3. Add promotion modal state
Update `src-ui/app/state.js`.

Add `createTeamMemberOwnerPromotionState()` with:
- `isOpen`
- `status`
- `error`
- `teamId`
- `teamName`
- `username`
- `memberName`

Add a reset helper matching the existing modal reset pattern.

### 4. Add the Make owner confirmation modal
Add `src-ui/screens/team-member-owner-modal.js`.

Follow the same structure as `team-member-remove-modal.js`.

Modal copy:
- Eyebrow: `MAKE OWNER`
- Title: `Promote this user to co-owner of the team?`
- Message: `GitHub recommends having two owners on each team so that you don't lose access if one of the owners is unable to log in. However, you should know that when you promote another user to the owner role, they will have the same permissions as you do, including the ability to delete the team.`
- Buttons: `Cancel` and `Continue`

Use the action names:
- `cancel-team-member-owner-promotion`
- `confirm-team-member-owner-promotion`

### 5. Route new member actions
Update `src-ui/app/user-actions.js`.

Add handlers for:
- `open-team-member-owner-promotion:<username>`
- `cancel-team-member-owner-promotion`
- `confirm-team-member-owner-promotion`

The confirm action should use `runWithImmediateLoading(event, "Promoting...", ...)`.

### 6. Add owner promotion flow methods
Update `src-ui/app/team-members-flow.js`.

Add:
- `openTeamMemberOwnerPromotion(render, username)`
- `cancelTeamMemberOwnerPromotion(render)`
- `confirmTeamMemberOwnerPromotion(render)`

Guard in the flow, not only in the UI:
- selected team must exist
- selected team must have a GitHub App installation
- current user must be owner-capable
- target user must exist
- target user must not be current user
- target user must not already be an owner

On confirmation:
1. Set modal status to loading.
2. Wait for next paint.
3. Invoke the owner promotion command.
4. Reload teams via `loadUserTeams(render)`.
5. Reload members via `loadTeamUsers(render, selectedTeamIdAtStart)` if the same team is still selected.
6. Reset modal state.

For this permission level, prefer reloading after success instead of optimistic role mutation. Owner promotion affects the current user's safety model and should reflect backend truth.

### 7. Add Tauri and broker support
This requires a new broker endpoint.

Confirmed local state:
- The desktop app has no existing owner-promotion command.
- The broker has admin-team routes at `/api/github-app/installations/:installationId/orgs/:orgLogin/admins/:username`.
- Those existing `admins` routes do not promote a GitHub organization owner. They only add or remove a user from the configured Gnosis admin team.
- The broker has no existing route for setting an organization member's GitHub owner role.

Confirmed GitHub API behavior:
- GitHub organization owners are represented by organization membership role `admin`.
- GitHub's REST endpoint for promoting an existing organization member to owner is `PUT /orgs/{org}/memberships/{username}` with body `{ "role": "admin" }`.
- GitHub documents that only authenticated organization owners can add a member or update a member's role this way.

Add a Tauri command:

- `promote_organization_owner_for_installation`

Wire it through:
- `src-tauri/src/github/orgs.rs`
- `src-tauri/src/github.rs`
- `src-tauri/src/lib.rs`

Add a broker route scoped similarly to the existing organization admin/member routes:

- `PATCH /api/github-app/installations/:installationId/orgs/:orgLogin/owners/:username`

The broker route must:
- require a valid session token
- verify the caller is an organization/team owner
- verify the target username is an active member of the organization before changing their role
- call GitHub `PUT /orgs/:orgLogin/memberships/:username` with `{ "role": "admin" }`
- return a clear error if GitHub rejects the operation

Implementation details:
- Add `promoteOrganizationOwnerForInstallation` in the broker authorization layer near `addOrganizationAdminForInstallation`.
- Use `ensureInstallationAccess({ requireOwner: true })`.
- Use the caller's user access token, not the installation token, because GitHub requires an authenticated organization owner for role updates.
- Validate `username` is non-empty.
- Reject attempts to promote the current session user.
- Before promotion, load `GET /orgs/:orgLogin/memberships/:username` and require `state === "active"`. This keeps the endpoint scoped to promoting existing team members from the Members page, instead of accidentally inviting or adding a new organization member.
- If the target is already `role === "admin"`, return success without changing anything. This makes stale UI retries harmless.
- Do not add any route for demoting/removing owners. This app intentionally avoids owner-to-owner removal or demotion flows.

### 8. Update owner Leave visibility and guards
Update `src-ui/screens/users.js`.

Current behavior hides `Leave` for owners because `canLeaveTeam` excludes `selectedTeam.canDelete === true`.

Change the Members-page current-user-card leave calculation:
- non-owner users may leave under the existing `selectedTeam.canLeave === true` rule
- owner users may leave only when `selectedTeam.canDelete === true` and `ownerCount >= 2`

This plan treats the requested owner `Leave team` visibility as a Members-page behavior because the owner count is already loaded there. Do not add a multi-owner `Leave` button to `src-ui/screens/teams/team-list.js` unless team records also gain a trustworthy owner count or the Teams page intentionally loads member summaries for each team.

Also add flow-level protection in `openTeamLeave` or `confirmTeamLeave` in `src-ui/app/team-flow/actions.js` so a sole owner cannot leave through a stale or manually triggered action.

If owner count may be stale, prefer refreshing members before allowing an owner leave.

### 9. Preserve owner removal restriction
Keep the existing owner-removal guard in `team-members-flow.js`:

- `openTeamMemberRemoval` must reject `member.role === "Owner"`
- `confirmTeamMemberRemoval` must reject `member.role === "Owner"`

This satisfies the app-level behavior that owners cannot remove other owners. It does not try to prevent an owner from doing this directly in GitHub.

### 10. Add tests
Update or add tests around `src-ui/app/team-members-flow.test.js` and any existing render tests for `users.js`.

Test cases:
- owner sees `Make owner` for non-owner users
- non-owner does not see `Make owner`
- owner does not see `Remove` for another owner
- owner with two or more owners sees `Leave`
- sole owner does not see `Leave`
- confirming owner promotion calls the new Tauri command
- successful promotion reloads teams and members
- failed promotion leaves the modal open and displays an error
- direct owner removal action still rejects owner targets
- broker promotion rejects a non-owner caller
- broker promotion rejects an inactive or missing target membership
- broker promotion no-ops successfully when the target is already an owner

### 11. Verification
Run:
- member flow JavaScript tests
- relevant render tests for the Members page
- `cargo check` after adding Tauri command wiring

Manual UI verification:
- owner account on a one-owner team
- owner account on a two-owner team
- admin account
- translator account
- offline mode

Check that:
- `Make owner` appears only for owners
- `Make owner` appears next to `Make Admin`
- promotion modal copy and buttons match the requested design
- owners cannot remove other owners in the app
- sole owner cannot leave
- owner on a multi-owner team can leave

## Risks and Open Questions
- Owner count depends on member data freshness. If stale member cache is possible, owner leave should refresh members before opening or confirming the leave modal.
- The broker route uses the caller's user access token for the GitHub role update, so failures may depend on the user's GitHub authorization and organization policy. Surface GitHub rejection messages clearly in the modal.
