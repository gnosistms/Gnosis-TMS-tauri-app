# Secret Inventory

This file tracks the durable secret inventory for Gnosis TMS and the GitHub App broker.

It intentionally does not contain actual secret values.

## Primary recovery source

If these secrets are lost from DigitalOcean or GitHub Actions, the primary recovery source is Apple Passwords.

Current Apple Passwords entries:

- `Gnosis TMS Tauri Updater Key`
- `Gnosis TMS GitHub App Private Key`
- `Gnosis TMS GitHub App Client Secret`
- `Gnosis TMS Broker State Secret`

## Status summary

Current status as of 2026-04-02:

1. Tauri updater key has already been stored in Apple Passwords.
2. GitHub App private key has been regenerated, stored in Apple Passwords, deployed to DigitalOcean, and old GitHub App private keys were deleted after verification.
3. GitHub App client secret has been regenerated, stored in Apple Passwords, deployed to DigitalOcean, and old GitHub client secret was deleted after verification.
4. Broker state secret has been regenerated, stored in Apple Passwords, and deployed to DigitalOcean.

## App repo secrets

### 1. Tauri updater signing key

Purpose:

- signs Tauri updater release artifacts

Stored in GitHub Actions as:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

Local temporary path:

- `/Users/hans/Desktop/GnosisTMS/.gnosis-tms/secrets/tauri-updater.key`

Apple Passwords entry:

- `Gnosis TMS Tauri Updater Key`

Status:

- stored in Apple Passwords
- GitHub Actions secrets configured
- local file should be deleted after secure backup is confirmed

## Broker secrets

Broker repo:

- `/Users/hans/Desktop/gnosis-tms-github-app-broker`

Defined in:

- `/Users/hans/Desktop/gnosis-tms-github-app-broker/src/config.js`

### 2. GitHub App private key

Env var:

- `GITHUB_APP_PRIVATE_KEY`

Purpose:

- allows the broker to authenticate as the GitHub App

Apple Passwords entry:

- `Gnosis TMS GitHub App Private Key`

How to store it:

- if you have the plaintext key, paste the full key block into the Notes field
- if the plaintext is not recoverable because DigitalOcean only stores a masked secret, generate a new GitHub App private key in GitHub, store it immediately, then update DigitalOcean

Status:

- complete
- regenerated from GitHub because the previous plaintext key was not recoverable from DigitalOcean
- stored in Apple Passwords
- deployed to DigitalOcean
- broker verified healthy before deleting the older GitHub App private keys

### 3. GitHub App client secret

Env var:

- `GITHUB_APP_CLIENT_SECRET`

Purpose:

- GitHub App OAuth/auth flow

Apple Passwords entry:

- `Gnosis TMS GitHub App Client Secret`

How to store it:

- store the secret string in the Password field

Status:

- complete
- stored in Apple Passwords
- deployed to DigitalOcean
- old GitHub client secret removed after verification

### 4. Broker state secret

Env var:

- `BROKER_STATE_SECRET`

Purpose:

- protects broker auth state/callback flow

Apple Passwords entry:

- `Gnosis TMS Broker State Secret`

How to store it:

- store the secret string in the Password field

Status:

- complete
- regenerated as a new random secret
- stored in Apple Passwords
- deployed to DigitalOcean

## Reference-only broker config

These are important operational values but not sensitive in the same way:

- `GITHUB_APP_ID`
- `GITHUB_APP_SLUG`
- `GITHUB_APP_CLIENT_ID`

Recommended Apple Passwords entry:

- `Gnosis TMS GitHub App Config`

Store them in Notes for recovery/reference.

## Retrieval notes

### DigitalOcean limitation

If a secret is stored in DigitalOcean App Platform as a masked/encrypted secret, you may not be able to reveal the plaintext later in the UI.

Implication:

- `GITHUB_APP_PRIVATE_KEY` may need to be regenerated in GitHub if you do not have another plaintext copy

### GitHub App private key recovery

If the private key is not recoverable:

1. Open the GitHub App settings.
2. Generate a new private key.
3. Store it immediately in Apple Passwords.
4. Update DigitalOcean `GITHUB_APP_PRIVATE_KEY`.
5. Redeploy the broker if required.

This is acceptable and does not have the same reinstall risk as rotating the Tauri updater key.

### Which values can be re-found in GitHub

These can be re-found in GitHub App settings:

- `GITHUB_APP_ID`
- `GITHUB_APP_SLUG`
- `GITHUB_APP_CLIENT_ID`

These cannot be reliably recovered later just by looking in GitHub:

- `GITHUB_APP_PRIVATE_KEY`
- `GITHUB_APP_CLIENT_SECRET`
- `BROKER_STATE_SECRET`

Meaning:

- if they are lost from deployment config, recover them from Apple Passwords
- if they are not in Apple Passwords, they must be rotated/regenerated

## Do not store as permanent vault secrets

These should not be treated as long-term vault secrets:

- random short-lived GitHub user access tokens
- desktop session tokens
- temporary callback/session state

Those can normally be re-created by logging in again.
