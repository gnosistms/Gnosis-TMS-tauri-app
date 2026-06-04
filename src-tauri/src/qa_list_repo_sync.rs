use std::{fs, path::Path};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::{
    installation_access::ensure_installation_allows_qa_list_writes,
    local_repo_sync_state::{
        read_local_repo_sync_state, upsert_local_repo_sync_state, LocalRepoSyncStateUpdate,
    },
    repo_app_version::{
        encode_repo_app_update_requirement, parse_repo_app_update_requirement_error,
        remote_ref_requires_newer_app,
    },
    repo_layout_metadata::STORAGE_LAYOUT_VERSION_V2,
    repo_migrations::{
        discard_local_old_layout_changes_and_adopt_remote,
        is_remote_migrated_local_old_layout_changes_error, repo_requires_0810_migration,
        sync_pending_repo_layout_migration,
    },
    repo_resource_sync::{
        normalized_optional_identifier, repo_transport_deleted_state,
        term_id_from_repo_relative_path,
        REPO_SYNC_STATUS_DIRTY_LOCAL as QA_LIST_REPO_SYNC_STATUS_DIRTY_LOCAL,
        REPO_SYNC_STATUS_NOT_CLONED as QA_LIST_REPO_SYNC_STATUS_NOT_CLONED,
        REPO_SYNC_STATUS_OUT_OF_SYNC as QA_LIST_REPO_SYNC_STATUS_OUT_OF_SYNC,
        REPO_SYNC_STATUS_REMOTE_MIGRATED_LOCAL_CHANGES as QA_LIST_REPO_SYNC_STATUS_REMOTE_MIGRATED_LOCAL_CHANGES,
        REPO_SYNC_STATUS_SYNC_ERROR as QA_LIST_REPO_SYNC_STATUS_SYNC_ERROR,
        REPO_SYNC_STATUS_UPDATE_REQUIRED as QA_LIST_REPO_SYNC_STATUS_UPDATE_REQUIRED,
        REPO_SYNC_STATUS_UP_TO_DATE as QA_LIST_REPO_SYNC_STATUS_UP_TO_DATE,
    },
    repo_sync_shared::{
        abort_rebase_after_failed_pull, ensure_repo_local_git_identity,
        git_error_indicates_missing_remote_ref, git_output, load_git_transport_token,
        read_current_head_oid, GitTransportAuth,
    },
    short_path_names::allocate_short_folder_name,
    storage_paths::local_qa_list_repo_root,
};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QaListRepoSyncDescriptor {
    pub(crate) qa_list_id: Option<String>,
    pub(crate) repo_name: String,
    pub(crate) full_name: String,
    pub(crate) repo_id: Option<i64>,
    pub(crate) default_branch_name: Option<String>,
    pub(crate) default_branch_head_oid: Option<String>,
    pub(crate) lifecycle_state: Option<String>,
    pub(crate) record_state: Option<String>,
    pub(crate) remote_state: Option<String>,
    pub(crate) status: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QaListRepoSyncInput {
    pub(crate) installation_id: i64,
    pub(crate) qa_lists: Vec<QaListRepoSyncDescriptor>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QaListEditorRepoSyncInput {
    pub(crate) installation_id: i64,
    pub(crate) qa_list_id: Option<String>,
    pub(crate) repo_name: String,
    pub(crate) full_name: String,
    pub(crate) repo_id: Option<i64>,
    pub(crate) default_branch_name: Option<String>,
    pub(crate) default_branch_head_oid: Option<String>,
    pub(crate) lifecycle_state: Option<String>,
    pub(crate) record_state: Option<String>,
    pub(crate) remote_state: Option<String>,
    pub(crate) status: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QaListRepoSyncSnapshot {
    pub(crate) repo_name: String,
    pub(crate) repo_path: String,
    pub(crate) local_head_oid: Option<String>,
    pub(crate) remote_head_oid: Option<String>,
    pub(crate) status: String,
    pub(crate) message: Option<String>,
    pub(crate) required_app_version: Option<String>,
    pub(crate) current_app_version: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiscardOldLayoutQaListReposResponse {
    pub(crate) resolved_repo_names: Vec<String>,
    pub(crate) skipped_repo_names: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QaListEditorRepoSyncResponse {
    pub(crate) old_head_sha: Option<String>,
    pub(crate) new_head_sha: Option<String>,
    pub(crate) changed_term_ids: Vec<String>,
    pub(crate) inserted_term_ids: Vec<String>,
    pub(crate) deleted_term_ids: Vec<String>,
}

fn qa_list_descriptor_is_deleted(qa_list: &QaListRepoSyncDescriptor) -> bool {
    repo_transport_deleted_state(qa_list.lifecycle_state.as_deref())
        || repo_transport_deleted_state(qa_list.record_state.as_deref())
        || repo_transport_deleted_state(qa_list.remote_state.as_deref())
        || repo_transport_deleted_state(qa_list.status.as_deref())
}

#[tauri::command]
pub(crate) async fn sync_gtms_qa_list_repos(
    app: AppHandle,
    input: QaListRepoSyncInput,
    session_token: String,
) -> Result<Vec<QaListRepoSyncSnapshot>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        sync_gtms_qa_list_repos_sync(&app, input, &session_token)
    })
    .await
    .map_err(|error| format!("The qa_list repo sync task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn sync_gtms_qa_list_editor_repo(
    app: AppHandle,
    input: QaListEditorRepoSyncInput,
    session_token: String,
) -> Result<QaListEditorRepoSyncResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        sync_gtms_qa_list_editor_repo_sync(&app, input, &session_token)
    })
    .await
    .map_err(|error| format!("The qa_list editor repo sync task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn discard_old_layout_gtms_qa_list_repos(
    app: AppHandle,
    input: QaListRepoSyncInput,
    session_token: String,
) -> Result<DiscardOldLayoutQaListReposResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        discard_old_layout_gtms_qa_list_repos_sync(&app, input, &session_token)
    })
    .await
    .map_err(|error| format!("The old-layout QA list repo discard task failed: {error}"))?
}

