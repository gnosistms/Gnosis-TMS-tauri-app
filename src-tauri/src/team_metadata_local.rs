use std::{
    fs,
    path::{Path, PathBuf},
};

use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::AppHandle;

use crate::{
    broker_auth_storage::load_broker_auth_session,
    git_commit::{git_commit_as_signed_in_user_with_metadata, GitCommitMetadata},
    github::types::{
        DeleteGithubGlossaryMetadataRecordInput, DeleteGithubProjectMetadataRecordInput,
        UpsertGithubGlossaryMetadataRecordInput, UpsertGithubProjectMetadataRecordInput,
    },
    github::types::{GithubGlossaryMetadataRecord, GithubProjectMetadataRecord},
    local_repo_sync_state::{
        read_local_repo_sync_state, upsert_local_repo_sync_state, LocalRepoSyncState,
        LocalRepoSyncStateUpdate,
    },
    repo_sync_shared::{
        abort_rebase_after_failed_pull, git_output, load_git_transport_token,
        read_current_head_oid, GitTransportAuth,
    },
    storage_paths::{
        local_glossary_repo_root, local_project_repo_root, local_team_metadata_repo_path,
    },
};

const TEAM_METADATA_REPO_NAME: &str = "team-metadata";

mod mutations;
mod records;
mod repair;
mod repo;

use self::mutations::{
    actor_login, build_glossary_record_value, build_project_record_value, delete_local_record,
    upsert_local_record,
};
use self::records::{list_local_metadata_records, local_record_has_tombstone, read_json_object};
use self::repair::{
    find_glossary_repo_for_record, find_project_repo_for_record, inspect_glossary_repo_repairs,
    inspect_project_repo_repairs, local_glossary_term_count, local_project_chapter_count,
    maybe_repair_sync_state, normalized_optional_text, repo_folder_name,
};
use self::repo::{
    build_local_team_metadata_repo_info, current_origin_remote_url, ensure_local_repo_exists,
    ensure_repo_origin_remote, expected_repo_url_from_full_name, pull_local_metadata_repo,
    push_local_metadata_repo, require_local_metadata_repo, resource_directory_path,
    resource_record_path,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalTeamMetadataRepoInfo {
    pub(crate) repo_path: String,
    pub(crate) full_name: String,
    pub(crate) has_manifest: bool,
    pub(crate) current_head_oid: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalTeamMetadataMutationResult {
    pub(crate) repo_path: String,
    pub(crate) record_path: String,
    pub(crate) current_head_oid: Option<String>,
    pub(crate) commit_created: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalTeamMetadataPushResult {
    pub(crate) repo_path: String,
    pub(crate) current_head_oid: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalRepoRepairIssue {
    pub(crate) kind: String,
    pub(crate) issue_type: String,
    pub(crate) resource_id: Option<String>,
    pub(crate) repo_name: Option<String>,
    pub(crate) expected_repo_name: Option<String>,
    pub(crate) message: String,
    pub(crate) can_auto_repair: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalRepoRepairScanResult {
    pub(crate) issues: Vec<LocalRepoRepairIssue>,
    pub(crate) auto_repaired_count: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RepairLocalRepoBindingInput {
    pub(crate) installation_id: i64,
    pub(crate) kind: String,
    pub(crate) resource_id: String,
}

#[tauri::command]
pub(crate) async fn ensure_local_team_metadata_repo(
    app: AppHandle,
    installation_id: i64,
    org_login: String,
    session_token: String,
) -> Result<LocalTeamMetadataRepoInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let repo_path =
            ensure_local_repo_exists(&app, installation_id, &org_login, &session_token)?;
        build_local_team_metadata_repo_info(&repo_path, &org_login)
    })
    .await
    .map_err(|error| format!("Could not run the local team-metadata bootstrap task: {error}"))?
}

#[tauri::command]
pub(crate) async fn sync_local_team_metadata_repo(
    app: AppHandle,
    installation_id: i64,
    org_login: String,
    session_token: String,
) -> Result<LocalTeamMetadataRepoInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let repo_path =
            ensure_local_repo_exists(&app, installation_id, &org_login, &session_token)?;
        pull_local_metadata_repo(&repo_path, installation_id, &session_token)?;
        build_local_team_metadata_repo_info(&repo_path, &org_login)
    })
    .await
    .map_err(|error| format!("Could not run the local team-metadata sync task: {error}"))?
}

