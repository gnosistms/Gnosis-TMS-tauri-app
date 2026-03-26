use tauri::State;

use crate::{
  broker::{broker_base_url, broker_get_json_with_session},
  constants::{BROKER_AUTH_CALLBACK_PATH, GITHUB_CALLBACK_ADDRESS},
  state::{AuthState, PendingBrokerAuth},
};

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrokerSession {
  pub(crate) session_token: String,
  pub(crate) login: String,
  pub(crate) name: Option<String>,
  pub(crate) avatar_url: Option<String>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrokerSessionProfile {
  pub(crate) login: String,
  pub(crate) name: Option<String>,
  pub(crate) avatar_url: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BeginBrokerAuthResponse {
  pub(crate) auth_url: String,
}

#[tauri::command]
pub(crate) fn begin_broker_auth(
  state: State<'_, AuthState>,
) -> Result<BeginBrokerAuthResponse, String> {
  let csrf_state = random_token(32);
  let mut auth_url = broker_base_url()?;
  auth_url.set_path("/auth/github/start");
  auth_url
    .query_pairs_mut()
    .append_pair("state", &csrf_state)
    .append_pair("desktop_redirect_uri", &broker_auth_callback_url());

  let mut pending = state
    .pending_broker_auth
    .lock()
    .map_err(|_| "Could not prepare broker sign-in.".to_string())?;
  *pending = Some(PendingBrokerAuth { csrf_state });

  Ok(BeginBrokerAuthResponse {
    auth_url: auth_url.to_string(),
  })
}

#[tauri::command]
pub(crate) fn inspect_broker_auth_session(
  session_token: String,
) -> Result<BrokerSessionProfile, String> {
  let client = reqwest::blocking::Client::builder()
    .user_agent("GnosisTMS")
    .build()
    .map_err(|error| error.to_string())?;
  broker_get_json_with_session(&client, "/api/auth/session", &session_token)
}

pub(crate) fn broker_auth_callback_url() -> String {
  format!("http://{GITHUB_CALLBACK_ADDRESS}{BROKER_AUTH_CALLBACK_PATH}")
}

fn random_token(length: usize) -> String {
  use rand::{distributions::Alphanumeric, Rng};

  rand::thread_rng()
    .sample_iter(&Alphanumeric)
    .take(length)
    .map(char::from)
    .collect()
}
