# Thread Handoff Summary

This file is a compact handoff for continuing the current work in a fresh thread.

## Repos

- App repo: `/Users/hans/Desktop/GnosisTMS`
- Broker repo: `/Users/hans/Desktop/gnosis-tms-github-app-broker`

## Current local runtime state

- Clean local app restart was just performed.
- Active local dev session:
  - Vite: `http://127.0.0.1:1431/`
  - Tauri app: `target/debug/gnosis-tms`
- Tauri dev process is running in exec session `35535`.

## Immediate open issue

The user reported that the Teams page still shows:

- `GitHub App update required. Missing: custom_properties:write`

even though:

1. The broker deploy `d45e22d` is live on DigitalOcean.
2. The GitHub installation page appears to already show the required permissions.
3. The local app has now been restarted cleanly to rule out stale local UI state.

### Most likely next diagnostic step

If the warning still appears after restart, inspect the live broker response for:

- `/api/github-app/installations`

and confirm what it is actually returning for:

- `needsAppApproval`
- `missingAppPermissions`

for the affected orgs.

The issue is likely one of:

- live broker still returning stale/incorrect permission info
- installation permission payload from GitHub not matching our required-permission comparison the way we expect
- app-side caching still being repopulated from a bad broker payload

## Important recent decisions

### GitHub permission warning UX

- Warning/check is intentionally shown only on the **Teams page**.
- Do **not** show this warning on the Members page.
- Do **not** substitute `Update App` inside Members-page controls.
- Owner behavior:
  - show `Update GitHub Permissions` button
  - open GitHub installation/settings page
- Non-owner behavior:
  - do **not** send them into GitHub install/request flow
  - instead show this instruction text in the warning box:
    - `Contact the owner of this team. Ask them to run Gnosis TMS and update GitHub permissions for this team on the Teams page.`

### GitHub error handling design

The user explicitly rejected broker-side shortening of GitHub errors.

- Full raw GitHub error should continue to flow through broker/app state for debugging.
- Only the **displayed UI text** should be shortened.

Current app-side formatter:

- File: `/Users/hans/Desktop/GnosisTMS/src-ui/app/error-display.js`
- Behavior:
  - if GitHub error payload has nested `errors[].message`, show **all** nested messages
  - otherwise fall back to top-level `message`
  - append `Status: <code>`

Example desired display:

- `GitHub API Invitee is already a part of this organization. Status: 422`

Broker-side shortening was reverted locally and should remain reverted.

## Broker state

### Latest broker deploy already live

- Commit: `d45e22d`
- Message: `Fix custom properties permission detection`

Purpose:

- changed required permission check from:
  - `custom_properties:admin`
- to:
  - `custom_properties:write`

### Broker local state

Broker file:

- `/Users/hans/Desktop/gnosis-tms-github-app-broker/src/github-app.js`

was reverted locally to preserve full raw GitHub errors:

- current desired implementation:
  - `parseGithubError(status, body) { return \`GitHub API ${status}: ${body}\`; }`

This revert was **not committed/pushed**.

If continuing broker work, first inspect git status in broker repo.

## App changes already made

### Teams page warning box

- warning box spans full card width
- appears beneath title/meta/actions
- uses shared message-box styling
- owner button uses error-button variant
- non-owner sees instructional text instead of request button

Relevant files:

- `/Users/hans/Desktop/GnosisTMS/src-ui/screens/teams/team-list.js`
- `/Users/hans/Desktop/GnosisTMS/src-ui/styles/content.css`
- `/Users/hans/Desktop/GnosisTMS/src-ui/styles/modals.css`
- `/Users/hans/Desktop/GnosisTMS/src-ui/styles/base.css`
- `/Users/hans/Desktop/GnosisTMS/src-ui/lib/ui.js`

### Buttons

Added shared error-button variant:

- `.button--error`
- helper: `errorButton(...)`

Loading primary buttons:

- spinner was restored
- loading state now has its own readable muted-orange style instead of washed-out disabled fade

### Teams page leave behavior

- `Leave` is no longer disabled just because `needsAppApproval` is true
- it is disabled only in offline mode

File:

- `/Users/hans/Desktop/GnosisTMS/src-ui/screens/teams/team-list.js`

### Members page performance fix

The invite modal delay was traced to blocking member-load I/O.

Fix made:

- `list_organization_members_for_installation` in:
  - `/Users/hans/Desktop/GnosisTMS/src-tauri/src/github/orgs.rs`
- was converted to async + `spawn_blocking`

`cargo check` passed after this change.

## App error-display wiring

User-facing error formatting is now wired into:

- `/Users/hans/Desktop/GnosisTMS/src-ui/screens/invite-user-modal.js`
- `/Users/hans/Desktop/GnosisTMS/src-ui/screens/project-creation-modal.js`
- `/Users/hans/Desktop/GnosisTMS/src-ui/screens/project-rename-modal.js`
- `/Users/hans/Desktop/GnosisTMS/src-ui/screens/project-permanent-deletion-modal.js`
- `/Users/hans/Desktop/GnosisTMS/src-ui/screens/teams/leave-modal.js`
- `/Users/hans/Desktop/GnosisTMS/src-ui/screens/teams/permanent-delete-modal.js`
- `/Users/hans/Desktop/GnosisTMS/src-ui/screens/teams/rename-modal.js`
- `/Users/hans/Desktop/GnosisTMS/src-ui/screens/teams/setup-modal.js`
- `/Users/hans/Desktop/GnosisTMS/src-ui/screens/projects.js`
- `/Users/hans/Desktop/GnosisTMS/src-ui/screens/users.js`

## Recent user preference / style notes

- User prefers direct, concise communication.
- User does not want unnecessary cheerleading.
- User asked to stop work on invite-search performance ideas that were suggested earlier.

## Likely useful next commands in a fresh thread

In app repo:

- `npm run build`
- `cargo check` in `src-tauri`

In broker repo:

- `git status --short`
- inspect `/api/github-app/installations` live response path
- verify local broker `src/github-app.js` state before committing anything

## If the warning still appears after restart

Priority order:

1. Inspect what the live broker is actually returning for the affected teams.
2. Compare that payload against the GitHub installation page screenshots.
3. Decide whether the bug is:
   - broker comparison logic
   - stale live deploy behavior
   - app persistence using bad broker data

