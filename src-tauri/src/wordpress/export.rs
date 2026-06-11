use std::path::{Path, PathBuf};
use std::time::Duration;

use reqwest::blocking::Client;
use tauri::{AppHandle, Emitter};

use crate::{
    constants::WORDPRESS_EXPORT_PROGRESS_EVENT,
    project_repo_paths::resolve_project_git_repo_path,
    wordpress::client::{WordPressSite, WORDPRESS_RECONNECT_MESSAGE},
    wordpress::debug::wordpress_debug_log,
    wordpress::storage::{
        clear_wordpress_connection, load_wordpress_connection, WordPressConnection,
        WordPressConnectionInfo,
    },
};

// Cap uploaded-image reads so a corrupt or oversized repo file cannot buffer an
// unbounded body into memory during export (matches the chapter export cap).
const MAX_WORDPRESS_IMAGE_BYTES: u64 = 25 * 1024 * 1024;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WordPressFootnoteInput {
    id: String,
    content: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WordPressExportInput {
    installation_id: i64,
    repo_name: String,
    project_id: Option<String>,
    job_id: String,
    mode: String,
    post_id: Option<u64>,
    title: String,
    content: String,
    #[serde(default)]
    footnotes: Vec<WordPressFootnoteInput>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WordPressExportProgressPayload {
    job_id: String,
    status: &'static str,
    message: String,
    current: Option<usize>,
    total: Option<usize>,
    post_link: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WordPressPostSummary {
    id: u64,
    title: String,
    status: String,
    link: String,
    modified: String,
}

#[tauri::command]
pub(crate) async fn get_wordpress_connection(
    app: AppHandle,
) -> Result<Option<WordPressConnectionInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok(load_wordpress_connection(&app)?.map(|connection| connection.info()))
    })
    .await
    .map_err(|error| format!("Could not read the WordPress connection: {error}"))?
}

#[tauri::command]
pub(crate) async fn disconnect_wordpress(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || clear_wordpress_connection(&app))
        .await
        .map_err(|error| format!("Could not clear the WordPress connection: {error}"))?
}

#[tauri::command]
pub(crate) async fn search_wordpress_posts(
    app: AppHandle,
    search: String,
) -> Result<Vec<WordPressPostSummary>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let connection = require_wordpress_connection(&app)?;
        let site = WordPressSite::wordpress_com(&connection)?;
        let client = wordpress_http_client()?;

        let mut path = String::from(
            "posts?per_page=20&context=edit&status=publish,future,draft,pending,private\
             &_fields=id,title,status,link,modified&orderby=modified&order=desc",
        );
        let trimmed = search.trim();
        if !trimmed.is_empty() {
            path.push_str("&search=");
            path.push_str(
                &url::form_urlencoded::byte_serialize(trimmed.as_bytes()).collect::<String>(),
            );
        }

        let response = site.get_json(&client, &path)?;
        let posts = response
            .as_array()
            .ok_or_else(|| "Could not parse the WordPress post list.".to_string())?;
        Ok(posts.iter().map(post_summary_from_json).collect())
    })
    .await
    .map_err(|error| format!("Could not run the WordPress post search: {error}"))?
}

/// Validates input, then runs the export in a background task. The IPC call
/// returns immediately; all progress and the final outcome are delivered via
/// `wordpress-export-progress` events keyed by `jobId`.
#[tauri::command]
pub(crate) async fn export_chapter_to_wordpress(
    app: AppHandle,
    input: WordPressExportInput,
) -> Result<(), String> {
    if input.job_id.trim().is_empty() {
        return Err("The WordPress export is missing a job id.".to_string());
    }
    if !matches!(input.mode.as_str(), "create" | "overwrite") {
        return Err("Unsupported WordPress export mode.".to_string());
    }
    if input.mode == "overwrite" && input.post_id.is_none() {
        return Err("Choose the post to overwrite first.".to_string());
    }
    if input.mode == "create" && input.title.trim().is_empty() {
        return Err("Enter a title for the new post.".to_string());
    }
    if input.content.trim().is_empty() {
        return Err("There is nothing to export.".to_string());
    }

    tauri::async_runtime::spawn_blocking(move || {
        let job_id = input.job_id.clone();
        // catch_unwind so a panic in the export still produces a terminal
        // event — otherwise the UI would wait on "exporting" forever.
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            run_wordpress_export(&app, input)
        }))
        .unwrap_or_else(|panic| {
            let detail = panic
                .downcast_ref::<&str>()
                .map(|message| (*message).to_string())
                .or_else(|| panic.downcast_ref::<String>().cloned())
                .unwrap_or_default();
            wordpress_debug_log(&format!("export task panicked: {detail}"));
            Err("The WordPress export failed unexpectedly. Please try again.".to_string())
        });

        match outcome {
            Ok((message, post_link)) => {
                wordpress_debug_log(&format!("export succeeded: link={post_link}"));
                emit_export_progress(
                    &app,
                    WordPressExportProgressPayload {
                        job_id,
                        status: "success",
                        message,
                        current: None,
                        total: None,
                        post_link: Some(post_link),
                    },
                )
            }
            Err(error) => {
                wordpress_debug_log(&format!("export failed: {error}"));
                emit_export_progress(
                    &app,
                    WordPressExportProgressPayload {
                        job_id,
                        status: "error",
                        message: error,
                        current: None,
                        total: None,
                        post_link: None,
                    },
                )
            }
        }
    });

    Ok(())
}

