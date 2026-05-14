# QA Lists Feature Plan

## Goal

Add a new authenticated QA Lists feature that behaves like Glossaries for listing, creation, import/export, editing, deletion, local cache, local repo sync, remote sync, and background refresh, while using QA-specific language and data semantics.

The first implementation milestone does not apply QA lists inside the translation editor. It only builds the management surface and data plumbing needed to create, edit, sync, cache, import, and export QA lists.

## Existing Starting Point

The app already has a top-level `qa` screen stub and navigation tests:

- `src-ui/screens/qa.js`
- `src-ui/app/qa-navigation.test.js`
- QA nav is already wired beside Glossaries in authenticated navigation.

Glossaries provide the closest implementation model:

- Top-level page: `src-ui/screens/glossaries.js`
- Top-level loading/cache/query: `src-ui/app/glossary-discovery-flow.js`, `src-ui/app/glossary-query.js`, `src-ui/app/glossary-cache.js`
- Top-level lifecycle: `src-ui/app/glossary-lifecycle-flow.js`
- Creation/import/export: `src-ui/app/glossary-import-flow.js`, `src-ui/app/glossary-export-flow.js`
- Editor page: `src-ui/screens/glossary-editor.js`
- Term modal/draft/write flow: `src-ui/screens/glossary-term-editor-modal.js`, `src-ui/app/glossary-term-draft.js`, `src-ui/app/glossary-term-sync.js`
- Local storage and TMX: `src-tauri/src/glossary_storage/*`
- Local repo sync: `src-tauri/src/glossary_repo_sync.rs`
- Team metadata: `src-tauri/src/team_metadata_local.rs`, `src-tauri/src/team_metadata_local/*`
- Broker-backed repo listing/creation/deletion: `src-tauri/src/github/repos.rs`, `src-tauri/src/github/types.rs`

## Product Behavior

### Naming Rules

Use these names consistently:

- Top-level navigation link: `QA`.
- Top-level page title: `QA Lists`.
- Glossary-like collection: `QA list`.
- Single item inside a QA list: `QA term`.
- Editor page title: the QA list title.
- Modal title: `New QA term` or `Edit QA term`.

Implementation detail:

- Keep the existing `qa` route/screen key. Do not rename navigation target IDs unless there is a technical reason.
- Update `src-ui/main.js` title metadata so the browser/window title for the `qa` route is `QA Lists - Gnosis TMS`.
- If an editor route is added, use a separate screen key such as `qaListEditor` so action handlers can distinguish the top-level list page from the term editor.

### QA Lists Page

The QA Lists page should initially mirror the Glossaries page, with collection-level UI text changed from Glossary/Glossaries to QA list/QA Lists. Item-level UI text should use QA term.

It should support:

- list QA lists for the selected team
- load immediately from the selected team's cache when available
- refresh in the background
- create a new QA list
- import from TMX
- download/export to TMX
- rename
- soft delete
- restore
- permanent delete
- sync local data with remote
- show missing/local repo repair states consistently with Glossaries

The card language display differs from Glossaries:

- Glossaries show `Source language -> Target language`
- QA Lists show only `Language`

### Default QA Lists

Glossaries have one default glossary per team. QA Lists should use the same `Default` / `Make default` behavior, but scoped per language. That means a team can have more than one default QA list, as long as each default belongs to a different language.

Behavior:

- If a team has only one QA list for a language, that list becomes the default for that language, matching the glossary `makeGlossaryDefaultIfFirst` behavior.
- If a team has multiple QA lists for the same language, exactly one can be default for that language.
- A QA list that is default for its language displays a non-clickable `Default` label.
- A non-default QA list displays a clickable `Make default` action.
- Clicking `Make default` makes that list the default for its language and only un-defaults other QA lists in the same language.
- Multiple QA lists can be default at once when they belong to different languages.

Implementation detail:

- Store default QA list selection by selected team and language code.
- Use a durable per-team cache/local setting modeled on `glossary-default-cache.js`, but keyed by `{team cache key, language code}` instead of one default ID.
- Add `src-ui/app/qa-list-default-cache.js`, modeled on `glossary-default-cache.js`.
- Suggested storage key: `gnosis-tms-default-qa-lists`.
- Suggested stored shape:

```json
{
  "<team-cache-key>": {
    "languages": {
      "vi": { "qaListId": "uuid", "updatedAt": "iso-date" },
      "ja": { "qaListId": "uuid", "updatedAt": "iso-date" }
    }
  }
}
```

- Add `src-ui/app/qa-list-default-flow.js` with helpers:
  - `defaultQaListIdForLanguage(team, languageCode, qaLists)`
  - `defaultQaListIdsForTeam(team, qaLists)`
  - `defaultQaListCandidateAfterDeletion(languageCode, qaListId)`
  - `makeQaListDefault(render, qaListId)`
  - `makeQaListDefaultIfFirst(team, qaListId)`
  - `updateDefaultQaListAfterDeletion(team, deletedQaList)`
