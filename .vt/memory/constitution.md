<!--
SYNC IMPACT REPORT
  Version change: (new) -> 1.0.0 (constitution.md)
  Modified: (initial instantiation)
  Added: Standards I–V, Technical Standards, Anti-Rationalization Guardrails
         (including F-VIII guardrail for deterministic Stronghold key)
  Removed: (none — new document)
  Companion impact: foundational-principles.md deferred TODO for constitution
    instantiation is now resolved. Sync Impact Report in that file should be
    updated to remove the deferred TODO.
  Template updates:
    - plan-template.md: Constitution Check gate updated to reference live path
    - spec-template.md: no change needed
    - tasks-template.md: no change needed
  Deferred TODOs: (none)
-->
# Gnosis TMS Constitution

This constitution defines the development standards and workflow that govern all code
changes for Gnosis TMS. It is enforced at quality gates throughout the spec-driven
development process.

For the architectural philosophy and product principles that guide strategic and design
decisions, see the companion document:
[`foundational-principles.md`](foundational-principles.md).

**Version**: 1.0.0
**Ratified**: 2026-06-03
**Last Amended**: 2026-06-03

---

## Architectural Alignment

Architectural and design decisions MUST align with the [Foundational
Principles](foundational-principles.md). When a specification introduces any of the
following, the foundational principles apply and MUST be evaluated during the
specification phase (via the `architect` agent):

- New data persistence mechanism or storage backend (F-I, F-II, F-VIII)
- New external service dependency or authentication mechanism (F-II, F-VIII)
- New native OS integration or platform-specific code path (F-III)
- Any new JavaScript runtime dependency or build-time framework (F-IV)
- New mechanism for propagating optimistic or remote state to visible UI (F-V)
- Any change to the authentication flow, session storage, or secret storage (F-VIII)

Routine feature work that operates within established architectural patterns does not
require foundational principle review.

---

## Development Standards

These standards govern day-to-day development and are enforced at every quality gate.

### I. State Management Boundary

All async data — remote sync results, local disk reads, cache seeds — MUST flow
through TanStack Query Core before reaching visible resource state
(`state.projects`, `state.glossaries`, `state.qaLists`). No module below the
query boundary may write to these collections directly.

- Discovery flows (`*-discovery-flow.js`) MUST NOT write to visible resource
  state directly. They publish snapshots via injected query-layer callbacks only.
- Tauri event listeners MUST trigger query invalidation, not direct state writes.
- `applyPendingMutations` MUST be called in every `*-query.js` snapshot handler
  to layer pending write intents on top of incoming data.
- Editor session state (`state.editorChapter`) is explicitly excluded — direct
  mutation inside editor modules is correct for that scope.

**Rationale**: State written around the side of the query cache creates stuck-state
bugs that are hard to reproduce and impossible to reason about. A single cache path
makes every update traceable.

### II. Write Access Enforcement

Before any mutation to a project, glossary, or QA list repository, write access MUST
be verified against the GitHub App installation via `installation_access.rs`.

- `ensure_repo_allows_writes` MUST be called inside the shared commit helper
  (`git_commit_as_signed_in_user_with_metadata`), not optionally in command bodies.
- `ensure_installation_allows_*` MUST be called in `team_metadata_local.rs` command
  bodies for resource management operations (create/rename/delete).
- Write access MUST never be assumed from login state alone — a signed-in user can
  have a GitHub App installation in a degraded permission state.
- The write gate MUST be fail-closed: when broker session or installation data is
  absent or unreadable, the gate MUST return an error, not `Ok(())`.

**Rationale**: GitHub App installations can be revoked, downgraded, or partially
suspended at any time. Skipping the write gate silently corrupts shared repositories.

### III. Module Ownership Pattern

Each top-level resource domain (projects, glossaries, QA lists) MUST maintain a
strict three-way ownership split:

| Module type | Owns | Must not |
|-------------|------|----------|
| `*-flow.js` | User intent, screen entry points, navigation cleanup | Manage query cache directly |
| `*-query.js` | Query observer, snapshot application, cache boundary | Accept user input or navigate |
| `*-discovery-flow.js` | Lower-level data loading; emits via injected callbacks | Write visible state outside callbacks |

- New feature work MUST be placed in the module that owns its concern.
- Query cache management MUST NOT appear in flow files.
- Direct visible state writes MUST NOT appear in discovery flows outside injected
  query-layer publisher callbacks.

**Rationale**: Module boundary violations create coupling that turns background sync
bugs into foreground state corruption bugs. The pattern exists because past violations
produced exactly this failure mode.

### IV. Glossary / QA List Parity

Any capability, fix, or behavioral change applied to glossaries MUST also be applied
to QA lists, and vice versa. These resources share a domain model and MUST track
each other.

- A PR that changes glossary behavior without the equivalent QA list change is
  incomplete and MUST NOT be merged.
- Parity violations are not deferred — they are required changes in the same PR.

**Rationale**: Glossaries and QA lists diverge silently. By the time divergence is
noticed, both sides have accumulated incompatible assumptions that are expensive to
reconcile.

### V. IPC Non-Blocking

Tauri commands MUST NOT block the IPC call path on long-running git, network, or
file-system operations.

- Commands that initiate long-running work MUST return immediately with a job ID or
  status code, and emit progress via Tauri events (`callbacks.rs`).
