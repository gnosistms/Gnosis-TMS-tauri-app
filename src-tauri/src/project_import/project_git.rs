use std::{
  fs,
  path::{Path, PathBuf},
  process::Command,
};

use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;

use crate::storage_paths::local_project_repo_root;

const GTMS_GITATTRIBUTES: &str = "*.json text eol=lf\nassets/** binary\n";

pub(super) fn local_repo_root(
  app: &AppHandle,
  installation_id: i64,
) -> Result<PathBuf, String> {
  local_project_repo_root(app, installation_id)
}

pub(super) fn ensure_repo_exists(repo_path: &Path, unavailable_message: &str) -> Result<(), String> {
  if !repo_path.exists() {
    return Err(unavailable_message.to_string());
  }

  Ok(())
}

pub(super) fn ensure_valid_git_repo(repo_path: &Path, invalid_message: &str) -> Result<(), String> {
  if git_output(repo_path, &["rev-parse", "--git-dir"]).is_err() {
    return Err(invalid_message.to_string());
  }

  Ok(())
}

pub(super) fn ensure_clean_git_repo(repo_path: &Path, dirty_message: &str) -> Result<(), String> {
  if !git_output(repo_path, &["status", "--porcelain"])?.trim().is_empty() {
    return Err(dirty_message.to_string());
  }

  Ok(())
}

pub(super) fn git_output(repo_path: &Path, args: &[&str]) -> Result<String, String> {
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

pub(super) fn read_json_file<T: DeserializeOwned>(path: &Path, label: &str) -> Result<T, String> {
  let text = fs::read_to_string(path)
    .map_err(|error| format!("Could not read {} '{}': {error}", label, path.display()))?;
  serde_json::from_str(&text)
    .map_err(|error| format!("Could not parse {} '{}': {error}", label, path.display()))
}

pub(super) fn write_json_pretty<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
  let json = serde_json::to_string_pretty(value)
    .map_err(|error| format!("Could not serialize '{}': {error}", path.display()))?;
  write_text_file(path, &format!("{json}\n"))
}

pub(super) fn write_text_file(path: &Path, contents: &str) -> Result<(), String> {
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent)
      .map_err(|error| format!("Could not create '{}': {error}", parent.display()))?;
  }

  fs::write(path, contents)
    .map_err(|error| format!("Could not write '{}': {error}", path.display()))
}

pub(super) fn ensure_gitattributes(path: &Path) -> Result<(), String> {
  if path.exists() {
    return Ok(());
  }

  write_text_file(path, GTMS_GITATTRIBUTES)
}

pub(super) fn repo_relative_path(repo_path: &Path, path: &Path) -> Result<String, String> {
  path
    .strip_prefix(repo_path)
    .map_err(|error| format!("Could not resolve the chapter path for git: {error}"))
    .map(|relative_path| relative_path.to_string_lossy().to_string())
}

pub(super) fn find_chapter_path_by_id(
  chapters_root: &Path,
  chapter_id: &str,
) -> Result<PathBuf, String> {
  let entries = fs::read_dir(chapters_root)
    .map_err(|error| format!("Could not read chapters folder '{}': {error}", chapters_root.display()))?;

  for entry in entries {
    let entry = entry.map_err(|error| format!("Could not read a chapter folder entry: {error}"))?;
    let path = entry.path();
    if !path.is_dir() {
      continue;
    }

    let chapter_json_path = path.join("chapter.json");
    if !chapter_json_path.exists() {
      continue;
    }

    let chapter_value: Value = read_json_file(&chapter_json_path, "chapter.json")?;
    if chapter_value.get("chapter_id").and_then(Value::as_str) == Some(chapter_id) {
      return Ok(path);
    }
  }

  Err(format!("Could not find chapter '{chapter_id}' in the local project repo."))
}
