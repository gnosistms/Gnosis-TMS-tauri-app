use std::time::Duration;
use std::{
    collections::{HashMap, HashSet},
    fs::File,
    io::Read,
    path::{Path, PathBuf},
};

use reqwest::blocking::Client;
use reqwest::header::LINK;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};
use url::Url;

use crate::{
    constants::WORDPRESS_EXPORT_PROGRESS_EVENT,
    project_import::fetch_public_image_dimensions,
    project_repo_paths::resolve_project_git_repo_path,
    wordpress::client::{WordPressSite, WORDPRESS_RECONNECT_MESSAGE},
    wordpress::debug::wordpress_debug_log,
    wordpress::image_cache::{
        remove_cached_site, CachedWordPressImage, WordPressImageCacheKey,
        WordPressImageCacheSession,
    },
    wordpress::storage::{
        forget_wordpress_connection as forget_saved_wordpress_connection,
        list_wordpress_connections as list_saved_wordpress_connections, load_wordpress_connection,
        save_wordpress_connection, WordPressConnection, WordPressConnectionInfo,
    },
};

// Cap uploaded-image reads so a corrupt or oversized repo file cannot buffer an
// unbounded body into memory during export (matches the chapter export cap).
const MAX_WORDPRESS_IMAGE_BYTES: u64 = 25 * 1024 * 1024;

// Display-only cap so a full post image fits a typical screen without
// scrolling. Only the block's display size is set — the uploaded media file
// keeps its full resolution.
const MAX_WORDPRESS_IMAGE_DISPLAY_HEIGHT_PX: u64 = 750;
const WORDPRESS_POST_LIST_BASE_PATH: &str = concat!(
    "posts?per_page=20&context=edit&status=publish,future,draft,pending,private",
    "&_fields=id,title,status,link,modified",
);

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WordPressFootnoteInput {
    id: String,
    content: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WordPressExportInput {
    storage_login: String,
    site_id: String,
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
    #[serde(default)]
    refresh_wordpress_images: bool,
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
    post_id: Option<u64>,
    post_title: Option<String>,
    post_status: Option<String>,
    post_edit_link: Option<String>,
    error_code: Option<&'static str>,
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
pub(crate) async fn list_wordpress_connections(
    app: AppHandle,
    storage_login: String,
) -> Result<Vec<WordPressConnectionInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        list_saved_wordpress_connections(&app, &storage_login)
    })
    .await
    .map_err(|error| format!("Could not read the WordPress connections: {error}"))?
}

#[tauri::command]
pub(crate) async fn forget_wordpress_connection(
    app: AppHandle,
    storage_login: String,
    site_id: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        forget_saved_wordpress_connection(&app, &storage_login, &site_id)?;
        if let Err(error) = remove_cached_site(&app, site_id.trim()) {
            wordpress_debug_log(&format!(
                "could not clear forgotten site's image cache: {error}"
            ));
        }
        Ok(())
    })
    .await
    .map_err(|error| format!("Could not forget the WordPress connection: {error}"))?
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WordPressSiteInspection {
    kind: &'static str,
    site_url: String,
    display_name: String,
    blog_id: Option<String>,
    api_root: Option<String>,
}

#[tauri::command]
pub(crate) async fn inspect_wordpress_site(
    site_url: String,
) -> Result<WordPressSiteInspection, String> {
    tauri::async_runtime::spawn_blocking(move || inspect_wordpress_site_blocking(&site_url))
        .await
        .map_err(|error| format!("Could not inspect the WordPress site: {error}"))?
}

#[tauri::command]
pub(crate) async fn save_self_hosted_wordpress_connection(
    app: AppHandle,
    storage_login: String,
    site_url: String,
    api_root: String,
    username: String,
    password: String,
    allow_insecure: bool,
) -> Result<WordPressConnectionInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let site_url_parsed = parse_http_url(&site_url)?;
        let api_root_parsed = parse_http_url(&api_root)?;
        if site_url_parsed.host_str() != api_root_parsed.host_str()
            || site_url_parsed.port_or_known_default() != api_root_parsed.port_or_known_default()
        {
            return Err("The discovered WordPress API uses a different origin. Enter that site address directly before sending credentials.".to_string());
        }
        if (site_url_parsed.scheme() == "http" || api_root_parsed.scheme() == "http") && !allow_insecure {
            return Err("Confirm that you want to send WordPress credentials over unencrypted HTTP.".to_string());
        }
        if username.trim().is_empty() || password.is_empty() {
            return Err("Enter the WordPress username and password.".to_string());
        }
        let display_name = discover_self_hosted_name(&api_root_parsed).unwrap_or_default();
        let connection = WordPressConnection::self_hosted(
            site_url_parsed.to_string(), display_name, api_root_parsed.to_string(), username, password,
        );
        let site = WordPressSite::from_connection(&connection)?;
        let client = wordpress_http_client()?;
        let user = site.get_json(&client, "users/me?context=edit")
            .map_err(|error| error.trim_start_matches("WORDPRESS_REAUTH_REQUIRED: ").to_string())?;
        let capabilities = user.get("capabilities").and_then(|value| value.as_object());
        let can_edit = capabilities.and_then(|items| items.get("edit_posts"))
            .and_then(|value| value.as_bool()).unwrap_or(false);
        let can_upload = capabilities.and_then(|items| items.get("upload_files"))
            .and_then(|value| value.as_bool()).unwrap_or(false);
        if !can_edit || !can_upload {
            return Err("This WordPress user must be allowed to edit posts and upload files.".to_string());
        }
        save_wordpress_connection(&app, &storage_login, &connection)?;
        Ok(connection.info())
    })
    .await
    .map_err(|error| format!("Could not connect the self-hosted WordPress site: {error}"))?
}

fn parse_http_url(value: &str) -> Result<Url, String> {
    let with_scheme = if value.trim().contains("://") {
        value.trim().to_string()
    } else {
        format!("https://{}", value.trim())
    };
    let url = Url::parse(&with_scheme)
        .map_err(|_| "Enter a valid WordPress site address.".to_string())?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("Enter an HTTP or HTTPS WordPress site address.".to_string());
    }
    Ok(url)
}

fn inspect_wordpress_site_blocking(value: &str) -> Result<WordPressSiteInspection, String> {
    let site_url = parse_http_url(value)?;
    let client = Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("Could not create the WordPress discovery client: {error}"))?;
    if let Some(host) = site_url.host_str() {
        let lookup = wordpress_com_site_lookup_url(host)?;
        if let Ok(response) = client
            .get(lookup)
            .header("Accept", "application/json")
            .send()
        {
            if response.status().is_success() {
                if let Ok(payload) = response.json::<serde_json::Value>() {
                    if let Some(blog_id) = payload.get("ID").and_then(|value| value.as_u64()) {
                        return Ok(WordPressSiteInspection {
                            kind: "wordpressCom",
                            site_url: payload
                                .get("URL")
                                .and_then(|value| value.as_str())
                                .unwrap_or(site_url.as_str())
                                .trim_end_matches('/')
                                .to_string(),
                            display_name: payload
                                .get("name")
                                .and_then(|value| value.as_str())
                                .unwrap_or_default()
                                .to_string(),
                            blog_id: Some(blog_id.to_string()),
                            api_root: None,
                        });
                    }
                }
            }
        }
    }

    let api_root = discover_wordpress_api_root(&client, &site_url)?;
    let display_name = discover_self_hosted_name(&api_root).unwrap_or_default();
    Ok(WordPressSiteInspection {
        kind: "selfHosted",
        site_url: site_url.to_string().trim_end_matches('/').to_string(),
        display_name,
        blog_id: None,
        api_root: Some(api_root.to_string().trim_end_matches('/').to_string()),
    })
}

fn wordpress_com_site_lookup_url(host: &str) -> Result<Url, String> {
    let mut lookup = Url::parse("https://public-api.wordpress.com/rest/v1.1/sites/")
        .map_err(|error| format!("Could not build the WordPress.com discovery URL: {error}"))?;
    lookup
        .path_segments_mut()
        .map_err(|_| "Could not build the WordPress.com discovery URL.".to_string())?
        .pop_if_empty()
        .push(host);
    Ok(lookup)
}

fn discover_wordpress_api_root(client: &Client, site_url: &Url) -> Result<Url, String> {
    if let Ok(response) = client.head(site_url.clone()).send() {
        for value in response.headers().get_all(LINK) {
            if let Ok(value) = value.to_str() {
                for part in value.split(',') {
                    if part.contains("rel=\"https://api.w.org/\"") {
                        if let (Some(start), Some(end)) = (part.find('<'), part.find('>')) {
                            if let Ok(url) = Url::parse(&part[start + 1..end]) {
                                return Ok(url);
                            }
                        }
                    }
                }
            }
        }
    }
    let mut base = site_url.clone();
    if !base.path().ends_with('/') {
        base.set_path(&format!("{}/", base.path()));
    }
    for candidate in [base.join("wp-json/").ok(), {
        let mut route = base.clone();
        route.set_query(Some("rest_route=/"));
        Some(route)
    }]
    .into_iter()
    .flatten()
    {
        if let Ok(response) = client
            .get(candidate.clone())
            .header("Accept", "application/json")
            .send()
        {
            if response.status().is_success() {
                if let Ok(payload) = response.json::<serde_json::Value>() {
                    if payload
                        .get("namespaces")
                        .and_then(|value| value.as_array())
                        .is_some_and(|items| {
                            items.iter().any(|item| item.as_str() == Some("wp/v2"))
                        })
                    {
                        return Ok(candidate);
                    }
                }
            }
        }
    }
    Err("Could not discover a WordPress REST API at that address.".to_string())
}

