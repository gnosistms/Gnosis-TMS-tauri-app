use std::{
  collections::BTreeMap,
  fs,
  path::{Path, PathBuf},
  process::Command,
  sync::{Arc, Mutex},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

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
) -> Result<Vec<ProjectRepoSyncSnapshot>, String> {
  let store = sync_store.entries.clone();
  tauri::async_runtime::spawn_blocking(move || {
    reconcile_project_repo_sync_states_sync(&app, store, input)
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
) -> Result<Vec<ProjectRepoSyncSnapshot>, String> {
  let repo_root = local_project_repo_root(app, input.installation_id)?;
  let mut snapshots = Vec::with_capacity(input.projects.len());

  for project in input.projects {
    let key = sync_store_key(input.installation_id, &project.repo_name);
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

    let repo_path = repo_root.join(&project.repo_name);
    let inspected_snapshot = inspect_project_repo_state(&project, &repo_path);

    if inspected_snapshot.status == PROJECT_REPO_SYNC_STATUS_OUT_OF_SYNC {
      let syncing_snapshot = ProjectRepoSyncSnapshot {
        status: PROJECT_REPO_SYNC_STATUS_SYNCING.to_string(),
        message: Some("Syncing repository...".to_string()),
        ..inspected_snapshot
      };
      save_sync_snapshot(&store, &key, syncing_snapshot.clone());
      spawn_project_repo_sync_job(
        store.clone(),
        key,
        project.clone(),
        repo_path,
        syncing_snapshot.remote_head_oid.clone(),
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
  let repo_root = local_project_repo_root(app, input.installation_id)?;
  let mut snapshots = Vec::with_capacity(input.projects.len());

  for project in input.projects {
    let key = sync_store_key(input.installation_id, &project.repo_name);
    if let Some(snapshot) = load_sync_snapshot(&store, &key) {
      snapshots.push(snapshot);
      continue;
    }

    let repo_path = repo_root.join(&project.repo_name);
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
) {
  tauri::async_runtime::spawn_blocking(move || {
    let sync_result =
      sync_project_repo(&project, &repo_path, remote_head_oid.as_deref().unwrap_or_default());

    let next_snapshot = match sync_result {
      Ok(local_head_oid) => ProjectRepoSyncSnapshot {
        project_id: project.project_id.clone(),
        repo_name: project.repo_name.clone(),
        repo_path: repo_path.display().to_string(),
        local_head_oid: Some(local_head_oid.clone()),
        remote_head_oid: Some(local_head_oid),
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

  if git_output(repo_path, &["rev-parse", "--git-dir"]).is_err() {
    return default_snapshot();
  }

  let local_head_oid = match git_output(repo_path, &["rev-parse", "HEAD"]) {
    Ok(value) => Some(value),
    Err(error) => {
      return ProjectRepoSyncSnapshot {
        status: PROJECT_REPO_SYNC_STATUS_SYNC_ERROR.to_string(),
        message: Some(error),
        ..default_snapshot()
      };
    }
  };

  let dirty = match git_output(repo_path, &["status", "--porcelain"]) {
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
) -> Result<String, String> {
  let branch_name = project
    .default_branch_name
    .as_deref()
    .filter(|value| !value.trim().is_empty())
    .ok_or_else(|| "Missing default branch name for repo sync.".to_string())?;

  if remote_head_oid.trim().is_empty() {
    return Err("Missing remote default branch head for repo sync.".to_string());
  }

  git_output(repo_path, &["pull", "--rebase", "origin", branch_name])?;
  git_output(repo_path, &["push", "origin", branch_name])?;
  git_output(repo_path, &["rev-parse", "HEAD"])
}

fn local_project_repo_root(app: &AppHandle, installation_id: i64) -> Result<PathBuf, String> {
  let app_data_dir = app
    .path()
    .app_data_dir()
    .map_err(|error| format!("Could not resolve the app data folder: {error}"))?;
  let root = app_data_dir
    .join("project-repos")
    .join(format!("installation-{installation_id}"));
  fs::create_dir_all(&root)
    .map_err(|error| format!("Could not create the local project repo folder: {error}"))?;
  Ok(root)
}

fn git_output(repo_path: &Path, args: &[&str]) -> Result<String, String> {
  let output = Command::new("git")
    .args(args)
    .current_dir(repo_path)
    .output()
    .map_err(|error| format!("Could not run git {}: {error}", args.join(" ")))?;

  if !output.status.success() {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let detail = if !stderr.is_empty() {
      stderr
    } else if !stdout.is_empty() {
      stdout
    } else {
      format!("exit status {}", output.status)
    };
    return Err(format!("git {} failed: {detail}", args.join(" ")));
  }

  Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn sync_store_key(installation_id: i64, repo_name: &str) -> String {
  format!("installation:{installation_id}:{}", repo_name.trim().to_lowercase())
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
