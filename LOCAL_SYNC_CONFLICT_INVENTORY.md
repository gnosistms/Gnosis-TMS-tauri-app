# Local-First Sync Conflict Inventory

This document defines the conflict cases that Gnosis TMS must handle when project/team data is stored in local git repositories and synchronized with GitHub.

This is a design inventory, not an implementation plan. The goal is to enumerate every meaningful conflict that can happen:

- within a page
- across pages
- between local state and GitHub
- between different app instances
- between different users

We should treat this document as the policy source before implementing local-first storage.

## Scope

This document covers the current and near-future app surfaces:

- Teams page
- New Team flow
- Projects page
- Project modals
- Deleted Projects section
- Users page
- Glossaries page
- Glossary editor
- Translate page
- App-wide and cross-page conflicts

It also covers conflicts involving:

- GitHub org changes
- GitHub App installation changes
- repo creation / deletion / renaming
- local dirty working trees
- local-vs-remote divergence
- missing or invalid metadata files

## Entities

The main entities that can conflict are:

- GitHub organization
- GitHub App installation
- local clone of a project repo
- `project.json`
- chapter folders
- `chapter.json`
- `rowOrder.json`
- row JSON files
- glossary repo
- glossary term records
- cached UI state

## Global Conflict Handling Principles

These rules should apply everywhere unless a page-specific rule overrides them.

1. Never silently discard local changes.
2. Never auto-merge user-authored content without a visible policy.
3. Prefer local reads for speed, but always track whether local state is:
   - clean and synced
   - ahead of remote
   - behind remote
   - diverged
   - invalid/corrupt
4. If an action cannot be completed safely, block it and explain why.
5. If an object disappears remotely while a page is open, the UI should leave the current screen gracefully instead of crashing.
6. If local and remote changes conflict on the same semantic field, prefer surfacing a conflict state over guessing.
7. If the user can continue safely in read-only mode, prefer that over ejecting them immediately.
8. If a page is showing stale data, the UI should make that explicit.
9. Conflicts should be scoped as narrowly as possible:
   - row-level conflicts should not block the whole repo if avoidable
   - chapter conflicts should not block unrelated chapters if avoidable
10. Any conflict state should preserve enough information for a later manual or guided resolution.

## Sync State Model

Every local repo should be able to report one of these states:

- `not_cloned`
- `cloning`
- `synced`
- `local_changes`
- `remote_updates`
- `diverged`
- `push_failed`
- `conflicted`
- `missing_remote`
- `installation_missing`
- `corrupt_local`

Every page that depends on a repo, team, or installation should be designed around these states.

## Teams Page

### Entity shown

- GitHub organizations connected to Gnosis TMS

### Actions on this page

- load teams
- auto-open projects if there is exactly one team
- open team
- rename team
- create new team
- delete team (future)

### Team load conflicts

#### Remote team was renamed

Meaning:
- GitHub org `name` changed
- slug may be unchanged

Required behavior:
- refresh the displayed team name
- preserve the same selected team if the org slug / installation id still match
- do not treat this as a different team

#### Remote team slug changed

Meaning:
- organization login changed in GitHub UI

Required behavior:
- update local team record to the new slug
- update any local repo namespace path mapping for that org
- if path migration is not yet supported, mark the team as `needs_local_rebind`
- do not silently orphan local repos under the old slug path

#### Team was deleted remotely

Required behavior:
- remove the team from the active list
- if the user is currently viewing that team elsewhere, redirect to Teams page
- show a notice:
  - "This team no longer exists on GitHub."

#### GitHub App installation was removed from the org

Required behavior:
- keep the team visible if the org still exists, but mark it disconnected
- disable project/user/glossary operations that require the installation
- show a reconnect/install-app CTA

#### User lost access to the team org

Required behavior:
- remove the team from active accessible teams
- if it is currently selected, exit to Teams page
- do not show stale team actions that will fail

#### Team exists locally but cannot be found on GitHub

Required behavior:
- mark as `missing_remote`
- do not trust local metadata as proof the team still exists
- show explicit repair/remove choice later

### Rename team conflicts

#### Team name changed remotely while rename modal is open

