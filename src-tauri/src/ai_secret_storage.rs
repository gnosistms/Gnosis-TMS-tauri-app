use std::fs;
use std::path::{Path, PathBuf};

use iota_stronghold::{Client, ClientError};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use tauri_plugin_stronghold::stronghold::Stronghold;

use crate::ai::types::AiProviderId;

const AI_SECRET_SNAPSHOT_FILENAME: &str = "ai-provider-secrets-v2.hold";
const AI_SECRET_CLIENT_ID: &[u8] = b"ai-provider-secrets";

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TeamAiMemberKeypair {
    pub(crate) public_key_pem: String,
    pub(crate) private_key_pem: String,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TeamAiCachedProviderSecret {
    pub(crate) api_key: Option<String>,
    pub(crate) key_version: Option<i64>,
}

pub(crate) fn load_ai_provider_secret(
    app: &AppHandle,
    provider_id: AiProviderId,
    installation_id: Option<i64>,
) -> Result<Option<String>, String> {
    let snapshot_path = stronghold_snapshot_path(app)?;
    load_ai_provider_secret_at_path(&snapshot_path, provider_id, installation_id)
}

pub(crate) fn save_ai_provider_secret(
    app: &AppHandle,
    provider_id: AiProviderId,
    api_key: &str,
    installation_id: Option<i64>,
) -> Result<(), String> {
    let snapshot_path = stronghold_snapshot_path(app)?;
    save_ai_provider_secret_at_path(&snapshot_path, provider_id, api_key, installation_id)
}

pub(crate) fn clear_ai_provider_secret(
    app: &AppHandle,
    provider_id: AiProviderId,
    installation_id: Option<i64>,
) -> Result<(), String> {
    let snapshot_path = stronghold_snapshot_path(app)?;
    clear_ai_provider_secret_at_path(&snapshot_path, provider_id, installation_id)
}

pub(crate) fn load_team_ai_member_keypair(
    app: &AppHandle,
    installation_id: i64,
) -> Result<Option<TeamAiMemberKeypair>, String> {
    let snapshot_path = stronghold_snapshot_path(app)?;
    load_team_ai_member_keypair_at_path(&snapshot_path, installation_id)
}

pub(crate) fn save_team_ai_member_keypair(
    app: &AppHandle,
    installation_id: i64,
    public_key_pem: &str,
    private_key_pem: &str,
) -> Result<(), String> {
    let snapshot_path = stronghold_snapshot_path(app)?;
    save_team_ai_member_keypair_at_path(
        &snapshot_path,
        installation_id,
        public_key_pem,
        private_key_pem,
    )
}

pub(crate) fn load_team_ai_cached_provider_secret(
    app: &AppHandle,
    installation_id: i64,
    provider_id: AiProviderId,
) -> Result<TeamAiCachedProviderSecret, String> {
    let snapshot_path = stronghold_snapshot_path(app)?;
    load_team_ai_cached_provider_secret_at_path(&snapshot_path, installation_id, provider_id)
}

pub(crate) fn save_team_ai_cached_provider_secret(
    app: &AppHandle,
    installation_id: i64,
    provider_id: AiProviderId,
    api_key: &str,
    key_version: i64,
) -> Result<(), String> {
    let snapshot_path = stronghold_snapshot_path(app)?;
    save_team_ai_cached_provider_secret_at_path(
        &snapshot_path,
        installation_id,
        provider_id,
        api_key,
        key_version,
    )
}

pub(crate) fn clear_team_ai_cached_provider_secret(
    app: &AppHandle,
    installation_id: i64,
    provider_id: AiProviderId,
) -> Result<(), String> {
    let snapshot_path = stronghold_snapshot_path(app)?;
    clear_team_ai_cached_provider_secret_at_path(&snapshot_path, installation_id, provider_id)
}

fn stronghold_snapshot_path(app: &AppHandle) -> Result<PathBuf, String> {
    let local_data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Could not resolve the encrypted AI key store path: {error}"))?;
    fs::create_dir_all(&local_data_dir)
        .map_err(|error| format!("Could not create the encrypted AI key store folder: {error}"))?;
    Ok(local_data_dir.join(AI_SECRET_SNAPSHOT_FILENAME))
}

/// Loads the 32-byte Stronghold encryption secret from the OS credential store,
/// generating and persisting a fresh random secret on first use.
///
/// The credential is stored under the service `"gnosis-tms"` with the account
/// `"ai-stronghold-key"`. The OS keychain used depends on the platform:
/// - macOS: Keychain (Keychain Access)
/// - Linux: Secret Service (e.g. GNOME Keyring, KWallet)
/// - Windows: Credential Manager
fn load_or_generate_stronghold_secret() -> Result<Vec<u8>, String> {
    let entry = keyring::Entry::new("gnosis-tms", "ai-stronghold-key")
        .map_err(|e| format!("Keychain error initialising entry: {e}"))?;
    match entry.get_secret() {
        Ok(secret) => Ok(secret),
        Err(keyring::Error::NoEntry) => {
            use rand::RngCore;
            let mut secret = vec![0u8; 32];
            rand::thread_rng().fill_bytes(&mut secret);
            entry
                .set_secret(&secret)
                .map_err(|e| format!("Could not save Stronghold key to keychain: {e}"))?;
            Ok(secret)
        }
        Err(e) => Err(format!("Keychain error reading Stronghold key: {e}")),
    }
}

/// The legacy deterministic password used before the OS-keychain-based key was introduced.
///
/// This was replaced because it derived the Stronghold password from a hardcoded string
/// plus the snapshot file path — both public values — giving no real confidentiality.
/// It is retained here solely for the one-time migration path in [`open_stronghold`].
fn legacy_stronghold_password(snapshot_path: &Path) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(b"gnosis-tms-ai-provider-secrets");
    hasher.update(snapshot_path.to_string_lossy().as_bytes());
    hasher.finalize().to_vec()
}