- Normalize language codes to lower case before using them as map keys.
- `makeQaListDefaultIfFirst()` should persist the first QA list for a language as default, matching Glossaries.
- Recompute effective default state defensively:
  - If the stored default ID points to a deleted/missing list, treat that language as having no default until a replacement is chosen.
  - When deleting the default QA list for a language, choose a replacement candidate from non-deleted QA lists in the same language only.
  - Use the same candidate sort as Glossaries where possible: highest term count, then title, then ID.

### QA List Editor

The QA list editor should reuse the Glossary editor layout and behaviors where possible, but the table columns are:

- `Text`
- `Notes`

Instead of Glossary editor columns:

- `Source`
- `Target`

The editor supports:

- open QA list
- search QA terms
- add QA term
- edit QA term
- delete QA term
- background sync session while editing
- remote conflict handling equivalent to glossary term editing

### QA Term Modal

QA terms have only one text value and one note value.

The term modal should not show:

- source language lane
- multiple variants
- global notes
- footnote
- add variant buttons
- remove variant buttons
- drag handle
- empty target variant button

The modal should show:

- one `Text` textarea
- one `Notes` textarea
- ruby inline button for the text field
- submit/cancel/error behavior equivalent to glossary term modal

Implementation detail:

- Reuse the glossary ruby helpers for rendering and inline markup.
- Keep the text and notes as separate fields in the UI.
- Store notes in the same conceptual slot as glossary `targetVariantNotes[0]`, or in a QA-specific `note` field if the backend gets a dedicated QA schema. Prefer a QA-specific frontend model with adapters to the stored repo format.
- Use QA-specific action names so glossary term handlers cannot accidentally process QA term events:
  - `open-new-qa-term`
  - `edit-qa-term:<termId>`
  - `delete-qa-term:<termId>`
  - `submit-qa-term-editor`
  - `cancel-qa-term-editor`
  - `toggle-qa-term-inline-style:ruby`
- The modal should reuse the visual lane styling where it helps, but it should not reuse data attributes that imply glossary variant semantics such as `data-glossary-term-variant-input`.
- Add QA-specific data attributes for tests and event handlers:
  - `data-qa-term-text-input`
  - `data-qa-term-note-input`
  - `data-qa-term-inline-style-button`

## Data Model

QA Lists should be a parallel resource type, not a fake Glossary with a made-up source language.

Recommended local repo structure:

```text
qa-list-repo/
  .gitattributes
  qa-list.json
  terms/
    <term-id>.json
```

`qa-list.json`:

```json
{
  "qaListId": "uuid",
  "title": "Vietnamese QA List",
  "lifecycle": { "state": "active" },
  "language": { "code": "vi", "name": "Vietnamese" }
}
```

Term file:

```json
{
  "termId": "uuid",
  "text": "...",
  "note": "...",
  "lifecycle": { "state": "active" }
}
```

Compatibility note:

- The user asked for the same format and structure as Glossaries. The repo structure should stay parallel: a root metadata file plus `terms/*.json`.
- The field names should be QA-specific where Glossary semantics are not true. This avoids storing empty source terms or fake source languages.
- If we choose to reuse backend term parsing utilities, add adapters that map QA files to the editor model instead of exposing glossary-shaped objects directly to the UI.

Implementation details:

- Treat `terms/` as the canonical item directory so import/export and file counting stay parallel to Glossaries.
- Keep soft-deleted QA terms out of the editor list by filtering `lifecycle.state === "active"` when loading editor data.
- Count QA terms on summary/list pages by counting JSON files in `terms/`, matching the faster glossary count strategy. This may include soft-deleted term files; that is acceptable for a fast summary count unless the UI later requires an exact active-only count.
- Use deterministic sorting for QA terms in the editor:
  - primary: visible text, case-insensitive
  - secondary: term ID
- Normalize empty notes to `""`, not `null`, so modal fields and TMX export do not need null checks.
- Preserve ruby markup in `text` exactly as entered, following the glossary ruby storage behavior.

## TMX Import/Export

QA Lists import/export to TMX like Glossaries, with QA-specific mapping.

Recommended mapping:

- TMX language: QA target language only.
- QA term `text`: the segment text in the QA language.
- QA term `note`: TMX note field.
- Title: existing glossary TMX title convention can be mirrored with a QA-specific prop such as `x-gnosis-qa-lists-title`.

Implementation details:

