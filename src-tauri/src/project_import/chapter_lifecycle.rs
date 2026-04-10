use std::fs;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::git_commit::git_commit_as_signed_in_user;
use crate::project_repo_paths::resolve_project_git_repo_path;

use super::project_git::{
  ensure_repo_exists,
  ensure_valid_git_repo,
  find_chapter_path_by_id,
  git_output,
  read_json_file,
  repo_relative_path,
  write_json_pretty,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RenameChapterInput {
  installation_id: i64,
  repo_name: String,
  project_id: Option<String>,
  chapter_id: String,
  title: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RenameChapterResponse {
  chapter_id: String,
  title: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateChapterLifecycleInput {
  installation_id: i64,
  repo_name: String,
  project_id: Option<String>,
  chapter_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateChapterLifecycleResponse {
  chapter_id: String,
  lifecycle_state: String,
}

pub(super) fn rename_gtms_chapter_sync(
  app: &AppHandle,
  input: RenameChapterInput,
) -> Result<RenameChapterResponse, String> {
  let next_title = input.title.trim();
  if next_title.is_empty() {
    return Err("Enter a file name.".to_string());
  }

  let repo_path = resolve_project_git_repo_path(
    app,
    input.installation_id,
    input.project_id.as_deref(),
    Some(&input.repo_name),
  )?;
  ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
  ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;

  let chapter_path = find_chapter_path_by_id(&repo_path.join("chapters"), &input.chapter_id)?;
  let chapter_json_path = chapter_path.join("chapter.json");
  let mut chapter_value: Value = read_json_file(&chapter_json_path, "chapter.json")?;
  let chapter_object = chapter_value
    .as_object_mut()
    .ok_or_else(|| "The chapter.json file is not a JSON object.".to_string())?;
  let current_title = chapter_object
    .get("title")
    .and_then(Value::as_str)
    .unwrap_or("")
    .trim()
    .to_string();

  if current_title == next_title {
    return Ok(RenameChapterResponse {
      chapter_id: input.chapter_id,
      title: next_title.to_string(),
    });
  }

  chapter_object.insert("title".to_string(), Value::String(next_title.to_string()));
  write_json_pretty(&chapter_json_path, &chapter_value)?;

  let relative_chapter_json = repo_relative_path(&repo_path, &chapter_json_path)?;
  git_output(&repo_path, &["add", &relative_chapter_json])?;
  git_commit_as_signed_in_user(
    app,
    &repo_path,
    &format!("Rename file to {}", next_title),
    &[&relative_chapter_json],
  )?;

  Ok(RenameChapterResponse {
    chapter_id: input.chapter_id,
    title: next_title.to_string(),
  })
}

pub(super) fn update_gtms_chapter_lifecycle_sync(
  app: &AppHandle,
  input: UpdateChapterLifecycleInput,
  next_state: &str,
) -> Result<UpdateChapterLifecycleResponse, String> {
  let repo_path = resolve_project_git_repo_path(
    app,
    input.installation_id,
    input.project_id.as_deref(),
    Some(&input.repo_name),
  )?;
  ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
  ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;

  let chapter_path = find_chapter_path_by_id(&repo_path.join("chapters"), &input.chapter_id)?;
  let chapter_json_path = chapter_path.join("chapter.json");

  let mut chapter_value: Value = read_json_file(&chapter_json_path, "chapter.json")?;
  let chapter_object = chapter_value
    .as_object_mut()
    .ok_or_else(|| "The chapter.json file is not a JSON object.".to_string())?;
  let lifecycle_value = chapter_object
    .entry("lifecycle".to_string())
    .or_insert_with(|| json!({ "state": "active" }));
  let lifecycle_object = lifecycle_value
    .as_object_mut()
    .ok_or_else(|| "The chapter lifecycle is not a JSON object.".to_string())?;
  let current_state = lifecycle_object
    .get("state")
    .and_then(Value::as_str)
    .unwrap_or("active")
    .to_string();

  if current_state == next_state {
    return Ok(UpdateChapterLifecycleResponse {
      chapter_id: input.chapter_id,
      lifecycle_state: next_state.to_string(),
    });
  }

  lifecycle_object.insert("state".to_string(), Value::String(next_state.to_string()));
  write_json_pretty(&chapter_json_path, &chapter_value)?;

  let relative_chapter_json = repo_relative_path(&repo_path, &chapter_json_path)?;
  git_output(&repo_path, &["add", &relative_chapter_json])?;
  let commit_action = if next_state == "deleted" {
    "Delete file"
  } else {
    "Restore file"
  };
  git_commit_as_signed_in_user(
    app,
    &repo_path,
    commit_action,
    &[&relative_chapter_json],
  )?;

  Ok(UpdateChapterLifecycleResponse {
    chapter_id: input.chapter_id,
    lifecycle_state: next_state.to_string(),
  })
}

pub(super) fn permanently_delete_gtms_chapter_sync(
  app: &AppHandle,
  input: UpdateChapterLifecycleInput,
) -> Result<UpdateChapterLifecycleResponse, String> {
  let repo_path = resolve_project_git_repo_path(
    app,
    input.installation_id,
    input.project_id.as_deref(),
    Some(&input.repo_name),
  )?;
  ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
  ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;

  let chapter_path = find_chapter_path_by_id(&repo_path.join("chapters"), &input.chapter_id)?;
  let chapter_json_path = chapter_path.join("chapter.json");
  let chapter_value: Value = read_json_file(&chapter_json_path, "chapter.json")?;
  let chapter_lifecycle_state = chapter_value
    .get("lifecycle")
    .and_then(Value::as_object)
    .and_then(|lifecycle| lifecycle.get("state"))
    .and_then(Value::as_str)
    .unwrap_or("active");

  if chapter_lifecycle_state != "deleted" {
    return Err("Only soft-deleted files can be permanently deleted.".to_string());
  }

  let relative_chapter_path = repo_relative_path(&repo_path, &chapter_path)?;
  git_output(&repo_path, &["rm", "-r", &relative_chapter_path])?;
  if chapter_path.exists() {
    fs::remove_dir_all(&chapter_path).map_err(|error| {
      format!(
        "Could not remove the deleted file from disk at '{}': {error}",
        chapter_path.display()
      )
    })?;
  }
  git_commit_as_signed_in_user(
    app,
    &repo_path,
    "Delete file permanently",
    &[&relative_chapter_path],
  )?;

  Ok(UpdateChapterLifecycleResponse {
    chapter_id: input.chapter_id,
    lifecycle_state: "deleted".to_string(),
  })
}
