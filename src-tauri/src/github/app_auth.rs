use tauri::State;

use crate::{
    broker::broker_base_url,
    constants::{GITHUB_APP_SETUP_PATH, GITHUB_CALLBACK_ADDRESS},
    state::{AuthState, PendingGithubAppInstall},
};

use super::types::BeginGithubAppInstallResponse;

#[tauri::command]
pub(crate) fn begin_github_app_install(
    state: State<'_, AuthState>,
) -> Result<BeginGithubAppInstallResponse, String> {
    let csrf_state = random_token(32);
    let mut install_url = broker_base_url()?;
    install_url.set_path("/github-app/install/start");
    install_url
        .query_pairs_mut()
        .append_pair("state", &csrf_state)
        .append_pair("desktop_redirect_uri", &github_app_setup_url());

    let mut pending = state
        .pending_github_app_install
        .lock()
        .map_err(|_| "Could not prepare the GitHub App installation flow.".to_string())?;
    *pending = Some(PendingGithubAppInstall { csrf_state });

    Ok(BeginGithubAppInstallResponse {
        install_url: install_url.to_string(),
        setup_url: github_app_setup_url(),
    })
}

pub(crate) fn github_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .user_agent("GnosisTMS")
        .build()
        .map_err(|error| error.to_string())
}

pub(crate) fn github_app_setup_url() -> String {
    format!("http://{GITHUB_CALLBACK_ADDRESS}{GITHUB_APP_SETUP_PATH}")
}

fn random_token(length: usize) -> String {
    use rand::{distributions::Alphanumeric, Rng};

    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(length)
        .map(char::from)
        .collect()
}
