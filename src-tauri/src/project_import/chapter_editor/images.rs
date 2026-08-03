use crate::{
    constants::{decoded_base64_len, ensure_within_import_size_limit},
    short_path_names::allocate_short_image_filename,
};
use reqwest::blocking::Response;
use scraper::{ElementRef, Html, Selector};
use std::{io::Read as _, time::Duration};
use tauri::Emitter;

use super::*;

const WORDPRESS_CAPTION_USER_AGENT: &str = concat!(
    "Gnosis-TMS/",
    env!("CARGO_PKG_VERSION"),
    " (+https://github.com/gnosistms/Gnosis-TMS-tauri-app)"
);
const MAX_WORDPRESS_MEDIA_RESPONSE_BYTES: u64 = 256 * 1024;
const MAX_WORDPRESS_MEDIA_SEARCH_ATTEMPTS: usize = 4;
const MIN_WORDPRESS_MEDIA_SEARCH_TOKENS: usize = 3;
pub(super) const EDITOR_IMAGE_CAPTION_ENRICHED_EVENT: &str = "editor-image-caption-enriched";

#[derive(Debug, PartialEq, Eq)]
struct WordPressMediaLookup {
    endpoints: Vec<url::Url>,
    image_identity: String,
}

#[derive(Debug, PartialEq, Eq)]
enum WordPressCaptionMatch {
    NoMatch,
    MatchedWithoutCaption,
    Caption(String),
}

