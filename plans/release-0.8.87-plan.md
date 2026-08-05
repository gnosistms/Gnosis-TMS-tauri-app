# Release 0.8.87 plan

Date: 2026-08-04

## Scope

- Preserve straight ASCII quotation marks inside raw HTML tag attributes during
  editor smart-quote normalization.
- Continue converting quotation marks in visible prose between raw HTML tags.
- Publish the fix as Gnosis TMS 0.8.87.

## Release path

At the owner's request, this hotfix is committed and pushed directly to `main`
without a pull request. The tag is pushed without waiting for the push-triggered
quality workflow; the workflow remains enabled and runs normally in parallel.

## Checklist

- [x] Add focused regression tests for raw HTML attributes and visible prose.
- [x] Run the JavaScript and workflow test suite.
- [x] Update all application manifests and lockfiles to 0.8.87.
- [x] Run JavaScript lint, version consistency checks, and `git diff --check`.
- [ ] Commit and push directly to `main`.
- [ ] Tag `v0.8.87` and push the tag.
- [ ] Confirm the release workflow starts for all configured platforms.

## Verification

- `npm test`: passed (1,924 JavaScript tests and 9 workflow tests).
- `node --test src-ui/app/smart-quotes.test.js`: passed (19 tests).
- `npm run lint:js`: passed with zero errors and 67 existing warnings.
- Version consistency and `git diff --check`: passed.