Required behavior:
- on submit, detect whether the org `name` changed since modal opened
- if yes, block submit and show:
  - current remote name
  - user-entered proposed name
- ask the user to confirm retry against latest remote value

#### Team deleted remotely while rename modal is open

Required behavior:
- submit must fail cleanly
- close modal
- remove team from active list

#### GitHub App installation removed while rename modal is open

Required behavior:
- submit must fail with reconnect/install message
- keep modal open only if retry is possible; otherwise close it

### New team flow conflicts

#### User creates org but never installs the GitHub App

Required behavior:
- keep setup flow incomplete
- do not create a phantom team in local storage

#### User installs app on a different org than intended

Required behavior:
- the installed org is the source of truth
- the app should connect the installed org, not the originally intended name

#### Org name changes during setup

Required behavior:
- connect the org using installation/org identity, not draft name text

## Projects Page

### Entity shown

- active project repos in the selected team
- deleted project repos in the deleted-projects section

### Actions on this page

- load project list
- search projects
- create project
- rename project
- soft delete project
- permanently delete deleted project
- expand project card
- open chapter in Translate
- import (future)
- chapter download/rename/delete (future placeholders)

### Project list load conflicts

#### Project added remotely

Required behavior:
- if local clone/index has not seen it yet, show it as newly discovered
- if background fetch finds it, add it to the active list
- if local cache exists but repo not yet cloned, show metadata from cache and mark repo `not_cloned`

#### Project deleted remotely

This can mean either:
- soft-deleted by changing repo property
- permanently deleted from GitHub

Required behavior:
- if soft-deleted, remove from active list and place in deleted list
- if permanently deleted, remove from both lists and mark any local clone `missing_remote`

#### Project renamed remotely

Meaning:
- `project.json.title` changed

Required behavior:
- update displayed human-readable title
- keep same project identity and same repo slug

#### Repo slug renamed remotely

Required behavior:
- update local mapping from project id to repo full name
- do not lose local clone association
- if path migration is unsupported, mark project as `needs_local_rebind`

#### `project.json` missing remotely

Required behavior:
- project is invalid for Gnosis TMS
- keep repo out of normal active project list
- surface it in an invalid-projects state later, not as a crash

#### `project.json` invalid or unparsable

Required behavior:
- same as above
- mark repo `corrupt_remote_metadata`

#### Local clone exists but remote no longer does

Required behavior:
- project remains available only as a local orphan until user resolves it
- show `missing_remote`
- disable push/pull until resolved

### Create project conflicts

#### Repo with target slug already exists remotely

Required behavior:
- block create
- show GitHub error
- keep modal open

#### Another user creates a project with same title but different slug first

Required behavior:
- allow both if slug differs
- title collisions are allowed unless product later forbids them

#### Remote create succeeds but local clone/index update fails

Required behavior:
- do not pretend create failed
- show project as created remotely but local sync incomplete
- offer retry local clone/index initialization

#### Local create staged but push fails

Required behavior:
- keep local repo with pending commit
- mark project `push_failed`
- do not duplicate-create remotely on retry

### Rename project conflicts

#### Local rename conflicts with remote rename

Meaning:
- both changed `project.json.title`

Required behavior:
- if same final title, resolve automatically
- if different final titles, mark project metadata conflict
- do not silently overwrite remote title
- show both versions and require user choice

#### Project deleted remotely while rename modal is open

Required behavior:
- block rename
- close modal
- refresh list into deleted or missing state

#### Repo permanently deleted while rename modal is open

Required behavior:
- block rename
- remove project from visible active list

#### `project.json` changed for unrelated fields while rename happens

Required behavior:
- rename operation should patch only `title`
- if another field changed remotely and file SHA differs, require pull/retry instead of overwriting full file

### Soft delete conflicts

#### Project already soft-deleted remotely

Required behavior:
- action is idempotent
- remove it from active list and place in deleted list

#### Project was permanently deleted remotely before local soft delete

Required behavior:
- treat as missing remote
- remove from active list

#### Project open in another app window while soft delete happens

Required behavior:
- other window should be forced out of active editing state for that project
- project should move to deleted state in that window on next refresh