fn run_wordpress_export(
    app: &AppHandle,
    input: WordPressExportInput,
) -> Result<(String, String), String> {
    let connection = require_wordpress_connection(app)?;
    let site = WordPressSite::wordpress_com(&connection)?;
    let client = wordpress_http_client()?;

    let local_sources = collect_local_image_sources(&input.content);
    wordpress_debug_log(&format!(
        "export start: mode={} post_id={:?} content_bytes={} footnotes={} local_images={}",
        input.mode,
        input.post_id,
        input.content.len(),
        input.footnotes.len(),
        local_sources.len(),
    ));
    let mut content = input.content.clone();

    if !local_sources.is_empty() {
        let repo_path = resolve_project_git_repo_path(
            app,
            input.installation_id,
            input.project_id.as_deref(),
            Some(&input.repo_name),
        )?;
        let total = local_sources.len();

        for (index, source) in local_sources.iter().enumerate() {
            emit_export_progress(
                app,
                WordPressExportProgressPayload {
                    job_id: input.job_id.clone(),
                    status: "progress",
                    message: format!("Uploading image {} of {total}...", index + 1),
                    current: Some(index + 1),
                    total: Some(total),
                    post_link: None,
                },
            );
            wordpress_debug_log(&format!(
                "uploading image {} of {total}: {source}",
                index + 1
            ));
            let uploaded_url = upload_repo_image(&site, &client, &repo_path, source)?;
            wordpress_debug_log(&format!("image uploaded: {source} -> {uploaded_url}"));
            content = replace_image_source(&content, source, &uploaded_url);
        }
    }

    emit_export_progress(
        app,
        WordPressExportProgressPayload {
            job_id: input.job_id.clone(),
            status: "progress",
            message: if input.mode == "create" {
                "Creating the draft post...".to_string()
            } else {
                "Overwriting the post...".to_string()
            },
            current: None,
            total: None,
            post_link: None,
        },
    );

    let footnotes_meta = footnotes_meta_json(&input.footnotes)?;
    let (path, body) = if input.mode == "create" {
        (
            "posts".to_string(),
            serde_json::json!({
                "title": input.title,
                "content": content,
                "status": "draft",
                "meta": { "footnotes": footnotes_meta },
            }),
        )
    } else {
        (
            // post_id is checked in the command before the job is spawned.
            format!("posts/{}", input.post_id.unwrap_or_default()),
            serde_json::json!({
                "content": content,
                "meta": { "footnotes": footnotes_meta },
            }),
        )
    };

    wordpress_debug_log(&format!("posting to {path}"));
    let response = site.post_json(&client, &path, &body)?;
    wordpress_debug_log("post request returned");
    let post_link = response
        .get("link")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_string();
    let message = if input.mode == "create" {
        "Created a new WordPress draft.".to_string()
    } else {
        "Overwrote the WordPress post.".to_string()
    };
    Ok((message, post_link))
}

fn require_wordpress_connection(app: &AppHandle) -> Result<WordPressConnection, String> {
    load_wordpress_connection(app)?.ok_or_else(|| WORDPRESS_RECONNECT_MESSAGE.to_string())
}

fn wordpress_http_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|error| format!("Could not create the WordPress HTTP client: {error}"))
}

fn emit_export_progress(app: &AppHandle, payload: WordPressExportProgressPayload) {
    let _ = app.emit(WORDPRESS_EXPORT_PROGRESS_EVENT, payload);
}

