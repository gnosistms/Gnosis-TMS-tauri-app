use crate::broker::{
    broker_client, broker_delete_no_content_with_session, broker_get_json_with_session,
    broker_patch_no_content_with_session, broker_post_json_with_session,
};
use tauri::AppHandle;

use super::{
    broker_get_tolerant_json_list_with_session, encode_broker_path_segment,
    types::{
        CreateGithubGlossaryRepoInput, CreateGithubProjectRepoInput, CreateGithubQaListRepoInput,
        DeleteGithubGlossaryRepoInput, DeleteGithubProjectRepoInput, DeleteGithubQaListRepoInput,
        GithubGlossaryRepo, GithubInstallationResources, GithubProjectRepo, GithubQaListRepo,
        RenameGithubProjectRepoInput,
    },
};

#[tauri::command]
pub(crate) async fn ensure_gnosis_repo_properties_schema(
    installation_id: i64,
    org_login: String,
    session_token: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let encoded_org_login = encode_broker_path_segment(&org_login);
        let client = broker_client()?;
        broker_patch_no_content_with_session(
            &client,
            &format!(
                "/api/github-app/installations/{installation_id}/orgs/{encoded_org_login}/properties/schema"
            ),
            None,
            &session_token,
        )
    })
    .await
    .map_err(|error| format!("Could not run the repository property schema task: {error}"))?
}

#[tauri::command]
pub(crate) async fn list_gnosis_projects_for_installation(
    app: AppHandle,
    installation_id: i64,
    session_token: String,
) -> Result<Vec<GithubProjectRepo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = broker_client()?;
        broker_get_tolerant_json_list_with_session(
            &app,
            &client,
            &format!("/api/github-app/installations/{installation_id}/gnosis-projects"),
            &session_token,
            "list_gnosis_projects_for_installation.deserialize_project",
            "project repo",
        )
    })
    .await
    .map_err(|error| format!("Could not run the project listing task: {error}"))?
}

#[tauri::command]
pub(crate) async fn list_gnosis_glossaries_for_installation(
    app: AppHandle,
    installation_id: i64,
    session_token: String,
) -> Result<Vec<GithubGlossaryRepo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = broker_client()?;
        broker_get_tolerant_json_list_with_session(
            &app,
            &client,
            &format!("/api/github-app/installations/{installation_id}/gnosis-glossaries"),
            &session_token,
            "list_gnosis_glossaries_for_installation.deserialize_glossary",
            "glossary repo",
        )
    })
    .await
    .map_err(|error| format!("Could not run the glossary listing task: {error}"))?
}

#[tauri::command]
pub(crate) async fn list_gnosis_qa_lists_for_installation(
    app: AppHandle,
    installation_id: i64,
    session_token: String,
) -> Result<Vec<GithubQaListRepo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = broker_client()?;
        broker_get_tolerant_json_list_with_session(
            &app,
            &client,
            &format!("/api/github-app/installations/{installation_id}/gnosis-qa-lists"),
            &session_token,
            "list_gnosis_qa_lists_for_installation.deserialize_qa_list",
            "QA list repo",
        )
    })
    .await
    .map_err(|error| format!("Could not run the QA list listing task: {error}"))?
}

fn tolerant_resource_list_field<T: serde::de::DeserializeOwned>(
    app: &AppHandle,
    value: &serde_json::Value,
    field: &str,
    item_kind: &'static str,
) -> Result<Vec<T>, String> {
    // A missing list field is a malformed response, not an empty list — treating it as
    // empty would look like every resource of that type was deleted.
    let list_value = value.get(field).cloned().ok_or_else(|| {
        format!("GitHub App broker returned a malformed resource listing (missing {field}).")
    })?;
    let (items, skipped_count) = super::deserialize_tolerant_broker_list(list_value, item_kind)?;
    if skipped_count > 0 {
        super::report_backend_nonfatal_error(
            app,
            "list_gnosis_resources_for_installation.deserialize",
            "broker_list_item_deserialize_failed",
        );
    }
    Ok(items)
}

#[tauri::command]
pub(crate) async fn list_gnosis_resources_for_installation(
    app: AppHandle,
    installation_id: i64,
    session_token: String,
) -> Result<GithubInstallationResources, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = broker_client()?;
        let value: serde_json::Value = broker_get_json_with_session(
            &client,
            &format!("/api/github-app/installations/{installation_id}/gnosis-resources"),
            &session_token,
        )?;
        let projects = tolerant_resource_list_field(&app, &value, "projects", "project repo")?;
        let glossaries = tolerant_resource_list_field(&app, &value, "glossaries", "glossary repo")?;
        let qa_lists = tolerant_resource_list_field(&app, &value, "qaLists", "QA list repo")?;
        let digest = value
            .get("digest")
            .and_then(|entry| entry.as_str())
            .unwrap_or("")
            .to_string();
        let access = value
            .get("access")
            .filter(|entry| entry.is_object())
            .cloned();
        Ok(GithubInstallationResources {
            projects,
            glossaries,
            qa_lists,
            digest,
            access,
        })
    })
    .await
    .map_err(|error| format!("Could not run the resource listing task: {error}"))?
}

