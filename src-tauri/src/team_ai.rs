use std::collections::BTreeMap;

use reqwest::blocking::Client;
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

fn load_team_ai_broker_public_key_with_client(
    client: &Client,
    session_token: &str,
) -> Result<TeamAiBrokerPublicKey, String> {
    broker_get_json_with_session(client, "/api/team-ai/broker-public-key", session_token)
}

fn load_team_ai_settings_with_client(
    client: &Client,
    installation_id: i64,
    org_login: &str,
    session_token: &str,
) -> Result<Option<TeamAiSettingsRecord>, String> {
    broker_get_json_with_session(
        client,
        &format!("{}/settings", team_ai_base_path(installation_id, org_login)),
        session_token,
    )
}

fn save_team_ai_settings_with_client(
    client: &Client,
    installation_id: i64,
    org_login: &str,
    action_preferences: Option<serde_json::Value>,
    session_token: &str,
) -> Result<TeamAiSettingsRecord, String> {
    broker_put_json_with_session(
        client,
        &format!("{}/settings", team_ai_base_path(installation_id, org_login)),
        &serde_json::json!({
            "actionPreferences": action_preferences
        }),
        session_token,
    )
}

fn load_team_ai_secrets_metadata_with_client(
    client: &Client,
    installation_id: i64,
    org_login: &str,
    session_token: &str,
) -> Result<TeamAiSecretsMetadata, String> {
    broker_get_json_with_session(
        client,
        &format!("{}/secrets", team_ai_base_path(installation_id, org_login)),
        session_token,
    )
}

fn save_team_ai_provider_secret_with_client(
    client: &Client,
    installation_id: i64,
    org_login: &str,
    provider_id: AiProviderId,
    wrapped_key: Option<TeamAiWrappedKeyRecord>,
    clear: bool,
    session_token: &str,
) -> Result<TeamAiSecretsMetadata, String> {
    broker_put_json_with_session(
        client,
        &format!(
            "{}/providers/{}",
            team_ai_base_path(installation_id, org_login),
            provider_id.as_str()
        ),
        &serde_json::json!({
            "wrappedKey": wrapped_key,
            "clear": clear,
        }),
        session_token,
    )
}

fn issue_team_ai_provider_secret_with_client(
    client: &Client,
    installation_id: i64,
    org_login: &str,
    provider_id: AiProviderId,
    member_public_key_pem: &str,
    session_token: &str,
) -> Result<TeamAiIssuedProviderSecret, String> {
    broker_post_json_with_session(
        client,
        &format!(
            "{}/providers/{}/issue",
            team_ai_base_path(installation_id, org_login),
            provider_id.as_str()
        ),
        &serde_json::json!({
            "memberPublicKeyPem": member_public_key_pem
        }),
        session_token,
    )
}

