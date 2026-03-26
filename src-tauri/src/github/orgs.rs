use crate::broker::{
  broker_delete_no_content_with_session, broker_get_json_with_session,
  broker_patch_json_with_session,
};

use super::{
  app_auth::github_client,
  types::{
    GithubAppInstallationInfo, GithubOrganization, GithubOrganizationMember,
    GithubOrganizationMembership,
  },
};

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

  let mut seen = std::collections::HashSet::new();
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
    .map(|organization_login| get_organization_details(&client, &access_token, &organization_login))
    .collect()
}

#[tauri::command]
pub(crate) fn inspect_github_app_installation(
  installation_id: i64,
  session_token: String,
) -> Result<GithubAppInstallationInfo, String> {
  let client = github_client()?;
  broker_get_json_with_session(
    &client,
    &format!("/api/github-app/installations/{installation_id}"),
    &session_token,
  )
}

#[tauri::command]
pub(crate) fn list_organization_members_for_installation(
  installation_id: i64,
  org_login: String,
  session_token: String,
) -> Result<Vec<GithubOrganizationMember>, String> {
  let client = github_client()?;
  broker_get_json_with_session(
    &client,
    &format!(
      "/api/github-app/installations/{installation_id}/members?org_login={org_login}"
    ),
    &session_token,
  )
}

#[tauri::command]
pub(crate) fn update_organization_name_for_installation(
  installation_id: i64,
  org_login: String,
  name: String,
  session_token: String,
) -> Result<GithubOrganization, String> {
  let client = github_client()?;
  broker_patch_json_with_session(
    &client,
    &format!("/api/github-app/installations/{installation_id}/orgs/{org_login}"),
    &serde_json::json!({
      "name": name
    }),
    &session_token,
  )
}

#[tauri::command]
pub(crate) fn delete_organization_for_installation(
  installation_id: i64,
  org_login: String,
  session_token: String,
) -> Result<(), String> {
  let client = github_client()?;
  broker_delete_no_content_with_session(
    &client,
    &format!("/api/github-app/installations/{installation_id}/orgs/{org_login}"),
    &serde_json::json!({}),
    &session_token,
  )
}

#[tauri::command]
pub(crate) fn leave_organization_for_installation(
  installation_id: i64,
  org_login: String,
  session_token: String,
) -> Result<(), String> {
  let client = github_client()?;
  broker_delete_no_content_with_session(
    &client,
    &format!(
      "/api/github-app/installations/{installation_id}/orgs/{org_login}/membership"
    ),
    &serde_json::json!({}),
    &session_token,
  )
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
