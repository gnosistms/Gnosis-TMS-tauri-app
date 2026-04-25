use std::{collections::HashSet, sync::Mutex};

use reqwest::blocking::Client as BlockingClient;
use reqwest::header::{ACCEPT as REQWEST_ACCEPT, USER_AGENT as REQWEST_USER_AGENT};
use serde::Deserialize;
use tauri::{AppHandle, State};
use tauri_plugin_updater::{Error as UpdaterError, Update, UpdaterExt};
use url::Url;

const GITHUB_LATEST_JSON_URL: &str =
    "https://github.com/gnosistms/Gnosis-TMS-tauri-app/releases/latest/download/latest.json";
const GITHUB_RELEASES_API_URL: &str =
    "https://api.github.com/repos/gnosistms/Gnosis-TMS-tauri-app/releases?per_page=20";
const GITHUB_RELEASE_DOWNLOADS_BASE_URL: &str =
    "https://github.com/gnosistms/Gnosis-TMS-tauri-app/releases/download";
const GITHUB_API_USER_AGENT: &str = "gnosis-tms-updater";
const UPDATER_PUBLIC_KEY: &str = include_str!("../updater-public-key.txt");

pub(crate) struct PendingUpdate(pub(crate) Mutex<Option<Update>>);

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateMetadata {
    available: bool,
    version: Option<String>,
    current_version: String,
    body: Option<String>,
    message: Option<String>,
}

enum ResolvedUpdate {
    Available(Update),
    Unavailable { message: Option<String> },
}

#[derive(Debug)]
enum EndpointCheckError {
    Configuration(String),
    Updater(UpdaterError),
}

impl std::fmt::Display for EndpointCheckError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Configuration(message) => f.write_str(message),
            Self::Updater(error) => std::fmt::Display::fmt(error, f),
        }
    }
}

#[derive(Debug, Deserialize)]
struct GithubReleaseSummary {
    tag_name: String,
    draft: bool,
    prerelease: bool,
}

fn updates_enabled() -> bool {
    !cfg!(debug_assertions)
}

fn build_no_update_metadata(current_version: String, message: Option<String>) -> UpdateMetadata {
    UpdateMetadata {
        available: false,
        version: None,
        current_version,
        body: None,
        message,
    }
}

fn build_update_metadata(update: &Update) -> UpdateMetadata {
    UpdateMetadata {
        available: true,
        version: Some(update.version.clone()),
        current_version: update.current_version.clone(),
        body: update.body.clone(),
        message: None,
    }
}

fn is_platform_missing_update_error(error: &UpdaterError) -> bool {
    matches!(
        error,
        UpdaterError::TargetNotFound(_) | UpdaterError::TargetsNotFound(_)
    )
}

fn should_skip_fallback_endpoint(error: &UpdaterError) -> bool {
    matches!(
        error,
        UpdaterError::ReleaseNotFound
            | UpdaterError::TargetNotFound(_)
            | UpdaterError::TargetsNotFound(_)
    )
}

fn platform_wait_message() -> String {
    let platform = match std::env::consts::OS {
        "windows" => "Windows",
        "macos" => "macOS",
        "linux" => "Linux",
        _ => "this platform",
    };
    format!("A newer Gnosis TMS release exists, but it is not available for {platform} yet.")
}

fn platform_wait_and_lookup_failed_message() -> String {
    let platform = match std::env::consts::OS {
        "windows" => "Windows",
        "macos" => "macOS",
        "linux" => "Linux",
        _ => "this platform",
    };
    format!(
        "A newer Gnosis TMS release exists, but it is not available for {platform} yet, and older compatible releases could not be checked."
    )
}

fn github_release_latest_json_url(tag_name: &str) -> Result<Url, String> {
    let normalized_tag_name = tag_name.trim();
    if normalized_tag_name.is_empty() {
        return Err("Could not build a release endpoint for an empty tag.".to_string());
    }

    Url::parse(&format!(
        "{GITHUB_RELEASE_DOWNLOADS_BASE_URL}/{normalized_tag_name}/latest.json"
    ))
    .map_err(|error| format!("Could not parse the updater URL for {normalized_tag_name}: {error}"))
}

fn parse_github_release_tags(payload: &str) -> Result<Vec<String>, String> {
    let releases: Vec<GithubReleaseSummary> = serde_json::from_str(payload)
        .map_err(|error| format!("Could not parse the GitHub releases response: {error}"))?;
    let mut seen_tags = HashSet::new();
    let mut tags = Vec::new();

    for release in releases {
        if release.draft || release.prerelease {
            continue;
        }

        let tag_name = release.tag_name.trim();
        if tag_name.is_empty() || !seen_tags.insert(tag_name.to_string()) {
            continue;
        }

        tags.push(tag_name.to_string());
    }

    Ok(tags)
}

fn fetch_github_release_tags_sync() -> Result<Vec<String>, String> {
    let client = BlockingClient::builder()
        .user_agent(GITHUB_API_USER_AGENT)
        .build()
        .map_err(|error| format!("Could not initialize the GitHub releases client: {error}"))?;
    let response = client
        .get(GITHUB_RELEASES_API_URL)
        .header(REQWEST_ACCEPT, "application/vnd.github+json")
        .header(REQWEST_USER_AGENT, GITHUB_API_USER_AGENT)
        .send()
        .map_err(|error| format!("Could not load the GitHub releases list: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "GitHub releases returned an unexpected status: {}",
            response.status()
        ));
    }

    let payload = response
        .text()
        .map_err(|error| format!("Could not read the GitHub releases list: {error}"))?;
    parse_github_release_tags(&payload)
}

