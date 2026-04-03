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

Long-term handling policy and incident response are documented in:

- `/Users/hans/Desktop/GnosisTMS/UPDATER_KEY_MANAGEMENT.md`

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

## macOS DMG file icon notes

There are two different macOS icon problems:

1. the mounted DMG volume icon / installer window
2. the Finder icon of the downloaded `.dmg` file itself

Do not confuse them.

### Mounted volume / installer window

This is handled through stock Tauri DMG config:

- `src-tauri/dmg/background.png`
- `src-tauri/tauri.conf.json`
- mounted volume icon via `icons/icon.icns`

Current source of truth for the rounded mac icon artwork:

- `/Users/hans/Desktop/GnosisTMS/src-tauri/icons/mac icon-iOS-Default-1024x1024@1x.png`

Sync command:

- `npm run icons:sync`

Sync script:

- `/Users/hans/Desktop/GnosisTMS/src-tauri/icons/sync-generated-icons.sh`

What it does:

- regenerates `icon.icns`
- regenerates `icon.ico`
- regenerates the standard Tauri PNG icon set
- regenerates the `android/` and `ios/` generated icon folders

Why this matters:

- mounted DMG volume icon uses `icon.icns`
- the installed mac app icon currently also comes from `icon.icns`
- Windows and other generated app icons come from the same synced output
- the release workflow now runs `npm run icons:sync` before building, so future releases do not depend on manually refreshing `icon.icns`

### Downloaded `.dmg` file icon

This required a separate workflow patch and a separate icon asset.

Current icon asset:

- `/Users/hans/Desktop/GnosisTMS/src-tauri/icons/mac icon-iOS-Default-1024x1024@1x.png`

Current helper script:

- `/Users/hans/Desktop/GnosisTMS/src-tauri/dmg/apply-dmg-file-icon.sh`

The working method is:

1. `sips -i` the flattened PNG
2. `DeRez -only icns` the PNG into a temporary resource file
3. `Rez -append` that icon resource into the final `.dmg`
4. `SetFile -a C` on the final `.dmg`

This was verified locally against a copied DMG before wiring it into GitHub Actions.

The important lesson:

- `.VolumeIcon.icns` only affects the mounted volume
- it does not give the downloaded `.dmg` file its own custom Finder icon
- the downloaded `.dmg` file icon now uses the same rounded PNG source asset as the generated app icons

### Release workflow order

For mac release jobs, the workflow now does this:

1. build/publish the release via `tauri-action`
2. patch each built mac `.dmg` with the custom file icon
3. re-sign the modified `.dmg`
4. re-notarize it
5. staple it
6. wrap the patched `.dmg` in a mac-created `.zip` with `ditto -c -k --sequesterRsrc`
7. delete the raw mac `.dmg` asset from the GitHub Release
8. upload the `.zip` instead with `gh release upload --clobber`

Why the zip is required:

- the raw `.dmg` loses its custom Finder icon when downloaded directly from GitHub Releases
- the mac-created `.zip` preserves the DMG's Finder metadata when the user extracts it with macOS tools
- command-line `unzip` does **not** preserve the icon; Archive Utility / Finder extraction does

If this ever breaks, inspect:

- `/Users/hans/Desktop/GnosisTMS/.github/workflows/release-tauri.yml`
- `/Users/hans/Desktop/GnosisTMS/src-tauri/dmg/apply-dmg-file-icon.sh`

## Notes

- The updater is release-only. Debug/dev builds return “no update”.
- The app currently surfaces update installation from the Teams screen header.
- After install, the app requests a restart.
