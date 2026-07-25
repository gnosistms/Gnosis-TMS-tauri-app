# Transfer Project to Another Team

Adds a **Transfer** button to project cards on the projects page. Transfer copies a
whole project into another team as a brand-new project repo, so that team can add a
language, delete keys, or restructure the content without touching the source team's
repo.

This is the project-level sibling of the existing chapter-level "Other Gnosis TMS team"
copy (`plans/team-chapter-copy-plan.md`,
[editor-export-team-copy-flow.js](src-ui/app/editor-export-team-copy-flow.js),
[team_copy.rs](src-tauri/src/project_import/chapter_editor/team_copy.rs)) and reuses its
machinery wherever possible.

Status: **implemented; automated verification complete, manual verification pending**
(2026-07-25).

---

## Review follow-ups resolved

The pre-publication review identified three correctness and safety gaps. The
implementation now:

- compensates a failed or ambiguous metadata push by strictly deleting the new
  metadata record before rolling back the project repo; if that compensating push is
  itself ambiguous, the destination repo is preserved so an active metadata record can
  never point at a deleted repo;
- validates every uploaded-image source path against the exact source chapter's
  canonical `images/` directory, rejecting absolute paths, parent traversal,
  cross-chapter paths, and symlink escapes;
- removes frontend-card empty-state gating and uses the Rust terminal event's
  `copiedChapters` result as the authoritative count published with project metadata.

---

## 1. Should this be a GitHub fork?

**No — create a fresh repo in the target org and copy the working tree into it.**
A fork looks cheaper than it is:

- **The auth model does not fit.** Project repos are created through the broker with a
  GitHub App **installation** token, and an installation token is scoped to one
  installation (one org). `POST /repos/{owner}/{repo}/forks?organization=<target-org>`
  authenticates as the source installation and asks GitHub to create a repo in a
  *different* org — an installation token cannot do that. Making it work would mean a
  new broker path using a user OAuth token with create-repo rights in the target org,
  i.e. a second auth model to build, secure, and support. (Confirm against the broker
  before discarding, but this is the expected blocker.)
- **A fork stays coupled to its parent.** Forks live in the parent's fork network
  permanently; detaching a private fork requires GitHub support. Private-fork access is
  derived from the parent repo, so permission changes on the source side can affect the
  copy. The entire point of the feature is that the two repos are independent.
- **A fork carries the whole history.** The target team would receive every commit the
  source team ever made, including content they deleted. A fresh repo starts with one
  "Transferred from …" commit — cleaner, smaller, and no accidental disclosure.
- **A fork saves no work.** Even after forking we would still have to rewrite, in a
  commit: the project title in `project.json`, every chapter's glossary link (glossary
  ids are team-scoped and would dangle), every chapter's workflow status, the chapter
  and row ids, and the repo name (fork inherits the source name). And the project only
  becomes visible after a record is written to the **target team's metadata repo** —
  a step the fork does nothing for.

So: **create + copy**, exactly like the chapter copy, generalized to every chapter.
Cost of the chosen approach: git history is not carried over. That is a deliberate,
desirable property here, and worth stating in the modal's supporting text.

---

## 2. UI

### 2.1 The button

[project-list-render.js](src-ui/screens/project-list-render.js) —
`deriveProjectRenderState()` builds the action list shared by both card layouts (the
virtualized active list and the deleted-projects articles), so one edit covers both.

Insert between **Add files** and **Rename**:

```js
canManageProjects
  ? textAction("Transfer", `transfer-project:${project.id}`, {
      disabled: offlineMode || localRepoSetupPending || disableContentActions,
    })
  : "",
```

Rationale for the disabled set: the transfer reads the project's **local** repo, so it
needs the same "local repo is present and healthy" conditions as Add files, and it needs
the network (offline blocked). It is deliberately **not** gated by
`heavyActionsDisabled` or `lifecycleActionsDisabled`: background sync and unrelated page
writes must not disable user-facing actions. Submission is serialized behind the exact
source-project repo queue in section 3.3, so an in-flight source write delays the
transfer instead of disabling its button.

Deleted projects (`isDeleted`) keep their existing action list — no Transfer button.