fn discover_self_hosted_name(api_root: &Url) -> Option<String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .ok()?;
    let payload = client
        .get(api_root.clone())
        .header("Accept", "application/json")
        .send()
        .ok()?
        .json::<serde_json::Value>()
        .ok()?;
    payload
        .get("name")
        .and_then(|value| value.as_str())
        .map(str::to_string)
}

#[tauri::command]
pub(crate) async fn search_wordpress_posts(
    app: AppHandle,
    storage_login: String,
    site_id: String,
    search: String,
) -> Result<Vec<WordPressPostSummary>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let connection = require_wordpress_connection(&app, &storage_login, &site_id)?;
        let site = WordPressSite::from_connection(&connection)?;
        let client = wordpress_http_client()?;

        let path = wordpress_post_search_path(&search, &connection);

        let response = site.get_json(&client, &path)?;
        let posts = response
            .as_array()
            .ok_or_else(|| "Could not parse the WordPress post list.".to_string())?;
        Ok(posts.iter().map(post_summary_from_json).collect())
    })
    .await
    .map_err(|error| format!("Could not run the WordPress post search: {error}"))?
}

enum WordPressPostSearchTarget {
    PostId(u64),
    Slug(String),
}

fn wordpress_post_search_path(search: &str, connection: &WordPressConnection) -> String {
    let trimmed = search.trim();
    let mut path = WORDPRESS_POST_LIST_BASE_PATH.to_string();
    match wordpress_post_search_target_from_url(trimmed, connection) {
        Some(WordPressPostSearchTarget::PostId(post_id)) => {
            append_encoded_query_param(&mut path, "include", &post_id.to_string());
            append_wordpress_recent_order(&mut path);
        }
        Some(WordPressPostSearchTarget::Slug(slug)) => {
            append_encoded_query_param(&mut path, "slug", &slug);
            append_wordpress_recent_order(&mut path);
        }
        None if !trimmed.is_empty() => {
            // Some WordPress/MySQL collations do not case-fold Vietnamese
            // characters such as Ư/ư and Ơ/ơ. WordPress can therefore return
            // no results for an uppercase title even though the same lowercase
            // query finds it. Normalize plain-text searches before sending them;
            // URL-derived ID and slug lookups above must remain unchanged.
            append_encoded_query_param(&mut path, "search", &trimmed.to_lowercase());
            // Explicit modified-date ordering hides relevant older posts when
            // more than 20 newer post bodies contain a common search term.
            append_encoded_query_param(&mut path, "orderby", "relevance");
        }
        None => append_wordpress_recent_order(&mut path),
    }
    path
}

fn append_wordpress_recent_order(path: &mut String) {
    append_encoded_query_param(path, "orderby", "modified");
    append_encoded_query_param(path, "order", "desc");
}

fn append_encoded_query_param(path: &mut String, key: &str, value: &str) {
    path.push('&');
    path.push_str(key);
    path.push('=');
    path.push_str(&url::form_urlencoded::byte_serialize(value.as_bytes()).collect::<String>());
}

fn wordpress_post_search_target_from_url(
    search: &str,
    connection: &WordPressConnection,
) -> Option<WordPressPostSearchTarget> {
    let parsed = Url::parse(search).ok()?;
    let host = parsed.host_str()?;
    if host_matches_wordpress_com(host) {
        if let Some(post_id) = wordpress_com_editor_post_id(&parsed, connection) {
            return Some(WordPressPostSearchTarget::PostId(post_id));
        }
    }
    if !url_host_matches_connection(&parsed, connection) {
        return None;
    }
    if let Some(post_id) = wordpress_post_id_from_query(&parsed) {
        return Some(WordPressPostSearchTarget::PostId(post_id));
    }
    wordpress_slug_from_permalink(&parsed).map(WordPressPostSearchTarget::Slug)
}

fn host_matches_wordpress_com(host: &str) -> bool {
    normalized_host(host) == "wordpress.com"
}

fn url_host_matches_connection(url: &Url, connection: &WordPressConnection) -> bool {
    let Some(input_host) = url.host_str() else {
        return false;
    };
    let Ok(site_url) = Url::parse(connection.site_url.trim()) else {
        return false;
    };
    let Some(site_host) = site_url.host_str() else {
        return false;
    };
    normalized_host(input_host) == normalized_host(site_host)
}

fn normalized_host(host: &str) -> String {
    let lower = host.trim().trim_end_matches('.').to_ascii_lowercase();
    lower.trim_start_matches("www.").to_string()
}

fn wordpress_com_editor_post_id(url: &Url, connection: &WordPressConnection) -> Option<u64> {
    let segments: Vec<&str> = url.path_segments()?.collect();
    if segments.len() < 3 || segments.first()? != &"post" {
        return None;
    }
    if segments.get(1)?.trim() != connection.blog_id()?.trim() {
        return None;
    }
    parse_positive_u64(segments.get(2)?)
}

fn wordpress_post_id_from_query(url: &Url) -> Option<u64> {
    url.query_pairs()
        .find_map(|(key, value)| match key.as_ref() {
            "p" | "post" | "post_id" => parse_positive_u64(value.as_ref()),
            _ => None,
        })
}

fn wordpress_slug_from_permalink(url: &Url) -> Option<String> {
    let segment = url
        .path_segments()?
        .rfind(|segment| !segment.trim().is_empty())?;
    let slug = percent_decode_path_segment(segment).trim().to_string();
    if slug.is_empty() {
        None
    } else {
        Some(slug)
    }
}

fn parse_positive_u64(value: &str) -> Option<u64> {
    let parsed = value.trim().parse::<u64>().ok()?;
    (parsed > 0).then_some(parsed)
}

fn percent_decode_path_segment(segment: &str) -> String {
    let bytes = segment.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let (Some(high), Some(low)) = (
                char::from(bytes[index + 1]).to_digit(16),
                char::from(bytes[index + 2]).to_digit(16),
            ) {
                decoded.push(((high << 4) + low) as u8);
                index += 3;
                continue;
            }
        }
        decoded.push(bytes[index]);
        index += 1;
    }
    String::from_utf8(decoded).unwrap_or_else(|_| segment.to_string())
}

/// Validates input, then runs the export in a background task. The IPC call
/// returns immediately; all progress and the final outcome are delivered via
/// `wordpress-export-progress` events keyed by `jobId`.
#[tauri::command]
pub(crate) async fn export_chapter_to_wordpress(
    app: AppHandle,
    input: WordPressExportInput,
) -> Result<(), String> {
    if input.storage_login.trim().is_empty() || input.site_id.trim().is_empty() {
        return Err("Choose a connected WordPress site first.".to_string());
    }
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
            Ok(outcome) => {
                wordpress_debug_log(&format!(
                    "export succeeded: link={} id={:?}",
                    outcome.post_link, outcome.post_id
                ));
                emit_export_progress(
                    &app,
                    WordPressExportProgressPayload {
                        job_id,
                        status: "success",
                        message: outcome.message,
                        current: None,
                        total: None,
                        post_link: Some(outcome.post_link),
                        post_id: outcome.post_id,
                        post_title: outcome.post_title,
                        post_status: outcome.post_status,
                        post_edit_link: outcome.post_edit_link,
                        error_code: None,
                    },
                )
            }
            Err(error) => {
                wordpress_debug_log(&format!("export failed: {error}"));
                let reauth_required = error.contains("WORDPRESS_REAUTH_REQUIRED:");
                let message = error.replace("WORDPRESS_REAUTH_REQUIRED: ", "");
                emit_export_progress(
                    &app,
                    WordPressExportProgressPayload {
                        job_id,
                        status: "error",
                        message,
                        current: None,
                        total: None,
                        post_link: None,
                        post_id: None,
                        post_title: None,
                        post_status: None,
                        post_edit_link: None,
                        error_code: reauth_required.then_some("reauthRequired"),
                    },
                )
            }
        }
    });

    Ok(())
}

struct WordPressExportOutcome {
    message: String,
    post_link: String,
    post_id: Option<u64>,
    post_title: Option<String>,
    post_status: Option<String>,
    post_edit_link: Option<String>,
}

