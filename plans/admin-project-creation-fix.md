# Admin project creation: permission fix and surrounding review

Date: 2026-09-21
Status: immediate permission fix implemented, pushed, and deployed; production
health verified. Live non-owner Admin desktop smoke test remains pending.
Creation-recovery and error-message cleanup remain separate follow-ups.

## Implementation record

- Broker commit: `25dbb8d86041789dcc43a9221ac0c7ce9fdbcc8a`
  (`Allow non-owner admins to create projects`), pushed to `main`.
- Project creation now checks project-admin access, obtains its token, and calls
  the internal schema helper. Explicit schema setup and permanent-delete guards
  are unchanged.
- Added `src/resource-creation-permissions.test.js` with 22 regression cases
  spanning projects, glossaries, QA lists, denied roles, inactive membership,
  upstream schema permission failure, and Owner-only setup/deletion boundaries.
- Before the fix, two new project cases failed at the Owner check. After the
  fix, all 87 broker tests and 15 desktop compatibility tests passed.
- Bumped broker package/lockfile version to `0.2.2` to identify the deployment
  through `/health`. No desktop implementation files changed.
- DigitalOcean deployment `8a49b314-8ef2-49e1-845d-4904de0c5ef9` for that commit
  reached `ACTIVE` (6/6). The production `/health` endpoint returned
  `{"ok":true,"app":"gnosis-tms-github-app-broker","version":"0.2.2"}`.
- A live desktop smoke test as a non-owner Admin has not been performed; tests
  use synthetic sessions and mocked GitHub responses. Cristalngo's retry remains
  the user-account confirmation after deployment.

## Objective

Allow an active Gnosis Admin to create a project, as the existing permission
matrix specifies. Preserve Owner-only team setup, member management, and
permanent deletion of remote repositories. No desktop release should be needed
for the immediate authorization fix.

The reported case is cristalngo in Gnosis VN. The code defect was reproduced
with mocked GitHub responses, not the user's live account or production logs.

## Confirmed cause

The creation path is:

1. `src-ui/app/project-flow.js`: `submitProjectCreation` checks
   `canCreateRepoResources`, which derives Admin/Owner access from `permissions.js`.
2. `createProjectRepoForTeam` invokes `create_gnosis_project_repo`.
3. `src-tauri/src/github/repos.rs` posts to the broker's existing
   `POST /api/github-app/gnosis-projects` endpoint.
4. Broker `src/project-repos.js`: `createGnosisProjectRepo` accepts project admins,
   then calls `ensureGnosisRepoPropertiesSchema`.
5. That wrapper requires `requireOwner: true`, so a correctly recognized Gnosis
   Admin is rejected before the repository POST occurs.

The wrapper also serves the explicit organization setup endpoint and must keep
its Owner-only authorization. Changing its guard globally would expand team
setup permissions unnecessarily.

Glossary and QA creation already follow the correct composition: project-admin
authorization, installation token, then the internal
`ensureRepositoryPropertiesSchema(orgLogin, installationToken)` helper.

## Immediate implementation plan

### 1. Add regression coverage at the broker boundary

Add `src/project-creation.test.js` in the broker repository. Follow the existing
authorization test pattern: synthetic configuration/key, mocked `fetch`, real
authorization and creation functions, and cache resets between cases. No live
GitHub resources or credentials are required.

Test the actual `createGnosisProjectRepo` call, not just role predicates:

- Active Gnosis Admin succeeds. Model this as a GitHub organization `member`
  included in the configured `admins` team; GitHub membership role `admin`
  instead represents a Gnosis Owner and would miss the regression.
- Owner succeeds.
- Translator and Viewer are rejected before schema mutation or repository
  creation; inactive membership is rejected too.
- Successful creation preserves the response fields consumed by the desktop,
  supplied project ID/title, repository type property, `project.json`, and
  `.gitattributes` initialization.