fn sync_gtms_qa_list_repos_sync(
    app: &AppHandle,
    input: QaListRepoSyncInput,
    session_token: &str,
) -> Result<Vec<QaListRepoSyncSnapshot>, String> {
    let needs_transport = input.qa_lists.iter().any(|qa_list| {
        let repo_path = resolve_or_desired_qa_list_git_repo_path(
            app,
            input.installation_id,
            qa_list.qa_list_id.as_deref(),
            &qa_list.repo_name,
        )
        .unwrap_or_else(|_| {
            local_qa_list_repo_root(app, input.installation_id)
                .unwrap_or_else(|_| Path::new("").to_path_buf())
                .join(&qa_list.repo_name)
        });
        matches!(
            inspect_qa_list_repo_state(qa_list, &repo_path)
                .status
                .as_str(),
            QA_LIST_REPO_SYNC_STATUS_NOT_CLONED | QA_LIST_REPO_SYNC_STATUS_OUT_OF_SYNC
        )
    });
    let git_transport_token = if needs_transport {
        Some(load_git_transport_token(
            input.installation_id,
            session_token,
        )?)
    } else {
        None
    };

    let mut snapshots = Vec::with_capacity(input.qa_lists.len());
    for qa_list in input.qa_lists {
        let repo_path = resolve_or_desired_qa_list_git_repo_path(
            app,
            input.installation_id,
            qa_list.qa_list_id.as_deref(),
            &qa_list.repo_name,
        )?;
        let inspected = inspect_qa_list_repo_state(&qa_list, &repo_path);

        if matches!(
            inspected.status.as_str(),
            QA_LIST_REPO_SYNC_STATUS_NOT_CLONED | QA_LIST_REPO_SYNC_STATUS_OUT_OF_SYNC
        ) {
            let sync_result = sync_qa_list_repo(
                app,
                &qa_list,
                &repo_path,
                inspected.remote_head_oid.as_deref().unwrap_or_default(),
                git_transport_token.as_deref().unwrap_or_default(),
            );

            snapshots.push(match sync_result {
                Ok(local_head_oid) => QaListRepoSyncSnapshot {
                    repo_name: qa_list.repo_name.clone(),
                    repo_path: repo_path.display().to_string(),
                    local_head_oid: local_head_oid.clone(),
                    remote_head_oid: local_head_oid,
                    status: QA_LIST_REPO_SYNC_STATUS_UP_TO_DATE.to_string(),
                    message: None,
                    required_app_version: None,
                    current_app_version: None,
                },
                Err(error) => snapshot_from_qa_list_sync_error(&qa_list, &repo_path, error),
            });
            continue;
        }

        snapshots.push(inspected);
    }

    Ok(snapshots)
}