fn run_wordpress_export(
    app: &AppHandle,
    input: WordPressExportInput,
) -> Result<WordPressExportOutcome, String> {
    let connection = require_wordpress_connection(app, &input.storage_login, &input.site_id)?;
    let site = WordPressSite::from_connection(&connection)?;
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

        let mut prepared_local_images = HashMap::new();
        let mut cache_keys = HashMap::new();
        for source in &image_sources {
            if is_local_image_source(source) {
                let repo_path = repo_path
                    .as_ref()
                    .ok_or_else(|| "The local project repo is not available yet.".to_string())?;
                let prepared = prepare_repo_image(repo_path, source)?;
                cache_keys.insert(source.clone(), prepared.cache_key.clone());
                prepared_local_images.insert(source.clone(), prepared);
            } else if let Some(cache_key) =
                wordpress_remote_image_cache_key(source, &connection.site_url)
            {
                cache_keys.insert(source.clone(), cache_key);
            }
        }

        let mut image_cache = match WordPressImageCacheSession::open(app, &input.site_id) {
            Ok(cache) => cache,
            Err(error) => {
                wordpress_debug_log(&format!(
                    "WordPress image cache could not be opened; continuing uncached: {error}"
                ));
                WordPressImageCacheSession::unavailable(&input.site_id)
            }
        };
        let mut validated_images = HashMap::new();
        if !input.refresh_wordpress_images {
            let candidate_keys = cache_keys.values().cloned().collect::<HashSet<_>>();
            let candidates = candidate_keys
                .into_iter()
                .filter_map(|cache_key| {
                    image_cache
                        .get(&cache_key)
                        .cloned()
                        .map(|cached| (cache_key, cached))
                })
                .collect::<Vec<_>>();
            let attachment_ids = candidates
                .iter()
                .map(|(_, cached)| cached.attachment_id)
                .collect::<HashSet<_>>();
            if !attachment_ids.is_empty() {
                emit_export_progress(
                    app,
                    WordPressExportProgressPayload {
                        job_id: input.job_id.clone(),
                        status: "progress",
                        message: format!(
                            "Checking {} cached image{}...",
                            attachment_ids.len(),
                            if attachment_ids.len() == 1 { "" } else { "s" }
                        ),
                        current: None,
                        total: Some(total),
                        post_link: None,
                        post_id: None,
                        post_title: None,
                        post_status: None,
                        post_edit_link: None,
                        error_code: None,
                    },
                );
                match fetch_and_reconcile_cached_media(candidates, |attachment_ids| {
                    fetch_current_media_by_ids(&site, &client, attachment_ids)
                }) {
                    Ok(reconciliation) => {
                        for cache_key in reconciliation.stale_keys {
                            image_cache.remove(&cache_key);
                        }
                        for (cache_key, current) in reconciliation.validated {
                            cache_uploaded_wordpress_image(
                                &mut image_cache,
                                cache_key.clone(),
                                &current,
                            );
                            validated_images.insert(cache_key, current);
                        }
                    }
                    Err(error) => wordpress_debug_log(&format!(
                        "cached WordPress media validation failed; falling back to verified per-image lookup: {error}"
                    )),
                }
            }
        }

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
                    post_id: None,
                    post_title: None,
                    post_status: None,
                    post_edit_link: None,
                    error_code: None,
                },
            );

            if is_local_image_source(source) {
                wordpress_debug_log(&format!(
                    "uploading image {} of {total}: {source}",
                    index + 1
                ));
                let prepared = prepared_local_images.remove(source).ok_or_else(|| {
                    format!("Could not prepare the local image '{source}' for export.")
                })?;
                ensure_prepared_repo_image_unchanged(&prepared, source)?;
                let cache_key = prepared.cache_key.clone();
                let uploaded = validated_image_or_else(
                    input.refresh_wordpress_images,
                    Some(&cache_key),
                    &validated_images,
                    || {
                        upload_repo_image(&site, &client, source, prepared, &mut image_cache)
                            .map(Some)
                    },
                )?
                .ok_or_else(|| format!("Could not resolve the local image '{source}'."))?;
                wordpress_debug_log(&format!(
                    "image resolved: {source} -> {} natural={:?}x{:?}",
                    uploaded.source_url, uploaded.natural_width, uploaded.natural_height,
                ));
                content = apply_uploaded_image_to_content(&content, source, &uploaded);
                continue;
            }

            // A URL that points back into the connected site's Media Library is
            // still an attachment, even though there is nothing to upload. Keep
            // its attachment ID in the block so WordPress can generate srcset and
            // sizes attributes (including Retina-resolution candidates).
            if let Some(lookup) =
                wordpress_media_lookup_for_site_source(source, &connection.site_url)
            {
                let cache_key = wordpress_remote_image_cache_key(source, &connection.site_url);
                let media = resolve_remote_image_with_cache(
                    input.refresh_wordpress_images,
                    cache_key.as_ref(),
                    &validated_images,
                    &mut image_cache,
                    || {
                        find_site_media_by_source(&site, &client, &lookup, source).map_err(|error| {
                            format!(
                                "Could not verify the WordPress Media Library image '{source}' before export: {error}"
                            )
                        })
                    },
                )?;
                if let Some(media) = media {
                    wordpress_debug_log(&format!(
                        "resolved remote media attachment for {source}: id={:?}",
                        media.attachment_id,
                    ));
                    content = apply_uploaded_image_to_content(&content, source, &media);
                    continue;
                }
            }

            // Unrelated remote URL image: nothing to upload, but tall images
            // still get a display size. A failed fetch only skips the sizing.
            let dimensions = fetch_public_image_dimensions(&decode_html_entities(source));
            wordpress_debug_log(&format!("remote image {source} natural={dimensions:?}"));
            if let Some((natural_width, natural_height)) = dimensions {
                let natural = (natural_width as u64, natural_height as u64);
                if let Some((display_width, _)) = wordpress_display_size(natural.0, natural.1) {
                    content =
                        resize_image_block(&content, source, source, display_width, natural, None);
                }
            }
        }

        if let Err(error) = image_cache.commit() {
            wordpress_debug_log(&format!(
                "WordPress image cache commit failed; export still continues: {error}"
            ));
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
            post_id: None,
            post_title: None,
            post_status: None,
            post_edit_link: None,
            error_code: None,
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
    let post_title = response
        .pointer("/title/raw")
        .and_then(|value| value.as_str())
        .map(str::to_string)
        .or_else(|| {
            response
                .pointer("/title/rendered")
                .and_then(|value| value.as_str())
                .map(decode_html_entities)
        });
    let message = if input.mode == "create" {
        "Created a new WordPress draft.".to_string()
    } else {
        "Overwrote the WordPress post.".to_string()
    };
    let post_id = response.get("id").and_then(|value| value.as_u64());
    let post_status = response
        .get("status")
        .and_then(|value| value.as_str())
        .map(str::to_string);
    Ok(WordPressExportOutcome {
        message,
        post_link,
        post_id,
        post_title,
        post_status,
        post_edit_link: post_id.and_then(|id| wordpress_editor_link(&connection, id)),
    })
}

/// The WordPress.com editor URL for a post; works for both Simple and
/// Jetpack-connected sites reachable through the WordPress.com API.
fn wordpress_editor_link(connection: &WordPressConnection, post_id: u64) -> Option<String> {
    if let Some(blog_id) = connection.blog_id() {
        return Some(format!(
            "https://wordpress.com/post/{}/{post_id}",
            blog_id.trim()
        ));
    }
    let mut url = Url::parse(&format!(
        "{}/wp-admin/post.php",
        connection.site_url.trim_end_matches('/')
    ))
    .ok()?;
    url.query_pairs_mut()
        .append_pair("post", &post_id.to_string())
        .append_pair("action", "edit");
    Some(url.to_string())
}

fn require_wordpress_connection(
    app: &AppHandle,
    storage_login: &str,
    site_id: &str,
) -> Result<WordPressConnection, String> {
    load_wordpress_connection(app, storage_login, site_id)?
        .ok_or_else(|| format!("WORDPRESS_REAUTH_REQUIRED: {WORDPRESS_RECONNECT_MESSAGE}"))
}

