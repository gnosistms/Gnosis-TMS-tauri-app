# Projects Page Search Plan

## Goal

Implement search on the Projects page that:

- searches across all files in all locally available project repos for the selected team
- searches all indexed languages by default
- replaces the normal projects list with a dedicated search-results view while a query is active
- lets the user open a result directly in the editor and jump to the matching row
- works with the app's local-first and offline-capable model

## Confirmed Product Rules

- The search box lives on the Projects page.
- When the search query is empty, the page shows the normal projects view.
- When the search query is non-empty, the page hides the normal project cards and shows only search results.
- The user does not need to specify a language. Search runs across all indexed languages.
- Each result represents one matching `project + file/chapter + row + language`.
- Each result must show:
  - project
  - file
  - language
  - a text snippet
  - an action to open the file in the editor
- Opening a result must:
  - open the file in the editor
  - scroll directly to the matching row
  - focus or activate the matching language panel
- Clearing the search box must immediately return the page to the normal projects view.

## Product Shape

### Search Mode

Projects search should be a page mode, not a filter applied to the existing project-card layout.

That means:

- empty query -> normal project cards
- non-empty query -> results list

This avoids trying to force row-level search results into a project/file accordion UI that was built for browsing, not retrieval.

### Result Granularity

Use one result row per matching row-language document.

Do not group by project card or file card in the first implementation.

Why:

- multilingual matches stay explicit
- the matching language is unambiguous
- the `Open` action can carry one concrete `chapterId + rowId + languageCode`
- result ordering remains straightforward

### Result Layout

Each result row should show:

1. a breadcrumb line:
   - `Project title > File title > Language name`
2. a snippet line:
   - short excerpt from the matching language text
   - highlight exact query token overlaps when possible
3. a footer/action area:
   - `Open`
   - optional secondary metadata such as match count

### Empty / Loading States

- Searching: show a loading state inside the search-results area
- No matches: show `No matches found.`
- Index building/rebuilding: show a warning/info message such as `Search index is updating. Results may be incomplete.`
- Error: show a normal projects-page error box in the results area without dropping the user's query

### Paging

Return a limited page of results first.

Recommended v1:

- first page: `50`
- subsequent pages: `50`
- UI: `Load more`

This prevents large DOM work and keeps search responsive.

## Architecture Decision

Use a local SQLite-backed search cache and query it from Rust.

Do not add Tantivy for v1.
Do not add a server search engine.

Reasons:

- the app is a local Tauri desktop app with offline mode
- project data already lives in local repos on disk
- search should remain available offline
- the expected corpus size is modest enough for SQLite + FTS5
- approximate text matching can be layered on top of FTS candidate retrieval

## Search Strategy

The search implementation should combine:

1. exact normalized substring matching
2. token-based candidate retrieval
3. approximate string similarity

The main point is to support:

- ordinary contains-style search
- cross-language default search
- near-match text retrieval such as similar sentence fragments

### Retrieval Strategy

Use SQLite FTS5 to get candidates quickly from normalized search text.

Use two FTS indexes:

- `unicode61` token index for token-style retrieval
- `trigram` index for substring and near-text candidate retrieval

Then re-rank candidates in Rust using:

- exact substring presence
- token coverage
- token order
- character trigram similarity
- small length penalty

This keeps the database simple while giving better ranking than plain FTS alone.

## Storage Model

### Database Location

Store the search DB in installation-scoped app data, alongside other local installation data.

Recommended path:

`<app_data>/installations/installation-{installation_id}/search/project-search.sqlite3`

This matches the existing storage model used for local installation data and keeps the search cache outside the repos themselves.

### Document Model

Store one search document per:

- installation
- project
- chapter/file
- row
- language

Each document should contain:

- `project_id`
- `project_title`
- `repo_name`
- `chapter_id`
- `chapter_title`
- `row_id`
- `row_order_key`
- `language_code`
- `language_name`
- `plain_text`
- `search_text`
- `is_deleted`
- `text_hash`
- `updated_at_unix`