fn sync_gtms_qa_list_editor_repo_sync(
    app: &AppHandle,
    input: QaListEditorRepoSyncInput,
    session_token: &str,
) -> Result<QaListEditorRepoSyncResponse, String> {
    let qa_list = QaListRepoSyncDescriptor {
        qa_list_id: input.qa_list_id.clone(),
        repo_name: input.repo_name.clone(),
        full_name: input.full_name.clone(),
        repo_id: input.repo_id,
        default_branch_name: input.default_branch_name.clone(),
        default_branch_head_oid: input.default_branch_head_oid.clone(),
        lifecycle_state: input.lifecycle_state.clone(),
        record_state: input.record_state.clone(),
        remote_state: input.remote_state.clone(),
        status: input.status.clone(),
    };
    let repo_path = resolve_or_desired_qa_list_git_repo_path(
        app,
        input.installation_id,
        input.qa_list_id.as_deref(),
        &input.repo_name,
    )?;
    let old_head_sha = read_current_head_oid(&repo_path);
    if qa_list_descriptor_is_deleted(&qa_list) {
        return Ok(QaListEditorRepoSyncResponse {
            old_head_sha: old_head_sha.clone(),
            new_head_sha: old_head_sha,
            changed_term_ids: Vec::new(),
            inserted_term_ids: Vec::new(),
            deleted_term_ids: Vec::new(),
        });
    }
    let git_status = git_output(&repo_path, &["status", "--porcelain"], None)?;
    if !git_status.trim().is_empty() {
        return Err("Local repo has uncommitted changes.".to_string());
    }

    let git_transport_token = load_git_transport_token(input.installation_id, session_token)?;
    let new_head_sha = sync_qa_list_repo(
        app,
        &qa_list,
        &repo_path,
        input.default_branch_head_oid.as_deref().unwrap_or_default(),
        &git_transport_token,
    )?;
    let qa_list_terms_path = repo_path.join("terms");
    let qa_list_terms_relative_path = qa_list_terms_path
        .strip_prefix(&repo_path)
        .map_err(|error| format!("Could not resolve the qa_list terms path for git: {error}"))?
        .to_string_lossy()
        .to_string();
    let (changed_term_ids, inserted_term_ids, deleted_term_ids) =
        match (old_head_sha.as_deref(), new_head_sha.as_deref()) {
            (Some(old_head), Some(new_head)) if old_head != new_head => {
                qa_list_term_changes_between_commits(
                    &repo_path,
                    &qa_list_terms_relative_path,
                    old_head,
                    new_head,
                )?
            }
            _ => (Vec::new(), Vec::new(), Vec::new()),
        };

    Ok(QaListEditorRepoSyncResponse {
        old_head_sha,
        new_head_sha,
        changed_term_ids,
        inserted_term_ids,
        deleted_term_ids,
    })
}

fn discard_old_layout_gtms_qa_list_repos_sync(
    app: &AppHandle,
    input: QaListRepoSyncInput,
    session_token: &str,
) -> Result<DiscardOldLayoutQaListReposResponse, String> {
    let git_transport_token = load_git_transport_token(input.installation_id, session_token)?;
    let git_transport_auth = GitTransportAuth::from_token(&git_transport_token)?;
    let mut resolved_repo_names = Vec::new();
    let mut skipped_repo_names = Vec::new();

    for qa_list in input.qa_lists {
        let repo_path = resolve_or_desired_qa_list_git_repo_path(
            app,
            input.installation_id,
            qa_list.qa_list_id.as_deref(),
            &qa_list.repo_name,
        )?;
        if !repo_path.exists()
            || git_output(&repo_path, &["rev-parse", "--git-dir"], None).is_err()
            || !repo_requires_0810_migration(&repo_path)
        {
            skipped_repo_names.push(qa_list.repo_name.clone());
            continue;
        }

        ensure_installation_allows_qa_list_writes(app, input.installation_id)?;
        ensure_qa_list_origin_remote(&qa_list, &repo_path)?;
        ensure_repo_local_git_identity(app, &repo_path)?;

        let branch_name = qa_list
            .default_branch_name
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("main");
        git_output(
            &repo_path,
            &["fetch", "origin", branch_name],
            Some(&git_transport_auth),
        )?;
        let remote_tracking_ref = format!("origin/{branch_name}");
        discard_local_old_layout_changes_and_adopt_remote(
            &repo_path,
            branch_name,
            &remote_tracking_ref,
        )?;
        mark_qa_list_repo_synced(&qa_list, &repo_path)?;
        resolved_repo_names.push(qa_list.repo_name);
    }

    Ok(DiscardOldLayoutQaListReposResponse {
        resolved_repo_names,
        skipped_repo_names,
    })
}