/// Opens the Stronghold snapshot at `snapshot_path`, returning an in-memory handle
/// ready for client operations.
///
/// # Key derivation
///
/// The encryption key is loaded from the OS credential store via the `keyring` crate
/// (Keychain on macOS, Secret Service on Linux, Credential Manager on Windows).
/// On first use a cryptographically random 32-byte secret is generated and saved
/// there. `try_set_encrypt_work_factor` is **not** called, so Stronghold's default
/// Argon2 work factor applies and key-stretching is fully active.
///
/// # Migration of legacy snapshots
///
/// Snapshots written by earlier versions used a deterministic key derived from a
/// hardcoded string and the file path. The migration logic here handles a seamless
/// upgrade:
///
/// 1. Attempt to open the snapshot with the new OS-keychain key.
/// 2. If that fails **and** the snapshot file already exists on disk, attempt to
///    open it with the legacy deterministic key.
/// 3. If the legacy key succeeds, read every value from the old client, delete the
///    snapshot file, re-open it with the new key, and re-write all values — the
///    snapshot is now re-encrypted under the secure key.
/// 4. If both keys fail (or no snapshot file exists), start with a fresh empty store.
fn open_stronghold(snapshot_path: &Path) -> Result<Stronghold, String> {
    let new_key = load_or_generate_stronghold_secret()?;

    // Try the new key first (the common fast path).
    match Stronghold::new(snapshot_path, new_key.clone()) {
        Ok(sh) => return Ok(sh),
        Err(_) if !snapshot_path.exists() => {
            // No snapshot file yet; Stronghold::new with a nonexistent path creates a
            // new empty store, so this branch should not normally be reached.
            return Err("Could not initialise the encrypted AI key store.".to_string());
        }
        Err(_) => {
            // Snapshot exists but the new key didn't open it. Try the legacy key.
        }
    }

    let legacy_key = legacy_stronghold_password(snapshot_path);
    match Stronghold::new(snapshot_path, legacy_key) {
        Ok(legacy_sh) => {
            // Snapshot opened with the legacy key. Read all values so we can re-write
            // them under the new key.
            let entries: Vec<(Vec<u8>, Vec<u8>)> =
                match legacy_sh.load_client(AI_SECRET_CLIENT_ID) {
                    Ok(client) => {
                        let store = client.store();
                        let keys = store
                            .keys()
                            .map_err(|e| format!("Could not enumerate legacy key store: {e}"))?;
                        let mut pairs = Vec::with_capacity(keys.len());
                        for k in keys {
                            if let Some(v) = store
                                .get(&k)
                                .map_err(|e| format!("Could not read legacy store value: {e}"))?
                            {
                                pairs.push((k, v));
                            }
                        }
                        pairs
                    }
                    // Client not present just means there were no stored secrets; start fresh.
                    Err(ClientError::ClientDataNotPresent) => Vec::new(),
                    Err(e) => {
                        return Err(format!(
                            "Could not load legacy AI key store client during migration: {e}"
                        ));
                    }
                };

            // Delete the old snapshot and re-open under the new key.
            fs::remove_file(snapshot_path).map_err(|e| {
                format!(
                    "Could not remove legacy AI key store snapshot during migration: {e}"
                )
            })?;

            let new_sh = Stronghold::new(snapshot_path, new_key).map_err(|e| {
                format!("Could not create new AI key store after legacy migration: {e}")
            })?;

            // Re-write all values into the new snapshot.
            if !entries.is_empty() {
                let client = new_sh
                    .create_client(AI_SECRET_CLIENT_ID)
                    .map_err(|e| {
                        format!(
                            "Could not create AI key store client after migration: {e}"
                        )
                    })?;
                let store = client.store();
                for (k, v) in entries {
                    store.insert(k, v, None).map_err(|e| {
                        format!(
                            "Could not write value to new AI key store during migration: {e}"
                        )
                    })?;
                }
                new_sh.save().map_err(|e| {
                    format!("Could not persist AI key store after legacy migration: {e}")
                })?;
            }

            Ok(new_sh)
        }
        Err(_) => {
            // Neither key opened the snapshot. Treat it as unrecoverable and start fresh.
            if let Err(e) = fs::remove_file(snapshot_path) {
                // Non-fatal: log and continue; the store will be re-created.
                eprintln!(
                    "Warning: could not remove unreadable AI key store snapshot at {}: {e}",
                    snapshot_path.display()
                );
            }
            Stronghold::new(snapshot_path, new_key)
                .map_err(|e| format!("Could not open the encrypted AI key store: {e}"))
        }
    }
}