fn wordpress_http_client() -> Result<Client, String> {
    Client::builder()
        .redirect(reqwest::redirect::Policy::none())
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

#[derive(Clone, Debug, PartialEq, Eq)]
struct UploadedWordPressImage {
    attachment_id: Option<u64>,
    source_url: String,
    natural_width: Option<u64>,
    natural_height: Option<u64>,
}

struct PreparedRepoImage {
    absolute_path: PathBuf,
    file_len: u64,
    modified: Option<std::time::SystemTime>,
    original_name: String,
    mime_type: &'static str,
    content_hash: String,
    cache_key: WordPressImageCacheKey,
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
/// its src attribute to display-sized markup: display width plus the natural
/// aspect ratio in the block attrs and inline style, with no fixed height.
/// The browser derives the height from the ratio, so a theme or viewport
/// that clamps the width (`max-width: 100%`) scales the image down
/// proportionally instead of distorting it. The img src is rewritten to
/// `new_src_attr` (both values in HTML-attribute escaped form). Handles the
/// current centered serializer markup and the pre-centering legacy shape;
/// content is returned unchanged for anything else.
fn resize_image_block(
    content: &str,
    source_attr: &str,
    new_src_attr: &str,
    display_width: u64,
    (natural_width, natural_height): (u64, u64),
    attachment_id: Option<u64>,
) -> String {
    // (plain block attrs, resized leading attrs, plain figure class, resized figure class)
    const BLOCK_VARIANTS: [(&str, &str, &str, &str); 2] = [
        (
            " {\"align\":\"center\"}",
            "\"align\":\"center\",",
            "wp-block-image aligncenter",
            "wp-block-image aligncenter is-resized",
        ),
        ("", "", "wp-block-image", "wp-block-image is-resized"),
    ];

    // The serializer emits the canonical Gutenberg `alt=""/>` form; the
    // spaced `alt="" />` variant covers content from older app versions.
    const IMG_TAIL_VARIANTS: [&str; 2] = ["alt=\"\"/>", "alt=\"\" />"];

    for (plain_attrs, resized_leading_attrs, plain_class, resized_class) in BLOCK_VARIANTS {
        for img_tail in IMG_TAIL_VARIANTS {
            let plain_block = format!(
                "<!-- wp:image{plain_attrs} -->\n<figure class=\"{plain_class}\"><img src=\"{source_attr}\" {img_tail}"
            );
            if !content.contains(&plain_block) {
                continue;
            }

            let attachment_block_attr = attachment_id
                .map(|id| format!("\"id\":{id},"))
                .unwrap_or_default();
            let attachment_img_class = attachment_id
                .map(|id| format!(" class=\"wp-image-{id}\""))
                .unwrap_or_default();
            let resized_block = format!(
                "<!-- wp:image {{{attachment_block_attr}{resized_leading_attrs}\"width\":\"{display_width}px\",\"aspectRatio\":\"{natural_width}/{natural_height}\"}} -->\n\
                 <figure class=\"{resized_class}\"><img src=\"{new_src_attr}\" alt=\"\"{attachment_img_class} style=\"aspect-ratio:{natural_width}/{natural_height};width:{display_width}px\"/>"
            );
            return content.replace(&plain_block, &resized_block);
        }
    }

    content.to_string()
}

/// Associates an otherwise plain serialized image block with a WordPress
/// attachment without changing its display size. Core's responsive-image filter
/// recognizes the `wp-image-{id}` class and can then add the attachment's srcset.
fn attach_image_block(
    content: &str,
    source_attr: &str,
    new_src_attr: &str,
    attachment_id: u64,
) -> String {
    const BLOCK_VARIANTS: [(&str, &str, &str); 2] = [
        (
            " {\"align\":\"center\"}",
            "{\"id\":ATTACHMENT_ID,\"align\":\"center\"}",
            "wp-block-image aligncenter",
        ),
        ("", "{\"id\":ATTACHMENT_ID}", "wp-block-image"),
    ];
    const IMG_TAIL_VARIANTS: [&str; 2] = ["alt=\"\"/>", "alt=\"\" />"];

    for (plain_attrs, attached_attrs_template, figure_class) in BLOCK_VARIANTS {
        for img_tail in IMG_TAIL_VARIANTS {
            let plain_block = format!(
                "<!-- wp:image{plain_attrs} -->\n<figure class=\"{figure_class}\"><img src=\"{source_attr}\" {img_tail}"
            );
            if !content.contains(&plain_block) {
                continue;
            }

            let attached_attrs =
                attached_attrs_template.replace("ATTACHMENT_ID", &attachment_id.to_string());
            let attached_block = format!(
                "<!-- wp:image {attached_attrs} -->\n<figure class=\"{figure_class}\"><img src=\"{new_src_attr}\" alt=\"\" class=\"wp-image-{attachment_id}\"/>"
            );
            return content.replace(&plain_block, &attached_block);
        }
    }

    content.to_string()
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
        if let Some((display_width, _)) = wordpress_display_size(natural_width, natural_height) {
            let resized = resize_image_block(
                content,
                source,
                &escape_html_attribute(&uploaded.source_url),
                display_width,
                (natural_width, natural_height),
                uploaded.attachment_id,
            );
            if resized != content {
                return resized;
            }
        }
    }

    if let Some(attachment_id) = uploaded.attachment_id {
        let attached = attach_image_block(
            content,
            source,
            &escape_html_attribute(&uploaded.source_url),
            attachment_id,
        );
        if attached != content {
            return attached;
        }
    }

    replace_image_source(content, source, &uploaded.source_url)
}

fn prepare_repo_image(repo_path: &Path, source: &str) -> Result<PreparedRepoImage, String> {
    let absolute_path = resolve_repo_image_path(repo_path, source)?;
    let metadata = std::fs::metadata(&absolute_path)
        .map_err(|_| format!("Could not find the uploaded image '{source}' in the project."))?;
    if metadata.len() > MAX_WORDPRESS_IMAGE_BYTES {
        return Err(format!("The image '{source}' is too large to upload."));
    }

    let original_name = absolute_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("image")
        .to_string();
    let (content_hash, header) = image_content_hash_and_header(&absolute_path, source)?;
    let mime_type = image_mime_type(&original_name, &header)
        .ok_or_else(|| format!("Could not determine the image type for '{source}'."))?;
    let cache_key = WordPressImageCacheKey::local(content_hash.clone());
    Ok(PreparedRepoImage {
        absolute_path,
        file_len: metadata.len(),
        modified: metadata.modified().ok(),
        original_name,
        mime_type,
        content_hash,
        cache_key,
    })
}

fn ensure_prepared_repo_image_unchanged(
    prepared: &PreparedRepoImage,
    source: &str,
) -> Result<(), String> {
    let metadata = std::fs::metadata(&prepared.absolute_path)
        .map_err(|_| format!("Could not find the uploaded image '{source}' in the project."))?;
    let changed = metadata.len() != prepared.file_len
        || prepared
            .modified
            .is_some_and(|modified| metadata.modified().ok() != Some(modified));
    if changed {
        return Err(format!(
            "The image '{source}' changed while preparing the WordPress export. Try exporting again."
        ));
    }
    Ok(())
}

fn upload_repo_image(
    site: &WordPressSite,
    client: &Client,
    source: &str,
    prepared: PreparedRepoImage,
    image_cache: &mut WordPressImageCacheSession,
) -> Result<UploadedWordPressImage, String> {
    // Content-address the media file: identical bytes always get the same slug, so a
    // copy already in the WordPress media library from an earlier export is reused
    // instead of uploaded again. Without this, every export added a fresh duplicate.
    let slug = content_addressed_media_slug_from_hash(&prepared.content_hash);
    if let Some(existing) = find_uploaded_media_by_slug(site, client, &slug)? {
        wordpress_debug_log(&format!(
            "reusing existing media for {source}: slug={slug} -> {}",
            existing.source_url
        ));
        cache_uploaded_wordpress_image(image_cache, prepared.cache_key, &existing);
        return Ok(existing);
    }

    wordpress_debug_log(&format!(
        "uploading new WordPress media for {source}: original={} slug={slug}",
        prepared.original_name
    ));
    let bytes = read_prepared_repo_image_bytes(&prepared, source)?;
    let file_name = format!("{slug}.{}", media_file_extension(prepared.mime_type));
    let response = site.upload_media(client, &file_name, prepared.mime_type, bytes)?;
    let source_url = response
        .get("source_url")
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .ok_or_else(|| "WordPress did not return a URL for the uploaded image.".to_string())?;
    let attachment_id = response
        .get("id")
        .and_then(|value| value.as_u64())
        .ok_or_else(|| {
            "WordPress did not return an attachment ID for the uploaded image.".to_string()
        })?;

    let uploaded = UploadedWordPressImage {
        attachment_id: Some(attachment_id),
        source_url,
        natural_width: response
            .pointer("/media_details/width")
            .and_then(|value| value.as_u64()),
        natural_height: response
            .pointer("/media_details/height")
            .and_then(|value| value.as_u64()),
    };
    cache_uploaded_wordpress_image(image_cache, prepared.cache_key, &uploaded);
    Ok(uploaded)
}

fn image_content_hash(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn image_content_hash_and_header(path: &Path, source: &str) -> Result<(String, Vec<u8>), String> {
    const HASH_BUFFER_BYTES: usize = 64 * 1024;
    const IMAGE_HEADER_BYTES: usize = 12;

    let mut file = File::open(path)
        .map_err(|error| format!("Could not read the uploaded image '{source}': {error}"))?;
    let mut hasher = Sha256::new();
    let mut header = Vec::with_capacity(IMAGE_HEADER_BYTES);
    let mut buffer = [0_u8; HASH_BUFFER_BYTES];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|error| format!("Could not read the uploaded image '{source}': {error}"))?;
        if count == 0 {
            break;
        }
        if header.len() < IMAGE_HEADER_BYTES {
            let remaining = IMAGE_HEADER_BYTES - header.len();
            header.extend_from_slice(&buffer[..count.min(remaining)]);
        }
        hasher.update(&buffer[..count]);
    }
    let content_hash = hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    Ok((content_hash, header))
}

fn read_prepared_repo_image_bytes(
    prepared: &PreparedRepoImage,
    source: &str,
) -> Result<Vec<u8>, String> {
    let bytes = std::fs::read(&prepared.absolute_path)
        .map_err(|error| format!("Could not read the uploaded image '{source}': {error}"))?;
    if bytes.len() as u64 > MAX_WORDPRESS_IMAGE_BYTES {
        return Err(format!("The image '{source}' is too large to upload."));
    }
    if image_content_hash(&bytes) != prepared.content_hash {
        return Err(format!(
            "The image '{source}' changed while preparing the WordPress export. Try exporting again."
        ));
    }
    Ok(bytes)
}

/// A stable, slug-safe name derived from the image bytes. WordPress turns an uploaded
/// file's name into the attachment slug, so a deterministic name lets a later export
/// find the same attachment. The WordPress-facing slug retains the existing 128-bit
/// prefix while the local cache uses the complete SHA-256 hash.
fn content_addressed_media_slug_from_hash(content_hash: &str) -> String {
    let prefix = content_hash.get(..32).unwrap_or(content_hash);
    format!("gnosis-tms-{prefix}")
}

fn cache_uploaded_wordpress_image(
    image_cache: &mut WordPressImageCacheSession,
    cache_key: WordPressImageCacheKey,
    uploaded: &UploadedWordPressImage,
) {
    let Some(attachment_id) = uploaded.attachment_id else {
        return;
    };
    let cached = CachedWordPressImage {
        attachment_id,
        source_url: uploaded.source_url.clone(),
        natural_width: uploaded.natural_width,
        natural_height: uploaded.natural_height,
    };
    image_cache.upsert(cache_key, cached);
}

fn media_file_extension(mime_type: &str) -> &'static str {
    match mime_type {
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/gif" => "gif",
        "image/webp" => "webp",
        _ => "img",
    }
}

struct WordPressMediaLookup {
    slug: String,
    search_terms: Vec<String>,
}