fn qa_list_term_changes_between_commits(
    repo_path: &Path,
    qa_list_terms_relative_path: &str,
    old_head_sha: &str,
    new_head_sha: &str,
) -> Result<(Vec<String>, Vec<String>, Vec<String>), String> {
    let diff_output = git_output(
        repo_path,
        &[
            "diff",
            "--name-status",
            old_head_sha,
            new_head_sha,
            "--",
            qa_list_terms_relative_path,
        ],
        None,
    )?;
    let mut changed_term_ids = Vec::new();
    let mut inserted_term_ids = Vec::new();
    let mut deleted_term_ids = Vec::new();

    for line in diff_output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let mut parts = trimmed.split('\t');
        let status = parts.next().unwrap_or_default().trim();
        match status.chars().next() {
            Some('A') => {
                if let Some(term_id) = parts.next().and_then(term_id_from_repo_relative_path) {
                    inserted_term_ids.push(term_id);
                }
            }
            Some('D') => {
                if let Some(term_id) = parts.next().and_then(term_id_from_repo_relative_path) {
                    deleted_term_ids.push(term_id);
                }
            }
            Some('R') => {
                let before_path = parts.next().unwrap_or_default();
                let after_path = parts.next().unwrap_or_default();
                if let Some(term_id) = term_id_from_repo_relative_path(before_path) {
                    deleted_term_ids.push(term_id);
                }
                if let Some(term_id) = term_id_from_repo_relative_path(after_path) {
                    inserted_term_ids.push(term_id);
                }
            }
            Some(_) => {
                if let Some(term_id) = parts.next().and_then(term_id_from_repo_relative_path) {
                    changed_term_ids.push(term_id);
                }
            }
            None => {}
        }
    }

    changed_term_ids.sort();
    changed_term_ids.dedup();
    inserted_term_ids.sort();
    inserted_term_ids.dedup();
    deleted_term_ids.sort();
    deleted_term_ids.dedup();

    Ok((changed_term_ids, inserted_term_ids, deleted_term_ids))
}

fn snapshot_from_qa_list_sync_error(
    qa_list: &QaListRepoSyncDescriptor,
    repo_path: &Path,
    error: String,
) -> QaListRepoSyncSnapshot {
    if is_remote_migrated_local_old_layout_changes_error(&error) {
        return QaListRepoSyncSnapshot {
            message: Some(
                "The server has migrated this QA list to a new data format, but this computer still has old-format local changes."
                    .to_string(),
            ),
            status: QA_LIST_REPO_SYNC_STATUS_REMOTE_MIGRATED_LOCAL_CHANGES.to_string(),
            ..inspect_qa_list_repo_state(qa_list, repo_path)
        };
    }

    if let Some(requirement) = parse_repo_app_update_requirement_error(&error) {
        return QaListRepoSyncSnapshot {
            repo_name: qa_list.repo_name.clone(),
            repo_path: repo_path.display().to_string(),
            local_head_oid: read_current_head_oid(repo_path),
            remote_head_oid: qa_list.default_branch_head_oid.clone(),
            status: QA_LIST_REPO_SYNC_STATUS_UPDATE_REQUIRED.to_string(),
            message: Some(requirement.message),
            required_app_version: Some(requirement.required_version),
            current_app_version: Some(requirement.current_version),
        };
    }

    QaListRepoSyncSnapshot {
        message: Some(error),
        status: QA_LIST_REPO_SYNC_STATUS_SYNC_ERROR.to_string(),
        ..inspect_qa_list_repo_state(qa_list, repo_path)
    }
}

