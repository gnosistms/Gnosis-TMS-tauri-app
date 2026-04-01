use std::env;

use reqwest::blocking::{Client, Response};
use reqwest::StatusCode;
use serde::de::DeserializeOwned;
use url::Url;

use crate::insecure_github_app_config::{
  INSECURE_GITHUB_APP_BROKER_BASE_URL,
};

pub(crate) fn broker_base_url() -> Result<Url, String> {
  let raw = env_or_insecure_fallback(
    "GITHUB_APP_BROKER_BASE_URL",
    INSECURE_GITHUB_APP_BROKER_BASE_URL,
    "Missing GitHub App broker base URL. Set GITHUB_APP_BROKER_BASE_URL so Gnosis TMS can use your DigitalOcean service.",
  )?;

  let mut url = Url::parse(&raw)
    .map_err(|error| format!("GITHUB_APP_BROKER_BASE_URL is not a valid URL: {error}"))?;
  url.set_query(None);
  url.set_fragment(None);
  Ok(url)
}

pub(crate) fn broker_path_url(path: &str) -> Result<Url, String> {
  let mut url = broker_base_url()?;
  let (path_only, query) = path.split_once('?').map_or((path, None), |(next_path, next_query)| {
    (next_path, Some(next_query))
  });
  let base_path = url.path().trim_end_matches('/');
  let next_path = if base_path.is_empty() || base_path == "/" {
    path_only.to_string()
  } else {
    format!("{base_path}/{}", path_only.trim_start_matches('/'))
  };
  url.set_path(&next_path);
  url.set_query(query);
  Ok(url)
}

pub(crate) fn broker_get_json_with_session<T: DeserializeOwned>(
  client: &Client,
  path: &str,
  session_token: &str,
) -> Result<T, String> {
  let response = client
    .get(broker_path_url(path)?)
    .header("Accept", "application/json")
    .bearer_auth(session_token)
    .send()
    .map_err(|error| format!("Could not reach the GitHub App broker: {error}"))?;

  parse_json_response(response)
}

pub(crate) fn broker_post_json_with_session<T: DeserializeOwned>(
  client: &Client,
  path: &str,
  body: &serde_json::Value,
  session_token: &str,
) -> Result<T, String> {
  let response = client
    .post(broker_path_url(path)?)
    .header("Accept", "application/json")
    .bearer_auth(session_token)
    .json(body)
    .send()
    .map_err(|error| format!("Could not reach the GitHub App broker: {error}"))?;

  parse_json_response(response)
}

pub(crate) fn broker_post_no_content_with_session(
  client: &Client,
  path: &str,
  body: &serde_json::Value,
  session_token: &str,
) -> Result<(), String> {
  let response = client
    .post(broker_path_url(path)?)
    .header("Accept", "application/json")
    .bearer_auth(session_token)
    .json(body)
    .send()
    .map_err(|error| format!("Could not reach the GitHub App broker: {error}"))?;

  parse_empty_response(response)
}

pub(crate) fn broker_patch_json_with_session<T: DeserializeOwned>(
  client: &Client,
  path: &str,
  body: &serde_json::Value,
  session_token: &str,
) -> Result<T, String> {
  let response = client
    .patch(broker_path_url(path)?)
    .header("Accept", "application/json")
    .bearer_auth(session_token)
    .json(body)
    .send()
    .map_err(|error| format!("Could not reach the GitHub App broker: {error}"))?;

  parse_json_response(response)
}

pub(crate) fn broker_patch_no_content_with_session(
  client: &Client,
  path: &str,
  body: Option<&serde_json::Value>,
  session_token: &str,
) -> Result<(), String> {
  let mut request = client
    .patch(broker_path_url(path)?)
    .header("Accept", "application/json")
    .bearer_auth(session_token);
  if let Some(value) = body {
    request = request.json(value);
  }

  let response = request
    .send()
    .map_err(|error| format!("Could not reach the GitHub App broker: {error}"))?;

  parse_empty_response(response)
}

pub(crate) fn broker_delete_no_content_with_session(
  client: &Client,
  path: &str,
  body: &serde_json::Value,
  session_token: &str,
) -> Result<(), String> {
  let response = client
    .delete(broker_path_url(path)?)
    .header("Accept", "application/json")
    .bearer_auth(session_token)
    .json(body)
    .send()
    .map_err(|error| format!("Could not reach the GitHub App broker: {error}"))?;

  parse_empty_response(response)
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

fn parse_json_response<T: DeserializeOwned>(response: Response) -> Result<T, String> {
  let status = response.status();
  let body = response
    .text()
    .map_err(|error| format!("Could not read the GitHub App broker response: {error}"))?;

  if status == StatusCode::UNAUTHORIZED {
    return Err(format!(
      "{BROKER_AUTH_REQUIRED_PREFIX}Your GitHub session expired. Please sign in again."
    ));
  }

  if !status.is_success() {
    return Err(parse_broker_error_body(&body).unwrap_or_else(|| {
      format!("GitHub App broker request failed with status {status}: {body}")
    }));
  }

  serde_json::from_str::<T>(&body)
    .map_err(|error| format!("Could not parse the GitHub App broker response: {error}"))
}

fn parse_empty_response(response: Response) -> Result<(), String> {
  let status = response.status();
  if status.is_success() {
    return Ok(());
  }

  let body = response
    .text()
    .map_err(|error| format!("Could not read the GitHub App broker error response: {error}"))?;

  if status == StatusCode::UNAUTHORIZED {
    return Err(format!(
      "{BROKER_AUTH_REQUIRED_PREFIX}Your GitHub session expired. Please sign in again."
    ));
  }

  Err(parse_broker_error_body(&body)
    .unwrap_or_else(|| format!("GitHub App broker request failed with status {status}: {body}")))
}

fn parse_broker_error_body(body: &str) -> Option<String> {
  serde_json::from_str::<serde_json::Value>(body)
    .ok()
    .and_then(|value| value.get("error").and_then(|item| item.as_str()).map(str::to_string))
}
pub(crate) const BROKER_AUTH_REQUIRED_PREFIX: &str = "AUTH_REQUIRED:";
