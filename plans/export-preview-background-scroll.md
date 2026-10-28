# Preserve export preview during project refresh

The projects background renderer fingerprints the entire exported project, so
local chapter summaries and other discovery metadata can replace an unchanged
export dialog and reset its preview scroll position.

1. Compare the export dialog's rendered output rather than the project record.
   Retain the mounted backdrop when its output and team/session context match.
2. Keep that comparison current after scoped book preview/redundancy updates and
   direct field edits, without consuming a pending projects-page refresh.
3. Add browser regression coverage for same-project metadata updates while a long
   chapter preview is scrolled, including a scoped preview update during sync.
   Verify actual dialog changes still render and project updates still appear.
4. Run the relevant unit/browser tests, frontend suite, and unused-export audit.

Completed. The comparison now follows rendered dialog content and records scoped
updates plus direct field edits. The browser regression reproduced both scroll
panes resetting to zero and text selection disappearing before the fix; it now
verifies retained DOM, scroll, selection, project-list updates, and genuine modal
error updates.

Validation: all 3,225 frontend tests and 26 workflow tests pass; all 64 export and
projects-page browser tests pass in installed Chrome on macOS. Build, focused lint,
and diff whitespace checks pass. The unused-code audit reports unrelated existing
files/exports, with none of the changed exports flagged. Browser and launcher
tests require local-server access outside the filesystem sandbox.