### Permanent delete conflicts

#### Project already permanently deleted remotely

Required behavior:
- treat delete as already complete
- remove it from deleted list

#### Project restored remotely while permanent delete modal is open

Required behavior:
- block permanent delete until user refreshes
- do not permanently delete a project that is no longer in deleted state

#### Local clone exists with unpublished work when permanent delete is requested

Required behavior:
- block permanent delete
- require explicit resolution of unpublished local commits first

### Project expansion / chapter preview conflicts

#### Chapters changed remotely while project card is expanded

Required behavior:
- on refresh, expand state can remain
- chapter list should update in place
- if selected chapter disappears, clear that selection

#### Project deleted while expanded

Required behavior:
- collapse implicitly by removing it from active list

## Deleted Projects Section

### Actions

- show/hide deleted projects
- permanently delete deleted projects
- future restore

### Conflicts

#### Deleted project restored remotely while deleted section is open

Required behavior:
- move it back to active projects list
- remove it from deleted list

#### Deleted project renamed remotely

Required behavior:
- update displayed title in deleted list

#### Deleted project gains new commits remotely

Required behavior:
- allowed
- still treat status field as source of deleted/active state

## Users Page

### Entity shown

- GitHub organization members

### Actions on this page

- load users
- invite user (planned)
- remove user (planned)
- open external GitHub profile

### User load conflicts

#### User added remotely

Required behavior:
- add to list on refresh

#### User removed remotely

Required behavior:
- remove from list on refresh

#### Organization deleted while Users page is open

Required behavior:
- exit to Teams page
- show team/org missing notice

#### GitHub App installation removed while Users page is open

Required behavior:
- show disconnected state instead of user list
- disable invite/remove

### Invite conflicts

#### User already invited by another user

Required behavior:
- show existing invitation state, not generic failure

#### User already became a member while invite modal is open

Required behavior:
- treat as success

#### User loses org access or installation loses permission mid-invite

Required behavior:
- fail gracefully
- keep modal open if retry makes sense

### Remove-user conflicts

#### User already removed remotely

Required behavior:
- treat as already complete

#### User removes self from org while viewing page

Required behavior:
- if current signed-in user no longer has access, exit page immediately

## Glossaries Page

Note: This page is still mostly mock data today, but the conflict inventory should be defined now because glossary repos will participate in the same local-first sync model.

### Entity shown

- glossary repos / glossary records

### Actions

- upload glossary
- create glossary
- rename glossary
- open glossary
- download glossary
- delete glossary

### Conflicts

#### Glossary added remotely

Required behavior:
- show it on refresh

#### Glossary deleted remotely

Required behavior:
- remove from list
- if open in glossary editor, exit gracefully

#### Glossary renamed remotely

Required behavior:
- update displayed title

#### Glossary referenced by project chapter but glossary repo is deleted

Required behavior:
- project UI should show missing glossary reference, not crash
- translation page should show unresolved glossary link

#### Glossary upload conflicts with remote glossary changes

Required behavior:
- if upload replaces same glossary object, require explicit merge/replace choice

## Glossary Editor Page

Note: Currently mock UI, but this page will need strong conflict rules because term edits are content edits.

### Actions

- create term
- edit term
- delete term
- search terms

### Term-level conflicts

#### Same term edited locally and remotely

Required behavior:
- mark term conflict
- show local version and remote version
- do not silently overwrite either

#### Term deleted remotely while local edit is open

Required behavior:
- block save
- show:
  - "This term was deleted remotely."
- allow save-as-new-term later

#### Term renamed remotely while local edit is open

Required behavior:
- if identity is stable, merge by id not by visible text
- if identity is text-based, require manual resolution

#### Whole glossary deleted remotely while editor is open

Required behavior:
- switch editor to read-only orphan state or exit back to Glossaries

## Translate Page

Note: This page is still based on mock data today, but this is where the most important future conflicts will happen.

### Entity shown

- one chapter of a project
- rows
- row order
- glossary references
- comments/history later

### Actions visible or implied on this page

- open chapter
- insert row
- delete row
- edit row text
- edit notes
- save
- save & review
- cancel
- search
- replace
- change filter
- unreview all
- download
- restore history item (future)
- comments (future)

