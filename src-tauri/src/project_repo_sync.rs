use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;

use crate::state::ProjectRepoSyncStore;
use crate::{
    local_repo_sync_state::{
        read_local_repo_sync_state, upsert_local_repo_sync_state, LocalRepoSyncStateUpdate,
    },
    repo_app_version::{
        encode_repo_app_update_requirement, parse_repo_app_update_requirement_error,
        remote_ref_requires_newer_app,
    },
    project_repo_paths::resolve_or_desired_project_git_repo_path,
    repo_sync_shared::{
        abort_rebase_after_failed_pull, ensure_repo_local_git_identity, git_output,
        load_git_transport_token, read_current_head_oid, GitTransportAuth,
    },
};

const PROJECT_REPO_SYNC_STATUS_NOT_CLONED: &str = "notCloned";
const PROJECT_REPO_SYNC_STATUS_MISSING_REMOTE_HEAD: &str = "missingRemoteHead";
const PROJECT_REPO_SYNC_STATUS_DIRTY_LOCAL: &str = "dirtyLocal";
const PROJECT_REPO_SYNC_STATUS_UP_TO_DATE: &str = "upToDate";
const PROJECT_REPO_SYNC_STATUS_OUT_OF_SYNC: &str = "outOfSync";
const PROJECT_REPO_SYNC_STATUS_SYNCING: &str = "syncing";
const PROJECT_REPO_SYNC_STATUS_SYNC_ERROR: &str = "syncError";
const PROJECT_REPO_SYNC_STATUS_UNRESOLVED_CONFLICT: &str = "unresolvedConflict";
const PROJECT_REPO_SYNC_STATUS_UPDATE_REQUIRED: &str = "updateRequired";

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectRepoSyncDescriptor {
    pub(crate) project_id: String,
    pub(crate) repo_name: String,
    pub(crate) full_name: String,
    pub(crate) repo_id: Option<i64>,
    pub(crate) default_branch_name: Option<String>,
    pub(crate) default_branch_head_oid: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectRepoSyncInput {
    pub(crate) installation_id: i64,
    pub(crate) projects: Vec<ProjectRepoSyncDescriptor>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectEditorRepoSyncInput {
    pub(crate) installation_id: i64,
    pub(crate) project_id: String,
    pub(crate) repo_name: String,
    pub(crate) full_name: String,
    pub(crate) repo_id: Option<i64>,
    pub(crate) default_branch_name: Option<String>,
    pub(crate) default_branch_head_oid: Option<String>,
    pub(crate) chapter_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InspectProjectEditorRepoSyncStateInput {
    pub(crate) installation_id: i64,
    pub(crate) project_id: String,
    pub(crate) repo_name: String,
    pub(crate) since_head_sha: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectRepoSyncSnapshot {
    pub(crate) project_id: String,
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
pub(crate) struct ProjectEditorRepoSyncResponse {
    pub(crate) old_head_sha: Option<String>,
    pub(crate) new_head_sha: Option<String>,
    pub(crate) changed_row_ids: Vec<String>,
    pub(crate) inserted_row_ids: Vec<String>,
    pub(crate) deleted_row_ids: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InspectProjectEditorRepoSyncStateResponse {
    pub(crate) current_head_sha: Option<String>,
    pub(crate) commits_since_head: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OverwriteConflictedProjectReposResponse {
    pub(crate) resolved_project_ids: Vec<String>,
    pub(crate) skipped_project_ids: Vec<String>,
}

#[tauri::command]
pub(crate) async fn reconcile_project_repo_sync_states(
    app: AppHandle,
    sync_store: tauri::State<'_, ProjectRepoSyncStore>,
    input: ProjectRepoSyncInput,
    session_token: String,
) -> Result<Vec<ProjectRepoSyncSnapshot>, String> {
    let store = sync_store.entries.clone();
    tauri::async_runtime::spawn_blocking(move || {
        reconcile_project_repo_sync_states_sync(&app, store, input, &session_token)
    })
    .await
    .map_err(|error| format!("The project repo reconciliation task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn list_project_repo_sync_states(
    app: AppHandle,
    sync_store: tauri::State<'_, ProjectRepoSyncStore>,
    input: ProjectRepoSyncInput,
) -> Result<Vec<ProjectRepoSyncSnapshot>, String> {
    let store = sync_store.entries.clone();
    tauri::async_runtime::spawn_blocking(move || {
        list_project_repo_sync_states_sync(&app, store, input)
    })
    .await
    .map_err(|error| format!("The project repo sync listing task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn sync_gtms_project_editor_repo(
    app: AppHandle,
    input: ProjectEditorRepoSyncInput,
    session_token: String,
) -> Result<ProjectEditorRepoSyncResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        sync_gtms_project_editor_repo_sync(&app, input, &session_token)
    })
    .await
    .map_err(|error| format!("The editor repo sync task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn inspect_gtms_project_editor_repo_sync_state(
    app: AppHandle,
    input: InspectProjectEditorRepoSyncStateInput,
) -> Result<InspectProjectEditorRepoSyncStateResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        inspect_gtms_project_editor_repo_sync_state_sync(&app, input)
    })
    .await
    .map_err(|error| format!("The editor repo sync inspection task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn overwrite_conflicted_gtms_project_repos(
    app: AppHandle,
    input: ProjectRepoSyncInput,
    session_token: String,
) -> Result<OverwriteConflictedProjectReposResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        overwrite_conflicted_gtms_project_repos_sync(&app, input, &session_token)
    })
    .await
    .map_err(|error| format!("The conflicted project repo overwrite task failed: {error}"))?
}

fn reconcile_project_repo_sync_states_sync(
    app: &AppHandle,
    store: Arc<Mutex<BTreeMap<String, ProjectRepoSyncSnapshot>>>,
    input: ProjectRepoSyncInput,
    session_token: &str,
) -> Result<Vec<ProjectRepoSyncSnapshot>, String> {
    let mut repos_needing_transport = false;

    for project in &input.projects {
        let repo_path = resolve_or_desired_project_git_repo_path(
            app,
            input.installation_id,
            Some(&project.project_id),
            &project.repo_name,
        )?;
        let snapshot = inspect_project_repo_state(project, &repo_path);
        if snapshot.status == PROJECT_REPO_SYNC_STATUS_NOT_CLONED
            || snapshot.status == PROJECT_REPO_SYNC_STATUS_OUT_OF_SYNC
        {
            repos_needing_transport = true;
            break;
        }
    }

    let git_transport_token = if repos_needing_transport {
        Some(load_git_transport_token(
            input.installation_id,
            session_token,
        )?)
    } else {
        None
    };
    let mut snapshots = Vec::with_capacity(input.projects.len());

    for project in input.projects {
        let key = sync_store_key(input.installation_id, &project.project_id);
        let existing = load_sync_snapshot(&store, &key);
        if existing
            .as_ref()
            .map(|snapshot| snapshot.status.as_str() == PROJECT_REPO_SYNC_STATUS_SYNCING)
            .unwrap_or(false)
        {
            if let Some(snapshot) = existing {
                snapshots.push(snapshot);
            }
            continue;
        }

        let repo_path = resolve_or_desired_project_git_repo_path(
            app,
            input.installation_id,
            Some(&project.project_id),
            &project.repo_name,
        )?;
        let inspected_snapshot = inspect_project_repo_state(&project, &repo_path);

        if inspected_snapshot.status == PROJECT_REPO_SYNC_STATUS_NOT_CLONED
            || inspected_snapshot.status == PROJECT_REPO_SYNC_STATUS_OUT_OF_SYNC
        {
            let next_message = if inspected_snapshot.status == PROJECT_REPO_SYNC_STATUS_NOT_CLONED {
                "Cloning repository...".to_string()
            } else {
                "Syncing repository...".to_string()
            };
            let syncing_snapshot = ProjectRepoSyncSnapshot {
                status: PROJECT_REPO_SYNC_STATUS_SYNCING.to_string(),
                message: Some(next_message),
                required_app_version: None,
                current_app_version: None,
                ..inspected_snapshot
            };
            save_sync_snapshot(&store, &key, syncing_snapshot.clone());
            spawn_project_repo_sync_job(
                app.clone(),
                store.clone(),
                key,
                project.clone(),
                repo_path,
                syncing_snapshot.remote_head_oid.clone(),
                git_transport_token.clone().unwrap_or_default(),
            );
            snapshots.push(syncing_snapshot);
            continue;
        }

        save_sync_snapshot(&store, &key, inspected_snapshot.clone());
        snapshots.push(inspected_snapshot);
    }

    Ok(snapshots)
}

fn list_project_repo_sync_states_sync(
    app: &AppHandle,
    store: Arc<Mutex<BTreeMap<String, ProjectRepoSyncSnapshot>>>,
    input: ProjectRepoSyncInput,
) -> Result<Vec<ProjectRepoSyncSnapshot>, String> {
    let mut snapshots = Vec::with_capacity(input.projects.len());

    for project in input.projects {
        let key = sync_store_key(input.installation_id, &project.project_id);
        if let Some(snapshot) = load_sync_snapshot(&store, &key) {
            snapshots.push(snapshot);
            continue;
        }

        let repo_path = resolve_or_desired_project_git_repo_path(
            app,
            input.installation_id,
            Some(&project.project_id),
            &project.repo_name,
        )?;
        let snapshot = inspect_project_repo_state(&project, &repo_path);
        save_sync_snapshot(&store, &key, snapshot.clone());
        snapshots.push(snapshot);
    }

    Ok(snapshots)
}

fn sync_gtms_project_editor_repo_sync(
    app: &AppHandle,
    input: ProjectEditorRepoSyncInput,
    session_token: &str,
) -> Result<ProjectEditorRepoSyncResponse, String> {
    let project = ProjectRepoSyncDescriptor {
        project_id: input.project_id.clone(),
        repo_name: input.repo_name.clone(),
        full_name: input.full_name.clone(),
        repo_id: input.repo_id,
        default_branch_name: input.default_branch_name.clone(),
        default_branch_head_oid: input.default_branch_head_oid.clone(),
    };
    let repo_path = resolve_or_desired_project_git_repo_path(
        app,
        input.installation_id,
        Some(&input.project_id),
        &input.repo_name,
    )?;
    let old_head_sha = read_current_head_oid(&repo_path);
    let git_status = git_output(&repo_path, &["status", "--porcelain"], None)?;
    if !git_status.trim().is_empty() {
        return Err("Local repo has uncommitted changes.".to_string());
    }

    let git_transport_token = load_git_transport_token(input.installation_id, session_token)?;
    let new_head_sha = sync_project_repo(
        app,
        &project,
        &repo_path,
        input.default_branch_head_oid.as_deref().unwrap_or_default(),
        &git_transport_token,
    )?;
    let chapter_path = find_editor_chapter_path_by_id(&repo_path, &input.chapter_id)?;
    let chapter_rows_path = chapter_path.join("rows");
    let chapter_rows_relative_path = chapter_rows_path
        .strip_prefix(&repo_path)
        .map_err(|error| format!("Could not resolve the chapter rows path for git: {error}"))?
        .to_string_lossy()
        .to_string();
    let (changed_row_ids, inserted_row_ids, deleted_row_ids) =
        match (old_head_sha.as_deref(), new_head_sha.as_deref()) {
            (Some(old_head), Some(new_head)) if old_head != new_head => {
                chapter_row_changes_between_commits(
                    &repo_path,
                    &chapter_rows_relative_path,
                    old_head,
                    new_head,
                )?
            }
            _ => (Vec::new(), Vec::new(), Vec::new()),
        };

    Ok(ProjectEditorRepoSyncResponse {
        old_head_sha,
        new_head_sha,
        changed_row_ids,
        inserted_row_ids,
        deleted_row_ids,
    })
}

fn inspect_gtms_project_editor_repo_sync_state_sync(
    app: &AppHandle,
    input: InspectProjectEditorRepoSyncStateInput,
) -> Result<InspectProjectEditorRepoSyncStateResponse, String> {
    let repo_path = resolve_or_desired_project_git_repo_path(
        app,
        input.installation_id,
        Some(&input.project_id),
        &input.repo_name,
    )?;
    let current_head_sha = read_current_head_oid(&repo_path);
    let commits_since_head = input
        .since_head_sha
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|since_head_sha| {
            if current_head_sha.as_deref() == Some(since_head_sha) {
                return Ok(0usize);
            }

            let revision_range = format!("{since_head_sha}..HEAD");
            let count_text =
                git_output(&repo_path, &["rev-list", "--count", &revision_range], None)?;
            count_text
                .trim()
                .parse::<usize>()
                .map_err(|error| format!("Could not parse the local commit count: {error}"))
        })
        .transpose()?
        .unwrap_or(0);

    Ok(InspectProjectEditorRepoSyncStateResponse {
        current_head_sha,
        commits_since_head,
    })
}

fn spawn_project_repo_sync_job(
    app: AppHandle,
    store: Arc<Mutex<BTreeMap<String, ProjectRepoSyncSnapshot>>>,
    key: String,
    project: ProjectRepoSyncDescriptor,
    repo_path: PathBuf,
    remote_head_oid: Option<String>,
    git_transport_token: String,
) {
    tauri::async_runtime::spawn_blocking(move || {
        let sync_result = sync_project_repo(
            &app,
            &project,
            &repo_path,
            remote_head_oid.as_deref().unwrap_or_default(),
            &git_transport_token,
        );

        let next_snapshot = match sync_result {
            Ok(local_head_oid) => ProjectRepoSyncSnapshot {
                project_id: project.project_id.clone(),
                repo_name: project.repo_name.clone(),
                repo_path: repo_path.display().to_string(),
                local_head_oid: local_head_oid.clone(),
                remote_head_oid: local_head_oid,
                status: PROJECT_REPO_SYNC_STATUS_UP_TO_DATE.to_string(),
                message: None,
                required_app_version: None,
                current_app_version: None,
            },
            Err(error) => {
                snapshot_from_project_sync_error(&project, &repo_path, error)
            }
        };

        save_sync_snapshot(&store, &key, next_snapshot);
    });
}

fn snapshot_from_project_sync_error(
    project: &ProjectRepoSyncDescriptor,
    repo_path: &Path,
    error: String,
) -> ProjectRepoSyncSnapshot {
    if let Some(requirement) = parse_repo_app_update_requirement_error(&error) {
        return ProjectRepoSyncSnapshot {
            project_id: project.project_id.clone(),
            repo_name: project.repo_name.clone(),
            repo_path: repo_path.display().to_string(),
            local_head_oid: read_current_head_oid(repo_path),
            remote_head_oid: project.default_branch_head_oid.clone(),
            status: PROJECT_REPO_SYNC_STATUS_UPDATE_REQUIRED.to_string(),
            message: Some(requirement.message),
            required_app_version: Some(requirement.required_version),
            current_app_version: Some(requirement.current_version),
        };
    }

    let inspected_snapshot = inspect_project_repo_state(project, repo_path);
    if inspected_snapshot.status == PROJECT_REPO_SYNC_STATUS_UNRESOLVED_CONFLICT {
        ProjectRepoSyncSnapshot {
            message: Some(error),
            ..inspected_snapshot
        }
    } else {
        ProjectRepoSyncSnapshot {
            status: PROJECT_REPO_SYNC_STATUS_SYNC_ERROR.to_string(),
            message: Some(error),
            ..inspected_snapshot
        }
    }
}

fn chapter_row_changes_between_commits(
    repo_path: &Path,
    chapter_rows_relative_path: &str,
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
            chapter_rows_relative_path,
        ],
        None,
    )?;
    let mut changed_row_ids = Vec::new();
    let mut inserted_row_ids = Vec::new();
    let mut deleted_row_ids = Vec::new();

    for line in diff_output.lines() {
        let fields = line.split('\t').collect::<Vec<_>>();
        let Some(status) = fields.first().copied() else {
            continue;
        };
        match status.chars().next().unwrap_or_default() {
            'A' => {
                if let Some(path) = fields.get(1).copied() {
                    if let Some(row_id) = row_id_from_repo_relative_path(path) {
                        inserted_row_ids.push(row_id);
                    }
                }
            }
            'D' => {
                if let Some(path) = fields.get(1).copied() {
                    if let Some(row_id) = row_id_from_repo_relative_path(path) {
                        deleted_row_ids.push(row_id);
                    }
                }
            }
            'R' => {
                if let Some(path) = fields.get(1).copied() {
                    if let Some(row_id) = row_id_from_repo_relative_path(path) {
                        deleted_row_ids.push(row_id);
                    }
                }
                if let Some(path) = fields.get(2).copied() {
                    if let Some(row_id) = row_id_from_repo_relative_path(path) {
                        inserted_row_ids.push(row_id);
                    }
                }
            }
            _ => {
                if let Some(path) = fields.last().copied() {
                    if let Some(row_id) = row_id_from_repo_relative_path(path) {
                        changed_row_ids.push(row_id);
                    }
                }
            }
        }
    }

    changed_row_ids.sort();
    changed_row_ids.dedup();
    inserted_row_ids.sort();
    inserted_row_ids.dedup();
    deleted_row_ids.sort();
    deleted_row_ids.dedup();

    Ok((changed_row_ids, inserted_row_ids, deleted_row_ids))
}

fn row_id_from_repo_relative_path(path: &str) -> Option<String> {
    let normalized = path.trim();
    if !normalized.ends_with(".json") {
        return None;
    }

    Path::new(normalized)
        .file_stem()
        .and_then(|value| value.to_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn find_editor_chapter_path_by_id(repo_path: &Path, chapter_id: &str) -> Result<PathBuf, String> {
    let chapters_root = repo_path.join("chapters");
    let entries = fs::read_dir(&chapters_root).map_err(|error| {
        format!(
            "Could not read chapters folder '{}': {error}",
            chapters_root.display()
        )
    })?;

    for entry in entries {
        let entry =
            entry.map_err(|error| format!("Could not read a chapter folder entry: {error}"))?;
        let chapter_path = entry.path();
        if !chapter_path.is_dir() {
            continue;
        }

        let chapter_json_path = chapter_path.join("chapter.json");
        if !chapter_json_path.exists() {
            continue;
        }

        let chapter_json = fs::read_to_string(&chapter_json_path).map_err(|error| {
            format!(
                "Could not read chapter metadata '{}': {error}",
                chapter_json_path.display()
            )
        })?;
        let chapter_value: Value = serde_json::from_str(&chapter_json).map_err(|error| {
            format!(
                "Could not parse chapter metadata '{}': {error}",
                chapter_json_path.display()
            )
        })?;
        if chapter_value.get("chapter_id").and_then(Value::as_str) == Some(chapter_id) {
            return Ok(chapter_path);
        }
    }

    Err(format!(
        "Could not find chapter '{chapter_id}' in the local project repo."
    ))
}

fn inspect_project_repo_state(
    project: &ProjectRepoSyncDescriptor,
    repo_path: &Path,
) -> ProjectRepoSyncSnapshot {
    let default_snapshot = || ProjectRepoSyncSnapshot {
        project_id: project.project_id.clone(),
        repo_name: project.repo_name.clone(),
        repo_path: repo_path.display().to_string(),
        local_head_oid: None,
        remote_head_oid: project.default_branch_head_oid.clone(),
        status: PROJECT_REPO_SYNC_STATUS_NOT_CLONED.to_string(),
        message: None,
        required_app_version: None,
        current_app_version: None,
    };

    if !repo_path.exists() {
        return default_snapshot();
    }

    if git_output(repo_path, &["rev-parse", "--git-dir"], None).is_err() {
        return default_snapshot();
    }

    let local_head_oid = match git_output(repo_path, &["rev-parse", "HEAD"], None) {
        Ok(value) => Some(value),
        Err(error) => {
            return ProjectRepoSyncSnapshot {
                status: PROJECT_REPO_SYNC_STATUS_SYNC_ERROR.to_string(),
                message: Some(error),
                ..default_snapshot()
            };
        }
    };

    let git_status_porcelain = match git_output(repo_path, &["status", "--porcelain"], None) {
        Ok(value) => value,
        Err(error) => {
            return ProjectRepoSyncSnapshot {
                status: PROJECT_REPO_SYNC_STATUS_SYNC_ERROR.to_string(),
                message: Some(error),
                local_head_oid,
                ..default_snapshot()
            };
        }
    };

    if let Some(conflict_message) =
        detect_unresolved_project_repo_conflict(repo_path, &git_status_porcelain)
    {
        return ProjectRepoSyncSnapshot {
            local_head_oid,
            status: PROJECT_REPO_SYNC_STATUS_UNRESOLVED_CONFLICT.to_string(),
            message: Some(conflict_message),
            ..default_snapshot()
        };
    }

    let dirty = !git_status_porcelain.trim().is_empty();

    if dirty {
        return ProjectRepoSyncSnapshot {
            local_head_oid,
            status: PROJECT_REPO_SYNC_STATUS_DIRTY_LOCAL.to_string(),
            message: Some("Local repo has uncommitted changes.".to_string()),
            ..default_snapshot()
        };
    }

    let remote_head_oid = project.default_branch_head_oid.clone();
    let Some(remote_head_oid_value) = remote_head_oid.clone() else {
        return ProjectRepoSyncSnapshot {
            local_head_oid,
            status: PROJECT_REPO_SYNC_STATUS_MISSING_REMOTE_HEAD.to_string(),
            message: Some("Remote default branch head is unavailable.".to_string()),
            ..default_snapshot()
        };
    };

    let status = if local_head_oid.as_deref() == Some(remote_head_oid_value.as_str()) {
        PROJECT_REPO_SYNC_STATUS_UP_TO_DATE
    } else {
        PROJECT_REPO_SYNC_STATUS_OUT_OF_SYNC
    };

    ProjectRepoSyncSnapshot {
        local_head_oid,
        remote_head_oid,
        status: status.to_string(),
        ..default_snapshot()
    }
}

fn sync_project_repo(
    app: &AppHandle,
    project: &ProjectRepoSyncDescriptor,
    repo_path: &Path,
    remote_head_oid: &str,
    git_transport_token: &str,
) -> Result<Option<String>, String> {
    if !repo_path.exists() {
        return clone_project_repo(
            app,
            project,
            repo_path,
            remote_head_oid,
            git_transport_token,
        );
    }

    ensure_project_origin_remote(project, repo_path)?;
    ensure_repo_local_git_identity(app, repo_path)?;

    let branch_name = project
        .default_branch_name
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("main");
    let local_head_oid = git_output(repo_path, &["rev-parse", "HEAD"], None).ok();
    let local_sync_state = read_local_repo_sync_state(repo_path)?;

    let git_transport_auth = GitTransportAuth::from_token(git_transport_token)?;
    if remote_head_oid.trim().is_empty() {
        if local_head_oid.is_some() {
            git_output(
                repo_path,
                &["push", "-u", "origin", branch_name],
                Some(&git_transport_auth),
            )?;
        }
        let current_head_oid = git_output(repo_path, &["rev-parse", "HEAD"], None).ok();
        mark_project_repo_synced(project, repo_path)?;
        return Ok(current_head_oid);
    }

    enforce_remote_project_app_version(repo_path, project, branch_name, &git_transport_auth)?;

    if local_sync_state
        .as_ref()
        .map(|state| !state.has_ever_synced)
        .unwrap_or(false)
    {
        let current_head_oid = attach_unsynced_local_project_repo_to_remote(
            repo_path,
            branch_name,
            &git_transport_auth,
        )?;
        mark_project_repo_synced(project, repo_path)?;
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
    let current_head_oid = Some(git_output(repo_path, &["rev-parse", "HEAD"], None)?);
    mark_project_repo_synced(project, repo_path)?;
    Ok(current_head_oid)
}

fn overwrite_conflicted_gtms_project_repos_sync(
    app: &AppHandle,
    input: ProjectRepoSyncInput,
    session_token: &str,
) -> Result<OverwriteConflictedProjectReposResponse, String> {
    let git_transport_token = load_git_transport_token(input.installation_id, session_token)?;
    let git_transport_auth = GitTransportAuth::from_token(&git_transport_token)?;
    let mut resolved_project_ids = Vec::new();
    let mut skipped_project_ids = Vec::new();

    for project in input.projects {
        let repo_path = resolve_or_desired_project_git_repo_path(
            app,
            input.installation_id,
            Some(&project.project_id),
            &project.repo_name,
        )?;
        let snapshot = inspect_project_repo_state(&project, &repo_path);
        if snapshot.status != PROJECT_REPO_SYNC_STATUS_UNRESOLVED_CONFLICT {
            skipped_project_ids.push(project.project_id.clone());
            continue;
        }

        overwrite_project_repo_with_remote(app, &project, &repo_path, &git_transport_auth)?;
        mark_project_repo_synced(&project, &repo_path)?;
        resolved_project_ids.push(project.project_id);
    }

    Ok(OverwriteConflictedProjectReposResponse {
        resolved_project_ids,
        skipped_project_ids,
    })
}

fn overwrite_project_repo_with_remote(
    app: &AppHandle,
    project: &ProjectRepoSyncDescriptor,
    repo_path: &Path,
    git_transport_auth: &GitTransportAuth,
) -> Result<(), String> {
    if !repo_path.exists() || git_output(repo_path, &["rev-parse", "--git-dir"], None).is_err() {
        return Err("Could not find the local project repo to overwrite.".to_string());
    }

    ensure_project_origin_remote(project, repo_path)?;
    ensure_repo_local_git_identity(app, repo_path)?;
    abort_in_progress_git_operations(repo_path);

    let branch_name = project_branch_name(project);
    let remote_tracking_ref = format!("origin/{branch_name}");

    let _ = git_output(repo_path, &["reset", "--hard"], None);
    let _ = git_output(repo_path, &["clean", "-fd"], None);
    git_output(
        repo_path,
        &["fetch", "origin", &branch_name],
        Some(git_transport_auth),
    )?;
    git_output(
        repo_path,
        &["checkout", "-B", &branch_name, &remote_tracking_ref],
        None,
    )?;
    git_output(repo_path, &["reset", "--hard", &remote_tracking_ref], None)?;
    git_output(repo_path, &["clean", "-fd"], None)?;

    Ok(())
}

fn attach_unsynced_local_project_repo_to_remote(
    repo_path: &Path,
    branch_name: &str,
    git_transport_auth: &GitTransportAuth,
) -> Result<Option<String>, String> {
    git_output(
        repo_path,
        &["fetch", "origin", branch_name],
        Some(git_transport_auth),
    )?;

    let remote_tracking_ref = format!("origin/{branch_name}");
    git_output(
        repo_path,
        &["checkout", "-B", branch_name, &remote_tracking_ref],
        None,
    )?;

    Ok(Some(git_output(repo_path, &["rev-parse", "HEAD"], None)?))
}

fn detect_unresolved_project_repo_conflict(
    repo_path: &Path,
    git_status_porcelain: &str,
) -> Option<String> {
    let has_unresolved_conflicts = git_status_porcelain_has_unmerged_entries(git_status_porcelain)
        || repo_has_rebase_in_progress_local(repo_path)
        || repo_has_git_state_path(repo_path, "MERGE_HEAD")
        || repo_has_git_state_path(repo_path, "CHERRY_PICK_HEAD")
        || repo_has_git_state_path(repo_path, "REVERT_HEAD");
    if !has_unresolved_conflicts {
        return None;
    }

    git_output(repo_path, &["status"], None)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| Some("Git reported an unresolved local merge conflict.".to_string()))
}

fn git_status_porcelain_has_unmerged_entries(git_status_porcelain: &str) -> bool {
    git_status_porcelain.lines().any(|line| {
        let prefix = line.chars().take(2).collect::<String>();
        matches!(
            prefix.as_str(),
            "DD" | "AU" | "UD" | "UA" | "DU" | "AA" | "UU"
        )
    })
}

fn repo_has_rebase_in_progress_local(repo_path: &Path) -> bool {
    repo_has_git_state_path(repo_path, "rebase-apply")
        || repo_has_git_state_path(repo_path, "rebase-merge")
}

fn repo_has_git_state_path(repo_path: &Path, git_path: &str) -> bool {
    git_output(repo_path, &["rev-parse", "--git-path", git_path], None)
        .ok()
        .map(|path| resolve_repo_git_path(repo_path, &path).exists())
        .unwrap_or(false)
}

fn resolve_repo_git_path(repo_path: &Path, git_path: &str) -> PathBuf {
    let path = PathBuf::from(git_path);
    if path.is_absolute() {
        path
    } else {
        repo_path.join(path)
    }
}

fn abort_in_progress_git_operations(repo_path: &Path) {
    if repo_has_rebase_in_progress_local(repo_path) {
        let _ = git_output(repo_path, &["rebase", "--abort"], None);
    }
    if repo_has_git_state_path(repo_path, "MERGE_HEAD") {
        let _ = git_output(repo_path, &["merge", "--abort"], None);
    }
    if repo_has_git_state_path(repo_path, "CHERRY_PICK_HEAD") {
        let _ = git_output(repo_path, &["cherry-pick", "--abort"], None);
    }
    if repo_has_git_state_path(repo_path, "REVERT_HEAD") {
        let _ = git_output(repo_path, &["revert", "--abort"], None);
    }
}

fn project_branch_name(project: &ProjectRepoSyncDescriptor) -> String {
    project
        .default_branch_name
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("main")
        .to_string()
}

fn ensure_project_origin_remote(
    project: &ProjectRepoSyncDescriptor,
    repo_path: &Path,
) -> Result<(), String> {
    let full_name = project.full_name.trim();
    if full_name.is_empty() {
        return Err("Could not determine the remote project repository.".to_string());
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

fn clone_project_repo(
    app: &AppHandle,
    project: &ProjectRepoSyncDescriptor,
    repo_path: &Path,
    remote_head_oid: &str,
    git_transport_token: &str,
) -> Result<Option<String>, String> {
    let repo_parent = repo_path
        .parent()
        .ok_or_else(|| "Could not resolve the local repo folder.".to_string())?;
    fs::create_dir_all(repo_parent)
        .map_err(|error| format!("Could not create the local repo folder: {error}"))?;

    let repo_url = format!("https://github.com/{}.git", project.full_name);
    let git_transport_auth = GitTransportAuth::from_token(git_transport_token)?;
    let mut clone_args = vec!["clone"];
    if !remote_head_oid.trim().is_empty() {
        if let Some(branch_name) = project
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

    if !remote_head_oid.trim().is_empty() {
        let branch_name = project_branch_name(project);
        enforce_remote_project_app_version(repo_path, project, &branch_name, &git_transport_auth)?;
    }

    if remote_head_oid.trim().is_empty() {
        let branch_name = project
            .default_branch_name
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("main");
        let _ = git_output(repo_path, &["checkout", "-B", branch_name], None);
    }

    let current_head_oid = git_output(repo_path, &["rev-parse", "HEAD"], None).ok();
    mark_project_repo_synced(project, repo_path)?;
    Ok(current_head_oid)
}

fn enforce_remote_project_app_version(
    repo_path: &Path,
    project: &ProjectRepoSyncDescriptor,
    branch_name: &str,
    git_transport_auth: &GitTransportAuth,
) -> Result<(), String> {
    git_output(
        repo_path,
        &["fetch", "origin", branch_name],
        Some(git_transport_auth),
    )?;
    let remote_tracking_ref = format!("origin/{branch_name}");
    let resource_name = if project.repo_name.trim().is_empty() {
        project.project_id.trim()
    } else {
        project.repo_name.trim()
    };
    if let Some(requirement) =
        remote_ref_requires_newer_app(repo_path, &remote_tracking_ref, "project", resource_name)?
    {
        return Err(encode_repo_app_update_requirement(&requirement));
    }
    Ok(())
}

fn mark_project_repo_synced(
    project: &ProjectRepoSyncDescriptor,
    repo_path: &Path,
) -> Result<(), String> {
    upsert_local_repo_sync_state(
        repo_path,
        LocalRepoSyncStateUpdate {
            resource_id: Some(project.project_id.clone()),
            current_repo_name: Some(project.repo_name.clone()),
            kind: Some("project".to_string()),
            has_ever_synced: Some(true),
            last_known_github_repo_id: project.repo_id,
            last_known_full_name: Some(project.full_name.clone()),
            touch_success_timestamp: true,
        },
    )?;

    Ok(())
}

fn sync_store_key(installation_id: i64, project_id: &str) -> String {
    format!(
        "installation:{installation_id}:{}",
        project_id.trim().to_lowercase()
    )
}

fn load_sync_snapshot(
    store: &Arc<Mutex<BTreeMap<String, ProjectRepoSyncSnapshot>>>,
    key: &str,
) -> Option<ProjectRepoSyncSnapshot> {
    store
        .lock()
        .ok()
        .and_then(|entries| entries.get(key).cloned())
}

fn save_sync_snapshot(
    store: &Arc<Mutex<BTreeMap<String, ProjectRepoSyncSnapshot>>>,
    key: &str,
    snapshot: ProjectRepoSyncSnapshot,
) {
    if let Ok(mut entries) = store.lock() {
        entries.insert(key.to_string(), snapshot);
    }
}

#[cfg(test)]
mod tests {
    use super::{
        git_status_porcelain_has_unmerged_entries, project_branch_name,
        snapshot_from_project_sync_error, ProjectRepoSyncDescriptor,
        PROJECT_REPO_SYNC_STATUS_UPDATE_REQUIRED,
    };
    use crate::repo_app_version::{
        encode_repo_app_update_requirement, RepoAppUpdateRequirement,
    };
    use std::path::Path;

    #[test]
    fn git_status_porcelain_has_unmerged_entries_detects_conflicts() {
        assert!(git_status_porcelain_has_unmerged_entries("UU chapters/file.txt\n"));
        assert!(git_status_porcelain_has_unmerged_entries("AA rows/1.json\n"));
        assert!(!git_status_porcelain_has_unmerged_entries(" M chapters/file.txt\n"));
        assert!(!git_status_porcelain_has_unmerged_entries("?? stray.txt\n"));
    }

    #[test]
    fn project_branch_name_falls_back_to_main() {
        let descriptor = ProjectRepoSyncDescriptor {
            project_id: "project-1".to_string(),
            repo_name: "repo-one".to_string(),
            full_name: "org/repo-one".to_string(),
            repo_id: None,
            default_branch_name: None,
            default_branch_head_oid: None,
        };

        assert_eq!(project_branch_name(&descriptor), "main");
    }

    #[test]
    fn project_branch_name_prefers_configured_branch() {
        let descriptor = ProjectRepoSyncDescriptor {
            project_id: "project-1".to_string(),
            repo_name: "repo-one".to_string(),
            full_name: "org/repo-one".to_string(),
            repo_id: None,
            default_branch_name: Some("trunk".to_string()),
            default_branch_head_oid: None,
        };

        assert_eq!(project_branch_name(&descriptor), "trunk");
    }

    #[test]
    fn project_sync_error_promotes_update_required_payload_to_snapshot_status() {
        let descriptor = ProjectRepoSyncDescriptor {
            project_id: "project-1".to_string(),
            repo_name: "repo-one".to_string(),
            full_name: "org/repo-one".to_string(),
            repo_id: None,
            default_branch_name: Some("main".to_string()),
            default_branch_head_oid: Some("remote-head".to_string()),
        };
        let error = encode_repo_app_update_requirement(&RepoAppUpdateRequirement {
            required_version: "0.1.36".to_string(),
            current_version: "0.1.35".to_string(),
            resource_kind: "project".to_string(),
            resource_name: "repo-one".to_string(),
            message: "Update required.".to_string(),
        });

        let snapshot = snapshot_from_project_sync_error(&descriptor, Path::new("/tmp/repo"), error);

        assert_eq!(snapshot.status, PROJECT_REPO_SYNC_STATUS_UPDATE_REQUIRED);
        assert_eq!(snapshot.required_app_version.as_deref(), Some("0.1.36"));
        assert_eq!(snapshot.current_app_version.as_deref(), Some("0.1.35"));
        assert_eq!(snapshot.message.as_deref(), Some("Update required."));
    }
}
