use std::fs;

use crate::broker::{
    broker_delete_no_content_with_session, broker_get_json_with_session,
    broker_patch_json_with_session, broker_patch_no_content_with_session,
    broker_post_json_with_session, broker_post_no_content_with_session,
};
use crate::installation_access::{
    cache_installation_access, ensure_installation_allows_member_management,
    ensure_installation_allows_team_management,
};
use crate::storage_paths::installation_data_dir;
use tauri::AppHandle;

use super::{
    app_auth::github_client,
    encode_broker_path_segment,
    types::{
        GithubAppInstallationInfo, GithubOrganization, GithubOrganizationInvitation,
        GithubOrganizationMember, GithubTeamMetadataRepo, GithubUserSearchResult,
    },
};

#[tauri::command]
pub(crate) async fn list_accessible_github_app_installations(
    app: AppHandle,
    session_token: String,
) -> Result<Vec<GithubAppInstallationInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = github_client()?;
        let installations: Vec<GithubAppInstallationInfo> =
            broker_get_json_with_session(&client, "/api/github-app/installations", &session_token)?;
        for installation in &installations {
            cache_installation_access(&app, installation)?;
        }
        Ok(installations)
    })
    .await
    .map_err(|error| format!("Could not run the installation listing task: {error}"))?
}

#[tauri::command]
pub(crate) async fn inspect_github_app_installation(
    app: AppHandle,
    installation_id: i64,
    session_token: String,
) -> Result<GithubAppInstallationInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = github_client()?;
        let installation: GithubAppInstallationInfo = broker_get_json_with_session(
            &client,
            &format!("/api/github-app/installations/{installation_id}"),
            &session_token,
        )?;
        cache_installation_access(&app, &installation)?;
        Ok(installation)
    })
    .await
    .map_err(|error| format!("Could not run the installation inspection task: {error}"))?
}

#[tauri::command]
pub(crate) async fn list_organization_members_for_installation(
    installation_id: i64,
    org_login: String,
    session_token: String,
) -> Result<Vec<GithubOrganizationMember>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = github_client()?;
        let encoded_org_login = encode_broker_path_segment(&org_login);
        broker_get_json_with_session(
            &client,
            &format!(
                "/api/github-app/installations/{installation_id}/members?org_login={encoded_org_login}"
            ),
            &session_token,
        )
    })
    .await
    .map_err(|error| format!("Could not run the organization members task: {error}"))?
}

#[tauri::command]
pub(crate) async fn search_github_users_for_installation(
    installation_id: i64,
    query: String,
    session_token: String,
) -> Result<Vec<GithubUserSearchResult>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = github_client()?;
        let encoded_query: String =
            url::form_urlencoded::byte_serialize(query.as_bytes()).collect();
        broker_get_json_with_session(
            &client,
            &format!(
                "/api/github-app/installations/{installation_id}/user-search?q={encoded_query}"
            ),
            &session_token,
        )
    })
    .await
    .map_err(|error| format!("Could not run the GitHub user search task: {error}"))?
}

#[tauri::command]
pub(crate) async fn invite_user_to_organization_for_installation(
    app: AppHandle,
    installation_id: i64,
    org_login: String,
    invitee_id: Option<i64>,
    invitee_login: Option<String>,
    invitee_email: Option<String>,
    role: Option<String>,
    session_token: String,
) -> Result<GithubOrganizationInvitation, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ensure_installation_allows_member_management(&app, installation_id)?;
        let client = github_client()?;
        let encoded_org_login = encode_broker_path_segment(&org_login);
        broker_post_json_with_session(
            &client,
            &format!(
                "/api/github-app/installations/{installation_id}/orgs/{encoded_org_login}/invitations"
            ),
            &serde_json::json!({
              "inviteeId": invitee_id,
              "inviteeLogin": invitee_login,
              "inviteeEmail": invitee_email,
              "role": role,
            }),
            &session_token,
        )
    })
    .await
    .map_err(|error| format!("Could not run the organization invitation task: {error}"))?
}

