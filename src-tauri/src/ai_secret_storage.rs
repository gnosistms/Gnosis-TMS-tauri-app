use std::fs;
use std::path::{Path, PathBuf};

use iota_stronghold::{engine::snapshot::try_set_encrypt_work_factor, Client};
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

fn stronghold_password(snapshot_path: &Path) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(b"gnosis-tms-ai-provider-secrets");
    hasher.update(snapshot_path.to_string_lossy().as_bytes());
    hasher.finalize().to_vec()
}

fn open_stronghold(snapshot_path: &Path) -> Result<Stronghold, String> {
    try_set_encrypt_work_factor(0).map_err(|error| {
        format!("Could not configure the encrypted AI key store work factor: {error}")
    })?;
    Stronghold::new(snapshot_path, stronghold_password(snapshot_path))
        .map_err(|error| format!("Could not open the encrypted AI key store: {error}"))
}

fn load_or_create_client(stronghold: &Stronghold) -> Result<Client, String> {
    stronghold
        .get_client(AI_SECRET_CLIENT_ID)
        .or_else(|_| stronghold.load_client(AI_SECRET_CLIENT_ID))
        .or_else(|_| stronghold.create_client(AI_SECRET_CLIENT_ID))
        .map_err(|error| format!("Could not access the encrypted AI key store: {error}"))
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
        return delete_store_value(snapshot_path, key, value_label);
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

fn save_team_ai_member_keypair_at_path(
    snapshot_path: &Path,
    installation_id: i64,
    public_key_pem: &str,
    private_key_pem: &str,
) -> Result<(), String> {
    save_store_value(
        snapshot_path,
        &team_ai_member_public_key_key(installation_id),
        public_key_pem,
        "team AI public key",
    )?;
    save_store_value(
        snapshot_path,
        &team_ai_member_private_key_key(installation_id),
        private_key_pem,
        "team AI private key",
    )?;

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
