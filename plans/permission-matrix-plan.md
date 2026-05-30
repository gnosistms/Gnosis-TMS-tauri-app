# Permission Matrix Implementation Plan

## Summary

Replace the current overloaded permission checks with explicit capabilities. The current model uses `canManageProjects`, `canDelete`, and `canManageMembers` for too many unrelated actions, which causes bugs such as translators being blocked from editor writes because they cannot manage projects. The new model separates content writing, resource management, member management, team management, downloads, and local-only deletion.

## Target Permission Matrix

| Role | Download | Write Chapters | Write Glossaries | Write QA Lists | Manage Projects | Manage Glossary Resources | Manage QA Resources | Manage Members | Manage Team |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Viewer | yes | no | no | no | no | no | no | no | no |
| Translator | yes | yes | yes | yes | no | no | no | no | no |
| Admin | yes | yes | yes | yes | yes | yes | yes | no | no |
| Owner | yes | yes | yes | yes | yes | yes | yes | yes | yes |

Local hard-delete is allowed for every authenticated team record because it only removes the local cached copy from the current computer.

## Capability Definitions

- `canDownload`: download project files, chapter exports, glossaries, and QA lists.
- `canWriteChapters`: edit translation text, footnotes, image captions, comments, review markers, text style, row insert/delete/restore inside a chapter, AI Translate output, AI Translate All output, and AI Review apply output.
- `canWriteGlossaries`: edit glossary terms and glossary contents.
- `canWriteQaLists`: edit QA list terms and QA list contents.
- `canManageProjects`: create/import projects if GitHub allows it, rename projects, soft-delete/restore projects, add/import chapters, rename chapters, soft-delete/restore chapters, manage chapter languages, and assign glossaries.
- `canManageGlossaryResources`: create, rename, soft-delete, restore, and shared-resource-manage glossary repos/records. This does not control editing terms inside an existing glossary.
- `canManageQaListResources`: create, rename, soft-delete, restore, and shared-resource-manage QA list repos/records. This does not control editing terms inside an existing QA list.
- `canManageMembers`: invite members, remove members, change account types, promote owners, and demote owners.
- `canManageTeam`: owner-level team settings, GitHub app permission setup, shared AI settings, and ownership-sensitive actions.
- `canLocalHardDelete`: remove local cached project, glossary, QA list, file, or row data from this computer only.

## Frontend Capability Helper

Add a central helper, likely `src-ui/app/permissions.js`, with:

```js
normalizeAccountRole(value)
deriveTeamCapabilities(team)
canDownload(team)
canWriteChapters(team)
canWriteGlossaries(team)
canWriteQaLists(team)
canManageProjects(team)
canManageGlossaryResources(team)
canManageQaListResources(team)
canManageMembers(team)
canManageTeam(team)
canLocalHardDelete(team)
```

Rules:

- Viewer is always read-only for shared data, even if stale stored booleans say otherwise.
- Translator can write chapters, glossary contents, and QA list contents, but cannot manage resource lifecycle, members, or team settings.
- Admin can write content and manage resource structure, but cannot manage members or team settings.
- Owner can do everything.
- If stored records do not yet include explicit capabilities, derive from `membershipRole`.
- If `membershipRole` is missing, fall back conservatively to legacy booleans only as a compatibility path.

Role normalization:

- `owner` maps to Owner.
- `admin` maps to Admin.
- `translator`, `member`, and raw GitHub non-owner member roles map to Translator.
- `viewer`, `read_only`, `read-only`, and `readonly` map to Viewer.
- Unknown non-empty roles should not silently get Owner/Admin privileges. Treat them as Translator only if they are known GitHub member aliases; otherwise use the conservative fallback and force a team refresh.

## Team Record Normalization

Update team normalization in:

- `src-ui/app/team-flow/team-records.js`
- `src-ui/app/team-storage.js`
- any team query/cache normalization code

Store explicit capabilities on team records:

```js
canDownload
canWriteChapters
canWriteGlossaries
canWriteQaLists
canManageProjects
canManageGlossaryResources
canManageQaListResources
canManageMembers
canManageTeam
canLocalHardDelete
```

During the transition, broker-provided booleans may be accepted, but role-derived safety must clamp them:

- Viewer cannot write or manage anything shared.
- Translator cannot manage project/glossary/QA resource lifecycle, members, or team settings.
- Admin cannot manage members or team settings.
- Do not derive `canManageMembers` from legacy `canManageProjects`. It must be Owner-only under the normalized role model.