#[tauri::command]
pub(crate) async fn load_team_ai_broker_public_key(
    session_token: String,
) -> Result<TeamAiBrokerPublicKey, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = github_client()?;
        load_team_ai_broker_public_key_with_client(&client, &session_token)
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
        load_team_ai_settings_with_client(&client, installation_id, &org_login, &session_token)
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
        save_team_ai_settings_with_client(
            &client,
            installation_id,
            &org_login,
            action_preferences,
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
        load_team_ai_secrets_metadata_with_client(
            &client,
            installation_id,
            &org_login,
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
        save_team_ai_provider_secret_with_client(
            &client,
            installation_id,
            &org_login,
            provider_id,
            wrapped_key,
            clear,
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
        issue_team_ai_provider_secret_with_client(
            &client,
            installation_id,
            &org_login,
            provider_id,
            &member_public_key_pem,
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

#[cfg(test)]
mod tests {
    use super::{
        issue_team_ai_provider_secret_with_client, load_team_ai_broker_public_key_with_client,
        save_team_ai_provider_secret_with_client, TeamAiWrappedKeyRecord,
    };
    use crate::ai::types::AiProviderId;
    use reqwest::blocking::Client;
    use serde_json::json;
    use std::{
        collections::BTreeMap,
        env,
        io::{BufRead, BufReader, Read, Write},
        net::TcpListener,
        sync::{Mutex, MutexGuard, OnceLock},
        thread,
    };

    static BROKER_ENV_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

    #[derive(Debug)]
    struct CapturedRequest {
        method: String,
        path: String,
        headers: BTreeMap<String, String>,
        body: String,
    }

    struct BrokerEnvGuard {
        previous: Option<String>,
        _lock: MutexGuard<'static, ()>,
    }

    impl BrokerEnvGuard {
        fn new(base_url: &str) -> Self {
            let lock = BROKER_ENV_LOCK
                .get_or_init(|| Mutex::new(()))
                .lock()
                .expect("test broker env lock should not be poisoned");
            let previous = env::var("GITHUB_APP_BROKER_BASE_URL").ok();
            env::set_var("GITHUB_APP_BROKER_BASE_URL", base_url);
            Self {
                previous,
                _lock: lock,
            }
        }
    }

    impl Drop for BrokerEnvGuard {
        fn drop(&mut self) {
            if let Some(previous) = &self.previous {
                env::set_var("GITHUB_APP_BROKER_BASE_URL", previous);
            } else {
                env::remove_var("GITHUB_APP_BROKER_BASE_URL");
            }
        }
    }

    fn spawn_mock_broker(
        status_line: &'static str,
        response_body: serde_json::Value,
    ) -> (String, thread::JoinHandle<CapturedRequest>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("mock broker should bind");
        let base_url = format!(
            "http://{}",
            listener.local_addr().expect("mock broker address")
        );
        let response_text = response_body.to_string();
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener
                .accept()
                .expect("mock broker should accept one request");
            let mut reader = BufReader::new(stream.try_clone().expect("mock broker stream clone"));

            let mut request_line = String::new();
            reader
                .read_line(&mut request_line)
                .expect("mock broker should read request line");
            let mut request_parts = request_line.split_whitespace();
            let method = request_parts.next().expect("request method").to_string();
            let path = request_parts.next().expect("request path").to_string();

            let mut headers = BTreeMap::new();
            loop {
                let mut line = String::new();
                reader
                    .read_line(&mut line)
                    .expect("mock broker should read header line");
                let trimmed = line.trim_end_matches(&['\r', '\n'][..]);
                if trimmed.is_empty() {
                    break;
                }
                if let Some((name, value)) = trimmed.split_once(':') {
                    headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
                }
            }

            let content_length = headers
                .get("content-length")
                .and_then(|value| value.parse::<usize>().ok())
                .unwrap_or(0);
            let mut body_bytes = vec![0_u8; content_length];
            reader
                .read_exact(&mut body_bytes)
                .expect("mock broker should read request body");
            let body = String::from_utf8(body_bytes).expect("request body should be valid utf-8");

            let response = format!(
                "{status_line}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                response_text.as_bytes().len(),
                response_text
            );
            stream
                .write_all(response.as_bytes())
                .expect("mock broker should write response");
            stream.flush().expect("mock broker should flush response");

            CapturedRequest {
                method,
                path,
                headers,
                body,
            }
        });
        (base_url, handle)
    }

    fn test_client() -> Client {
        Client::builder().build().expect("test client should build")
    }

    #[test]
    fn public_key_route_loads_correctly() {
        let (base_url, handle) = spawn_mock_broker(
            "HTTP/1.1 200 OK",
            json!({
                "algorithm": "rsa-oaep-sha256-v1",
                "publicKeyPem": "-----BEGIN PUBLIC KEY-----\nTEST\n-----END PUBLIC KEY-----",
            }),
        );
        let _guard = BrokerEnvGuard::new(&base_url);

        let public_key =
            load_team_ai_broker_public_key_with_client(&test_client(), "session-123").unwrap();
        let request = handle.join().expect("mock broker request");

        assert_eq!(public_key.algorithm, "rsa-oaep-sha256-v1");
        assert_eq!(
            public_key.public_key_pem,
            "-----BEGIN PUBLIC KEY-----\nTEST\n-----END PUBLIC KEY-----"
        );
        assert_eq!(request.method, "GET");
        assert_eq!(request.path, "/api/team-ai/broker-public-key");
        assert_eq!(
            request.headers.get("authorization").map(String::as_str),
            Some("Bearer session-123")
        );
        assert_eq!(
            request.headers.get("accept").map(String::as_str),
            Some("application/json")
        );
        assert!(request.body.is_empty());
    }

    #[test]
    fn save_and_clear_provider_secret_requests_match_the_broker_contract() {
        let wrapped_key = TeamAiWrappedKeyRecord {
            algorithm: "rsa-oaep-sha256-v1".into(),
            ciphertext: "ciphertext-1".into(),
        };

        let (save_base_url, save_handle) = spawn_mock_broker(
            "HTTP/1.1 200 OK",
            json!({
                "schemaVersion": 1,
                "updatedAt": "2026-04-16T12:00:00.000Z",
                "updatedBy": "owner",
                "providers": {
                    "openai": {
                        "configured": true,
                        "keyVersion": 4,
                        "algorithm": "rsa-oaep-sha256-v1"
                    }
                }
            }),
        );
        let _save_guard = BrokerEnvGuard::new(&save_base_url);

        let saved = save_team_ai_provider_secret_with_client(
            &test_client(),
            42,
            "team-one",
            AiProviderId::OpenAi,
            Some(wrapped_key.clone()),
            false,
            "session-abc",
        )
        .unwrap();
        let save_request = save_handle.join().expect("save mock broker request");

        assert_eq!(saved.providers["openai"].as_ref().unwrap().key_version, 4);
        assert_eq!(save_request.method, "PUT");
        assert_eq!(
            save_request.path,
            "/api/github-app/installations/42/orgs/team-one/team-ai/providers/openai"
        );
        assert_eq!(
            save_request
                .headers
                .get("authorization")
                .map(String::as_str),
            Some("Bearer session-abc")
        );
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&save_request.body).unwrap(),
            json!({
                "wrappedKey": {
                    "algorithm": "rsa-oaep-sha256-v1",
                    "ciphertext": "ciphertext-1"
                },
                "clear": false
            })
        );
        drop(_save_guard);

        let (clear_base_url, clear_handle) = spawn_mock_broker(
            "HTTP/1.1 200 OK",
            json!({
                "schemaVersion": 1,
                "updatedAt": "2026-04-16T12:05:00.000Z",
                "updatedBy": "owner",
                "providers": {}
            }),
        );
        let _clear_guard = BrokerEnvGuard::new(&clear_base_url);

        let cleared = save_team_ai_provider_secret_with_client(
            &test_client(),
            42,
            "team-one",
            AiProviderId::OpenAi,
            None,
            true,
            "session-abc",
        )
        .unwrap();
        let clear_request = clear_handle.join().expect("clear mock broker request");

        assert!(cleared.providers.is_empty());
        assert_eq!(clear_request.method, "PUT");
        assert_eq!(
            clear_request.path,
            "/api/github-app/installations/42/orgs/team-one/team-ai/providers/openai"
        );
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&clear_request.body).unwrap(),
            json!({
                "wrappedKey": null,
                "clear": true
            })
        );
    }

    #[test]
    fn issue_endpoint_surfaces_permission_errors() {
        let (base_url, handle) = spawn_mock_broker(
            "HTTP/1.1 403 Forbidden",
            json!({
                "error": "Only team admins can issue shared AI keys."
            }),
        );
        let _guard = BrokerEnvGuard::new(&base_url);

        let error = issue_team_ai_provider_secret_with_client(
            &test_client(),
            42,
            "team-one",
            AiProviderId::OpenAi,
            "member-public-key-pem",
            "session-xyz",
        )
        .unwrap_err();
        let request = handle.join().expect("issue mock broker request");

        assert_eq!(error, "Only team admins can issue shared AI keys.");
        assert_eq!(request.method, "POST");
        assert_eq!(
            request.path,
            "/api/github-app/installations/42/orgs/team-one/team-ai/providers/openai/issue"
        );
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&request.body).unwrap(),
            json!({
                "memberPublicKeyPem": "member-public-key-pem"
            })
        );
    }
}