- Add QA-specific parser/serializer wrappers in Rust.
- Reuse XML escaping, language lookup, and note parsing helpers from `glossary_storage/tmx.rs` where practical.
- Do not force a source language into the QA UI or QA root metadata.
- If the existing glossary TMX parser requires source and target, factor shared lower-level TMX parsing helpers first, then build:
  - glossary parser: requires source and target
  - QA parser: requires exactly one language stream, or accepts source/target TMX and asks/chooses the target language during import if needed
- For export, write one `tu` per QA term and one `tuv` for the QA list language.
- For import, preserve term notes from TMX `note` elements.
- If a TMX unit has more than one note, join notes with a blank line unless the existing glossary parser already has a stronger convention.
- If a TMX file contains duplicate text values, import them as separate QA terms for now. Add duplicate detection later only if QA usage requires it.

Open question for implementation:

- TMX normally has translation units with multiple language variants. For QA import, we need a deterministic choice for which language becomes the QA language if the file contains more than one language. The simplest first version can use the target language currently selected in the import preview, or use the first non-source language if the TMX has the same glossary-style source/target shape.

Recommended first-version choice:

- `inspect_tmx_qa_list_import` should return all detected languages and a proposed language.
- If exactly one language is present, use it.
- If multiple languages are present and one looks like the glossary target language from the existing parser, propose that language.
- If multiple languages are present and no target can be inferred, fail inspection with a clear message instead of guessing silently. Add a language picker later if this becomes common.

## Frontend Implementation Plan

### 1. Shared Resource Abstractions

Create small shared helpers where Glossary and QA are structurally identical, but avoid a large refactor before the feature works.

Good candidates:

- resource list page owner/cache helpers already in `resource-page-controller.js`
- cache-map helpers from `glossary-cache.js`
- query snapshot shape from `glossary-query.js`
- card/list rendering primitives from `glossaries.js`
- lifecycle/write coordinator patterns

Avoid trying to generalize every glossary module upfront. A light QA-specific copy with shared utilities is safer than a broad abstraction that changes Glossary behavior.

Implementation detail:

- Prefer copying the glossary flow modules into QA-specific modules first, then extracting shared helpers only when the duplicate code is stable.
- Keep any extracted shared code vocabulary-neutral, for example `resource`, `item`, `term`, or `list`, rather than mixing glossary and QA names.
- Do not change existing Glossary behavior as part of the first QA implementation unless a helper extraction requires a narrow, tested refactor.

### 2. State

Add QA-specific state in `src-ui/app/state.js`:

- `qaLists: []`
- `selectedQaListId: null`
- `qaListsDiscovery`
- `qaListsPage: createResourcePageState()`
- `qaListEditor`
- `qaListImport`
- `qaListCreation`
- `qaListRename`
- `qaListPermanentDeletion`
- `qaTermEditor`
- `qaListsRepoSyncByRepoName: {}`
- `qaListsSyncVersion`
- `showDeletedQaLists`

Add creation functions mirroring glossary state factories, but with QA field names.

State detail:

- `qaLists` should contain both active and deleted QA list summaries, matching `state.glossaries`.
- `showDeletedQaLists` controls the deleted QA list section.
- `qaListsPage.visibleTeamId` and `qaListsPage.visibleCacheKey` must be stamped whenever visible QA list data is applied.
- `qaListEditor` should include:
  - `status`
  - `error`
  - `qaListId`
  - `repoName`
  - `repoId`
  - `fullName`
  - `defaultBranchName`
  - `defaultBranchHeadOid`
  - `title`
  - `language`
  - `lifecycleState`
  - `termCount`
  - `searchQuery`
  - `terms`
  - `navigationSource`
- `qaTermEditor` should include:
  - `isOpen`
  - `status`
  - `error`
  - `notice`
  - `qaListId`
  - `termId`
  - `text`
  - `note`
  - `attemptedDraft`

### 3. QA Top-Level Page

Replace `src-ui/screens/qa.js` stub with a real QA Lists page.

Reuse Glossaries screen structure:

- same page shell
- same refresh action pattern
- same empty/loading/error state pattern
- same deleted section pattern
- same repo repair inline warning pattern

Change labels:

- page title: `QA Lists`
- empty title: `No QA lists are available yet.`
- import action: `Import`
- creation action: `+ New QA List`
- card language meta: language only
- use `Default`/`Make default`, scoped per language

Implementation detail:

- Reuse `pageShell`, `buildPageRefreshAction`, `renderStateCard`, `sectionSeparator`, and list-row card classes from the Glossaries page.
- Use action IDs:
  - `import-qa-list`
  - `open-new-qa-list`
  - `open-qa-list:<qaListId>`
  - `download-qa-list:<qaListId>`
  - `make-default-qa-list:<qaListId>`
  - `rename-qa-list:<qaListId>`
  - `delete-qa-list:<qaListId>`
  - `restore-qa-list:<qaListId>`
  - `delete-deleted-qa-list:<qaListId>`
  - `toggle-deleted-qa-lists`