async fn fetch_github_release_tags() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(fetch_github_release_tags_sync)
        .await
        .map_err(|error| format!("Could not inspect previous GitHub releases: {error}"))?
}

async fn check_update_at_endpoint(
    app: &AppHandle,
    endpoint: Url,
) -> Result<Option<Update>, EndpointCheckError> {
    let updater = app
        .updater_builder()
        .pubkey(UPDATER_PUBLIC_KEY.trim())
        .endpoints(vec![endpoint])
        .map_err(|error| {
            EndpointCheckError::Configuration(format!(
                "Could not configure the updater endpoint: {error}"
            ))
        })?
        .build()
        .map_err(|error| {
            EndpointCheckError::Configuration(format!("Could not initialize the updater: {error}"))
        })?;

    updater.check().await.map_err(EndpointCheckError::Updater)
}

async fn resolve_latest_compatible_update(app: &AppHandle) -> Result<ResolvedUpdate, String> {
    let latest_endpoint = Url::parse(GITHUB_LATEST_JSON_URL)
        .map_err(|error| format!("Could not parse the updater URL: {error}"))?;

    match check_update_at_endpoint(app, latest_endpoint.clone()).await {
        Ok(Some(update)) => return Ok(ResolvedUpdate::Available(update)),
        Ok(None) => return Ok(ResolvedUpdate::Unavailable { message: None }),
        Err(EndpointCheckError::Updater(error)) if is_platform_missing_update_error(&error) => {}
        Err(error) => return Err(format!("Could not check for updates: {error}")),
    }

    let fallback_tags = match fetch_github_release_tags().await {
        Ok(tags) => tags,
        Err(_error) => {
            return Ok(ResolvedUpdate::Unavailable {
                message: Some(platform_wait_and_lookup_failed_message()),
            })
        }
    };

    let mut seen_endpoints = HashSet::from([latest_endpoint.to_string()]);
    for tag_name in fallback_tags {
        let endpoint = match github_release_latest_json_url(&tag_name) {
            Ok(endpoint) => endpoint,
            Err(_error) => continue,
        };
        if !seen_endpoints.insert(endpoint.to_string()) {
            continue;
        }

        match check_update_at_endpoint(app, endpoint).await {
            Ok(Some(update)) => return Ok(ResolvedUpdate::Available(update)),
            Ok(None) => {
                return Ok(ResolvedUpdate::Unavailable {
                    message: Some(platform_wait_message()),
                })
            }
            Err(EndpointCheckError::Updater(error)) if should_skip_fallback_endpoint(&error) => {
                continue;
            }
            Err(error) => return Err(format!("Could not check for updates: {error}")),
        }
    }

    Ok(ResolvedUpdate::Unavailable {
        message: Some(platform_wait_message()),
    })
}

#[tauri::command]
pub(crate) async fn check_for_app_update(
    app: AppHandle,
    pending_update: State<'_, PendingUpdate>,
) -> Result<UpdateMetadata, String> {
    let current_version = app.package_info().version.to_string();

    if !updates_enabled() {
        return Ok(build_no_update_metadata(current_version, None));
    }

    let (update, unavailable_message) = match resolve_latest_compatible_update(&app).await? {
        ResolvedUpdate::Available(update) => (Some(update), None),
        ResolvedUpdate::Unavailable { message } => (None, message),
    };
    let metadata = if let Some(update) = update.as_ref() {
        build_update_metadata(update)
    } else {
        build_no_update_metadata(current_version, unavailable_message)
    };
    *pending_update
        .0
        .lock()
        .map_err(|_| "Could not store the pending update.".to_string())? = update;

    Ok(metadata)
}

#[tauri::command]
pub(crate) async fn install_app_update(
    app: AppHandle,
    pending_update: State<'_, PendingUpdate>,
) -> Result<(), String> {
    if !updates_enabled() {
        return Ok(());
    }

    let Some(update) = pending_update
        .0
        .lock()
        .map_err(|_| "Could not access the pending update.".to_string())?
        .take()
    else {
        return Err("No update is ready to install.".to_string());
    };

    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|error| format!("Could not install the update: {error}"))?;

    app.request_restart();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        github_release_latest_json_url, parse_github_release_tags,
        platform_wait_and_lookup_failed_message, platform_wait_message,
    };

    #[test]
    fn parse_github_release_tags_filters_drafts_prereleases_and_duplicates() {
        let payload = r#"
        [
          { "tag_name": "v0.1.34", "draft": false, "prerelease": false },
          { "tag_name": "v0.1.34", "draft": false, "prerelease": false },
          { "tag_name": "v0.1.33", "draft": false, "prerelease": false },
          { "tag_name": "v0.1.32-rc1", "draft": false, "prerelease": true },
          { "tag_name": "v0.1.31", "draft": true, "prerelease": false },
          { "tag_name": "   ", "draft": false, "prerelease": false }
        ]
        "#;

        let tags = parse_github_release_tags(payload).expect("expected tags to parse");

        assert_eq!(tags, vec!["v0.1.34", "v0.1.33"]);
    }

    #[test]
    fn github_release_latest_json_url_builds_tag_specific_endpoint() {
        let url = github_release_latest_json_url("v0.1.34").expect("expected endpoint URL");
        assert_eq!(
            url.as_str(),
            "https://github.com/gnosistms/Gnosis-TMS-tauri-app/releases/download/v0.1.34/latest.json"
        );
    }

    #[test]
    fn platform_wait_messages_are_non_empty() {
        assert!(!platform_wait_message().trim().is_empty());
        assert!(!platform_wait_and_lookup_failed_message().trim().is_empty());
    }
}