## Frontend Gate Updates

Replace existing UI/action gates as follows:

- Editor row saves, AI Translate, AI Translate All, AI Review apply, review markers, comments, footnotes, image captions, and text style: use `canWriteChapters`.
- Glossary editor and glossary term edits: use `canWriteGlossaries`.
- QA list editor and QA term edits: use `canWriteQaLists`.
- Project creation/import, project rename, project soft-delete/restore, chapter add/import, chapter rename, chapter soft-delete/restore, chapter language management, and glossary assignment: use `canManageProjects`.
- Glossary create, rename, soft-delete, restore, and shared lifecycle actions: use `canManageGlossaryResources`.
- QA list create, rename, soft-delete, restore, and shared lifecycle actions: use `canManageQaListResources`.
- Members page invite, remove, role dropdown, owner promotion, and owner demotion: use `canManageMembers`.
- AI Settings, shared provider key management, GitHub app permission setup, and owner-sensitive team actions: use `canManageTeam`.
- Download actions: use `canDownload`.
- Local hard-delete actions: use `canLocalHardDelete`.

Important editor behavior:

- Do not lock the whole editor for project-management denial.
- Only set the editor write lock when the current role no longer permits `canWriteChapters`.
- The reported bug must be fixed: a Translator with `canManageProjects: false` must be able to run AI Translate All and save rows.

## Action Classification

Use this classification to avoid ambiguous permission decisions during implementation.

### Chapter Content Writes: `canWriteChapters`

- Row text, footnotes, image captions, uploaded row images, image URLs, and image removal.
- Review markers such as reviewed / please-check.
- Text style.
- Comments.
- Row insert, row shared soft-delete, and row shared restore.
- Row local permanent delete uses `canLocalHardDelete` only if it is truly local-only and does not create a shared commit. Any row delete/restore that writes shared repo state uses `canWriteChapters`.
- AI Translate, AI Translate All, and AI Review apply.
- Restore-from-history and undo/replace operations that modify row/chapter content.

### Project Management: `canManageProjects`

- Create project repos.
- Import/add files/chapters.
- Rename project.
- Soft-delete/restore project.
- Rename chapter/file.
- Soft-delete/restore chapter/file.
- Manage chapter languages.
- Assign or change chapter glossary links.
- Project/chapter metadata repair actions that write shared project metadata.

### Glossary Content Writes: `canWriteGlossaries`

- Add/edit/delete glossary terms.
- Import or update glossary term content inside an existing glossary.
- Any operation that changes glossary content but does not create, rename, soft-delete, or restore the glossary resource itself.

### Glossary Resource Management: `canManageGlossaryResources`

- Create glossary repos/records.
- Rename glossary resource.
- Soft-delete/restore glossary resource.
- Shared repair/rebuild actions that modify glossary resource metadata.

### QA List Content Writes: `canWriteQaLists`

- Add/edit/delete QA terms.
- Import or update QA term content inside an existing QA list.
- Any operation that changes QA list content but does not create, rename, soft-delete, or restore the QA list resource itself.

### QA List Resource Management: `canManageQaListResources`

- Create QA list repos/records.
- Rename QA list resource.
- Soft-delete/restore QA list resource.
- Shared repair/rebuild actions that modify QA resource metadata.

### Member / Team Management

- Member invite, removal, role changes, owner promotion, and owner demotion: `canManageMembers`.
- Shared AI settings, GitHub app permission setup, ownership-sensitive team settings, and owner-only team actions: `canManageTeam`.

## Backend/Tauri Guards

Split `ensure_installation_allows_writes` in `src-tauri/src/installation_access.rs` into explicit guards:

```rust
ensure_installation_allows_chapter_writes
ensure_installation_allows_glossary_writes
ensure_installation_allows_qa_list_writes
ensure_installation_allows_project_management
ensure_installation_allows_glossary_management
ensure_installation_allows_qa_list_management
ensure_installation_allows_member_management
ensure_installation_allows_team_management
```

Suggested role checks:

- Chapter writes: Translator, Admin, Owner.
- Glossary writes: Translator, Admin, Owner.
- QA list writes: Translator, Admin, Owner.
- Project management: Admin, Owner.
- Glossary resource management: Admin, Owner.
- QA list resource management: Admin, Owner.
- Member management: Owner only.
- Team management: Owner only.
- Viewer: no shared writes.