/// Builds an attachment lookup only when `source` can belong to the connected
/// site: its own uploads directory or a WordPress.com files CDN. Jetpack Image
/// CDN URLs encode the origin host as their first path segment, so normalize
/// those before classification. Exact URL verification after each API response
/// prevents a files-CDN URL from another site being attached accidentally.
fn wordpress_media_lookup_for_site_source(
    source: &str,
    blog_url: &str,
) -> Option<WordPressMediaLookup> {
    let (source_host, source_path) = wordpress_origin_image_identity(source)?;
    let blog = Url::parse(blog_url).ok()?;
    let blog_host = normalize_wordpress_host(blog.host_str()?);
    let same_site_upload = source_host == blog_host
        && source_path
            .to_ascii_lowercase()
            .contains("/wp-content/uploads/");
    let wordpress_files_cdn = source_host
        .strip_suffix(".files.wordpress.com")
        .is_some_and(|site_prefix| !site_prefix.is_empty() && !site_prefix.contains('.'));
    if !same_site_upload && !wordpress_files_cdn {
        return None;
    }
    let filename = source_path.rsplit('/').next()?;
    Some(WordPressMediaLookup {
        slug: wordpress_attachment_slug_candidate(filename)?,
        search_terms: wordpress_attachment_search_terms(filename)?,
    })
}

fn wordpress_attachment_slug_candidate(filename: &str) -> Option<String> {
    let decoded = percent_decode_utf8_lossy(filename);
    let stem = decoded
        .rsplit_once('.')
        .map(|(stem, _)| stem)
        .unwrap_or(decoded.as_str());
    let stem = wordpress_original_image_stem(stem);
    let mut slug = String::with_capacity(stem.len());
    let mut last_was_dash = false;
    for character in stem.chars().flat_map(char::to_lowercase) {
        if character.is_alphanumeric() || character == '_' {
            slug.push(character);
            last_was_dash = false;
        } else if (character == '-' || character.is_whitespace())
            && !slug.is_empty()
            && !last_was_dash
        {
            slug.push('-');
            last_was_dash = true;
        }
    }
    while slug.ends_with('-') {
        slug.pop();
    }
    (!slug.is_empty()).then_some(slug)
}

fn wordpress_original_image_stem(stem: &str) -> String {
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
            return normalized;
        }
    }
}

fn wordpress_attachment_search_terms(filename: &str) -> Option<Vec<String>> {
    let decoded = percent_decode_utf8_lossy(filename);
    let stem = decoded
        .rsplit_once('.')
        .map(|(stem, _)| stem)
        .unwrap_or(decoded.as_str());
    let normalized = wordpress_original_image_stem(stem);
    let tokens = normalized
        .split(|character: char| character == '-' || character == '_' || character.is_whitespace())
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    if tokens.is_empty() {
        return None;
    }

    let mut terms = Vec::new();
    for token_limit in [9_usize, 6, 3] {
        let bounded_limit = token_limit.min(tokens.len());
        if bounded_limit == 0 {
            continue;
        }
        let term = tokens[..bounded_limit].join(" ");
        if !terms.contains(&term) {
            terms.push(term);
        }
    }
    Some(terms)
}

fn normalize_wordpress_host(host: &str) -> String {
    host.trim_start_matches("www.").to_ascii_lowercase()
}

fn wordpress_remote_image_cache_key(
    source: &str,
    site_url: &str,
) -> Option<WordPressImageCacheKey> {
    wordpress_media_lookup_for_site_source(source, site_url)?;
    let (host, path) = wordpress_origin_image_identity(source)?;
    Some(WordPressImageCacheKey::wordpress_remote(format!(
        "{host}{path}"
    )))
}

/// Normalized host and decoded path for an origin URL or Jetpack Image CDN URL.
/// Query parameters such as `w=748` intentionally do not participate in identity.
fn wordpress_origin_image_identity(value: &str) -> Option<(String, String)> {
    let image = Url::parse(value).ok()?;
    if !matches!(image.scheme(), "http" | "https") {
        return None;
    }
    let host = image.host_str()?.to_ascii_lowercase();
    let decoded_path = percent_decode_utf8_lossy(image.path());
    if matches!(host.as_str(), "i0.wp.com" | "i1.wp.com" | "i2.wp.com") {
        let without_leading_slash = decoded_path.trim_start_matches('/');
        let (origin_host, origin_path) = without_leading_slash.split_once('/')?;
        if origin_host.is_empty() || origin_host.contains('@') || origin_host.contains(':') {
            return None;
        }
        return Some((
            normalize_wordpress_host(origin_host),
            format!("/{origin_path}"),
        ));
    }
    Some((normalize_wordpress_host(&host), decoded_path))
}

fn percent_decode_utf8_lossy(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let decoded_byte = str::from_utf8(&bytes[index + 1..index + 3])
                .ok()
                .and_then(|pair| u8::from_str_radix(pair, 16).ok());
            if let Some(decoded_byte) = decoded_byte {
                decoded.push(decoded_byte);
                index += 3;
                continue;
            }
        }
        decoded.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&decoded).to_string()
}

fn media_search_path(slug: &str) -> String {
    format!(
        "media?slug={}&per_page=1&_fields=id,slug,source_url,media_details",
        url::form_urlencoded::byte_serialize(slug.as_bytes()).collect::<String>()
    )
}

fn media_text_search_path(search: &str) -> String {
    format!(
        "media?search={}&per_page=100&media_type=image&_fields=id,slug,source_url,media_details",
        url::form_urlencoded::byte_serialize(search.as_bytes()).collect::<String>()
    )
}

const WORDPRESS_MEDIA_VALIDATION_BATCH_SIZE: usize = 100;

fn media_include_paths(attachment_ids: impl IntoIterator<Item = u64>) -> Vec<String> {
    let mut attachment_ids = attachment_ids.into_iter().collect::<Vec<_>>();
    attachment_ids.sort_unstable();
    attachment_ids.dedup();
    attachment_ids
        .chunks(WORDPRESS_MEDIA_VALIDATION_BATCH_SIZE)
        .map(|chunk| {
            let include = chunk
                .iter()
                .map(u64::to_string)
                .collect::<Vec<_>>()
                .join(",");
            format!(
                "media?include={include}&per_page={}&media_type=image&_fields=id,source_url,media_details",
                chunk.len()
            )
        })
        .collect()
}

fn fetch_current_media_by_ids(
    site: &WordPressSite,
    client: &Client,
    attachment_ids: impl IntoIterator<Item = u64>,
) -> Result<HashMap<u64, UploadedWordPressImage>, String> {
    let mut current = HashMap::new();
    for path in media_include_paths(attachment_ids) {
        let response = site.get_json(client, &path)?;
        for item in response.as_array().into_iter().flatten() {
            if let Some(media) = uploaded_wordpress_image_from_media_item(item) {
                if let Some(attachment_id) = media.attachment_id {
                    current.insert(attachment_id, media);
                }
            }
        }
    }
    Ok(current)
}

#[derive(Debug)]
struct CachedMediaReconciliation {
    validated: HashMap<WordPressImageCacheKey, UploadedWordPressImage>,
    stale_keys: Vec<WordPressImageCacheKey>,
}

fn reconcile_cached_media_candidates(
    candidates: Vec<(WordPressImageCacheKey, CachedWordPressImage)>,
    current_media: &HashMap<u64, UploadedWordPressImage>,
) -> CachedMediaReconciliation {
    let mut validated = HashMap::new();
    let mut stale_keys = Vec::new();
    for (cache_key, cached) in candidates {
        if let Some(current) = current_media.get(&cached.attachment_id) {
            validated.insert(cache_key, current.clone());
        } else {
            stale_keys.push(cache_key);
        }
    }
    CachedMediaReconciliation {
        validated,
        stale_keys,
    }
}

fn fetch_and_reconcile_cached_media(
    candidates: Vec<(WordPressImageCacheKey, CachedWordPressImage)>,
    fetch_current: impl FnOnce(HashSet<u64>) -> Result<HashMap<u64, UploadedWordPressImage>, String>,
) -> Result<CachedMediaReconciliation, String> {
    let attachment_ids = candidates
        .iter()
        .map(|(_, cached)| cached.attachment_id)
        .collect::<HashSet<_>>();
    let current_media = fetch_current(attachment_ids)?;
    Ok(reconcile_cached_media_candidates(
        candidates,
        &current_media,
    ))
}

fn validated_image_or_else(
    refresh: bool,
    cache_key: Option<&WordPressImageCacheKey>,
    validated_images: &HashMap<WordPressImageCacheKey, UploadedWordPressImage>,
    resolve: impl FnOnce() -> Result<Option<UploadedWordPressImage>, String>,
) -> Result<Option<UploadedWordPressImage>, String> {
    if !refresh {
        if let Some(validated) = cache_key.and_then(|key| validated_images.get(key)) {
            return Ok(Some(validated.clone()));
        }
    }
    resolve()
}

fn resolve_remote_image_with_cache(
    refresh: bool,
    cache_key: Option<&WordPressImageCacheKey>,
    validated_images: &HashMap<WordPressImageCacheKey, UploadedWordPressImage>,
    image_cache: &mut WordPressImageCacheSession,
    resolve: impl FnOnce() -> Result<Option<UploadedWordPressImage>, String>,
) -> Result<Option<UploadedWordPressImage>, String> {
    let validated_cache_hit =
        !refresh && cache_key.is_some_and(|key| validated_images.contains_key(key));
    let media = validated_image_or_else(refresh, cache_key, validated_images, resolve)?;
    if let Some(cache_key) = cache_key {
        if let Some(media) = media.as_ref() {
            if !validated_cache_hit {
                cache_uploaded_wordpress_image(image_cache, cache_key.clone(), media);
            }
        } else {
            image_cache.remove(cache_key);
        }
    }
    Ok(media)
}