#[tauri::command]
pub(crate) async fn list_local_gnosis_project_metadata_records(
    app: AppHandle,
    installation_id: i64,
) -> Result<Vec<GithubProjectMetadataRecord>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let repo_path = require_local_metadata_repo(&app, installation_id)?;
        let mut records =
            list_local_metadata_records::<GithubProjectMetadataRecord>(&repo_path, "project")?;
        for record in &mut records {
            record.chapter_count = find_project_repo_for_record(&app, installation_id, record)
                .ok()
                .flatten()
                .and_then(|repo_path| local_project_chapter_count(&repo_path).ok())
                .unwrap_or(0);
        }
        Ok(records)
    })
    .await
    .map_err(|error| format!("Could not run the local project metadata listing task: {error}"))?
}

#[tauri::command]
pub(crate) async fn list_local_gnosis_glossary_metadata_records(
    app: AppHandle,
    installation_id: i64,
) -> Result<Vec<GithubGlossaryMetadataRecord>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let repo_path = require_local_metadata_repo(&app, installation_id)?;
        let mut records =
            list_local_metadata_records::<GithubGlossaryMetadataRecord>(&repo_path, "glossary")?;
        for record in &mut records {
            record.term_count = find_glossary_repo_for_record(&app, installation_id, record)
                .ok()
                .flatten()
                .and_then(|repo_path| local_glossary_term_count(&repo_path).ok())
                .unwrap_or(0);
        }
        Ok(records)
    })
    .await
    .map_err(|error| format!("Could not run the local glossary metadata listing task: {error}"))?
}

#[tauri::command]
pub(crate) async fn lookup_local_team_metadata_tombstone(
    app: AppHandle,
    installation_id: i64,
    kind: String,
    resource_id: String,
) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let normalized_kind = match kind.trim() {
            "project" => "project",
            "glossary" => "glossary",
            _ => {
                return Err(format!(
                    "Unsupported team-metadata resource kind '{}'.",
                    kind.trim()
                ))
            }
        };
        let repo_path = require_local_metadata_repo(&app, installation_id)?;
        local_record_has_tombstone(&repo_path, normalized_kind, &resource_id)
    })
    .await
    .map_err(|error| format!("Could not run the local tombstone lookup task: {error}"))?
}

#[tauri::command]
pub(crate) async fn inspect_and_migrate_local_repo_bindings(
    app: AppHandle,
    installation_id: i64,
) -> Result<LocalRepoRepairScanResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let repo_path = require_local_metadata_repo(&app, installation_id)?;
        let project_records =
            list_local_metadata_records::<GithubProjectMetadataRecord>(&repo_path, "project")?;
        let glossary_records =
            list_local_metadata_records::<GithubGlossaryMetadataRecord>(&repo_path, "glossary")?;

        let project_scan = inspect_project_repo_repairs(&app, installation_id, &project_records)?;
        let glossary_scan =
            inspect_glossary_repo_repairs(&app, installation_id, &glossary_records)?;

        Ok(LocalRepoRepairScanResult {
            issues: project_scan
                .issues
                .into_iter()
                .chain(glossary_scan.issues.into_iter())
                .collect(),
            auto_repaired_count: project_scan.auto_repaired_count
                + glossary_scan.auto_repaired_count,
        })
    })
    .await
    .map_err(|error| format!("Could not run the local repo repair inspection task: {error}"))?
}