// Resource-management authorization is enforced by the command layer that owns the
// local resource workflow (team_metadata_local.rs/project_import.rs) and by the broker.
// These helpers intentionally stay thin to avoid duplicating that gate here.
#[tauri::command]
pub(crate) async fn create_gnosis_project_repo(
    input: CreateGithubProjectRepoInput,
    session_token: String,
) -> Result<GithubProjectRepo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = broker_client()?;
        broker_post_json_with_session(
            &client,
            "/api/github-app/gnosis-projects",
            &serde_json::to_value(&input).map_err(|error| error.to_string())?,
            &session_token,
        )
    })
    .await
    .map_err(|error| format!("Could not run the project creation task: {error}"))?
}

#[tauri::command]
pub(crate) async fn create_gnosis_glossary_repo(
    input: CreateGithubGlossaryRepoInput,
    session_token: String,
) -> Result<GithubGlossaryRepo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = broker_client()?;
        broker_post_json_with_session(
            &client,
            "/api/github-app/gnosis-glossaries",
            &serde_json::to_value(&input).map_err(|error| error.to_string())?,
            &session_token,
        )
    })
    .await
    .map_err(|error| format!("Could not run the glossary creation task: {error}"))?
}

#[tauri::command]
pub(crate) async fn create_gnosis_qa_list_repo(
    input: CreateGithubQaListRepoInput,
    session_token: String,
) -> Result<GithubQaListRepo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = broker_client()?;
        broker_post_json_with_session(
            &client,
            "/api/github-app/gnosis-qa-lists",
            &serde_json::to_value(&input).map_err(|error| error.to_string())?,
            &session_token,
        )
    })
    .await
    .map_err(|error| format!("Could not run the QA list creation task: {error}"))?
}

#[tauri::command]
pub(crate) async fn mark_gnosis_project_repo_deleted(
    input: DeleteGithubProjectRepoInput,
    session_token: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = broker_client()?;
        broker_patch_no_content_with_session(
            &client,
            "/api/github-app/gnosis-projects/delete-marker",
            Some(&serde_json::to_value(&input).map_err(|error| error.to_string())?),
            &session_token,
        )
    })
    .await
    .map_err(|error| format!("Could not run the project deletion task: {error}"))?
}

#[tauri::command]
pub(crate) async fn restore_gnosis_project_repo(
    input: DeleteGithubProjectRepoInput,
    session_token: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = broker_client()?;
        broker_patch_no_content_with_session(
            &client,
            "/api/github-app/gnosis-projects/restore-marker",
            Some(&serde_json::to_value(&input).map_err(|error| error.to_string())?),
            &session_token,
        )
    })
    .await
    .map_err(|error| format!("Could not run the project restore task: {error}"))?
}

#[tauri::command]
pub(crate) async fn rename_gnosis_project_repo(
    input: RenameGithubProjectRepoInput,
    session_token: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = broker_client()?;
        broker_patch_no_content_with_session(
            &client,
            "/api/github-app/gnosis-projects/rename",
            Some(&serde_json::to_value(&input).map_err(|error| error.to_string())?),
            &session_token,
        )
    })
    .await
    .map_err(|error| format!("Could not run the project rename task: {error}"))?
}

#[tauri::command]
pub(crate) async fn rollback_created_gnosis_project_repo(
    input: DeleteGithubProjectRepoInput,
    session_token: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = broker_client()?;
        broker_delete_no_content_with_session(
            &client,
            "/api/github-app/gnosis-projects",
            &serde_json::to_value(&input).map_err(|error| error.to_string())?,
            &session_token,
        )
    })
    .await
    .map_err(|error| format!("Could not run the permanent project deletion task: {error}"))?
}

#[tauri::command]
pub(crate) async fn rollback_created_gnosis_glossary_repo(
    input: DeleteGithubGlossaryRepoInput,
    session_token: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = broker_client()?;
        broker_delete_no_content_with_session(
            &client,
            "/api/github-app/gnosis-glossaries",
            &serde_json::to_value(&input).map_err(|error| error.to_string())?,
            &session_token,
        )
    })
    .await
    .map_err(|error| format!("Could not run the permanent glossary deletion task: {error}"))?
}

#[tauri::command]
pub(crate) async fn rollback_created_gnosis_qa_list_repo(
    input: DeleteGithubQaListRepoInput,
    session_token: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = broker_client()?;
        broker_delete_no_content_with_session(
            &client,
            "/api/github-app/gnosis-qa-lists",
            &serde_json::to_value(&input).map_err(|error| error.to_string())?,
            &session_token,
        )
    })
    .await
    .map_err(|error| format!("Could not run the permanent QA list deletion task: {error}"))?
}