fn inspect_qa_list_repo_state(
    qa_list: &QaListRepoSyncDescriptor,
    repo_path: &Path,
) -> QaListRepoSyncSnapshot {
    let default_snapshot = || QaListRepoSyncSnapshot {
        repo_name: qa_list.repo_name.clone(),
        repo_path: repo_path.display().to_string(),
        local_head_oid: None,
        remote_head_oid: qa_list.default_branch_head_oid.clone(),
        status: QA_LIST_REPO_SYNC_STATUS_NOT_CLONED.to_string(),
        message: None,
        required_app_version: None,
        current_app_version: None,
    };

    if qa_list_descriptor_is_deleted(qa_list) {
        return QaListRepoSyncSnapshot {
            local_head_oid: read_current_head_oid(repo_path),
            status: QA_LIST_REPO_SYNC_STATUS_UP_TO_DATE.to_string(),
            message: Some("Skipped because this QA list is deleted.".to_string()),
            ..default_snapshot()
        };
    }

    if !repo_path.exists() {
        return default_snapshot();
    }

    if git_output(repo_path, &["rev-parse", "--git-dir"], None).is_err() {
        return default_snapshot();
    }

    let local_head_oid = read_current_head_oid(repo_path);
    let dirty = match git_output(repo_path, &["status", "--porcelain"], None) {
        Ok(value) => !value.trim().is_empty(),
        Err(error) => {
            return QaListRepoSyncSnapshot {
                status: QA_LIST_REPO_SYNC_STATUS_SYNC_ERROR.to_string(),
                message: Some(error),
                local_head_oid,
                ..default_snapshot()
            };
        }
    };

    if dirty {
        return QaListRepoSyncSnapshot {
            local_head_oid,
            status: QA_LIST_REPO_SYNC_STATUS_DIRTY_LOCAL.to_string(),
            message: Some("Local repo has uncommitted changes.".to_string()),
            ..default_snapshot()
        };
    }

    let remote_head_oid = qa_list.default_branch_head_oid.clone();
    let status = if remote_head_oid
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_none()
    {
        if local_head_oid.is_some() {
            QA_LIST_REPO_SYNC_STATUS_OUT_OF_SYNC
        } else {
            QA_LIST_REPO_SYNC_STATUS_UP_TO_DATE
        }
    } else if local_head_oid.as_deref() == remote_head_oid.as_deref() {
        QA_LIST_REPO_SYNC_STATUS_UP_TO_DATE
    } else {
        QA_LIST_REPO_SYNC_STATUS_OUT_OF_SYNC
    };
    let status = if repo_requires_0810_migration(repo_path) {
        QA_LIST_REPO_SYNC_STATUS_OUT_OF_SYNC
    } else {
        status
    };

    QaListRepoSyncSnapshot {
        local_head_oid,
        remote_head_oid,
        status: status.to_string(),
        ..default_snapshot()
    }
}

fn qa_list_repo_matches_identifier(
    repo_path: &Path,
    qa_list_id: Option<&str>,
    repo_name: Option<&str>,
) -> bool {
    let normalized_qa_list_id = normalized_optional_identifier(qa_list_id);
    let normalized_repo_name = normalized_optional_identifier(repo_name);
    let sync_state = read_local_repo_sync_state(repo_path).ok().flatten();

    if let Some(qa_list_id) = normalized_qa_list_id.as_deref() {
        if let Some(resource_id) = sync_state
            .as_ref()
            .and_then(|state| state.resource_id.as_deref())
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return resource_id == qa_list_id;
        }
    }

    if let Some(repo_name) = normalized_repo_name.as_deref() {
        if sync_state
            .as_ref()
            .and_then(|state| state.current_repo_name.as_deref())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            == Some(repo_name)
        {
            return true;
        }

        let folder_name = repo_path
            .file_name()
            .and_then(|name| name.to_str())
            .map(str::trim)
            .unwrap_or_default();
        return folder_name == repo_name;
    }

    false
}

pub(crate) fn find_qa_list_repo_path(
    app: &AppHandle,
    installation_id: i64,
    qa_list_id: Option<&str>,
    repo_name: Option<&str>,
) -> Result<Option<std::path::PathBuf>, String> {
    let repo_root = local_qa_list_repo_root(app, installation_id)?;
    for entry in fs::read_dir(&repo_root)
        .map_err(|error| format!("Could not read the local qa_list repo folder: {error}"))?
    {
        let entry =
            entry.map_err(|error| format!("Could not read a qa_list repo entry: {error}"))?;
        let repo_path = entry.path();
        if !repo_path.is_dir() {
            continue;
        }
        if git_output(&repo_path, &["rev-parse", "--git-dir"], None).is_err() {
            continue;
        }
        if qa_list_repo_matches_identifier(&repo_path, qa_list_id, repo_name) {
            return Ok(Some(repo_path));
        }
    }

    Ok(None)
}