- Use `renderQaListCard()` rather than modifying `renderGlossaryCard()` in place.
- Add focused screen tests that assert `QA Lists` is the page heading and `Language` is rendered without a source-target arrow.

### 4. QA Top-Level Flow

Create QA equivalents:

- `src-ui/app/qa-lists-cache.js`
- `src-ui/app/qa-lists-query.js`
- `src-ui/app/qa-lists-discovery-flow.js`
- `src-ui/app/qa-lists-top-level-state.js`
- `src-ui/app/qa-lists-lifecycle-flow.js`
- `src-ui/app/qa-lists-import-flow.js`
- `src-ui/app/qa-lists-export-flow.js`
- `src-ui/app/qa-lists-repo-flow.js`
- `src-ui/app/qa-list-default-flow.js`
- `src-ui/app/qa-lists-write-coordinator.js`

Start from the glossary implementations and adjust naming and QA-specific language behavior.

Cache behavior should match the fixed Projects/Glossaries behavior:

- cache is keyed by selected team cache key
- never show data for another selected team
- when same-team data is visible, preserve rows and refresh in background
- when no visible same-team data exists, seed from local cache before remote refresh

Implementation detail:

- `loadStoredQaListsForTeam(team)` should return `{ exists, cacheKey, updatedAt, qaLists }`, mirroring the new glossary/project cache metadata.
- `seedQaListsQueryFromCache()` must reject cached entries whose `cacheKey` does not match `teamCacheKey(selectedTeam)`.
- `primeQaListsLoadingState()` should set discovery status to `ready` when same-team visible QA list data is preserved, so the page does not flash a full loading state during background refresh.
- Persist QA list cache after successful remote/local refresh, not before, so stale failed refreshes do not overwrite known-good cache.

### 5. QA Editor

Create:

- `src-ui/screens/qa-list-editor.js`
- `src-ui/screens/qa-term-editor-modal.js`
- `src-ui/app/qa-list-editor-flow.js`
- `src-ui/app/qa-term-draft.js`
- `src-ui/app/qa-term-sync.js`
- `src-ui/app/qa-term-write-coordinator.js`

Reuse glossary editor patterns:

- page refresh action
- search field
- table card
- term delete
- background sync session
- remote conflict handling

Change UI:

- page title: QA list title
- table columns: `Text`, `Notes`
- new button: `+ New QA term`
- modal title: `New QA term` / `Edit QA term`
- submit: `Add QA term` / `Save QA term`

Implementation detail:

- Search should match:
  - QA term text, using `extractGlossaryRubyVisibleText()` so ruby annotations do not break search
  - QA term note
- Table rows should use one click target for editing the term and an explicit `Delete` action, matching the Glossary editor interaction pattern.
- Keep `QA` in editor return navigation beside Glossary navigation, but route editor opens through `openQaListEditor(render, qaListId, { navigationSource })`.
- If opened from the top-level QA Lists page, back navigation returns to `qa`.
- If opened from the translation editor later, preserve a `navigationSource: "editor"` field as the Glossary editor does.

### 6. Navigation and Actions

Wire QA actions into the existing app event/action system:

- top-level QA page navigation already exists, but load flow must be triggered on arrival
- add QA editor screen registration in `src-ui/main.js`
- add action handlers for:
  - open QA page
  - refresh QA page
  - import QA lists
  - create QA lists
  - open QA list editor
  - download QA list as TMX
  - make QA list default
  - rename/delete/restore/permanent delete
  - add/edit/delete QA term
  - QA term modal field updates and ruby toggle

Keep QA actions separate from glossary action IDs to avoid accidental glossary writes.

Implementation detail:

- Add `src-ui/app/actions/qa-actions.js`, modeled on `glossary-actions.js`.
- Register it in the main action dispatcher next to `createGlossaryActions(render)`.
- Keep prefix parsing explicit. Do not parse generic `term:` actions shared with Glossaries.
- Add action-source tests similar to `qa-navigation.test.js` that verify QA actions use `qa-list`/`qa-term` IDs, not `glossary` IDs.

## Backend Implementation Plan

### 1. Local Storage Module

Add a new Rust module:

- `src-tauri/src/qa_lists_storage/mod.rs`
- `src-tauri/src/qa_lists_storage/io.rs` if useful
- `src-tauri/src/qa_lists_storage/tmx.rs`

Start from `glossary_storage`, then remove source-language and multi-variant assumptions.

Commands to expose:

- `list_local_gtms_qa_lists`
- `load_gtms_qa_list_editor_data`
- `load_gtms_qa_term`
- `initialize_gtms_qa_list_repo`
- `import_tmx_to_gtms_qa_list_repo`
- `inspect_tmx_qa_list_import`
- `export_gtms_qa_list_to_tmx`
- `prepare_local_gtms_qa_list_repo`
- `rename_gtms_qa_list`
- `soft_delete_gtms_qa_list`
- `restore_gtms_qa_list`
- `purge_local_gtms_qa_list_repo`
- `upsert_gtms_qa_term`
- `rollback_gtms_qa_term_upsert`
- `delete_gtms_qa_term`

