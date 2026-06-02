# Foundational Principles Evidence

Supporting evidence for the principles in `foundational-principles.md`. This file is
descriptive, not directive.

## Verification Status

- Last verified: 2026-06-02
- Verified from: `972bdc92`

## F-I. Local-First Architecture

- Status: verified against code
- Primary sources:
  - `src-ui/app/project-query.js`
  - `src-ui/app/offline-policy.js`

## F-II. GitHub as Identity and Storage Infrastructure

- Status: verified against code
- Primary sources:
  - `src-tauri/src/installation_access.rs`
  - `src-tauri/src/github/repos.rs`

## F-III. Tauri as the Platform Contract

- Status: verified against code
- Primary sources:
  - `src-tauri/src/lib.rs`
  - `src-tauri/src/repo_sync_shared.rs`

## F-IV. Vanilla JavaScript, No UI Framework

- Status: verified against code
- Primary sources:
  - `package.json`
  - `src-ui/main.js`

## F-V. Write-Intent Preservation

- Status: verified against code
- Primary sources:
  - `src-ui/app/optimistic-collection.js`
  - `src-ui/app/project-query.js`

## F-VI. Metadata-First Mutation Lifecycle

- Status: verified against code
- Primary sources:
  - `src-tauri/src/team_metadata_local.rs`
  - `src-tauri/src/github/repos.rs`

## F-VII. Git-Native Content Model

- Status: verified against code
- Primary sources:
  - `src-tauri/src/project_import/chapter_editor/shared.rs`
  - `src-tauri/src/project_search/schema.rs`