### Search Text Normalization

Build `search_text` from `plain_text` with deterministic normalization:

1. Unicode normalize
2. lowercase
3. collapse internal whitespace
4. trim
5. remove punctuation noise that should not dominate matching
6. fold Latin diacritics for Latin-script languages

Keep `plain_text` unchanged for display.

`search_text` is for retrieval and ranking only.

## Indexing Scope

Index:

- active project files
- non-deleted rows
- non-empty language `plain_text`

Do not index:

- deleted projects
- deleted files
- soft-deleted rows
- empty strings

This keeps result quality aligned with what the projects page normally presents.

## Rebuild And Update Rules

### Core Rule

The search DB is a cache derived from repo data on disk.

The repos remain the source of truth.

### v1 Update Strategy

For the first implementation, favor correctness and simplicity over fine-grained incremental maintenance.

Use a hybrid strategy:

1. build or rebuild the selected team's index by scanning local project repos
2. trigger rebuild after events that already refresh local project data
3. allow searches to run against the latest completed index while a rebuild is in progress
4. expose index status so the UI can explain when results may be incomplete

### Rebuild Triggers

Trigger a background rebuild when:

- the selected team changes
- projects are loaded or refreshed
- project import completes
- file add/delete/restore completes
- row-structure changes complete
- row text saves complete
- background project sync reports disk changes

For v1, multiple rapid triggers should coalesce into one queued rebuild.

### Future Optimization

If rebuild cost becomes noticeable, move to incremental upsert/delete by row-language document.

That optimization should be explicitly deferred until correctness is established.

## Backend Implementation

### New Rust Modules

Add a small project-search backend surface, for example:

- `src-tauri/src/project_search.rs`
- `src-tauri/src/project_search_db.rs`
- `src-tauri/src/project_search_index.rs`
- `src-tauri/src/project_search_query.rs`
- `src-tauri/src/project_search_normalize.rs`

Responsibilities:

- DB open/init/schema migration
- repo scanning and document extraction
- FTS candidate queries
- result re-ranking
- search command payloads
- background rebuild orchestration

### Tauri Commands

Add commands such as:

- `search_projects`
- `refresh_project_search_index`
- optional `get_project_search_status`

`search_projects` input should include:

- `installationId`
- `query`
- `limit`
- `offset`

`search_projects` output should include:

- `results`
- `total`
- `hasMore`
- `indexStatus`
- `error` when relevant

### Repo Scan Inputs

The indexer should scan the same local repos already managed under the installation's local project repo root.

It should read:

- project metadata
- chapter metadata
- row JSON files

It should derive documents from each row's language `plain_text` fields.

### Result Payload

Each result should return enough information for rendering and navigation:

- `resultId`
- `projectId`
- `projectTitle`
- `chapterId`
- `chapterTitle`
- `rowId`
- `languageCode`
- `languageName`
- `plainText`
- `snippet`
- `matchCount`
- `score`

Keep `snippet` precomputed in Rust so the frontend stays simple.

## Frontend State Model

Add a dedicated projects search state separate from the normal projects page state.

Recommended shape:

- `query`
- `status`
  - `idle`
  - `searching`
  - `ready`
  - `error`
- `error`
- `results`
- `resultsById`
- `total`
- `hasMore`
- `indexStatus`
  - `idle`
  - `building`
  - `ready`
  - `stale`
  - `error`
- `requestId`
- `nextOffset`

This should live in app state, for example under:

- `state.projectsSearch`

The projects page should read this state and decide which mode to render.

## Frontend Flow

### Input Handling

Add a dedicated projects search input handler.

Suggested attribute:

- `data-project-search-input`

Behavior:

- update `state.projectsSearch.query`
- trim whitespace only for search activation checks, not for displayed input value
- if the trimmed query is empty:
  - cancel outstanding search response handling
  - reset projects search state to idle
  - render the normal projects view
- otherwise:
  - debounce slightly
  - issue a backend search request
  - keep only the latest response by request id

### Debounce

