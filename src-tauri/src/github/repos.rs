use crate::broker::{
  broker_delete_no_content_with_session, broker_get_json_with_session,
  broker_patch_no_content_with_session, broker_post_json_with_session,
};

use super::{
  app_auth::github_client,
  types::{
    CreateGithubGlossaryRepoInput,
    CreateGithubProjectRepoInput,
    DeleteGithubGlossaryMetadataRecordInput,
    DeleteGithubProjectMetadataRecordInput,
    DeleteGithubGlossaryRepoInput,
    DeleteGithubProjectRepoInput,
    GithubGlossaryMetadataRecord,
    GithubGlossaryRepo,
    GithubProjectMetadataRecord,
    GithubProjectRepo,
    RenameGithubProjectRepoInput,
    TeamMetadataRecordListInput,
    UpsertGithubGlossaryMetadataRecordInput,
    UpsertGithubProjectMetadataRecordInput,
  },
};

#[tauri::command]
pub(crate) async fn ensure_gnosis_repo_properties_schema(
  installation_id: i64,
  org_login: String,
  session_token: String,
) -> Result<(), String> {
  tauri::async_runtime::spawn_blocking(move || {
    let client = github_client()?;
    broker_patch_no_content_with_session(
      &client,
      &format!("/api/github-app/installations/{installation_id}/orgs/{org_login}/properties/schema"),
      None,
      &session_token,
    )
  })
  .await
  .map_err(|error| format!("Could not run the repository property schema task: {error}"))?
}

#[tauri::command]
pub(crate) async fn list_gnosis_projects_for_installation(
  installation_id: i64,
  session_token: String,
) -> Result<Vec<GithubProjectRepo>, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let client = github_client()?;
    broker_get_json_with_session(
      &client,
      &format!("/api/github-app/installations/{installation_id}/gnosis-projects"),
      &session_token,
    )
  })
  .await
  .map_err(|error| format!("Could not run the project listing task: {error}"))?
}

#[tauri::command]
pub(crate) async fn list_gnosis_glossaries_for_installation(
  installation_id: i64,
  session_token: String,
) -> Result<Vec<GithubGlossaryRepo>, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let client = github_client()?;
    broker_get_json_with_session(
      &client,
      &format!("/api/github-app/installations/{installation_id}/gnosis-glossaries"),
      &session_token,
    )
  })
  .await
  .map_err(|error| format!("Could not run the glossary listing task: {error}"))?
}

#[tauri::command]
pub(crate) async fn list_gnosis_project_metadata_records(
  input: TeamMetadataRecordListInput,
  session_token: String,
) -> Result<Vec<GithubProjectMetadataRecord>, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let client = github_client()?;
    broker_get_json_with_session(
      &client,
      &format!(
        "/api/github-app/installations/{}/orgs/{}/gnosis-projects/metadata-records",
        input.installation_id, input.org_login,
      ),
      &session_token,
    )
  })
  .await
  .map_err(|error| format!("Could not run the project metadata listing task: {error}"))?
}

#[tauri::command]
pub(crate) async fn list_gnosis_glossary_metadata_records(
  input: TeamMetadataRecordListInput,
  session_token: String,
) -> Result<Vec<GithubGlossaryMetadataRecord>, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let client = github_client()?;
    broker_get_json_with_session(
      &client,
      &format!(
        "/api/github-app/installations/{}/orgs/{}/gnosis-glossaries/metadata-records",
        input.installation_id, input.org_login,
      ),
      &session_token,
    )
  })
  .await
  .map_err(|error| format!("Could not run the glossary metadata listing task: {error}"))?
}

#[tauri::command]
pub(crate) async fn create_gnosis_project_repo(
  input: CreateGithubProjectRepoInput,
  session_token: String,
) -> Result<GithubProjectRepo, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let client = github_client()?;
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
pub(crate) async fn upsert_gnosis_project_metadata_record(
  input: UpsertGithubProjectMetadataRecordInput,
  session_token: String,
) -> Result<(), String> {
  tauri::async_runtime::spawn_blocking(move || {
    let client = github_client()?;
    broker_patch_no_content_with_session(
      &client,
      "/api/github-app/gnosis-projects/metadata-record",
      Some(&serde_json::to_value(&input).map_err(|error| error.to_string())?),
      &session_token,
    )
  })
  .await
  .map_err(|error| format!("Could not run the project metadata write task: {error}"))?
}

#[tauri::command]
pub(crate) async fn delete_gnosis_project_metadata_record(
  input: DeleteGithubProjectMetadataRecordInput,
  session_token: String,
) -> Result<(), String> {
  tauri::async_runtime::spawn_blocking(move || {
    let client = github_client()?;
    broker_delete_no_content_with_session(
      &client,
      "/api/github-app/gnosis-projects/metadata-record",
      &serde_json::to_value(&input).map_err(|error| error.to_string())?,
      &session_token,
    )
  })
  .await
  .map_err(|error| format!("Could not run the project metadata delete task: {error}"))?
}

#[tauri::command]
pub(crate) async fn create_gnosis_glossary_repo(
  input: CreateGithubGlossaryRepoInput,
  session_token: String,
) -> Result<GithubGlossaryRepo, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let client = github_client()?;
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
pub(crate) async fn upsert_gnosis_glossary_metadata_record(
  input: UpsertGithubGlossaryMetadataRecordInput,
  session_token: String,
) -> Result<(), String> {
  tauri::async_runtime::spawn_blocking(move || {
    let client = github_client()?;
    broker_patch_no_content_with_session(
      &client,
      "/api/github-app/gnosis-glossaries/metadata-record",
      Some(&serde_json::to_value(&input).map_err(|error| error.to_string())?),
      &session_token,
    )
  })
  .await
  .map_err(|error| format!("Could not run the glossary metadata write task: {error}"))?
}

#[tauri::command]
pub(crate) async fn delete_gnosis_glossary_metadata_record(
  input: DeleteGithubGlossaryMetadataRecordInput,
  session_token: String,
) -> Result<(), String> {
  tauri::async_runtime::spawn_blocking(move || {
    let client = github_client()?;
    broker_delete_no_content_with_session(
      &client,
      "/api/github-app/gnosis-glossaries/metadata-record",
      &serde_json::to_value(&input).map_err(|error| error.to_string())?,
      &session_token,
    )
  })
  .await
  .map_err(|error| format!("Could not run the glossary metadata delete task: {error}"))?
}

#[tauri::command]
pub(crate) async fn mark_gnosis_project_repo_deleted(
  input: DeleteGithubProjectRepoInput,
  session_token: String,
) -> Result<(), String> {
  tauri::async_runtime::spawn_blocking(move || {
    let client = github_client()?;
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
    let client = github_client()?;
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
    let client = github_client()?;
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
pub(crate) async fn permanently_delete_gnosis_project_repo(
  input: DeleteGithubProjectRepoInput,
  session_token: String,
) -> Result<(), String> {
  tauri::async_runtime::spawn_blocking(move || {
    let client = github_client()?;
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
pub(crate) async fn permanently_delete_gnosis_glossary_repo(
  input: DeleteGithubGlossaryRepoInput,
  session_token: String,
) -> Result<(), String> {
  tauri::async_runtime::spawn_blocking(move || {
    let client = github_client()?;
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
