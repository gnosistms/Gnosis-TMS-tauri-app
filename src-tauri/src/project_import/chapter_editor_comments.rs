use std::fs;

use serde::{Deserialize, Serialize};
use serde_json::{Number, Value};
use tauri::AppHandle;

use crate::broker_auth_storage::load_broker_auth_session;
use crate::git_commit::{
    git_commit_as_signed_in_user_with_metadata, GitCommitMetadata as CommitMetadata,
};
use crate::project_repo_paths::resolve_project_git_repo_path;

use super::project_git::{
    ensure_repo_exists, ensure_valid_git_repo, find_chapter_path_by_id, git_output, read_json_file,
    repo_relative_path, write_text_file,
};

fn current_repo_head_sha(repo_path: &std::path::Path) -> Option<String> {
    git_output(repo_path, &["rev-parse", "--verify", "HEAD"]).ok()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoadEditorRowCommentsInput {
    installation_id: i64,
    repo_name: String,
    project_id: Option<String>,
    chapter_id: String,
    row_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveEditorRowCommentInput {
    installation_id: i64,
    repo_name: String,
    project_id: Option<String>,
    chapter_id: String,
    row_id: String,
    body: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeleteEditorRowCommentInput {
    installation_id: i64,
    repo_name: String,
    project_id: Option<String>,
    chapter_id: String,
    row_id: String,
    comment_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoadEditorRowCommentsResponse {
    row_id: String,
    comments_revision: u64,
    comment_count: usize,
    comments: Vec<EditorRowComment>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveEditorRowCommentResponse {
    row_id: String,
    comments_revision: u64,
    comment_count: usize,
    comments: Vec<EditorRowComment>,
    chapter_base_commit_sha: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeleteEditorRowCommentResponse {
    row_id: String,
    comments_revision: u64,
    comment_count: usize,
    comments: Vec<EditorRowComment>,
    chapter_base_commit_sha: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EditorRowComment {
    comment_id: String,
    author_login: String,
    author_name: String,
    body: String,
    created_at: String,
}

#[derive(Clone, Deserialize, Serialize)]
pub(super) struct StoredEditorComment {
    comment_id: String,
    author_login: String,
    author_name: String,
    body: String,
    created_at: String,
}

#[derive(Deserialize)]
struct StoredEditorCommentsRowFile {
    #[serde(default)]
    editor_comments_revision: u64,
    #[serde(default)]
    editor_comments: Vec<StoredEditorComment>,
}

pub(super) fn load_gtms_editor_row_comments_sync(
    app: &AppHandle,
    input: LoadEditorRowCommentsInput,
) -> Result<LoadEditorRowCommentsResponse, String> {
    let repo_path = resolve_project_git_repo_path(
        app,
        input.installation_id,
        input.project_id.as_deref(),
        Some(&input.repo_name),
    )?;
    ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
    ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;

    let row_json_path = resolve_row_json_path(&repo_path, &input.chapter_id, &input.row_id)?;
    let row_file: StoredEditorCommentsRowFile = read_json_file(&row_json_path, "row file")?;

    Ok(build_load_editor_row_comments_response(
        input.row_id,
        row_file.editor_comments_revision,
        row_file.editor_comments,
    ))
}

pub(super) fn save_gtms_editor_row_comment_sync(
    app: &AppHandle,
    input: SaveEditorRowCommentInput,
) -> Result<SaveEditorRowCommentResponse, String> {
    let repo_path = resolve_project_git_repo_path(
        app,
        input.installation_id,
        input.project_id.as_deref(),
        Some(&input.repo_name),
    )?;
    ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
    ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;

    let body = input.body.trim().to_string();
    if body.is_empty() {
        return Err("Enter a comment before saving.".to_string());
    }

    let row_json_path = resolve_row_json_path(&repo_path, &input.chapter_id, &input.row_id)?;
    let original_row_text = fs::read_to_string(&row_json_path).map_err(|error| {
        format!(
            "Could not read row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    let mut row_value: Value = serde_json::from_str(&original_row_text).map_err(|error| {
        format!(
            "Could not parse row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    let author = signed_in_editor_comment_author(app)?;
    let comment = StoredEditorComment {
        comment_id: uuid::Uuid::now_v7().to_string(),
        author_login: author.login,
        author_name: author.name,
        body,
        created_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
    };
    let comments_revision = append_editor_comment(&mut row_value, &comment)?;
    let updated_row_file: StoredEditorCommentsRowFile = serde_json::from_value(row_value.clone())
        .map_err(|error| {
        format!(
            "Could not decode updated row '{}': {error}",
            row_json_path.display()
        )
    })?;
    let updated_row_json = serde_json::to_string_pretty(&row_value).map_err(|error| {
        format!(
            "Could not serialize row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    write_text_file(&row_json_path, &format!("{updated_row_json}\n"))?;

    let relative_row_json = repo_relative_path(&repo_path, &row_json_path)?;
    git_output(&repo_path, &["add", &relative_row_json])?;
    git_commit_as_signed_in_user_with_metadata(
        app,
        &repo_path,
        &format!("Add comment to row {}", input.row_id),
        &[&relative_row_json],
        CommitMetadata {
            operation: Some("editor-comment"),
            status_note: None,
            ai_model: None,
        },
    )?;

    Ok(SaveEditorRowCommentResponse {
        row_id: input.row_id,
        comments_revision,
        comment_count: updated_row_file.editor_comments.len(),
        comments: sort_editor_row_comments(updated_row_file.editor_comments),
        chapter_base_commit_sha: current_repo_head_sha(&repo_path),
    })
}

pub(super) fn delete_gtms_editor_row_comment_sync(
    app: &AppHandle,
    input: DeleteEditorRowCommentInput,
) -> Result<DeleteEditorRowCommentResponse, String> {
    let repo_path = resolve_project_git_repo_path(
        app,
        input.installation_id,
        input.project_id.as_deref(),
        Some(&input.repo_name),
    )?;
    ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
    ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;

    let comment_id = input.comment_id.trim().to_string();
    if comment_id.is_empty() {
        return Err("Could not determine which comment to delete.".to_string());
    }

    let row_json_path = resolve_row_json_path(&repo_path, &input.chapter_id, &input.row_id)?;
    let original_row_text = fs::read_to_string(&row_json_path).map_err(|error| {
        format!(
            "Could not read row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    let mut row_value: Value = serde_json::from_str(&original_row_text).map_err(|error| {
        format!(
            "Could not parse row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    let author = signed_in_editor_comment_author(app)?;
    let comments_revision = delete_editor_comment(&mut row_value, &comment_id, &author.login)?;
    let updated_row_file: StoredEditorCommentsRowFile = serde_json::from_value(row_value.clone())
        .map_err(|error| {
        format!(
            "Could not decode updated row '{}': {error}",
            row_json_path.display()
        )
    })?;
    let updated_row_json = serde_json::to_string_pretty(&row_value).map_err(|error| {
        format!(
            "Could not serialize row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    write_text_file(&row_json_path, &format!("{updated_row_json}\n"))?;

    let relative_row_json = repo_relative_path(&repo_path, &row_json_path)?;
    git_output(&repo_path, &["add", &relative_row_json])?;
    git_commit_as_signed_in_user_with_metadata(
        app,
        &repo_path,
        &format!("Delete comment from row {}", input.row_id),
        &[&relative_row_json],
        CommitMetadata {
            operation: Some("editor-comment"),
            status_note: None,
            ai_model: None,
        },
    )?;

    Ok(DeleteEditorRowCommentResponse {
        row_id: input.row_id,
        comments_revision,
        comment_count: updated_row_file.editor_comments.len(),
        comments: sort_editor_row_comments(updated_row_file.editor_comments),
        chapter_base_commit_sha: current_repo_head_sha(&repo_path),
    })
}

fn resolve_row_json_path(
    repo_path: &std::path::Path,
    chapter_id: &str,
    row_id: &str,
) -> Result<std::path::PathBuf, String> {
    let chapter_path = find_chapter_path_by_id(&repo_path.join("chapters"), chapter_id)?;
    Ok(chapter_path.join("rows").join(format!("{row_id}.json")))
}

fn build_load_editor_row_comments_response(
    row_id: String,
    comments_revision: u64,
    comments: Vec<StoredEditorComment>,
) -> LoadEditorRowCommentsResponse {
    let comment_count = comments.len();
    LoadEditorRowCommentsResponse {
        row_id,
        comments_revision,
        comment_count,
        comments: sort_editor_row_comments(comments),
    }
}

fn sort_editor_row_comments(comments: Vec<StoredEditorComment>) -> Vec<EditorRowComment> {
    let mut comments = comments
        .into_iter()
        .map(|comment| EditorRowComment {
            comment_id: comment.comment_id,
            author_login: comment.author_login,
            author_name: comment.author_name,
            body: comment.body,
            created_at: comment.created_at,
        })
        .collect::<Vec<_>>();
    comments.sort_by(|left, right| {
        right
            .created_at
            .cmp(&left.created_at)
            .then_with(|| right.comment_id.cmp(&left.comment_id))
    });
    comments
}

struct SignedInEditorCommentAuthor {
    login: String,
    name: String,
}

fn signed_in_editor_comment_author(app: &AppHandle) -> Result<SignedInEditorCommentAuthor, String> {
    let session = load_broker_auth_session(app.clone())?
        .ok_or_else(|| "Sign in with GitHub before saving comments.".to_string())?;
    let login = session.login.trim().to_lowercase();
    if login.is_empty() {
        return Err("The saved GitHub session is missing a login.".to_string());
    }
    let name = session
        .name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(login.as_str())
        .to_string();

    Ok(SignedInEditorCommentAuthor { login, name })
}

fn ensure_editor_comments_defaults(
    row_object: &mut serde_json::Map<String, Value>,
) -> Result<(), String> {
    let revision_value = row_object
        .entry("editor_comments_revision".to_string())
        .or_insert_with(|| Value::Number(Number::from(0u64)));
    if !revision_value.is_u64() {
        return Err("The row comment revision is not a number.".to_string());
    }

    let comments_value = row_object
        .entry("editor_comments".to_string())
        .or_insert_with(|| Value::Array(Vec::new()));
    if !comments_value.is_array() {
        return Err("The row comments are not an array.".to_string());
    }

    Ok(())
}

fn append_editor_comment(
    row_value: &mut Value,
    comment: &StoredEditorComment,
) -> Result<u64, String> {
    let row_object = row_value
        .as_object_mut()
        .ok_or_else(|| "The row file is not a JSON object.".to_string())?;
    ensure_editor_comments_defaults(row_object)?;
    let current_revision = row_object
        .get("editor_comments_revision")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let next_revision = current_revision.saturating_add(1);
    let comments = row_object
        .get_mut("editor_comments")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| "The row comments are not an array.".to_string())?;
    comments.push(
        serde_json::to_value(comment)
            .map_err(|error| format!("Could not encode the row comment: {error}"))?,
    );
    row_object.insert(
        "editor_comments_revision".to_string(),
        Value::Number(Number::from(next_revision)),
    );
    Ok(next_revision)
}

fn delete_editor_comment(
    row_value: &mut Value,
    comment_id: &str,
    author_login: &str,
) -> Result<u64, String> {
    let row_object = row_value
        .as_object_mut()
        .ok_or_else(|| "The row file is not a JSON object.".to_string())?;
    ensure_editor_comments_defaults(row_object)?;
    let comments = row_object
        .get_mut("editor_comments")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| "The row comments are not an array.".to_string())?;
    let Some(index) = comments.iter().position(|candidate| {
        serde_json::from_value::<StoredEditorComment>(candidate.clone())
            .ok()
            .map(|comment| comment.comment_id == comment_id)
            .unwrap_or(false)
    }) else {
        return Err("Could not find that comment on this row.".to_string());
    };

    let stored_comment: StoredEditorComment = serde_json::from_value(comments[index].clone())
        .map_err(|error| format!("Could not parse the existing row comment: {error}"))?;
    if stored_comment.author_login.trim().to_lowercase() != author_login.trim().to_lowercase() {
        return Err("Only the comment author can delete this comment.".to_string());
    }

    comments.remove(index);
    let current_revision = row_object
        .get("editor_comments_revision")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let next_revision = current_revision.saturating_add(1);
    row_object.insert(
        "editor_comments_revision".to_string(),
        Value::Number(Number::from(next_revision)),
    );
    Ok(next_revision)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        append_editor_comment, delete_editor_comment, StoredEditorComment,
        StoredEditorCommentsRowFile,
    };

    #[test]
    fn stored_editor_comments_row_file_defaults_missing_comment_fields() {
        let row: StoredEditorCommentsRowFile = serde_json::from_value(json!({
          "row_id": "row-1",
          "fields": {
            "es": {
              "plain_text": "uno"
            }
          }
        }))
        .expect("row should deserialize");

        assert_eq!(row.editor_comments_revision, 0);
        assert!(row.editor_comments.is_empty());
    }

    #[test]
    fn append_editor_comment_appends_and_increments_revision() {
        let mut row_value = json!({
          "editor_comments_revision": 0,
          "editor_comments": []
        });
        let comment = StoredEditorComment {
            comment_id: "comment-1".to_string(),
            author_login: "octocat".to_string(),
            author_name: "The Octocat".to_string(),
            body: "Check this".to_string(),
            created_at: "2026-04-13T09:12:33Z".to_string(),
        };

        let next_revision =
            append_editor_comment(&mut row_value, &comment).expect("comment append should succeed");

        assert_eq!(next_revision, 1);
        assert_eq!(row_value["editor_comments_revision"], json!(1));
        assert_eq!(
            row_value["editor_comments"].as_array().map(Vec::len),
            Some(1)
        );
    }

    #[test]
    fn delete_editor_comment_removes_comment_and_increments_revision() {
        let mut row_value = json!({
          "editor_comments_revision": 1,
          "editor_comments": [
            {
              "comment_id": "comment-1",
              "author_login": "octocat",
              "author_name": "The Octocat",
              "body": "Check this",
              "created_at": "2026-04-13T09:12:33Z"
            }
          ]
        });

        let next_revision = delete_editor_comment(&mut row_value, "comment-1", "octocat")
            .expect("comment delete should succeed");

        assert_eq!(next_revision, 2);
        assert_eq!(row_value["editor_comments_revision"], json!(2));
        assert_eq!(row_value["editor_comments"], json!([]));
    }

    #[test]
    fn delete_editor_comment_rejects_non_author_attempts() {
        let mut row_value = json!({
          "editor_comments_revision": 1,
          "editor_comments": [
            {
              "comment_id": "comment-1",
              "author_login": "octocat",
              "author_name": "The Octocat",
              "body": "Check this",
              "created_at": "2026-04-13T09:12:33Z"
            }
          ]
        });

        let error = delete_editor_comment(&mut row_value, "comment-1", "hubot")
            .expect_err("delete should reject non-authors");

        assert_eq!(error, "Only the comment author can delete this comment.");
    }
}