Row heights in the virtualized list are measured, not fixed
([projects-virtual-list.js](src-ui/app/projects-virtual-list.js) measures and calls
`resizeItem`), so a fourth button needs no height-estimate change. Check the narrow-window
layout of the four-button row once visually.

### 2.2 The modal

New file `src-ui/screens/project-transfer-modal.js`, rendered from
[projects.js](src-ui/screens/projects.js) alongside the other project modals.

Shell: the export modal's card (`modal-card--editor-export`) **without** the left
`<nav>` pane — a single detail column, since transfer is the only option. Title
"Transfer project".

Fields, top to bottom:

1. Supporting text: what a transfer does, and that it copies the current content only
   (no history), leaving the source project untouched.
2. **Team** select — every team where the user can create projects
   (`canManageProjects`, via `canCreateRepoResources`), **including the current team**:
   transferring into the team that already owns the project duplicates it, which is a
   supported use of this button (D3). Preselect when exactly one team is eligible, and
   load that team's resources immediately.
3. **Project name** text input, defaulting to the source project's title, freely
   editable (the Vietnamese team names its projects in Vietnamese, etc.).
4. **Glossary** select — the target team's glossaries plus a "No glossary" option,
   preselected to the largest glossary (D1). Rendered disabled with the note "That team
   has no glossaries yet." when the target team has none.
5. Contextual line: "N files will be copied into \<team\>." — and when the target is the
   current team, "This will create a second copy of the project in this team." When the
   target team already has a project with that title, a warning that names may repeat.
6. Stage line while running (progress event text, e.g. "Copying file 4 of 12…").
7. Error line; Cancel + **Transfer project** loading primary button.

`renderExportSelect()` and `supportingText()` currently live inside
[editor-export-modal.js](src-ui/screens/editor-export-modal.js). Extract them into a
shared module (`src-ui/screens/export-fields.js`) and import from both, so the two
panes cannot drift.

---

## 3. Frontend design

### 3.1 State

[state.js](src-ui/app/state.js): add `createProjectTransferState()` and
`state.projectTransfer`, following `createProjectRenameState()`:

```js
{
  isOpen: false, projectId: "", sourceTitle: "",
  targetTeamId: "", projectName: "", glossaryId: "",
  glossaries: [], targetProjects: [], resourcesStatus: "idle", // idle|loading|done|error
  status: "idle",        // idle|transferring
  stage: "", jobId: "", error: "",
}
```

Add `resetProjectTransfer()` and call it from `primeProjectsLoadingState()` next to
`resetProjectRename()`, so a team switch cannot leave a stale modal open. This reset is
**presentation-only**: it must not cancel or discard an in-flight transfer job.

This is modal/session state, not resource collection state, so direct mutation is
correct here (same category as `state.projectRename`). Nothing in this feature writes
`state.projects` — the source team's collection is untouched, and the target team's
projects appear through the normal query path when that team is next opened.

Active job orchestration does **not** live in `state.projectTransfer`. The flow module
owns a module-level `Map<jobId, ActiveProjectTransferJob>` containing the deferred
resolver/rejecter and the source/target/create descriptors needed to finish metadata or
rollback work. A team switch may reset the modal while the job continues; terminal
events always settle the registry entry even when no transfer modal is open. The entry
is removed only after metadata publication or rollback has finished, never merely when
the modal closes.

### 3.2 Flow module

New `src-ui/app/project-transfer-flow.js` (+ `project-transfer-flow.test.js`):

| Export | Responsibility |
|---|---|
| `eligibleProjectTransferTargets(appState)` | teams with `canCreateRepoResources`, current team included |
| `openProjectTransfer(render, projectId)` | seed `projectName` from the project title; preselect a single eligible team |
| `selectProjectTransferTeam(render, teamId, ops)` | load the target team's broker resources and metadata records, reconcile glossary options, collect existing project repo names, and preselect the glossary per 3.4; guard against stale responses after another team is picked |
| `updateProjectTransferName(value)` / `selectProjectTransferGlossary(render, id)` | field updates |
| `cancelProjectTransfer(render)` | close (blocked while `status === "transferring"`) |
| `submitProjectTransfer(render, ops)` | validation + orchestration (3.3) |
| `handleProjectTransferProgressEvent(payload, render)` | settle the module-level active-job registry by `jobId`; update modal stage/error only when that job is still represented in the current modal |
| `registerProjectTransferListeners(render)` | `listen("team-project-transfer-progress", …)`, registered in [main.js](src-ui/main.js) next to `registerTeamChapterCopyListeners` |