Apply guards command by command:

- Editor row/content commands: chapter writes.
- Glossary term/content commands: glossary writes.
- QA term/content commands: QA list writes.
- Project/chapter structural commands: project management.
- Glossary create/rename/lifecycle/metadata commands: glossary resource management.
- QA list create/rename/lifecycle/metadata commands: QA list resource management.
- Member invite/remove/role commands: member management.
- Shared AI/team settings commands: team management.

Keep local-only hard-delete outside remote write enforcement when it does not change shared GitHub/team data.

Important Rust refactor:

- `git_commit_as_signed_in_user_with_metadata` currently calls a broad repo-write guard through `ensure_repo_allows_writes`.
- That generic commit helper cannot know whether a commit is a chapter write, glossary write, QA write, or project-management write unless the required capability is passed in.
- Refactor commit calls so the Tauri command validates the required capability before calling lower-level sync code, or extend the commit metadata/context with an explicit required capability.
- Do not leave the generic commit helper with a broad `canManageProjects` requirement, or Translator chapter/glossary/QA writes will keep failing.

## Broker Alignment

Update broker role/capability logic to return either explicit capability fields or enough role data for the app to derive capabilities safely.

Broker enforcement must match the app:

- Viewer cannot write shared data.
- Translator can write chapters, glossaries, and QA lists.
- Translator cannot manage project/glossary/QA resource lifecycle.
- Admin can write content and manage project/glossary/QA resource structure.
- Admin cannot invite/remove members or change roles.
- Owner can manage members and team settings.

Member role mutation endpoints must be Owner-only.

## Error Messages

Replace misleading viewer-only errors with action-specific messages:

- Viewer editor block: `Viewers cannot edit chapter content.`
- Translator project-management block: `Translators cannot manage project structure.`
- Translator glossary-resource-management block: `Translators cannot manage glossary resources.`
- Translator QA-resource-management block: `Translators cannot manage QA list resources.`
- Admin member-management block: `Only team owners can manage members.`
- Team-management block: `Only team owners can change team settings.`
- Stale role during commit: `Your account type no longer allows this action.`

The editor should not tell a Translator that their account is Viewer.

## Tests

Add regression tests for every role.

Viewer:

- Can download.
- Cannot edit chapter text.
- Cannot edit glossary terms.
- Cannot edit QA terms.
- Can local hard-delete.

Translator:

- Can save chapter rows.
- Can run AI Translate and AI Translate All.
- Can apply AI Review output.
- Can edit glossary terms.
- Can edit QA terms.
- Cannot create/import/rename/soft-delete/restore projects or chapters.
- Cannot create/rename/soft-delete/restore glossary resources.
- Cannot create/rename/soft-delete/restore QA list resources.
- Cannot manage members.
- Cannot manage team/AI settings.

Admin:

- Can write chapters, glossaries, and QA lists.
- Can manage projects and chapters.
- Can create/rename/soft-delete/restore glossary resources.
- Can create/rename/soft-delete/restore QA list resources.
- Cannot invite/remove members.
- Cannot change account types.
- Cannot manage team/AI settings.

Owner:

- Can perform all shared actions.

Targeted reported-bug tests:

- Translator with `canManageProjects: false` can run AI Translate All.
- Translator with `canManageProjects: false` can save a row.
- Viewer is blocked from AI Translate All with a viewer/content-write message.
- A role change from Translator to Viewer while the editor is open blocks the next chapter commit and surfaces a badge without misclassifying Translators.

## Implementation Order

1. Add the frontend capability helper and unit tests.
2. Update team normalization/storage/query code to expose explicit capability fields.
3. Replace editor gates with `canWriteChapters`.
4. Split Rust/Tauri guards and update editor row/content commands.
5. Replace glossary gates and guards with `canWriteGlossaries`.
6. Replace QA list gates and guards with `canWriteQaLists`.
7. Replace glossary and QA list resource lifecycle gates with `canManageGlossaryResources` and `canManageQaListResources`.
8. Replace project/chapter structural gates and guards with `canManageProjects`.
9. Replace member/team gates and broker enforcement with Owner-only `canManageMembers` / `canManageTeam`.
10. Refactor generic Rust git commit enforcement so lower-level commit helpers do not reintroduce the old broad project-management gate.
11. Clean up old helper names that now hide intent, especially uses of `canMutateProjectFiles`.
12. Run focused tests for each touched capability area before moving to the next area.
13. Run full frontend, Rust, and broker verification.
14. Run a manual app smoke test for each role.
15. Release a patch version.

