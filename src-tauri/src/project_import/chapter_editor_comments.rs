use std::collections::BTreeMap;
use std::fs;

use serde::{Deserialize, Serialize};
use serde_json::{Number, Value};
use tauri::AppHandle;

use crate::broker_auth_storage::load_broker_auth_session_internal;
use crate::git_commit::GitCommitMetadata as CommitMetadata;
use crate::project_repo_paths::resolve_project_git_repo_path;

use super::chapter_editor::{
    validated_row_json_path, write_row_files_and_commit, PreparedRowFileWrite,
};
use super::project_git::{
    ensure_repo_exists, ensure_valid_git_repo, find_chapter_path_by_id, git_output, read_json_file,
    repo_relative_path,
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
    pub(crate) installation_id: i64,
    repo_name: String,
    project_id: Option<String>,
    chapter_id: String,
    row_id: String,
    body: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeleteEditorRowCommentInput {
    pub(crate) installation_id: i64,
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
    /// Deleting an AI Review clarity comment lets a repeat run check the row again.
    ai_clarity_fingerprints: BTreeMap<String, String>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    ai_review: Option<StoredAiReviewCommentMeta>,
}

/// Marks a comment written by AI Review. `content_fingerprint` identifies the
/// row content (computed by the frontend) the comment was written about, so a
/// repeat run can skip rows nobody has edited since.
#[derive(Clone, Deserialize, Serialize)]
struct StoredAiReviewCommentMeta {
    kind: String,
    language_code: String,
    content_fingerprint: String,
}

const AI_REVIEW_COMMENT_AUTHOR_NAME: &str = "AI Review";
const AI_REVIEW_CLARITY_COMMENT_KIND: &str = "clarity";

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

    let row_json_path = resolve_row_json_path(app, &repo_path, &input.chapter_id, &input.row_id)?;
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

    let row_json_path = resolve_row_json_path(app, &repo_path, &input.chapter_id, &input.row_id)?;
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
        ai_review: None,
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
    write_row_files_and_commit(
        app,
        &repo_path,
        &format!("Add comment to row {}", input.row_id),
        CommitMetadata {
            operation: Some("editor-comment"),
            migration: None,
            status_note: None,
            ai_model: None,
        },
        &[PreparedRowFileWrite {
            relative_path: repo_relative_path(&repo_path, &row_json_path)?,
            original_text: Some(original_row_text),
            updated_text: format!("{updated_row_json}\n"),
            path: row_json_path,
        }],
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

    let row_json_path = resolve_row_json_path(app, &repo_path, &input.chapter_id, &input.row_id)?;
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
    write_row_files_and_commit(
        app,
        &repo_path,
        &format!("Delete comment from row {}", input.row_id),
        CommitMetadata {
            operation: Some("editor-comment"),
            migration: None,
            status_note: None,
            ai_model: None,
        },
        &[PreparedRowFileWrite {
            relative_path: repo_relative_path(&repo_path, &row_json_path)?,
            original_text: Some(original_row_text),
            updated_text: format!("{updated_row_json}\n"),
            path: row_json_path,
        }],
    )?;

    Ok(DeleteEditorRowCommentResponse {
        row_id: input.row_id,
        comments_revision,
        comment_count: updated_row_file.editor_comments.len(),
        ai_clarity_fingerprints: ai_clarity_fingerprints(&updated_row_file.editor_comments),
        comments: sort_editor_row_comments(updated_row_file.editor_comments),
        chapter_base_commit_sha: current_repo_head_sha(&repo_path),
    })
}

fn resolve_row_json_path(
    app: &AppHandle,
    repo_path: &std::path::Path,
    chapter_id: &str,
    row_id: &str,
) -> Result<std::path::PathBuf, String> {
    let chapter_path = find_chapter_path_by_id(app, &repo_path.join("chapters"), chapter_id)?;
    validated_row_json_path(&chapter_path, row_id)
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
    let session = load_broker_auth_session_internal(app)?
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

/// The login AI Review comments are stored under: the person running the
/// review, so the author-only delete rule lets them remove the comment.
pub(super) fn ai_review_comment_author_login(app: &AppHandle) -> Result<String, String> {
    Ok(signed_in_editor_comment_author(app)?.login)
}

/// Appends an AI Review comment explaining why part of the row's
/// `language_code` content is hard to understand.
pub(super) fn append_ai_review_clarity_comment(
    row_value: &mut Value,
    author_login: &str,
    language_code: &str,
    body: &str,
    content_fingerprint: &str,
) -> Result<u64, String> {
    let comment = StoredEditorComment {
        comment_id: uuid::Uuid::now_v7().to_string(),
        author_login: author_login.to_string(),
        author_name: AI_REVIEW_COMMENT_AUTHOR_NAME.to_string(),
        body: body.trim().to_string(),
        created_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        ai_review: Some(StoredAiReviewCommentMeta {
            kind: AI_REVIEW_CLARITY_COMMENT_KIND.to_string(),
            language_code: language_code.to_string(),
            content_fingerprint: content_fingerprint.to_string(),
        }),
    };
    append_editor_comment(row_value, &comment)
}

/// Language code -> content fingerprint of the row's latest AI Review clarity
/// comment for that language.
pub(super) fn ai_clarity_fingerprints(
    comments: &[StoredEditorComment],
) -> BTreeMap<String, String> {
    comments
        .iter()
        .filter_map(|comment| comment.ai_review.as_ref())
        .filter(|meta| {
            meta.kind == AI_REVIEW_CLARITY_COMMENT_KIND && !meta.language_code.trim().is_empty()
        })
        .map(|meta| {
            (
                meta.language_code.trim().to_string(),
                meta.content_fingerprint.clone(),
            )
        })
        .collect()
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
        ai_clarity_fingerprints, append_ai_review_clarity_comment, append_editor_comment,
        delete_editor_comment, StoredEditorComment, StoredEditorCommentsRowFile,
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
            ai_review: None,
        };

        let next_revision =
            append_editor_comment(&mut row_value, &comment).expect("comment append should succeed");

        assert_eq!(next_revision, 1);
        assert_eq!(row_value["editor_comments_revision"], json!(1));
        assert_eq!(
            row_value["editor_comments"].as_array().map(Vec::len),
            Some(1)
        );
        // Human comments keep the stored shape they had before AI Review comments.
        assert!(row_value["editor_comments"][0].get("ai_review").is_none());
    }

    #[test]
    fn ai_review_clarity_comment_records_author_language_and_fingerprint() {
        let mut row_value = json!({
          "editor_comments_revision": 4,
          "editor_comments": [{
            "comment_id": "comment-1",
            "author_login": "octocat",
            "author_name": "The Octocat",
            "body": "Check this",
            "created_at": "2026-04-13T09:12:33Z"
          }]
        });

        let next_revision = append_ai_review_clarity_comment(
            &mut row_value,
            "translator",
            "vi",
            "  Cụm \"tâm ấy\" không rõ chỉ điều gì.  ",
            "fp-1",
        )
        .expect("AI comment append should succeed");

        assert_eq!(next_revision, 5);
        let stored = &row_value["editor_comments"][1];
        assert_eq!(stored["author_login"], json!("translator"));
        assert_eq!(stored["author_name"], json!("AI Review"));
        assert_eq!(
            stored["body"],
            json!("Cụm \"tâm ấy\" không rõ chỉ điều gì.")
        );
        assert_eq!(
            stored["ai_review"],
            json!({ "kind": "clarity", "language_code": "vi", "content_fingerprint": "fp-1" })
        );
    }

    #[test]
    fn ai_clarity_fingerprints_keep_the_latest_comment_per_language() {
        let row: StoredEditorCommentsRowFile = serde_json::from_value(json!({
          "editor_comments_revision": 4,
          "editor_comments": [
            {
              "comment_id": "c1", "author_login": "a", "author_name": "AI Review",
              "body": "old", "created_at": "2026-11-01T00:00:00Z",
              "ai_review": { "kind": "clarity", "language_code": "vi", "content_fingerprint": "old" }
            },
            {
              "comment_id": "c2", "author_login": "a", "author_name": "A",
              "body": "human", "created_at": "2026-11-01T00:00:01Z"
            },
            {
              "comment_id": "c3", "author_login": "a", "author_name": "AI Review",
              "body": "new", "created_at": "2026-11-01T00:00:02Z",
              "ai_review": { "kind": "clarity", "language_code": "vi", "content_fingerprint": "new" }
            },
            {
              "comment_id": "c4", "author_login": "a", "author_name": "AI Review",
              "body": "es", "created_at": "2026-11-01T00:00:03Z",
              "ai_review": { "kind": "clarity", "language_code": "es", "content_fingerprint": "es-fp" }
            },
            {
              "comment_id": "c5", "author_login": "a", "author_name": "AI Review",
              "body": "other kind", "created_at": "2026-11-01T00:00:04Z",
              "ai_review": { "kind": "other", "language_code": "de", "content_fingerprint": "x" }
            }
          ]
        }))
        .expect("row should deserialize");

        let fingerprints = ai_clarity_fingerprints(&row.editor_comments);

        assert_eq!(fingerprints.len(), 2);
        assert_eq!(fingerprints.get("vi").map(String::as_str), Some("new"));
        assert_eq!(fingerprints.get("es").map(String::as_str), Some("es-fp"));
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