All Tauri calls injectable via an `operations` argument, as in the chapter copy flow, so
the unit tests need no runtime. Tests also get a reset helper for the module-level active
job registry.

### 3.3 Orchestration order (submit)

Ordering is chosen so that **no partial state is visible to the target team if anything
fails** — a successful content push is required, and the metadata record that makes the
project discoverable is written last.

0. Validate: target team, non-empty name, `slugifyRepoName(name)` non-empty, session
   token present, source project has at least one active file.
1. Take a repo-write queue slot for the **target team**
   (`enqueueRepoWrite({ scope: projectRepoScope({ team: targetTeam }), kind:
   "projectTransfer" })`) and hold it through create, copy, metadata publication, and
   rollback. This serializes the transaction with project-create operations for that
   team. Queue scopes are exact, not hierarchical; this team scope is not relied on to
   protect source project content or project-specific background sync.
2. Create the target repo, reusing the project-create path. Refactor
   `completeProjectCreateSynchronously()` in [project-flow.js](src-ui/app/project-flow.js)
   into `createProjectRepoForTeam(team, title, baseRepoName, { usedRepoNames, onProgress,
   writeMetadataRecord })` so the transfer can (a) pass the **target** team, (b) pass the
   target team's existing repo names for collision avoidance instead of `state.projects`,
   and (c) defer the metadata record. `create_gnosis_project_repo` + `initialize_gtms_project_repo`
   only, at this stage.
3. Before invoking Rust, create the deferred promise and register it in the module-level
   active-job map. Then enqueue `projectTransferSourceRead` on the source project's
   **exact** scope (`projectRepoScope({ team: sourceTeam, project: sourceProject })`).
   The queued callback invokes `transfer_gtms_project_to_team` and awaits the deferred
   terminal event. Holding that exact queue slot for the whole Rust job prevents editor
   saves or source-project sync from starting after a one-time idle check and changing
   files midway through enumeration. Do not use `waitForRepoWriteQueueIdle` here.
4. The Rust job returns from IPC immediately and emits progress events. A terminal
   `success` means both the content commit **and its push** succeeded. A terminal `error`
   rejects the registered deferred even if the user switched teams and the modal was
   reset.
5. Only after terminal success, write the metadata record for the target team
   (`upsertProjectMetadataRecord(targetTeam, {...}, { requirePushSuccess: true })` —
   `commitLocalMetadataMutation` clones that team's metadata repo if it has never been
   opened on this machine). Then close the modal and show a notice badge:
   "Transferred \<name\> to \<team\>. Open that team to see it."
   **When the projects page currently owns the target team at completion**, the new
   project must appear right away:
   run the project-create path's post-write refresh
   (`reloadProjectsAfterWrite(render, targetTeam, { suppressRecoveryWarning: true })`),
   set `state.selectedProjectId` to the new id, and word the notice as
   "Copied \<source title\> to \<name\>." Guard all page-state callbacks by current
   page/team ownership so a transfer that finishes after navigation cannot refresh or
   overwrite another team's visible page. The refresh uses the same
   `submitResourcePageWrite`/query path as project creation; if the target team is not
   currently visible, do not refresh the current page.