fn resolve_or_desired_qa_list_git_repo_path(
    app: &AppHandle,
    installation_id: i64,
    qa_list_id: Option<&str>,
    repo_name: &str,
) -> Result<std::path::PathBuf, String> {
    match find_qa_list_repo_path(app, installation_id, qa_list_id, Some(repo_name))? {
        Some(repo_path) => Ok(repo_path),
        None => {
            let repo_root = local_qa_list_repo_root(app, installation_id)?;
            Ok(repo_root.join(allocate_short_folder_name(
                repo_name.trim(),
                local_folder_names(&repo_root)?,
            )))
        }
    }
}

fn local_folder_names(repo_root: &Path) -> Result<Vec<String>, String> {
    if !repo_root.exists() {
        return Ok(Vec::new());
    }
    Ok(fs::read_dir(repo_root)
        .map_err(|error| format!("Could not read local QA list repo folders: {error}"))?
        .filter_map(|entry| {
            entry.ok().and_then(|entry| {
                entry
                    .path()
                    .file_name()
                    .and_then(|value| value.to_str())
                    .map(str::to_string)
            })
        })
        .collect())
}

fn sync_qa_list_repo(
    app: &AppHandle,
    qa_list: &QaListRepoSyncDescriptor,
    repo_path: &Path,
    remote_head_oid: &str,
    git_transport_token: &str,
) -> Result<Option<String>, String> {
    if qa_list_descriptor_is_deleted(qa_list) {
        return Ok(read_current_head_oid(repo_path));
    }

    if !repo_path.exists() {
        return clone_qa_list_repo(
            app,
            qa_list,
            repo_path,
            remote_head_oid,
            git_transport_token,
        );
    }

    ensure_qa_list_origin_remote(qa_list, repo_path)?;
    ensure_repo_local_git_identity(app, repo_path)?;

    let branch_name = qa_list
        .default_branch_name
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("main");
    let local_head_oid = read_current_head_oid(repo_path);
    let git_transport_auth = GitTransportAuth::from_token(git_transport_token)?;
    enforce_remote_qa_list_app_version(repo_path, qa_list, branch_name, &git_transport_auth)?;
    if repo_requires_0810_migration(repo_path) {
        sync_pending_repo_layout_migration(
            app,
            repo_path,
            crate::repo_layout_metadata::RepoKind::QaList,
            branch_name,
            remote_head_oid,
        )?;
    }

    if remote_head_oid.trim().is_empty() {
        if local_head_oid.is_some() {
            git_output(
                repo_path,
                &["push", "-u", "origin", branch_name],
                Some(&git_transport_auth),
            )?;
        }
        let current_head_oid = read_current_head_oid(repo_path);
        mark_qa_list_repo_synced(qa_list, repo_path)?;
        return Ok(current_head_oid);
    }

    if let Err(error) = git_output(
        repo_path,
        &["pull", "--rebase", "origin", branch_name],
        Some(&git_transport_auth),
    ) {
        return Err(abort_rebase_after_failed_pull(repo_path, error));
    }
    git_output(
        repo_path,
        &["push", "origin", branch_name],
        Some(&git_transport_auth),
    )?;
    let current_head_oid = read_current_head_oid(repo_path);
    mark_qa_list_repo_synced(qa_list, repo_path)?;
    Ok(current_head_oid)
}

fn ensure_qa_list_origin_remote(
    qa_list: &QaListRepoSyncDescriptor,
    repo_path: &Path,
) -> Result<(), String> {
    let full_name = qa_list.full_name.trim();
    if full_name.is_empty() {
        return Err("Could not determine the remote qa_list repository.".to_string());
    }

    let remote_url = format!("https://github.com/{full_name}.git");
    match git_output(repo_path, &["remote", "get-url", "origin"], None) {
        Ok(existing_url) => {
            if existing_url.trim() != remote_url {
                git_output(
                    repo_path,
                    &["remote", "set-url", "origin", &remote_url],
                    None,
                )?;
            }
        }
        Err(_) => {
            git_output(repo_path, &["remote", "add", "origin", &remote_url], None)?;
        }
    }

    Ok(())
}

