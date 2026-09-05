use std::collections::BTreeMap;

use reqwest::blocking::Client;
use tauri::AppHandle;

use crate::{
    ai::types::AiProviderId,
    ai_secret_storage::{
        self, clear_team_ai_cached_provider_secret as clear_team_ai_cached_provider_secret_value,
        load_team_ai_cached_provider_secret as load_team_ai_cached_provider_secret_value,
        stronghold_snapshot_path, with_snapshot_write_lock,
    },
    broker::{
        broker_client, broker_get_json_with_session, broker_post_json_with_session,
        broker_put_json_with_session,
    },
    installation_access::{
        ensure_installation_allows_team_ai_access, ensure_installation_allows_team_management,
    },
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
pub(crate) async fn load_team_ai_settings(
    installation_id: i64,
    org_login: String,
    session_token: String,
) -> Result<Option<TeamAiSettingsRecord>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = broker_client()?;
        load_team_ai_settings_with_client(&client, installation_id, &org_login, &session_token)
    })
    .await
    .map_err(|error| format!("Could not run the team AI settings load task: {error}"))?
}

#[tauri::command]
pub(crate) async fn save_team_ai_settings(
    app: AppHandle,
    installation_id: i64,
    org_login: String,
    action_preferences: Option<serde_json::Value>,
    session_token: String,
) -> Result<TeamAiSettingsRecord, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ensure_installation_allows_team_management(&app, installation_id)?;
        let client = broker_client()?;
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
        let client = broker_client()?;
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
    app: AppHandle,
    installation_id: i64,
    org_login: String,
    provider_id: AiProviderId,
    api_key: Option<String>,
    clear: bool,
    session_token: String,
) -> Result<TeamAiSecretsMetadata, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ensure_installation_allows_team_management(&app, installation_id)?;
        let path = stronghold_snapshot_path(&app)?;
        let lease = with_snapshot_write_lock(|| {
            require_current_session(&app, &session_token)?;
            invalidate_provider(&path, Some(installation_id), provider_id);
            Ok(current_generation(&path, installation_id, provider_id))
        })?;
        let client = broker_client()?;
        let api_key = zeroize::Zeroizing::new(api_key.unwrap_or_default());
        let wrapped = if clear {
            None
        } else {
            if api_key.trim().is_empty() {
                return Err("Enter an AI provider key before saving.".into());
            }
            let public = load_team_ai_broker_public_key_with_client(&client, &session_token)?;
            if public.algorithm != crate::team_ai_crypto::ALGORITHM {
                return Err("The broker AI encryption algorithm is unsupported.".into());
            }
            Some(crate::team_ai_crypto::encrypt(
                &api_key,
                &public.public_key_pem,
            )?)
        };
        let metadata = save_team_ai_provider_secret_with_client(
            &client,
            installation_id,
            &org_login,
            provider_id,
            wrapped,
            clear,
            &session_token,
        )?;
        with_snapshot_write_lock(|| {
            require_current_session(&app, &session_token)?;
            if current_generation(&path, installation_id, provider_id) != lease {
                return Err(
                    "AI key settings changed while this request was running. Reload AI Settings."
                        .into(),
                );
            }
            let version = metadata
                .providers
                .get(provider_id.as_str())
                .and_then(|p| p.as_ref())
                .map(|p| p.key_version)
                .unwrap_or(0);
            ai_secret_storage::save_team_ai_cached_provider_secret_at_path(
                &path,
                installation_id,
                provider_id,
                &api_key,
                version,
            )
        })?;
        Ok(metadata)
    })
    .await
    .map_err(|_| "Could not complete the shared AI key save.")?
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PendingSecretResult {
    ticket: String,
    key_version: i64,
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderCacheStatus {
    configured: bool,
    key_version: Option<i64>,
}
struct PendingSecret {
    path: std::path::PathBuf,
    installation_id: i64,
    provider_id: AiProviderId,
    session: zeroize::Zeroizing<String>,
    secret: zeroize::Zeroizing<String>,
    version: i64,
    generation: (u64, u64),
    created: std::time::Instant,
}
#[derive(Default)]
struct Issuances {
    epoch: u64,
    revisions: BTreeMap<(std::path::PathBuf, i64, String), u64>,
    pending: BTreeMap<String, PendingSecret>,
}
fn issuances() -> &'static std::sync::Mutex<Issuances> {
    static STATE: std::sync::OnceLock<std::sync::Mutex<Issuances>> = std::sync::OnceLock::new();
    STATE.get_or_init(|| std::sync::Mutex::new(Issuances::default()))
}
pub(crate) fn invalidate_session() {
    let mut state = issuances().lock().unwrap_or_else(|p| p.into_inner());
    state.epoch = state.epoch.wrapping_add(1);
    state.pending.clear();
}
pub(crate) fn invalidate_provider(
    path: &std::path::Path,
    installation: Option<i64>,
    provider: AiProviderId,
) {
    let Some(installation) = installation else {
        return;
    };
    let mut state = issuances().lock().unwrap_or_else(|p| p.into_inner());
    let revision = state
        .revisions
        .entry((path.to_path_buf(), installation, provider.as_str().into()))
        .or_default();
    *revision = revision.wrapping_add(1);
    state.pending.retain(|_, p| {
        p.path != path || p.installation_id != installation || p.provider_id != provider
    });
}
fn current_generation(
    path: &std::path::Path,
    installation: i64,
    provider: AiProviderId,
) -> (u64, u64) {
    let state = issuances().lock().unwrap_or_else(|p| p.into_inner());
    (
        state.epoch,
        *state
            .revisions
            .get(&(path.to_path_buf(), installation, provider.as_str().into()))
            .unwrap_or(&0),
    )
}
fn require_current_session(app: &AppHandle, session: &str) -> Result<(), String> {
    if crate::broker_auth_storage::load_broker_auth_session_internal(app)?
        .is_some_and(|current| current.session_token == session)
    {
        Ok(())
    } else {
        Err("AUTH_REQUIRED:The signed-in account changed. Retry with the current account.".into())
    }
}

