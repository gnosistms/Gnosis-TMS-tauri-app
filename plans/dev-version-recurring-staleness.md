# Prevent recurring stale development versions

The Applications launcher forces the stale-version bypass and disables verified
metadata repair. Releases made in other worktrees consequently leave the main
development checkout reporting an older native version indefinitely.

1. Make normal development startup refresh release refs and automatically repair
   metadata only after verifying the released source/configuration is present.
   Remove the personal launcher's forced bypass; retain explicit old-version testing.
2. Add regression coverage for the launcher, release discovery, offline startup,
   verified repair, and rejection of missing release code. Document the workflow.
3. Audit and integrate the missing v0.8.136 changes into this working checkout,
   preserving local edits with backups and three-way reconciliation. Synchronize
   version metadata only after verification, run relevant checks, and rebuild the
   native development app.

The repository compatibility check remains enabled. Source conflicts must be
resolved explicitly; startup must never invent compatibility by changing only
the version label or silently replacing feature work.
