use std::{
  fs,
  path::{Path, PathBuf},
  process::Command,
  time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

const LOCAL_REPO_SYNC_STATE_FILE_NAME: &str = "gnosis-sync-state.json";

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalRepoSyncState {
  #[serde(default)]
  pub(crate) resource_id: Option<String>,
  #[serde(default)]
  pub(crate) kind: Option<String>,
  #[serde(default)]
  pub(crate) has_ever_synced: bool,
  #[serde(default)]
  pub(crate) last_known_github_repo_id: Option<i64>,
  #[serde(default)]
  pub(crate) last_known_full_name: Option<String>,
  #[serde(default)]
  pub(crate) last_successful_sync_at: Option<u64>,
}

#[derive(Default)]
pub(crate) struct LocalRepoSyncStateUpdate {
  pub(crate) resource_id: Option<String>,
  pub(crate) kind: Option<String>,
  pub(crate) has_ever_synced: Option<bool>,
  pub(crate) last_known_github_repo_id: Option<i64>,
  pub(crate) last_known_full_name: Option<String>,
  pub(crate) touch_success_timestamp: bool,
}

pub(crate) fn upsert_local_repo_sync_state(
  repo_path: &Path,
  update: LocalRepoSyncStateUpdate,
) -> Result<LocalRepoSyncState, String> {
  let state_path = local_repo_sync_state_path(repo_path)?;
  let mut state = if state_path.exists() {
    let bytes = fs::read(&state_path).map_err(|error| {
      format!(
        "Could not read local repo sync state '{}': {error}",
        state_path.display()
      )
    })?;
    serde_json::from_slice::<LocalRepoSyncState>(&bytes).map_err(|error| {
      format!(
        "Could not parse local repo sync state '{}': {error}",
        state_path.display()
      )
    })?
  } else {
    LocalRepoSyncState::default()
  };

  if let Some(resource_id) = update
    .resource_id
    .as_deref()
    .map(str::trim)
    .filter(|value| !value.is_empty())
  {
    state.resource_id = Some(resource_id.to_string());
  }

  if let Some(kind) = update
    .kind
    .as_deref()
    .map(str::trim)
    .filter(|value| !value.is_empty())
  {
    state.kind = Some(kind.to_string());
  }

  if let Some(has_ever_synced) = update.has_ever_synced {
    state.has_ever_synced = has_ever_synced;
  }

  if let Some(repo_id) = update.last_known_github_repo_id {
    state.last_known_github_repo_id = Some(repo_id);
  }

  if let Some(full_name) = update
    .last_known_full_name
    .as_deref()
    .map(str::trim)
    .filter(|value| !value.is_empty())
  {
    state.last_known_full_name = Some(full_name.to_string());
  }

  if update.touch_success_timestamp {
    state.last_successful_sync_at = current_unix_timestamp();
  }

  let bytes = serde_json::to_vec_pretty(&state)
    .map_err(|error| format!("Could not serialize local repo sync state: {error}"))?;
  fs::write(&state_path, bytes).map_err(|error| {
    format!(
      "Could not write local repo sync state '{}': {error}",
      state_path.display()
    )
  })?;

  Ok(state)
}

fn local_repo_sync_state_path(repo_path: &Path) -> Result<PathBuf, String> {
  Ok(resolve_git_dir(repo_path)?.join(LOCAL_REPO_SYNC_STATE_FILE_NAME))
}

fn resolve_git_dir(repo_path: &Path) -> Result<PathBuf, String> {
  let output = Command::new("git")
    .args(["rev-parse", "--git-dir"])
    .current_dir(repo_path)
    .output()
    .map_err(|error| {
      format!(
        "Could not inspect the git directory for '{}': {error}",
        repo_path.display()
      )
    })?;

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
    return Err(format!(
      "Could not resolve the git directory for '{}': {detail}",
      repo_path.display()
    ));
  }

  let git_dir = String::from_utf8_lossy(&output.stdout).trim().to_string();
  if git_dir.is_empty() {
    return Err(format!(
      "Could not resolve the git directory for '{}': git rev-parse returned an empty path.",
      repo_path.display()
    ));
  }

  let git_dir_path = PathBuf::from(git_dir);
  Ok(if git_dir_path.is_absolute() {
    git_dir_path
  } else {
    repo_path.join(git_dir_path)
  })
}

fn current_unix_timestamp() -> Option<u64> {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .ok()
    .map(|value| value.as_secs())
}