### Chapter-level conflicts

#### Chapter added to project remotely while project page is open

Required behavior:
- project page updates chapter count and chapter list
- no immediate impact on currently open translate page unless it is the same project

#### Chapter removed remotely while open in Translate

Required behavior:
- if no unsaved local changes:
  - exit back to Projects page with notice
- if unsaved local changes:
  - preserve a local orphan/draft snapshot
  - block save to removed chapter until user resolves

#### Chapter renamed remotely while open in Translate

Required behavior:
- update title/header on refresh
- keep user in same chapter if chapter id is unchanged

#### Chapter moved/reordered remotely

Required behavior:
- no forced navigation change
- project page order updates on next refresh

#### Chapter metadata changed remotely while local edits are pending

Required behavior:
- merge only if metadata changes do not touch the same field
- otherwise mark chapter metadata conflict

### Row-level conflicts

#### Row content changed remotely while same row is being edited locally

Required behavior:
- mark row conflict
- show local draft vs remote committed content
- user must choose:
  - keep local
  - keep remote
  - merge manually

#### Row deleted remotely while being edited locally

Required behavior:
- block normal save
- offer:
  - restore as new row
  - discard local draft

#### Row inserted remotely while local row order also changed

Required behavior:
- treat content and ordering separately
- if row ids differ, merge order if possible
- if same anchor positions cannot be reconciled, mark row-order conflict only

#### Row review state changed remotely while text changed locally

Required behavior:
- text and workflow state should be merged independently where possible
- if same workflow field changed both sides, mark conflict

#### Row comments changed remotely while local row text changed

Required behavior:
- comments should not block text save if stored separately
- if stored in same file, field-level merge required

### Row-order conflicts

#### `rowOrder.json` changed locally and remotely

Required behavior:
- do not auto-pick one whole file if we can preserve both moves
- first attempt deterministic merge by row ids
- if impossible, mark row-order conflict and require resolution

#### Row file set and row order disagree

Meaning:
- row exists but missing from order
- order references row file that does not exist

Required behavior:
- mark chapter as structurally inconsistent
- block editing until repaired or auto-repair is approved

### Save / Save & Review conflicts

#### Save succeeds locally but push fails

Required behavior:
- preserve local commit
- mark chapter/project as `push_failed`
- keep user in editor

#### Save & Review conflicts with remote text changes

Required behavior:
- review-state update must not overwrite remote text blindly
- if row text diverged, require conflict resolution before review commit

#### Cancel after remote update arrives

Required behavior:
- cancel should discard only local unsaved draft
- then reload latest local+remote state

## Project/Chapter Import Conflicts

These are not implemented yet, but they will be major conflict sources.

### Project import

#### Import into a project that changed remotely since import started

Required behavior:
- compare base commit before writing imported content
- if changed, require rebase/review before applying import

### Chapter import

#### Import creates chapters that another user already added manually

Required behavior:
- de-duplicate by chapter id or explicit import mapping
- do not create duplicate semantic chapters silently

#### Import removes rows that another user edited remotely

Required behavior:
- block destructive import
- require explicit mapping/resolution

## Cross-Page Conflicts

These are the ones most likely to surprise users because the change starts on one page and breaks another.

### Team deleted while viewing Projects page

Required behavior:
- exit to Teams page
- show:
  - "This team no longer exists."

### Team renamed while viewing Projects page

Required behavior:
- update page title/header in place

### GitHub App installation removed while viewing Projects page

Required behavior:
- project list becomes disconnected/unavailable
- do not show stale action buttons as if they still work

### Project deleted while viewing Translate page

Required behavior:
- if only soft-deleted:
  - editor becomes read-only and shows deleted status
- if permanently deleted:
  - preserve unsaved local draft separately if any
  - exit project/chapter view

### Project renamed while viewing Translate page

Required behavior:
- update project title shown in navigation/header

### Project moved from active to deleted while viewing Users page

Required behavior:
- no direct effect on Users page
- only project-related UI should change

### Org deleted while viewing Glossaries page

Required behavior:
- exit to Teams page

### Glossary deleted while viewing Translate page

