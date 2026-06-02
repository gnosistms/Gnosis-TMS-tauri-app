# Gnosis TMS — Foundational Principles

## Preamble

Gnosis TMS exists to serve professional translation teams working at scale. It enables translators, reviewers, and project managers to collaborate on translation work — across projects, glossaries, and QA resources — while keeping data under the team's control and guaranteeing that collaboration happens through a versioned, auditable history rather than a shared server.

The platform is a desktop application. Users install it, open it, and work. It does not require a network connection to read or translate. It does not require a running server. It does not require a database administrator. When network is available, it syncs silently in the background. When it is not, work continues uninterrupted.

We choose technologies that eliminate operational ceremony: Tauri for native desktop capability without Electron's weight, vanilla JavaScript for a rendering layer that does not fight the editor, Git for versioned content that survives any failure, and GitHub for the social and storage infrastructure that teams already use.

---

## Principles

These principles define the architectural philosophy and product values that guide all design decisions. When implementation choices are ambiguous, these principles resolve the ambiguity.

### F-I. Local-First Architecture

The user's machine is the primary source of truth for the user experience. UI state is seeded from local cache instantly; remote sync happens in the background and never gates reads or blocks UI actions.

- Local cache MUST seed the UI before any remote request is made
- Background sync MUST NOT disable user-facing actions during execution
- Reads MUST work offline; writes queue locally and sync when connection is available
- The platform MUST remain fully usable without a network connection for read and translate operations

**Rationale**: Translators work under deadline. Any latency imposed by the network degrades the experience. Local-first architecture makes the common case (open, translate, save) instantaneous regardless of connection quality.

### F-II. GitHub as Identity and Storage Infrastructure

Teams are GitHub organizations. Projects, glossaries, and QA lists are GitHub repositories. Authentication is via GitHub App installation. These are non-negotiable design constraints — they are not configurable and cannot be swapped for alternatives.

- Team identity MUST be derived from GitHub App installation on a GitHub organization
- Content repos (projects, glossaries, QA lists) MUST be GitHub repos owned by the team's organization
- Write access to a content repo MUST be gated on GitHub installation write access
- The broker (backend service) authenticates on behalf of the GitHub App; clients do not hold GitHub credentials directly

**Rationale**: GitHub provides the versioning, access control, organizational model, and hosting that would otherwise require substantial infrastructure. Teams that use GitHub for code already understand its model. Building on GitHub's primitives means not rebuilding them.

### F-III. Tauri as the Platform Contract

Gnosis TMS is a desktop application built on Tauri. Tauri provides the windowing, native OS integrations, file system access, and the IPC boundary between the Rust backend and the JS frontend. The platform targets macOS and Windows.

- The app MUST bundle its own Git binary — no system Git may be assumed or required
- Tauri commands (Rust) own all file system operations, git operations, and external process invocations
- The JS frontend MUST use `invoke()` for all operations that touch the file system, git, or native APIs
- Cross-platform path handling MUST normalize separators — Windows paths with backslashes appear in git history and MUST be handled explicitly

**Rationale**: Bundling Git removes the single largest source of "works on my machine" failures in desktop git tools. Making Tauri commands the sole boundary for native operations means the JS layer stays testable in Node without Tauri present.

### F-IV. Vanilla JavaScript, No UI Framework

The frontend is plain ES modules. There is no component framework, no virtual DOM, no hydration layer, no JSX. Vite is the build tool. TanStack Query Core and TanStack Virtual Core are the only runtime dependencies.

- No UI framework (React, Vue, Svelte, etc.) MUST be introduced
- Components are plain functions and DOM event listeners
- The editor's virtualization layer owns its own scroll and render surface — no framework virtual DOM may compete with it
- TanStack Query Core is the ONLY mechanism for async data fetching and cache management

**Rationale**: The translation editor virtualizes thousands of rows with custom scroll anchoring, inline markup rendering, and per-row state. A framework virtual DOM reconciler creates unpredictable interference with this layer. Vanilla JS keeps the rendering surface explicit and fully under our control.

### F-V. Write-Intent Preservation

User mutations must survive any number of background refreshes without reverting. When a user renames a project, deletes a glossary, or creates a new QA list, that visual state must persist through every subsequent sync response until the mutation is confirmed settled.

- Pending mutations (create, rename, delete, restore) MUST be applied to every incoming query snapshot via `applyPendingMutations`
- TanStack Query is the ONLY path through which cache seeds, local disk data, and remote refresh results may update visible list state
- No module below the query boundary MAY directly write to visible resource state (`state.projects`, `state.glossaries`, etc.)
- A background refresh MUST NOT temporarily revert a rename, delete, or pending-create while the server catches up

**Rationale**: Optimistic state that visually reverts destroys user trust. A translator who deletes a project and sees it reappear seconds later is confused and loses confidence in the tool. Write-intent preservation is the mechanism that prevents this.

### F-VI. Metadata-First Mutation Lifecycle

Before any git or remote operation, write the metadata record first. Metadata is the recovery anchor: it enables pending-create resume, tombstone resolution, repair actions, and stale client detection.

- Create operations MUST write the metadata record before pushing to the remote repo
- Delete operations MUST write a tombstone to the metadata repo before removing the content repo
- If a remote operation fails, the metadata record MUST exist so recovery can proceed
- Metadata repo state is authoritative for resource lifecycle — it supersedes local cache when they conflict

**Rationale**: Network and git operations can fail at any point. Metadata-first ensures there is always a recoverable state. Without it, a failed create leaves no trace; with it, the app can resume the create on next launch.

### F-VII. Git-Native Content Model

Translation content (chapters, glossary terms, QA list entries) is stored as structured text files in git repositories. The content schema is designed for conflict-free git merges.

- Editor rows MUST be ordered by lexicographic string keys (`row_order_key`), not integer indexes
- Lexicographic ordering enables parallel insertions without merge conflicts — two clients inserting rows at the same position produce keys that sort correctly without coordination
- Content files MUST be parseable line-by-line for efficient git diff and merge
- Semantic conflict resolution (detecting when two edits to the same row cannot be auto-merged) is a first-class feature

**Rationale**: Integer row indexes make insertions by two clients at the same position produce unresolvable conflicts. Lexicographic keys make the common case (two translators adding rows in different parts of a chapter) merge automatically and correctly.

---

**Version**: 1.0.0 | **Established**: 2026-06-02