/// Returns the Stronghold client for AI secrets, loading it from the snapshot if
/// it is not yet in memory, or creating a fresh client if no data exists yet.
///
/// Distinguishes a genuine "client not present in this snapshot" condition
/// (represented by [`ClientError::ClientDataNotPresent`]) from other errors such as
/// a corrupt snapshot, ensuring the latter surface as explicit failures rather than
/// silently appearing as missing secrets.
fn load_or_create_client(stronghold: &Stronghold) -> Result<Client, String> {
    if let Ok(client) = stronghold.get_client(AI_SECRET_CLIENT_ID) {
        return Ok(client);
    }
    match stronghold.load_client(AI_SECRET_CLIENT_ID) {
        Ok(client) => Ok(client),
        Err(ClientError::ClientDataNotPresent) => stronghold
            .create_client(AI_SECRET_CLIENT_ID)
            .map_err(|e| format!("Could not create AI key store client: {e}")),
        Err(e) => Err(format!(
            "Could not load AI key store client (snapshot may be corrupt): {e}"
        )),
    }
}

fn load_store_value(
    snapshot_path: &Path,
    key: &str,
    value_label: &str,
) -> Result<Option<String>, String> {
    let stronghold = open_stronghold(snapshot_path)?;
    let client = load_or_create_client(&stronghold)?;
    let maybe_value = client
        .store()
        .get(key.as_bytes())
        .map_err(|error| format!("Could not load the saved {value_label}: {error}"))?;

    let Some(value) = maybe_value else {
        return Ok(None);
    };

    let decoded_value = String::from_utf8(value)
        .map_err(|_| format!("The saved {value_label} could not be decoded."))?;
    if decoded_value.trim().is_empty() {
        return Ok(None);
    }

    Ok(Some(decoded_value))
}

fn save_store_value(
    snapshot_path: &Path,
    key: &str,
    value: &str,
    value_label: &str,
) -> Result<(), String> {
    let normalized_value = value.trim();
    if normalized_value.is_empty() {
        return Err(format!(
            "The {value_label} must not be blank. To remove a saved key, use the clear action."
        ));
    }

    let stronghold = open_stronghold(snapshot_path)?;
    let client = load_or_create_client(&stronghold)?;
    client
        .store()
        .insert(
            key.as_bytes().to_vec(),
            normalized_value.as_bytes().to_vec(),
            None,
        )
        .map_err(|error| format!("Could not save the {value_label}: {error}"))?;
    stronghold
        .save()
        .map_err(|error| format!("Could not persist the encrypted AI key store: {error}"))?;

    Ok(())
}

fn delete_store_value(snapshot_path: &Path, key: &str, value_label: &str) -> Result<(), String> {
    let stronghold = open_stronghold(snapshot_path)?;
    let client = load_or_create_client(&stronghold)?;
    client
        .store()
        .delete(key.as_bytes())
        .map_err(|error| format!("Could not clear the saved {value_label}: {error}"))?;
    stronghold
        .save()
        .map_err(|error| format!("Could not persist the encrypted AI key store: {error}"))?;

    Ok(())
}

