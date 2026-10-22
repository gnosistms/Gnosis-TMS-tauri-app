# Session recovery for native actions

1. Add a shared native command-entry access gate that marks only authentication
   failures occurring before the action as safe to retry. Use it for tokenless
   chapter/editor/import, glossary, QA and other native actions found by the audit.
   Preserve commit-time checks and distinguish partial/failed rollback outcomes.
2. Teach the invoke boundary to recover marked failures using the current saved
   session, preserving identity/team checks, one refresh, durable persistence,
   concurrent refresh sharing and original command payloads.
3. Add cross-stack coverage that discovers access-gated native commands from Rust
   sources and exercises their refresh contract; fail when a new tokenless command
   bypasses the shared gate. Add backend tests proving failed preflight never runs
   the operation and non-auth/late failures cannot acquire retry permission.
4. Verify representative editor/import/glossary/QA actions and negative cases; run
   focused backend/frontend suites, full frontend tests, build and unused audit.

Status: complete.

Implementation: command-entry access checks now return an explicit safe-to-retry
authentication marker. The invoke boundary refreshes and persists the current login
before replaying that unchanged action once, with existing identity/team guards.
Removed the frontend native-command allowlist; unmarked late authentication errors,
failed rollbacks, permission errors and storage failures cannot trigger replay.

The cross-stack audit discovers 86 access-gated commands (59 native-session and 27
explicit-token commands), follows helper calls and named trait access methods, and
verifies each native entry gate precedes work. Runtime tests derive their command
cases and error marker from the Rust sources. Synthetic future commands prove
uncovered access checks are detected and properly gated ones recover without a JS
registry. A separately checked best-effort word-count backfill preserves offline
editor reads. Concurrency tests verify editor and QA actions share one saved refresh.

Verification: 2,651 frontend tests, all 828 enabled backend tests (8 existing ignored
tests), and 25 workflow tests pass. Mock-server/launcher tests needed local socket
and process access after the sandbox rejected their fixture servers. Production
build, focused ESLint, focused Rust formatting and whitespace checks pass. The
unused-code audit remains at the existing 345 files and 26 exports.
