use std::{
  fs,
  path::Path,
};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::{
  local_repo_sync_state::{LocalRepoSyncStateUpdate, upsert_local_repo_sync_state},
  repo_sync_shared::{
    GitTransportAuth,
    abort_rebase_after_failed_pull,
    git_output,
    load_git_transport_token,
    read_current_head_oid,
  },
  storage_paths::local_glossary_repo_root,
};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GlossaryRepoSyncDescriptor {
  pub(crate) repo_name: String,
  pub(crate) full_name: String,
  pub(crate) repo_id: Option<i64>,
  pub(crate) default_branch_name: Option<String>,
  pub(crate) default_branch_head_oid: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GlossaryRepoSyncInput {
  pub(crate) installation_id: i64,
  pub(crate) glossaries: Vec<GlossaryRepoSyncDescriptor>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GlossaryRepoSyncSnapshot {
  pub(crate) repo_name: String,
  pub(crate) repo_path: String,
  pub(crate) local_head_oid: Option<String>,
  pub(crate) remote_head_oid: Option<String>,
  pub(crate) status: String,
  pub(crate) message: Option<String>,
}

const GLOSSARY_REPO_SYNC_STATUS_NOT_CLONED: &str = "notCloned";
const GLOSSARY_REPO_SYNC_STATUS_DIRTY_LOCAL: &str = "dirtyLocal";
const GLOSSARY_REPO_SYNC_STATUS_UP_TO_DATE: &str = "upToDate";
const GLOSSARY_REPO_SYNC_STATUS_OUT_OF_SYNC: &str = "outOfSync";
const GLOSSARY_REPO_SYNC_STATUS_SYNC_ERROR: &str = "syncError";

#[tauri::command]
pub(crate) async fn sync_gtms_glossary_repos(
  app: AppHandle,
  input: GlossaryRepoSyncInput,
  session_token: String,
) -> Result<Vec<GlossaryRepoSyncSnapshot>, String> {
  tauri::async_runtime::spawn_blocking(move || sync_gtms_glossary_repos_sync(&app, input, &session_token))
    .await
    .map_err(|error| format!("The glossary repo sync task failed: {error}"))?
}

fn sync_gtms_glossary_repos_sync(
  app: &AppHandle,
  input: GlossaryRepoSyncInput,
  session_token: &str,
) -> Result<Vec<GlossaryRepoSyncSnapshot>, String> {
  let repo_root = local_glossary_repo_root(app, input.installation_id)?;
  let needs_transport = input.glossaries.iter().any(|glossary| {
    let repo_path = repo_root.join(&glossary.repo_name);
    matches!(
      inspect_glossary_repo_state(glossary, &repo_path).status.as_str(),
      GLOSSARY_REPO_SYNC_STATUS_NOT_CLONED | GLOSSARY_REPO_SYNC_STATUS_OUT_OF_SYNC
    )
  });
  let git_transport_token = if needs_transport {
    Some(load_git_transport_token(input.installation_id, session_token)?)
  } else {
    None
  };

  let mut snapshots = Vec::with_capacity(input.glossaries.len());
  for glossary in input.glossaries {
    let repo_path = repo_root.join(&glossary.repo_name);
    let inspected = inspect_glossary_repo_state(&glossary, &repo_path);

    if matches!(
      inspected.status.as_str(),
      GLOSSARY_REPO_SYNC_STATUS_NOT_CLONED | GLOSSARY_REPO_SYNC_STATUS_OUT_OF_SYNC
    ) {
      let sync_result = sync_glossary_repo(
        &glossary,
        &repo_path,
        inspected.remote_head_oid.as_deref().unwrap_or_default(),
        git_transport_token.as_deref().unwrap_or_default(),
      );

      snapshots.push(match sync_result {
        Ok(local_head_oid) => GlossaryRepoSyncSnapshot {
          repo_name: glossary.repo_name.clone(),
          repo_path: repo_path.display().to_string(),
          local_head_oid: local_head_oid.clone(),
          remote_head_oid: local_head_oid,
          status: GLOSSARY_REPO_SYNC_STATUS_UP_TO_DATE.to_string(),
          message: None,
        },
        Err(error) => GlossaryRepoSyncSnapshot {
          message: Some(error),
          status: GLOSSARY_REPO_SYNC_STATUS_SYNC_ERROR.to_string(),
          ..inspect_glossary_repo_state(&glossary, &repo_path)
        },
      });
      continue;
    }

    snapshots.push(inspected);
  }

  Ok(snapshots)
}

fn inspect_glossary_repo_state(
  glossary: &GlossaryRepoSyncDescriptor,
  repo_path: &Path,
) -> GlossaryRepoSyncSnapshot {
  let default_snapshot = || GlossaryRepoSyncSnapshot {
    repo_name: glossary.repo_name.clone(),
    repo_path: repo_path.display().to_string(),
    local_head_oid: None,
    remote_head_oid: glossary.default_branch_head_oid.clone(),
    status: GLOSSARY_REPO_SYNC_STATUS_NOT_CLONED.to_string(),
    message: None,
  };

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
      return GlossaryRepoSyncSnapshot {
        status: GLOSSARY_REPO_SYNC_STATUS_SYNC_ERROR.to_string(),
        message: Some(error),
        local_head_oid,
        ..default_snapshot()
      };
    }
  };

  if dirty {
    return GlossaryRepoSyncSnapshot {
      local_head_oid,
      status: GLOSSARY_REPO_SYNC_STATUS_DIRTY_LOCAL.to_string(),
      message: Some("Local repo has uncommitted changes.".to_string()),
      ..default_snapshot()
    };
  }

  let remote_head_oid = glossary.default_branch_head_oid.clone();
  let status = if remote_head_oid
    .as_deref()
    .map(str::trim)
    .filter(|value| !value.is_empty())
    .is_none()
  {
    if local_head_oid.is_some() {
      GLOSSARY_REPO_SYNC_STATUS_OUT_OF_SYNC
    } else {
      GLOSSARY_REPO_SYNC_STATUS_UP_TO_DATE
    }
  } else if local_head_oid.as_deref() == remote_head_oid.as_deref() {
    GLOSSARY_REPO_SYNC_STATUS_UP_TO_DATE
  } else {
    GLOSSARY_REPO_SYNC_STATUS_OUT_OF_SYNC
  };

  GlossaryRepoSyncSnapshot {
    local_head_oid,
    remote_head_oid,
    status: status.to_string(),
    ..default_snapshot()
  }
}