fn provider_secret_key(provider_id: AiProviderId, installation_id: Option<i64>) -> String {
    if let Some(installation_id) = installation_id {
        return format!("team-ai/{installation_id}/{}/api-key", provider_id.as_str());
    }

    format!("ai-provider/{}/api-key", provider_id.as_str())
}

fn team_ai_provider_key_version_key(provider_id: AiProviderId, installation_id: i64) -> String {
    format!(
        "team-ai/{installation_id}/{}/key-version",
        provider_id.as_str()
    )
}

fn team_ai_member_public_key_key(installation_id: i64) -> String {
    format!("team-ai/{installation_id}/member-public-key-pem")
}

fn team_ai_member_private_key_key(installation_id: i64) -> String {
    format!("team-ai/{installation_id}/member-private-key-pem")
}

fn load_ai_provider_secret_at_path(
    snapshot_path: &Path,
    provider_id: AiProviderId,
    installation_id: Option<i64>,
) -> Result<Option<String>, String> {
    load_store_value(
        snapshot_path,
        &provider_secret_key(provider_id, installation_id),
        "AI API key",
    )
}

fn save_ai_provider_secret_at_path(
    snapshot_path: &Path,
    provider_id: AiProviderId,
    api_key: &str,
    installation_id: Option<i64>,
) -> Result<(), String> {
    save_store_value(
        snapshot_path,
        &provider_secret_key(provider_id, installation_id),
        api_key,
        "AI API key",
    )
}

fn clear_ai_provider_secret_at_path(
    snapshot_path: &Path,
    provider_id: AiProviderId,
    installation_id: Option<i64>,
) -> Result<(), String> {
    delete_store_value(
        snapshot_path,
        &provider_secret_key(provider_id, installation_id),
        "AI API key",
    )
}

fn load_team_ai_member_keypair_at_path(
    snapshot_path: &Path,
    installation_id: i64,
) -> Result<Option<TeamAiMemberKeypair>, String> {
    let public_key_pem = load_store_value(
        snapshot_path,
        &team_ai_member_public_key_key(installation_id),
        "team AI public key",
    )?;
    let private_key_pem = load_store_value(
        snapshot_path,
        &team_ai_member_private_key_key(installation_id),
        "team AI private key",
    )?;

    match (public_key_pem, private_key_pem) {
        (Some(public_key_pem), Some(private_key_pem)) => Ok(Some(TeamAiMemberKeypair {
            public_key_pem,
            private_key_pem,
        })),
        _ => Ok(None),
    }
}

/// Saves a keypair (public + private PEM) into the Stronghold snapshot.
///
/// Both values are validated and both keys are written into the same Stronghold
/// client in a single open/save cycle so the store is never left with only one
/// half of the keypair persisted.
fn save_team_ai_member_keypair_at_path(
    snapshot_path: &Path,
    installation_id: i64,
    public_key_pem: &str,
    private_key_pem: &str,
) -> Result<(), String> {
    let normalized_public = public_key_pem.trim();
    if normalized_public.is_empty() {
        return Err(
            "The team AI public key must not be blank. To remove a saved key, use the clear action."
                .to_string(),
        );
    }
    let normalized_private = private_key_pem.trim();
    if normalized_private.is_empty() {
        return Err(
            "The team AI private key must not be blank. To remove a saved key, use the clear action."
                .to_string(),
        );
    }

    let stronghold = open_stronghold(snapshot_path)?;
    let client = load_or_create_client(&stronghold)?;
    let store = client.store();

    store
        .insert(
            team_ai_member_public_key_key(installation_id)
                .as_bytes()
                .to_vec(),
            normalized_public.as_bytes().to_vec(),
            None,
        )
        .map_err(|e| format!("Could not save the team AI public key: {e}"))?;

    store
        .insert(
            team_ai_member_private_key_key(installation_id)
                .as_bytes()
                .to_vec(),
            normalized_private.as_bytes().to_vec(),
            None,
        )
        .map_err(|e| format!("Could not save the team AI private key: {e}"))?;

    stronghold
        .save()
        .map_err(|e| format!("Could not persist the encrypted AI key store: {e}"))?;

    Ok(())
}