Use a small debounce such as `150-250ms`.

This avoids firing a backend query on every keystroke while still feeling immediate.

### Request Ordering

Use a monotonically increasing request id.

Only apply the response if it matches the latest active request id.

This avoids stale response races when the user types quickly.

### Mode Switching

The render logic should be:

- `trimmedQuery === ""` -> render normal projects view
- `trimmedQuery !== ""` -> render projects search results

This rule must remain simple and central.

## Projects Page UI Changes

### Search Field

Keep the existing search box in the page header, but bind it to `state.projectsSearch.query`.

When search mode is active:

- keep the search box visible
- optionally show a clear button

### Results View

Add a dedicated renderer for the results list, either:

- inside `src-ui/screens/projects.js`
- or as a new module such as `src-ui/screens/project-search-results.js`

The results renderer should handle:

- loading
- error
- empty
- ready
- load more

### Normal Projects View Preservation

Do not mutate the project-card data to express search results.

The normal projects view should remain intact and should reappear immediately when the search box clears.

## Open Result Flow

### Required Behavior

Clicking `Open` on a search result must:

1. open the chapter editor
2. scroll to the result row
3. activate the matching language

### Implementation Shape

Reuse the existing chapter-open flow and translate anchor queue where possible.

The result-open action should:

1. capture the result payload from `resultsById`
2. queue a translate row anchor for:
   - `rowId`
   - `languageCode`
3. open the chapter via the existing `openTranslateChapter(...)`
4. once the chapter is ready, activate the target field/language

If necessary, add a small helper in translate/editor flow for:

- open chapter and reveal row-language target

Do not create a second editor-opening path just for search.

## Matching Snippet Rules

For v1, snippet generation should be practical, not perfect.

Recommended behavior:

- prefer a snippet around the best exact token overlap
- if there is no good exact overlap, fall back to the start of the field or the best approximate fragment
- keep snippets short and stable

Highlight:

- exact query token overlaps when known
- otherwise allow plain snippet text without highlight

Approximate-result quality matters more than perfect highlight precision in the first pass.

## Test Plan

### Rust Tests

Add tests for:

- search-text normalization
- repo scan -> document extraction
- DB initialization and schema creation
- rebuild replacing stale rows
- exact substring ranking beating approximate hits
- approximate trigram search surfacing near-text matches
- deleted/empty content being excluded

### Frontend Unit Tests

Add tests for:

- projects page switches to results mode when query becomes non-empty
- projects page returns to normal mode when query is cleared
- stale search responses are ignored
- loading / error / empty / ready states render correctly
- `Open` action resolves a result and calls the chapter-open path with the right target ids

### Browser / Integration Tests

Add targeted browser coverage for:

- typing in the Projects page search box hides project cards and shows results
- clearing the search box restores the normal projects list
- clicking `Open` on a result opens the editor and reveals the correct row

## Implementation Stages

### Stage 1. State And UI Shell

- add `state.projectsSearch`
- bind the Projects page search field to it
- add results-mode rendering
- add mode switching based on trimmed query emptiness

### Stage 2. Backend Search DB And Scan

- add SQLite DB init and schema
- add project repo scan and document extraction
- add full rebuild command

### Stage 3. Query Path

- add `search_projects`
- implement candidate retrieval
- implement Rust-side ranking and snippets

### Stage 4. Frontend Search Flow

- wire input debounce and request ordering
- render search states
- add `Load more`

### Stage 5. Open And Reveal

- add result action handling
- queue anchor and open the editor
- activate the target language panel after load

### Stage 6. Rebuild Triggers

- rebuild on project discovery / import / editor write / repo sync events
- coalesce redundant rebuilds

### Stage 7. Verification

- run focused frontend tests
- run Rust tests
- run browser coverage for the critical flow

## Explicit Non-Goals For v1

- advanced language-specific tokenization
- semantic/vector search
- cross-team federated search
- grouping results by project card
- exact highlight spans for every approximate hit
- aggressive incremental row-level indexing from the first pass

