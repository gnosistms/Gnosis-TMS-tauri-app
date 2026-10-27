# Simplify WordPress export actions

Normal export validates cached WordPress media and resolves missing references.
Remove the separate image-refresh action from the dialog to reduce clutter.

1. Remove the refresh button and its visibility condition from the renderer.
2. Remove its unused click handler and update the existing modal expectations.
3. Run frontend tests and the unused-code audit.

The normal export flow and backend image handling remain unchanged.

Completed all three steps. Validation: 2,124 frontend tests and 19 workflow tests
passed on the initial run. Four launcher tests required localhost access and
passed when rerun outside the sandbox. The unused-code audit has the same nine
pre-existing findings (three files, five imports, one export); no regressions.
