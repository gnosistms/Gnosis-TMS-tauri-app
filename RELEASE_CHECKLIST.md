# Release Checklist

Before shipping a public build of Gnosis TMS:

1. Remove any real values from [src-tauri/src/insecure_github_app_config.rs](/Users/hans/Desktop/GnosisTMS/src-tauri/src/insecure_github_app_config.rs).
2. Make sure GitHub App credentials are loaded from a secure backend service instead of the desktop app binary.
3. Confirm no GitHub private keys, client secrets, or test credentials are committed anywhere in the repository.
4. Build a fresh release artifact after removing the insecure fallback path.

The hard-coded GitHub App fallback exists only for internal testing and should never be used for a public release.