#[tauri::command]
pub(crate) async fn setup_organization_for_installation(
    app: AppHandle,
    installation_id: i64,
    org_login: String,
    session_token: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        ensure_installation_allows_team_management(&app, installation_id)?;
        let client = github_client()?;
        let encoded_org_login = encode_broker_path_segment(&org_login);
        broker_post_no_content_with_session(
            &client,
            &format!(
                "/api/github-app/installations/{installation_id}/orgs/{encoded_org_login}/setup"
            ),
            &serde_json::json!({}),
            &session_token,
        )
    })
    .await
    .map_err(|error| format!("Could not run the organization setup task: {error}"))?
}

#[tauri::command]
pub(crate) async fn inspect_team_metadata_repo_for_installation(
    installation_id: i64,
    org_login: String,
    session_token: String,
) -> Result<GithubTeamMetadataRepo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = github_client()?;
        let encoded_org_login = encode_broker_path_segment(&org_login);
        broker_get_json_with_session(
            &client,
            &format!(
                "/api/github-app/installations/{installation_id}/orgs/{encoded_org_login}/team-metadata"
            ),
            &session_token,
        )
    })
    .await
    .map_err(|error| format!("Could not run the team metadata inspection task: {error}"))?
}

#[tauri::command]
pub(crate) async fn add_organization_admin_for_installation(
    app: AppHandle,
    installation_id: i64,
    org_login: String,
    username: String,
    session_token: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        ensure_installation_allows_member_management(&app, installation_id)?;
        let client = github_client()?;
        let encoded_org_login = encode_broker_path_segment(&org_login);
        let encoded_username = encode_broker_path_segment(&username);
        broker_patch_no_content_with_session(
            &client,
            &format!(
        "/api/github-app/installations/{installation_id}/orgs/{encoded_org_login}/admins/{encoded_username}"
      ),
            None,
            &session_token,
        )
    })
    .await
    .map_err(|error| format!("Could not run the organization admin grant task: {error}"))?
}

#[tauri::command]
pub(crate) async fn revoke_organization_admin_for_installation(
    app: AppHandle,
    installation_id: i64,
    org_login: String,
    username: String,
    session_token: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        ensure_installation_allows_member_management(&app, installation_id)?;
        let client = github_client()?;
        let encoded_org_login = encode_broker_path_segment(&org_login);
        let encoded_username = encode_broker_path_segment(&username);
        broker_delete_no_content_with_session(
            &client,
            &format!(
        "/api/github-app/installations/{installation_id}/orgs/{encoded_org_login}/admins/{encoded_username}"
      ),
            &serde_json::json!({}),
            &session_token,
        )
    })
    .await
    .map_err(|error| format!("Could not run the organization admin revoke task: {error}"))?
}

#[tauri::command]
pub(crate) async fn set_organization_member_role_for_installation(
    app: AppHandle,
    installation_id: i64,
    org_login: String,
    username: String,
    role: String,
    confirmation_username: Option<String>,
    session_token: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        ensure_installation_allows_member_management(&app, installation_id)?;
        let client = github_client()?;
        let encoded_org_login = encode_broker_path_segment(&org_login);
        let encoded_username = encode_broker_path_segment(&username);
        broker_patch_no_content_with_session(
            &client,
            &format!(
                "/api/github-app/installations/{installation_id}/orgs/{encoded_org_login}/members/{encoded_username}/role"
            ),
            Some(&serde_json::json!({
                "role": role,
                "confirmationUsername": confirmation_username,
            })),
            &session_token,
        )
    })
    .await
    .map_err(|error| format!("Could not run the organization role update task: {error}"))?
}

