# Glossary Implementation Plan

## Goal

Implement git-backed glossaries using:

- one repo per glossary
- one JSON file per term
- no committed term index
- in-memory search and matcher structures built when a glossary is opened

This should follow the same broad architecture as the Projects page and project repo sync flow wherever possible.

## Agreed Rules

### Storage

- each glossary lives in its own repo
- `glossary.json` stores only glossary-level metadata
- each term lives in `terms/<term_id>.json`
- there is no committed term index file
- the app loads the whole glossary into memory when the glossary editor is opened

### Glossary Term Fields

Each term file should store:

- `term_id`
- `source_terms[]`
- `target_terms[]`
- `notes_to_translators`
- `footnote`
- `untranslated`
- `lifecycle.state`

### Permissions

- creating a new glossary repo: team owners only
- importing a glossary file into a new repo: team owners only
- adding terms: any team member
- editing terms: any team member
- deleting terms: any team member

Glossary-level rename/delete permissions should be implemented to match the final agreed product rules for glossary repos.

## Implementation Stages

### 1. Storage And Spec

- add glossary repo format to the storage spec
- define `glossary.json`
- define `terms/<term_id>.json`
- define lifecycle rules for glossary repos and terms

Deliverable:

- stable on-disk glossary schema with no shared term index file

### 2. Broker Glossary Repo Support

Add broker operations for glossary repos in the org:

- list glossary repos for the selected team/org
- create empty glossary repo
- import glossary file into a newly created repo
- rename glossary repo metadata
- soft-delete / restore / permanently delete glossary repo
- provide repo sync metadata just like project repos

Deliverable:

- glossaries are discoverable and manageable as org repos

### 3. Local Tauri Glossary Operations

Add Tauri commands to:

- load glossary metadata from disk
- scan `terms/` and return term summaries
- load full glossary term data for editing
- add one term
- edit one term
- delete or restore one term

Each term mutation should:

- rewrite only the touched term file
- `git add` only the touched file
- make a local commit
- let the existing sync layer pull/push in the background

Deliverable:

- local glossary editing works without shared-file merge hotspots

### 4. Glossaries Page

Replace the current mock page with a real glossary list page backed by repos.

Behavior:

- one row per glossary repo
- columns for:
  - `Name`
  - `Source Language`
  - `Target Language`
- clicking a glossary row opens the glossary editor
- `Upload` creates a new repo from an imported glossary file
- `+ New Glossary` creates an empty repo
- use optimistic updates and sync feedback modeled on the Projects page

Deliverable:

- real glossary list page using live repo-backed data

### 5. Glossary Editor Page

Replace the current mock glossary editor with a real term list view.

Behavior:

- one row per term
- search field filters in memory
- `+ New Term` creates a term
- clicking a term row opens a modal editor
- row actions include `Edit` and `Delete`

The modal editor should later support:

- multiple source terms
- multiple target terms
- `notes_to_translators`
- `footnote`
- `untranslated`

Deliverable:

- real glossary editor for term-level work

### 6. Import And Export

First import/export target:

- TMX

Why:

- the old app already loaded glossary data from TMX
- it is the clearest first migration/import path

Planned behavior:

- importing TMX creates a new glossary repo
- exporting downloads a TMX built from the repo format

Deliverable:

- glossary import/export path for the first supported glossary file format

### 7. Conflict Safety And Validation

Validate the core conflict-minimization rules:

- term add/edit/delete touches only one term file
- glossary metadata stays in `glossary.json` only
- no committed term index file exists
- repo sync never leaves a glossary repo stuck mid-rebase

Deliverable:

- predictable, Git-friendly glossary collaboration behavior

## Recommended Starting Point

Start with:

1. storage/spec
2. local Tauri glossary load/save layer

Reason:

- once the disk format is correct, the list page and editor page can both be built on top of it
- it avoids repeating the shared-file conflict problems already seen elsewhere