fn post_summary_from_json(value: &serde_json::Value) -> WordPressPostSummary {
    let title_value = value.get("title");
    let raw_title = title_value
        .and_then(|title| title.get("raw"))
        .and_then(|item| item.as_str())
        .map(str::to_string);
    let rendered_title = title_value
        .and_then(|title| title.get("rendered"))
        .and_then(|item| item.as_str())
        .map(decode_html_entities);
    let title = raw_title
        .or(rendered_title)
        .unwrap_or_default()
        .trim()
        .to_string();

    WordPressPostSummary {
        id: value.get("id").and_then(|item| item.as_u64()).unwrap_or(0),
        title: if title.is_empty() {
            "(no title)".to_string()
        } else {
            title
        },
        status: value
            .get("status")
            .and_then(|item| item.as_str())
            .unwrap_or_default()
            .to_string(),
        link: value
            .get("link")
            .and_then(|item| item.as_str())
            .unwrap_or_default()
            .to_string(),
        modified: value
            .get("modified")
            .and_then(|item| item.as_str())
            .unwrap_or_default()
            .to_string(),
    }
}

/// Collects unique `<img src>` values that are repo-relative upload paths (the
/// serializer emits the stored repo path for uploaded images, while pasted
/// images keep their absolute http(s) URL).
fn collect_local_image_sources(content: &str) -> Vec<String> {
    let mut sources = Vec::new();
    let mut cursor = 0;
    while let Some(offset) = content[cursor..].find("<img ") {
        let tag_start = cursor + offset;
        let Some(tag_length) = content[tag_start..].find('>') else {
            break;
        };
        let tag = &content[tag_start..tag_start + tag_length];
        cursor = tag_start + tag_length;

        let Some(source) = tag
            .find("src=\"")
            .map(|index| &tag[index + "src=\"".len()..])
            .and_then(|rest| rest.find('"').map(|end| &rest[..end]))
        else {
            continue;
        };
        if source.is_empty() || !is_local_image_source(source) {
            continue;
        }
        if !sources.iter().any(|existing| existing == source) {
            sources.push(source.to_string());
        }
    }
    sources
}

fn is_local_image_source(source: &str) -> bool {
    let lowered = source.trim().to_ascii_lowercase();
    !(lowered.starts_with("http://")
        || lowered.starts_with("https://")
        || lowered.starts_with("data:")
        || lowered.starts_with("//"))
}

fn replace_image_source(content: &str, source: &str, uploaded_url: &str) -> String {
    content.replace(
        &format!("src=\"{source}\""),
        &format!("src=\"{}\"", escape_html_attribute(uploaded_url)),
    )
}

fn upload_repo_image(
    site: &WordPressSite,
    client: &Client,
    repo_path: &Path,
    source: &str,
) -> Result<String, String> {
    let absolute_path = resolve_repo_image_path(repo_path, source)?;
    let metadata = std::fs::metadata(&absolute_path)
        .map_err(|_| format!("Could not find the uploaded image '{source}' in the project."))?;
    if metadata.len() > MAX_WORDPRESS_IMAGE_BYTES {
        return Err(format!("The image '{source}' is too large to upload."));
    }

    let bytes = std::fs::read(&absolute_path)
        .map_err(|error| format!("Could not read the uploaded image '{source}': {error}"))?;
    let file_name = absolute_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("image")
        .to_string();
    let mime_type = image_mime_type(&file_name, &bytes)
        .ok_or_else(|| format!("Could not determine the image type for '{source}'."))?;

    let response = site.upload_media(client, &file_name, mime_type, bytes)?;
    response
        .get("source_url")
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .ok_or_else(|| "WordPress did not return a URL for the uploaded image.".to_string())
}

/// Resolves a serializer-emitted repo-relative image path, rejecting anything
/// that would escape the project repo.
fn resolve_repo_image_path(repo_path: &Path, source: &str) -> Result<PathBuf, String> {
    let decoded = decode_html_entities(source);
    let relative = Path::new(decoded.trim());
    if relative.is_absolute()
        || relative
            .components()
            .any(|component| !matches!(component, std::path::Component::Normal(_)))
    {
        return Err(format!("The image path '{source}' is not a project file."));
    }

    let candidate = repo_path.join(relative);
    let canonical_repo = repo_path
        .canonicalize()
        .map_err(|_| "The local project repo is not available yet.".to_string())?;
    let canonical_candidate = candidate
        .canonicalize()
        .map_err(|_| format!("Could not find the uploaded image '{source}' in the project."))?;
    if !canonical_candidate.starts_with(&canonical_repo) {
        return Err(format!("The image path '{source}' is not a project file."));
    }
    Ok(canonical_candidate)
}