#[tauri::command]
pub(crate) async fn promote_organization_owner_for_installation(
    app: AppHandle,
    installation_id: i64,
    org_login: String,
    username: String,
    session_token: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        ensure_installation_allows_member_management(&app, installation_id)?;
        let client = github_client()?;
        let encoded_org_login = encode_broker_path_segment(&org_login);
        let encoded_username = encode_broker_path_segment(&username);
        broker_patch_no_content_with_session(
            &client,
            &format!(
        "/api/github-app/installations/{installation_id}/orgs/{encoded_org_login}/owners/{encoded_username}"
      ),
            None,
            &session_token,
        )
    })
    .await
    .map_err(|error| format!("Could not run the organization owner promotion task: {error}"))?
}

#[tauri::command]
pub(crate) async fn remove_organization_member_for_installation(
    app: AppHandle,
    installation_id: i64,
    org_login: String,
    username: String,
    confirmation_username: Option<String>,
    session_token: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        ensure_installation_allows_member_management(&app, installation_id)?;
        let client = github_client()?;
        let encoded_org_login = encode_broker_path_segment(&org_login);
        let encoded_username = encode_broker_path_segment(&username);
        broker_delete_no_content_with_session(
            &client,
            &format!(
                "/api/github-app/installations/{installation_id}/orgs/{encoded_org_login}/members/{encoded_username}"
            ),
            &serde_json::json!({
                "confirmationUsername": confirmation_username,
            }),
            &session_token,
        )
    })
    .await
    .map_err(|error| format!("Could not run the organization member removal task: {error}"))?
}

#[tauri::command]
pub(crate) async fn update_organization_name_for_installation(
    app: AppHandle,
    installation_id: i64,
    org_login: String,
    name: String,
    session_token: String,
) -> Result<GithubOrganization, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ensure_installation_allows_team_management(&app, installation_id)?;
        let client = github_client()?;
        let encoded_org_login = encode_broker_path_segment(&org_login);
        broker_patch_json_with_session(
            &client,
            &format!("/api/github-app/installations/{installation_id}/orgs/{encoded_org_login}"),
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
    app: AppHandle,
    installation_id: i64,
    org_login: String,
    description: Option<String>,
    session_token: String,
) -> Result<GithubOrganization, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ensure_installation_allows_team_management(&app, installation_id)?;
        let client = github_client()?;
        let encoded_org_login = encode_broker_path_segment(&org_login);
        broker_patch_json_with_session(
            &client,
            &format!("/api/github-app/installations/{installation_id}/orgs/{encoded_org_login}"),
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
    app: AppHandle,
    installation_id: i64,
    org_login: String,
    session_token: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        ensure_installation_allows_team_management(&app, installation_id)?;
        let client = github_client()?;
        let encoded_org_login = encode_broker_path_segment(&org_login);
        broker_delete_no_content_with_session(
            &client,
            &format!("/api/github-app/installations/{installation_id}/orgs/{encoded_org_login}"),
            &serde_json::json!({}),
            &session_token,
        )
    })
    .await
    .map_err(|error| format!("Could not run the organization deletion task: {error}"))?
}

#[tauri::command]
pub(crate) async fn purge_local_installation_data(
    app: tauri::AppHandle,
    installation_id: i64,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let installation_root = installation_data_dir(&app, installation_id)?;
        if !installation_root.exists() {
            return Ok(());
        }

        fs::remove_dir_all(&installation_root).map_err(|error| {
            format!(
                "Could not remove the local installation data '{}': {error}",
                installation_root.display()
            )
        })
    })
    .await
    .map_err(|error| format!("Could not run the local installation cleanup task: {error}"))?
}

#[tauri::command]
pub(crate) async fn leave_organization_for_installation(
    installation_id: i64,
    org_login: String,
    session_token: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = github_client()?;
        let encoded_org_login = encode_broker_path_segment(&org_login);
        broker_delete_no_content_with_session(
            &client,
            &format!(
                "/api/github-app/installations/{installation_id}/orgs/{encoded_org_login}/membership"
            ),
            &serde_json::json!({}),
            &session_token,
        )
    })
    .await
    .map_err(|error| format!("Could not run the organization leave task: {error}"))?
}
