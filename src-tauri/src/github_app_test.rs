use std::env;

use reqwest::blocking::RequestBuilder;
use serde::Serialize;
use tauri::State;
use url::Url;

use crate::{
    constants::{GITHUB_APP_SETUP_PATH, GITHUB_CALLBACK_ADDRESS},
    github::{
        github_client,
        types::{BeginGithubAppInstallResponse, GithubAppInstallationInfo, GithubRepository},
    },
    insecure_github_app_config::{
        INSECURE_GITHUB_APP_BROKER_BASE_URL, INSECURE_GITHUB_APP_BROKER_TOKEN,
    },
    state::{AuthState, PendingGithubAppInstall},
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GithubAppTestConfig {
    broker_base_url: String,
    callback_url: String,
    start_url: String,
    inspect_installation_template: String,
    list_repositories_template: String,
}

#[tauri::command]
pub(crate) fn get_github_app_test_config() -> Result<GithubAppTestConfig, String> {
    let broker_base_url = github_app_broker_base_url()?;

    Ok(GithubAppTestConfig {
        broker_base_url: broker_base_url.to_string(),
        callback_url: github_app_test_callback_url(),
        start_url: broker_path_url("/github-app/install/start")?.to_string(),
        inspect_installation_template: broker_path_url(
            "/api/github-app/installations/{installation_id}",
        )?
        .to_string(),
        list_repositories_template: broker_path_url(
            "/api/github-app/installations/{installation_id}/repositories",
        )?
        .to_string(),
    })
}

#[tauri::command]
pub(crate) fn begin_github_app_test_install(
    state: State<'_, AuthState>,
) -> Result<BeginGithubAppInstallResponse, String> {
    let csrf_state = random_token(32);
    let mut install_url = broker_path_url("/github-app/install/start")?;
    install_url
        .query_pairs_mut()
        .append_pair("state", &csrf_state)
        .append_pair("desktop_redirect_uri", &github_app_test_callback_url());

    let mut pending = state
        .pending_github_app_install
        .lock()
        .map_err(|_| "Could not prepare the GitHub App test flow.".to_string())?;
    *pending = Some(PendingGithubAppInstall { csrf_state });

    Ok(BeginGithubAppInstallResponse {
        install_url: install_url.to_string(),
        setup_url: github_app_test_callback_url(),
    })
}

#[tauri::command]
pub(crate) fn inspect_github_app_test_installation(
    installation_id: i64,
) -> Result<GithubAppInstallationInfo, String> {
    let client = github_client()?;
    let response = with_optional_broker_token(client.get(broker_path_url(&format!(
        "/api/github-app/installations/{installation_id}"
    ))?))
    .header("Accept", "application/json")
    .send()
    .map_err(|error| {
        format!("Could not inspect the GitHub App installation through the broker: {error}")
    })?
    .error_for_status()
    .map_err(|error| format!("The broker rejected the installation inspection request: {error}"))?;

    response
        .json::<GithubAppInstallationInfo>()
        .map_err(|error| format!("Could not read the broker installation response: {error}"))
}

#[tauri::command]
pub(crate) fn list_github_app_test_repositories(
    installation_id: i64,
) -> Result<Vec<GithubRepository>, String> {
    let client = github_client()?;
    let response = with_optional_broker_token(client.get(broker_path_url(&format!(
        "/api/github-app/installations/{installation_id}/repositories"
    ))?))
    .header("Accept", "application/json")
    .send()
    .map_err(|error| format!("Could not list repositories through the broker: {error}"))?
    .error_for_status()
    .map_err(|error| format!("The broker rejected the repository list request: {error}"))?;

    response
        .json::<Vec<GithubRepository>>()
        .map_err(|error| format!("Could not read the broker repository list: {error}"))
}

fn github_app_test_callback_url() -> String {
    format!("http://{GITHUB_CALLBACK_ADDRESS}{GITHUB_APP_SETUP_PATH}")
}

fn github_app_broker_base_url() -> Result<Url, String> {
    let raw = env_or_insecure_fallback(
    "GITHUB_APP_BROKER_BASE_URL",
    INSECURE_GITHUB_APP_BROKER_BASE_URL,
    "Missing GitHub App broker base URL. Set GITHUB_APP_BROKER_BASE_URL so the desktop test app can use your DigitalOcean service.",
  )?;

    let mut url = Url::parse(&raw)
        .map_err(|error| format!("GITHUB_APP_BROKER_BASE_URL is not a valid URL: {error}"))?;
    url.set_query(None);
    url.set_fragment(None);
    Ok(url)
}

fn github_app_broker_token() -> Option<String> {
    env::var("GITHUB_APP_BROKER_TOKEN")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            let trimmed = INSECURE_GITHUB_APP_BROKER_TOKEN.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        })
}

fn broker_path_url(path: &str) -> Result<Url, String> {
    let mut url = github_app_broker_base_url()?;
    let base_path = url.path().trim_end_matches('/');
    let next_path = if base_path.is_empty() || base_path == "/" {
        path.to_string()
    } else {
        format!("{base_path}/{}", path.trim_start_matches('/'))
    };
    url.set_path(&next_path);
    Ok(url)
}

fn with_optional_broker_token(request: RequestBuilder) -> RequestBuilder {
    match github_app_broker_token() {
        Some(token) => request.bearer_auth(token),
        None => request,
    }
}

fn random_token(length: usize) -> String {
    use rand::{distributions::Alphanumeric, Rng};

    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(length)
        .map(char::from)
        .collect()
}

fn env_or_insecure_fallback(
    env_name: &str,
    insecure_fallback: &str,
    missing_message: &str,
) -> Result<String, String> {
    env::var(env_name)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            let trimmed = insecure_fallback.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        })
        .ok_or_else(|| missing_message.to_string())
}