Implementation detail:

- Keep command input/response structs QA-specific:
  - `ListLocalQaListsInput`
  - `LoadQaListEditorDataInput`
  - `LoadQaTermInput`
  - `InitializeQaListRepoInput`
  - `UpsertQaTermInput`
- Return editor payloads in frontend-friendly camelCase:
  - list summary: `id`, `qaListId`, `repoName`, `title`, `language`, `lifecycleState`, `termCount`
  - term: `termId`, `text`, `note`, `lifecycleState`
- Use `git_commit_as_signed_in_user()` with operation labels parallel to Glossaries:
  - `Initialize QA list`
  - `Update QA term <id>`
  - `Delete QA term <id>`
- Add rollback support for term upserts before wiring optimistic UI saves.

### 2. Storage Paths

Add QA repo root path in `src-tauri/src/storage_paths.rs`.

Recommended folder:

```text
<installation data root>/qa-lists/
```

Implementation detail:

- Add `local_qa_list_repo_root(app, installation_id)` in `storage_paths.rs`.
- Local repo lookup should support both `qaListId` and `repoName`, matching glossary repo lookup behavior.
- Local repo sync state `kind` should be `qaList`.

### 3. Repo Sync

Add `src-tauri/src/qa_lists_repo_sync.rs`, modeled on glossary repo sync.

Requirements:

- clone/pull QA Lists repos
- push local commits
- inspect repo binding issues
- detect tombstones/deleted records
- repair missing local repo binding
- preserve app-version commit trailer behavior

### 4. Team Metadata

Add QA Lists metadata records in the team metadata repo.

Recommended metadata kind:

- `qaList`

Record fields:

- id
- kind
- title
- repoName
- previousRepoNames
- githubRepoId
- githubNodeId
- fullName
- defaultBranch
- lifecycleState
- remoteState
- recordState
- deletedAt
- language
- termCount

Local metadata functions should mirror glossary functions:

- list local QA Lists metadata
- upsert QA Lists metadata record
- delete QA Lists metadata record
- repair QA Lists repo binding
- count local QA term files efficiently by counting JSON files in `terms/`

Implementation detail:

- Add a resource directory in the team metadata repo parallel to Glossaries, for example `resources/qa-lists/<qaListId>.json`.
- Reuse team metadata mutation helpers where possible, but keep QA inputs separate from `GithubGlossaryMetadataRecord` so source/target language fields are not required.
- Metadata record should include one `language` object instead of `sourceLanguage` and `targetLanguage`.
- The local metadata list function should attach `termCount` from the local QA list repo when available.

### 5. GitHub/Broker Integration

The Tauri app needs broker-backed endpoints parallel to glossary endpoints:

- list QA Lists repos for installation
- create QA Lists repo
- permanently delete QA Lists repo

Likely broker routes:

- `GET /api/github-app/installations/:installationId/gnosis-qa-lists`
- `POST /api/github-app/gnosis-qa-lists`
- `DELETE /api/github-app/gnosis-qa-lists`

App-side Tauri commands:

- `list_gnosis_qa_lists_for_installation`
- `create_gnosis_qa_list_repo`
- `permanently_delete_gnosis_qa_list_repo`

Implementation detail:

- Add Rust GitHub types parallel to `GithubGlossaryRepo`, but named for QA lists.
- If the broker filters repositories by custom properties, add a QA list repository kind/property in the broker and schema setup.
- If the broker currently assumes only project/glossary resource kinds, update its allow-list and route handlers before enabling remote QA list creation.

Important:

- Updating broker code is required for full remote create/list/delete support.
- After broker changes, push the broker repo to its remote, per existing workflow.
- If broker work is blocked or deferred, implement local-only QA Lists first behind clear error messages for remote-only operations.

## Import/Create Details

### Create QA Lists

Creation modal fields:

- QA Lists name
- Language

No source language selector.

Repo naming:

- mirror glossary repo naming convention with QA-specific prefix/suffix.
- use backend-generated ID and repo name consistently with team metadata.

After creation:

- initialize local repo
- upsert metadata
- sync repo
- add to QA Lists list
- if it is the only list for its language, make it default automatically

### Import QA Lists

Import modal should mirror glossary import:

- select TMX
- inspect preview
- confirm import
- create/initialize QA list repo
- import QA terms
- sync repo
- upsert metadata
- make it default if it is the only list for the language

Implementation detail:

- Import preview should show:
  - QA list title
  - language
  - QA term count
