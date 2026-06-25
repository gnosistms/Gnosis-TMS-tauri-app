# Release 0.8.49

Patch release after `v0.8.48`.

## Included since 0.8.48

- Editor: add the custom HTML row style and keep native undo working while
  editing custom HTML textareas.
- Editor: move the custom HTML style control after centered text and expand the
  style toolbar row to match the textarea width.
- Export: preserve per-chapter WordPress overwrite defaults after switching to
  another export option.
- App shell: increase the default app window width to 1485.
- CI: add the gitleaks secret-scan gate to the quality workflow.

## Pre-tag verification

- `npm test`
- `npm run format:rust:check`
- `npm run test:rust`

## Steps

1. Bump version to 0.8.49 across the release files
   (package.json, package-lock.json, src-tauri/Cargo.toml, src-tauri/Cargo.lock,
   src-tauri/tauri.conf.json).
2. Commit "Release 0.8.49", tag v0.8.49, push main + tag.
3. Let GitHub run release-tauri.yml and publish the release assets.
