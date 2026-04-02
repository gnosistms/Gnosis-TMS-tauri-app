# Updater Key Management

This document defines the long-term handling process for the Tauri updater signing key.

## Why this matters

The updater private key signs release artifacts.

Installed apps trust the matching public key embedded in:

- `/Users/hans/Desktop/GnosisTMS/src-tauri/updater-public-key.txt`

Current app wiring loads that public key directly in:

- `/Users/hans/Desktop/GnosisTMS/src-tauri/src/lib.rs`

That means:

- if the private key is stolen, an attacker could sign malicious updates
- if the private key must be rotated, existing installed apps may no longer trust future updates
- in the worst case, existing users may need a manual reinstall

## Current design constraint

Today the updater trust root is a single embedded public key.

Because of that, a private-key compromise is not a simple secret rotation. It is potentially a distribution incident.

## Long-term operating policy

Use this policy for all future release work.

### 1. Source of truth

The updater private key should have one canonical home:

- a password manager or secrets vault controlled by the business

Good examples:

- 1Password
- Bitwarden
- Dashlane
- a company secrets vault

Do not treat GitHub Actions as the only source of truth.

### 2. Access control

Limit access to the private key to the smallest possible set of humans.

Target policy:

- 2 trusted admins maximum
- no broad team sharing
- no plaintext sharing in chat, email, notes, or docs

### 3. Local machine policy

Developer laptops should not keep a long-lived copy of the private key.

Allowed:

- temporary local copy during setup or emergency release work

Required after setup:

- move the key into the password manager / vault
- verify GitHub Actions secrets are correct
- delete the local filesystem copy

Current temporary local path on this machine:

- `/Users/hans/Desktop/GnosisTMS/.gnosis-tms/secrets/tauri-updater.key`

That path is gitignored, but it should still be treated as temporary.

### 4. GitHub Actions policy

The release workflow currently reads:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

from GitHub Actions secrets in:

- `/Users/hans/Desktop/GnosisTMS/.github/workflows/release-tauri.yml`

Preferred GitHub setup:

- move release signing secrets to a dedicated GitHub Environment such as `release`
- require manual approval for that environment
- allow only trusted admins to approve release jobs

This reduces the blast radius of a repo compromise or accidental workflow execution.

### 5. Rotation expectations

Treat key rotation as a product event, not a routine secret change.

Reason:

- existing installed apps trust the old embedded public key
- a new private key implies a new public key
- old installed apps cannot automatically trust updates signed only by the new key

### 6. Recovery storage

Keep one backup copy of the private key in a second secure location, separate from the primary vault.

Examples:

- encrypted vault backup
- secure admin password manager account with recovery access

Do not keep the only backup on one laptop.

## Recommended steady-state setup

This is the target state we should operate under:

1. Private key stored in password manager / vault.
2. Backup stored in separate secure recovery location.
3. GitHub Actions stores only the current release copy as secrets.
4. No persistent local developer copy.
5. Release workflow uses a protected GitHub Environment for access to secrets.

## Incident categories

### A. Laptop stolen, but disk encryption and account security remain intact

If the key was not stored locally, there is likely no updater-key incident.

Action:

- revoke GitHub session tokens
- review GitHub account access
- verify Actions secrets were not exposed

### B. Laptop stolen and local updater key may have been exposed

Assume updater private key compromise if the key existed locally and device trust is uncertain.

Action:

1. Stop publishing releases immediately.
2. Remove or replace GitHub Actions signing secrets.
3. Generate a new updater keypair.
4. Prepare user communication for manual reinstall if needed.

### C. GitHub Actions secrets exposed

Treat this the same as private-key compromise.

## Incident response playbook

If compromise is suspected:

1. Freeze releases.
2. Assume the old updater private key is no longer trustworthy.
3. Generate a new keypair.
4. Update:
   - `/Users/hans/Desktop/GnosisTMS/src-tauri/updater-public-key.txt`
   - GitHub Actions signing secrets
5. Build a new app release.
6. Expect that existing installed users may need to manually download and reinstall.

## Important limitation

With the current architecture, we should assume:

- a compromised updater key can break seamless updates for already-installed users

That is the core reason to keep the private key out of laptops and tightly controlled.

## Future improvement path

If we want a better rotation story later, we should explicitly design for it before the user base grows.

The likely direction is:

- ship an app version that can transition trust to a new updater public key before any emergency happens

That would need explicit product and security design work. It is not solved by the current setup.

## Immediate next actions

1. Move the private key into the business password manager / vault.
2. Remove the local file at:
   - `/Users/hans/Desktop/GnosisTMS/.gnosis-tms/secrets/tauri-updater.key`
3. Move GitHub release secrets into a protected GitHub Environment later.
4. Keep this document updated if the key location or workflow changes.