- The explicitly exposed schema setup helper still rejects Admin and accepts
  Owner.
- The existing permanent repository deletion helper still rejects Admin.
- A GitHub schema permission failure is surfaced without creating a repository;
  do not mask upstream installation permission failures as successful creation.

Use a table-driven creation permission test for glossary and QA functions as
well, or a separate `src/resource-creation-permissions.test.js`, to verify the
three resource types remain consistent. Both glossary and QA must be included.

### 2. Correct helper composition, with minimal cleanup

In broker `src/project-repos.js`, change only the creation sequence:

```js
await ensureInstallationAccess({ installationId, brokerSession, requireProjectAdmin: true });
const installationToken = await createInstallationAccessToken(installationId);
await ensureRepositoryPropertiesSchema(orgLogin, installationToken);
```

This replaces the call to the Owner-only `ensureGnosisRepoPropertiesSchema`
wrapper and moves the explicit token request after authorization. Authorization
itself may request an installation token to resolve membership; this is not a
promise that denied callers cause no token requests.

Keep the existing repo POST, initialization, and response shape. Add a short
comment explaining why resource creation calls the internal helper while the
explicit schema setup endpoint retains the Owner check. Do not add a new role
flag or change desktop permissions.

### 3. Verify and release the broker fix

- Run the new focused tests, then the broker's complete `npm test` suite.
- Re-run desktop permission/create-flow tests as a compatibility check. No Rust
  build is needed for a broker-only change with unchanged IPC/API shapes.
- Review the diff for accidental relaxation of setup, member, or permanent-delete
  checks. Keep this as one focused fix commit with its regression tests.
- Push/merge the broker change and verify the DigitalOcean deployment picked up
  that commit; a local commit is not a deployment.
- In a designated test organization, smoke-test creation with a non-owner Admin
  and an Owner using an existing desktop release. Verify discovery and opening
  the project. Confirm a Translator cannot create a project.
- Ask cristalngo to retry after the deployment is verified. Do not create test
  projects in Gnosis VN as part of this planning task.

Acceptance: a non-owner Admin completes creation, the project is visible and
usable, lower roles stay blocked, and Owner-only operations remain Owner-only.

## Surrounding code review

Targeted cleanup is warranted, especially around failure recovery. A broad
rewrite of the project flow or shared resource framework is not needed to fix
the authorization defect.

### P2: desktop rollback uses an Owner-only destructive endpoint

Evidence:

- `src-ui/app/project-flow.js`, `rollbackCreatedProjectRepo`, invokes
  `rollback_created_gnosis_project_repo` after a later creation step fails.
- `src-tauri/src/github/repos.rs` maps that command to
  `DELETE /api/github-app/gnosis-projects`.
- Broker `src/project-repos.js`, `permanentlyDeleteGnosisProjectRepo`, requires
  Owner access.

Once the creation guard is fixed, a non-owner Admin can create the remote repo
but cannot clean it up automatically if local initialization or metadata
publication subsequently fails. The desktop reports a second rollback failure.
The same rollback-to-permanent-delete pattern exists for glossary and QA repos.

Recommendation: address this in a separate creation-recovery change. Prefer
persisting the created repo identity and a recoverable pending-creation record,
then resuming local initialization/metadata publication using the same project
ID. Avoid granting admins general permanent-delete access to make rollback work.
If a dedicated remote rollback endpoint is chosen instead, it needs verifiable
creation scope and protection against deleting an established repository; a
repo name supplied by the client is insufficient. Any proof must survive broker
restarts because the broker is stateless. Apply glossary/QA changes together.

### P2: failures inside the broker can orphan a new repository

Evidence: broker `createGnosisProjectRepo` creates the repo, then assigns custom
properties and writes two initialization files without a compensating catch.
The desktop only receives the repo identity after all these steps succeed, so
its rollback cannot run when this broker call rejects partway through.

Failure injection confirmed no DELETE after errors in each of:

