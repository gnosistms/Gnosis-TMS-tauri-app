use std::env;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::{distributions::Alphanumeric, Rng};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{Emitter, State};
use url::Url;

use crate::{
  constants::{GITHUB_CALLBACK_ADDRESS, GITHUB_CALLBACK_EVENT, GITHUB_CALLBACK_PATH},
  github::github_client,
  insecure_github_app_config::{INSECURE_GITHUB_CLIENT_ID, INSECURE_GITHUB_CLIENT_SECRET},
  state::{AuthState, PendingOauth},
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BeginOauthResponse {
  auth_url: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GithubSession {
  pub(crate) access_token: String,
  pub(crate) login: String,
  pub(crate) name: Option<String>,
  pub(crate) avatar_url: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AuthEventPayload {
  pub(crate) status: &'static str,
  pub(crate) message: String,
  pub(crate) session: Option<GithubSession>,
}

#[derive(Serialize)]
struct TokenExchangeRequest<'a> {
  client_id: &'a str,
  client_secret: &'a str,
  code: &'a str,
  redirect_uri: &'a str,
  code_verifier: &'a str,
}

#[derive(Deserialize)]
struct TokenExchangeResponse {
  access_token: Option<String>,
  error: Option<String>,
  error_description: Option<String>,
}

#[derive(Deserialize)]
struct GithubUserResponse {
  login: String,
  name: Option<String>,
  avatar_url: Option<String>,
}

#[tauri::command]
pub(crate) fn begin_github_oauth(
  state: State<'_, AuthState>,
) -> Result<BeginOauthResponse, String> {
  let client_id = github_client_id()?;
  let csrf_state = random_token(32);
  let pkce_verifier = random_token(96);
  let code_challenge = pkce_challenge(&pkce_verifier);
  let redirect_uri = github_redirect_uri();

  let auth_url = Url::parse_with_params(
    "https://github.com/login/oauth/authorize",
    &[
      ("client_id", client_id.as_str()),
      ("redirect_uri", redirect_uri.as_str()),
      ("scope", "user user:email repo read:org write:org admin:org"),
      ("state", csrf_state.as_str()),
      ("code_challenge", code_challenge.as_str()),
      ("code_challenge_method", "S256"),
    ],
  )
  .map_err(|error| error.to_string())?;

  let mut pending = state
    .pending_oauth
    .lock()
    .map_err(|_| "Could not prepare GitHub sign-in.".to_string())?;
  *pending = Some(PendingOauth {
    csrf_state,
    pkce_verifier,
  });

  Ok(BeginOauthResponse {
    auth_url: auth_url.into(),
  })
}

pub(crate) fn github_client_id() -> Result<String, String> {
  env_or_insecure_fallback(
    "GITHUB_CLIENT_ID",
    INSECURE_GITHUB_CLIENT_ID,
    "Missing GitHub OAuth client ID. Set GITHUB_CLIENT_ID or add a temporary value in src-tauri/src/insecure_github_app_config.rs before starting Gnosis TMS.",
  )
}

fn github_client_secret() -> Result<String, String> {
  env_or_insecure_fallback(
    "GITHUB_CLIENT_SECRET",
    INSECURE_GITHUB_CLIENT_SECRET,
    "Missing GitHub OAuth client secret. Set GITHUB_CLIENT_SECRET or add a temporary value in src-tauri/src/insecure_github_app_config.rs before starting Gnosis TMS.",
  )
}

pub(crate) fn github_redirect_uri() -> String {
  format!("http://{GITHUB_CALLBACK_ADDRESS}{GITHUB_CALLBACK_PATH}")
}

pub(crate) fn exchange_github_code(
  code: &str,
  pkce_verifier: &str,
) -> Result<GithubSession, String> {
  let client_id = github_client_id()?;
  let client_secret = github_client_secret()?;
  let client = github_client()?;

  let token_response = client
    .post("https://github.com/login/oauth/access_token")
    .header("Accept", "application/json")
    .json(&TokenExchangeRequest {
      client_id: client_id.as_str(),
      client_secret: client_secret.as_str(),
      code,
      redirect_uri: github_redirect_uri().as_str(),
      code_verifier: pkce_verifier,
    })
    .send()
    .map_err(|error| format!("GitHub token exchange failed: {error}"))?;

  let token_payload: TokenExchangeResponse = token_response
    .json()
    .map_err(|error| format!("Could not read the GitHub token response: {error}"))?;

  let access_token = match token_payload.access_token {
    Some(token) => token,
    None => {
      return Err(
        token_payload
          .error_description
          .or(token_payload.error)
          .unwrap_or_else(|| "GitHub did not return an access token.".to_string()),
      )
    }
  };

  let user = client
    .get("https://api.github.com/user")
    .bearer_auth(&access_token)
    .header("Accept", "application/vnd.github+json")
    .send()
    .map_err(|error| format!("Could not fetch the GitHub user profile: {error}"))?
    .json::<GithubUserResponse>()
    .map_err(|error| format!("Could not read the GitHub user profile: {error}"))?;

  Ok(GithubSession {
    access_token,
    login: user.login,
    name: user.name,
    avatar_url: user.avatar_url,
  })
}

pub(crate) fn emit_auth_event(app: &tauri::AppHandle, payload: AuthEventPayload) {
  let _ = app.emit(GITHUB_CALLBACK_EVENT, payload);
}

fn random_token(length: usize) -> String {
  rand::thread_rng()
    .sample_iter(&Alphanumeric)
    .take(length)
    .map(char::from)
    .collect()
}

fn pkce_challenge(verifier: &str) -> String {
  let digest = Sha256::digest(verifier.as_bytes());
  URL_SAFE_NO_PAD.encode(digest)
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