- Background sync MUST NOT disable user-facing actions (Add, Create, Rename, Delete)
  while running. Sync state and action availability are independent.
- Blocking I/O in async contexts MUST be spawned via `tauri::async_runtime::spawn_blocking`.

**Rationale**: The JS frontend queues IPC calls on the main thread. A blocked command
freezes the entire UI. Long-running work has always had an event-based progress model;
this standard makes that explicit.

---

## Technical Standards

### Code Quality Gates

| Gate | Requirement | Command |
|------|-------------|---------|
| Rust unit tests | All tests passing | `cargo test` |
| JS unit tests | All tests passing (9 pre-existing Node 22 failures in navigator compat are exempt — tracked in issue #2) | `npm test` |
| Unused exports | No new regressions | `npm run audit:unused` |

### Architectural Constraints

- **No UI framework**: React, Vue, Svelte, and equivalent runtime component frameworks
  MUST NOT be introduced (F-IV).
- **No new raw boolean permission flags**: new action types derive capabilities from
  `membershipRole` in `permissions.js`, never from added boolean fields.
- **No direct filesystem access from JS**: all file, git, and native operations MUST
  go through `invoke()` to a Tauri command.
- **Cross-platform path handling**: git history paths MAY contain Windows backslashes.
  Any code comparing or storing paths MUST normalize separators explicitly.

---

## Anti-Rationalization Guardrails

These guardrails document rationalization patterns that appear reasonable on the
surface but violate a foundational principle or accepted design decision. Each
entry pre-counters a specific circumvention pattern observed in development or
code review.

| Rationalization | Why It's Invalid | Enforcement |
|-----------------|------------------|-------------|
| "The deterministic Stronghold key can be derived from known inputs — it should be replaced with a randomly-generated key stored in the OS credential store (Keychain/Secret Service/Credential Manager)" | F-VIII explicitly accepts this limitation. At-rest confidentiality against a local filesystem attacker is outside the product's threat model. OS keychain integration creates platform-specific code paths, daemon dependencies, and test complications that are not justified by the security benefit. The `keyring` crate MUST NOT be reintroduced. | Reject the finding at spec review; cite F-VIII. |
| "The broker session bearer token should not be stored in plain JSON — move it to the OS credential store" | Same as above. The session token's at-rest exposure to a local attacker is accepted per F-VIII. Plain JSON storage is the intended design. | Reject the finding; cite F-VIII. |
| "Background sync is running — disable the Add/Create/Rename/Delete buttons to prevent concurrent operations" | Violates Standard V and F-I. Sync state and action availability are independent. Disabling actions during sync imposes network latency on user interactions that must be instantaneous. | Reject the change at review; point to Standard V. |
| "This discovery flow needs to update visible state directly for performance — going through the query cache adds a round-trip" | Violates Standard I. The query cache is not a round-trip penalty; it is the boundary that makes state traceable. Direct writes create stuck-state bugs that outlast the performance win. | Reject the change at review; point to Standard I. |

---

## Continuous Improvement via Self-Reflection

### When to Write Reflections

- Missing or unclear guidance caused delays or wrong turns
- Discovered patterns worth documenting
- Found mistakes or anti-patterns to avoid
- A guardrail was needed but absent — causing a finding to recur

### How to Write Reflections

Write reflection files to `.vt/reflections/` using the standard frontmatter format.
Run `/vt.reflect` to review and apply accumulated reflections. Reflections that
represent settled decisions may be elevated to Development Standards or
Anti-Rationalization Guardrails here, or (rarely) to Foundational Principles.

---

## Governance

### Amendment Procedure

1. **Proposal**: Any team member may propose amendments.
2. **Review**: Amendments require review and approval.
3. **Routing**: Determine which document the change belongs in:
   - Architectural philosophy, product values, threat model → `foundational-principles.md`
   - Development standards, enforcement rules, guardrails → this constitution
4. **Versioning**: Changes increment version per semantic versioning:
   - MAJOR: Backward-incompatible changes to standards or enforcement
   - MINOR: New standard added or guardrail added
   - PATCH: Clarifications and typo fixes
5. **Propagation**: Amended standards cascade to dependent templates.

### Compliance Review

- All plans MUST pass Constitution Check before research begins.
- Violations require explicit justification.
- Specifications that match trigger conditions in Architectural Alignment MUST be
  reviewed against Foundational Principles before planning proceeds.
- Security review findings that target storage or authentication MUST be checked
  against F-VIII before being classified as valid findings.

### Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-06-03 | Initial instantiation. Standards I–V, Technical Standards, Anti-Rationalization Guardrails including F-VIII (deterministic Stronghold key, broker session token plain JSON). |

---

## Dependent Templates

The following documents reference this constitution and MUST be updated when standards
change:

- `.vt/memory/foundational-principles.md` — Architectural Alignment references
- `$HOME/.claude/vt/templates/plan-template.md` — Constitution Check section
- `$HOME/.claude/vt/templates/spec-template.md` — Applicable Conventions
- `$HOME/.claude/vt/templates/tasks-template.md` — Task categorization

---

_This constitution governs development standards. The
[Foundational Principles](foundational-principles.md) govern this constitution.
Standards that conflict with principles are invalid — they must be rejected or
accompanied by a foundational principles amendment._
