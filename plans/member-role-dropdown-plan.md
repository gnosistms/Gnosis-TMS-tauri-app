# Members Page Role Dropdown Implementation Plan

## Summary

Replace per-card `Make Admin`, `Revoke Admin`, and `Make owner` actions with an owner-only role dropdown for other members. The dropdown manages `Viewer`, `Translator`, `Admin`, and `Owner`, while preserving GitHub-backed safety rules: no self Owner changes and no action that leaves zero Owners.

## Backend And Interfaces

- Add a generic Tauri command in `src-tauri/src/github/orgs.rs`, registered in `src-tauri/src/lib.rs`: `set_organization_member_role_for_installation(installation_id, org_login, username, role, confirmation_username, session_token)`.
- The command forwards to a broker endpoint using app-role values: `viewer`, `translator`, `admin`, `owner`.
- Backend validation must happen after fresh GitHub/member lookup:
  - requester is an active Owner,
  - requester is not changing their own Owner role,
  - demoting/removing an Owner leaves at least one Owner,
  - `confirmationUsername` matches the target username for Owner demotion,
  - final member role mirrors GitHub ownership truth.
- Keep current Tauri commands for compatibility, but route the members-page dropdown through the new generic role command.
- Broker maps GitHub role values to app roles: GitHub `admin` means `Owner`; non-owner GitHub members become `Viewer`, `Translator`, or app-level `Admin` based on GnosisTMS role metadata.

## Frontend Implementation

- Add shared role helpers in `src-ui/app/member-shared.js`:
  - `MEMBER_ROLE_OPTIONS = ["Viewer", "Translator", "Admin", "Owner"]`,
  - display normalization,
  - wire mapping to lowercase broker roles,
  - owner-count checks.
- Update `src-ui/screens/users.js`:
  - replace old role buttons with a compact `<select>` for owners managing other users,
  - selected value is the user’s current normalized role,
  - disabled while that user has an active write intent,
  - current user keeps `Leave` behavior and never gets a self role dropdown,
  - show the self-owner message when applicable.
- Add a `data-member-role-select` handler in `src-ui/app/input-handlers.js`.
- In `src-ui/app/team-members-flow.js`, add `updateOrganizationMemberRole(render, username, nextRole)`:
  - no-op if role unchanged,
  - block self Owner changes,
  - block last-Owner demotion before opening any modal,
  - route `Owner` through the existing promotion confirmation,
  - route Owner-to-lower-role through a new confirmation modal,
  - route non-owner role changes directly through member write intents.
- Extend `src-ui/app/member-write-coordinator.js` so `memberRole` intents support all four roles and use a generic pending label like `Updating...`, not only `makeAdmin`/`revokeAdmin`.
- Add `teamMemberOwnerDemotion` state in `src-ui/app/state.js` and a new modal requiring the target GitHub username before confirming demotion.
- Keep `Remove` as a separate action, but allow removing another Owner only when at least one Owner remains afterward and require the same username confirmation for Owner removal.

## Safety And UX Details

- Dangerous-action messages:
  - self Owner change: “You cannot change your own Owner role. Ask another Owner to make this change.”
  - last Owner guard: “This team needs at least one Owner. Add another Owner before continuing.”
  - demotion confirmation: “Type @username to change this Owner’s role.”
- Owner demotion/removal confirmation requires the GitHub username without `@`; trim and compare case-insensitively.
- Offline mode disables role dropdowns and role-confirmation actions.
- After any successful role mutation, refresh teams first, then refresh members, so permissions and visible roles come from GitHub/broker truth.
- Audit logs, notification emails, and undo windows are explicitly deferred.

## Tests

- `users` render tests:
  - dropdown replaces old role buttons,
  - options include all four roles,
  - dropdown shown only to owners for other users,
  - current Owner card shows the self-change warning,
  - last Owner demotion/removal controls are blocked.
- `team-members-flow` tests:
  - each non-owner role change sends correct wire role,
  - Owner promotion opens existing confirmation,
  - Owner demotion opens username confirmation,
  - invalid confirmation does not invoke Tauri,
  - successful role change refreshes teams and members.
- `member-write-coordinator` tests:
  - optimistic overlays work for `Viewer`, `Translator`, `Admin`, and `Owner`,
  - repeated dropdown changes coalesce to the latest role,
  - confirmed refresh clears matching intents.
- Rust/Tauri tests if local validation is added; otherwise broker endpoint tests cover owner-count, self-change, confirmation, and GitHub-role synchronization.
- Run `npm test`; run `cargo test` if Rust validation or command tests are added.

## Assumptions

- Backend/broker work is included.
- Confirmation text is the target GitHub username.
- GitHub remains the source of truth for organization ownership; GnosisTMS stores only app-specific non-owner roles.
- GitHub REST docs state organization owners can update member roles, role values are `admin`/`member` at the membership endpoint, and removing org membership requires an organization owner.