#[tauri::command]
pub(crate) async fn repair_local_repo_binding(
    app: AppHandle,
    input: RepairLocalRepoBindingInput,
) -> Result<LocalRepoRepairIssue, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let repo_path = require_local_metadata_repo(&app, input.installation_id)?;
        let normalized_kind = input.kind.trim();
        let normalized_resource_id = input.resource_id.trim();
        if normalized_resource_id.is_empty() {
            return Err("Could not determine which repo binding to repair.".to_string());
        }

        match normalized_kind {
            "project" => {
                let records = list_local_metadata_records::<GithubProjectMetadataRecord>(
                    &repo_path, "project",
                )?;
                let record = records
                    .into_iter()
                    .find(|record| record.id.trim() == normalized_resource_id)
                    .ok_or_else(|| {
                        format!(
                            "Could not find project metadata record '{}'.",
                            normalized_resource_id
                        )
                    })?;
                let local_repo_path =
                    find_project_repo_for_record(&app, input.installation_id, &record)?
                        .ok_or_else(|| {
                            "The local project repo is not available to repair.".to_string()
                        })?;
                maybe_repair_sync_state(
                    &local_repo_path,
                    "project",
                    &record.id,
                    &record.repo_name,
                    read_local_repo_sync_state(&local_repo_path)
                        .ok()
                        .flatten()
                        .as_ref(),
                )?;
                if let Some(full_name) = normalized_optional_text(record.full_name.as_deref()) {
                    ensure_repo_origin_remote(
                        &local_repo_path,
                        &expected_repo_url_from_full_name(&full_name)?,
                    )?;
                }
                Ok(LocalRepoRepairIssue {
                    kind: "project".to_string(),
                    issue_type: "repaired".to_string(),
                    resource_id: Some(record.id),
                    repo_name: repo_folder_name(&local_repo_path),
                    expected_repo_name: Some(record.repo_name),
                    message: "The local project repo binding was repaired from team metadata."
                        .to_string(),
                    can_auto_repair: false,
                })
            }
            "glossary" => {
                let records = list_local_metadata_records::<GithubGlossaryMetadataRecord>(
                    &repo_path, "glossary",
                )?;
                let record = records
                    .into_iter()
                    .find(|record| record.id.trim() == normalized_resource_id)
                    .ok_or_else(|| {
                        format!(
                            "Could not find glossary metadata record '{}'.",
                            normalized_resource_id
                        )
                    })?;
                let local_repo_path =
                    find_glossary_repo_for_record(&app, input.installation_id, &record)?
                        .ok_or_else(|| {
                            "The local glossary repo is not available to repair.".to_string()
                        })?;
                maybe_repair_sync_state(
                    &local_repo_path,
                    "glossary",
                    &record.id,
                    &record.repo_name,
                    read_local_repo_sync_state(&local_repo_path)
                        .ok()
                        .flatten()
                        .as_ref(),
                )?;
                if let Some(full_name) = normalized_optional_text(record.full_name.as_deref()) {
                    ensure_repo_origin_remote(
                        &local_repo_path,
                        &expected_repo_url_from_full_name(&full_name)?,
                    )?;
                }
                Ok(LocalRepoRepairIssue {
                    kind: "glossary".to_string(),
                    issue_type: "repaired".to_string(),
                    resource_id: Some(record.id),
                    repo_name: repo_folder_name(&local_repo_path),
                    expected_repo_name: Some(record.repo_name),
                    message: "The local glossary repo binding was repaired from team metadata."
                        .to_string(),
                    can_auto_repair: false,
                })
            }
            _ => Err(format!(
                "Unsupported team-metadata resource kind '{}'.",
                normalized_kind
            )),
        }
    })
    .await
    .map_err(|error| format!("Could not run the local repo repair task: {error}"))?
}

