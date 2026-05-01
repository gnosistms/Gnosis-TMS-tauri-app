# Fallback Branch Removal Impact Report

Date: 2026-05-01

## Summary

This report implements `plans/fallback-branch-impact-plan.md` against the current working tree.

Important baseline note: this was not run from a pristine tree. The working tree already contained the current fallback-cleanup edits for glossary layout reconciliation, the old manual editor virtualizer path, persistent-store legacy migration, and glossary broker route fallback. I treated that dirty tree as the baseline and did not revert those cleanup edits.

The highest-confidence remaining removal is `previews/downloads-redesign/`, which is a design/archive directory outside the app build. Temporarily removing it produced no Knip findings and did not affect the Vite build.

The browser/localStorage persistent-store fallback should stay while browser-mode development and Playwright tests are supported. Temporarily requiring the Tauri store loader did not affect static analysis or build output, but a browser smoke test failed until the fallback was restored.

The GitHub App Auth Test screen/actions from the older audit are already absent in this working tree, so there was no current branch left to disable.

## Baseline Command Results

Baseline `git status --short`:

```text
 M src-ui/app/editor-scroll-policy.js
 M src-ui/app/editor-virtual-list.js
 M src-ui/app/editor-virtualization-shared.js
 M src-ui/app/editor-virtualization.js
 M src-ui/app/editor-virtualization.test.js
 M src-ui/app/glossary-repo-flow.js
 M src-ui/app/persistent-store.js
 M tests/browser/editor-regression.spec.js
```

Baseline commands:

- `npm run audit:unused`: passed, no Knip findings.
- `npm test`: passed, 700/700.
- `npm run build`: passed. Vite emitted the existing chunk-size/dynamic-import warnings.
- `cargo test` in `src-tauri`: passed, 137/137.

Additional browser baseline after restoring the persistent-store experiment:

- `npx playwright test tests/browser/editor-regression.spec.js -g "mounting the editor fixture renders one translate action"`: passed, 1/1.

## Candidates Tested

### Download Redesign Preview Files

Temporary edit:

- Moved `previews/downloads-redesign/` out of the repo to `/private/tmp/gnosis-downloads-redesign-audit`.
- Restored it after the experiment.

Knip findings:

- `npm run audit:unused`: passed, no findings.

Tests/build:

- `npm run build`: passed.
- Full `npm test` was not rerun for this candidate because these files are static preview HTML/CSS outside the app/test import graph.
- `cargo test` was not rerun because no Rust/native code was touched.

Coverage notes:

- No frontend runtime coverage was collected for this directory because it is not part of the Vite/Tauri app runtime.
- `rg "downloads-redesign|option-2-premium"` finds only plan/audit references and files inside the preview directory.

Classification:

- `safe removal candidate`, assuming the product decision is that design archives do not belong in the repo.

### GitHub App Auth Test Screen And Actions

Temporary edit:

- None. The candidate from `plans/fallback-code-audit-report.md` is already absent in this working tree.

Knip findings:

- Baseline `npm run audit:unused` passed.
- `rg --files src-ui | rg 'github-app-test|github.*test'` found no matching screen/action files.
- `rg "githubAppTest|github-app-test|loadGithubAppTestConfig|GitHubAppTest"` found no current UI wiring.

Tests/build:

- Covered by baseline `npm test`, `npm run build`, and `cargo test`.

Coverage notes:

- Not applicable. The route/screen/action surface is no longer present.

Classification:

- Already removed or otherwise no longer present. No further action from this plan.

### Old Manual Editor Virtualizer Path

Temporary edit:

- None in this report run. The current working tree already contains the targeted refactor that removed the old manual virtualized engine while preserving `initializeEditorVirtualization` and the small-list/non-virtualized controller plumbing.

Knip findings:

- Baseline `npm run audit:unused` passed.
- Removed manual-engine helpers did not create unused static exports.

Tests/build:

- Baseline `npm test`: passed, 700/700.
- Baseline `npm run build`: passed.
- Focused Playwright checks previously run against the current cleanup passed for TanStack anchor stability and most row/image stability cases.
- Known browser failures remain in the wider editor regression suite and should not be treated as caused by this impact-report step.

Coverage notes:

- Browser coverage was represented by focused Playwright editor regression flows rather than a V8 coverage report.
- Large editor-list behavior remains routed through `createEditorVirtualListController(...)`.
- Small-list smoke and image-related editor checks passed after the manual path removal.

Classification:

- `safe removal candidate` already implemented in the current cleanup diff, with residual risk around the pre-existing row-height reconciliation browser failure.

### Disabled Glossary Visible-Layout Reconciliation Branch

Temporary edit:

- None in this report run. The current working tree already removed the fixed-false policy flag and inactive true branch.

Knip findings:

- Baseline `npm run audit:unused` passed.
- `rg "EDITOR_RECONCILES_GLOSSARY_VISIBLE_LAYOUT"` has no current references.

Tests/build:

- Baseline `npm test`: passed, 700/700.
- Baseline `npm run build`: passed.
- Focused editor/browser checks from the current cleanup confirmed glossary-visible sync still logs skipped layout reconciliation.

