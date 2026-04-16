use std::collections::BTreeMap;

use tauri::AppHandle;

use crate::{
    ai::types::AiProviderId,
    ai_secret_storage::{
        clear_team_ai_cached_provider_secret as clear_team_ai_cached_provider_secret_value,
        load_team_ai_cached_provider_secret as load_team_ai_cached_provider_secret_value,
        load_team_ai_member_keypair as load_team_ai_member_keypair_value,
        save_team_ai_cached_provider_secret as save_team_ai_cached_provider_secret_value,
        save_team_ai_member_keypair as save_team_ai_member_keypair_value,
        TeamAiCachedProviderSecret, TeamAiMemberKeypair,
    },
    broker::{
        broker_get_json_with_session, broker_post_json_with_session, broker_put_json_with_session,
    },
    github::github_client,
};

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TeamAiWrappedKeyRecord {
    pub(crate) algorithm: String,
    pub(crate) ciphertext: String,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TeamAiBrokerPublicKey {
    pub(crate) algorithm: String,
    pub(crate) public_key_pem: String,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TeamAiSettingsRecord {
    pub(crate) schema_version: i64,
    pub(crate) updated_at: Option<String>,
    pub(crate) updated_by: Option<String>,
    pub(crate) action_preferences: Option<serde_json::Value>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TeamAiProviderSecretMetadata {
    pub(crate) configured: bool,
    pub(crate) key_version: i64,
    pub(crate) algorithm: String,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TeamAiSecretsMetadata {
    pub(crate) schema_version: i64,
    pub(crate) updated_at: Option<String>,
    pub(crate) updated_by: Option<String>,
    pub(crate) providers: BTreeMap<String, Option<TeamAiProviderSecretMetadata>>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TeamAiIssuedProviderSecret {
    pub(crate) provider_id: String,
    pub(crate) key_version: i64,
    pub(crate) wrapped_key: TeamAiWrappedKeyRecord,
}

fn team_ai_base_path(installation_id: i64, org_login: &str) -> String {
    format!("/api/github-app/installations/{installation_id}/orgs/{org_login}/team-ai")
}

#[tauri::command]
pub(crate) async fn load_team_ai_broker_public_key(
    session_token: String,
) -> Result<TeamAiBrokerPublicKey, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = github_client()?;
        broker_get_json_with_session(&client, "/api/team-ai/broker-public-key", &session_token)
    })
    .await
    .map_err(|error| format!("Could not run the team AI broker public key task: {error}"))?
}

#[tauri::command]
pub(crate) async fn load_team_ai_settings(
    installation_id: i64,
    org_login: String,
    session_token: String,
) -> Result<Option<TeamAiSettingsRecord>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = github_client()?;
        broker_get_json_with_session(
            &client,
            &format!(
                "{}/settings",
                team_ai_base_path(installation_id, &org_login)
            ),
            &session_token,
        )
    })
    .await
    .map_err(|error| format!("Could not run the team AI settings load task: {error}"))?
}

#[tauri::command]
pub(crate) async fn save_team_ai_settings(
    installation_id: i64,
    org_login: String,
    action_preferences: Option<serde_json::Value>,
    session_token: String,
) -> Result<TeamAiSettingsRecord, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = github_client()?;
        broker_put_json_with_session(
            &client,
            &format!(
                "{}/settings",
                team_ai_base_path(installation_id, &org_login)
            ),
            &serde_json::json!({
                "actionPreferences": action_preferences
            }),
            &session_token,
        )
    })
    .await
    .map_err(|error| format!("Could not run the team AI settings save task: {error}"))?
}

#[tauri::command]
pub(crate) async fn load_team_ai_secrets_metadata(
    installation_id: i64,
    org_login: String,
    session_token: String,
) -> Result<TeamAiSecretsMetadata, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = github_client()?;
        broker_get_json_with_session(
            &client,
            &format!("{}/secrets", team_ai_base_path(installation_id, &org_login)),
            &session_token,
        )
    })
    .await
    .map_err(|error| format!("Could not run the team AI secrets load task: {error}"))?
}

#[tauri::command]
pub(crate) async fn save_team_ai_provider_secret(
    installation_id: i64,
    org_login: String,
    provider_id: AiProviderId,
    wrapped_key: Option<TeamAiWrappedKeyRecord>,
    clear: bool,
    session_token: String,
) -> Result<TeamAiSecretsMetadata, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = github_client()?;
        broker_put_json_with_session(
            &client,
            &format!(
                "{}/providers/{}",
                team_ai_base_path(installation_id, &org_login),
                provider_id.as_str()
            ),
            &serde_json::json!({
                "wrappedKey": wrapped_key,
                "clear": clear,
            }),
            &session_token,
        )
    })
    .await
    .map_err(|error| format!("Could not run the team AI provider secret save task: {error}"))?
}

#[tauri::command]
pub(crate) async fn issue_team_ai_provider_secret(
    installation_id: i64,
    org_login: String,
    provider_id: AiProviderId,
    member_public_key_pem: String,
    session_token: String,
) -> Result<TeamAiIssuedProviderSecret, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = github_client()?;
        broker_post_json_with_session(
            &client,
            &format!(
                "{}/providers/{}/issue",
                team_ai_base_path(installation_id, &org_login),
                provider_id.as_str()
            ),
            &serde_json::json!({
                "memberPublicKeyPem": member_public_key_pem
            }),
            &session_token,
        )
    })
    .await
    .map_err(|error| format!("Could not run the team AI provider issue task: {error}"))?
}

#[tauri::command]
pub(crate) async fn load_team_ai_member_keypair(
    app: AppHandle,
    installation_id: i64,
) -> Result<Option<TeamAiMemberKeypair>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        load_team_ai_member_keypair_value(&app, installation_id)
    })
    .await
    .map_err(|error| format!("The team AI member keypair load worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn save_team_ai_member_keypair(
    app: AppHandle,
    installation_id: i64,
    public_key_pem: String,
    private_key_pem: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        save_team_ai_member_keypair_value(&app, installation_id, &public_key_pem, &private_key_pem)
    })
    .await
    .map_err(|error| format!("The team AI member keypair save worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn load_team_ai_provider_cache(
    app: AppHandle,
    installation_id: i64,
    provider_id: AiProviderId,
) -> Result<TeamAiCachedProviderSecret, String> {
    tauri::async_runtime::spawn_blocking(move || {
        load_team_ai_cached_provider_secret_value(&app, installation_id, provider_id)
    })
    .await
    .map_err(|error| format!("The team AI provider cache load worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn save_team_ai_provider_cache(
    app: AppHandle,
    installation_id: i64,
    provider_id: AiProviderId,
    api_key: String,
    key_version: i64,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        save_team_ai_cached_provider_secret_value(
            &app,
            installation_id,
            provider_id,
            &api_key,
            key_version,
        )
    })
    .await
    .map_err(|error| format!("The team AI provider cache save worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn clear_team_ai_provider_cache(
    app: AppHandle,
    installation_id: i64,
    provider_id: AiProviderId,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        clear_team_ai_cached_provider_secret_value(&app, installation_id, provider_id)
    })
    .await
    .map_err(|error| format!("The team AI provider cache clear worker failed: {error}"))?
}
