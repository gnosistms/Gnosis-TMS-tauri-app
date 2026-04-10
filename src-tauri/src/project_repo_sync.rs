use std::{
  collections::BTreeMap,
  fs,
  path::{Path, PathBuf},
  sync::{Arc, Mutex},
};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::{
  local_repo_sync_state::{LocalRepoSyncStateUpdate, read_local_repo_sync_state, upsert_local_repo_sync_state},
  project_repo_paths::resolve_or_desired_project_git_repo_path,
  repo_sync_shared::{
    GitTransportAuth,
    abort_rebase_after_failed_pull,
    git_output,
    load_git_transport_token,
  },
};
use crate::state::ProjectRepoSyncStore;

const PROJECT_REPO_SYNC_STATUS_NOT_CLONED: &str = "notCloned";
const PROJECT_REPO_SYNC_STATUS_MISSING_REMOTE_HEAD: &str = "missingRemoteHead";
const PROJECT_REPO_SYNC_STATUS_DIRTY_LOCAL: &str = "dirtyLocal";
const PROJECT_REPO_SYNC_STATUS_UP_TO_DATE: &str = "upToDate";
const PROJECT_REPO_SYNC_STATUS_OUT_OF_SYNC: &str = "outOfSync";
const PROJECT_REPO_SYNC_STATUS_SYNCING: &str = "syncing";
const PROJECT_REPO_SYNC_STATUS_SYNC_ERROR: &str = "syncError";

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
  tauri::async_runtime::spawn_blocking(move || list_project_repo_sync_states_sync(&app, store, input))
    .await
    .map_err(|error| format!("The project repo sync listing task failed: {error}"))?
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
    Some(load_git_transport_token(input.installation_id, session_token)?)
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
        ..inspected_snapshot
      };
      save_sync_snapshot(&store, &key, syncing_snapshot.clone());
      spawn_project_repo_sync_job(
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

fn spawn_project_repo_sync_job(
  store: Arc<Mutex<BTreeMap<String, ProjectRepoSyncSnapshot>>>,
  key: String,
  project: ProjectRepoSyncDescriptor,
  repo_path: PathBuf,
  remote_head_oid: Option<String>,
  git_transport_token: String,
) {
  tauri::async_runtime::spawn_blocking(move || {
    let sync_result =
      sync_project_repo(
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
      },
      Err(error) => ProjectRepoSyncSnapshot {
        status: PROJECT_REPO_SYNC_STATUS_SYNC_ERROR.to_string(),
        message: Some(error),
        ..inspect_project_repo_state(&project, &repo_path)
      },
    };

    save_sync_snapshot(&store, &key, next_snapshot);
  });
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

  let dirty = match git_output(repo_path, &["status", "--porcelain"], None) {
    Ok(value) => !value.trim().is_empty(),
    Err(error) => {
      return ProjectRepoSyncSnapshot {
        status: PROJECT_REPO_SYNC_STATUS_SYNC_ERROR.to_string(),
        message: Some(error),
        local_head_oid,
        ..default_snapshot()
      };
    }
  };

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
  project: &ProjectRepoSyncDescriptor,
  repo_path: &Path,
  remote_head_oid: &str,
  git_transport_token: &str,
) -> Result<Option<String>, String> {
  if !repo_path.exists() {
    return clone_project_repo(project, repo_path, remote_head_oid, git_transport_token);
  }

  ensure_project_origin_remote(project, repo_path)?;

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
      git_output(repo_path, &["push", "-u", "origin", branch_name], Some(&git_transport_auth))?;
    }
    let current_head_oid = git_output(repo_path, &["rev-parse", "HEAD"], None).ok();
    mark_project_repo_synced(project, repo_path)?;
    return Ok(current_head_oid);
  }

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
  git_output(repo_path, &["push", "origin", branch_name], Some(&git_transport_auth))?;
  let current_head_oid = Some(git_output(repo_path, &["rev-parse", "HEAD"], None)?);
  mark_project_repo_synced(project, repo_path)?;
  Ok(current_head_oid)
}

fn attach_unsynced_local_project_repo_to_remote(
  repo_path: &Path,
  branch_name: &str,
  git_transport_auth: &GitTransportAuth,
) -> Result<Option<String>, String> {
  git_output(repo_path, &["fetch", "origin", branch_name], Some(git_transport_auth))?;

  let remote_tracking_ref = format!("origin/{branch_name}");
  git_output(
    repo_path,
    &["checkout", "-B", branch_name, &remote_tracking_ref],
    None,
  )?;

  Ok(Some(git_output(repo_path, &["rev-parse", "HEAD"], None)?))
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
        git_output(repo_path, &["remote", "set-url", "origin", &remote_url], None)?;
      }
    }
    Err(_) => {
      git_output(repo_path, &["remote", "add", "origin", &remote_url], None)?;
    }
  }

  Ok(())
}

fn clone_project_repo(
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
  format!("installation:{installation_id}:{}", project_id.trim().to_lowercase())
}

fn load_sync_snapshot(
  store: &Arc<Mutex<BTreeMap<String, ProjectRepoSyncSnapshot>>>,
  key: &str,
) -> Option<ProjectRepoSyncSnapshot> {
  store.lock().ok().and_then(|entries| entries.get(key).cloned())
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
