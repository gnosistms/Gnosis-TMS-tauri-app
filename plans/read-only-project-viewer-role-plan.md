# Read-Only Project Viewer Role Plan

## Goal

Add a new user role for people who can view project files but cannot modify anything. This role can download project assets, including chapters, glossaries, and QA lists, but cannot create, edit, delete, restore, import, sync, commit, or push any changes.

## Expected Permissions

The new role should be named `viewer` or `read_only`, depending on the existing naming style in the app.

Allowed:

- Open and view projects.
- View project files and chapters.
- View glossaries.
- View QA lists.
- Download/export chapters.
- Download/export glossaries.
- Download/export QA lists.

Forbidden:

- Add files to a project.
- Edit chapter content or metadata.
- Rename files, chapters, glossaries, or QA lists.
- Delete, restore, permanently delete, or clear deleted files.
- Import files, glossaries, or QA lists.
- Save edited glossary or QA list content.
- Run AI-assisted write/apply actions that modify project data.
- Commit, push, sync, or otherwise write to git.
- Trigger any backend command that mutates project files, metadata, git state, glossary files, or QA list files.

## Implementation Plan

1. Map the existing permission model.

   - Identify where current user roles are defined and stored.
   - Trace how frontend permissions such as `canManageProjects`, `canDelete`, and edit-related flags are derived.
   - Identify whether permissions are team-wide, project-specific, repository-specific, or inferred from GitHub membership.
   - List all mutating frontend actions and their corresponding backend commands.

2. Add the viewer role to the role model.

   - Extend the existing user/member role enum or role constants.
   - Add a derived capability such as `canViewProjectFiles`.
   - Add a derived capability such as `canDownloadProjectFiles`.
   - Add a derived capability such as `canMutateProjectFiles`, which must be `false` for viewers.
   - Prefer positive capability checks over scattered role-name checks.

3. Update user management.

   - Add the viewer role as an option wherever users are invited or edited.
   - Show the viewer role in user/member lists.
   - Persist the selected role in the same metadata path used by existing roles.
   - Ensure existing roles retain their current behavior.

4. Gate frontend write actions.

   - Hide or disable write actions for viewers.
   - Apply this to project actions, chapter actions, glossary actions, QA list actions, deleted-file actions, and git/sync actions.
   - Keep download actions visible and enabled.
   - Make blocked actions impossible to trigger from keyboard shortcuts, context menus, modal submit buttons, and secondary action handlers.

5. Add backend enforcement.

   - Add permission checks to mutating Tauri commands.
   - Reject viewer access before touching the filesystem, project metadata, glossary files, QA list files, or git state.
   - Keep export/download commands allowed.
   - Ensure git commit, push, and sync commands explicitly reject viewer users.
   - Return a clear error message such as `Read-only users cannot modify projects.`

6. Prevent git write access.

   - Inspect how the app obtains git/GitHub credentials for users.
   - Ensure viewers do not receive write-capable credentials from the app.
   - If GitHub repository permissions are managed outside the app, document that viewer users must also have read-only GitHub repository access.
   - If the app manages GitHub teams or collaborators, assign viewers to a read-only permission path.

7. Preserve downloads.

   - Verify chapter download/export still works for viewers.
   - Verify glossary download/export still works for viewers.
   - Verify QA list download/export still works for viewers.
   - Confirm these flows do not create commits or persist metadata changes as part of export.

8. Add tests.

   - Add frontend tests proving viewers can open projects and see files.
   - Add frontend tests proving viewers can download chapters, glossaries, and QA lists.
   - Add frontend tests proving viewers cannot see or trigger edit, add, delete, import, restore, clear, commit, sync, or push actions.
   - Add backend tests for permission rejection on mutating commands where the existing test structure supports it.
   - Add regression tests proving existing editable roles still have their current capabilities.

9. Verify manually.

   - Run focused frontend tests for project, glossary, QA list, and user/member screens.
   - Run Rust checks/tests for backend permission logic.
   - Manually inspect the most important UI paths as a viewer:
     - project file list
     - chapter view
     - glossary view
     - QA list view
     - downloads
     - member/user management
     - sync/commit controls

## Notes and Risks

- UI-only enforcement is not enough. Backend mutation commands must reject viewer users.
- If viewers still have direct GitHub repository write permission outside the app, they may be able to commit outside GnosisTMS. The app should avoid granting write credentials, but repository/team permissions may also need to be configured read-only.
- Export/download flows must be checked carefully. They are allowed only if they do not persist metadata, write project state, or commit generated files.
- Prefer central capability helpers so future write actions automatically respect the viewer role.
