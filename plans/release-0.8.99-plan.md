# Release 0.8.99

Date: 2026-09-03

## Goal

Publish all changes merged since `v0.8.98` as the next patch release for macOS
(Apple silicon and Intel) and Windows.

## Included changes

- Glossary matcher policy v2: quotes, dots, and hyphens are match tokens
  instead of separators in both runtimes, so a quoted surface (`el "Yo"`),
  a dotted abbreviation (`I.A.O.`), and a hyphenated term
  (`auto-realización`) are distinct from their bare forms. All quote styles
  (straight, curly, guillemets, CJK corner brackets) normalize to one token;
  `...` equals `…`; hyphen equals en dash. See
  `plans/glossary-punctuation-tokens-plan.md`.
- Cached derived glossary entries regenerate under the new tokenizer via the
  matcher policy version in the revision key.

## Release steps

- [x] Confirm `v0.8.98` is the latest stable release and `main` is clean.
- [x] Audit merged changes: PR #285 is the only change since `v0.8.98`.
- [x] Bump package, Cargo, Tauri, lockfile, and bundled notice metadata to
  `0.8.99`.
- [x] Run frontend, workflow, Rust, formatting, lint, and diff-integrity checks.
- [ ] Publish and merge the release pull request after all required checks pass.
- [ ] Create and push annotated tag `v0.8.99` from the merged release commit.
- [ ] Confirm the release workflow succeeds on macOS arm64, macOS x64, and
  Windows.
- [ ] Verify the stable GitHub Release contains signed installers, updater
  archives, signatures, and `latest.json` identifying version `0.8.99`.

## Verification

- `npm test`
- `npm run lint:js`
- `npm run format:rust:check`
- `npm run test:rust`
- `git diff --check`