- Import confirmation should create a QA list repo first, then import terms into that repo, then sync and upsert team metadata.
- If import succeeds locally but remote sync fails, keep the local QA list visible with the same repair/retry pattern used for Glossaries.

## Testing Plan

### Frontend Unit Tests

Add tests for:

- QA nav stays in expected position
- QA page renders loading/empty/error/list/deleted states
- QA card shows language only
- Default/Make default behavior by language
- Default assignment when only one list exists for a language
- Cache seed rejects mismatched team cache keys
- Cache seed preserves same-team visible QA Lists during background refresh
- QA editor table uses `Text` and `Notes`
- QA term modal omits glossary-only controls
- QA term modal has separate text and notes fields
- Ruby button remains available for QA text
- Delete/rename/restore/permanent delete actions call QA flows, not glossary flows
- QA route/page title renders `QA Lists`, while the nav link can remain `QA`
- Same-team cache return does not show a full-page loading state
- Wrong-team cache data is never rendered while refresh is pending
- Making one QA list default only affects lists with the same language

### Rust Tests

Add tests for:

- initialize QA Lists repo writes expected files
- list local QA Lists reads summaries
- QA term upsert writes one term file
- QA term delete soft-deletes or removes consistently with glossary behavior
- QA term count counts files without reading all term contents where possible
- TMX import maps text and notes correctly
- TMX export preserves text and notes
- lifecycle changes update root metadata
- local repo lookup by ID and repo name both resolve the same QA list
- team metadata records serialize and deserialize the single `language` field

### Integration/Build Checks

Run before merging:

```sh
npm run build
node --test --loader ./src-ui/test/raw-loader.mjs <focused QA and glossary regression tests>
cargo test
cargo check
```

Use focused JS tests during development, then broader build/checks before release.

## Suggested Implementation Order

1. Rename the existing QA stub UI to show the `QA Lists` page title and add state factories/action placeholders.
2. Add QA list default-selection cache and tests.
3. Add frontend QA list cache/query/list rendering with local fixture data or no backend writes.
4. Add backend local storage module and Tauri commands for local list/load/create/upsert/delete/import/export.
5. Wire QA page to local storage cache and local repo reads.
6. Add QA list editor and QA term modal with text/notes/ruby behavior.
7. Add default-per-language selection behavior to real QA list cards.
8. Add local repo sync and team metadata support.
9. Add lifecycle operations: rename, soft delete, restore, permanent delete.
10. Add import/export TMX end-to-end.
11. Add broker endpoints and Tauri GitHub command wrappers for remote list/create/delete.
12. Run full verification and polish labels/states.

Recommended commit boundaries:

- Frontend skeleton and terminology.
- Local storage and editor.
- Default-list behavior.
- Sync/team metadata.
- Broker/remote support.
- Import/export completion.

## GitHub Sync Plan

Implementation status:

- App-side QA list repository storage and sync commands have been added.
- QA Lists now use a repo-backed path in the desktop app for create, load, rename, soft delete, restore, permanent delete, term save/delete, TMX import, and TMX export.
- Rust QA list TMX/storage/sync regression tests have been added.
- Broker routes are still required outside this repo for full remote create/list/delete support: `GET /api/github-app/installations/:installationId/gnosis-qa-lists`, `POST /api/github-app/gnosis-qa-lists`, and `DELETE /api/github-app/gnosis-qa-lists`.
- Team metadata remains the next hardening step. The current implementation can list/sync repos from the broker and local repo cache, but it does not yet add QA list records to the team metadata repo.

### Is GitHub Sync Identical To Glossary Sync?

No. It should be operationally identical, but not 100% identical in data model or command names.

The following parts should mirror Glossaries as closely as possible:

- GitHub repository creation under the selected team installation.
- Local repo preparation and clone path management.
- Team metadata record creation, update, deletion, and repair checks.
- Repo-backed list page discovery.
- Cache-first page load followed by background refresh.
- Background sync session while editing a QA list.
- Local commit then remote sync for term writes.
- Stale-term reload before editing when remote changes are detected.
- Delete/restore/rename lifecycle semantics.
- Permanent remote repo deletion for deleted QA lists.
- Repair UI for missing local repo, missing remote repo, stale metadata, and unregistered local repo states.
- Write coordination so concurrent edits to the same QA list repo serialize.

The following parts must differ:

- Root metadata file should be `qa-list.json`, not `glossary.json`.
- Root metadata has one `language`, not `sourceLanguage` and `targetLanguage`.
- Term files store `text` and `notes`, not `sourceTerms`, `targetTerms`, target variant notes, global notes, footnote, or untranslated state.
- Default selection is per language, not one default per team.
- TMX import/export must resolve one QA language instead of a source/target pair.
- UI action names and Tauri command names should use QA terminology so handlers cannot accidentally route QA edits through Glossary flows.

