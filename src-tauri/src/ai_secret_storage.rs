use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use iota_stronghold::{engine::snapshot::try_set_encrypt_work_factor, Client, ClientError};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use tauri_plugin_stronghold::stronghold::Stronghold;

use crate::ai::types::AiProviderId;

const AI_SECRET_SNAPSHOT_FILENAME: &str = "ai-provider-secrets-v2.hold";
const AI_SECRET_CLIENT_ID: &[u8] = b"ai-provider-secrets";

/// Serializes all snapshot-mutating operations.
///
/// Each write/clear opens the snapshot, mutates it, and saves the whole file back.
/// Two of these running concurrently (Tauri runs commands on separate threads) is a
/// last-writer-wins race: a `save` that opened before a `clear` re-persists the
/// pre-clear snapshot, leaving a supposedly cleared secret on disk. Holding this lock
/// across each public write/clear entry point serializes those cycles and also keeps
/// the multi-step operations (secret + key-version) atomic as a unit.
fn snapshot_write_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

/// Runs `operation` while holding the snapshot write lock.
///
/// Only public (`pub(crate)`) write/clear entry points take this lock. The internal
/// `*_at_path` helpers stay lock-free so compound operations acquire it exactly once
/// (a re-entrant acquire on `std::sync::Mutex` would deadlock).
fn with_snapshot_write_lock<T>(operation: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    let _guard = snapshot_write_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    operation()
}

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
    with_snapshot_write_lock(|| {
        save_ai_provider_secret_at_path(&snapshot_path, provider_id, api_key, installation_id)
    })
}

pub(crate) fn clear_ai_provider_secret(
    app: &AppHandle,
    provider_id: AiProviderId,
    installation_id: Option<i64>,
) -> Result<(), String> {
    let snapshot_path = stronghold_snapshot_path(app)?;
    with_snapshot_write_lock(|| {
        clear_ai_provider_secret_at_path(&snapshot_path, provider_id, installation_id)
    })
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
    with_snapshot_write_lock(|| {
        save_team_ai_member_keypair_at_path(
            &snapshot_path,
            installation_id,
            public_key_pem,
            private_key_pem,
        )
    })
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
    with_snapshot_write_lock(|| {
        save_team_ai_cached_provider_secret_at_path(
            &snapshot_path,
            installation_id,
            provider_id,
            api_key,
            key_version,
        )
    })
}

pub(crate) fn clear_team_ai_cached_provider_secret(
    app: &AppHandle,
    installation_id: i64,
    provider_id: AiProviderId,
) -> Result<(), String> {
    let snapshot_path = stronghold_snapshot_path(app)?;
    with_snapshot_write_lock(|| {
        clear_team_ai_cached_provider_secret_at_path(&snapshot_path, installation_id, provider_id)
    })
}

pub(crate) fn stronghold_snapshot_path(app: &AppHandle) -> Result<PathBuf, String> {
    let local_data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Could not resolve the encrypted AI key store path: {error}"))?;
    fs::create_dir_all(&local_data_dir)
        .map_err(|error| format!("Could not create the encrypted AI key store folder: {error}"))?;
    Ok(local_data_dir.join(AI_SECRET_SNAPSHOT_FILENAME))
}

/// Returns the deterministic Stronghold snapshot password used for local AI secrets.
///
/// This protects the snapshot while it is handled by Stronghold, but it is not
/// intended to provide strong at-rest secrecy against someone who already has
/// access to the local account and app files. The product threat model accepts
/// that tradeoff to avoid OS keychain prompts for ordinary AI key storage.
fn stronghold_password(snapshot_path: &Path) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(b"gnosis-tms-ai-provider-secrets");
    hasher.update(snapshot_path.to_string_lossy().as_bytes());
    hasher.finalize().to_vec()
}

fn open_stronghold(snapshot_path: &Path) -> Result<Stronghold, String> {
    // Work factor 0 disables Argon2 key-stretching on the snapshot password. The
    // password is a deterministic SHA-256 hash (see `stronghold_password`), so key
    // stretching adds no meaningful protection here; this is the accepted at-rest
    // tradeoff documented in F-VIII. The value must stay 0 to remain compatible with
    // snapshots written by earlier versions.
    try_set_encrypt_work_factor(0).map_err(|error| {
        format!("Could not configure the encrypted AI key store work factor: {error}")
    })?;
    Stronghold::new(snapshot_path, stronghold_password(snapshot_path))
        .map_err(|error| format!("Could not open the encrypted AI key store: {error}"))
}

fn load_or_create_client(stronghold: &Stronghold) -> Result<Client, String> {
    // Already loaded into this session's runtime.
    if let Ok(client) = stronghold.get_client(AI_SECRET_CLIENT_ID) {
        return Ok(client);
    }
    // Not loaded yet: try to load it from the snapshot. (A corrupt snapshot or wrong
    // password has already failed earlier, inside `Stronghold::new`'s eager
    // `load_snapshot`, so reaching here means the snapshot itself opened cleanly.)
    match stronghold.load_client(AI_SECRET_CLIENT_ID) {
        Ok(client) => Ok(client),
        // The client is genuinely absent from the snapshot — this is the first time
        // any secret is stored, so create a fresh client.
        Err(ClientError::ClientDataNotPresent) => stronghold
            .create_client(AI_SECRET_CLIENT_ID)
            .map_err(|error| format!("Could not create the encrypted AI key store: {error}")),
        // Any other failure means the snapshot opened but this client's state could not
        // be restored. Surface it instead of silently creating an empty store, which
        // would make previously saved secrets look like they had vanished.
        Err(error) => Err(format!(
            "Could not open the encrypted AI key store: {error}"
        )),
    }
}

pub(crate) fn load_store_value(
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

pub(crate) fn save_store_value(
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

pub(crate) fn delete_store_value(
    snapshot_path: &Path,
    key: &str,
    value_label: &str,
) -> Result<(), String> {
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
        load_ai_provider_secret_at_path, load_team_ai_cached_provider_secret_at_path,
        load_team_ai_member_keypair_at_path, provider_secret_key, save_ai_provider_secret_at_path,
        save_team_ai_cached_provider_secret_at_path, save_team_ai_member_keypair_at_path,
        stronghold_password, TeamAiCachedProviderSecret,
    };
    use crate::ai::types::AiProviderId;

    #[test]
    fn stronghold_password_is_stable_and_32_bytes() {
        let snapshot_path = PathBuf::from("/tmp/gnosis-tms-ai-provider-secrets.hold");
        let first = stronghold_password(&snapshot_path);
        let second = stronghold_password(&snapshot_path);

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
    fn corrupt_snapshot_surfaces_error_instead_of_reporting_no_secret() {
        let temp_dir = std::env::temp_dir().join(format!(
            "gnosis-tms-ai-secret-storage-corrupt-{}",
            uuid::Uuid::now_v7()
        ));
        let snapshot_path = temp_dir.join("ai-provider-secrets.hold");

        std::fs::create_dir_all(&temp_dir).unwrap();

        save_ai_provider_secret_at_path(&snapshot_path, AiProviderId::OpenAi, "sk-test-123", None)
            .unwrap();

        // Damage the stored snapshot. A corrupt store must NOT silently look like an
        // account with no saved key — that would mask the real failure (M7).
        std::fs::write(&snapshot_path, b"this is not a valid stronghold snapshot").unwrap();

        let result = load_ai_provider_secret_at_path(&snapshot_path, AiProviderId::OpenAi, None);
        assert!(
            result.is_err(),
            "a corrupt snapshot should surface an error, got {result:?}"
        );

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
