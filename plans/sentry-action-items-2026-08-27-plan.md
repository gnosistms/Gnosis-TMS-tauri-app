# Sentry Action Items — 2026-08-27

## Goal

Remediate the five actionable work items identified from the current unresolved
Sentry issue list, while preserving expected user-facing behavior and reducing
non-defect telemetry noise.

## Workstreams

1. **Persistent store recovery (JAVASCRIPT-1Q)**
   - Ensure a failed stale-resource handle reload can be retried by later writes.
   - Preserve the in-memory authoritative snapshot and avoid retry storms.
   - Add focused recovery and persistence tests.

2. **Read-only team AI guard (JAVASCRIPT-2V)**
   - Prevent viewer accounts from loading or refreshing shared provider caches.
   - Preserve owner/admin/translator behavior and user-facing read-only behavior.
   - Add focused team-AI flow tests.

3. **Signed-out installation resource query (JAVASCRIPT-2S/2T)**
   - Prevent expected missing-session control flow from becoming Sentry defects.
   - Keep authentication-expiry recovery and visible signed-out UX intact.
   - Add query/runtime reporting tests.

4. **Windows local-repository discovery race (JAVASCRIPT-2W/2X)**
   - Remove or safely handle the probe/read time-of-check gap during local repo
     discovery and repair inspection.
   - Preserve bundled-Git error reporting and avoid destructive recovery.
   - Add Rust regression coverage for disappearing or invalid repositories.

5. **Updater response-body failure (JAVASCRIPT-1V)**
   - Add bounded recovery for transient updater download/response failures.
   - Preserve signature verification and forced-update behavior.
   - Improve diagnostics and add focused updater tests.

## Verification

- Run focused tests for each workstream as it lands.
- Run the combined relevant frontend and Rust test sets after integration.
- Review the final diff for cross-workstream overlap and scope discipline.
- Do not change Sentry issue state until fixes are verified.