fn load_team_ai_cached_provider_secret_at_path(
    snapshot_path: &Path,
    installation_id: i64,
    provider_id: AiProviderId,
) -> Result<TeamAiCachedProviderSecret, String> {
    let api_key =
        load_ai_provider_secret_at_path(snapshot_path, provider_id, Some(installation_id))?;
    let key_version = load_store_value(
        snapshot_path,
        &team_ai_provider_key_version_key(provider_id, installation_id),
        "team AI key version",
    )?
    .and_then(|value| value.trim().parse::<i64>().ok())
    .filter(|value| *value > 0);

    Ok(TeamAiCachedProviderSecret {
        api_key,
        key_version,
    })
}

fn save_team_ai_cached_provider_secret_at_path(
    snapshot_path: &Path,
    installation_id: i64,
    provider_id: AiProviderId,
    api_key: &str,
    key_version: i64,
) -> Result<(), String> {
    if api_key.trim().is_empty() || key_version <= 0 {
        return clear_team_ai_cached_provider_secret_at_path(
            snapshot_path,
            installation_id,
            provider_id,
        );
    }

    save_ai_provider_secret_at_path(snapshot_path, provider_id, api_key, Some(installation_id))?;
    save_store_value(
        snapshot_path,
        &team_ai_provider_key_version_key(provider_id, installation_id),
        &key_version.to_string(),
        "team AI key version",
    )?;

    Ok(())
}

