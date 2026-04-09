use std::{
  env,
  fs,
  path::{Path, PathBuf},
  process::Command,
};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use uuid::Uuid;

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

use crate::{
  broker::broker_get_json_with_session,
  github::github_client,
  storage_paths::local_glossary_repo_root,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitTransportTokenResponse {
  token: String,
}

struct GitTransportAuth {
  askpass_path: PathBuf,
  username: String,
  password: String,
}

impl GitTransportAuth {
  fn from_token(token: &str) -> Result<Self, String> {
    Ok(Self {
      askpass_path: write_git_askpass_script()?,
      username: "x-access-token".to_string(),
      password: token.to_string(),
    })
  }
}

impl Drop for GitTransportAuth {
  fn drop(&mut self) {
    let _ = fs::remove_file(&self.askpass_path);
  }
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GlossaryRepoSyncDescriptor {
  pub(crate) repo_name: String,
  pub(crate) full_name: String,
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
    return Ok(read_current_head_oid(repo_path));
  }

  if let Err(error) = git_output(
    repo_path,
    &["pull", "--rebase", "origin", branch_name],
    Some(&git_transport_auth),
  ) {
    return Err(abort_rebase_after_failed_pull(repo_path, error));
  }
  git_output(repo_path, &["push", "origin", branch_name], Some(&git_transport_auth))?;
  Ok(read_current_head_oid(repo_path))
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

  Ok(read_current_head_oid(repo_path))
}

fn read_current_head_oid(repo_path: &Path) -> Option<String> {
  git_output(repo_path, &["rev-parse", "--verify", "HEAD"], None)
    .ok()
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty())
}

fn git_output(repo_path: &Path, args: &[&str], auth: Option<&GitTransportAuth>) -> Result<String, String> {
  let mut command = Command::new("git");
  if let Some(auth) = auth {
    command
      .env("GIT_ASKPASS", &auth.askpass_path)
      .env("GIT_TERMINAL_PROMPT", "0")
      .env("GTMS_GIT_USERNAME", &auth.username)
      .env("GTMS_GIT_PASSWORD", &auth.password);
  }

  let output = command
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

fn load_git_transport_token(installation_id: i64, session_token: &str) -> Result<String, String> {
  let client = github_client()?;
  let response: GitTransportTokenResponse = broker_get_json_with_session(
    &client,
    &format!("/api/github-app/installations/{installation_id}/git-transport-token"),
    session_token,
  )?;
  Ok(response.token)
}

fn abort_rebase_after_failed_pull(repo_path: &Path, pull_error: String) -> String {
  if !repo_has_rebase_in_progress(repo_path) {
    return pull_error;
  }

  match git_output(repo_path, &["rebase", "--abort"], None) {
    Ok(_) => format!("{pull_error} The interrupted rebase was aborted automatically."),
    Err(abort_error) => format!(
      "{pull_error} An automatic 'git rebase --abort' also failed: {abort_error}"
    ),
  }
}

fn write_git_askpass_script() -> Result<PathBuf, String> {
  let extension = if cfg!(windows) { "cmd" } else { "sh" };
  let script_path =
    env::temp_dir().join(format!("gnosis-tms-glossary-git-askpass-{}.{}", Uuid::now_v7(), extension));
  let script_contents = if cfg!(windows) {
    "@echo off\r\nset PROMPT=%~1\r\necho %PROMPT% | findstr /I \"Username\" >nul\r\nif not errorlevel 1 (\r\n  <nul set /p =%GTMS_GIT_USERNAME%\r\n) else (\r\n  <nul set /p =%GTMS_GIT_PASSWORD%\r\n)\r\n"
  } else {
    "#!/bin/sh\ncase \"$1\" in\n  *Username*) printf '%s' \"$GTMS_GIT_USERNAME\" ;;\n  *) printf '%s' \"$GTMS_GIT_PASSWORD\" ;;\nesac\n"
  };

  fs::write(&script_path, script_contents).map_err(|error| {
    format!(
      "Could not create the temporary glossary git credential helper '{}': {error}",
      script_path.display()
    )
  })?;

  #[cfg(unix)]
  {
    let mut permissions = fs::metadata(&script_path)
      .map_err(|error| format!("Could not inspect '{}': {error}", script_path.display()))?
      .permissions();
    permissions.set_mode(0o700);
    fs::set_permissions(&script_path, permissions)
      .map_err(|error| format!("Could not mark '{}' executable: {error}", script_path.display()))?;
  }

  Ok(script_path)
}

fn repo_has_rebase_in_progress(repo_path: &Path) -> bool {
  let rebase_apply = git_output(repo_path, &["rev-parse", "--git-path", "rebase-apply"], None);
  let rebase_merge = git_output(repo_path, &["rev-parse", "--git-path", "rebase-merge"], None);

  rebase_apply
    .ok()
    .map(|path| resolve_git_path(repo_path, &path).exists())
    .unwrap_or(false)
    || rebase_merge
      .ok()
      .map(|path| resolve_git_path(repo_path, &path).exists())
      .unwrap_or(false)
}

fn resolve_git_path(repo_path: &Path, git_path: &str) -> PathBuf {
  let path = PathBuf::from(git_path);
  if path.is_absolute() {
    path
  } else {
    repo_path.join(path)
  }
}
