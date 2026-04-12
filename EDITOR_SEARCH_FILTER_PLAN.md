# Editor Search / Filter Plan

## Goal

Implement editor search as the first real editor filter, not as a separate mode.

That means:

- search and future filters should run through one shared filtering pipeline
- search should remove non-matching rows from the editor view
- row order must remain the existing lexicographical order by `orderKey` / `rowId`
- search should only look at currently visible languages
- this design should lead directly into a later find/replace implementation

## Confirmed Product Rules

- Typing a search term such as `distintos` should show only rows whose visible languages contain that term.
- If a language is hidden, it should not participate in search matching.
- Matching rows keep their normal row order; non-matching rows are simply omitted.
- Search and filters should ideally use the same backend/in-memory mechanism, not just the same visual shell.
- Planned future filters include:
  - show only soft-deleted rows
  - show only rows with empty target language
  - show only rows not marked `reviewed`
  - show only rows marked `please check`
- After search, the next feature will be find/replace, using search as its basis.
- In a later phase, search results should support a `View in context` action that returns to the normal unfiltered editor and scrolls to the selected result inside the full chapter.

## Core Design Decision

Do not build a special "search mode".

Instead, build one editor filter model that produces:

1. a filtered row set for display
2. optional search-match metadata inside the visible filtered rows

This keeps search, future filters, and later replace aligned around the same row-selection rules.

## Architectural Shape

### 1. Shared Editor Filter State

Extend `state.editorChapter` with a dedicated filter state object, for example:

- `searchQuery`
- `showDeleted`
- `targetEmptyOnly`
- `unreviewedOnly`
- `pleaseCheckOnly`

Search is one filter field in that object, not a separate subsystem.

### 2. Filter Compiler

Add a shared editor filter module that converts the current filter state plus current editor visibility into a row predicate.

Inputs:

- raw editor rows
- current language list
- currently collapsed / hidden languages
- current filter state

Outputs:

- `filteredRows`
- `filteredRowIds`
- `searchMatchesByRowAndLanguage` for rows that survive filtering
- counts / summary metadata for the toolbar

The important point is that row inclusion and search matching come from the same filter evaluation pass.

### 3. Search Clause Semantics

The search clause should:

- normalize the query for case-insensitive matching
- search only languages that are currently visible
- treat a row as included if any visible language matches
- produce per-language match ranges for later highlight / replace work

This gives us one query evaluation that can support:

- current row filtering
- later inline highlighting
- later next / previous find navigation
- later replace / replace-all

### 4. Structured Filters Use The Same Pipeline

Future filters should be added as more row predicates in the same compiler:

- deleted-state filter
- empty-target filter
- reviewed-state filter
- please-check filter

The row survives only if it satisfies the active filter combination.

This means the user sees one consistent result set mechanism:

- search narrows rows
- filter toggles narrow rows
- combined search + filters narrow rows together

### 5. Display Model Runs After Filtering

Build the editor display list from the filtered raw rows, not from the full row set.

That means:

- apply filter/search first
- then derive deleted-row grouping / separators from the filtered rows
- then render / virtualize that filtered display list

This avoids having a separate "search result overlay" layered on top of the normal editor.

### 6. Virtualization

Do not create a special non-virtualized search path.

Instead:

- virtualization should consume the already-filtered display list
- if the filtered result set is small, virtualization will naturally fall away or become trivial
- if the filtered result set is still large, virtualization remains available

This keeps search and future filters on the same rendering path.

### 7. Hidden-Language Interaction

When language visibility changes:

- rerun the filter compiler immediately
- a row that matched only in a newly hidden language should disappear
- a row that still matches in another visible language should remain

This is a key rule and should be treated as part of the search/filter contract, not as a UI detail.

### 8. Replace-Ready Search Model

Even though replace is not part of the first implementation, the search compiler should already emit stable match metadata:

- `rowId`
- `languageCode`
- `start`
- `end`
- matched text

That lets the later find/replace feature reuse the exact same search semantics instead of re-implementing matching a second time.

### 9. Context-Reveal Follow-Up

Plan for a future `View in context` action on search results.

That future flow should:

- start from a filtered search result
- clear or suspend the active filter set
- restore the normal unfiltered editor row list
- scroll to the selected row and match location in the full file

So the search/filter model should preserve enough stable identity to support that later:

- `rowId`
- `languageCode`
- match offsets when applicable

This should be treated as a later navigation feature built on top of the same filter/search result model, not as a separate result format.

## Implementation Plan

### Stage 1. Shared Filter State

Add editor filter state to `state.editorChapter`.

Keep it explicit and structured so future filters can slot in without changing the overall architecture.

### Stage 2. Filter/Search Compiler

Add a dedicated module such as:

- `src-ui/app/editor-filters.js`

Responsibilities:

- normalize the active filter state
- evaluate row inclusion
- evaluate visible-language-aware search matches
- return filtered rows plus match metadata

### Stage 3. Derived Editor Screen Model

Update the editor screen model so it derives:

- filtered raw rows
- filtered display rows
- toolbar summary data

from the shared filter compiler output.

This should replace any future temptation to bolt search results directly into the renderer.

### Stage 4. Toolbar UX

Keep the current search box visually in the editor toolbar, but treat it as the first active filter control.

The filter control area should be planned as one coherent cluster:

- search input
- filter selector / toggles
- result summary

Even if only search ships first, the layout should clearly support the upcoming filters.

### Stage 5. Rendering

Render only filtered rows.

Do not keep unmatched rows in the DOM.

Optional first-pass visuals:

- no special search highlight required if that slows down the first pass
- but preserve match metadata in the model so highlights can be added without changing search semantics

### Stage 6. Search Navigation Hooks

If next / previous search navigation is included in the first pass, it must navigate only inside the filtered result set and use the same emitted match metadata.

If not included in the first pass, the emitted metadata should still make it straightforward later.

### Stage 7. Replace Follow-Up

Implement find/replace on top of the exact same search compiler:

- same visible-language search semantics
- same filtered row set
- same per-match locations

Replace should not introduce a second search interpretation.

## Test Plan

### Filter Compiler Tests

- search matches only visible languages
- hidden-language matches do not keep a row visible
- multiple visible languages use OR semantics for row inclusion
- no-query search leaves rows visible unless another filter excludes them
- structured filters compose correctly with search

### Display Model Tests

- filtered rows remain in original `orderKey` order
- deleted-row grouping is derived from the filtered row set
- toggling language visibility recomputes the filtered result set

### Replace-Readiness Tests

- emitted match metadata stays stable for the same query and row text
- match metadata points to the correct row/language offsets

## Recommended First Slice

First implementation should ship:

1. shared editor filter state
2. search as the first active filter
3. filtered row rendering based on visible languages
4. no separate search mode

Then add:

5. structured filters
6. find/replace on top of the same compiler

## Anti-Goals

Do not do these:

- do not build search as a standalone mode that bypasses the future filter system
- do not make search operate on hidden languages
- do not preserve unmatched rows in the editor and merely "jump" between them
- do not create one matching system for search and another for replace
