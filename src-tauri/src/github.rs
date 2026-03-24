use std::{
  collections::HashSet,
  env,
  time::{SystemTime, UNIX_EPOCH},
};

use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{
  constants::{GITHUB_APP_SETUP_PATH, GITHUB_CALLBACK_ADDRESS, GNOSIS_TMS_ORG_DESCRIPTION},
  insecure_github_app_config::{
    INSECURE_GITHUB_APP_ID, INSECURE_GITHUB_APP_PRIVATE_KEY, INSECURE_GITHUB_APP_SLUG,
  },
  state::{AuthState, PendingGithubAppInstall},
};

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GithubOrganization {
  pub(crate) login: String,
  pub(crate) name: Option<String>,
  pub(crate) description: Option<String>,
  pub(crate) avatar_url: Option<String>,
  pub(crate) html_url: Option<String>,
}

#[derive(Deserialize)]
struct GithubOrganizationMembership {
  state: String,
  organization: GithubOrganizationMembershipOrg,
}

#[derive(Deserialize)]
struct GithubOrganizationMembershipOrg {
  login: String,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GithubOrgDiagnostics {
  oauth_scopes: Vec<String>,
  accepted_oauth_scopes: Vec<String>,
  user_org_logins: Vec<String>,
  membership_org_logins: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BeginGithubAppInstallResponse {
  install_url: String,
  setup_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GithubAppInstallationInfo {
  pub(crate) installation_id: i64,
  pub(crate) account_login: String,
  pub(crate) account_type: String,
  pub(crate) account_avatar_url: Option<String>,
  pub(crate) account_html_url: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GithubAppInstallationResponse {
  id: i64,
  account: GithubAppInstallationAccount,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GithubAppInstallationAccount {
  login: String,
  #[serde(rename = "type")]
  account_type: String,
  avatar_url: Option<String>,
  html_url: Option<String>,
}

#[derive(Serialize)]
struct GithubAppJwtClaims {
  iat: usize,
  exp: usize,
  iss: String,
}

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

#[tauri::command]
pub(crate) fn list_user_organizations(
  access_token: String,
) -> Result<Vec<GithubOrganization>, String> {
  let client = github_client()?;
  let organizations = client
    .get("https://api.github.com/user/orgs")
    .bearer_auth(&access_token)
    .header("Accept", "application/vnd.github+json")
    .query(&[("per_page", "100")])
    .send()
    .map_err(|error| format!("Could not list your GitHub organizations: {error}"))?
    .error_for_status()
    .map_err(|error| format!("GitHub rejected the organization list request: {error}"))?
    .json::<Vec<GithubOrganization>>()
    .map_err(|error| format!("Could not parse your GitHub organizations: {error}"))?;

  let memberships = client
    .get("https://api.github.com/user/memberships/orgs")
    .bearer_auth(&access_token)
    .header("Accept", "application/vnd.github+json")
    .query(&[("state", "active"), ("per_page", "100")])
    .send()
    .map_err(|error| format!("Could not list your GitHub organization memberships: {error}"))?
    .error_for_status()
    .map_err(|error| format!("GitHub rejected the organization membership request: {error}"))?
    .json::<Vec<GithubOrganizationMembership>>()
    .map_err(|error| format!("Could not parse your GitHub organization memberships: {error}"))?;

  let mut seen = HashSet::new();
  let mut org_logins = Vec::new();

  for organization in organizations {
    if seen.insert(organization.login.clone()) {
      org_logins.push(organization.login);
    }
  }

  for membership in memberships {
    if membership.state == "active" && seen.insert(membership.organization.login.clone()) {
      org_logins.push(membership.organization.login);
    }
  }

  org_logins
    .into_iter()
    .map(|organization_login| {
      get_organization_details(&client, &access_token, &organization_login)
    })
    .collect()
}

#[tauri::command]
pub(crate) fn inspect_github_organization_access(
  access_token: String,
) -> Result<GithubOrgDiagnostics, String> {
  let client = github_client()?;
  let user_orgs_response = client
    .get("https://api.github.com/user/orgs")
    .bearer_auth(&access_token)
    .header("Accept", "application/vnd.github+json")
    .query(&[("per_page", "100")])
    .send()
    .map_err(|error| format!("Could not inspect your GitHub organizations: {error}"))?
    .error_for_status()
    .map_err(|error| format!("GitHub rejected the organization inspection request: {error}"))?;

  let oauth_scopes = parse_scope_header(user_orgs_response.headers().get("x-oauth-scopes"));
  let accepted_oauth_scopes =
    parse_scope_header(user_orgs_response.headers().get("x-accepted-oauth-scopes"));
  let user_org_logins = user_orgs_response
    .json::<Vec<GithubOrganization>>()
    .map_err(|error| format!("Could not parse your GitHub organizations: {error}"))?
    .into_iter()
    .map(|organization| organization.login)
    .collect();

  let membership_org_logins = client
    .get("https://api.github.com/user/memberships/orgs")
    .bearer_auth(&access_token)
    .header("Accept", "application/vnd.github+json")
    .query(&[("state", "active"), ("per_page", "100")])
    .send()
    .map_err(|error| format!("Could not inspect your GitHub organization memberships: {error}"))?
    .error_for_status()
    .map_err(|error| {
      format!("GitHub rejected the organization membership inspection request: {error}")
    })?
    .json::<Vec<GithubOrganizationMembership>>()
    .map_err(|error| format!("Could not parse your GitHub organization memberships: {error}"))?
    .into_iter()
    .filter(|membership| membership.state == "active")
    .map(|membership| membership.organization.login)
    .collect();

  Ok(GithubOrgDiagnostics {
    oauth_scopes,
    accepted_oauth_scopes,
    user_org_logins,
    membership_org_logins,
  })
}

#[tauri::command]
pub(crate) fn inspect_github_app_installation(
  installation_id: i64,
) -> Result<GithubAppInstallationInfo, String> {
  let app_jwt = github_app_jwt()?;
  let client = github_client()?;
  let installation = client
    .get(format!(
      "https://api.github.com/app/installations/{installation_id}"
    ))
    .header("Accept", "application/vnd.github+json")
    .bearer_auth(app_jwt)
    .send()
    .map_err(|error| format!("Could not inspect the GitHub App installation: {error}"))?
    .error_for_status()
    .map_err(|error| format!("GitHub rejected the GitHub App installation request: {error}"))?
    .json::<GithubAppInstallationResponse>()
    .map_err(|error| format!("Could not parse the GitHub App installation: {error}"))?;

  Ok(GithubAppInstallationInfo {
    installation_id: installation.id,
    account_login: installation.account.login,
    account_type: installation.account.account_type,
    account_avatar_url: installation.account.avatar_url,
    account_html_url: installation.account.html_url,
  })
}

#[tauri::command]
pub(crate) fn mark_gnosis_tms_organization(
  access_token: String,
  org_login: String,
  description: String,
) -> Result<GithubOrganization, String> {
  let client = github_client()?;
  let normalized_description = if description.trim().is_empty() {
    GNOSIS_TMS_ORG_DESCRIPTION.to_string()
  } else {
    description
  };

  client
    .patch(format!("https://api.github.com/orgs/{org_login}"))
    .bearer_auth(&access_token)
    .header("Accept", "application/vnd.github+json")
    .json(&serde_json::json!({
      "description": normalized_description,
    }))
    .send()
    .map_err(|error| format!("Could not update the GitHub organization description: {error}"))?
    .error_for_status()
    .map_err(|error| format!("GitHub rejected the organization update: {error}"))?;

  get_organization_details(&client, &access_token, &org_login)
}

pub(crate) fn github_client() -> Result<reqwest::blocking::Client, String> {
  reqwest::blocking::Client::builder()
    .user_agent("GnosisTMS")
    .build()
    .map_err(|error| error.to_string())
}

pub(crate) fn get_organization_details(
  client: &reqwest::blocking::Client,
  access_token: &str,
  org_login: &str,
) -> Result<GithubOrganization, String> {
  client
    .get(format!("https://api.github.com/orgs/{org_login}"))
    .bearer_auth(access_token)
    .header("Accept", "application/vnd.github+json")
    .send()
    .map_err(|error| {
      format!("Could not load details for GitHub organization @{org_login}: {error}")
    })?
    .error_for_status()
    .map_err(|error| {
      format!("GitHub rejected the organization lookup for @{org_login}: {error}")
    })?
    .json::<GithubOrganization>()
    .map_err(|error| {
      format!("Could not parse the details for GitHub organization @{org_login}: {error}")
    })
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

fn parse_scope_header(header_value: Option<&reqwest::header::HeaderValue>) -> Vec<String> {
  header_value
    .and_then(|value| value.to_str().ok())
    .map(|value| {
      value
        .split(',')
        .map(|scope| scope.trim())
        .filter(|scope| !scope.is_empty())
        .map(ToString::to_string)
        .collect()
    })
    .unwrap_or_default()
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
