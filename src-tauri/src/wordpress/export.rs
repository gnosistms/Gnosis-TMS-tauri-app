use std::path::{Path, PathBuf};
use std::time::Duration;

use reqwest::blocking::Client;
use tauri::{AppHandle, Emitter};

use crate::{
    constants::WORDPRESS_EXPORT_PROGRESS_EVENT,
    project_import::fetch_public_image_dimensions,
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

// Display-only cap so a full post image fits a typical screen without
// scrolling. Only the block's display size is set — the uploaded media file
// keeps its full resolution.
const MAX_WORDPRESS_IMAGE_DISPLAY_HEIGHT_PX: u64 = 600;

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

    let image_sources = collect_image_sources(&input.content);
    wordpress_debug_log(&format!(
        "export start: mode={} post_id={:?} content_bytes={} footnotes={} images={}",
        input.mode,
        input.post_id,
        input.content.len(),
        input.footnotes.len(),
        image_sources.len(),
    ));
    let mut content = input.content.clone();

    if !image_sources.is_empty() {
        let has_local_sources = image_sources
            .iter()
            .any(|source| is_local_image_source(source));
        let repo_path = if has_local_sources {
            Some(resolve_project_git_repo_path(
                app,
                input.installation_id,
                input.project_id.as_deref(),
                Some(&input.repo_name),
            )?)
        } else {
            None
        };
        let total = image_sources.len();

        for (index, source) in image_sources.iter().enumerate() {
            emit_export_progress(
                app,
                WordPressExportProgressPayload {
                    job_id: input.job_id.clone(),
                    status: "progress",
                    message: format!("Processing image {} of {total}...", index + 1),
                    current: Some(index + 1),
                    total: Some(total),
                    post_link: None,
                },
            );

            if let Some(repo_path) = repo_path.as_ref().filter(|_| is_local_image_source(source)) {
                wordpress_debug_log(&format!(
                    "uploading image {} of {total}: {source}",
                    index + 1
                ));
                let uploaded = upload_repo_image(&site, &client, repo_path, source)?;
                wordpress_debug_log(&format!(
                    "image uploaded: {source} -> {} natural={:?}x{:?}",
                    uploaded.source_url, uploaded.natural_width, uploaded.natural_height,
                ));
                content = apply_uploaded_image_to_content(&content, source, &uploaded);
                continue;
            }

            // Remote URL image: nothing to upload, but tall images still get a
            // display size. A failed fetch only skips the sizing.
            let dimensions = fetch_public_image_dimensions(&decode_html_entities(source));
            wordpress_debug_log(&format!("remote image {source} natural={dimensions:?}"));
            if let Some((natural_width, natural_height)) = dimensions {
                if let Some(display) =
                    wordpress_display_size(natural_width as u64, natural_height as u64)
                {
                    content = resize_image_block(&content, source, source, display);
                }
            }
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
        let mut body = serde_json::json!({
            "content": content,
            "meta": { "footnotes": footnotes_meta },
        });
        // Overwrite only touches the title when the chapter's leading H1
        // supplies one (the frontend sends it empty otherwise).
        if !input.title.trim().is_empty() {
            body["title"] = serde_json::Value::String(input.title.trim().to_string());
        }
        (
            // post_id is checked in the command before the job is spawned.
            format!("posts/{}", input.post_id.unwrap_or_default()),
            body,
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

/// Collects unique `<img src>` values from the serialized content. Local
/// (repo-relative) sources are uploaded; remote http(s) sources are only
/// measured for display sizing. `data:` URIs are left alone entirely.
fn collect_image_sources(content: &str) -> Vec<String> {
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
        let lowered = source.trim().to_ascii_lowercase();
        if source.is_empty() || lowered.starts_with("data:") || lowered.starts_with("//") {
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

struct UploadedWordPressImage {
    source_url: String,
    natural_width: Option<u64>,
    natural_height: Option<u64>,
}

/// Display size for an uploaded image: capped to
/// `MAX_WORDPRESS_IMAGE_DISPLAY_HEIGHT_PX` with the width derived from the
/// natural aspect ratio. `None` means the image already fits and the block
/// stays unsized.
fn wordpress_display_size(natural_width: u64, natural_height: u64) -> Option<(u64, u64)> {
    if natural_width == 0 || natural_height == 0 {
        return None;
    }
    if natural_height <= MAX_WORDPRESS_IMAGE_DISPLAY_HEIGHT_PX {
        return None;
    }
    let display_height = MAX_WORDPRESS_IMAGE_DISPLAY_HEIGHT_PX;
    let display_width = ((natural_width as f64) * (display_height as f64) / (natural_height as f64))
        .round()
        .max(1.0) as u64;
    Some((display_width, display_height))
}

/// Upgrades the plain serialized image block whose img has `source_attr` as
/// its src attribute to the same markup the block editor's resize handle
/// produces: display width/height in the block attrs and inline style. The
/// img src is rewritten to `new_src_attr` (both values in HTML-attribute
/// escaped form). Content is returned unchanged if the block markup is not
/// the expected shape.
fn resize_image_block(
    content: &str,
    source_attr: &str,
    new_src_attr: &str,
    (display_width, display_height): (u64, u64),
) -> String {
    let plain_block = format!(
        "<!-- wp:image -->\n<figure class=\"wp-block-image\"><img src=\"{source_attr}\" alt=\"\" />"
    );
    if !content.contains(&plain_block) {
        return content.to_string();
    }

    let resized_block = format!(
        "<!-- wp:image {{\"width\":\"{display_width}px\",\"height\":\"{display_height}px\"}} -->\n\
         <figure class=\"wp-block-image is-resized\"><img src=\"{new_src_attr}\" alt=\"\" style=\"width:{display_width}px;height:{display_height}px\" />"
    );
    content.replace(&plain_block, &resized_block)
}

/// Rewrites the serialized image block for `source` to the uploaded URL. When
/// the image is taller than the display cap, the block also gets the resized
/// display size; the media file itself is untouched. Falls back to a plain
/// src swap if the block markup is not the expected shape.
fn apply_uploaded_image_to_content(
    content: &str,
    source: &str,
    uploaded: &UploadedWordPressImage,
) -> String {
    if let (Some(natural_width), Some(natural_height)) =
        (uploaded.natural_width, uploaded.natural_height)
    {
        if let Some(display) = wordpress_display_size(natural_width, natural_height) {
            let resized = resize_image_block(
                content,
                source,
                &escape_html_attribute(&uploaded.source_url),
                display,
            );
            if resized != content {
                return resized;
            }
        }
    }

    replace_image_source(content, source, &uploaded.source_url)
}

fn upload_repo_image(
    site: &WordPressSite,
    client: &Client,
    repo_path: &Path,
    source: &str,
) -> Result<UploadedWordPressImage, String> {
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
    let source_url = response
        .get("source_url")
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .ok_or_else(|| "WordPress did not return a URL for the uploaded image.".to_string())?;

    Ok(UploadedWordPressImage {
        source_url,
        natural_width: response
            .pointer("/media_details/width")
            .and_then(|value| value.as_u64()),
        natural_height: response
            .pointer("/media_details/height")
            .and_then(|value| value.as_u64()),
    })
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
    fn collect_image_sources_includes_remote_urls_and_skips_data_uris() {
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
            collect_image_sources(content),
            vec![
                "images/a b.png".to_string(),
                "https://example.com/x.png".to_string(),
                "images/second.jpg".to_string(),
            ],
        );
        assert!(is_local_image_source("images/a b.png"));
        assert!(!is_local_image_source("https://example.com/x.png"));
    }

    #[test]
    fn resize_image_block_sizes_remote_images_in_place() {
        let content = concat!(
            "<!-- wp:image -->\n",
            "<figure class=\"wp-block-image\"><img src=\"https://example.com/tall.png?a=1&amp;b=2\" alt=\"\" /></figure>\n",
            "<!-- /wp:image -->",
        );

        let resized = resize_image_block(
            content,
            "https://example.com/tall.png?a=1&amp;b=2",
            "https://example.com/tall.png?a=1&amp;b=2",
            (300, 600),
        );
        assert_eq!(
            resized,
            concat!(
                "<!-- wp:image {\"width\":\"300px\",\"height\":\"600px\"} -->\n",
                "<figure class=\"wp-block-image is-resized\">",
                "<img src=\"https://example.com/tall.png?a=1&amp;b=2\" alt=\"\" style=\"width:300px;height:600px\" /></figure>\n",
                "<!-- /wp:image -->",
            ),
        );

        // Unexpected markup: returned unchanged.
        let unexpected = "<figure><img src=\"https://example.com/tall.png\" alt=\"\" /></figure>";
        assert_eq!(
            resize_image_block(
                unexpected,
                "https://example.com/tall.png",
                "https://example.com/tall.png",
                (300, 600),
            ),
            unexpected,
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
    fn wordpress_display_size_caps_height_and_keeps_the_aspect_ratio() {
        // Taller than the cap: scaled down to 600px high.
        assert_eq!(wordpress_display_size(2000, 3000), Some((400, 600)));
        assert_eq!(wordpress_display_size(1200, 2400), Some((300, 600)));
        // Already fits: no display size, the block stays unsized.
        assert_eq!(wordpress_display_size(800, 600), None);
        assert_eq!(wordpress_display_size(4000, 599), None);
        // Degenerate dimensions are left alone.
        assert_eq!(wordpress_display_size(0, 9000), None);
    }

    #[test]
    fn apply_uploaded_image_resizes_tall_images_with_block_editor_markup() {
        let content = concat!(
            "<!-- wp:image -->\n",
            "<figure class=\"wp-block-image\"><img src=\"images/tall.png\" alt=\"\" />",
            "<figcaption>Caption</figcaption></figure>\n",
            "<!-- /wp:image -->",
        );
        let uploaded = UploadedWordPressImage {
            source_url: "https://files.example/tall.png".to_string(),
            natural_width: Some(1500),
            natural_height: Some(3000),
        };

        let rewritten = apply_uploaded_image_to_content(content, "images/tall.png", &uploaded);

        assert_eq!(
            rewritten,
            concat!(
                "<!-- wp:image {\"width\":\"300px\",\"height\":\"600px\"} -->\n",
                "<figure class=\"wp-block-image is-resized\">",
                "<img src=\"https://files.example/tall.png\" alt=\"\" style=\"width:300px;height:600px\" />",
                "<figcaption>Caption</figcaption></figure>\n",
                "<!-- /wp:image -->",
            ),
        );
    }

    #[test]
    fn apply_uploaded_image_leaves_fitting_images_unsized() {
        let content = concat!(
            "<!-- wp:image -->\n",
            "<figure class=\"wp-block-image\"><img src=\"images/wide.png\" alt=\"\" /></figure>\n",
            "<!-- /wp:image -->",
        );
        let uploaded = UploadedWordPressImage {
            source_url: "https://files.example/wide.png".to_string(),
            natural_width: Some(2000),
            natural_height: Some(500),
        };

        let rewritten = apply_uploaded_image_to_content(content, "images/wide.png", &uploaded);

        assert_eq!(
            rewritten,
            concat!(
                "<!-- wp:image -->\n",
                "<figure class=\"wp-block-image\"><img src=\"https://files.example/wide.png\" alt=\"\" /></figure>\n",
                "<!-- /wp:image -->",
            ),
        );
    }

    #[test]
    fn apply_uploaded_image_falls_back_to_src_swap_without_dimensions_or_pattern() {
        let uploaded_without_dimensions = UploadedWordPressImage {
            source_url: "https://files.example/a.png".to_string(),
            natural_width: None,
            natural_height: None,
        };
        let content = "<!-- wp:image -->\n<figure class=\"wp-block-image\"><img src=\"images/a.png\" alt=\"\" /></figure>\n<!-- /wp:image -->";
        let rewritten =
            apply_uploaded_image_to_content(content, "images/a.png", &uploaded_without_dimensions);
        assert!(rewritten.contains("src=\"https://files.example/a.png\""));
        assert!(!rewritten.contains("is-resized"));

        // Tall image but unexpected surrounding markup: src still swapped.
        let unexpected_markup = "<figure><img src=\"images/a.png\" alt=\"\" /></figure>";
        let tall = UploadedWordPressImage {
            source_url: "https://files.example/a.png".to_string(),
            natural_width: Some(1000),
            natural_height: Some(4000),
        };
        let rewritten = apply_uploaded_image_to_content(unexpected_markup, "images/a.png", &tall);
        assert_eq!(
            rewritten,
            "<figure><img src=\"https://files.example/a.png\" alt=\"\" /></figure>",
        );
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