- Repository property assignment.
- Writing `project.json`.
- Writing `.gitattributes`.

Recommendation: a focused broker follow-up should compensate failures while it
still holds the identity of the repo created by that request, using the existing
internal delete helper rather than the public Owner-only endpoint. Preserve the
original error and include an explicit recovery message if cleanup also fails.
Never delete a pre-existing repo when its POST failed with a name collision.
Ambiguous network results require reconciliation, not blind retry/deletion.

QA creation already compensates property-assignment failure; glossary creation
does not. Bring glossary and QA behavior into parity when standardizing this
pattern. Test failure at each post-create step and failure of cleanup itself.

### P2: metadata publication failure is not an atomic rollback

Evidence: `createProjectRepoForTeam` calls `upsertProjectMetadataRecord` with
`requirePushSuccess: true`. In `src-ui/app/team-metadata-flow.js`, the local
metadata commit happens before the push. A push failure throws, and project
rollback purges the local project and attempts remote deletion, but does not
revert/tombstone the already committed team metadata record.

This can leave a live local metadata record referring to a repo that an Owner's
rollback deleted; a later metadata sync may publish that stale record. For an
Admin, the remote rollback also has the authorization problem above. This is a
code-path finding; no real metadata was created or deleted during review.

Recommendation: include this in the durable creation-recovery work. Record
pending creation before remote work and finalize only after required steps are
confirmed. Preserve recoverable state on uncertain push outcomes rather than
deleting the repo unconditionally. Test failed pushes, lost responses, retry,
and restart with the same project identity. This also advances the documented
metadata-first architectural goal without making it a prerequisite for the
small permission patch.

### P2: Owner denial is described as an Admin requirement

Evidence: broker `src/installation-access.js` uses the same message,
`You need admin access ...`, for `requireOwner` and legacy `requireAdmin` checks.
This is exactly the message returned by the reproduced creation failure.

Recommendation: in a small separate cleanup commit, make Owner requirements
explicit in the error text and update affected authorization tests. Audit the
legacy flag's callers before renaming/removing it. Preserve the endpoint error
shape; do not combine a broker-wide authorization API refactor with this fix.

### Test coverage and lower-priority cleanup

- No checked-in broker test currently calls `createGnosisProjectRepo` or
  `ensureGnosisRepoPropertiesSchema`. Existing role tests can pass while the
  composed feature rejects admins. The immediate plan closes that gap.
- The duplicate authorization/helper layer and extra explicit token lookup in
  project creation are removed by the immediate fix. Token caching means the
  extra lookup is not necessarily an extra GitHub request.
- Desktop `rollbackCreatedProjectRepo` silently discards local purge failures.
  Include those failures in recovery reporting when revising that workflow.
- Keep query publication in `project-query.js` and preserve the current
  separation between completed creation and background refresh. No new visible
  collection state path is needed.
- Avoid generic module extraction or unifying all resource creation code until
  the failure/recovery contract is defined and covered by tests.

## Review validation and limits

Completed during this planning task:

- A temporary script outside either repository exercised the real broker
  functions with mocked GitHub calls. Confirmed Admin rejection, Owner success,
  Admin rejection by the endpoint used for rollback, and all three missing
  broker compensation cases listed above.
- Broker targeted tests: 22 passed across
  `authorization-owner-promotion.test.js` and
  `authorization-member-role.test.js`.
- Desktop targeted tests: 15 passed across `permissions.test.js`,
  `resource-capabilities.test.js`, `resource-create-flow.test.js`, and
  `project-flow.test.js`.
- These are review/baseline checks, not proof of a fix. The full suites and live
  Admin smoke test remain future implementation/release steps.

There are pre-existing worktree edits in the desktop repository, including
project-flow, query, and readiness modules. The review reflects the current
working tree. This task adds only this plan and does not overwrite those edits.
The broker worktree was clean during inspection.