fn find_site_media_by_source(
    site: &WordPressSite,
    client: &Client,
    lookup: &WordPressMediaLookup,
    source: &str,
) -> Result<Option<UploadedWordPressImage>, String> {
    let exact_response = site.get_json(client, &media_search_path(&lookup.slug))?;
    if let Some(media) = media_from_response_matching_source(&exact_response, source) {
        return Ok(Some(media));
    }

    for search_term in &lookup.search_terms {
        let response = site.get_json(client, &media_text_search_path(search_term))?;
        if let Some(media) = media_from_response_matching_source(&response, source) {
            return Ok(Some(media));
        }
    }
    Ok(None)
}

fn media_from_response_matching_source(
    response: &serde_json::Value,
    source: &str,
) -> Option<UploadedWordPressImage> {
    response
        .as_array()?
        .iter()
        .find(|item| wordpress_media_item_matches_source(item, source))
        .and_then(uploaded_wordpress_image_from_media_item)
}

fn wordpress_media_item_matches_source(item: &serde_json::Value, source: &str) -> bool {
    let Some(source_identity) = wordpress_origin_image_identity(source) else {
        return false;
    };
    let original_matches = item
        .get("source_url")
        .and_then(|value| value.as_str())
        .and_then(wordpress_origin_image_identity)
        .is_some_and(|identity| identity == source_identity);
    if original_matches {
        return true;
    }
    item.pointer("/media_details/sizes")
        .and_then(|value| value.as_object())
        .into_iter()
        .flat_map(|sizes| sizes.values())
        .filter_map(|size| size.get("source_url").and_then(|value| value.as_str()))
        .filter_map(wordpress_origin_image_identity)
        .any(|identity| identity == source_identity)
}

/// Looks up a media item previously uploaded under `slug` and returns its public URL
/// and dimensions so the export can reuse it. `None` means no such copy exists yet.
fn find_uploaded_media_by_slug(
    site: &WordPressSite,
    client: &Client,
    slug: &str,
) -> Result<Option<UploadedWordPressImage>, String> {
    let response = site.get_json(client, &media_search_path(slug))?;
    Ok(media_from_search_result(&response, slug))
}

/// Picks the media item whose slug matches `slug` exactly out of a media search
/// response, mapping it to the reusable image. Defensive against the endpoint
/// returning near-matches: only an exact slug with a non-empty URL counts.
fn media_from_search_result(
    response: &serde_json::Value,
    slug: &str,
) -> Option<UploadedWordPressImage> {
    response.as_array()?.iter().find_map(|item| {
        if item.get("slug").and_then(|value| value.as_str()) != Some(slug) {
            return None;
        }
        uploaded_wordpress_image_from_media_item(item)
    })
}

