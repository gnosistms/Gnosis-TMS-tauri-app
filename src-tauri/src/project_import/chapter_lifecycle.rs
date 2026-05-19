use std::{fs, path::Path};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::git_commit::git_commit_as_signed_in_user;
use crate::project_repo_paths::resolve_project_git_repo_path;

use super::project_git::{
    ensure_repo_exists, ensure_valid_git_repo, find_chapter_path_by_id, git_output, read_json_file,
    repo_relative_path, write_json_pretty,
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClearDeletedChaptersInput {
    installation_id: i64,
    repo_name: String,
    project_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClearDeletedChaptersResponse {
    chapter_ids: Vec<String>,
}

#[derive(Debug, PartialEq, Eq)]
struct ClearDeletedChaptersChanges {
    chapter_ids: Vec<String>,
    relative_paths: Vec<String>,
}

fn chapter_lifecycle_state(chapter_value: &Value) -> &str {
    chapter_value
        .get("lifecycle")
        .and_then(Value::as_object)
        .and_then(|lifecycle| lifecycle.get("state"))
        .and_then(Value::as_str)
        .unwrap_or("active")
}

fn clear_deleted_chapters_in_repo(repo_path: &Path) -> Result<ClearDeletedChaptersChanges, String> {
    let chapters_root = repo_path.join("chapters");
    if !chapters_root.exists() {
        return Ok(ClearDeletedChaptersChanges {
            chapter_ids: Vec::new(),
            relative_paths: Vec::new(),
        });
    }

    let entries = fs::read_dir(&chapters_root).map_err(|error| {
        format!(
            "Could not read chapters folder '{}': {error}",
            chapters_root.display()
        )
    })?;
    let mut deleted_chapters = Vec::new();

    for entry in entries {
        let entry =
            entry.map_err(|error| format!("Could not read a chapter folder entry: {error}"))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let chapter_json_path = path.join("chapter.json");
        if !chapter_json_path.exists() {
            continue;
        }

        let chapter_value: Value = read_json_file(&chapter_json_path, "chapter.json")?;
        if chapter_lifecycle_state(&chapter_value) != "deleted" {
            continue;
        }

        let chapter_id = chapter_value
            .get("chapter_id")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(ToString::to_string)
            .or_else(|| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .filter(|value| !value.trim().is_empty())
                    .map(ToString::to_string)
            })
            .ok_or_else(|| {
                format!(
                    "Could not determine the chapter id for '{}'.",
                    chapter_json_path.display()
                )
            })?;
        let relative_path = repo_relative_path(repo_path, &path)?;
        deleted_chapters.push((relative_path, chapter_id, path));
    }

    deleted_chapters.sort_by(|left, right| left.0.cmp(&right.0));

    let mut chapter_ids = Vec::new();
    let mut relative_paths = Vec::new();
    for (relative_path, chapter_id, path) in deleted_chapters {
        git_output(repo_path, &["rm", "-r", &relative_path])?;
        if path.exists() {
            fs::remove_dir_all(&path).map_err(|error| {
                format!(
                    "Could not remove the deleted file from disk at '{}': {error}",
                    path.display()
                )
            })?;
        }
        chapter_ids.push(chapter_id);
        relative_paths.push(relative_path);
    }

    Ok(ClearDeletedChaptersChanges {
        chapter_ids,
        relative_paths,
    })
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
    git_commit_as_signed_in_user(app, &repo_path, commit_action, &[&relative_chapter_json])?;

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

    let chapter_path = match find_chapter_path_by_id(&repo_path.join("chapters"), &input.chapter_id)
    {
        Ok(path) => path,
        Err(error)
            if error
                == format!(
                    "Could not find chapter '{}' in the local project repo.",
                    input.chapter_id
                ) =>
        {
            return Ok(UpdateChapterLifecycleResponse {
                chapter_id: input.chapter_id,
                lifecycle_state: "deleted".to_string(),
            });
        }
        Err(error) => return Err(error),
    };
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

pub(super) fn clear_deleted_gtms_chapters_sync(
    app: &AppHandle,
    input: ClearDeletedChaptersInput,
) -> Result<ClearDeletedChaptersResponse, String> {
    let repo_path = resolve_project_git_repo_path(
        app,
        input.installation_id,
        input.project_id.as_deref(),
        Some(&input.repo_name),
    )?;
    ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
    ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;

    let changes = clear_deleted_chapters_in_repo(&repo_path)?;
    if !changes.relative_paths.is_empty() {
        let relative_paths = changes
            .relative_paths
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>();
        git_commit_as_signed_in_user(app, &repo_path, "Clear deleted files", &relative_paths)?;
    }

    Ok(ClearDeletedChaptersResponse {
        chapter_ids: changes.chapter_ids,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use uuid::Uuid;

    fn create_test_repo() -> Result<PathBuf, String> {
        let repo_path =
            std::env::temp_dir().join(format!("gnosis-tms-clear-deleted-{}", Uuid::now_v7()));
        fs::create_dir_all(&repo_path)
            .map_err(|error| format!("Could not create test repo: {error}"))?;
        git_output(&repo_path, &["init"])?;
        git_output(&repo_path, &["config", "user.email", "test@example.com"])?;
        git_output(&repo_path, &["config", "user.name", "Test User"])?;
        Ok(repo_path)
    }

    fn write_chapter(
        repo_path: &Path,
        folder: &str,
        chapter_id: &str,
        state: &str,
    ) -> Result<(), String> {
        let chapter_path = repo_path.join("chapters").join(folder);
        fs::create_dir_all(&chapter_path)
            .map_err(|error| format!("Could not create test chapter: {error}"))?;
        let chapter_value = json!({
            "chapter_id": chapter_id,
            "title": chapter_id,
            "lifecycle": {
                "state": state,
            },
        });
        write_json_pretty(&chapter_path.join("chapter.json"), &chapter_value)
    }

    fn commit_all(repo_path: &Path, message: &str) -> Result<(), String> {
        git_output(repo_path, &["add", "."])?;
        git_output(repo_path, &["commit", "-m", message])?;
        Ok(())
    }

    fn commit_count(repo_path: &Path) -> Result<usize, String> {
        git_output(repo_path, &["rev-list", "--count", "HEAD"])?
            .parse::<usize>()
            .map_err(|error| format!("Could not parse commit count: {error}"))
    }

    #[test]
    fn clear_deleted_chapters_removes_only_deleted_chapters_and_stages_one_change_set(
    ) -> Result<(), String> {
        let repo_path = create_test_repo()?;
        write_chapter(&repo_path, "active", "active-chapter", "active")?;
        write_chapter(&repo_path, "deleted-one", "deleted-one", "deleted")?;
        write_chapter(&repo_path, "deleted-two", "deleted-two", "deleted")?;
        commit_all(&repo_path, "Initial project")?;
        let initial_commit_count = commit_count(&repo_path)?;

        let changes = clear_deleted_chapters_in_repo(&repo_path)?;
        assert_eq!(
            changes,
            ClearDeletedChaptersChanges {
                chapter_ids: vec!["deleted-one".to_string(), "deleted-two".to_string()],
                relative_paths: vec![
                    "chapters/deleted-one".to_string(),
                    "chapters/deleted-two".to_string(),
                ],
            }
        );
        assert!(repo_path.join("chapters/active/chapter.json").exists());
        assert!(!repo_path.join("chapters/deleted-one").exists());
        assert!(!repo_path.join("chapters/deleted-two").exists());

        git_output(&repo_path, &["commit", "-m", "Clear deleted files"])?;
        assert_eq!(commit_count(&repo_path)?, initial_commit_count + 1);
        let _ = fs::remove_dir_all(&repo_path);
        Ok(())
    }

    #[test]
    fn clear_deleted_chapters_does_not_stage_or_commit_when_none_are_deleted() -> Result<(), String>
    {
        let repo_path = create_test_repo()?;
        write_chapter(&repo_path, "active", "active-chapter", "active")?;
        commit_all(&repo_path, "Initial project")?;
        let initial_commit_count = commit_count(&repo_path)?;

        let changes = clear_deleted_chapters_in_repo(&repo_path)?;
        assert_eq!(
            changes,
            ClearDeletedChaptersChanges {
                chapter_ids: Vec::new(),
                relative_paths: Vec::new(),
            }
        );
        assert!(repo_path.join("chapters/active/chapter.json").exists());
        assert_eq!(git_output(&repo_path, &["status", "--porcelain"])?, "");
        assert_eq!(commit_count(&repo_path)?, initial_commit_count);
        let _ = fs::remove_dir_all(&repo_path);
        Ok(())
    }
}