#[tauri::command]
pub(crate) async fn upsert_local_gnosis_project_metadata_record(
    app: AppHandle,
    input: UpsertGithubProjectMetadataRecordInput,
    session_token: String,
) -> Result<LocalTeamMetadataMutationResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let repo_path = ensure_local_repo_exists(
            &app,
            input.installation_id,
            &input.org_login,
            &session_token,
        )?;
        let record_path = resource_record_path(&repo_path, "project", &input.project_id);
        let current = read_json_object(&record_path)?;
        let actor_login = actor_login(&app)?;
        let record_value = build_project_record_value(current, &input, actor_login.as_deref())?;
        upsert_local_record(
            &app,
            &repo_path,
            &record_path,
            &record_value,
            &format!("Update project metadata record for {}", input.project_id),
            "team-metadata.project.upsert",
        )
    })
    .await
    .map_err(|error| format!("Could not run the local project metadata write task: {error}"))?
}

#[tauri::command]
pub(crate) async fn delete_local_gnosis_project_metadata_record(
    app: AppHandle,
    input: DeleteGithubProjectMetadataRecordInput,
    session_token: String,
) -> Result<LocalTeamMetadataMutationResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let repo_path = ensure_local_repo_exists(
            &app,
            input.installation_id,
            &input.org_login,
            &session_token,
        )?;
        let record_path = resource_record_path(&repo_path, "project", &input.project_id);
        delete_local_record(
            &app,
            &repo_path,
            &record_path,
            &format!("Delete project metadata record for {}", input.project_id),
            "team-metadata.project.delete",
        )
    })
    .await
    .map_err(|error| format!("Could not run the local project metadata delete task: {error}"))?
}

#[tauri::command]
pub(crate) async fn upsert_local_gnosis_glossary_metadata_record(
    app: AppHandle,
    input: UpsertGithubGlossaryMetadataRecordInput,
    session_token: String,
) -> Result<LocalTeamMetadataMutationResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let repo_path = ensure_local_repo_exists(
            &app,
            input.installation_id,
            &input.org_login,
            &session_token,
        )?;
        let record_path = resource_record_path(&repo_path, "glossary", &input.glossary_id);
        let current = read_json_object(&record_path)?;
        let actor_login = actor_login(&app)?;
        let record_value = build_glossary_record_value(current, &input, actor_login.as_deref())?;
        upsert_local_record(
            &app,
            &repo_path,
            &record_path,
            &record_value,
            &format!("Update glossary metadata record for {}", input.glossary_id),
            "team-metadata.glossary.upsert",
        )
    })
    .await
    .map_err(|error| format!("Could not run the local glossary metadata write task: {error}"))?
}

#[tauri::command]
pub(crate) async fn delete_local_gnosis_glossary_metadata_record(
    app: AppHandle,
    input: DeleteGithubGlossaryMetadataRecordInput,
    session_token: String,
) -> Result<LocalTeamMetadataMutationResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let repo_path = ensure_local_repo_exists(
            &app,
            input.installation_id,
            &input.org_login,
            &session_token,
        )?;
        let record_path = resource_record_path(&repo_path, "glossary", &input.glossary_id);
        delete_local_record(
            &app,
            &repo_path,
            &record_path,
            &format!("Delete glossary metadata record for {}", input.glossary_id),
            "team-metadata.glossary.delete",
        )
    })
    .await
    .map_err(|error| format!("Could not run the local glossary metadata delete task: {error}"))?
}

#[tauri::command]
pub(crate) async fn push_local_team_metadata_repo(
    app: AppHandle,
    installation_id: i64,
    org_login: String,
    session_token: String,
) -> Result<LocalTeamMetadataPushResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let repo_path =
            ensure_local_repo_exists(&app, installation_id, &org_login, &session_token)?;
        push_local_metadata_repo(&repo_path, installation_id, &session_token)
    })
    .await
    .map_err(|error| format!("Could not run the local team-metadata push task: {error}"))?
}
