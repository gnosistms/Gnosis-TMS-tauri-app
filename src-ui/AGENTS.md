# Frontend Development Guide

Vanilla JS patterns for Gnosis TMS. See root `CLAUDE.md` for project overview and
`.vt/memory/foundational-principles.md` for architectural principles.

## Stack

- Plain ES modules (no UI framework — this is permanent, not a placeholder)
- Vite 5 (build tool and dev server)
- TanStack Query Core 5 (`@tanstack/query-core`) — async state and cache management
- TanStack Virtual Core 3 (`@tanstack/virtual-core`) — editor row virtualization
- Node built-in test runner (`node --test`) for unit tests
- Playwright for browser-based integration tests

## Module Organization

All application logic lives as a flat list of modules in `src-ui/app/`. There are no
import aliases or path prefixes — modules import each other by relative path.

Subdirectories have specific purposes:

| Directory | Purpose |
|---|---|
| `app/editor-inline-markup/` | Inline markup parsing, serialization, transforms — see its own CLAUDE.md |
| `app/repo-resource/` | Nascent shared framework for glossary/QA resource management |
| `app/actions/` | User-facing action handlers, one file per domain |
| `app/events/` | DOM event handlers: drag, keyboard shortcuts, native drops |
| `app/team-flow/` | Team-specific flow modules |
| `screens/` | Screen-level renderers (builds and mounts screen HTML) |

## TanStack Query: The Single State Update Path

TanStack Query Core is the **only** mechanism through which remote data, local disk
data, and cache seeds may update visible resource state. This is a hard invariant
enforced by the module ownership pattern.

```
cache seed → TanStack query → applySnapshot → visible state
local disk  →              ↗
remote sync →              ↗
```

**Do not write visible resource state from:**
- Discovery flows (`*-discovery-flow.js`)
- Background sync handlers
- Tauri event listeners (emit events → query invalidation → query refetch → snapshot)

Every top-level resource (projects, glossaries, QA lists) follows the same pattern:

| Module | Owns |
|---|---|
| `*-flow.js` | User intent, screen loading, navigation cleanup |
| `*-query.js` | Query observer, cache boundary, `applySnapshot` to visible state |
| `*-discovery-flow.js` | Lower-level discovery; returns data, does NOT write state |

The discovery flow emits progress events (e.g. `localSnapshot`, `remoteSnapshot`,
`repoSyncProgress`) for intermediate feedback. Only the query layer applies those
to final visible state.

## Write Intents and Pending Mutations

User mutations (create, rename, delete, restore) are preserved across background
refreshes via **write intents**.

- `write-intent-coordinator.js` — tracks pending and running operations by scope/key
- `optimistic-collection.js` — `applyPendingMutations(snapshot, pending, applyFn)`
  applies pending mutations on top of every incoming snapshot

`applyPendingMutations` is called inside `*-query.js` snapshot handlers. It is NOT a
separate update queue — it is a pure function that layers write intents onto the most
recently fetched query data. This ensures renames/deletes do not visually revert
while the server catches up.

**Do not add a new parallel state channel** for optimistic updates. Write intents
through the coordinator and apply them in the snapshot handler.

## Permissions

The capabilities helper is `permissions.js`. It exports `deriveTeamCapabilities(team)`
and named predicates: `canWriteChapters(team)`, `canManageProjects(team)`, etc.

**Never add a new raw boolean flag** to a team record for a new action type.
Derive it from `membershipRole` in `permissions.js`. Role normalization rules:
- `owner` → Owner (full access)
- `admin` → Admin (content + resource management, no member/team management)
- `translator` / `member` / GitHub non-owner member → Translator (content write only)
- `viewer` / `read_only` / `readonly` → Viewer (read only)
- Unknown non-empty role → Translator (conservative fallback, not Owner/Admin)

## Editor Rules

### Scroll Preservation

Scroll state is expensive to restore correctly. Key rules:

- **Viewport MUST be preserved** across: first save, AI translate, filter clear, image
  uploads, row edits, and large structural changes.
- **Delayed viewport restores MUST be cancelled** when the user types or focuses an
  input field. Active user input takes precedence over a scheduled anchor restore.
- `translate-viewport.js` owns translate-flow viewport preservation.
  `scroll-state.js` owns general scroll position save/restore.

### Write Permission Queue

The editor uses a serialized write permission queue (`editor-write-permission.js`)
before submitting row saves. The queue ensures:
1. Team, installation, and project write access is checked before any save.
2. Concurrent save attempts are serialized, not dropped.
3. A soft-deleted or permission-denied resource produces a clear user-facing error.

**Do not invoke Tauri save commands directly from row input handlers.** Route through
the write permission guard.

### Virtualization

Rows are virtualized via TanStack Virtual Core. Critical invariants:

- Row DOM nodes are recycled — do not store references to row elements across renders.
- Row-level invalidation APIs (`editor-virtualization.js`) allow targeted re-renders
  without remounting the full list.
- `row_order_key` is a lexicographic string, not an integer. Sorting rows by this key
  is always lexicographic string comparison, never numeric. New key generation must
  produce strings that sort between the surrounding keys.

### Background Sync

The editor syncs with the remote repo on a 3-minute cadence and on manual refresh.
Sync may change row content on disk. Sync results flow through
`editor-background-sync.js` → conflict detection → `editor-conflict-resolution-flow.js`.

- Disjoint stale dirty rows (rows changed locally and remotely in non-overlapping ways)
  are auto-merged.
- Overlapping changes produce a conflict that the user must resolve manually.
- Sync MUST NOT remount the editor or reset cursor/scroll position.

## Anti-Patterns (CRITICAL)

### State Management

- **NEVER write directly to `state.projects`, `state.glossaries`, `state.qaLists`**
  from a discovery flow, background sync, or Tauri event listener. Use the query path.
- **NEVER add a hand-rolled mutation queue** for optimistic updates. Use
  `write-intent-coordinator.js` + `applyPendingMutations` in the snapshot handler.
- **NEVER check team identity inside a discovery flow** against a stale closure.
  The query layer checks team identity at snapshot application time.

### UI Responsiveness

- **NEVER disable Create, Add, Rename, or Delete actions** because a background
  refresh is running. Refresh state and action availability are independent.
- **NEVER show a full-page spinner** while a list refreshes in the background.
  Use badge-based progress indicators.

### Parity

- **NEVER add a capability to glossaries** without applying it to QA lists (and vice
  versa). These resources share a domain model. Drift between them creates bugs that
  are discovered late.

## Common Mistakes

### Team-Scoping

When seeding visible state from cache or local disk, always check that the cached
team key matches the currently selected team. Async loads initiated for team A may
complete while team B is selected — stale data MUST be discarded.

```js
// WRONG: no team guard
state.projects = cachedProjects;

// RIGHT: query snapshot handler checks team before applying
if (snapshot.teamId === state.selectedTeam?.id) {
  applyProjectsQuerySnapshotToState(snapshot, state);
}
```

### Module Naming

Test files mirror their subject: `project-flow.test.js` tests `project-flow.js`.
Source-test files (e.g. `*-source.test.js`) test DOM rendering behavior from a
fixture source. Do not mix unit and source-test concerns in one file.

## Pre-Commit Checklist

- [ ] `npm test` passes
- [ ] `npm run audit:unused` shows no regressions
- [ ] Background sync does not disable any user action buttons
- [ ] Scroll position preserved after the changed async operation
- [ ] If glossary changed: check QA list parity