Implementation rule:

- Copy the Glossary workflow and tests where practical, but introduce QA-specific adapters at the storage boundary instead of pretending QA lists are glossaries with a fake source language.

### Backend Resource Shape

Add a Rust QA storage module parallel to `src-tauri/src/glossary_storage`:

```text
src-tauri/src/qa_list_storage/
  mod.rs
  storage_paths.rs
  terms.rs
  tmx.rs
```

Local repo structure:

```text
qa-list-repo/
  .gitattributes
  qa-list.json
  terms/
    <term-id>.json
```

Root file:

```json
{
  "qaListId": "uuid",
  "title": "Vietnamese QA List",
  "lifecycle": { "state": "active" },
  "language": { "code": "vi", "name": "Vietnamese" }
}
```

Term file:

```json
{
  "termId": "uuid",
  "text": "...",
  "note": "...",
  "lifecycle": { "state": "active" }
}
```

Add Tauri commands parallel to glossary commands:

- `list_local_gtms_qa_lists`
- `prepare_local_gtms_qa_list_repo`
- `initialize_gtms_qa_list_repo`
- `inspect_tmx_qa_list_import`
- `import_tmx_to_gtms_qa_list_repo`
- `export_gtms_qa_list_to_tmx`
- `load_gtms_qa_list_editor_data`
- `load_gtms_qa_term`
- `upsert_gtms_qa_term`
- `rollback_gtms_qa_term_upsert`
- `delete_gtms_qa_term`
- `rename_gtms_qa_list`
- `soft_delete_gtms_qa_list`
- `restore_gtms_qa_list`
- `purge_local_gtms_qa_list_repo`

These should return normalized frontend-facing shapes:

- summary: `{ id, qaListId, title, repoName, repoId, fullName, defaultBranchName, defaultBranchHeadOid, lifecycleState, language, termCount }`
- editor payload: summary fields plus `terms`
- term: `{ termId, text, notes, lifecycleState, staleState? }`

### Local Repo Sync

Add `src-tauri/src/qa_list_repo_sync.rs`, modeled on `glossary_repo_sync.rs`.

Commands:

- `sync_gtms_qa_list_repos`
- `sync_gtms_qa_list_editor_repo`

Implementation details:

- Use the same fetch/pull/push behavior as Glossaries.
- Use the same dirty repo handling and stale remote detection.
- Return sync snapshots keyed by repo name and QA list ID.
- Mark changed QA terms stale without replacing the editor's local draft state.
- For editor sync, reload only when required, matching Glossary editor behavior.

Suggested refactor:

- First copy the glossary sync module with QA-specific names.
- Only extract shared generic sync helpers after the QA version is green. Premature abstraction here is risky because the storage/schema differences are real.

### Team Metadata

Add QA list records to local team metadata beside projects and glossaries.

Plan:

- Extend team metadata structs with `qaLists`.
- Add record fields parallel to glossary records:
  - `qaListId`
  - `repoName`
  - `repoId`
  - `fullName`
  - `defaultBranchName`
  - `defaultBranchHeadOid`
  - `title`
  - `language`
  - `lifecycleState`
  - `termCount`
- Add local metadata commands/helpers:
  - list QA metadata records
  - upsert QA metadata record
  - delete QA metadata record
  - find QA repo for record
  - inspect QA repo repairs

Keep term counting fast:

- On QA Lists page summaries, count `terms/*.json` files.
- Do not parse every QA term on list-page load.
- Exact active-only term loading belongs in the QA list editor, not the top-level page.

### GitHub/Broker Support

Add GitHub repo functions parallel to glossary repo functions:

- `create_gnosis_qa_list_repo`
- `permanently_delete_gnosis_qa_list_repo`
- list QA list repos for installation/recovery

Repository naming:

- Use the same generated-repo-name strategy as Glossaries, but with a QA prefix or type marker.
- Confirm the repo properties/schema marker distinguishes QA list repos from glossary repos.
- Do not rely only on repository name prefixes if the existing Gnosis repo properties schema can carry a resource type.

Broker requirement:

- If repo creation/deletion/listing is broker-mediated, add matching broker endpoints or extend existing resource-type parameters.
- Push broker code when changed, per prior workflow requirement.

### Frontend Integration

Replace the current app-side local-persistent QA implementation with repo-backed flows.

Add or expand QA modules parallel to Glossary modules:

- `src-ui/app/qa-list-discovery-flow.js`
- `src-ui/app/qa-list-query.js`
- `src-ui/app/qa-list-repo-flow.js`
- `src-ui/app/qa-list-import-flow.js`
- `src-ui/app/qa-list-export-flow.js`
- `src-ui/app/qa-list-lifecycle-flow.js`
- `src-ui/app/qa-list-editor-flow.js`
- `src-ui/app/qa-term-draft.js`
- `src-ui/app/qa-term-sync.js`
- `src-ui/app/qa-term-write-coordinator.js`
- `src-ui/app/qa-list-write-coordinator.js`
- `src-ui/app/qa-list-background-sync.js`

