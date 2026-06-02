# AGENTS.md

Guidance for AI agents working in this repository.

## Project Overview

Gnosis TMS is a desktop Translation Management System built on Tauri. It provides
project, glossary, and QA list management for translation teams whose projects live
in GitHub repositories. The app is local-first: data is cached on disk and synced
to GitHub in the background.

See [`.vt/memory/foundational-principles.md`](.vt/memory/foundational-principles.md)
for the architectural philosophy that governs strategic and design decisions.

## Key Locations

### Frontend (`src-ui/`)

- `src-ui/app/` — flat module namespace (~250 JS source modules, ~350 total including test files)
- `src-ui/app/editor-inline-markup/` — inline markup parser, serializer, transforms, highlights
- `src-ui/app/repo-resource/` — nascent shared framework for glossary/QA resource management
- `src-ui/app/actions/` — user action handlers by domain (project, glossary, QA, auth, etc.)
- `src-ui/app/events/` — DOM event handlers (drag, keyboard shortcuts, native drops)
- `src-ui/app/team-flow/` — team-specific flow modules
- `src-ui/screens/` — screen-level rendering (teams, etc.)
- `src-ui/lib/vendor/` — vendored libraries

### Backend (`src-tauri/src/`)

- `src-tauri/src/main.rs` — app entry point (calls `gnosis_tms_lib::run()`)
- `src-tauri/src/lib.rs` — Tauri command definitions and `invoke_handler` registration
- `src-tauri/src/store.rs` — local key-value persistent store (`tauri-plugin-store`)
- `src-tauri/src/github/` — GitHub API client
- `src-tauri/src/project_import/` — DOCX/HTML/paste import pipeline
- `src-tauri/src/project_search/` — trigram-based SQLite search indexer
- `src-tauri/src/ai/` — AI provider integration
- `src-tauri/src/broker*.rs` — broker service auth and communication

### Planning & Docs

- `plans/` — per-feature markdown plan files (active and completed)
- `docs/` — project documentation site
- `tests/` — Playwright end-to-end tests
- `scripts/` — release and utility scripts

## Development Commands

```bash
# Frontend dev server (hot-reload, no native)
npm run dev

# Full app with native backend (recommended for feature work)
npm run tauri:dev

# Build release app
npm run tauri:build

# Unit tests (Node, no browser or Tauri required)
npm test

# Browser-based integration tests
npm run test:browser

# Audit unused exports
npm run audit:unused
```

## Architecture at a Glance

### Two-Process Model

The Tauri app runs two processes. The **Rust backend** owns all file system, git,
SQLite, and GitHub API operations. The **JS frontend** owns all UI state, rendering,
and user interaction. They communicate exclusively via `invoke()` (JS → Rust) and
Tauri events (Rust → JS). The frontend never touches the file system directly.

### State Management

All async data flows through **TanStack Query Core** (`@tanstack/query-core`). The
query cache is the single path through which remote data, local disk data, and
cache seeds may update **resource collection state** (`state.projects`,
`state.glossaries`, `state.qaLists`). Editor session state (`state.editorChapter`)
is managed separately with direct mutations inside editor modules.

Pending mutations (write intents) are applied to every incoming snapshot via
`applyPendingMutations` in `optimistic-collection.js`. This preserves user-visible
rename/delete/create state across background syncs.

### Module Ownership Pattern

For each top-level resource (projects, glossaries, QA lists), three module types have
distinct ownership:

| Module type | Owns | Example |
|---|---|---|
| `*-flow.js` | User intent, screen entry points, navigation | `project-flow.js` |
| `*-query.js` | Query cache, snapshot application, observer subscriptions | `project-query.js` |
| `*-discovery-flow.js` | Lower-level data loading; publishes via injected query-layer callbacks | `project-discovery-flow.js` |

Do not add direct visible state writes to discovery flows outside injected query-layer
publishers. Do not add query cache management to flow files.

## Common Mistakes to Avoid

### Cross-Stack

- **Never assume a bug is in the JS layer** — most data problems originate in the Rust
  command. Test the Tauri command in isolation before debugging JS state.
- **Never bypass TanStack Query** to write visible state from a discovery flow or
  background sync handler. State written around the side of the query cache creates
  stuck-state bugs that are hard to reproduce.
- **Never add a new boolean permission flag** for a new action type. Add a named
  capability to `permissions.js` derived from `membershipRole`. See `plans/permission-matrix-plan.md`.

### Background Operations

- **Never disable user-facing actions** (Add files, Create, Rename, Delete) because
  a background sync is running. Sync state is independent of action availability.
- **Never block the IPC call path** on a long-running git or network operation —
  return immediately with a job ID or status event; emit progress via Tauri events.

### Windows

- **Git paths in stored history may use backslashes** — always normalize before
  comparing. See `345123ff Normalize project git paths for Windows history`.
- **Virtualization scroll bugs on Windows** differ from macOS — test scroll behavior
  on both platforms before marking editor work complete.

## Location-Specific Files

Each directory contains both an `AGENTS.md` (canonical guidance) and a `CLAUDE.md`
symlink that resolves to `AGENTS.md`. The symlinks exist so Claude Code, which reads
`CLAUDE.md`, loads the same content without a separate file to maintain.

- `src-ui/AGENTS.md` — Vanilla JS patterns, TanStack Query rules, editor state rules
- `src-tauri/AGENTS.md` — Rust/Tauri patterns, bundled git, storage, write access
- `src-ui/app/editor-inline-markup/AGENTS.md` — Inline markup grammar, invariants, round-trip rules

## Active Technologies

- Rust + Tauri 2 (backend, native integrations)
- Vanilla ES modules + Vite 5 (frontend)
- TanStack Query Core 5 (async state), TanStack Virtual Core 3 (editor virtualization)
- SQLite via `rusqlite` bundled (search index)
- `tauri-plugin-store` (local key-value persistent store)
- GitHub App + broker service (auth, remote repo management)

## Rules

- **Scope Discipline (Critical)** — Only modify files directly related to the current
  task. Note unrelated issues; do not act on them.
- **Plan First** — For tasks touching more than two files or three steps, write a plan
  in `plans/` before implementing. Single-file fixes go direct.
- **Parity** — When adding a capability to glossaries, apply it to QA lists too (and
  vice versa). These resources share a domain model and must track each other.
- **Commit Hygiene** — Small, focused commits. One logical change per commit.
