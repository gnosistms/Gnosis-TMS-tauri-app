use crate::{ai::types::AiProviderId, credential_vault};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tauri::AppHandle;

/// Serializes all snapshot-mutating operations.
///
/// The vault serializes record updates internally. This outer lock also makes
/// session/revision checks and compound credential changes atomic with clears.
/// Never hold it across a network request.
fn snapshot_write_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

/// Runs `operation` while holding the snapshot write lock.
///
/// Only public (`pub(crate)`) write/clear entry points take this lock. The internal
/// `*_at_path` helpers stay lock-free so compound operations acquire it exactly once
/// (a re-entrant acquire on `std::sync::Mutex` would deadlock).
pub(crate) fn with_snapshot_write_lock<T>(
    operation: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let _guard = snapshot_write_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    operation()
}

#[derive(Clone, PartialEq, Eq)]
pub(crate) struct TeamAiMemberKeypair {
    pub(crate) public_key_pem: String,
    pub(crate) private_key_pem: String,
}

impl std::fmt::Debug for TeamAiMemberKeypair {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("TeamAiMemberKeypair([redacted])")
    }
}
impl Drop for TeamAiMemberKeypair {
    fn drop(&mut self) {
        zeroize::Zeroize::zeroize(&mut self.private_key_pem);
    }
}

#[derive(Clone, PartialEq, Eq)]
pub(crate) struct TeamAiCachedProviderSecret {
    pub(crate) api_key: Option<String>,
    pub(crate) key_version: Option<i64>,
}

impl std::fmt::Debug for TeamAiCachedProviderSecret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("TeamAiCachedProviderSecret([redacted])")
    }
}
impl Drop for TeamAiCachedProviderSecret {
    fn drop(&mut self) {
        if let Some(key) = &mut self.api_key {
            zeroize::Zeroize::zeroize(key);
        }
    }
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
        crate::team_ai::invalidate_provider(&snapshot_path, installation_id, provider_id);
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
        crate::team_ai::invalidate_provider(&snapshot_path, installation_id, provider_id);
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

pub(crate) fn load_team_ai_cached_provider_secret(
    app: &AppHandle,
    installation_id: i64,
    provider_id: AiProviderId,
) -> Result<TeamAiCachedProviderSecret, String> {
    let snapshot_path = stronghold_snapshot_path(app)?;
    load_team_ai_cached_provider_secret_at_path(&snapshot_path, installation_id, provider_id)
}

pub(crate) fn clear_team_ai_cached_provider_secret(
    app: &AppHandle,
    installation_id: i64,
    provider_id: AiProviderId,
) -> Result<(), String> {
    let snapshot_path = stronghold_snapshot_path(app)?;
    with_snapshot_write_lock(|| {
        crate::team_ai::invalidate_provider(&snapshot_path, Some(installation_id), provider_id);
        clear_team_ai_cached_provider_secret_at_path(&snapshot_path, installation_id, provider_id)
    })
}

pub(crate) fn stronghold_snapshot_path(app: &AppHandle) -> Result<PathBuf, String> {
    credential_vault::app_path(app)
}

pub(crate) fn load_store_value(
    path: &Path,
    key: &str,
    _label: &str,
) -> Result<Option<String>, String> {
    Ok(credential_vault::read(path, key)?.filter(|value| !value.trim().is_empty()))
}
pub(crate) fn save_store_value(
    path: &Path,
    key: &str,
    value: &str,
    label: &str,
) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err(format!(
            "The {label} must not be blank. Use the clear action to remove it."
        ));
    }
    credential_vault::update(path, &[(key.into(), Some(value.trim().into()))])
}
pub(crate) fn delete_store_value(path: &Path, key: &str, _label: &str) -> Result<(), String> {
    credential_vault::update(path, &[(key.into(), None)])
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

pub(crate) fn load_team_ai_member_keypair_at_path(
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
pub(crate) fn save_team_ai_member_keypair_at_path(
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

    credential_vault::update(
        snapshot_path,
        &[
            (
                team_ai_member_public_key_key(installation_id),
                Some(normalized_public.into()),
            ),
            (
                team_ai_member_private_key_key(installation_id),
                Some(normalized_private.into()),
            ),
        ],
    )
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

pub(crate) fn save_team_ai_cached_provider_secret_at_path(
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

    credential_vault::update(
        snapshot_path,
        &[
            (
                provider_secret_key(provider_id, Some(installation_id)),
                Some(api_key.trim().into()),
            ),
            (
                team_ai_provider_key_version_key(provider_id, installation_id),
                Some(key_version.to_string()),
            ),
        ],
    )
}

fn clear_team_ai_cached_provider_secret_at_path(
    snapshot_path: &Path,
    installation_id: i64,
    provider_id: AiProviderId,
) -> Result<(), String> {
    credential_vault::update(
        snapshot_path,
        &[
            (
                provider_secret_key(provider_id, Some(installation_id)),
                None,
            ),
            (
                team_ai_provider_key_version_key(provider_id, installation_id),
                None,
            ),
        ],
    )
}

#[cfg(test)]
mod tests {

    use super::{
        clear_ai_provider_secret_at_path, clear_team_ai_cached_provider_secret_at_path,
        load_ai_provider_secret_at_path, load_team_ai_cached_provider_secret_at_path,
        load_team_ai_member_keypair_at_path, provider_secret_key, save_ai_provider_secret_at_path,
        save_team_ai_cached_provider_secret_at_path, save_team_ai_member_keypair_at_path,
        TeamAiCachedProviderSecret,
    };
    use crate::ai::types::AiProviderId;

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
        crate::credential_vault::test_path(&snapshot_path);

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
        crate::credential_vault::test_path(&snapshot_path);

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
        crate::credential_vault::test_path(&snapshot_path);

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
        crate::credential_vault::test_path(&snapshot_path);

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
        crate::credential_vault::test_path(&snapshot_path);

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
