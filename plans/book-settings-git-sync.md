# Save project export settings in Git

1. Introduce a versioned, portable `.gtms/export-settings.json` document with
   settings per language. Keep local screen selection/cache/job state and machine
   image paths out of Git; include referenced publisher/section images under
   `.gtms/export-images/`. Reuse existing permission, signed-commit, Git transport,
   repo lock and write-queue infrastructure.
2. Seed page 1 immediately from local settings on every entry, including Back.
   Read the disk cache and fetch remote settings in the background. Compare only
   the currently selected language's effective export settings. Merge other
   languages quietly; require the specified single-Ok notice before replacing a
   differing selected-language layout. Fence stale project/team/account/session
   results and preserve the selected language.
3. Save when leaving page 1 through Next, Cancel, Escape or backdrop dismissal.
   Keep local changes durable immediately, then commit/sync in the background.
   Resolve concurrent settings changes per language with remote winning conflicts;
   teach normal project rebase recovery the same settings-only policy. Do not
   change conflict handling for source content or force-push project history.
4. Validate portable schema/assets, use the existing SVG/image checks, hydrate
   local image references, and preserve offline local settings on network failure.
5. Test lifecycle transitions, delayed/stale results, selected/other-language
   comparisons and acknowledgement, persistence, offline/error paths, asset
   portability and real local Git conflict scenarios. Run applicable checks,
   update the running dev app/backend and PR 384.

Implemented:
- Shared scope is page 1 only, including paper size. Format/destination choices
  stay local; they are neither compared with GitHub nor overwritten by it.
- Local-first entries and background jobs are fenced by account, team, project
  and modal entry. A new entry waits for pending saves before its remote fetch.
  Late saves preserve a newer draft. A corrupt local image can recover remotely.
- The exact requested acknowledgement appears only for the selected language;
  other languages update quietly. Derived titles and navigation do not conflict.
- Settings and referenced original/prepared images are versioned in the project
  repo. Documents contain no machine paths or credentials. Assets are validated,
  content-addressed, protected against symlink paths, and kept byte-stable on
  Windows via folder attributes. New files are staged and failed writes roll back.
- Canonical single-line JSON sends concurrent edits through the semantic
  per-language resolver even when Git could otherwise combine different fields.
  Remote wins overlapping language changes and deletion; source-content conflict
  handling remains unchanged. Commit/sync jobs reuse existing gates and queues.

Verification:
- 3,093 frontend unit/screen tests and 25 workflow tests passed; production build
  and changed-module ESLint passed. Unused-code audit retains the pre-existing
  baseline of 41 files / 16 exports, with no new settings entries.
- All 26 export browser workflows passed on a fresh server. The five new settings
  workflows also passed against the running dev checkout.
- Six native settings/schema/image/transaction tests passed, plus all 28 project
  repository tests. Real Git covers new-file commits, rollback, remote deletion
  and per-language remote-wins rebase resolution.
- Strict all-target Clippy, Rust formatting and whitespace checks passed.
- Scoped changes are mirrored into the dev checkout, preserving its unrelated
  work. The native dev backend rebuilt and relaunched successfully.