fn image_mime_type(file_name: &str, bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some("image/jpeg");
    }
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some("image/png");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some("image/gif");
    }
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some("image/webp");
    }

    let lowered = file_name.to_ascii_lowercase();
    if lowered.ends_with(".jpg") || lowered.ends_with(".jpeg") {
        return Some("image/jpeg");
    }
    if lowered.ends_with(".png") {
        return Some("image/png");
    }
    if lowered.ends_with(".gif") {
        return Some("image/gif");
    }
    if lowered.ends_with(".webp") {
        return Some("image/webp");
    }
    None
}

/// Builds the JSON string the core footnotes block stores in the `footnotes`
/// post meta: `[{"content":"…","id":"…"}]`. Always sent (as `[]` when the
/// chapter has no footnotes) so overwriting clears stale footnote meta.
fn footnotes_meta_json(footnotes: &[WordPressFootnoteInput]) -> Result<String, String> {
    let entries: Vec<serde_json::Value> = footnotes
        .iter()
        .filter(|footnote| !footnote.id.trim().is_empty())
        .map(|footnote| {
            serde_json::json!({
                "content": footnote.content,
                "id": footnote.id,
            })
        })
        .collect();
    serde_json::to_string(&entries)
        .map_err(|error| format!("Could not encode the footnotes for WordPress: {error}"))
}

fn decode_html_entities(value: &str) -> String {
    value
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

fn escape_html_attribute(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collect_local_image_sources_skips_remote_and_duplicate_sources() {
        let content = concat!(
            "<!-- wp:image -->\n",
            "<figure class=\"wp-block-image\"><img src=\"images/a b.png\" alt=\"\" /></figure>\n",
            "<!-- /wp:image -->\n",
            "<figure><img src=\"https://example.com/x.png\" alt=\"\" /></figure>\n",
            "<figure><img src=\"data:image/png;base64,xyz\" alt=\"\" /></figure>\n",
            "<figure><img src=\"images/a b.png\" alt=\"\" /></figure>\n",
            "<figure><img src=\"images/second.jpg\" alt=\"\" /></figure>",
        );
        assert_eq!(
            collect_local_image_sources(content),
            vec![
                "images/a b.png".to_string(),
                "images/second.jpg".to_string()
            ],
        );
    }

    #[test]
    fn replace_image_source_escapes_the_uploaded_url() {
        let content = "<img src=\"images/a.png\" alt=\"\" />";
        assert_eq!(
            replace_image_source(
                content,
                "images/a.png",
                "https://files.example/a.png?x=1&y=2"
            ),
            "<img src=\"https://files.example/a.png?x=1&amp;y=2\" alt=\"\" />",
        );
    }

    #[test]
    fn resolve_repo_image_path_rejects_escaping_paths() {
        let temp_dir = std::env::temp_dir().join(format!(
            "gnosis-tms-wordpress-export-{}",
            uuid::Uuid::now_v7()
        ));
        std::fs::create_dir_all(temp_dir.join("images")).unwrap();
        std::fs::write(temp_dir.join("images/a.png"), b"fake").unwrap();

        let resolved = resolve_repo_image_path(&temp_dir, "images/a.png").unwrap();
        assert!(resolved.ends_with("a.png"));

        assert!(resolve_repo_image_path(&temp_dir, "../outside.png").is_err());
        assert!(resolve_repo_image_path(&temp_dir, "/etc/passwd").is_err());

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn footnotes_meta_json_matches_the_core_footnotes_shape() {
        let footnotes = vec![
            WordPressFootnoteInput {
                id: "11111111-1111-7111-8111-111111111111".to_string(),
                content: "First <em>note</em>".to_string(),
            },
            WordPressFootnoteInput {
                id: "".to_string(),
                content: "Dropped: blank id".to_string(),
            },
        ];
        assert_eq!(
            footnotes_meta_json(&footnotes).unwrap(),
            "[{\"content\":\"First <em>note</em>\",\"id\":\"11111111-1111-7111-8111-111111111111\"}]",
        );
        assert_eq!(footnotes_meta_json(&[]).unwrap(), "[]");
    }

    #[test]
    fn image_mime_type_prefers_magic_bytes_over_extension() {
        assert_eq!(
            image_mime_type("photo.png", &[0xFF, 0xD8, 0xFF, 0xE0]),
            Some("image/jpeg"),
        );
        assert_eq!(
            image_mime_type("photo.webp", b"not-an-image"),
            Some("image/webp")
        );
        assert_eq!(image_mime_type("notes.txt", b"plain text"), None);
    }
}