Required behavior:
- glossary reference pills become unavailable
- show missing-glossary state instead of broken UI

### Current signed-in user removed from org while any team page is open

Required behavior:
- immediately invalidate that team’s access
- navigate away from team-scoped pages

### OAuth session revoked while local repos remain on disk

Required behavior:
- keep local data readable if product allows offline mode
- block sync operations until re-auth

## Multi-Window / Multi-Instance Conflicts

### Same user opens same project in two app windows

#### One window edits, the other saves stale content

Required behavior:
- second save must detect local repo changed since editor opened
- require reload or merge

#### One window deletes project while the other renames it

Required behavior:
- delete takes precedence over visibility
- rename must fail cleanly against latest state

#### One window permanently deletes while other still has deleted-project card open

Required behavior:
- second window removes card on refresh

### Same user runs two app instances against same local clone

Required behavior:
- detect active lock or concurrent git operation
- avoid simultaneous git writes in same repo
- show:
  - "This project is busy in another window."

## Local Repository Integrity Conflicts

### Local repo missing

Required behavior:
- reclone on demand if remote exists

### Local repo has untracked files not created by app

Required behavior:
- do not delete them
- block risky sync operations if they would be affected

### Local repo has merge conflict markers in tracked files

Required behavior:
- mark repo `conflicted`
- block editing until resolved

### Local repo HEAD detached or otherwise manually altered

Required behavior:
- mark repo `unsupported_local_state`
- require repair

### `project.json` exists locally but not remotely

Required behavior:
- treat as unpublished local state if local commit exists and push failed
- otherwise mark inconsistency

### Local repo path no longer matches org slug or repo slug

Required behavior:
- path migration or rebind needed
- do not create duplicate clone automatically without checking existing data

## Metadata File Conflicts

### `project.json`

Fields likely to conflict:

- `title`
- `chapter_order`
- future `settings`

Handling:

- merge field-by-field when safe
- never overwrite unrelated fields due to stale whole-file write

### `chapter.json`

Fields likely to conflict:

- `title`
- `slug`
- `languages`
- `settings`
- `source_import`
- `appVersion`

Handling:

- `appVersion` should never itself cause a user-visible conflict
- semantic metadata conflicts should be field-level

### `rowOrder.json`

Handling:

- special merge logic required
- do not treat as plain text file if we want good UX

### row files

Handling:

- merge by field where possible
- if same field changed both sides, show row conflict

## Corruption / Invalid Data Cases

### Invalid JSON in local file

Required behavior:
- mark repo or chapter `corrupt_local`
- show repair/export raw file options later
- do not overwrite blindly

### Invalid JSON in remote file

Required behavior:
- mark `corrupt_remote`
- block pull/merge into clean local state unless user acknowledges

### Required field missing

Examples:

- missing `project_id`
- missing `chapter_id`
- missing `row_id`

Required behavior:
- mark entity invalid
- exclude from normal editing flows

## Minimal Resolution UI We Will Eventually Need

This is not implementation yet, but the conflict list implies these UI types:

- repo sync badge/status
- stale-data banner
- disconnected-team banner
- local-vs-remote conflict modal
- deleted-while-editing modal
- missing-remote banner
- invalid/corrupt metadata banner
- row conflict resolver
- row-order conflict resolver
- orphan local changes recovery screen

## Immediate Design Conclusions

Before implementing local-first sync, the app needs at least these foundational rules:

1. Project repo identity must not rely only on repo slug.
2. Every local repo needs explicit sync state tracking.
3. File writes must be patch-like and field-aware where possible.
4. We need repo-level locking to prevent concurrent local git operations.
5. We need a policy for:
   - local dirty + remote changed
   - push rejected
   - missing remote
   - deleted while open
6. We should not implement automatic destructive conflict resolution early.

## Recommended Next Step

Before building the local-first repo layer, we should decide:

1. Which conflicts block the user immediately vs allow read-only continuation.
2. Which conflicts we auto-resolve safely.
3. Which conflicts need dedicated UI from day one.
4. Which pages are allowed to operate offline.
5. Whether glossary and translate editing should ship only after row/chapter conflict UI exists.