#[tauri::command]
pub(crate) async fn issue_team_ai_provider_secret(
    app: AppHandle,
    installation_id: i64,
    org_login: String,
    provider_id: AiProviderId,
    session_token: String,
) -> Result<PendingSecretResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ensure_installation_allows_team_ai_access(&app, installation_id)?;
        let path = stronghold_snapshot_path(&app)?;
        // Generate outside the write lock; select the stored pair inside it.
        let existing = ai_secret_storage::load_team_ai_member_keypair(&app, installation_id)?;
        let candidate = match existing {
            Some(pair) => pair,
            None => crate::team_ai_crypto::generate()?,
        };
        let (pair, generation) = with_snapshot_write_lock(|| {
            require_current_session(&app, &session_token)?;
            let pair = match ai_secret_storage::load_team_ai_member_keypair_at_path(
                &path,
                installation_id,
            )? {
                Some(pair) => pair,
                None => {
                    ai_secret_storage::save_team_ai_member_keypair_at_path(
                        &path,
                        installation_id,
                        &candidate.public_key_pem,
                        &candidate.private_key_pem,
                    )?;
                    candidate
                }
            };
            Ok((
                pair,
                current_generation(&path, installation_id, provider_id),
            ))
        })?;
        let client = broker_client()?;
        let issued = issue_team_ai_provider_secret_with_client(
            &client,
            installation_id,
            &org_login,
            provider_id,
            &pair.public_key_pem,
            &session_token,
        )?;
        if issued.key_version <= 0 || issued.provider_id != provider_id.as_str() {
            return Err("The broker returned an invalid team AI key response.".into());
        }
        let secret = crate::team_ai_crypto::decrypt(&issued.wrapped_key, &pair.private_key_pem)?;
        with_snapshot_write_lock(|| {
            require_current_session(&app, &session_token)?;
            if current_generation(&path, installation_id, provider_id) != generation {
                return Err(
                    "AI key access changed while this request was running. Retry the action."
                        .into(),
                );
            }
            let ticket = crate::util::random_token(48);
            let mut state = issuances().lock().unwrap_or_else(|p| p.into_inner());
            state
                .pending
                .retain(|_, p| p.created.elapsed().as_secs() < 60);
            if state.pending.len() >= 32 {
                return Err("Too many pending AI key requests. Retry shortly.".into());
            }
            state.pending.insert(
                ticket.clone(),
                PendingSecret {
                    path,
                    installation_id,
                    provider_id,
                    session: zeroize::Zeroizing::new(session_token),
                    secret,
                    version: issued.key_version,
                    generation,
                    created: std::time::Instant::now(),
                },
            );
            Ok(PendingSecretResult {
                ticket,
                key_version: issued.key_version,
            })
        })
    })
    .await
    .map_err(|_| "Could not issue the shared AI key.")?
}