fn uploaded_wordpress_image_from_media_item(
    item: &serde_json::Value,
) -> Option<UploadedWordPressImage> {
    let source_url = item
        .get("source_url")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    Some(UploadedWordPressImage {
        attachment_id: Some(item.get("id").and_then(|value| value.as_u64())?),
        source_url: source_url.to_string(),
        natural_width: item
            .pointer("/media_details/width")
            .and_then(|value| value.as_u64()),
        natural_height: item
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

    fn test_connection() -> WordPressConnection {
        WordPressConnection::wordpress_com(
            "token".to_string(),
            "12345".to_string(),
            "https://gnosisvn.org".to_string(),
            String::new(),
        )
    }

    #[test]
    fn wordpress_editor_link_targets_the_wordpress_com_editor() {
        assert_eq!(
            wordpress_editor_link(&test_connection(), 678).as_deref(),
            Some("https://wordpress.com/post/12345/678")
        );
    }

    #[test]
    fn wordpress_post_search_path_uses_text_search_for_plain_text() {
        let path = wordpress_post_search_path("hello world", &test_connection());

        assert!(path.contains("&search=hello+world"));
        assert!(path.contains("&orderby=relevance"));
        assert!(!path.contains("&orderby=modified"));
        assert!(!path.contains("&slug="));
        assert!(!path.contains("&include="));
    }

    #[test]
    fn wordpress_post_search_path_lowercases_unicode_text_search() {
        let path = wordpress_post_search_path("CHƯƠNG 2 – CON NGƯỜI", &test_connection());

        assert!(path.contains("&search=ch%C6%B0%C6%A1ng+2+%E2%80%93+con+ng%C6%B0%E1%BB%9Di"));
        assert!(!path.contains("CH%C6%AF%C6%A0NG"));
    }

    #[test]
    fn wordpress_post_search_path_uses_slug_for_connected_permalink() {
        let path = wordpress_post_search_path(
            "https://www.gnosisvn.org/2015/03/06/hn/",
            &test_connection(),
        );

        assert!(path.contains("&slug=hn"));
        assert!(path.contains("&orderby=modified&order=desc"));
        assert!(!path.contains("&search="));
        assert!(!path.contains("&include="));
    }

    #[test]
    fn wordpress_post_search_path_lists_recent_posts_without_a_query() {
        let path = wordpress_post_search_path("  ", &test_connection());

        assert!(path.contains("&orderby=modified&order=desc"));
        assert!(!path.contains("&orderby=relevance"));
    }

    #[test]
    fn wordpress_post_search_path_decodes_permalink_slug_before_query_encoding() {
        let path = wordpress_post_search_path(
            "https://gnosisvn.org/2015/03/06/chuong%203/",
            &test_connection(),
        );

        assert!(path.contains("&slug=chuong+3"));
        assert!(!path.contains("chuong%25203"));
    }

    #[test]
    fn wordpress_post_search_path_uses_id_for_post_query_urls() {
        let connection = test_connection();

        assert!(
            wordpress_post_search_path("https://gnosisvn.org/?p=24994", &connection)
                .contains("&include=24994")
        );
        assert!(wordpress_post_search_path(
            "https://gnosisvn.org/wp-admin/post.php?post=24995&action=edit",
            &connection,
        )
        .contains("&include=24995"));
    }

    #[test]
    fn wordpress_post_search_path_uses_id_for_wordpress_com_editor_urls() {
        let path = wordpress_post_search_path(
            "https://wordpress.com/post/12345/24994",
            &test_connection(),
        );

        assert!(path.contains("&include=24994"));
        assert!(!path.contains("&search="));
    }

    #[test]
    fn wordpress_post_search_path_keeps_unrelated_urls_as_text_search() {
        let path =
            wordpress_post_search_path("https://example.com/2015/03/06/hn/", &test_connection());

        assert!(path.contains("&search=https%3A%2F%2Fexample.com%2F2015%2F03%2F06%2Fhn%2F"));
        assert!(!path.contains("&slug=hn"));
    }

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
            300,
            (1500, 3000),
            None,
        );
        assert_eq!(
            resized,
            concat!(
                "<!-- wp:image {\"width\":\"300px\",\"aspectRatio\":\"1500/3000\"} -->\n",
                "<figure class=\"wp-block-image is-resized\">",
                "<img src=\"https://example.com/tall.png?a=1&amp;b=2\" alt=\"\" style=\"aspect-ratio:1500/3000;width:300px\"/></figure>\n",
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
                300,
                (1500, 3000),
                None,
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
        // Taller than the cap: scaled down to 750px high.
        assert_eq!(wordpress_display_size(2000, 3000), Some((500, 750)));
        assert_eq!(wordpress_display_size(1200, 2400), Some((375, 750)));
        // Already fits: no display size, the block stays unsized.
        assert_eq!(wordpress_display_size(1000, 750), None);
        assert_eq!(wordpress_display_size(4000, 749), None);
        // Degenerate dimensions are left alone.
        assert_eq!(wordpress_display_size(0, 9000), None);
    }

    #[test]
    fn wordpress_media_lookup_recognizes_site_jetpack_and_files_cdn_urls() {
        let blog_url = "https://gnosisvn.org";
        assert_eq!(
            wordpress_media_lookup_for_site_source(
                "https://gnosisvn.org/wp-content/uploads/2026/08/Hubert_van_Eyck_004.webp",
                blog_url,
            )
            .map(|lookup| lookup.slug),
            Some("hubert_van_eyck_004".to_string()),
        );
        assert_eq!(
            wordpress_media_lookup_for_site_source(
                "https://i0.wp.com/gnosisvn.org/wp-content/uploads/2026/08/Hubert_van_Eyck_004.webp?w=748&ssl=1",
                blog_url,
            )
            .map(|lookup| lookup.slug),
            Some("hubert_van_eyck_004".to_string()),
        );
        assert_eq!(
            wordpress_media_lookup_for_site_source(
                "https://gnosisvnweb.files.wordpress.com/2026/08/Temple-scaled-1024x768.webp",
                blog_url,
            )
            .map(|lookup| lookup.slug),
            Some("temple".to_string()),
        );
        assert!(wordpress_media_lookup_for_site_source(
            "https://example.com/wp-content/uploads/2026/08/Hubert_van_Eyck_004.webp",
            blog_url,
        )
        .is_none());
    }

    #[test]
    fn wordpress_remote_cache_key_normalizes_origin_photon_and_query_variants() {
        let site_url = "https://gnosisvn.org";
        let origin = wordpress_remote_image_cache_key(
            "https://www.gnosisvn.org/wp-content/uploads/2026/08/painting.webp?version=1",
            site_url,
        );
        let photon = wordpress_remote_image_cache_key(
            "https://i2.wp.com/gnosisvn.org/wp-content/uploads/2026/08/painting.webp?w=748&ssl=1",
            site_url,
        );
        let other_query = wordpress_remote_image_cache_key(
            "https://gnosisvn.org/wp-content/uploads/2026/08/painting.webp?version=2",
            site_url,
        );

        assert_eq!(origin, photon);
        assert_eq!(origin, other_query);
        assert!(origin.is_some());
        assert!(wordpress_remote_image_cache_key(
            "https://example.com/wp-content/uploads/2026/08/painting.webp",
            site_url,
        )
        .is_none());
    }

    #[test]
    fn wordpress_media_lookup_builds_bounded_filename_search_fallbacks() {
        let lookup = wordpress_media_lookup_for_site_source(
            "https://gnosisvn.org/wp-content/uploads/2026/08/one-two-three-four-five-six-seven-eight-nine-ten.webp",
            "https://gnosisvn.org",
        )
        .expect("same-site upload URL is searchable");

        assert_eq!(lookup.search_terms.len(), 3);
        assert_eq!(
            lookup.search_terms[0],
            "one two three four five six seven eight nine"
        );
        assert_eq!(lookup.search_terms[1], "one two three four five six");
        assert_eq!(lookup.search_terms[2], "one two three");
    }

    #[test]
    fn wordpress_media_match_accepts_origin_photon_and_registered_size_urls() {
        let item = serde_json::json!({
            "source_url": "https://gnosisvn.org/wp-content/uploads/2026/08/painting.webp",
            "media_details": {
                "sizes": {
                    "large": {
                        "source_url": "https://i0.wp.com/gnosisvn.org/wp-content/uploads/2026/08/painting.webp?fit=1024%2C768&ssl=1"
                    }
                }
            }
        });
        assert!(wordpress_media_item_matches_source(
            &item,
            "https://i0.wp.com/gnosisvn.org/wp-content/uploads/2026/08/painting.webp?w=748&ssl=1",
        ));
        assert!(!wordpress_media_item_matches_source(
            &item,
            "https://gnosisvn.org/wp-content/uploads/2026/08/other.webp",
        ));
    }

    #[test]
    fn attachment_aware_resize_emits_id_and_responsive_image_class() {
        let content = concat!(
            "<!-- wp:image {\"align\":\"center\"} -->\n",
            "<figure class=\"wp-block-image aligncenter\"><img src=\"https://gnosisvn.org/wp-content/uploads/painting.webp\" alt=\"\"/></figure>\n",
            "<!-- /wp:image -->",
        );
        let media = UploadedWordPressImage {
            attachment_id: Some(25275),
            source_url: "https://gnosisvn.org/wp-content/uploads/painting.webp".to_string(),
            natural_width: Some(3840),
            natural_height: Some(2160),
        };

        let rewritten = apply_uploaded_image_to_content(
            content,
            "https://gnosisvn.org/wp-content/uploads/painting.webp",
            &media,
        );

        assert!(rewritten.contains(
            "<!-- wp:image {\"id\":25275,\"align\":\"center\",\"width\":\"1333px\",\"aspectRatio\":\"3840/2160\"} -->"
        ));
        assert!(rewritten.contains("class=\"wp-image-25275\""));
        assert!(rewritten.contains("style=\"aspect-ratio:3840/2160;width:1333px\""));
    }

    #[test]
    fn fitting_attachment_still_emits_id_and_responsive_image_class() {
        let content = concat!(
            "<!-- wp:image -->\n",
            "<figure class=\"wp-block-image\"><img src=\"images/wide.png\" alt=\"\" /></figure>\n",
            "<!-- /wp:image -->",
        );
        let media = UploadedWordPressImage {
            attachment_id: Some(42),
            source_url: "https://gnosisvn.org/wp-content/uploads/wide.png".to_string(),
            natural_width: Some(2000),
            natural_height: Some(500),
        };

        let rewritten = apply_uploaded_image_to_content(content, "images/wide.png", &media);

        assert!(rewritten.contains("<!-- wp:image {\"id\":42} -->"));
        assert!(rewritten.contains("class=\"wp-image-42\""));
        assert!(rewritten.contains("src=\"https://gnosisvn.org/wp-content/uploads/wide.png\""));
    }

    #[test]
    fn apply_uploaded_image_resizes_tall_images_with_block_editor_markup() {
        // Canonical serializer markup: no space before the img tag's `/>`.
        let content = concat!(
            "<!-- wp:image {\"align\":\"center\"} -->\n",
            "<figure class=\"wp-block-image aligncenter\"><img src=\"images/tall.png\" alt=\"\"/>",
            "<figcaption class=\"wp-element-caption\"><em>Caption</em></figcaption></figure>\n",
            "<!-- /wp:image -->",
        );
        let uploaded = UploadedWordPressImage {
            attachment_id: None,
            source_url: "https://files.example/tall.png".to_string(),
            natural_width: Some(1500),
            natural_height: Some(3000),
        };

        let rewritten = apply_uploaded_image_to_content(content, "images/tall.png", &uploaded);

        assert_eq!(
            rewritten,
            concat!(
                "<!-- wp:image {\"align\":\"center\",\"width\":\"375px\",\"aspectRatio\":\"1500/3000\"} -->\n",
                "<figure class=\"wp-block-image aligncenter is-resized\">",
                "<img src=\"https://files.example/tall.png\" alt=\"\" style=\"aspect-ratio:1500/3000;width:375px\"/>",
                "<figcaption class=\"wp-element-caption\"><em>Caption</em></figcaption></figure>\n",
                "<!-- /wp:image -->",
            ),
        );
    }

    #[test]
    fn apply_uploaded_image_still_resizes_legacy_uncentered_blocks() {
        let content = concat!(
            "<!-- wp:image -->\n",
            "<figure class=\"wp-block-image\"><img src=\"images/tall.png\" alt=\"\" /></figure>\n",
            "<!-- /wp:image -->",
        );
        let uploaded = UploadedWordPressImage {
            attachment_id: None,
            source_url: "https://files.example/tall.png".to_string(),
            natural_width: Some(1500),
            natural_height: Some(3000),
        };

        let rewritten = apply_uploaded_image_to_content(content, "images/tall.png", &uploaded);

        assert_eq!(
            rewritten,
            concat!(
                "<!-- wp:image {\"width\":\"375px\",\"aspectRatio\":\"1500/3000\"} -->\n",
                "<figure class=\"wp-block-image is-resized\">",
                "<img src=\"https://files.example/tall.png\" alt=\"\" style=\"aspect-ratio:1500/3000;width:375px\"/></figure>\n",
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
            attachment_id: None,
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
            attachment_id: None,
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
            attachment_id: None,
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
    fn content_addressed_slug_is_stable_per_content_and_slug_safe() {
        let png = b"\x89PNG\r\n\x1a\nfake-body";
        let hash = image_content_hash(png);
        let slug = content_addressed_media_slug_from_hash(&hash);
        // Deterministic: identical bytes always produce the same slug (so a later
        // export finds the same media item instead of uploading a duplicate).
        assert_eq!(hash.len(), 64);
        assert_eq!(slug, content_addressed_media_slug_from_hash(&hash));
        // Different bytes produce a different slug.
        assert_ne!(
            slug,
            content_addressed_media_slug_from_hash(&image_content_hash(b"other bytes"))
        );
        // Slug-safe: only lowercase hex and hyphens, so WordPress keeps it verbatim.
        assert!(slug.starts_with("gnosis-tms-"));
        assert!(slug
            .trim_start_matches("gnosis-tms-")
            .chars()
            .all(|character| character.is_ascii_hexdigit() && !character.is_ascii_uppercase()));
    }

    #[test]
    fn repo_image_preparation_streams_the_hash_and_detects_later_changes() {
        let repo_path = std::env::temp_dir().join(format!(
            "gnosis-wordpress-streamed-image-{}",
            uuid::Uuid::now_v7()
        ));
        std::fs::create_dir_all(&repo_path).unwrap();
        let image_path = repo_path.join("image.png");
        let original = b"\x89PNG\r\n\x1a\noriginal-body";
        std::fs::write(&image_path, original).unwrap();

        let prepared = prepare_repo_image(&repo_path, "image.png").unwrap();
        assert_eq!(prepared.content_hash, image_content_hash(original));
        assert_eq!(prepared.file_len, original.len() as u64);
        assert_eq!(prepared.mime_type, "image/png");
        assert!(ensure_prepared_repo_image_unchanged(&prepared, "image.png").is_ok());

        let changed = b"\x89PNG\r\n\x1a\nchanged!-body";
        assert_eq!(changed.len(), original.len());
        std::fs::write(&image_path, changed).unwrap();
        assert!(read_prepared_repo_image_bytes(&prepared, "image.png")
            .unwrap_err()
            .contains("changed while preparing"));

        let _ = std::fs::remove_file(image_path);
        let _ = std::fs::remove_dir(repo_path);
    }

    #[test]
    fn media_file_extension_maps_supported_mime_types() {
        assert_eq!(media_file_extension("image/jpeg"), "jpg");
        assert_eq!(media_file_extension("image/png"), "png");
        assert_eq!(media_file_extension("image/gif"), "gif");
        assert_eq!(media_file_extension("image/webp"), "webp");
    }

    #[test]
    fn media_search_path_filters_by_slug() {
        let path = media_search_path("gnosis-tms-abc123");
        assert!(path.starts_with("media?slug=gnosis-tms-abc123"));
        assert!(path.contains("_fields=id,slug,source_url,media_details"));
        assert!(path.contains("per_page=1"));
    }

    #[test]
    fn media_text_search_path_is_bounded_and_requests_attachment_fields() {
        let path = media_text_search_path("Hubert van Eyck");
        assert!(path.starts_with("media?search=Hubert+van+Eyck"));
        assert!(path.contains("per_page=100"));
        assert!(path.contains("media_type=image"));
        assert!(path.contains("_fields=id,slug,source_url,media_details"));
    }

    #[test]
    fn media_include_paths_deduplicate_sort_and_chunk_attachment_ids() {
        let mut ids = (1_u64..=205).rev().collect::<Vec<_>>();
        ids.extend([1, 100, 205]);
        let paths = media_include_paths(ids);

        assert_eq!(paths.len(), 3);
        assert!(paths[0].starts_with("media?include=1,2,3,"));
        assert!(paths[0].contains(",99,100&per_page=100"));
        assert!(paths[1].starts_with("media?include=101,102,"));
        assert!(paths[1].contains(",199,200&per_page=100"));
        assert!(paths[2].starts_with("media?include=201,202,203,204,205&per_page=5"));
        assert!(paths
            .iter()
            .all(|path| path.contains("media_type=image&_fields=id,source_url,media_details")));
    }

    #[test]
    fn cached_media_reconciliation_uses_current_metadata_and_marks_missing_ids_stale() {
        let current_key = WordPressImageCacheKey::wordpress_remote("site/current.jpg");
        let deleted_key = WordPressImageCacheKey::wordpress_remote("site/deleted.jpg");
        let candidates = vec![
            (
                current_key.clone(),
                CachedWordPressImage {
                    attachment_id: 10,
                    source_url: "https://site/old.jpg".to_string(),
                    natural_width: Some(800),
                    natural_height: Some(600),
                },
            ),
            (
                deleted_key.clone(),
                CachedWordPressImage {
                    attachment_id: 20,
                    source_url: "https://site/deleted.jpg".to_string(),
                    natural_width: Some(1000),
                    natural_height: Some(1000),
                },
            ),
        ];
        let current = UploadedWordPressImage {
            attachment_id: Some(10),
            source_url: "https://site/cropped.jpg".to_string(),
            natural_width: Some(600),
            natural_height: Some(900),
        };
        let current_media = HashMap::from([(10, current.clone())]);

        let reconciliation = reconcile_cached_media_candidates(candidates, &current_media);

        assert_eq!(reconciliation.validated.get(&current_key), Some(&current));
        assert_eq!(reconciliation.stale_keys, vec![deleted_key]);
    }

    #[test]
    fn batch_validation_failure_falls_back_and_reseeds_a_replacement_attachment() {
        use std::cell::Cell;

        let key = WordPressImageCacheKey::wordpress_remote("site/replaced.jpg");
        let candidates = vec![(
            key.clone(),
            CachedWordPressImage {
                attachment_id: 10,
                source_url: "https://site/old.jpg".to_string(),
                natural_width: Some(800),
                natural_height: Some(600),
            },
        )];
        let requested_ids = Cell::new(0);
        let validation = fetch_and_reconcile_cached_media(candidates, |ids| {
            requested_ids.set(ids.len());
            Err("batch unavailable".to_string())
        });
        assert_eq!(validation.unwrap_err(), "batch unavailable");
        assert_eq!(requested_ids.get(), 1);

        let replacement = UploadedWordPressImage {
            attachment_id: Some(11),
            source_url: "https://site/replacement.jpg".to_string(),
            natural_width: Some(900),
            natural_height: Some(900),
        };
        let lookup_calls = Cell::new(0);
        let mut cache = WordPressImageCacheSession::unavailable("site-a");
        let resolved =
            resolve_remote_image_with_cache(false, Some(&key), &HashMap::new(), &mut cache, || {
                lookup_calls.set(lookup_calls.get() + 1);
                Ok(Some(replacement.clone()))
            })
            .unwrap();

        assert_eq!(resolved, Some(replacement));
        assert_eq!(lookup_calls.get(), 1);
        assert_eq!(cache.get(&key).map(|image| image.attachment_id), Some(11));
    }

    #[test]
    fn partial_batch_response_repairs_only_the_missing_attachment() {
        let current_key = WordPressImageCacheKey::wordpress_remote("site/current.jpg");
        let missing_key = WordPressImageCacheKey::wordpress_remote("site/missing.jpg");
        let candidates = vec![
            (
                current_key.clone(),
                CachedWordPressImage {
                    attachment_id: 10,
                    source_url: "https://site/old-current.jpg".to_string(),
                    natural_width: Some(800),
                    natural_height: Some(600),
                },
            ),
            (
                missing_key.clone(),
                CachedWordPressImage {
                    attachment_id: 20,
                    source_url: "https://site/missing.jpg".to_string(),
                    natural_width: Some(800),
                    natural_height: Some(600),
                },
            ),
        ];
        let current = UploadedWordPressImage {
            attachment_id: Some(10),
            source_url: "https://site/current.jpg".to_string(),
            natural_width: Some(600),
            natural_height: Some(900),
        };

        let reconciliation = fetch_and_reconcile_cached_media(candidates, |ids| {
            assert_eq!(ids, HashSet::from([10, 20]));
            Ok(HashMap::from([(10, current.clone())]))
        })
        .unwrap();

        assert_eq!(reconciliation.validated.get(&current_key), Some(&current));
        assert_eq!(reconciliation.stale_keys, vec![missing_key]);
    }

    #[test]
    fn validated_hit_skips_lookup_while_refresh_invokes_it() {
        use std::cell::Cell;

        let key = WordPressImageCacheKey::wordpress_remote("site/image.jpg");
        let validated = UploadedWordPressImage {
            attachment_id: Some(10),
            source_url: "https://site/current.jpg".to_string(),
            natural_width: Some(1200),
            natural_height: Some(800),
        };
        let validated_images = HashMap::from([(key.clone(), validated.clone())]);
        let lookup_calls = Cell::new(0);
        let mut cache = WordPressImageCacheSession::unavailable("site-a");

        let warm = resolve_remote_image_with_cache(
            false,
            Some(&key),
            &validated_images,
            &mut cache,
            || {
                lookup_calls.set(lookup_calls.get() + 1);
                Ok(None)
            },
        )
        .unwrap();
        assert_eq!(warm, Some(validated));
        assert_eq!(lookup_calls.get(), 0);

        let refreshed = UploadedWordPressImage {
            attachment_id: Some(11),
            source_url: "https://site/refreshed.jpg".to_string(),
            natural_width: Some(900),
            natural_height: Some(900),
        };
        let result = resolve_remote_image_with_cache(
            true,
            Some(&key),
            &validated_images,
            &mut cache,
            || {
                lookup_calls.set(lookup_calls.get() + 1);
                Ok(Some(refreshed.clone()))
            },
        )
        .unwrap();
        assert_eq!(result, Some(refreshed));
        assert_eq!(lookup_calls.get(), 1);
        assert_eq!(cache.get(&key).map(|image| image.attachment_id), Some(11));
    }

    #[test]
    fn media_url_match_recovers_attachment_with_an_edited_slug() {
        let source = "https://gnosisvn.org/wp-content/uploads/2026/08/Hubert_van_Eyck_004.webp";
        let response = serde_json::json!([
            {
                "id": 25275,
                "slug": "an-editor-renamed-this-attachment",
                "source_url": source,
                "media_details": { "width": 3840, "height": 2160 }
            },
            {
                "id": 99,
                "slug": "nearby-search-result",
                "source_url": "https://gnosisvn.org/wp-content/uploads/2026/08/other.webp"
            }
        ]);

        let matched = media_from_response_matching_source(&response, source)
            .expect("URL verification recovers a renamed attachment");
        assert_eq!(matched.attachment_id, Some(25275));
        assert_eq!(matched.natural_width, Some(3840));
        assert_eq!(matched.natural_height, Some(2160));
    }

    #[test]
    fn media_from_search_result_reuses_the_exact_slug_match() {
        let response = serde_json::json!([
            {
                "id": 42,
                "slug": "gnosis-tms-abc123",
                "source_url": "https://files.example/gnosis-tms-abc123.png",
                "media_details": { "width": 1500, "height": 3000 }
            }
        ]);
        let reused = media_from_search_result(&response, "gnosis-tms-abc123")
            .expect("an exact slug match is reused");
        assert_eq!(
            reused.source_url,
            "https://files.example/gnosis-tms-abc123.png"
        );
        assert_eq!(reused.natural_width, Some(1500));
        assert_eq!(reused.natural_height, Some(3000));
        assert_eq!(reused.attachment_id, Some(42));
    }

    #[test]
    fn media_from_search_result_ignores_non_matching_or_empty_results() {
        // A different slug (e.g. a "-1" collision suffix from an older duplicate) is
        // not reused — that would point at the wrong image.
        let mismatch = serde_json::json!([
            { "id": 43, "slug": "gnosis-tms-abc123-1", "source_url": "https://files.example/other.png" }
        ]);
        assert!(media_from_search_result(&mismatch, "gnosis-tms-abc123").is_none());

        // No results, or a match without a usable URL, means "upload it".
        assert!(media_from_search_result(&serde_json::json!([]), "gnosis-tms-abc123").is_none());
        let blank_url = serde_json::json!([
            { "id": 42, "slug": "gnosis-tms-abc123", "source_url": "  " }
        ]);
        assert!(media_from_search_result(&blank_url, "gnosis-tms-abc123").is_none());
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

    #[test]
    fn wordpress_com_lookup_url_has_one_separator_before_the_site() {
        assert_eq!(
            wordpress_com_site_lookup_url("gnosisvn.org")
                .unwrap()
                .as_str(),
            "https://public-api.wordpress.com/rest/v1.1/sites/gnosisvn.org"
        );
    }
}
