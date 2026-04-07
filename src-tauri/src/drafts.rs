use std::{env, fs, path::PathBuf, process::Command};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::git_commit::git_commit_as_signed_in_user;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TeamSetupDraftInput {
  name: String,
  slug: String,
  contact_email: String,
  owner_login: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TeamSetupDraftResponse {
  draft_path: String,
  commit_sha: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TeamSetupDraftFile {
  format: &'static str,
  format_version: u32,
  team_name: String,
  github_org_slug: String,
  contact_email: String,
  owner_login: String,
  status: &'static str,
}

#[tauri::command]
pub(crate) fn create_team_setup_draft(
  app: AppHandle,
  input: TeamSetupDraftInput,
) -> Result<TeamSetupDraftResponse, String> {
  let repo_root = repository_root()?;
  let draft_dir = repo_root
    .join(".gnosis-tms")
    .join("team-setups")
    .join(&input.slug);
  fs::create_dir_all(&draft_dir)
    .map_err(|error| format!("Could not create the team setup folder: {error}"))?;

  let draft_path = draft_dir.join("team-setup.json");
  let draft = TeamSetupDraftFile {
    format: "gnosis-tms-team-setup",
    format_version: 1,
    team_name: input.name,
    github_org_slug: input.slug.clone(),
    contact_email: input.contact_email,
    owner_login: input.owner_login,
    status: "draft",
  };

  let json = serde_json::to_string_pretty(&draft)
    .map_err(|error| format!("Could not serialize the team setup draft: {error}"))?;
  fs::write(&draft_path, format!("{json}\n"))
    .map_err(|error| format!("Could not write the team setup draft: {error}"))?;

  let relative_path = draft_path
    .strip_prefix(&repo_root)
    .map_err(|error| format!("Could not stage the team setup draft: {error}"))?
    .to_string_lossy()
    .to_string();

  git_in_repo(&repo_root, &["add", relative_path.as_str()])?;
  git_commit_as_signed_in_user(
    &app,
    &repo_root,
    &format!("chore: save team setup draft for {}", input.slug),
    &[],
  )?;
  let commit_sha = git_output(&repo_root, &["rev-parse", "--short", "HEAD"])?;

  Ok(TeamSetupDraftResponse {
    draft_path: draft_path.display().to_string(),
    commit_sha,
  })
}

fn repository_root() -> Result<PathBuf, String> {
  PathBuf::from(env!("CARGO_MANIFEST_DIR"))
    .parent()
    .map(PathBuf::from)
    .ok_or_else(|| "Could not determine the Gnosis TMS repository root.".to_string())
}

fn git_in_repo(repo_root: &PathBuf, args: &[&str]) -> Result<(), String> {
  let output = Command::new("git")
    .args(args)
    .current_dir(repo_root)
    .output()
    .map_err(|error| format!("Could not run git: {error}"))?;

  if output.status.success() {
    return Ok(());
  }

  let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
  Err(if stderr.is_empty() {
    "Git command failed.".to_string()
  } else {
    stderr
  })
}

fn git_output(repo_root: &PathBuf, args: &[&str]) -> Result<String, String> {
  let output = Command::new("git")
    .args(args)
    .current_dir(repo_root)
    .output()
    .map_err(|error| format!("Could not run git: {error}"))?;

  if !output.status.success() {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    return Err(if stderr.is_empty() {
      "Git command failed.".to_string()
    } else {
      stderr
    });
  }

  Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}