## Verification Plan

Use verification gates throughout implementation instead of waiting until the end.

### Focused Verification After Each Stage

- Capability helper stage:
  - Run the new capability unit tests.
  - Confirm Viewer clamping wins over stale legacy booleans.
  - Confirm missing `membershipRole` uses the documented conservative fallback.
- Team normalization stage:
  - Run team query/storage tests.
  - Confirm cached teams with old fields still load.
  - Confirm fresh broker teams expose all new capability fields.
- Editor/chapter-write stage:
  - Run editor write permission tests.
  - Run AI Translate / AI Translate All tests.
  - Run editor operation queue tests.
  - Confirm Translator with `canManageProjects: false` can save rows.
  - Confirm Viewer cannot save rows.
- Glossary stage:
  - Run glossary screen/editor/lifecycle tests.
  - Confirm Translator can edit terms.
  - Confirm Translator cannot create/rename/delete/restore glossary resources.
  - Confirm Admin can create/rename/delete/restore glossary resources.
- QA list stage:
  - Run QA screen/editor/lifecycle tests.
  - Confirm QA behavior matches glossary behavior.
  - Confirm Translator can edit QA terms.
  - Confirm Translator cannot create/rename/delete/restore QA resources.
  - Confirm Admin can create/rename/delete/restore QA resources.
- Project management stage:
  - Run project screen, project flow, project import, and chapter lifecycle tests.
  - Confirm Admin can rename/soft-delete/restore projects and chapters.
  - Confirm Translator cannot manage project structure.
- Member/team stage:
  - Run members page and team AI/settings tests.
  - Confirm Admin cannot invite, remove, or change roles.
  - Confirm Owner can still manage members.

### Full Automated Verification

Run before release:

```bash
npm test
cargo test --lib
npm run build
```

Run broker tests in the broker repository after broker permission changes. The broker test suite must cover:

- Translator chapter/glossary/QA writes allowed.
- Translator project/glossary-resource/QA-resource/member/team management denied.
- Admin project management allowed.
- Admin glossary-resource and QA-resource management allowed.
- Admin member/team management denied.
- Owner member/team management allowed.
- Viewer all shared writes denied.

### Manual Smoke Test

Run the Tauri dev app and smoke-test these flows with representative accounts or mocked/team fixtures:

- Viewer:
  - Open project, glossary, and QA pages.
  - Download files.
  - Confirm editor inputs and write actions are unavailable.
  - Confirm local hard-delete is available where expected.
- Translator:
  - Edit and save a chapter row.
  - Run AI Translate All.
  - Edit a glossary term.
  - Edit a QA term.
  - Confirm project rename/delete/import controls are unavailable.
  - Confirm glossary and QA list create/rename/delete/restore controls are unavailable.
  - Confirm member management is unavailable.
- Admin:
  - Rename or soft-delete/restore a project.
  - Edit chapter/glossary/QA content.
  - Create or rename a glossary resource.
  - Create or rename a QA list resource.
  - Confirm member management is unavailable.
- Owner:
  - Invite a member.
  - Change a member role.
  - Access shared AI/team settings.

### Release Gate

Do not release until:

- All automated tests pass.
- Broker changes are pushed/deployed if required by the implementation.
- The dev app smoke test covers at least Translator AI Translate All and Admin member-management denial.
- Any compatibility fallback for old cached team records has a regression test.

## Compatibility Notes

No repo data migration is needed.

Stored local team records may lack the new capability fields. The app should derive capabilities from `membershipRole` until fresh team data arrives. If `membershipRole` is absent, use a conservative legacy fallback and refresh teams as soon as possible.

## Open Implementation Risks

- Some backend commands currently use one broad write guard. They must be classified carefully so translators are not accidentally given project-management power.
- GitHub organization settings may prevent non-owner/Admin repo creation even if GnosisTMS allows Admin project creation. The UI should surface the GitHub failure clearly.
- Glossary and QA list behavior is currently inconsistent. This implementation should intentionally make them parallel.
- Editor write-lock behavior must distinguish chapter-write denial from unrelated management denial, otherwise users can get locked out after a non-editor permission error.