6. On failure after the target repo has been created: purge the local repo
   (`purge_local_gtms_project_repo`) and roll back the remote repo
   (`rollback_created_gnosis_project_repo`), exactly as the create path's `catch` does —
   this is why that code is being extracted rather than copied. If rollback itself fails,
   surface the combined message (the create path's existing wording). A content push
   failure follows this error/rollback path; it must never publish metadata for a remote
   repo that does not yet contain the transferred chapters.
7. In `finally`, remove the active-job registry entry only after success publication or
   rollback completes. The exact source-scope callback and outer target-team callback
   then settle normally, releasing their queue slots.

### 3.4 Glossary options and preselection (D1)

The glossary the transferred chapters get is chosen in the modal, not inferred from a
local cache. Building the option list:

- **Which glossaries exist** comes from reconciling two authoritative sources for the
  target team, loaded in parallel:
  - `list_gnosis_resources_for_installation` supplies remote GitHub repo identity
    (`repoId`, `nodeId`, `name`, `fullName`) and also supplies existing project repo names
    for collision avoidance.
  - `refreshGlossaryMetadataRecords(targetTeam)` supplies `glossaryId`, title,
    lifecycle, record, and remote state. Use the refresh variant so an already-cloned
    metadata repo cannot return a stale lifecycle snapshot; it synchronizes or clones the
    target team's metadata repo before reading, so this also works for a team never
    opened on this machine.
  The broker's `GithubGlossaryRepo` does **not** contain a glossary id, title, or
  lifecycle state, so it cannot build the select by itself. Reconcile metadata records
  with remote repos using the existing glossary discovery identity rules (repo id, node
  id, then repo/full name), and keep only live, active, remotely linked records with a
  matching remote repo.
- **Term counts** are *not* in the broker listing
  ([`GithubGlossaryRepo`](src-tauri/src/github/types.rs:67) has no `termCount`); they come
  from the per-team glossary cache (`loadStoredGlossariesForTeam`), so they are known only
  for teams this user has opened locally. Overlay them onto the reconciled metadata
  options by glossary id.
- **Preselection** = largest glossary, using the existing comparator
  `compareDefaultCandidates` in
  [glossary-default-flow.js:19](src-ui/app/glossary-default-flow.js:19) (term count
  descending, then title, then id). Export it (or move it to `glossary-shared.js`) rather
  than writing a second sort. With no counts known, that comparator degrades to
  alphabetical, which is the right fallback — a glossary is still preselected.
- **No glossaries** → the select renders disabled with "That team has no glossaries yet."
  and the transfer proceeds with no glossary link.
- The user can always choose **No glossary** explicitly.

The selected glossary's `{ glossaryId, repoName }` is passed to the Rust job as
`defaultGlossary`, which is the field `write_chapter_copy` already applies. The locally
cached team default (`defaultGlossaryLinkForTeamCopy`) is **not** used here — it is a
per-user, per-machine preference that is almost never set for a team you don't work in,
which is exactly the case a transfer targets.

### 3.5 Wiring

- [actions/project-actions.js](src-ui/app/actions/project-actions.js): prefix
  `transfer-project:` → `openProjectTransfer`; exact actions `submit-project-transfer`,
  `cancel-project-transfer`, `select-project-transfer-glossary:`.
  Do **not** add these to `READ_ONLY_PROJECT_WRITE_*` — a transfer performs no write in
  the current team; permission is enforced on the target team by the eligible-teams
  filter and by the broker.
- [offline-policy.js](src-ui/app/offline-policy.js): add `"transfer-project:"` to
  `OFFLINE_BLOCKED_PREFIXES` and `"submit-project-transfer"` to the exact set.
- [input-handlers.js](src-ui/app/input-handlers.js): `data-project-transfer-name-input`,
  `data-project-transfer-team-select`, `data-project-transfer-glossary-select`.
- [focused-input-state.js](src-ui/app/focused-input-state.js): add the same three
  selectors so focus survives re-renders.

---

## 4. Backend (Rust)

New module `src-tauri/src/project_import/chapter_editor/project_transfer.rs`, sibling of
`team_copy.rs` (it needs the same `Stored*` chapter/row types). Shared helpers already in
`team_copy.rs` — `write_chapter_copy`, `copy_row_images`, `unique_copied_image_name`,
`existing_folder_names`, `cleanup_chapter_copy` — are promoted to `pub(super)` and reused
rather than duplicated; `write_chapter_copy` gains a `reset_workflow_status: bool`
parameter (the chapter copy passes `false`, keeping its current behavior).

New command registered in [lib.rs](src-tauri/src/lib.rs):

```rust
transfer_gtms_project_to_team(app, input: ProjectTransferInput, session_token) -> Result<(), String>
```

Input: `jobId`, `source { installationId, projectId, repoName, projectTitle }`,
`target { installationId, projectId, repoName, fullName, repoId, defaultBranchName,
defaultBranchHeadOid, status, projectTitle }`, `glossary { glossaryId, repoName }?` (the
glossary chosen in the modal; `None` for "No glossary" — it feeds the same
`write_chapter_copy` parameter the chapter copy fills from the team default).

Shape follows `start_team_chapter_copy`: validate, then `spawn_blocking` +
`catch_unwind`, returning immediately; every stage and the terminal outcome are emitted as
**`team-project-transfer-progress`** events keyed by `jobId`
(`{ jobId, status: progress|success|error, message, copiedChapters, totalChapters,
targetProjectTitle }`).

Job body:

1. Resolve and validate the **source** repo path; require it to exist and be a valid git
   repo ("Open this project first so its files finish downloading.").
2. **Read the source repo's layout metadata** (`.gtms/repo.json`). If it is not the
   current v2 layout, refuse with a message telling the user to open the project once so
   its migration runs. (The chapter copy is exempt from this because it only ever runs on
   an open, migrated chapter — the project transfer can start from a card that was never
   opened.)
3. Enumerate `chapters/*/chapter.json`; **skip chapters whose `lifecycle.state` is
   `deleted`** (decision D2). Error out if nothing remains.
4. Resolve the target repo path, sync it (it was just created locally by step 3.3 of the
   JS flow), assert it is a valid, clean git repo, and run
   `ensure_local_commit_preconditions` (signed-in session + installation write access) —
   same gates content writes get.
5. For each chapter, in title order: load rows, then `write_chapter_copy(...)` with
   fresh chapter/row ids, image assets copied and paths rewritten, the chosen glossary
   applied (or the source link cleared when none was chosen), and
   `settings.workflow_status` set to `None` so every badge reads "none". Emit a progress
   event per chapter.
6. **One commit** for the whole transfer: `git add .gitattributes chapters` +
   `git_commit_as_signed_in_user_with_metadata` with
   `CommitMetadata { operation: Some("team-project-transfer"), .. }` and the message
   `Transfer <project title> from <source project title>`.
7. `sync_project_repo` to push. A push failure is a terminal **error**, as in the
   existing chapter-copy implementation. The frontend must not write metadata for an
   empty/stale remote repo; it purges the local checkout and rolls back the freshly
   created remote repo.
8. Any failure before the commit removes every written chapter directory (and
   `.gitattributes` if the transfer created it) so the fresh repo is never left dirty.

Everything else carries over verbatim, as in the chapter copy: languages, row content,
footnotes, captions, text styles, review states, editor comments, soft-deleted **rows**,
`order_key`s, and uploaded images.

---

## 5. Decisions (settled 2026-07-25)

**D1 — Glossary: user-selected, defaulting to the largest.** The modal shows a glossary
select for the target team; it preselects the largest glossary (term count, then title —
existing `compareDefaultCandidates` comparator) and is disabled when that team has no
glossaries. Options are metadata-backed and reconciled with the broker repo listing;
the broker listing alone does not contain glossary ids or titles. Full rules and data
sources are in section 3.4. This replaces the original
"team's cached default glossary" idea, which is a per-user, per-machine preference that
would silently resolve to nothing when transferring into a team you don't work in.

**D2 — Soft-deleted chapters are skipped.** A fresh project does not inherit another
team's trash. Soft-deleted *rows* inside a copied chapter still carry over, matching the
chapter copy.

**D3 — The current team is a valid target.** Transferring into the owning team
duplicates the project, and that is a supported use of this button. Consequences already
folded into the plan: the target list includes the current team (3.2), the source repo is
held on its exact queue scope while Rust reads it (3.3 step 3), and a transfer refreshes
the project list when the target team is still the visible page at completion (3.3
step 5). Repo-name collisions are already handled by the create path's
suffix-and-retry loop, so duplicating "Book of Thomas" yields a second project with the
same title on a distinct repo slug — worth a line of supporting text in the modal so the
user is not surprised.

---

## 6. Phases

- **P0 — Decisions.** Done (section 5).
- **P1 — Button + shared UI helpers. Done.** Extract `renderExportSelect`/`supportingText`
  into `screens/export-fields.js`; add the Transfer action to
  `deriveProjectRenderState`; source test for placement and disabled states.
- **P2 — Backend. Done.** Promote the shared helpers in `team_copy.rs`, add
  `reset_workflow_status`, write `project_transfer.rs` + command registration + Rust unit
  tests. Testable ahead of the UI via a scratch invoke.
- **P3 — State, modal, flow. Done.** `createProjectTransferState`, navigation-independent
  active-job registry, modal renderer, flow module, action/input/offline/focus wiring,
  listener registration in `main.js`.
- **P4 — Create-path refactor. Done.** Extract `createProjectRepoForTeam` from
  `completeProjectCreateSynchronously` (deferred metadata record, injected used-name set)
  and re-point both callers. Kept separate from P3 so a regression in project creation is
  easy to bisect.
- **P5 — Tests. Done.** Added project transfer flow/modal/render coverage. `npm test`,
  the production build, Rust unit tests, `cargo check`, formatting, and lint complete
  successfully. `npm run audit:unused` still reports the pre-existing unreferenced
  `scripts/bench-ai-translate.mjs`; it reports no transfer-feature files.
- **P6 — Manual verification. Pending.** See section 7.

## 7. Test plan

**Rust unit tests** (in `project_transfer.rs`, following `team_copy.rs`'s style):
copies every active chapter; skips soft-deleted chapters; resets every workflow status to
none; applies the target default glossary and drops the source link; mints fresh chapter
and row ids; rewrites uploaded image paths and copies the bytes; allocates unique slugs
for chapters with identical titles; refuses a non-v2 source layout; cleans up every
written chapter when a later chapter write or the commit fails; reports push failure as
an error rather than success.

**JS unit tests**: eligible-team filtering (permission-gated, current team **included**);
default project name; metadata/broker glossary reconciliation; glossary preselection
(largest by term count; alphabetical when no counts are cached; disabled with no
glossaries; explicit "No glossary" honored); validation errors (no team, blank name,
unusable slug); invoke payload shape; progress event handling for stage/success/error; a
stale `jobId` is ignored for modal updates; a resource load that returns after the user
picked a different team is discarded; switching teams/resetting the modal mid-transfer
still settles the registry and publishes metadata or rolls back; a write queued on the
source project after transfer submission waits until the Rust job finishes; push failure
does not write metadata; a same-team transfer triggers the project-list refresh while a
cross-team one does not; background project sync does not disable the Transfer button.

**Manual (`npm run tauri:dev`)**:
1. Transfer into a team whose repos have **never been cloned** on this machine (the
   metadata-repo clone path in step 3.3.5).
2. A project with uploaded images and several chapters; verify images render in the copy.
3. Rename on transfer (e.g. a Vietnamese title) — repo slug, card title, and the target
   team's project list all agree.
4. Verify every transferred chapter shows a **none** badge and the glossary chosen in the
   modal (open a file and check the glossary highlighting resolves).
5. Duplicate a project into the **current** team (D3): the copy appears on the page
   without a manual refresh, both projects open independently, and editing one leaves the
   other untouched.
6. Verify the source project is byte-identical afterwards (`git log` shows no new commit).
7. Switch teams while a transfer is running; confirm it completes, publishes metadata,
   releases both queue slots, and does not alter the newly visible team's page state.
8. Queue an editor save as transfer starts; confirm the copy is internally consistent
   and the save runs after the source read completes.
9. Force a failure between repo creation and the content commit; confirm the remote repo
   is rolled back and nothing appears in the target team.
10. Force a push failure after the content commit; confirm metadata is not written and
    the fresh local/remote repo is rolled back.
11. Start a background project sync; confirm Transfer remains enabled and queues safely.
12. Offline: the button is disabled.
13. Windows pass — image paths (backslash normalization already handled in
   `copy_row_images`) and the four-button card row layout.
