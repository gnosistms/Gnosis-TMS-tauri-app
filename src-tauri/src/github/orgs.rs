use crate::broker::{
  broker_delete_no_content_with_session, broker_get_json_with_session,
  broker_patch_json_with_session, broker_patch_no_content_with_session,
  broker_post_json_with_session, broker_post_no_content_with_session,
};

use super::{
  app_auth::github_client,
  types::{
    GithubAppInstallationInfo, GithubOrganization, GithubOrganizationInvitation,
    GithubOrganizationMember, GithubUserSearchResult,
  },
};

#[tauri::command]
pub(crate) fn list_accessible_github_app_installations(
  session_token: String,
) -> Result<Vec<GithubAppInstallationInfo>, String> {
  let client = github_client()?;
  broker_get_json_with_session(&client, "/api/github-app/installations", &session_token)
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
pub(crate) fn setup_organization_for_installation(
  installation_id: i64,
  org_login: String,
  session_token: String,
) -> Result<(), String> {
  let client = github_client()?;
  broker_post_no_content_with_session(
    &client,
    &format!("/api/github-app/installations/{installation_id}/orgs/{org_login}/setup"),
    &serde_json::json!({}),
    &session_token,
  )
}

#[tauri::command]
pub(crate) fn add_organization_admin_for_installation(
  installation_id: i64,
  org_login: String,
  username: String,
  session_token: String,
) -> Result<(), String> {
  let client = github_client()?;
  broker_patch_no_content_with_session(
    &client,
    &format!(
      "/api/github-app/installations/{installation_id}/orgs/{org_login}/admins/{username}"
    ),
    None,
    &session_token,
  )
}

#[tauri::command]
pub(crate) async fn revoke_organization_admin_for_installation(
  installation_id: i64,
  org_login: String,
  username: String,
  session_token: String,
) -> Result<(), String> {
  tauri::async_runtime::spawn_blocking(move || {
    let client = github_client()?;
    broker_delete_no_content_with_session(
      &client,
      &format!(
        "/api/github-app/installations/{installation_id}/orgs/{org_login}/admins/{username}"
      ),
      &serde_json::json!({}),
      &session_token,
    )
  })
  .await
  .map_err(|error| format!("Could not run the organization admin revoke task: {error}"))?
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