struct WordPressCaptionEnrichmentInput {
    installation_id: i64,
    project_id: Option<String>,
    repo_name: String,
    chapter_id: String,
    row_id: String,
    language_code: String,
    image_url: String,
    base_caption: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EditorImageCaptionEnrichedEvent {
    chapter_id: String,
    row_id: String,
    language_code: String,
    image_url: String,
    row: EditorRow,
    chapter_base_commit_sha: Option<String>,
}

pub(crate) fn save_gtms_editor_language_image_url_sync(
    app: &AppHandle,
    input: SaveEditorLanguageImageUrlInput,
) -> Result<SaveEditorLanguageImageResponse, String> {
    let normalized_url = validate_editor_image_url(&input.url)?;
    let repo_path = resolve_project_git_repo_path(
        app,
        input.installation_id,
        input.project_id.as_deref(),
        Some(&input.repo_name),
    )?;
    ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
    ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;
    let repo_lock = crate::repo_sync_shared::repo_sync_lock(&repo_path);
    let _repo_lock_guard = crate::repo_sync_shared::acquire_repo_sync_lock(&repo_lock);

    let chapter_path =
        find_chapter_path_by_id(app, &repo_path.join("chapters"), &input.chapter_id)?;
    let row_json_path = validated_row_json_path(&chapter_path, &input.row_id)?;
    if !row_json_path.exists() {
        return Ok(SaveEditorLanguageImageResponse {
            row_id: input.row_id,
            language_code: input.language_code,
            status: "deleted".to_string(),
            row: None,
            chapter_base_commit_sha: current_repo_head_sha(&repo_path),
        });
    }

    let relative_row_json = repo_relative_path(&repo_path, &row_json_path)?;
    let original_row_text = fs::read_to_string(&row_json_path).map_err(|error| {
        format!(
            "Could not read row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    let original_row_file: StoredRowFile =
        serde_json::from_str(&original_row_text).map_err(|error| {
            format!(
                "Could not parse row file '{}': {error}",
                row_json_path.display()
            )
        })?;
    if original_row_file.lifecycle.state == "deleted" {
        return Ok(SaveEditorLanguageImageResponse {
            row_id: input.row_id,
            language_code: input.language_code,
            status: "deleted".to_string(),
            row: Some(editor_row_from_stored_row_file_with_update(
                &repo_path,
                &chapter_path,
                original_row_file,
            )?),
            chapter_base_commit_sha: current_repo_head_sha(&repo_path),
        });
    }

    let current_image = row_language_stored_image(&original_row_file, &input.language_code);
    let base_image = normalize_editor_field_image_input(input.base_image.as_ref());
    if current_image != base_image {
        return Ok(SaveEditorLanguageImageResponse {
            row_id: input.row_id,
            language_code: input.language_code,
            status: "conflict".to_string(),
            row: Some(editor_row_from_stored_row_file_with_update(
                &repo_path,
                &chapter_path,
                original_row_file,
            )?),
            chapter_base_commit_sha: current_repo_head_sha(&repo_path),
        });
    }

    let next_image = Some(StoredFieldImage {
        kind: "url".to_string(),
        url: Some(normalized_url),
        path: None,
    });
    let replaced_uploaded_path = current_image
        .as_ref()
        .filter(|image| image.kind == "upload")
        .and_then(|image| image.path.clone());
    let mut row_value: Value = serde_json::from_str(&original_row_text).map_err(|error| {
        format!(
            "Could not parse row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    apply_editor_field_image_update(&mut row_value, &input.language_code, next_image)?;

    let updated_row_json = serde_json::to_string_pretty(&row_value).map_err(|error| {
        format!(
            "Could not serialize row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    let updated_row_text = format!("{updated_row_json}\n");
    let row_changed = updated_row_text != original_row_text;
    let updated_row_file: StoredRowFile =
        serde_json::from_value(row_value.clone()).map_err(|error| {
            format!(
                "Could not decode updated row '{}': {error}",
                row_json_path.display()
            )
        })?;
    let removable_paths = unreferenced_uploaded_paths_after_row_updates(
        &repo_path,
        &replaced_uploaded_path
            .clone()
            .into_iter()
            .collect::<Vec<_>>(),
        &BTreeMap::from([(relative_row_json.clone(), Some(updated_row_file.clone()))]),
    )?;
    let mut rollback_snapshots = Vec::new();

    push_repo_file_snapshot(&mut rollback_snapshots, &repo_path, &relative_row_json)?;
    for relative_path in &removable_paths {
        push_uploaded_asset_snapshot(&mut rollback_snapshots, &repo_path, relative_path)?;
    }

    let next_row = with_repo_file_rollback(&repo_path, &rollback_snapshots, || {
        let mut paths_to_commit = vec![relative_row_json.clone()];

        if row_changed {
            write_text_file(&row_json_path, &updated_row_text)?;
        }

        for relative_path in &removable_paths {
            remove_uploaded_asset_from_disk(&repo_path, relative_path)?;
            git_output(
                &repo_path,
                &["rm", "--cached", "--ignore-unmatch", relative_path],
            )?;
            paths_to_commit.push(relative_path.to_string());
        }

        if row_changed {
            git_output(&repo_path, &["add", &relative_row_json])?;
        }

        if row_changed || paths_to_commit.len() > 1 {
            let commit_paths: Vec<&str> = paths_to_commit.iter().map(String::as_str).collect();
            git_commit_as_signed_in_user_with_metadata(
                app,
                &repo_path,
                &format!("Update row {} {} image", input.row_id, input.language_code),
                &commit_paths,
                CommitMetadata {
                    operation: Some("editor-update"),
                    migration: None,
                    status_note: None,
                    ai_model: None,
                },
            )?;
        }

        Ok(updated_row_file.clone())
    })?;

    Ok(SaveEditorLanguageImageResponse {
        row_id: input.row_id,
        language_code: input.language_code,
        status: "saved".to_string(),
        row: Some(editor_row_from_stored_row_file_with_update(
            &repo_path,
            &chapter_path,
            next_row,
        )?),
        chapter_base_commit_sha: current_repo_head_sha(&repo_path),
    })
}

fn fetch_wordpress_media_caption(image_url: &str) -> Option<String> {
    let lookup = wordpress_media_lookup(image_url)?;
    let client = super::chapter_export::public_http_client_for_url(
        lookup.endpoints.first()?.as_str(),
        Duration::from_secs(4),
        WORDPRESS_CAPTION_USER_AGENT,
    )
    .ok()?;
    for endpoint in lookup.endpoints {
        let Ok(response) = client.get(endpoint).send() else {
            continue;
        };
        match wordpress_caption_response(response, &lookup.image_identity) {
            Some(WordPressCaptionMatch::Caption(caption)) => return Some(caption),
            Some(WordPressCaptionMatch::MatchedWithoutCaption) => return None,
            Some(WordPressCaptionMatch::NoMatch) | None => {}
        }
    }
    None
}

fn wordpress_caption_response(
    response: Response,
    image_identity: &str,
) -> Option<WordPressCaptionMatch> {
    if !response.status().is_success() {
        return None;
    }
    let mut bytes = Vec::new();
    response
        .take(MAX_WORDPRESS_MEDIA_RESPONSE_BYTES + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.len() as u64 > MAX_WORDPRESS_MEDIA_RESPONSE_BYTES {
        return None;
    }
    let value: Value = serde_json::from_slice(&bytes).ok()?;
    wordpress_caption_from_media_response(&value, image_identity)
}

fn wordpress_media_lookup(image_url: &str) -> Option<WordPressMediaLookup> {
    let image = url::Url::parse(image_url).ok()?;
    if !matches!(image.scheme(), "http" | "https") {
        return None;
    }
    let host = image.host_str()?.to_ascii_lowercase();
    if matches!(host.as_str(), "i0.wp.com" | "i1.wp.com" | "i2.wp.com") {
        let mut segments = image.path_segments()?;
        let origin_host = segments.next()?.trim();
        if origin_host.is_empty() || origin_host.contains('@') || origin_host.contains(':') {
            return None;
        }
        let origin_path = segments.collect::<Vec<_>>().join("/");
        return wordpress_media_lookup(&format!("https://{origin_host}/{origin_path}"));
    }
    let filename = image.path_segments()?.next_back()?;
    let slug = wordpress_attachment_slug_candidate(filename)?;
    let searches = wordpress_attachment_search_terms(filename)?;
    let image_identity = wordpress_image_identity(image.as_str())?;

    let endpoint = if let Some(site_prefix) = host.strip_suffix(".files.wordpress.com") {
        if site_prefix.is_empty() || site_prefix.contains('.') {
            return None;
        }
        url::Url::parse(&format!(
            "https://public-api.wordpress.com/wp/v2/sites/{site_prefix}.wordpress.com/media"
        ))
        .ok()?
    } else {
        let lower_path = image.path().to_ascii_lowercase();
        let marker_index = lower_path.find("/wp-content/uploads/")?;
        let install_prefix = image.path().get(..marker_index)?;
        let mut site = image.clone();
        site.set_query(None);
        site.set_fragment(None);
        site.set_path(&format!("{install_prefix}/wp-json/wp/v2/media"));
        site
    };
    let mut exact_endpoint = endpoint.clone();
    exact_endpoint
        .query_pairs_mut()
        .append_pair("slug", &slug)
        .append_pair("per_page", "1")
        .append_pair("media_type", "image")
        .append_pair("_fields", "caption,source_url,media_details");
    let mut endpoints = vec![exact_endpoint];
    endpoints.extend(searches.into_iter().map(|search| {
        let mut search_endpoint = endpoint.clone();
        search_endpoint
            .query_pairs_mut()
            .append_pair("search", &search)
            .append_pair("per_page", "100")
            .append_pair("media_type", "image")
            .append_pair("_fields", "caption,source_url,media_details");
        search_endpoint
    }));
    Some(WordPressMediaLookup {
        endpoints,
        image_identity,
    })
}

fn wordpress_attachment_slug_candidate(filename: &str) -> Option<String> {
    let decoded = percent_decode_utf8_lossy(filename);
    let stem = decoded
        .rsplit_once('.')
        .map(|(stem, _)| stem)
        .unwrap_or(decoded.as_str());
    let mut slug = String::with_capacity(stem.len());
    let mut last_was_dash = false;
    for ch in stem.chars().flat_map(char::to_lowercase) {
        if ch.is_alphanumeric() || ch == '_' {
            slug.push(ch);
            last_was_dash = false;
        } else if ch == '-' || ch.is_whitespace() {
            if !slug.is_empty() && !last_was_dash {
                slug.push('-');
                last_was_dash = true;
            }
        }
    }
    while slug.ends_with('-') {
        slug.pop();
    }
    (!slug.is_empty()).then_some(slug)
}

fn wordpress_attachment_search_terms(filename: &str) -> Option<Vec<String>> {
    let decoded = percent_decode_utf8_lossy(filename);
    let stem = decoded
        .rsplit_once('.')
        .map(|(stem, _)| stem)
        .unwrap_or(decoded.as_str());
    let mut normalized = stem.trim().to_string();
    loop {
        let before = normalized.len();
        let lowercase = normalized.to_ascii_lowercase();
        if let Some((prefix, dimensions)) = lowercase.rsplit_once('-') {
            if let Some((width, height)) = dimensions.split_once('x') {
                if !width.is_empty()
                    && !height.is_empty()
                    && width.bytes().all(|byte| byte.is_ascii_digit())
                    && height.bytes().all(|byte| byte.is_ascii_digit())
                {
                    normalized.truncate(prefix.len());
                }
            }
        }
        for suffix in ["-scaled", "-rotated"] {
            if normalized.to_ascii_lowercase().ends_with(suffix) {
                normalized.truncate(normalized.len() - suffix.len());
            }
        }
        if normalized.len() == before {
            break;
        }
    }
    let tokens = normalized
        .split(|ch: char| ch == '-' || ch == '_' || ch.is_whitespace())
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    if tokens.is_empty() {
        return None;
    }
    let removable_tokens = tokens
        .len()
        .saturating_sub(MIN_WORDPRESS_MEDIA_SEARCH_TOKENS);
    let fallback_count = removable_tokens.min(MAX_WORDPRESS_MEDIA_SEARCH_ATTEMPTS - 1);
    Some(
        (0..=fallback_count)
            .map(|removed| tokens[..tokens.len() - removed].join(" "))
            .collect(),
    )
}

fn wordpress_caption_from_media_response(
    value: &Value,
    image_identity: &str,
) -> Option<WordPressCaptionMatch> {
    let Some(media) = value
        .as_array()?
        .iter()
        .find(|item| wordpress_media_item_matches_url(item, image_identity))
    else {
        return Some(WordPressCaptionMatch::NoMatch);
    };
    let caption = media
        .pointer("/caption/rendered")
        .and_then(Value::as_str)
        .and_then(wordpress_caption_plain_text);
    Some(match caption {
        Some(caption) => WordPressCaptionMatch::Caption(caption),
        None => WordPressCaptionMatch::MatchedWithoutCaption,
    })
}

fn wordpress_media_item_matches_url(item: &Value, image_identity: &str) -> bool {
    let source_url = item.get("source_url").and_then(Value::as_str);
    let source_matches = source_url
        .and_then(wordpress_image_identity)
        .map(|identity| identity == image_identity)
        .unwrap_or(false);
    if source_matches {
        return true;
    }

    let size_matches = item
        .pointer("/media_details/sizes")
        .and_then(Value::as_object)
        .into_iter()
        .flat_map(|sizes| sizes.values())
        .filter_map(|size| size.get("source_url").and_then(Value::as_str))
        .filter_map(wordpress_image_identity)
        .any(|identity| identity == image_identity);
    if size_matches {
        return true;
    }

    let Some(original_filename) = item
        .pointer("/media_details/original_image")
        .and_then(Value::as_str)
    else {
        return false;
    };
    let Some(source_url) = source_url else {
        return false;
    };
    let Ok(mut original_url) = url::Url::parse(source_url) else {
        return false;
    };
    let decoded_source_path = percent_decode_utf8_lossy(original_url.path());
    let Some((directory, _)) = decoded_source_path.rsplit_once('/') else {
        return false;
    };
    original_url.set_path(&format!("{directory}/{original_filename}"));
    wordpress_image_identity(original_url.as_str())
        .map(|identity| identity == image_identity)
        .unwrap_or(false)
}

fn wordpress_image_identity(value: &str) -> Option<String> {
    let url = url::Url::parse(value).ok()?;
    if !matches!(url.scheme(), "http" | "https") {
        return None;
    }
    let host = url.host_str()?.to_ascii_lowercase();
    let port = url
        .port()
        .map(|port| format!(":{port}"))
        .unwrap_or_default();
    Some(format!(
        "{host}{port}{}",
        percent_decode_utf8_lossy(url.path())
    ))
}

fn percent_decode_utf8_lossy(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let hex = str::from_utf8(&bytes[index + 1..index + 3])
                .ok()
                .and_then(|pair| u8::from_str_radix(pair, 16).ok());
            if let Some(hex) = hex {
                decoded.push(hex);
                index += 3;
                continue;
            }
        }
        decoded.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&decoded).to_string()
}

fn wordpress_caption_plain_text(rendered: &str) -> Option<String> {
    let fragment = Html::parse_fragment(rendered);
    let more_link_selector = Selector::parse(".more-link").ok()?;
    let last_text_node = fragment
        .root_element()
        .descendants()
        .filter(|node| {
            node.value()
                .as_text()
                .is_some_and(|text| !text.trim().is_empty())
        })
        .last();
    let trailing_more_link = last_text_node.and_then(|last_text_node| {
        fragment.select(&more_link_selector).find(|more_link| {
            more_link
                .descendants()
                .any(|node| node.id() == last_text_node.id())
        })
    });
    let text = fragment
        .root_element()
        .descendants()
        .filter(|node| {
            !trailing_more_link.is_some_and(|more_link| {
                node.ancestors()
                    .filter_map(ElementRef::wrap)
                    .any(|ancestor| ancestor.id() == more_link.id())
            })
        })
        .filter_map(|node| node.value().as_text().map(|text| text.as_ref()))
        .flat_map(str::split_whitespace)
        .collect::<Vec<_>>()
        .join(" ");
    let text = if trailing_more_link.is_some() {
        strip_wordpress_generated_more_ellipsis(&text)
    } else {
        text
    };
    (!text.is_empty()).then_some(text)
}

fn strip_wordpress_generated_more_ellipsis(text: &str) -> String {
    let trimmed = text.trim_end();
    for suffix in [" […]", " [...]", " …", "..."] {
        if let Some(caption) = trimmed.strip_suffix(suffix) {
            return caption.trim_end().to_string();
        }
    }
    trimmed.to_string()
}

pub(crate) fn start_wordpress_caption_enrichment(
    app: AppHandle,
    input: SaveEditorLanguageImageUrlInput,
    response: &SaveEditorLanguageImageResponse,
) {
    if response.status != "saved" {
        return;
    }
    let Ok(image_url) = validate_editor_image_url(&input.url) else {
        return;
    };
    if wordpress_media_lookup(&image_url).is_none() {
        return;
    }
    let Some(saved_row) = response.row.as_ref() else {
        return;
    };
    let base_caption = saved_row
        .image_captions
        .get(&input.language_code)
        .cloned()
        .unwrap_or_default();
    let enrichment = WordPressCaptionEnrichmentInput {
        installation_id: input.installation_id,
        project_id: input.project_id,
        repo_name: input.repo_name,
        chapter_id: input.chapter_id,
        row_id: input.row_id,
        language_code: input.language_code,
        image_url,
        base_caption,
    };
    tauri::async_runtime::spawn_blocking(move || {
        let event = enrich_wordpress_caption_sync(&app, enrichment)
            .ok()
            .flatten();
        if let Some(event) = event {
            let _ = app.emit(EDITOR_IMAGE_CAPTION_ENRICHED_EVENT, event);
        }
    });
}

fn enrich_wordpress_caption_sync(
    app: &AppHandle,
    input: WordPressCaptionEnrichmentInput,
) -> Result<Option<EditorImageCaptionEnrichedEvent>, String> {
    let Some(caption) = fetch_wordpress_media_caption(&input.image_url) else {
        return Ok(None);
    };
    let repo_path = resolve_project_git_repo_path(
        app,
        input.installation_id,
        input.project_id.as_deref(),
        Some(&input.repo_name),
    )?;
    ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
    ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;
    let repo_lock = crate::repo_sync_shared::repo_sync_lock(&repo_path);
    let _repo_lock_guard = crate::repo_sync_shared::acquire_repo_sync_lock(&repo_lock);
    let chapter_path =
        find_chapter_path_by_id(app, &repo_path.join("chapters"), &input.chapter_id)?;
    let row_json_path = validated_row_json_path(&chapter_path, &input.row_id)?;
    if !row_json_path.exists() {
        return Ok(None);
    }

    let relative_row_json = repo_relative_path(&repo_path, &row_json_path)?;
    let original_row_text = fs::read_to_string(&row_json_path).map_err(|error| {
        format!(
            "Could not read row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    let original_row_file: StoredRowFile =
        serde_json::from_str(&original_row_text).map_err(|error| {
            format!(
                "Could not parse row file '{}': {error}",
                row_json_path.display()
            )
        })?;
    if original_row_file.lifecycle.state == "deleted" {
        return Ok(None);
    }

    if !wordpress_caption_enrichment_is_current(
        &original_row_file,
        &input.language_code,
        &input.image_url,
        &input.base_caption,
    ) {
        return Ok(None);
    }
    let current_caption = original_row_file
        .fields
        .get(&input.language_code)
        .map(|field| normalize_editor_image_caption_value(&field.image_caption))
        .unwrap_or_default();
    if current_caption == caption {
        return Ok(None);
    }

    let mut row_value: Value = serde_json::from_str(&original_row_text).map_err(|error| {
        format!(
            "Could not parse row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    super::row_fields::apply_editor_image_caption_updates(
        &mut row_value,
        &BTreeMap::from([(input.language_code.clone(), caption)]),
    )?;
    let updated_row_json = serde_json::to_string_pretty(&row_value).map_err(|error| {
        format!(
            "Could not serialize row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    let updated_row_text = format!("{updated_row_json}\n");
    let updated_row_file: StoredRowFile = serde_json::from_value(row_value).map_err(|error| {
        format!(
            "Could not decode updated row '{}': {error}",
            row_json_path.display()
        )
    })?;
    let mut rollback_snapshots = Vec::new();
    push_repo_file_snapshot(&mut rollback_snapshots, &repo_path, &relative_row_json)?;
    let next_row = with_repo_file_rollback(&repo_path, &rollback_snapshots, || {
        write_text_file(&row_json_path, &updated_row_text)?;
        git_output(&repo_path, &["add", &relative_row_json])?;
        git_commit_as_signed_in_user_with_metadata(
            app,
            &repo_path,
            &format!(
                "Import row {} {} image caption",
                input.row_id, input.language_code
            ),
            &[&relative_row_json],
            CommitMetadata {
                operation: Some("editor-update"),
                migration: None,
                status_note: None,
                ai_model: None,
            },
        )?;
        Ok(updated_row_file.clone())
    })?;
    let row = editor_row_from_stored_row_file_with_update(&repo_path, &chapter_path, next_row)?;
    Ok(Some(EditorImageCaptionEnrichedEvent {
        chapter_id: input.chapter_id,
        row_id: input.row_id,
        language_code: input.language_code,
        image_url: input.image_url,
        row,
        chapter_base_commit_sha: current_repo_head_sha(&repo_path),
    }))
}

fn wordpress_caption_enrichment_is_current(
    row: &StoredRowFile,
    language_code: &str,
    image_url: &str,
    base_caption: &str,
) -> bool {
    let expected_image = Some(StoredFieldImage {
        kind: "url".to_string(),
        url: Some(image_url.to_string()),
        path: None,
    });
    let current_caption = row
        .fields
        .get(language_code)
        .map(|field| normalize_editor_image_caption_value(&field.image_caption))
        .unwrap_or_default();
    row_language_stored_image(row, language_code) == expected_image
        && current_caption == normalize_editor_image_caption_value(base_caption)
}

pub(crate) fn upload_gtms_editor_language_image_sync(
    app: &AppHandle,
    input: UploadEditorLanguageImageInput,
) -> Result<SaveEditorLanguageImageResponse, String> {
    let repo_path = resolve_project_git_repo_path(
        app,
        input.installation_id,
        input.project_id.as_deref(),
        Some(&input.repo_name),
    )?;
    ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
    ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;
    let repo_lock = crate::repo_sync_shared::repo_sync_lock(&repo_path);
    let _repo_lock_guard = crate::repo_sync_shared::acquire_repo_sync_lock(&repo_lock);

    let chapter_path =
        find_chapter_path_by_id(app, &repo_path.join("chapters"), &input.chapter_id)?;
    let row_json_path = validated_row_json_path(&chapter_path, &input.row_id)?;
    if !row_json_path.exists() {
        return Ok(SaveEditorLanguageImageResponse {
            row_id: input.row_id,
            language_code: input.language_code,
            status: "deleted".to_string(),
            row: None,
            chapter_base_commit_sha: current_repo_head_sha(&repo_path),
        });
    }

    let relative_row_json = repo_relative_path(&repo_path, &row_json_path)?;
    let original_row_text = fs::read_to_string(&row_json_path).map_err(|error| {
        format!(
            "Could not read row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    let original_row_file: StoredRowFile =
        serde_json::from_str(&original_row_text).map_err(|error| {
            format!(
                "Could not parse row file '{}': {error}",
                row_json_path.display()
            )
        })?;
    if original_row_file.lifecycle.state == "deleted" {
        return Ok(SaveEditorLanguageImageResponse {
            row_id: input.row_id,
            language_code: input.language_code,
            status: "deleted".to_string(),
            row: Some(editor_row_from_stored_row_file_with_update(
                &repo_path,
                &chapter_path,
                original_row_file,
            )?),
            chapter_base_commit_sha: current_repo_head_sha(&repo_path),
        });
    }

    let current_image = row_language_stored_image(&original_row_file, &input.language_code);
    let base_image = normalize_editor_field_image_input(input.base_image.as_ref());
    if current_image != base_image {
        return Ok(SaveEditorLanguageImageResponse {
            row_id: input.row_id,
            language_code: input.language_code,
            status: "conflict".to_string(),
            row: Some(editor_row_from_stored_row_file_with_update(
                &repo_path,
                &chapter_path,
                original_row_file,
            )?),
            chapter_base_commit_sha: current_repo_head_sha(&repo_path),
        });
    }

    let bytes = decode_uploaded_image_bytes(&input.data_base64, &input.filename)?;
    let extension = validated_uploaded_image_extension(&input.filename, &bytes)?;
    let relative_image_path =
        relative_uploaded_image_path(&repo_path, &chapter_path, &input.filename, extension)?;
    let relative_image_path =
        validated_uploaded_asset_relative_path(&repo_path, &relative_image_path)?;
    let next_image = Some(StoredFieldImage {
        kind: "upload".to_string(),
        url: None,
        path: Some(relative_image_path.clone()),
    });
    let replaced_uploaded_path = current_image
        .as_ref()
        .filter(|image| image.kind == "upload")
        .and_then(|image| image.path.clone())
        .filter(|path| path != &relative_image_path);
    let mut row_value: Value = serde_json::from_str(&original_row_text).map_err(|error| {
        format!(
            "Could not parse row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    apply_editor_field_image_update(&mut row_value, &input.language_code, next_image)?;

    let updated_row_json = serde_json::to_string_pretty(&row_value).map_err(|error| {
        format!(
            "Could not serialize row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    let updated_row_text = format!("{updated_row_json}\n");
    let updated_row_file: StoredRowFile =
        serde_json::from_value(row_value.clone()).map_err(|error| {
            format!(
                "Could not decode updated row '{}': {error}",
                row_json_path.display()
            )
        })?;
    let removable_paths = unreferenced_uploaded_paths_after_row_updates(
        &repo_path,
        &replaced_uploaded_path
            .clone()
            .into_iter()
            .collect::<Vec<_>>(),
        &BTreeMap::from([(relative_row_json.clone(), Some(updated_row_file.clone()))]),
    )?;
    let mut rollback_snapshots = Vec::new();

    push_repo_file_snapshot(&mut rollback_snapshots, &repo_path, &relative_row_json)?;
    push_uploaded_asset_snapshot(&mut rollback_snapshots, &repo_path, &relative_image_path)?;
    for relative_path in &removable_paths {
        push_uploaded_asset_snapshot(&mut rollback_snapshots, &repo_path, relative_path)?;
    }

    let next_row = with_repo_file_rollback(&repo_path, &rollback_snapshots, || {
        write_uploaded_asset_file(&repo_path, &relative_image_path, &bytes)?;
        write_text_file(&row_json_path, &updated_row_text)?;
        for relative_path in &removable_paths {
            remove_uploaded_asset_from_disk(&repo_path, relative_path)?;
            git_output(
                &repo_path,
                &["rm", "--cached", "--ignore-unmatch", relative_path],
            )?;
        }

        git_output(
            &repo_path,
            &["add", &relative_row_json, &relative_image_path],
        )?;
        let mut commit_paths = vec![relative_row_json.clone(), relative_image_path.clone()];
        commit_paths.extend(removable_paths.clone());
        let commit_path_refs: Vec<&str> = commit_paths.iter().map(String::as_str).collect();
        git_commit_as_signed_in_user_with_metadata(
            app,
            &repo_path,
            &format!("Update row {} {} image", input.row_id, input.language_code),
            &commit_path_refs,
            CommitMetadata {
                operation: Some("editor-update"),
                migration: None,
                status_note: None,
                ai_model: None,
            },
        )?;

        Ok(updated_row_file.clone())
    })?;

    Ok(SaveEditorLanguageImageResponse {
        row_id: input.row_id,
        language_code: input.language_code,
        status: "saved".to_string(),
        row: Some(editor_row_from_stored_row_file_with_update(
            &repo_path,
            &chapter_path,
            next_row,
        )?),
        chapter_base_commit_sha: current_repo_head_sha(&repo_path),
    })
}

pub(crate) fn remove_gtms_editor_language_image_sync(
    app: &AppHandle,
    input: RemoveEditorLanguageImageInput,
) -> Result<SaveEditorLanguageImageResponse, String> {
    let repo_path = resolve_project_git_repo_path(
        app,
        input.installation_id,
        input.project_id.as_deref(),
        Some(&input.repo_name),
    )?;
    ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
    ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;
    let repo_lock = crate::repo_sync_shared::repo_sync_lock(&repo_path);
    let _repo_lock_guard = crate::repo_sync_shared::acquire_repo_sync_lock(&repo_lock);

    let chapter_path =
        find_chapter_path_by_id(app, &repo_path.join("chapters"), &input.chapter_id)?;
    let row_json_path = validated_row_json_path(&chapter_path, &input.row_id)?;
    if !row_json_path.exists() {
        return Ok(SaveEditorLanguageImageResponse {
            row_id: input.row_id,
            language_code: input.language_code,
            status: "deleted".to_string(),
            row: None,
            chapter_base_commit_sha: current_repo_head_sha(&repo_path),
        });
    }

    let relative_row_json = repo_relative_path(&repo_path, &row_json_path)?;
    let original_row_text = fs::read_to_string(&row_json_path).map_err(|error| {
        format!(
            "Could not read row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    let original_row_file: StoredRowFile =
        serde_json::from_str(&original_row_text).map_err(|error| {
            format!(
                "Could not parse row file '{}': {error}",
                row_json_path.display()
            )
        })?;
    if original_row_file.lifecycle.state == "deleted" {
        return Ok(SaveEditorLanguageImageResponse {
            row_id: input.row_id,
            language_code: input.language_code,
            status: "deleted".to_string(),
            row: Some(editor_row_from_stored_row_file_with_update(
                &repo_path,
                &chapter_path,
                original_row_file,
            )?),
            chapter_base_commit_sha: current_repo_head_sha(&repo_path),
        });
    }

    let current_image = row_language_stored_image(&original_row_file, &input.language_code);
    let base_image = normalize_editor_field_image_input(input.base_image.as_ref());
    if current_image != base_image {
        return Ok(SaveEditorLanguageImageResponse {
            row_id: input.row_id,
            language_code: input.language_code,
            status: "conflict".to_string(),
            row: Some(editor_row_from_stored_row_file_with_update(
                &repo_path,
                &chapter_path,
                original_row_file,
            )?),
            chapter_base_commit_sha: current_repo_head_sha(&repo_path),
        });
    }

    let removed_uploaded_path = current_image
        .as_ref()
        .filter(|image| image.kind == "upload")
        .and_then(|image| image.path.clone());
    if current_image.is_none() {
        return Ok(SaveEditorLanguageImageResponse {
            row_id: input.row_id,
            language_code: input.language_code,
            status: "saved".to_string(),
            row: Some(editor_row_from_stored_row_file_with_update(
                &repo_path,
                &chapter_path,
                original_row_file,
            )?),
            chapter_base_commit_sha: current_repo_head_sha(&repo_path),
        });
    }

    let mut row_value: Value = serde_json::from_str(&original_row_text).map_err(|error| {
        format!(
            "Could not parse row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    apply_editor_field_image_update(&mut row_value, &input.language_code, None)?;

    let updated_row_json = serde_json::to_string_pretty(&row_value).map_err(|error| {
        format!(
            "Could not serialize row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    let updated_row_text = format!("{updated_row_json}\n");
    let updated_row_file: StoredRowFile =
        serde_json::from_value(row_value.clone()).map_err(|error| {
            format!(
                "Could not decode updated row '{}': {error}",
                row_json_path.display()
            )
        })?;
    let removable_paths = unreferenced_uploaded_paths_after_row_updates(
        &repo_path,
        &removed_uploaded_path
            .clone()
            .into_iter()
            .collect::<Vec<_>>(),
        &BTreeMap::from([(relative_row_json.clone(), Some(updated_row_file.clone()))]),
    )?;
    let mut rollback_snapshots = Vec::new();

    push_repo_file_snapshot(&mut rollback_snapshots, &repo_path, &relative_row_json)?;
    for relative_path in &removable_paths {
        push_uploaded_asset_snapshot(&mut rollback_snapshots, &repo_path, relative_path)?;
    }

    let next_row = with_repo_file_rollback(&repo_path, &rollback_snapshots, || {
        write_text_file(&row_json_path, &updated_row_text)?;
        for relative_path in &removable_paths {
            remove_uploaded_asset_from_disk(&repo_path, relative_path)?;
            git_output(
                &repo_path,
                &["rm", "--cached", "--ignore-unmatch", relative_path],
            )?;
        }

        git_output(&repo_path, &["add", &relative_row_json])?;
        let mut commit_paths = vec![relative_row_json.clone()];
        commit_paths.extend(removable_paths.clone());
        let commit_path_refs: Vec<&str> = commit_paths.iter().map(String::as_str).collect();
        git_commit_as_signed_in_user_with_metadata(
            app,
            &repo_path,
            &format!("Update row {} {} image", input.row_id, input.language_code),
            &commit_path_refs,
            CommitMetadata {
                operation: Some("editor-update"),
                migration: None,
                status_note: None,
                ai_model: None,
            },
        )?;

        Ok(updated_row_file.clone())
    })?;

    Ok(SaveEditorLanguageImageResponse {
        row_id: input.row_id,
        language_code: input.language_code,
        status: "saved".to_string(),
        row: Some(editor_row_from_stored_row_file_with_update(
            &repo_path,
            &chapter_path,
            next_row,
        )?),
        chapter_base_commit_sha: current_repo_head_sha(&repo_path),
    })
}

enum DuplicateImageRowPlan {
    Conflict(StoredRowFile),
    MissingSource,
    Unchanged(StoredRowFile),
    Update {
        updated_row_text: String,
        updated_row_file: StoredRowFile,
        release_candidates: Vec<String>,
    },
}

fn plan_duplicate_editor_language_image(
    original_row_text: &str,
    source_language_code: &str,
    destination_language_code: &str,
    base_source_image: Option<StoredFieldImage>,
    base_destination_image: Option<StoredFieldImage>,
) -> Result<DuplicateImageRowPlan, String> {
    let original_row_file: StoredRowFile = serde_json::from_str(original_row_text)
        .map_err(|error| format!("Could not parse the row while duplicating its image: {error}"))?;
    let source_image = row_language_stored_image(&original_row_file, source_language_code);
    let destination_image =
        row_language_stored_image(&original_row_file, destination_language_code);
    if source_image != base_source_image || destination_image != base_destination_image {
        return Ok(DuplicateImageRowPlan::Conflict(original_row_file));
    }
    let Some(source_image) = source_image else {
        return Ok(DuplicateImageRowPlan::MissingSource);
    };
    if destination_image.as_ref() == Some(&source_image) {
        return Ok(DuplicateImageRowPlan::Unchanged(original_row_file));
    }

    let mut row_value: Value = serde_json::from_str(original_row_text)
        .map_err(|error| format!("Could not parse the row while duplicating its image: {error}"))?;
    apply_editor_field_image_update(
        &mut row_value,
        destination_language_code,
        Some(source_image.clone()),
    )?;
    let updated_row_json = serde_json::to_string_pretty(&row_value)
        .map_err(|error| format!("Could not serialize the duplicated row image: {error}"))?;
    let updated_row_file: StoredRowFile = serde_json::from_value(row_value)
        .map_err(|error| format!("Could not decode the duplicated row image: {error}"))?;
    let release_candidates = destination_image
        .as_ref()
        .filter(|image| image.kind == "upload" && Some(*image) != Some(&source_image))
        .and_then(|image| image.path.clone())
        .into_iter()
        .collect::<Vec<_>>();
    Ok(DuplicateImageRowPlan::Update {
        updated_row_text: format!("{updated_row_json}\n"),
        updated_row_file,
        release_candidates,
    })
}

pub(crate) fn duplicate_gtms_editor_language_image_sync(
    app: &AppHandle,
    input: DuplicateEditorLanguageImageInput,
) -> Result<SaveEditorLanguageImageResponse, String> {
    let repo_path = resolve_project_git_repo_path(
        app,
        input.installation_id,
        input.project_id.as_deref(),
        Some(&input.repo_name),
    )?;
    ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
    ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;
    let repo_lock = crate::repo_sync_shared::repo_sync_lock(&repo_path);
    let _repo_lock_guard = crate::repo_sync_shared::acquire_repo_sync_lock(&repo_lock);

    if input.source_language_code.trim().is_empty()
        || input.destination_language_code.trim().is_empty()
        || input.source_language_code == input.destination_language_code
    {
        return Err("Choose a different destination language for the image.".to_string());
    }

    let chapter_path =
        find_chapter_path_by_id(app, &repo_path.join("chapters"), &input.chapter_id)?;
    let row_json_path = validated_row_json_path(&chapter_path, &input.row_id)?;
    if !row_json_path.exists() {
        return Ok(SaveEditorLanguageImageResponse {
            row_id: input.row_id,
            language_code: input.destination_language_code,
            status: "deleted".to_string(),
            row: None,
            chapter_base_commit_sha: current_repo_head_sha(&repo_path),
        });
    }

    let relative_row_json = repo_relative_path(&repo_path, &row_json_path)?;
    let original_row_text = fs::read_to_string(&row_json_path).map_err(|error| {
        format!(
            "Could not read row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    let original_row_file: StoredRowFile =
        serde_json::from_str(&original_row_text).map_err(|error| {
            format!(
                "Could not parse row file '{}': {error}",
                row_json_path.display()
            )
        })?;
    if original_row_file.lifecycle.state == "deleted" {
        return Ok(SaveEditorLanguageImageResponse {
            row_id: input.row_id,
            language_code: input.destination_language_code,
            status: "deleted".to_string(),
            row: Some(editor_row_from_stored_row_file_with_update(
                &repo_path,
                &chapter_path,
                original_row_file,
            )?),
            chapter_base_commit_sha: current_repo_head_sha(&repo_path),
        });
    }

    let (updated_row_text, updated_row_file, release_candidates) =
        match plan_duplicate_editor_language_image(
            &original_row_text,
            &input.source_language_code,
            &input.destination_language_code,
            normalize_editor_field_image_input(input.base_source_image.as_ref()),
            normalize_editor_field_image_input(input.base_destination_image.as_ref()),
        )? {
            DuplicateImageRowPlan::Conflict(row) => {
                return Ok(SaveEditorLanguageImageResponse {
                    row_id: input.row_id,
                    language_code: input.destination_language_code,
                    status: "conflict".to_string(),
                    row: Some(editor_row_from_stored_row_file_with_update(
                        &repo_path,
                        &chapter_path,
                        row,
                    )?),
                    chapter_base_commit_sha: current_repo_head_sha(&repo_path),
                });
            }
            DuplicateImageRowPlan::MissingSource => {
                return Err("The source image is no longer available.".to_string());
            }
            DuplicateImageRowPlan::Unchanged(row) => {
                return Ok(SaveEditorLanguageImageResponse {
                    row_id: input.row_id,
                    language_code: input.destination_language_code,
                    status: "saved".to_string(),
                    row: Some(editor_row_from_stored_row_file_with_update(
                        &repo_path,
                        &chapter_path,
                        row,
                    )?),
                    chapter_base_commit_sha: current_repo_head_sha(&repo_path),
                });
            }
            DuplicateImageRowPlan::Update {
                updated_row_text,
                updated_row_file,
                release_candidates,
            } => (updated_row_text, updated_row_file, release_candidates),
        };
    let removable_paths = unreferenced_uploaded_paths_after_row_updates(
        &repo_path,
        &release_candidates,
        &BTreeMap::from([(relative_row_json.clone(), Some(updated_row_file.clone()))]),
    )?;
    let mut rollback_snapshots = Vec::new();
    push_repo_file_snapshot(&mut rollback_snapshots, &repo_path, &relative_row_json)?;
    for path in &removable_paths {
        push_uploaded_asset_snapshot(&mut rollback_snapshots, &repo_path, path)?;
    }

    with_repo_file_rollback(&repo_path, &rollback_snapshots, || {
        write_text_file(&row_json_path, &updated_row_text)?;
        for path in &removable_paths {
            remove_uploaded_asset_from_disk(&repo_path, path)?;
            git_output(&repo_path, &["rm", "--cached", "--ignore-unmatch", path])?;
        }
        git_output(&repo_path, &["add", &relative_row_json])?;
        let mut commit_paths = vec![relative_row_json.clone()];
        commit_paths.extend(removable_paths.clone());
        let commit_path_refs = commit_paths.iter().map(String::as_str).collect::<Vec<_>>();
        git_commit_as_signed_in_user_with_metadata(
            app,
            &repo_path,
            &format!(
                "Duplicate row {} image from {} to {}",
                input.row_id, input.source_language_code, input.destination_language_code
            ),
            &commit_path_refs,
            CommitMetadata {
                operation: Some("editor-update"),
                migration: None,
                status_note: None,
                ai_model: None,
            },
        )?;
        Ok(())
    })?;

    Ok(SaveEditorLanguageImageResponse {
        row_id: input.row_id,
        language_code: input.destination_language_code,
        status: "saved".to_string(),
        row: Some(editor_row_from_stored_row_file_with_update(
            &repo_path,
            &chapter_path,
            updated_row_file,
        )?),
        chapter_base_commit_sha: current_repo_head_sha(&repo_path),
    })
}

pub(super) fn row_language_stored_image(
    row: &StoredRowFile,
    language_code: &str,
) -> Option<StoredFieldImage> {
    row.fields
        .get(language_code)
        .and_then(|field| normalize_editor_field_image_value(&field.image))
}

fn canonical_uploaded_relative_path(path: &str) -> Result<String, String> {
    let normalized = path.trim().replace('\\', "/");
    let mut components = Vec::new();
    for component in Path::new(&normalized).components() {
        match component {
            std::path::Component::Normal(value) => {
                let value = value
                    .to_str()
                    .ok_or_else(|| "A stored uploaded image path is not valid.".to_string())?;
                components.push(value.to_string());
            }
            std::path::Component::CurDir => {}
            _ => return Err("A stored uploaded image path is not valid.".to_string()),
        }
    }
    let component_matches = |actual: &str, expected: &str| {
        if cfg!(windows) {
            actual.eq_ignore_ascii_case(expected)
        } else {
            actual == expected
        }
    };
    if components.len() < 4
        || !component_matches(&components[0], "chapters")
        || components[1].is_empty()
        || !component_matches(&components[2], "images")
        || components[3..].iter().any(|component| component.is_empty())
    {
        return Err(
            "A stored uploaded image path is outside a recognized chapter image folder."
                .to_string(),
        );
    }
    Ok(components.join("/"))
}

pub(super) fn uploaded_path_identity(path: &str) -> Result<String, String> {
    let canonical = canonical_uploaded_relative_path(path)?;
    if cfg!(windows) {
        Ok(canonical.to_lowercase())
    } else {
        Ok(canonical)
    }
}

pub(super) fn validated_uploaded_asset_relative_path(
    repo_path: &Path,
    path: &str,
) -> Result<String, String> {
    let relative_path = canonical_uploaded_relative_path(path)?;
    let canonical_repo = fs::canonicalize(repo_path).map_err(|error| {
        format!("Could not validate the local project path before updating an image: {error}")
    })?;
    let mut current = repo_path.to_path_buf();
    for component in relative_path.split('/') {
        current.push(component);
        match fs::symlink_metadata(&current) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() {
                    return Err("A stored uploaded image path crosses a symbolic link.".to_string());
                }
                let resolved = fs::canonicalize(&current).map_err(|error| {
                    format!("Could not validate a stored uploaded image path: {error}")
                })?;
                if !resolved.starts_with(&canonical_repo) {
                    return Err(
                        "A stored uploaded image path resolves outside the local project."
                            .to_string(),
                    );
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(format!(
                    "Could not inspect a stored uploaded image path: {error}"
                ));
            }
        }
    }
    Ok(relative_path)
}

fn row_uploaded_path_identities(row: &StoredRowFile) -> Result<BTreeSet<String>, String> {
    row.fields
        .values()
        .filter_map(|field| normalize_editor_field_image_value(&field.image))
        .filter(|image| image.kind == "upload")
        .filter_map(|image| image.path)
        .map(|path| uploaded_path_identity(&path))
        .collect()
}

fn project_row_json_paths(repo_path: &Path) -> Result<Vec<PathBuf>, String> {
    let chapters_path = repo_path.join("chapters");
    if !chapters_path.exists() {
        return Ok(Vec::new());
    }
    let mut paths = Vec::new();
    let chapters = fs::read_dir(&chapters_path).map_err(|error| {
        format!("Could not inspect project chapters while checking image references: {error}")
    })?;
    for chapter in chapters {
        let chapter = chapter.map_err(|error| {
            format!("Could not inspect a project chapter while checking image references: {error}")
        })?;
        let rows_path = chapter.path().join("rows");
        if !rows_path.is_dir() {
            continue;
        }
        let rows = fs::read_dir(&rows_path).map_err(|error| {
            format!("Could not inspect chapter rows while checking image references: {error}")
        })?;
        for row in rows {
            let row = row.map_err(|error| {
                format!("Could not inspect a chapter row while checking image references: {error}")
            })?;
            let path = row.path();
            if path.extension().and_then(|value| value.to_str()) == Some("json") {
                paths.push(path);
            }
        }
    }
    Ok(paths)
}

pub(super) fn uploaded_path_is_referenced_by_other_row(
    repo_path: &Path,
    candidate: &str,
    current_row_relative_path: &str,
) -> Result<bool, String> {
    let candidate = validated_uploaded_asset_relative_path(repo_path, candidate)?;
    let candidate_identity = uploaded_path_identity(&candidate)?;
    let current_row_relative_path = current_row_relative_path.trim().replace('\\', "/");

    for row_path in project_row_json_paths(repo_path)? {
        let relative_path = repo_relative_path(repo_path, &row_path)?
            .trim()
            .replace('\\', "/");
        if relative_path == current_row_relative_path {
            continue;
        }
        let row: StoredRowFile = read_json_file(&row_path, "row file")?;
        if row_uploaded_path_identities(&row)?.contains(&candidate_identity) {
            return Ok(true);
        }
    }

    Ok(false)
}

pub(super) fn unreferenced_uploaded_paths_after_row_updates(
    repo_path: &Path,
    candidates: &[String],
    row_overlays: &BTreeMap<String, Option<StoredRowFile>>,
) -> Result<Vec<String>, String> {
    let mut canonical_candidates = BTreeMap::new();
    for path in candidates {
        if path.trim().is_empty() {
            continue;
        }
        let canonical = validated_uploaded_asset_relative_path(repo_path, path)?;
        canonical_candidates
            .entry(uploaded_path_identity(&canonical)?)
            .or_insert(canonical);
    }
    if canonical_candidates.is_empty() {
        return Ok(Vec::new());
    }

    let mut possible = canonical_candidates
        .keys()
        .cloned()
        .collect::<BTreeSet<_>>();
    let overlay_paths = row_overlays
        .keys()
        .map(|path| path.trim().replace('\\', "/"))
        .collect::<BTreeSet<_>>();
    for row in row_overlays.values().flatten() {
        let referenced = row_uploaded_path_identities(row)?;
        possible.retain(|path| !referenced.contains(path));
    }
    if possible.is_empty() {
        return Ok(Vec::new());
    }

    for row_path in project_row_json_paths(repo_path)? {
        let relative_path = repo_relative_path(repo_path, &row_path)?
            .trim()
            .replace('\\', "/");
        if overlay_paths.contains(&relative_path) {
            continue;
        }
        let row: StoredRowFile = read_json_file(&row_path, "row file")?;
        let referenced = row_uploaded_path_identities(&row)?;
        possible.retain(|path| !referenced.contains(path));
        if possible.is_empty() {
            break;
        }
    }

    Ok(possible
        .into_iter()
        .filter_map(|identity| canonical_candidates.remove(&identity))
        .collect())
}

pub(super) fn row_uploaded_image_relative_paths(row: &StoredRowFile) -> Vec<String> {
    row.fields
        .values()
        .filter_map(|field| normalize_editor_field_image_value(&field.image))
        .filter_map(|image| {
            if image.kind == "upload" {
                image.path
            } else {
                None
            }
        })
        .collect()
}

fn normalize_uploaded_image_extension(extension: &str) -> Option<&'static str> {
    match extension
        .trim()
        .trim_start_matches('.')
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => Some("jpg"),
        "png" | "apng" => Some("png"),
        "gif" => Some("gif"),
        "webp" => Some("webp"),
        "avif" => Some("avif"),
        "bmp" => Some("bmp"),
        "ico" => Some("ico"),
        _ => None,
    }
}

// SVG is intentionally not an accepted upload format: an SVG can carry <script>, on*
// handlers, or <foreignObject> HTML, and we do not sanitize uploads, so accepting one
// would let it travel to every teammate via git as latent stored XSS. Raster formats only.
fn detected_uploaded_image_extension(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some("jpg");
    }
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        return Some("png");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some("gif");
    }
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some("webp");
    }
    if bytes.starts_with(b"BM") {
        return Some("bmp");
    }
    if bytes.starts_with(&[0x00, 0x00, 0x01, 0x00]) {
        return Some("ico");
    }
    if bytes.len() >= 12
        && &bytes[4..8] == b"ftyp"
        && bytes
            .windows(4)
            .any(|window| window == b"avif" || window == b"avis")
    {
        return Some("avif");
    }
    None
}

fn validated_uploaded_image_extension(
    filename: &str,
    bytes: &[u8],
) -> Result<&'static str, String> {
    let detected_extension = detected_uploaded_image_extension(bytes)
        .ok_or_else(|| "The uploaded file is not a valid supported image.".to_string())?;
    let filename_extension = Path::new(filename)
        .extension()
        .and_then(|value| value.to_str())
        .and_then(normalize_uploaded_image_extension);

    if let Some(filename_extension) = filename_extension {
        if filename_extension != detected_extension {
            return Err(
                "The uploaded file extension does not match its image contents.".to_string(),
            );
        }
    }

    Ok(detected_extension)
}

fn decode_uploaded_image_bytes(data_base64: &str, file_label: &str) -> Result<Vec<u8>, String> {
    let normalized_data = data_base64.trim();
    if normalized_data.is_empty() {
        return Err("The uploaded image data is empty.".to_string());
    }
    ensure_within_import_size_limit(decoded_base64_len(normalized_data) as u64, file_label)?;

    base64::engine::general_purpose::STANDARD
        .decode(normalized_data)
        .map_err(|error| format!("Could not decode the uploaded image data: {error}"))
}

pub(super) fn validate_editor_image_url(value: &str) -> Result<String, String> {
    let normalized_url = value.trim();
    if normalized_url.is_empty() {
        return Err("Enter an image URL.".to_string());
    }

    let parsed_url = url::Url::parse(normalized_url)
        .map_err(|error| format!("The image URL is invalid: {error}"))?;
    match parsed_url.scheme() {
        "http" | "https" => Ok(normalized_url.to_string()),
        _ => Err("Only http:// and https:// image URLs are supported.".to_string()),
    }
}

pub(super) fn write_binary_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create '{}': {error}", parent.display()))?;
    }

    fs::write(path, bytes).map_err(|error| format!("Could not write '{}': {error}", path.display()))
}

pub(super) fn write_uploaded_asset_file(
    repo_path: &Path,
    relative_path: &str,
    bytes: &[u8],
) -> Result<(), String> {
    let relative_path = validated_uploaded_asset_relative_path(repo_path, relative_path)?;
    write_binary_file(&repo_path.join(relative_path), bytes)
}

fn remove_empty_parent_directories(path: &Path, stop_at: &Path) -> Result<(), String> {
    let mut current = path.parent();
    while let Some(parent) = current {
        if parent == stop_at {
            break;
        }
        match fs::remove_dir(parent) {
            Ok(()) => current = parent.parent(),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                current = parent.parent();
            }
            Err(error) if error.kind() == std::io::ErrorKind::DirectoryNotEmpty => break,
            Err(error) => {
                return Err(format!(
                    "Could not remove empty directory '{}': {error}",
                    parent.display()
                ));
            }
        }
    }

    Ok(())
}

pub(super) fn remove_repo_file_from_disk(
    repo_path: &Path,
    relative_path: &str,
) -> Result<(), String> {
    let absolute_path = repo_path.join(relative_path);
    match fs::remove_file(&absolute_path) {
        Ok(()) => remove_empty_parent_directories(&absolute_path, repo_path),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "Could not remove '{}': {error}",
            absolute_path.display()
        )),
    }
}

pub(super) fn remove_uploaded_asset_from_disk(
    repo_path: &Path,
    relative_path: &str,
) -> Result<(), String> {
    let relative_path = validated_uploaded_asset_relative_path(repo_path, relative_path)?;
    remove_repo_file_from_disk(repo_path, &relative_path)
}

#[derive(Clone)]
pub(super) struct RepoFileSnapshot {
    relative_path: String,
    absolute_path: PathBuf,
    original_bytes: Option<Vec<u8>>,
    uploaded_asset: bool,
}

pub(super) fn capture_repo_file_snapshot(
    repo_path: &Path,
    relative_path: &str,
) -> Result<RepoFileSnapshot, String> {
    let absolute_path = repo_path.join(relative_path);
    let original_bytes = match fs::read(&absolute_path) {
        Ok(bytes) => Some(bytes),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => {
            return Err(format!(
                "Could not read '{}': {error}",
                absolute_path.display()
            ));
        }
    };

    Ok(RepoFileSnapshot {
        relative_path: relative_path.to_string(),
        absolute_path,
        original_bytes,
        uploaded_asset: false,
    })
}

pub(super) fn push_repo_file_snapshot(
    snapshots: &mut Vec<RepoFileSnapshot>,
    repo_path: &Path,
    relative_path: &str,
) -> Result<(), String> {
    if snapshots
        .iter()
        .any(|snapshot| snapshot.relative_path == relative_path)
    {
        return Ok(());
    }

    snapshots.push(capture_repo_file_snapshot(repo_path, relative_path)?);
    Ok(())
}

pub(super) fn push_uploaded_asset_snapshot(
    snapshots: &mut Vec<RepoFileSnapshot>,
    repo_path: &Path,
    relative_path: &str,
) -> Result<(), String> {
    let relative_path = validated_uploaded_asset_relative_path(repo_path, relative_path)?;
    if snapshots
        .iter()
        .any(|snapshot| snapshot.relative_path == relative_path)
    {
        return Ok(());
    }
    let mut snapshot = capture_repo_file_snapshot(repo_path, &relative_path)?;
    snapshot.uploaded_asset = true;
    snapshots.push(snapshot);
    Ok(())
}

pub(super) fn restore_repo_file_snapshot_on_disk(
    repo_path: &Path,
    snapshot: &RepoFileSnapshot,
) -> Result<(), String> {
    if snapshot.uploaded_asset {
        validated_uploaded_asset_relative_path(repo_path, &snapshot.relative_path)?;
    }
    if let Some(original_bytes) = snapshot.original_bytes.as_deref() {
        write_binary_file(&snapshot.absolute_path, original_bytes)?;
        return Ok(());
    }

    remove_repo_file_from_disk(repo_path, &snapshot.relative_path)
}

fn sync_repo_file_snapshot_to_index(
    repo_path: &Path,
    snapshot: &RepoFileSnapshot,
) -> Result<(), String> {
    if snapshot.original_bytes.is_some() {
        git_output(repo_path, &["add", &snapshot.relative_path])?;
    } else {
        git_output(
            repo_path,
            &[
                "rm",
                "--cached",
                "--ignore-unmatch",
                &snapshot.relative_path,
            ],
        )?;
    }
    Ok(())
}

fn rollback_repo_file_snapshots(
    repo_path: &Path,
    snapshots: &[RepoFileSnapshot],
) -> Result<(), String> {
    let mut errors = Vec::new();

    for snapshot in snapshots.iter().rev() {
        if let Err(error) = restore_repo_file_snapshot_on_disk(repo_path, snapshot) {
            errors.push(error);
            continue;
        }
        if let Err(error) = sync_repo_file_snapshot_to_index(repo_path, snapshot) {
            errors.push(error);
        }
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join(" "))
    }
}

pub(super) fn with_repo_file_rollback<T, F>(
    repo_path: &Path,
    snapshots: &[RepoFileSnapshot],
    operation: F,
) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String>,
{
    match operation() {
        Ok(value) => Ok(value),
        Err(error) => match rollback_repo_file_snapshots(repo_path, snapshots) {
            Ok(()) => Err(error),
            Err(rollback_error) => Err(format!("{error} Rollback failed: {rollback_error}")),
        },
    }
}

fn relative_uploaded_image_path(
    repo_path: &Path,
    chapter_path: &Path,
    filename: &str,
    extension: &str,
) -> Result<String, String> {
    let images_path = chapter_path.join("images");
    let file_name =
        allocate_short_image_filename(filename, extension, local_file_names(&images_path)?);
    let absolute_path = images_path.join(file_name);
    repo_relative_path(repo_path, &absolute_path)
}

fn local_file_names(path: &Path) -> Result<Vec<String>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    Ok(fs::read_dir(path)
        .map_err(|error| format!("Could not read image folder '{}': {error}", path.display()))?
        .filter_map(|entry| {
            entry.ok().and_then(|entry| {
                entry
                    .path()
                    .file_name()
                    .and_then(|value| value.to_str())
                    .map(str::to_string)
            })
        })
        .collect())
}

pub(super) fn file_bytes_equal(path: &Path, bytes: &[u8]) -> bool {
    fs::read(path)
        .map(|existing| existing == bytes)
        .unwrap_or(false)
}

pub(super) fn load_historical_blob_bytes(
    repo_path: &Path,
    commit_sha: &str,
    relative_path: &str,
) -> Result<Vec<u8>, String> {
    let request = format!("{commit_sha}:{relative_path}\n");
    let output = git_output_with_stdin(repo_path, &["cat-file", "--batch"], &request)?;
    let Some(header_end) = output.iter().position(|byte| *byte == b'\n') else {
        return Err(format!(
            "Could not parse the historical blob header for '{}'.",
            relative_path
        ));
    };
    let header = str::from_utf8(&output[..header_end]).map_err(|error| {
        format!(
            "Could not decode the historical blob header for '{}': {error}",
            relative_path
        )
    })?;
    if header.ends_with(" missing") {
        return Err(format!(
            "Could not find the historical file '{}' at commit '{}'.",
            relative_path, commit_sha
        ));
    }

    let mut header_parts = header.split_whitespace();
    let _object_name = header_parts.next().unwrap_or_default();
    let object_type = header_parts.next().unwrap_or_default();
    let object_size = header_parts
        .next()
        .ok_or_else(|| {
            format!(
                "Could not parse the historical blob size for '{}'.",
                relative_path
            )
        })?
        .parse::<usize>()
        .map_err(|error| {
            format!(
                "Could not decode the historical blob size for '{}': {error}",
                relative_path
            )
        })?;
    if object_type != "blob" {
        return Err(format!(
            "Expected a blob for historical file '{}', found '{}'.",
            relative_path, object_type
        ));
    }

    let body_start = header_end + 1;
    let body_end = body_start
        .checked_add(object_size)
        .ok_or_else(|| format!("Historical blob size overflow for '{}'.", relative_path))?;
    if body_end > output.len() {
        return Err(format!(
            "The historical blob output was truncated for '{}'.",
            relative_path
        ));
    }

    Ok(output[body_start..body_end].to_vec())
}

fn normalize_editor_field_image_kind(value: &str) -> Option<&'static str> {
    match value.trim() {
        "url" => Some("url"),
        "upload" => Some("upload"),
        _ => None,
    }
}

fn normalize_editor_field_image_parts(
    kind: &str,
    url: Option<&str>,
    path: Option<&str>,
) -> Option<StoredFieldImage> {
    match normalize_editor_field_image_kind(kind)? {
        "url" => {
            let normalized_url = url.unwrap_or_default().trim();
            if normalized_url.is_empty() {
                return None;
            }

            Some(StoredFieldImage {
                kind: "url".to_string(),
                url: Some(normalized_url.to_string()),
                path: None,
            })
        }
        "upload" => {
            let normalized_path = path.unwrap_or_default().trim();
            if normalized_path.is_empty() {
                return None;
            }

            Some(StoredFieldImage {
                kind: "upload".to_string(),
                url: None,
                path: Some(normalized_path.to_string()),
            })
        }
        _ => None,
    }
}

pub(super) fn normalize_editor_field_image_value(
    value: &Option<StoredFieldImage>,
) -> Option<StoredFieldImage> {
    value.as_ref().and_then(|image| {
        normalize_editor_field_image_parts(&image.kind, image.url.as_deref(), image.path.as_deref())
    })
}

pub(super) fn normalize_editor_field_image_input(
    value: Option<&EditorFieldImageInput>,
) -> Option<StoredFieldImage> {
    value.and_then(|image| {
        normalize_editor_field_image_parts(&image.kind, Some(&image.url), Some(&image.path))
    })
}

pub(super) fn editor_field_image_from_stored(
    repo_path: &Path,
    value: &Option<StoredFieldImage>,
) -> Option<EditorFieldImage> {
    let image = normalize_editor_field_image_value(value)?;
    let file_name = image
        .path
        .as_deref()
        .and_then(editor_uploaded_image_file_name_from_relative_path);
    let file_path = image
        .path
        .as_deref()
        .map(|relative_path| repo_path.join(relative_path).to_string_lossy().to_string());

    Some(EditorFieldImage {
        kind: image.kind,
        url: image.url,
        path: image.path,
        file_path,
        file_name,
    })
}

fn editor_uploaded_image_file_name_from_relative_path(relative_path: &str) -> Option<String> {
    Path::new(relative_path)
        .file_name()
        .and_then(|value| value.to_str())
        .map(ToOwned::to_owned)
}

pub(super) fn apply_editor_field_image_update(
    row_value: &mut Value,
    language_code: &str,
    image: Option<StoredFieldImage>,
) -> Result<(), String> {
    let fields_object = row_fields_object_mut(row_value)?;
    let field_value = fields_object
        .entry(language_code.to_string())
        .or_insert_with(|| json!({}));
    let field_object = field_value
        .as_object_mut()
        .ok_or_else(|| "A row field is not a JSON object.".to_string())?;
    ensure_editor_field_object_defaults(field_object)?;
    field_object.insert(
        "image".to_string(),
        serde_json::to_value(image)
            .map_err(|error| format!("Could not serialize the row image metadata: {error}"))?,
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    fn temp_test_dir(name: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("gnosis-tms-{name}-{}", uuid::Uuid::now_v7()));
        fs::create_dir_all(&path).expect("temp dir should be created");
        path
    }

    fn stored_row_with_uploaded_images(row_id: &str, images: &[(&str, &str)]) -> StoredRowFile {
        let fields = images
            .iter()
            .map(|(language_code, path)| {
                (
                    language_code.to_string(),
                    json!({
                        "plain_text": "",
                        "image": {
                            "kind": "upload",
                            "path": path
                        }
                    }),
                )
            })
            .collect::<serde_json::Map<_, _>>();
        serde_json::from_value(json!({
            "row_id": row_id,
            "structure": { "order_key": "0001" },
            "status": { "review_state": "draft" },
            "origin": { "source_row_number": 1 },
            "fields": fields,
        }))
        .expect("stored row should decode")
    }

    fn stored_upload(path: &str) -> StoredFieldImage {
        StoredFieldImage {
            kind: "upload".to_string(),
            url: None,
            path: Some(path.to_string()),
        }
    }

    fn lookup_endpoint_with_query<'a>(
        lookup: &'a WordPressMediaLookup,
        query_key: &str,
    ) -> &'a url::Url {
        lookup
            .endpoints
            .iter()
            .find(|endpoint| endpoint.query_pairs().any(|(key, _)| key == query_key))
            .expect("lookup should have the requested endpoint")
    }

    #[test]
    fn wordpress_media_lookup_supports_self_hosted_subdirectories_and_thumbnails() {
        let lookup = wordpress_media_lookup(
            "https://example.com/news/wp-content/uploads/2026/07/Temple-Entrance-1024x683.jpg?fit=800",
        )
        .expect("WordPress upload URL should produce a lookup");
        let endpoint = lookup_endpoint_with_query(&lookup, "search");

        assert_eq!(endpoint.path(), "/news/wp-json/wp/v2/media");
        assert_eq!(
            lookup.image_identity,
            "example.com/news/wp-content/uploads/2026/07/Temple-Entrance-1024x683.jpg"
        );
        let query = endpoint
            .query_pairs()
            .into_owned()
            .collect::<BTreeMap<_, _>>();
        assert_eq!(
            query.get("search").map(String::as_str),
            Some("Temple Entrance")
        );
        assert_eq!(
            query.get("_fields").map(String::as_str),
            Some("caption,source_url,media_details")
        );
    }

    #[test]
    fn wordpress_media_lookup_supports_wordpress_dot_com_file_hosts() {
        let lookup = wordpress_media_lookup(
            "https://gnosistms.files.wordpress.com/2026/07/plate-12-scaled.jpeg",
        )
        .expect("WordPress.com file URL should produce a lookup");
        let endpoint = lookup
            .endpoints
            .first()
            .expect("lookup should have an endpoint");

        assert_eq!(endpoint.host_str(), Some("public-api.wordpress.com"));
        assert_eq!(
            endpoint.path(),
            "/wp/v2/sites/gnosistms.wordpress.com/media"
        );
        assert_eq!(
            lookup.image_identity,
            "gnosistms.files.wordpress.com/2026/07/plate-12-scaled.jpeg"
        );
    }

    #[test]
    fn wordpress_media_lookup_supports_jetpack_image_cdn_urls() {
        let lookup = wordpress_media_lookup(
            "https://i0.wp.com/example.com/wp-content/uploads/2026/07/plate-scaled-1024x768.jpg?resize=800%2C600",
        )
        .expect("Jetpack CDN URL should produce an origin-site lookup");
        let endpoint = lookup
            .endpoints
            .first()
            .expect("lookup should have an endpoint");

        assert_eq!(endpoint.host_str(), Some("example.com"));
        assert_eq!(endpoint.path(), "/wp-json/wp/v2/media");
        assert_eq!(
            lookup.image_identity,
            "example.com/wp-content/uploads/2026/07/plate-scaled-1024x768.jpg"
        );
    }

    #[test]
    fn wordpress_media_lookup_decodes_non_ascii_filename_search_terms() {
        let lookup = wordpress_media_lookup(
            "https://example.com/wp-content/uploads/2026/07/Caf%C3%A9-Exterior-800x600.jpg",
        )
        .expect("encoded WordPress upload URL should produce a lookup");
        let query = lookup_endpoint_with_query(&lookup, "search")
            .query_pairs()
            .into_owned()
            .collect::<BTreeMap<_, _>>();

        assert_eq!(
            query.get("search").map(String::as_str),
            Some("Café Exterior")
        );
    }

    #[test]
    fn wordpress_media_lookup_adds_bounded_fallbacks_for_optimizer_suffixes() {
        let lookup = wordpress_media_lookup(
            "https://gnosisvn.org/wp-content/uploads/2026/08/Gerard_van_Honthorst_-_Adoration_of_the_Shepherds_1622-cloud-wonder-3-3400w.webp",
        )
        .expect("WordPress upload URL should produce a lookup");
        let searches = lookup
            .endpoints
            .iter()
            .filter_map(|endpoint| {
                endpoint
                    .query_pairs()
                    .find_map(|(key, value)| (key == "search").then(|| value.into_owned()))
            })
            .collect::<Vec<_>>();

        assert_eq!(
            searches,
            vec![
                "Gerard van Honthorst Adoration of the Shepherds 1622 cloud wonder 3 3400w",
                "Gerard van Honthorst Adoration of the Shepherds 1622 cloud wonder 3",
                "Gerard van Honthorst Adoration of the Shepherds 1622 cloud wonder",
                "Gerard van Honthorst Adoration of the Shepherds 1622 cloud",
            ]
        );
    }

    #[test]
    fn wordpress_media_lookup_prefers_exact_filename_derived_slug() {
        let lookup = wordpress_media_lookup(
            "https://gnosisvn.org/wp-content/uploads/2026/08/Gerard_van_Honthorst_-_Adoration_of_the_Shepherds_1622-cloud-wonder-3-3400w.webp",
        )
        .expect("WordPress upload URL should produce a lookup");
        let exact_endpoint = lookup
            .endpoints
            .first()
            .expect("exact slug lookup should be first");
        let query = exact_endpoint
            .query_pairs()
            .into_owned()
            .collect::<BTreeMap<_, _>>();

        assert_eq!(
            query.get("slug").map(String::as_str),
            Some("gerard_van_honthorst_-_adoration_of_the_shepherds_1622-cloud-wonder-3-3400w")
        );
        assert!(!query.contains_key("search"));
        assert_eq!(query.get("per_page").map(String::as_str), Some("1"));
    }

    #[test]
    fn wordpress_attachment_slug_candidate_sanitizes_filename_conservatively() {
        assert_eq!(
            wordpress_attachment_slug_candidate("A_(Careful)  Name--01.webp"),
            Some("a_careful-name-01".to_string())
        );
        assert_eq!(
            wordpress_attachment_slug_candidate("Caf%C3%A9-Exterior.jpg"),
            Some("café-exterior".to_string())
        );
    }

    #[test]
    fn wordpress_attachment_search_fallbacks_keep_at_least_three_tokens() {
        assert_eq!(
            wordpress_attachment_search_terms("one-two-three-four-five.jpg"),
            Some(vec![
                "one two three four five".to_string(),
                "one two three four".to_string(),
                "one two three".to_string(),
            ])
        );
        assert_eq!(
            wordpress_attachment_search_terms("one-two.jpg"),
            Some(vec!["one two".to_string()])
        );
    }

    #[test]
    fn wordpress_media_lookup_ignores_non_wordpress_image_urls() {
        assert!(wordpress_media_lookup("https://cdn.example.com/images/photo.jpg").is_none());
    }

    #[test]
    fn wordpress_caption_response_matches_generated_size_url_not_editable_slug() {
        let response = json!([
            {
                "slug": "temple-entrance",
                "source_url": "https://example.com/wp-content/uploads/2026/07/other.jpg",
                "media_details": { "sizes": {} },
                "caption": { "rendered": "<p>Wrong caption</p>" }
            },
            {
                "slug": "an-editor-renamed-this-attachment",
                "source_url": "http://example.com/wp-content/uploads/2026/07/Temple-Entrance.jpg",
                "media_details": {
                    "sizes": {
                        "large": {
                            "source_url": "https://example.com/wp-content/uploads/2026/07/Temple-Entrance-1024x683.jpg"
                        }
                    }
                },
                "caption": {
                    "rendered": "<p>Temple <em>entrance</em> &amp; courtyard.</p>"
                }
            }
        ]);

        assert_eq!(
            wordpress_caption_from_media_response(
                &response,
                "example.com/wp-content/uploads/2026/07/Temple-Entrance-1024x683.jpg"
            ),
            Some(WordPressCaptionMatch::Caption(
                "Temple entrance & courtyard.".to_string()
            ))
        );
        assert_eq!(
            wordpress_caption_from_media_response(&response, "example.com/missing.jpg"),
            Some(WordPressCaptionMatch::NoMatch)
        );
    }

    #[test]
    fn wordpress_caption_response_stops_after_matching_an_empty_caption() {
        let response = json!([{
            "source_url": "https://example.com/wp-content/uploads/2026/07/Temple-Entrance.jpg",
            "media_details": { "sizes": {} },
            "caption": { "rendered": "" }
        }]);

        assert_eq!(
            wordpress_caption_from_media_response(
                &response,
                "example.com/wp-content/uploads/2026/07/Temple-Entrance.jpg"
            ),
            Some(WordPressCaptionMatch::MatchedWithoutCaption)
        );
    }

    #[test]
    fn wordpress_caption_plain_text_strips_generated_more_link_suffix() {
        assert_eq!(
            wordpress_caption_plain_text(
                r#"<p>Tranh lụa về Phục Hy thời nhà Tống &hellip;
                    <a class="more-link" href="https://example.com/attachment/">
                        More <span class="screen-reader-text">attachment filename</span>
                    </a></p>"#,
            ),
            Some("Tranh lụa về Phục Hy thời nhà Tống".to_string())
        );
    }

    #[test]
    fn wordpress_caption_plain_text_preserves_legitimate_links_and_ellipses() {
        assert_eq!(
            wordpress_caption_plain_text(
                r#"<p>A deliberate ending… <a href="https://example.com/more">More context</a></p>"#,
            ),
            Some("A deliberate ending… More context".to_string())
        );
        assert_eq!(
            wordpress_caption_plain_text(
                r#"<p>Read <a class="more-link" href="https://example.com/details">more details</a> before continuing.</p>"#,
            ),
            Some("Read more details before continuing.".to_string())
        );
    }

    #[test]
    fn wordpress_caption_enrichment_replaces_old_caption_but_rejects_newer_edits() {
        let row: StoredRowFile = serde_json::from_value(json!({
            "row_id": "row-1",
            "structure": { "order_key": "0001" },
            "status": { "review_state": "draft" },
            "origin": { "source_row_number": 1 },
            "fields": {
                "vi": {
                    "plain_text": "",
                    "image_caption": "Previous image caption",
                    "image": {
                        "kind": "url",
                        "url": "https://example.com/wp-content/uploads/new.jpg"
                    }
                }
            }
        }))
        .expect("stored row should decode");

        assert!(wordpress_caption_enrichment_is_current(
            &row,
            "vi",
            "https://example.com/wp-content/uploads/new.jpg",
            "Previous image caption",
        ));
        assert!(!wordpress_caption_enrichment_is_current(
            &row,
            "vi",
            "https://example.com/wp-content/uploads/new.jpg",
            "Newer user caption",
        ));
        assert!(!wordpress_caption_enrichment_is_current(
            &row,
            "vi",
            "https://example.com/wp-content/uploads/replaced.jpg",
            "Previous image caption",
        ));
    }

    #[test]
    fn restore_repo_file_snapshot_on_disk_restores_original_bytes() {
        let repo_path = temp_test_dir("snapshot-restores-bytes");
        let relative_path = "chapters/chapter-1/images/row-1-vi-upload/example.png";
        let absolute_path = repo_path.join(relative_path);

        write_binary_file(&absolute_path, b"original").expect("original file should be written");
        let snapshot = capture_repo_file_snapshot(&repo_path, relative_path)
            .expect("snapshot should be captured");

        write_binary_file(&absolute_path, b"changed").expect("changed file should be written");
        restore_repo_file_snapshot_on_disk(&repo_path, &snapshot)
            .expect("snapshot should restore bytes");

        assert_eq!(
            fs::read(&absolute_path).expect("file should exist"),
            b"original"
        );

        let _ = fs::remove_dir_all(&repo_path);
    }

    #[test]
    fn restore_repo_file_snapshot_on_disk_removes_new_files_when_they_were_originally_missing() {
        let repo_path = temp_test_dir("snapshot-removes-new-file");
        let relative_path = "chapters/chapter-1/images/row-1-vi-upload/example.png";
        let absolute_path = repo_path.join(relative_path);

        let snapshot = capture_repo_file_snapshot(&repo_path, relative_path)
            .expect("snapshot should be captured");

        write_binary_file(&absolute_path, b"created").expect("new file should be written");
        restore_repo_file_snapshot_on_disk(&repo_path, &snapshot)
            .expect("snapshot should remove new file");

        assert!(!absolute_path.exists(), "new file should be removed");
        assert!(
            !absolute_path
                .parent()
                .expect("upload directory should exist")
                .exists(),
            "empty upload directory should be removed"
        );

        let _ = fs::remove_dir_all(&repo_path);
    }

    #[test]
    fn uploaded_image_validation_rejects_svg() {
        let svg = br#"<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>"#;
        assert_eq!(detected_uploaded_image_extension(svg), None);
        assert!(validated_uploaded_image_extension("drawing.svg", svg).is_err());
    }

    #[test]
    fn uploaded_image_validation_accepts_png_magic_bytes() {
        let png = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0];
        assert_eq!(detected_uploaded_image_extension(&png), Some("png"));
    }

    #[test]
    fn relative_uploaded_image_path_uses_flat_chapter_image_folder() {
        let repo_path = temp_test_dir("relative-uploaded-image-path");
        let chapter_path = repo_path.join("chapters/chapter-1");
        fs::create_dir_all(chapter_path.join("images")).expect("create images folder");
        let relative_path =
            relative_uploaded_image_path(&repo_path, &chapter_path, "original photo.png", "png")
                .expect("relative path should allocate");

        assert_eq!(
            relative_path,
            "chapters/chapter-1/images/original-photo.png"
        );
        let _ = fs::remove_dir_all(repo_path);
    }

    #[test]
    fn relative_uploaded_image_path_resolves_duplicate_names_in_chapter_image_folder() {
        let repo_path = temp_test_dir("relative-uploaded-image-path-duplicates");
        let chapter_path = repo_path.join("chapters/chapter-1");
        fs::create_dir_all(chapter_path.join("images")).expect("create images folder");
        fs::write(chapter_path.join("images/original-photo.png"), b"existing")
            .expect("write existing image");
        let relative_path =
            relative_uploaded_image_path(&repo_path, &chapter_path, "original photo.png", "png")
                .expect("relative path should allocate");

        assert_eq!(
            relative_path,
            "chapters/chapter-1/images/original-photo-2.png"
        );
        let _ = fs::remove_dir_all(repo_path);
    }

    #[test]
    fn shared_upload_is_retained_while_another_language_in_the_row_references_it() {
        let repo_path = temp_test_dir("shared-upload-row-reference");
        let path = "chapters/chapter-1/images/shared.png";
        let updated_row = stored_row_with_uploaded_images("row-1", &[("es", path)]);

        let removable = unreferenced_uploaded_paths_after_row_updates(
            &repo_path,
            &[path.to_string()],
            &BTreeMap::from([(
                "chapters/chapter-1/rows/row-1.json".to_string(),
                Some(updated_row),
            )]),
        )
        .expect("reference check should succeed");

        assert!(removable.is_empty());
        let _ = fs::remove_dir_all(repo_path);
    }

    #[test]
    fn final_release_uses_project_rows_as_a_cross_row_safeguard() {
        let repo_path = temp_test_dir("shared-upload-cross-row-reference");
        let path = "chapters/chapter-1/images/shared.png";
        let rows_path = repo_path.join("chapters/chapter-1/rows");
        fs::create_dir_all(&rows_path).expect("create rows folder");
        fs::write(
            rows_path.join("row-2.json"),
            serde_json::to_vec_pretty(&stored_row_with_uploaded_images("row-2", &[("en", path)]))
                .expect("serialize row"),
        )
        .expect("write second row");
        let updated_row = stored_row_with_uploaded_images("row-1", &[]);

        let retained = unreferenced_uploaded_paths_after_row_updates(
            &repo_path,
            &[path.to_string()],
            &BTreeMap::from([(
                "chapters/chapter-1/rows/row-1.json".to_string(),
                Some(updated_row),
            )]),
        )
        .expect("cross-row reference check should succeed");
        assert!(retained.is_empty());

        fs::remove_file(rows_path.join("row-2.json")).expect("remove second row");
        let removable = unreferenced_uploaded_paths_after_row_updates(
            &repo_path,
            &[path.to_string()],
            &BTreeMap::from([(
                "chapters/chapter-1/rows/row-1.json".to_string(),
                Some(stored_row_with_uploaded_images("row-1", &[])),
            )]),
        )
        .expect("final reference check should succeed");
        assert_eq!(removable, vec![path.to_string()]);

        let _ = fs::remove_dir_all(repo_path);
    }

    #[test]
    fn uploaded_path_identity_collapses_dot_segments_and_redundant_separators() {
        let repo_path = temp_test_dir("canonical-upload-reference");
        let canonical = "chapters/chapter-1/images/shared.png";
        let updated_row = stored_row_with_uploaded_images("row-1", &[("es", canonical)]);

        let removable = unreferenced_uploaded_paths_after_row_updates(
            &repo_path,
            &["./chapters//chapter-1/images/./shared.png".to_string()],
            &BTreeMap::from([(
                "chapters/chapter-1/rows/row-1.json".to_string(),
                Some(updated_row),
            )]),
        )
        .expect("aliased path should validate");

        assert!(removable.is_empty());
        let _ = fs::remove_dir_all(repo_path);
    }

    #[test]
    fn uploaded_path_validation_rejects_cross_root_and_traversal_paths() {
        let repo_path = temp_test_dir("reject-upload-paths");

        assert!(validated_uploaded_asset_relative_path(&repo_path, "README.md").is_err());
        assert!(validated_uploaded_asset_relative_path(
            &repo_path,
            "chapters/chapter-1/images/../../chapter.json"
        )
        .is_err());
        assert!(validated_uploaded_asset_relative_path(
            &repo_path,
            "/chapters/chapter-1/images/photo.png"
        )
        .is_err());

        let _ = fs::remove_dir_all(repo_path);
    }

    #[test]
    fn malformed_remaining_upload_reference_aborts_asset_release() {
        let repo_path = temp_test_dir("malformed-upload-reference");
        let candidate = "chapters/chapter-1/images/photo.png";
        let updated_row = stored_row_with_uploaded_images(
            "row-1",
            &[("es", "chapters/chapter-1/images/../images/photo.png")],
        );

        let result = unreferenced_uploaded_paths_after_row_updates(
            &repo_path,
            &[candidate.to_string()],
            &BTreeMap::from([(
                "chapters/chapter-1/rows/row-1.json".to_string(),
                Some(updated_row),
            )]),
        );

        assert!(result.is_err());
        let _ = fs::remove_dir_all(repo_path);
    }

    #[cfg(unix)]
    #[test]
    fn uploaded_path_validation_rejects_symbolic_link_escapes() {
        use std::os::unix::fs::symlink;

        let repo_path = temp_test_dir("reject-upload-symlink");
        let outside_path = temp_test_dir("outside-upload-symlink");
        fs::create_dir_all(repo_path.join("chapters/chapter-1")).expect("create chapter");
        symlink(&outside_path, repo_path.join("chapters/chapter-1/images"))
            .expect("create image-folder symlink");

        assert!(validated_uploaded_asset_relative_path(
            &repo_path,
            "chapters/chapter-1/images/photo.png"
        )
        .is_err());

        let _ = fs::remove_dir_all(repo_path);
        let _ = fs::remove_dir_all(outside_path);
    }

    #[test]
    fn duplicate_plan_preserves_captions_and_releases_only_the_old_destination() {
        let source_path = "chapters/chapter-1/images/source.png";
        let destination_path = "chapters/chapter-1/images/destination.png";
        let original = serde_json::to_string_pretty(&json!({
            "row_id": "row-1",
            "structure": { "order_key": "0001" },
            "status": { "review_state": "draft" },
            "origin": { "source_row_number": 1 },
            "fields": {
                "vi": {
                    "plain_text": "",
                    "image_caption": "Source caption",
                    "image": { "kind": "upload", "path": source_path }
                },
                "es": {
                    "plain_text": "",
                    "image_caption": "Destination caption",
                    "image": { "kind": "upload", "path": destination_path }
                }
            }
        }))
        .expect("serialize row");

        let plan = plan_duplicate_editor_language_image(
            &original,
            "vi",
            "es",
            Some(stored_upload(source_path)),
            Some(stored_upload(destination_path)),
        )
        .expect("plan duplicate");
        let DuplicateImageRowPlan::Update {
            updated_row_file,
            release_candidates,
            ..
        } = plan
        else {
            panic!("expected an update plan");
        };

        assert_eq!(
            row_language_stored_image(&updated_row_file, "vi"),
            Some(stored_upload(source_path))
        );
        assert_eq!(
            row_language_stored_image(&updated_row_file, "es"),
            Some(stored_upload(source_path))
        );
        assert_eq!(
            updated_row_file.fields["vi"].image_caption,
            "Source caption"
        );
        assert_eq!(
            updated_row_file.fields["es"].image_caption,
            "Destination caption"
        );
        assert_eq!(release_candidates, vec![destination_path.to_string()]);
    }

    #[test]
    fn duplicate_plan_fills_an_empty_destination_without_releasing_an_asset() {
        let source_path = "chapters/chapter-1/images/source.png";
        let row = stored_row_with_uploaded_images("row-1", &[("vi", source_path)]);
        let original = serde_json::to_string_pretty(&row).expect("serialize row");

        let plan = plan_duplicate_editor_language_image(
            &original,
            "vi",
            "es",
            Some(stored_upload(source_path)),
            None,
        )
        .expect("plan duplicate");
        let DuplicateImageRowPlan::Update {
            updated_row_file,
            release_candidates,
            ..
        } = plan
        else {
            panic!("expected an update plan");
        };

        assert_eq!(
            row_language_stored_image(&updated_row_file, "es"),
            Some(stored_upload(source_path))
        );
        assert!(release_candidates.is_empty());
    }

    #[test]
    fn duplicate_plan_reports_conflict_and_same_image_noop() {
        let path = "chapters/chapter-1/images/shared.png";
        let row = stored_row_with_uploaded_images("row-1", &[("vi", path), ("es", path)]);
        let original = serde_json::to_string_pretty(&row).expect("serialize row");

        assert!(matches!(
            plan_duplicate_editor_language_image(
                &original,
                "vi",
                "es",
                Some(stored_upload(path)),
                None,
            )
            .expect("plan conflict"),
            DuplicateImageRowPlan::Conflict(_)
        ));
        assert!(matches!(
            plan_duplicate_editor_language_image(
                &original,
                "vi",
                "es",
                Some(stored_upload(path)),
                Some(stored_upload(path)),
            )
            .expect("plan no-op"),
            DuplicateImageRowPlan::Unchanged(_)
        ));
    }

    #[test]
    fn image_mutation_commands_acquire_repo_lock_before_row_baselines() {
        let source = include_str!("images.rs");
        for function_name in [
            "save_gtms_editor_language_image_url_sync",
            "upload_gtms_editor_language_image_sync",
            "remove_gtms_editor_language_image_sync",
            "duplicate_gtms_editor_language_image_sync",
        ] {
            let start = source
                .find(&format!("fn {function_name}"))
                .expect("function should exist");
            let body = &source[start..];
            let lock = body
                .find("acquire_repo_sync_lock")
                .expect("command should acquire repo lock");
            let baseline = body
                .find("fs::read_to_string")
                .expect("command should read a row baseline");
            assert!(
                lock < baseline,
                "{function_name} must lock before reading its row baseline"
            );
        }
    }

    #[test]
    fn repository_lock_serializes_competing_image_mutations() {
        use std::{sync::mpsc, thread, time::Duration};

        let repo_path = temp_test_dir("image-repo-lock");
        let lock = crate::repo_sync_shared::repo_sync_lock(&repo_path);
        let guard = crate::repo_sync_shared::acquire_repo_sync_lock(&lock);
        let (sender, receiver) = mpsc::channel();
        let competing_lock = crate::repo_sync_shared::repo_sync_lock(&repo_path);
        let worker = thread::spawn(move || {
            let _guard = crate::repo_sync_shared::acquire_repo_sync_lock(&competing_lock);
            sender.send(()).expect("report lock acquisition");
        });

        assert!(receiver.recv_timeout(Duration::from_millis(50)).is_err());
        drop(guard);
        receiver
            .recv_timeout(Duration::from_secs(1))
            .expect("competing mutation should proceed after release");
        worker.join().expect("lock worker should finish");
        let _ = fs::remove_dir_all(repo_path);
    }

    #[test]
    fn duplicate_style_rollback_restores_row_and_released_asset() {
        let repo_path = temp_test_dir("duplicate-rollback");
        let row_path = "chapters/chapter-1/rows/row-1.json";
        let asset_path = "chapters/chapter-1/images/destination.png";
        write_binary_file(&repo_path.join(row_path), b"original row").expect("write row");
        write_binary_file(&repo_path.join(asset_path), b"original image").expect("write image");
        let mut snapshots = Vec::new();
        push_repo_file_snapshot(&mut snapshots, &repo_path, row_path).expect("snapshot row");
        push_uploaded_asset_snapshot(&mut snapshots, &repo_path, asset_path)
            .expect("snapshot image");

        let result: Result<(), String> = with_repo_file_rollback(&repo_path, &snapshots, || {
            write_binary_file(&repo_path.join(row_path), b"changed row")?;
            remove_uploaded_asset_from_disk(&repo_path, asset_path)?;
            Err("simulated commit failure".to_string())
        });

        assert!(result.is_err());
        assert_eq!(
            fs::read(repo_path.join(row_path)).expect("read restored row"),
            b"original row"
        );
        assert_eq!(
            fs::read(repo_path.join(asset_path)).expect("read restored image"),
            b"original image"
        );
        let _ = fs::remove_dir_all(repo_path);
    }
}
