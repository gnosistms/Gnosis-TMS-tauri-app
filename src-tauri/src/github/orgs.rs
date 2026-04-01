use crate::broker::{
  broker_delete_no_content_with_session, broker_get_json_with_session,
  broker_patch_json_with_session, broker_post_json_with_session,
};

use super::{
  app_auth::github_client,
  types::{
    GithubAppInstallationInfo, GithubOrganization, GithubOrganizationInvitation,
    GithubOrganizationMember, GithubOrganizationMembership, GithubUserSearchResult,
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
pub(crate) async fn search_github_users_for_installation(
  installation_id: i64,
  query: String,
  session_token: String,
) -> Result<Vec<GithubUserSearchResult>, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let client = github_client()?;
    let encoded_query: String = url::form_urlencoded::byte_serialize(query.as_bytes()).collect();
    broker_get_json_with_session(
      &client,
      &format!("/api/github-app/installations/{installation_id}/user-search?q={encoded_query}"),
      &session_token,
    )
  })
  .await
  .map_err(|error| format!("Could not run the GitHub user search task: {error}"))?
}

#[tauri::command]
pub(crate) fn invite_user_to_organization_for_installation(
  installation_id: i64,
  org_login: String,
  invitee_id: Option<i64>,
  invitee_login: Option<String>,
  invitee_email: Option<String>,
  session_token: String,
) -> Result<GithubOrganizationInvitation, String> {
  let client = github_client()?;
  broker_post_json_with_session(
    &client,
    &format!("/api/github-app/installations/{installation_id}/orgs/{org_login}/invitations"),
    &serde_json::json!({
      "inviteeId": invitee_id,
      "inviteeLogin": invitee_login,
      "inviteeEmail": invitee_email,
    }),
    &session_token,
  )
}

#[tauri::command]
pub(crate) async fn update_organization_name_for_installation(
  installation_id: i64,
  org_login: String,
  name: String,
  session_token: String,
) -> Result<GithubOrganization, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let client = github_client()?;
    broker_patch_json_with_session(
      &client,
      &format!("/api/github-app/installations/{installation_id}/orgs/{org_login}"),
      &serde_json::json!({
        "name": name
      }),
      &session_token,
    )
  })
  .await
  .map_err(|error| format!("Could not run the organization rename task: {error}"))?
}

#[tauri::command]
pub(crate) async fn update_organization_description_for_installation(
  installation_id: i64,
  org_login: String,
  description: Option<String>,
  session_token: String,
) -> Result<GithubOrganization, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let client = github_client()?;
    broker_patch_json_with_session(
      &client,
      &format!("/api/github-app/installations/{installation_id}/orgs/{org_login}"),
      &serde_json::json!({
        "description": description
      }),
      &session_token,
    )
  })
  .await
  .map_err(|error| format!("Could not run the organization description update task: {error}"))?
}

#[tauri::command]
pub(crate) async fn delete_organization_for_installation(
  installation_id: i64,
  org_login: String,
  session_token: String,
) -> Result<(), String> {
  tauri::async_runtime::spawn_blocking(move || {
    let client = github_client()?;
    broker_delete_no_content_with_session(
      &client,
      &format!("/api/github-app/installations/{installation_id}/orgs/{org_login}"),
      &serde_json::json!({}),
      &session_token,
    )
  })
  .await
  .map_err(|error| format!("Could not run the organization deletion task: {error}"))?
}

#[tauri::command]
pub(crate) async fn leave_organization_for_installation(
  installation_id: i64,
  org_login: String,
  session_token: String,
) -> Result<(), String> {
  tauri::async_runtime::spawn_blocking(move || {
    let client = github_client()?;
    broker_delete_no_content_with_session(
      &client,
      &format!(
        "/api/github-app/installations/{installation_id}/orgs/{org_login}/membership"
      ),
      &serde_json::json!({}),
      &session_token,
    )
  })
  .await
  .map_err(|error| format!("Could not run the organization leave task: {error}"))?
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