#[tauri::command]
pub(crate) async fn finish_team_ai_provider_secret(
    app: AppHandle,
    ticket: String,
    commit: bool,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let pending = issuances()
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .pending
            .remove(&ticket);
        if !commit {
            return Ok(());
        }
        let pending = pending.ok_or("The pending AI key expired. Retry the action.")?;
        // Access refresh may contact the broker. Keep it outside the vault write lock.
        ensure_installation_allows_team_ai_access(&app, pending.installation_id)?;
        with_snapshot_write_lock(|| {
            require_current_session(&app, &pending.session)?;
            if pending.created.elapsed().as_secs() >= 60
                || current_generation(&pending.path, pending.installation_id, pending.provider_id)
                    != pending.generation
            {
                return Err(
                    "AI key access changed while this request was running. Retry the action."
                        .into(),
                );
            }
            ai_secret_storage::save_team_ai_cached_provider_secret_at_path(
                &pending.path,
                pending.installation_id,
                pending.provider_id,
                &pending.secret,
                pending.version,
            )
        })
    })
    .await
    .map_err(|_| "Could not finish the shared AI key request.")?
}

#[tauri::command]
pub(crate) async fn load_team_ai_provider_cache_status(
    app: AppHandle,
    installation_id: i64,
    provider_id: AiProviderId,
) -> Result<ProviderCacheStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ensure_installation_allows_team_ai_access(&app, installation_id)?;
        let cached = load_team_ai_cached_provider_secret_value(&app, installation_id, provider_id)?;
        Ok(ProviderCacheStatus {
            configured: cached.api_key.is_some(),
            key_version: cached.key_version,
        })
    })
    .await
    .map_err(|_| "Could not check the shared AI key cache.")?
}

#[tauri::command]
pub(crate) async fn clear_team_ai_credentials(
    app: AppHandle,
    installation_id: i64,
    session_token: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        with_snapshot_write_lock(|| {
            require_current_session(&app, &session_token)?;
            let path = stronghold_snapshot_path(&app)?;
            for provider in [
                AiProviderId::OpenAi,
                AiProviderId::Gemini,
                AiProviderId::Claude,
                AiProviderId::DeepSeek,
            ] {
                invalidate_provider(&path, Some(installation_id), provider);
            }
            crate::credential_vault::clear_team(&path, installation_id)
        })
    })
    .await
    .map_err(|_| "Could not remove the team's saved AI credentials.")?
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
                response_text.len(),
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
    #[test]
    fn cleared_provider_and_signout_invalidate_delayed_issuance() {
        use super::{
            current_generation, invalidate_provider, invalidate_session, issuances, PendingSecret,
        };
        use crate::ai_secret_storage::with_snapshot_write_lock;
        let path = std::path::PathBuf::from(format!("test-{}", uuid::Uuid::now_v7()));
        with_snapshot_write_lock(|| {
            let generation = current_generation(&path, 42, AiProviderId::OpenAi);
            let other_provider = current_generation(&path, 42, AiProviderId::Gemini);
            let other_team = current_generation(&path, 81, AiProviderId::OpenAi);
            issuances().lock().unwrap().pending.insert(
                "synthetic-ticket".into(),
                PendingSecret {
                    path: path.clone(),
                    installation_id: 42,
                    provider_id: AiProviderId::OpenAi,
                    session: zeroize::Zeroizing::new("synthetic-session".into()),
                    secret: zeroize::Zeroizing::new("synthetic-secret".into()),
                    version: 1,
                    generation,
                    created: std::time::Instant::now(),
                },
            );
            invalidate_provider(&path, Some(42), AiProviderId::OpenAi);
            assert_ne!(
                generation,
                current_generation(&path, 42, AiProviderId::OpenAi)
            );
            assert!(!issuances()
                .lock()
                .unwrap()
                .pending
                .contains_key("synthetic-ticket"));
            assert_eq!(
                other_provider,
                current_generation(&path, 42, AiProviderId::Gemini)
            );
            assert_eq!(
                other_team,
                current_generation(&path, 81, AiProviderId::OpenAi)
            );
            invalidate_session();
            assert_ne!(
                other_provider,
                current_generation(&path, 42, AiProviderId::Gemini)
            );
            Ok(())
        })
        .unwrap();
    }
    #[test]
    fn frontend_status_and_completion_payloads_contain_no_secret_fields() {
        assert_eq!(
            serde_json::to_value(super::ProviderCacheStatus {
                configured: true,
                key_version: Some(9)
            })
            .unwrap(),
            json!({"configured":true,"keyVersion":9})
        );
        assert_eq!(
            serde_json::to_value(super::PendingSecretResult {
                ticket: "synthetic-ticket".into(),
                key_version: 9
            })
            .unwrap(),
            json!({"ticket":"synthetic-ticket","keyVersion":9})
        );
    }
}