fn sync_glossary_repo(
  glossary: &GlossaryRepoSyncDescriptor,
  repo_path: &Path,
  remote_head_oid: &str,
  git_transport_token: &str,
) -> Result<Option<String>, String> {
  if !repo_path.exists() {
    return clone_glossary_repo(glossary, repo_path, remote_head_oid, git_transport_token);
  }

  ensure_glossary_origin_remote(glossary, repo_path)?;

  let branch_name = glossary
    .default_branch_name
    .as_deref()
    .filter(|value| !value.trim().is_empty())
    .unwrap_or("main");
  let local_head_oid = read_current_head_oid(repo_path);
  let git_transport_auth = GitTransportAuth::from_token(git_transport_token)?;

  if remote_head_oid.trim().is_empty() {
    if local_head_oid.is_some() {
      git_output(repo_path, &["push", "-u", "origin", branch_name], Some(&git_transport_auth))?;
    }
    let current_head_oid = read_current_head_oid(repo_path);
    mark_glossary_repo_synced(glossary, repo_path)?;
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
  let current_head_oid = read_current_head_oid(repo_path);
  mark_glossary_repo_synced(glossary, repo_path)?;
  Ok(current_head_oid)
}

fn ensure_glossary_origin_remote(
  glossary: &GlossaryRepoSyncDescriptor,
  repo_path: &Path,
) -> Result<(), String> {
  let full_name = glossary.full_name.trim();
  if full_name.is_empty() {
    return Err("Could not determine the remote glossary repository.".to_string());
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

fn clone_glossary_repo(
  glossary: &GlossaryRepoSyncDescriptor,
  repo_path: &Path,
  remote_head_oid: &str,
  git_transport_token: &str,
) -> Result<Option<String>, String> {
  let repo_parent = repo_path
    .parent()
    .ok_or_else(|| "Could not resolve the local glossary repo folder.".to_string())?;
  fs::create_dir_all(repo_parent)
    .map_err(|error| format!("Could not create the local glossary repo folder: {error}"))?;

  let repo_url = format!("https://github.com/{}.git", glossary.full_name);
  let git_transport_auth = GitTransportAuth::from_token(git_transport_token)?;
  let mut clone_args = vec!["clone"];
  if !remote_head_oid.trim().is_empty() {
    if let Some(branch_name) = glossary
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
    let branch_name = glossary
      .default_branch_name
      .as_deref()
      .filter(|value| !value.trim().is_empty())
      .unwrap_or("main");
    let _ = git_output(repo_path, &["checkout", "-B", branch_name], None);
  }

  let current_head_oid = read_current_head_oid(repo_path);
  mark_glossary_repo_synced(glossary, repo_path)?;
  Ok(current_head_oid)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalGlossaryIdentityFile {
  glossary_id: String,
}

fn mark_glossary_repo_synced(
  glossary: &GlossaryRepoSyncDescriptor,
  repo_path: &Path,
) -> Result<(), String> {
  let glossary_id = fs::read(repo_path.join("glossary.json"))
    .ok()
    .and_then(|bytes| serde_json::from_slice::<LocalGlossaryIdentityFile>(&bytes).ok())
    .map(|file| file.glossary_id)
    .filter(|value| !value.trim().is_empty());

  upsert_local_repo_sync_state(
    repo_path,
    LocalRepoSyncStateUpdate {
      resource_id: glossary_id,
      kind: Some("glossary".to_string()),
      has_ever_synced: Some(true),
      last_known_github_repo_id: glossary.repo_id,
      last_known_full_name: Some(glossary.full_name.clone()),
      touch_success_timestamp: true,
    },
  )?;

  Ok(())
}