fn clone_qa_list_repo(
    app: &AppHandle,
    qa_list: &QaListRepoSyncDescriptor,
    repo_path: &Path,
    remote_head_oid: &str,
    git_transport_token: &str,
) -> Result<Option<String>, String> {
    let repo_parent = repo_path
        .parent()
        .ok_or_else(|| "Could not resolve the local qa_list repo folder.".to_string())?;
    fs::create_dir_all(repo_parent)
        .map_err(|error| format!("Could not create the local qa_list repo folder: {error}"))?;

    let repo_url = format!("https://github.com/{}.git", qa_list.full_name);
    let git_transport_auth = GitTransportAuth::from_token(git_transport_token)?;
    let mut clone_args = vec!["clone"];
    if !remote_head_oid.trim().is_empty() {
        if let Some(branch_name) = qa_list
            .default_branch_name
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            clone_args.extend(["--branch", branch_name, "--single-branch"]);
        }
    }
    clone_args.push(repo_url.as_str());
    let repo_path_string = repo_path.display().to_string();
    clone_args.push(repo_path_string.as_str());
    git_output(repo_parent, &clone_args, Some(&git_transport_auth))?;
    ensure_repo_local_git_identity(app, repo_path)?;
    let branch_name = qa_list
        .default_branch_name
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("main");
    enforce_remote_qa_list_app_version(repo_path, qa_list, branch_name, &git_transport_auth)?;
    if repo_requires_0810_migration(repo_path) {
        sync_pending_repo_layout_migration(
            app,
            repo_path,
            crate::repo_layout_metadata::RepoKind::QaList,
            branch_name,
            remote_head_oid,
        )?;
        if !remote_head_oid.trim().is_empty() {
            git_output(
                repo_path,
                &["push", "origin", branch_name],
                Some(&git_transport_auth),
            )?;
        }
    }

    if remote_head_oid.trim().is_empty() {
        let _ = git_output(repo_path, &["checkout", "-B", &branch_name], None);
    }

    let current_head_oid = read_current_head_oid(repo_path);
    mark_qa_list_repo_synced(qa_list, repo_path)?;
    Ok(current_head_oid)
}