fn clear_team_ai_cached_provider_secret_at_path(
    snapshot_path: &Path,
    installation_id: i64,
    provider_id: AiProviderId,
) -> Result<(), String> {
    clear_ai_provider_secret_at_path(snapshot_path, provider_id, Some(installation_id))?;
    delete_store_value(
        snapshot_path,
        &team_ai_provider_key_version_key(provider_id, installation_id),
        "team AI key version",
    )?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::{
        clear_ai_provider_secret_at_path, clear_team_ai_cached_provider_secret_at_path,
        legacy_stronghold_password, load_ai_provider_secret_at_path,
        load_team_ai_cached_provider_secret_at_path, load_team_ai_member_keypair_at_path,
        provider_secret_key, save_ai_provider_secret_at_path,
        save_team_ai_cached_provider_secret_at_path, save_team_ai_member_keypair_at_path,
        TeamAiCachedProviderSecret,
    };
    use crate::ai::types::AiProviderId;

    #[test]
    fn legacy_stronghold_password_is_stable_and_32_bytes() {
        let snapshot_path = PathBuf::from("/tmp/gnosis-tms-ai-provider-secrets.hold");
        let first = legacy_stronghold_password(&snapshot_path);
        let second = legacy_stronghold_password(&snapshot_path);

        assert_eq!(first, second);
        assert_eq!(first.len(), 32);
    }

    #[test]
    fn provider_secret_key_namespaces_the_provider() {
        assert_eq!(
            provider_secret_key(AiProviderId::OpenAi, None),
            "ai-provider/openai/api-key"
        );
        assert_eq!(
            provider_secret_key(AiProviderId::Gemini, None),
            "ai-provider/gemini/api-key"
        );
        assert_eq!(
            provider_secret_key(AiProviderId::OpenAi, Some(42)),
            "team-ai/42/openai/api-key"
        );
    }

    #[test]
    fn stronghold_round_trips_ai_provider_secrets() {
        let temp_dir = std::env::temp_dir().join(format!(
            "gnosis-tms-ai-secret-storage-{}",
            uuid::Uuid::now_v7()
        ));
        let snapshot_path = temp_dir.join("ai-provider-secrets.hold");

        std::fs::create_dir_all(&temp_dir).unwrap();

        save_ai_provider_secret_at_path(&snapshot_path, AiProviderId::OpenAi, "sk-test-123", None)
            .unwrap();
        let loaded_secret =
            load_ai_provider_secret_at_path(&snapshot_path, AiProviderId::OpenAi, None).unwrap();
        assert_eq!(loaded_secret.as_deref(), Some("sk-test-123"));

        clear_ai_provider_secret_at_path(&snapshot_path, AiProviderId::OpenAi, None).unwrap();
        let cleared_secret =
            load_ai_provider_secret_at_path(&snapshot_path, AiProviderId::OpenAi, None).unwrap();
        assert_eq!(cleared_secret, None);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn stronghold_keeps_multiple_provider_secrets_at_once() {
        let temp_dir = std::env::temp_dir().join(format!(
            "gnosis-tms-ai-secret-storage-multi-{}",
            uuid::Uuid::now_v7()
        ));
        let snapshot_path = temp_dir.join("ai-provider-secrets.hold");

        std::fs::create_dir_all(&temp_dir).unwrap();

        save_ai_provider_secret_at_path(&snapshot_path, AiProviderId::OpenAi, "sk-openai", None)
            .unwrap();
        save_ai_provider_secret_at_path(&snapshot_path, AiProviderId::Gemini, "gm-gemini", None)
            .unwrap();

        let openai_secret =
            load_ai_provider_secret_at_path(&snapshot_path, AiProviderId::OpenAi, None).unwrap();
        let gemini_secret =
            load_ai_provider_secret_at_path(&snapshot_path, AiProviderId::Gemini, None).unwrap();

        assert_eq!(openai_secret.as_deref(), Some("sk-openai"));
        assert_eq!(gemini_secret.as_deref(), Some("gm-gemini"));

        clear_ai_provider_secret_at_path(&snapshot_path, AiProviderId::Gemini, None).unwrap();

        let openai_secret_after_clear =
            load_ai_provider_secret_at_path(&snapshot_path, AiProviderId::OpenAi, None).unwrap();
        let gemini_secret_after_clear =
            load_ai_provider_secret_at_path(&snapshot_path, AiProviderId::Gemini, None).unwrap();

        assert_eq!(openai_secret_after_clear.as_deref(), Some("sk-openai"));
        assert_eq!(gemini_secret_after_clear, None);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn stronghold_scopes_ai_provider_secrets_by_installation() {
        let temp_dir = std::env::temp_dir().join(format!(
            "gnosis-tms-ai-secret-storage-team-{}",
            uuid::Uuid::now_v7()
        ));
        let snapshot_path = temp_dir.join("ai-provider-secrets.hold");

        std::fs::create_dir_all(&temp_dir).unwrap();

        save_ai_provider_secret_at_path(&snapshot_path, AiProviderId::OpenAi, "sk-personal", None)
            .unwrap();
        save_ai_provider_secret_at_path(&snapshot_path, AiProviderId::OpenAi, "sk-team-7", Some(7))
            .unwrap();

        let personal_secret =
            load_ai_provider_secret_at_path(&snapshot_path, AiProviderId::OpenAi, None).unwrap();
        let team_secret =
            load_ai_provider_secret_at_path(&snapshot_path, AiProviderId::OpenAi, Some(7)).unwrap();

        assert_eq!(personal_secret.as_deref(), Some("sk-personal"));
        assert_eq!(team_secret.as_deref(), Some("sk-team-7"));

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn stronghold_round_trips_team_ai_member_keypairs() {
        let temp_dir = std::env::temp_dir().join(format!(
            "gnosis-tms-team-ai-member-keypair-{}",
            uuid::Uuid::now_v7()
        ));
        let snapshot_path = temp_dir.join("ai-provider-secrets.hold");

        std::fs::create_dir_all(&temp_dir).unwrap();

        save_team_ai_member_keypair_at_path(&snapshot_path, 42, "public-pem", "private-pem")
            .unwrap();

        let keypair = load_team_ai_member_keypair_at_path(&snapshot_path, 42).unwrap();
        assert_eq!(
            keypair,
            Some(super::TeamAiMemberKeypair {
                public_key_pem: "public-pem".to_string(),
                private_key_pem: "private-pem".to_string(),
            })
        );

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn stronghold_round_trips_team_ai_cached_provider_versions() {
        let temp_dir =
            std::env::temp_dir().join(format!("gnosis-tms-team-ai-cache-{}", uuid::Uuid::now_v7()));
        let snapshot_path = temp_dir.join("ai-provider-secrets.hold");

        std::fs::create_dir_all(&temp_dir).unwrap();

        save_team_ai_cached_provider_secret_at_path(
            &snapshot_path,
            7,
            AiProviderId::OpenAi,
            "sk-team-cache",
            3,
        )
        .unwrap();

        let cached_secret =
            load_team_ai_cached_provider_secret_at_path(&snapshot_path, 7, AiProviderId::OpenAi)
                .unwrap();
        assert_eq!(
            cached_secret,
            TeamAiCachedProviderSecret {
                api_key: Some("sk-team-cache".to_string()),
                key_version: Some(3),
            }
        );

        clear_team_ai_cached_provider_secret_at_path(&snapshot_path, 7, AiProviderId::OpenAi)
            .unwrap();
        let cleared_secret =
            load_team_ai_cached_provider_secret_at_path(&snapshot_path, 7, AiProviderId::OpenAi)
                .unwrap();
        assert_eq!(
            cleared_secret,
            TeamAiCachedProviderSecret {
                api_key: None,
                key_version: None,
            }
        );

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
