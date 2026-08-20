# Release 0.8.89

Date: 2026-08-20

## Contents

- Distinguish OpenAI credit exhaustion from temporary rate limits and show direct
  billing guidance in AI Settings and the editor assistant.
- Refresh shared team AI keys from team-metadata revisions without adding a broker
  check before ordinary AI actions.
- Retry an invalid team key only when authoritative metadata reports a newer key
  version.
- Classify Git HTTP/2 framing failures as connectivity failures.

## Local update steps

- [x] Bump version to 0.8.89 in package.json, package-lock.json, Cargo.toml,
      Cargo.lock, and tauri.conf.json.
- [x] Run version consistency, frontend, JavaScript/workflow, Rust, formatting, and
      diff checks.
- [x] Build the 0.8.89 desktop application.
- [x] Install and open the updated local application.

The macOS application bundle was built on external storage because the internal
disk did not meet the repository's free-space guard. The app bundle succeeded;
only optional DMG packaging failed on the external volume. The installed app was
locally signed and passed macOS bundle verification before it was opened.

## Publishing steps

- [ ] Publish the pending source changes through a pull request.
- [ ] Merge the pull request into `main`.
- [ ] Tag `v0.8.89`, push the tag, and verify the release workflow and updater
      metadata before offering 0.8.89 as an automatic update.
