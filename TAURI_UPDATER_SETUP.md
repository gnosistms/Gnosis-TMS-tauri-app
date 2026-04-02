# Tauri Updater Setup

This app is configured to publish signed release updates through GitHub Releases.

## Supported release platforms

- macOS Apple Silicon (`aarch64-apple-darwin`)
- macOS Intel (`x86_64-apple-darwin`)
- Windows (`windows-x86_64`)

## Release feed

The packaged release app checks:

- `https://github.com/gnosistms/Gnosis-TMS-tauri-app/releases/latest/download/latest.json`

Local dev (`npm run tauri:dev`) does not use the updater.

## Updater keys

The public key is embedded in:

- `src-tauri/updater-public-key.txt`

The matching private key must never be committed. Store it in GitHub Actions secrets:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

Local secure key path on this machine:

- `.gnosis-tms/secrets/tauri-updater.key`

The original generated `/private/tmp/gnosis-tms-updater.key` copy should be removed after moving it to the local secure path and storing it in GitHub Actions secrets / your password manager.

## Publishing a release

1. Update the app version in:
   - `package.json`
   - `src-tauri/Cargo.toml`
   - `src-tauri/tauri.conf.json`
2. Commit the version bump.
3. Create and push a tag like `v0.1.1`.
4. GitHub Actions runs [.github/workflows/release-tauri.yml](/Users/hans/Desktop/GnosisTMS/.github/workflows/release-tauri.yml).
5. The workflow builds signed updater artifacts for macOS and Windows and uploads them to GitHub Releases.
6. The Tauri GitHub Action generates the merged `latest.json` used by the updater across supported platforms.

## GitHub workflow

The release workflow:

- installs dependencies
- builds and publishes release artifacts through `tauri-apps/tauri-action`
- targets:
  - macOS Apple Silicon
  - macOS Intel
  - Windows
- generates a single merged `latest.json` for the updater feed

## Notes

- The updater is release-only. Debug/dev builds return “no update”.
- The app currently surfaces update installation from the Teams screen header.
- After install, the app requests a restart.
