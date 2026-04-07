use std::{path::Path, process::Command};

use tauri::AppHandle;

use crate::broker_auth_storage::load_broker_auth_session;

struct SignedInGitAuthor {
  login: String,
  email: String,
}

fn signed_in_git_author(app: &AppHandle) -> Result<SignedInGitAuthor, String> {
  let session = load_broker_auth_session(app.clone())?
    .ok_or_else(|| "Sign in with GitHub before creating local commits.".to_string())?;
  let login = session.login.trim().to_lowercase();
  if login.is_empty() {
    return Err("The saved GitHub session is missing a login.".to_string());
  }

  Ok(SignedInGitAuthor {
    email: format!("{login}@users.noreply.github.com"),
    login,
  })
}

pub(crate) fn git_commit_as_signed_in_user(
  app: &AppHandle,
  repo_path: &Path,
  message: &str,
  paths: &[&str],
) -> Result<String, String> {
  let author = signed_in_git_author(app)?;
  let mut command = Command::new("git");
  command
    .arg("commit")
    .arg("-m")
    .arg(message)
    .current_dir(repo_path)
    .env("GIT_AUTHOR_NAME", &author.login)
    .env("GIT_AUTHOR_EMAIL", &author.email)
    .env("GIT_COMMITTER_NAME", &author.login)
    .env("GIT_COMMITTER_EMAIL", &author.email);

  if !paths.is_empty() {
    command.arg("--").args(paths);
  }

  let output = command
    .output()
    .map_err(|error| format!("Could not run git commit: {error}"))?;

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
    return Err(format!("git commit failed: {detail}"));
  }

  Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}