Coverage notes:

- Browser coverage was represented by focused Playwright editor regression flows rather than a V8 coverage report.

Classification:

- `safe removal candidate` already implemented in the current cleanup diff.

### Editor Regression Fixture And Debug Harness

Temporary edit:

- None. I did not disable this harness because current browser regression tests directly depend on `window.__gnosisDebug` and fixture mounting.

Knip findings:

- Baseline `npm run audit:unused` passed.
- Static references remain in `tests/browser/editor-regression.spec.js`, `src-ui/main.js`, `src-ui/app/editor-regression-fixture.js`, `src-ui/app/dev-runtime-flags.js`, and editor fixture tests.

Tests/build:

- Baseline `npm test`: passed.
- Browser smoke `mounting the editor fixture renders one translate action`: passed with the harness enabled.

Coverage notes:

- This path is heavily executed by the existing Playwright editor regression tests.
- It is inactive in normal production startup unless dev runtime flags or debug APIs are used, but it is active test infrastructure.

Classification:

- `not removable` while current browser regression coverage depends on it.
- Future product/security decision: consider gating `window.__gnosisDebug` more narrowly for production builds rather than deleting the harness.

### Persistent Store Legacy Migration And Browser Fallback

Temporary edit:

- The legacy migration branch is already removed in the current cleanup diff.
- For the remaining browser fallback, I temporarily changed `initializePersistentStorage()` to throw when `window.__TAURI__.store.load` is unavailable.
- Restored the browser fallback after the experiment.

Knip findings:

- `npm run audit:unused`: passed, no findings.

Tests/build:

- Focused cache/storage unit subset passed even with the fallback disabled:
  - `editor-ai-assistant-cache.test.js`
  - `editor-derived-glossary-cache.test.js`
  - `team-storage.test.js`
  - `member-cache.test.js`
  - `project-cache.test.js`
- `npm run build`: passed.
- Browser smoke failed while fallback was disabled:
  - `npx playwright test tests/browser/editor-regression.spec.js -g "mounting the editor fixture renders one translate action"`
  - Failure: the editor fixture mounted without the expected translate action UI, consistent with browser-mode startup being broken when the store loader is required.
- The same browser smoke passed after restoring the fallback.

Coverage notes:

- Browser fallback is active in Playwright/browser-mode startup where no Tauri store plugin is available.
- Packaged Tauri builds should still use `window.__TAURI__.store.load`, but browser fallback remains necessary for tests and local browser development.

Classification:

- `not removable` unless we intentionally drop browser-mode support or install a Tauri store mock for browser tests.
- Legacy migration itself is already removed from the current cleanup diff.

### Glossary Broker Route-Unavailable Fallback

Temporary edit:

- None in this report run. The current working tree already removed the route-unavailable local/metadata fallback after production broker route confirmation.

Knip findings:

- Baseline `npm run audit:unused` passed.
- Removed route-unavailable constants and branches did not create unused static exports.

Tests/build:

- Baseline `npm test`: passed, 700/700.
- Baseline `npm run build`: passed.

Coverage notes:

- This rare compatibility path was not covered by browser smoke flows.
- Earlier service confirmation showed the production broker responds on the glossary routes with authenticated JSON errors rather than route-missing behavior.

Classification:

- `safe removal candidate` already implemented in the current cleanup diff, contingent on no support requirement for older staged brokers.

## Candidates Not Tested And Why

- Team AI cached/local fallback: intentionally outside the initial candidate list for this plan and classified as resilience behavior in the previous audit.
- Updater compatible-release fallback: intentionally outside the initial candidate list and should remain.
- Broker environment default fallback: intentionally outside the initial candidate list and should remain.
- Project conflict recovery fallback: intentionally outside the initial candidate list and should remain.

## Recommended Removal Order

1. Remove `previews/downloads-redesign/` if design archives are not part of the product repository policy.
2. Keep the current cleanup diff for disabled glossary visible-layout reconciliation.
3. Keep the current cleanup diff for the manual editor virtualizer branch, but continue tracking the existing row-height reconciliation browser failure separately.
4. Keep the current cleanup diff for persistent-store legacy migration removal, but preserve browser/localStorage fallback.
5. Keep the current cleanup diff for glossary broker route-unavailable fallback removal, assuming production and supported staged brokers all expose glossary routes.
6. Do not remove the editor regression fixture/debug harness until browser regression tests no longer depend on it.

## Final Classification

- `safe removal candidate`: `previews/downloads-redesign/`.
- `safe removal candidate already implemented`: disabled glossary visible-layout reconciliation branch.
- `safe removal candidate already implemented`: old manual editor virtualizer path, with residual editor-layout risk tracked separately.
- `safe removal candidate already implemented`: glossary broker route-unavailable fallback.
- `partially removable`: persistent-store legacy migration is removed; browser/localStorage fallback is not removable today.
- `not removable`: editor regression fixture/debug harness.
- `already absent`: GitHub App Auth Test screen/actions.

