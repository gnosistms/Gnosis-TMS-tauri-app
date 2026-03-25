use std::{
  env,
  time::{SystemTime, UNIX_EPOCH},
};

use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use tauri::State;

use crate::{
  constants::{GITHUB_APP_SETUP_PATH, GITHUB_CALLBACK_ADDRESS},
  insecure_github_app_config::{
    INSECURE_GITHUB_APP_ID, INSECURE_GITHUB_APP_PRIVATE_KEY, INSECURE_GITHUB_APP_SLUG,
  },
  state::{AuthState, PendingGithubAppInstall},
};

use super::types::{
  BeginGithubAppInstallResponse, GithubAppJwtClaims, GithubInstallationTokenResponse,
};

#[tauri::command]
pub(crate) fn begin_github_app_install(
  state: State<'_, AuthState>,
) -> Result<BeginGithubAppInstallResponse, String> {
  let app_slug = github_app_slug()?;
  let csrf_state = random_token(32);
  let install_url = format!(
    "https://github.com/apps/{app_slug}/installations/new?state={csrf_state}"
  );

  let mut pending = state
    .pending_github_app_install
    .lock()
    .map_err(|_| "Could not prepare the GitHub App installation flow.".to_string())?;
  *pending = Some(PendingGithubAppInstall { csrf_state });

  Ok(BeginGithubAppInstallResponse {
    install_url,
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

pub(crate) fn github_app_jwt() -> Result<String, String> {
  let app_id = github_app_id()?;
  let private_key = github_app_private_key()?;
  let now = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map_err(|error| format!("Could not determine the current time: {error}"))?
    .as_secs() as usize;
  let claims = GithubAppJwtClaims {
    iat: now.saturating_sub(60),
    exp: now + 540,
    iss: app_id,
  };
  let mut header = Header::new(Algorithm::RS256);
  header.typ = Some("JWT".into());
  encode(
    &header,
    &claims,
    &EncodingKey::from_rsa_pem(private_key.as_bytes())
      .map_err(|error| format!("Could not read the GitHub App private key: {error}"))?,
  )
  .map_err(|error| format!("Could not create the GitHub App JWT: {error}"))
}

pub(crate) fn github_installation_access_token(installation_id: i64) -> Result<String, String> {
  let app_jwt = github_app_jwt()?;
  let client = github_client()?;
  let response = client
    .post(format!(
      "https://api.github.com/app/installations/{installation_id}/access_tokens"
    ))
    .header("Accept", "application/vnd.github+json")
    .header("X-GitHub-Api-Version", "2022-11-28")
    .bearer_auth(app_jwt)
    .send()
    .map_err(|error| format!("Could not create a GitHub App installation token: {error}"))?
    .error_for_status()
    .map_err(|error| format!("GitHub rejected the installation token request: {error}"))?
    .json::<GithubInstallationTokenResponse>()
    .map_err(|error| format!("Could not parse the installation token response: {error}"))?;

  Ok(response.token)
}

fn github_app_id() -> Result<String, String> {
  env_or_insecure_fallback(
    "GITHUB_APP_ID",
    INSECURE_GITHUB_APP_ID,
    "Missing GitHub App ID. Set GITHUB_APP_ID or add a temporary value in src-tauri/src/insecure_github_app_config.rs before starting Gnosis TMS.",
  )
}

fn github_app_slug() -> Result<String, String> {
  env_or_insecure_fallback(
    "GITHUB_APP_SLUG",
    INSECURE_GITHUB_APP_SLUG,
    "Missing GitHub App slug. Set GITHUB_APP_SLUG or add a temporary value in src-tauri/src/insecure_github_app_config.rs before starting Gnosis TMS.",
  )
}

fn github_app_private_key() -> Result<String, String> {
  env_or_insecure_fallback(
    "GITHUB_APP_PRIVATE_KEY",
    INSECURE_GITHUB_APP_PRIVATE_KEY,
    "Missing GitHub App private key. Set GITHUB_APP_PRIVATE_KEY or add a temporary value in src-tauri/src/insecure_github_app_config.rs before starting Gnosis TMS.",
  )
  .map(|value| value.replace("\\n", "\n"))
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