Frontend behavior should then match Glossaries:

- Seed QA Lists page from selected-team cache.
- Refresh from local repo/team metadata in the background.
- Overlay pending rename/delete/default intents during refresh.
- Keep cached data isolated by team cache key.
- Open the QA list editor from the local repo-backed summary.
- Save QA term edits as local commits, then sync.
- If remote changed before edit, reload latest term and reopen modal with a notice.
- If remote sync fails after local save, keep local state coherent and show the same kind of recovery message Glossaries use.

Default QA list behavior remains frontend/local preference unless we explicitly decide to store defaults in team metadata.

Recommendation:

- Keep per-language defaults as app preferences for now, like current Glossary default behavior.
- Do not store default QA lists in GitHub repo metadata until the editor QA application logic needs team-wide shared defaults.

### Migration From Current Local QA Implementation

The first QA Lists slice stores data in app persistent storage. GitHub sync should migrate away from that shape.

Plan:

1. Keep the current local app-side implementation temporarily as a fallback during development.
2. Add repo-backed loading behind the same `state.qaLists` and `state.qaListEditor` shape.
3. Once repo-backed create/import/list/edit works, remove or demote app-persistent QA list data to a one-time migration/import path.
4. If existing local QA lists are found, offer or automatically migrate them into newly created QA list repos.

Migration decision:

- Because this feature has not shipped as a repo-backed feature yet, an automatic migration is optional. A simple “local-only QA lists are development data” cleanup may be acceptable before release.

### Verification Plan For GitHub Sync

Add tests mirroring the Glossary test coverage:

- QA list cache exposes selected-team cache key and ignores other teams.
- QA discovery hides tombstoned metadata records.
- QA discovery matches renamed remote repos by stable GitHub repo ID.
- QA discovery identifies missing local repo, missing remote repo, and unregistered local repo states.
- QA list defaults remain scoped per language after refresh.
- QA repo sync marks changed terms stale without replacing local draft state.
- QA editor payload preserves repo metadata needed for background sync.
- Opening a stale QA term reloads latest term before edit.
- Saving a QA term syncs first and then persists the user's modal draft.
- Saving a QA term rolls back or reports correctly when remote sync fails.
- QA term writes in the same repo serialize.
- QA list rename/delete/restore write intents coalesce and overlay refresh data.
- TMX import/export round trips text and notes for one-language QA lists.

Run:

```sh
node --test --loader ./src-ui/test/raw-loader.mjs src-ui/app/qa-*.test.js src-ui/screens/qa-*.test.js
npm test
npm run build
cargo test
cargo check
```

If broker endpoints change:

```sh
git status --short
git push <broker-remote> <branch>
```

### Recommended GitHub Sync Implementation Order

1. Add Rust QA list storage types and local repo read/write commands.
2. Add QA list team metadata records and local metadata repair detection.
3. Add frontend repo-backed QA list discovery and cache seeding.
4. Add QA list editor loading from local repos.
5. Add QA term write/delete commands and frontend term sync flow.
6. Add QA repo background sync for list page and editor.
7. Add create/import/export flows against real local repos.
8. Add rename/delete/restore/permanent delete lifecycle flows.
9. Add GitHub/broker repo creation/deletion/listing.
10. Remove or migrate the temporary app-persistent QA list storage.
11. Run full JS/Rust verification.

## Risks and Decisions

### Risk: Over-generalizing Glossary Code

Glossary and QA Lists look similar, but the data semantics differ. A large shared abstraction could make both harder to reason about.

Decision:

- Reuse small utilities and patterns.
- Make QA-specific modules first.
- Extract shared resource-list helpers only after duplicated code stabilizes.

### Risk: Fake Source Language

Using the Glossary schema directly would force QA Lists to have a source language they do not really have.

Decision:

- Use a parallel repo structure with QA-specific root metadata.
- Add adapters where reusing glossary-shaped utilities is useful.

### Risk: Broker Dependency

Full remote functionality requires broker API changes.

Decision:

- Plan broker changes explicitly.
- Keep local-only work useful, but do not call the feature complete until remote create/list/delete/sync works.

### Risk: TMX Ambiguity

TMX is inherently multilingual, while QA Lists have one language.

Decision:

- Define a deterministic import choice before implementation.
- Prefer previewing the detected language and letting the user confirm.

## Out of Scope for This Milestone

- Applying QA Lists to translation editor rows.
- QA checking/execution logic.
- AI review integration with QA Lists.
- Per-row QA warnings or scoring.
- QA term categories/severity unless explicitly added later.