fn enforce_remote_qa_list_app_version(
    repo_path: &Path,
    qa_list: &QaListRepoSyncDescriptor,
    branch_name: &str,
    git_transport_auth: &GitTransportAuth,
) -> Result<(), String> {
    match git_output(
        repo_path,
        &["fetch", "origin", branch_name],
        Some(git_transport_auth),
    ) {
        Ok(_) => {}
        Err(error) if git_error_indicates_missing_remote_ref(&error) => return Ok(()),
        Err(error) => return Err(error),
    }
    let remote_tracking_ref = format!("origin/{branch_name}");
    let resource_name = if qa_list.repo_name.trim().is_empty() {
        qa_list.qa_list_id.as_deref().unwrap_or_default().trim()
    } else {
        qa_list.repo_name.trim()
    };
    if let Some(requirement) =
        remote_ref_requires_newer_app(repo_path, &remote_tracking_ref, "qa_list", resource_name)?
    {
        return Err(encode_repo_app_update_requirement(&requirement));
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalQaListIdentityFile {
    qa_list_id: String,
}

fn mark_qa_list_repo_synced(
    qa_list: &QaListRepoSyncDescriptor,
    repo_path: &Path,
) -> Result<(), String> {
    let qa_list_id = fs::read(repo_path.join("qa-list.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<LocalQaListIdentityFile>(&bytes).ok())
        .map(|file| file.qa_list_id)
        .filter(|value| !value.trim().is_empty());

    upsert_local_repo_sync_state(
        repo_path,
        LocalRepoSyncStateUpdate {
            resource_id: qa_list_id,
            current_repo_name: Some(qa_list.repo_name.clone()),
            kind: Some("qa_list".to_string()),
            has_ever_synced: Some(true),
            last_known_github_repo_id: qa_list.repo_id,
            last_known_full_name: Some(qa_list.full_name.clone()),
            touch_success_timestamp: true,
            storage_layout_version: Some(STORAGE_LAYOUT_VERSION_V2),
            local_folder_name: repo_path
                .file_name()
                .and_then(|value| value.to_str())
                .map(str::to_string),
        },
    )?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        snapshot_from_qa_list_sync_error, QaListRepoSyncDescriptor,
        QA_LIST_REPO_SYNC_STATUS_REMOTE_MIGRATED_LOCAL_CHANGES,
        QA_LIST_REPO_SYNC_STATUS_UPDATE_REQUIRED,
    };
    use crate::repo_app_version::{encode_repo_app_update_requirement, RepoAppUpdateRequirement};
    use crate::repo_migrations::REMOTE_MIGRATED_LOCAL_OLD_LAYOUT_CHANGES_MESSAGE;
    use std::path::Path;

    #[test]
    fn qa_list_sync_error_promotes_update_required_payload_to_snapshot_status() {
        let descriptor = QaListRepoSyncDescriptor {
            qa_list_id: Some("qa_list-1".to_string()),
            repo_name: "qa_list-repo".to_string(),
            full_name: "org/qa_list-repo".to_string(),
            repo_id: None,
            default_branch_name: Some("main".to_string()),
            default_branch_head_oid: Some("remote-head".to_string()),
            lifecycle_state: None,
            record_state: None,
            remote_state: None,
            status: None,
        };
        let error = encode_repo_app_update_requirement(&RepoAppUpdateRequirement {
            required_version: "0.1.36".to_string(),
            current_version: "0.1.35".to_string(),
            resource_kind: "qa_list".to_string(),
            resource_name: "qa_list-repo".to_string(),
            message: "Update required.".to_string(),
        });

        let snapshot = snapshot_from_qa_list_sync_error(&descriptor, Path::new("/tmp/repo"), error);

        assert_eq!(snapshot.status, QA_LIST_REPO_SYNC_STATUS_UPDATE_REQUIRED);
        assert_eq!(snapshot.required_app_version.as_deref(), Some("0.1.36"));
        assert_eq!(snapshot.current_app_version.as_deref(), Some("0.1.35"));
        assert_eq!(snapshot.message.as_deref(), Some("Update required."));
    }

    #[test]
    fn qa_list_sync_error_hides_remote_migrated_old_layout_marker() {
        let descriptor = QaListRepoSyncDescriptor {
            qa_list_id: Some("qa_list-1".to_string()),
            repo_name: "qa_list-repo".to_string(),
            full_name: "org/qa_list-repo".to_string(),
            repo_id: None,
            default_branch_name: Some("main".to_string()),
            default_branch_head_oid: Some("remote-head".to_string()),
            lifecycle_state: None,
            record_state: None,
            remote_state: None,
            status: None,
        };

        let snapshot = snapshot_from_qa_list_sync_error(
            &descriptor,
            Path::new("/tmp/repo"),
            REMOTE_MIGRATED_LOCAL_OLD_LAYOUT_CHANGES_MESSAGE.to_string(),
        );

        assert_eq!(
            snapshot.status,
            QA_LIST_REPO_SYNC_STATUS_REMOTE_MIGRATED_LOCAL_CHANGES
        );
        assert!(snapshot
            .message
            .as_deref()
            .unwrap_or_default()
            .contains("new data format"));
        assert!(!snapshot
            .message
            .as_deref()
            .unwrap_or_default()
            .contains("REMOTE_MIGRATED_LOCAL_OLD_LAYOUT_CHANGES"));
    }

    #[test]
    fn old_layout_discard_keeps_backend_write_access_guard() {
        let source = include_str!("qa_list_repo_sync.rs");
        let discard_start = source
            .find("fn discard_old_layout_gtms_qa_list_repos_sync")
            .expect("discard function exists");
        let changes_start = source
            .find("fn qa_list_term_changes_between_commits")
            .expect("next function exists");
        let discard_body = &source[discard_start..changes_start];
        let guard = "ensure_installation_allows_qa_list_writes(app, input.installation_id)?;";
        let destructive_call = "discard_local_old_layout_changes_and_adopt_remote";
        let guard_index = discard_body
            .find(guard)
            .expect("old-layout discard must verify QA list write access");
        let destructive_index = discard_body
            .find(destructive_call)
            .expect("old-layout discard still calls destructive adoption");

        assert!(
            guard_index < destructive_index,
            "QA list write access must be verified before destructive adoption"
        );
    }
}
