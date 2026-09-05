use std::{
    cmp::Ordering,
    collections::HashSet,
    sync::{
        atomic::{AtomicBool, Ordering as AtomicOrdering},
        Mutex,
    },
    time::Duration,
};

use reqwest::blocking::Client as BlockingClient;
use reqwest::header::{ACCEPT as REQWEST_ACCEPT, USER_AGENT as REQWEST_USER_AGENT};
use serde::Deserialize;
use tauri::{AppHandle, Emitter, State};
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
const DEVELOPMENT_UPDATE_INSTALL_ERROR: &str = "Automatic updates are unavailable in development builds. Merge or rebase this branch onto current main, then restart the development app.";
const MAX_UPDATE_DOWNLOAD_ATTEMPTS: usize = 2;
const UPDATE_DOWNLOAD_RETRY_DELAY: Duration = Duration::from_millis(500);
const APP_UPDATE_DOWNLOAD_PROGRESS_EVENT: &str = "app-update-download-progress";

pub(crate) struct PendingUpdate(pub(crate) Mutex<Option<Update>>);

#[derive(Default)]
pub(crate) struct UpdateInstallation {
    busy: AtomicBool,
    downloaded: Mutex<Option<(Update, Vec<u8>)>>,
}

struct UpdateOperation<'a>(&'a AtomicBool);

impl<'a> UpdateOperation<'a> {
    fn acquire(busy: &'a AtomicBool) -> Result<Self, String> {
        busy.compare_exchange(false, true, AtomicOrdering::AcqRel, AtomicOrdering::Acquire)
            .map_err(|_| "An update operation is already running.".to_string())?;
        Ok(Self(busy))
    }
}

impl Drop for UpdateOperation<'_> {
    fn drop(&mut self) {
        self.0.store(false, AtomicOrdering::Release);
    }
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateDownloadProgress {
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    percentage: Option<u8>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateMetadata {
    available: bool,
    version: Option<String>,
    current_version: String,
    body: Option<String>,
    message: Option<String>,
}

#[allow(clippy::large_enum_variant)]
enum ResolvedUpdate {
    Available(Update),
    Unavailable { message: Option<String> },
}

#[derive(Debug, PartialEq, Eq)]
enum PendingUpdateDecision {
    UsePending,
    ResolveUpdate,
}

#[derive(Debug, PartialEq, Eq)]
enum DownloadFailureClass {
    Transient,
    Permanent,
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

fn is_retryable_download_status(status: u16) -> bool {
    matches!(status, 408 | 429 | 500 | 502 | 503 | 504)
}

fn network_error_status(message: &str) -> Option<u16> {
    message
        .strip_prefix("Download request failed with status:")?
        .split_whitespace()
        .next()?
        .parse()
        .ok()
}

fn classify_download_failure(error: &UpdaterError) -> DownloadFailureClass {
    match error {
        UpdaterError::Reqwest(error)
            if error.is_connect()
                || error.is_timeout()
                || error.is_body()
                || error.is_request()
                || error
                    .status()
                    .is_some_and(|status| is_retryable_download_status(status.as_u16())) =>
        {
            DownloadFailureClass::Transient
        }
        UpdaterError::Network(message)
            if network_error_status(message).is_some_and(is_retryable_download_status) =>
        {
            DownloadFailureClass::Transient
        }
        _ => DownloadFailureClass::Permanent,
    }
}

fn should_retry_download(error: &UpdaterError, failed_attempt: usize) -> bool {
    failed_attempt < MAX_UPDATE_DOWNLOAD_ATTEMPTS
        && classify_download_failure(error) == DownloadFailureClass::Transient
}

fn download_percentage(downloaded_bytes: u64, total_bytes: Option<u64>) -> Option<u8> {
    total_bytes
        .filter(|total| *total > 0)
        .map(|total| ((u128::from(downloaded_bytes.min(total)) * 100) / u128::from(total)) as u8)
}

fn emit_update_download_progress(app: &AppHandle, downloaded_bytes: u64, total_bytes: Option<u64>) {
    let _ = app.emit(
        APP_UPDATE_DOWNLOAD_PROGRESS_EVENT,
        UpdateDownloadProgress {
            downloaded_bytes,
            total_bytes,
            percentage: download_percentage(downloaded_bytes, total_bytes),
        },
    );
}

async fn download_update_with_retry(app: &AppHandle, update: &Update) -> Result<Vec<u8>, String> {
    let mut first_error = None;

    for attempt in 1..=MAX_UPDATE_DOWNLOAD_ATTEMPTS {
        emit_update_download_progress(app, 0, None);
        let progress_app = app.clone();
        let mut downloaded_bytes = 0_u64;
        let mut last_emitted_percentage = None;
        match update
            .download(
                move |chunk_length, total_bytes| {
                    downloaded_bytes = downloaded_bytes.saturating_add(chunk_length as u64);
                    let percentage = download_percentage(downloaded_bytes, total_bytes);
                    if percentage != last_emitted_percentage {
                        emit_update_download_progress(&progress_app, downloaded_bytes, total_bytes);
                        last_emitted_percentage = percentage;
                    }
                },
                || {},
            )
            .await
        {
            Ok(bytes) => {
                let byte_count = bytes.len() as u64;
                emit_update_download_progress(app, byte_count, Some(byte_count));
                return Ok(bytes);
            }
            Err(error) if should_retry_download(&error, attempt) => {
                first_error = Some(error.to_string());
                tokio::time::sleep(UPDATE_DOWNLOAD_RETRY_DELAY).await;
            }
            Err(error) => {
                return if let Some(first_error) = first_error {
                    Err(format!(
                        "Could not download and verify Gnosis TMS {} after {attempt} attempts. The retry failed: {error}. First attempt: {first_error}",
                        update.version
                    ))
                } else {
                    Err(format!(
                        "Could not download and verify Gnosis TMS {}: {error}",
                        update.version
                    ))
                };
            }
        }
    }

    Err(format!(
        "Could not download and verify Gnosis TMS {}.",
        update.version
    ))
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

fn required_platform_wait_message(required_version: &str) -> String {
    let platform = match std::env::consts::OS {
        "windows" => "Windows",
        "macos" => "macOS",
        "linux" => "Linux",
        _ => "this platform",
    };
    format!(
        "Gnosis TMS {required_version} is required, but it is not available for {platform} yet."
    )
}

fn required_platform_lookup_failed_message(required_version: &str) -> String {
    let platform = match std::env::consts::OS {
        "windows" => "Windows",
        "macos" => "macOS",
        "linux" => "Linux",
        _ => "this platform",
    };
    format!(
        "Gnosis TMS {required_version} is required, but compatible {platform} releases could not be checked."
    )
}

fn normalize_requested_version(requested_version: Option<String>) -> Option<String> {
    requested_version.and_then(|version| {
        let trimmed = version.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(
                trimmed
                    .trim_start_matches('v')
                    .trim_start_matches('V')
                    .to_string(),
            )
        }
    })
}

fn parse_stable_version_parts(version: &str) -> Option<Vec<u64>> {
    let normalized = version
        .trim()
        .trim_start_matches('v')
        .trim_start_matches('V')
        .split(['-', '+'])
        .next()
        .unwrap_or("")
        .trim();
    if normalized.is_empty() {
        return None;
    }

    normalized
        .split('.')
        .map(|part| {
            if part.is_empty() {
                return None;
            }
            part.parse::<u64>().ok()
        })
        .collect()
}

fn compare_stable_versions(left: &str, right: &str) -> Option<Ordering> {
    let left_parts = parse_stable_version_parts(left)?;
    let right_parts = parse_stable_version_parts(right)?;
    let max_len = left_parts.len().max(right_parts.len());

    for index in 0..max_len {
        let left_part = left_parts.get(index).copied().unwrap_or(0);
        let right_part = right_parts.get(index).copied().unwrap_or(0);
        match left_part.cmp(&right_part) {
            Ordering::Equal => continue,
            ordering => return Some(ordering),
        }
    }

    Some(Ordering::Equal)
}

fn version_satisfies_requested(version: &str, requested_version: Option<&str>) -> bool {
    let Some(requested_version) = requested_version else {
        return true;
    };
    match compare_stable_versions(version, requested_version) {
        Some(Ordering::Greater | Ordering::Equal) => true,
        Some(Ordering::Less) => false,
        None => version.trim() == requested_version.trim(),
    }
}

fn release_tag_candidates_for_version(version: &str) -> Vec<String> {
    let trimmed = version.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }
    let without_prefix = trimmed.trim_start_matches('v').trim_start_matches('V');
    let with_prefix = format!("v{without_prefix}");
    let mut candidates = vec![with_prefix, without_prefix.to_string()];
    candidates.dedup();
    candidates
}

fn pending_update_decision(
    pending_update_version: Option<&str>,
    requested_version: Option<&str>,
) -> PendingUpdateDecision {
    match pending_update_version {
        Some(version) if version_satisfies_requested(version, requested_version) => {
            PendingUpdateDecision::UsePending
        }
        _ => PendingUpdateDecision::ResolveUpdate,
    }
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

async fn resolve_requested_compatible_update(
    app: &AppHandle,
    requested_version: &str,
) -> Result<ResolvedUpdate, String> {
    let mut seen_endpoints = HashSet::new();

    for tag_name in release_tag_candidates_for_version(requested_version) {
        let endpoint = match github_release_latest_json_url(&tag_name) {
            Ok(endpoint) => endpoint,
            Err(_error) => continue,
        };
        if !seen_endpoints.insert(endpoint.to_string()) {
            continue;
        }

        match check_update_at_endpoint(app, endpoint).await {
            Ok(Some(update))
                if version_satisfies_requested(&update.version, Some(requested_version)) =>
            {
                return Ok(ResolvedUpdate::Available(update))
            }
            Ok(Some(_)) | Ok(None) => {}
            Err(EndpointCheckError::Updater(error)) if should_skip_fallback_endpoint(&error) => {}
            Err(error) => return Err(format!("Could not check for updates: {error}")),
        }
    }

    let latest_endpoint = Url::parse(GITHUB_LATEST_JSON_URL)
        .map_err(|error| format!("Could not parse the updater URL: {error}"))?;
    if seen_endpoints.insert(latest_endpoint.to_string()) {
        match check_update_at_endpoint(app, latest_endpoint).await {
            Ok(Some(update))
                if version_satisfies_requested(&update.version, Some(requested_version)) =>
            {
                return Ok(ResolvedUpdate::Available(update))
            }
            Ok(Some(_)) | Ok(None) => {}
            Err(EndpointCheckError::Updater(error)) if is_platform_missing_update_error(&error) => {
            }
            Err(error) => return Err(format!("Could not check for updates: {error}")),
        }
    }

    let fallback_tags = match fetch_github_release_tags().await {
        Ok(tags) => tags,
        Err(_error) => {
            return Ok(ResolvedUpdate::Unavailable {
                message: Some(required_platform_lookup_failed_message(requested_version)),
            })
        }
    };

    for tag_name in fallback_tags {
        if !version_satisfies_requested(&tag_name, Some(requested_version)) {
            continue;
        }
        let endpoint = match github_release_latest_json_url(&tag_name) {
            Ok(endpoint) => endpoint,
            Err(_error) => continue,
        };
        if !seen_endpoints.insert(endpoint.to_string()) {
            continue;
        }

        match check_update_at_endpoint(app, endpoint).await {
            Ok(Some(update))
                if version_satisfies_requested(&update.version, Some(requested_version)) =>
            {
                return Ok(ResolvedUpdate::Available(update))
            }
            Ok(Some(_)) | Ok(None) => {}
            Err(EndpointCheckError::Updater(error)) if should_skip_fallback_endpoint(&error) => {}
            Err(error) => return Err(format!("Could not check for updates: {error}")),
        }
    }

    Ok(ResolvedUpdate::Unavailable {
        message: Some(required_platform_wait_message(requested_version)),
    })
}

async fn resolve_install_update(
    app: &AppHandle,
    requested_version: Option<&str>,
) -> Result<ResolvedUpdate, String> {
    if let Some(requested_version) = requested_version {
        resolve_requested_compatible_update(app, requested_version).await
    } else {
        resolve_latest_compatible_update(app).await
    }
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
pub(crate) async fn download_app_update(
    app: AppHandle,
    pending_update: State<'_, PendingUpdate>,
    installation: State<'_, UpdateInstallation>,
    requested_version: Option<String>,
) -> Result<(), String> {
    if !updates_enabled() {
        return Err(DEVELOPMENT_UPDATE_INSTALL_ERROR.to_string());
    }

    let _operation = UpdateOperation::acquire(&installation.busy)?;

    let requested_version = normalize_requested_version(requested_version);
    let requested_version_ref = requested_version.as_deref();
    let pending_update = pending_update
        .0
        .lock()
        .map_err(|_| "Could not access the pending update.".to_string())?
        .take();

    let update = if let Some(update) = pending_update {
        if pending_update_decision(Some(&update.version), requested_version_ref)
            == PendingUpdateDecision::UsePending
        {
            update
        } else {
            match resolve_install_update(&app, requested_version_ref).await? {
                ResolvedUpdate::Available(update) => update,
                ResolvedUpdate::Unavailable { message } => {
                    return Err(message.unwrap_or_else(|| {
                        requested_version_ref
                            .map(required_platform_wait_message)
                            .unwrap_or_else(|| {
                                "No compatible update is available yet for this platform."
                                    .to_string()
                            })
                    }))
                }
            }
        }
    } else {
        match resolve_install_update(&app, requested_version_ref).await? {
            ResolvedUpdate::Available(update) => update,
            ResolvedUpdate::Unavailable { message } => {
                return Err(message.unwrap_or_else(|| {
                    requested_version_ref
                        .map(required_platform_wait_message)
                        .unwrap_or_else(|| {
                            "No compatible update is available yet for this platform.".to_string()
                        })
                }))
            }
        }
    };

    let bytes = download_update_with_retry(&app, &update).await?;
    *installation
        .downloaded
        .lock()
        .map_err(|_| "Could not store the downloaded update.".to_string())? = Some((update, bytes));
    Ok(())
}

// Called only after the user confirms restart and the frontend has flushed and
// checked durable writes. Windows installation itself may terminate the app.
#[tauri::command]
pub(crate) async fn install_app_update(
    app: AppHandle,
    installation: State<'_, UpdateInstallation>,
    requested_version: Option<String>,
) -> Result<(), String> {
    if !updates_enabled() {
        return Err(DEVELOPMENT_UPDATE_INSTALL_ERROR.to_string());
    }
    let _operation = UpdateOperation::acquire(&installation.busy)?;
    let staged = {
        let mut downloaded = installation
            .downloaded
            .lock()
            .map_err(|_| "Could not access the downloaded update.".to_string())?;
        if let Some((update, _)) = downloaded.as_ref() {
            if !version_satisfies_requested(&update.version, requested_version.as_deref()) {
                *downloaded = None;
                return Err(
                    "APP_UPDATE_DOWNLOAD_REQUIRED:A newer update is required. Download it before restarting.".to_string(),
                );
            }
        }
        downloaded
            .take()
            .ok_or("APP_UPDATE_DOWNLOAD_REQUIRED:Download the update before installing it.")?
    };
    let (staged, result) = tauri::async_runtime::spawn_blocking(move || {
        let result = staged.0.install(&staged.1).map_err(|error| {
            format!(
                "Gnosis TMS {} could not be installed: {error}",
                staged.0.version
            )
        });
        (staged, result)
    })
    .await
    .map_err(|error| format!("Could not run the installer: {error}"))?;
    if let Err(error) = result {
        *installation
            .downloaded
            .lock()
            .map_err(|_| "Could not retain the downloaded update.".to_string())? = Some(staged);
        return Err(error);
    }

    app.request_restart();
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn update_operation_rejects_overlap_and_releases_on_failure() {
        let busy = std::sync::atomic::AtomicBool::new(false);
        let first = super::UpdateOperation::acquire(&busy).unwrap();
        assert!(super::UpdateOperation::acquire(&busy).is_err());
        drop(first);
        assert!(super::UpdateOperation::acquire(&busy).is_ok());
    }

    use super::{
        classify_download_failure, compare_stable_versions, download_percentage,
        github_release_latest_json_url, network_error_status, parse_github_release_tags,
        pending_update_decision, platform_wait_and_lookup_failed_message, platform_wait_message,
        release_tag_candidates_for_version, should_retry_download, version_satisfies_requested,
        DownloadFailureClass, PendingUpdateDecision, DEVELOPMENT_UPDATE_INSTALL_ERROR,
    };
    use std::cmp::Ordering;
    use tauri_plugin_updater::Error as UpdaterError;

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

    #[test]
    fn development_update_install_error_is_actionable() {
        assert!(DEVELOPMENT_UPDATE_INSTALL_ERROR.contains("development builds"));
        assert!(DEVELOPMENT_UPDATE_INSTALL_ERROR.contains("Merge or rebase"));
    }

    #[test]
    fn stable_version_compare_handles_multi_digit_segments_and_v_prefixes() {
        assert_eq!(
            compare_stable_versions("0.10.0", "0.3.1"),
            Some(Ordering::Greater)
        );
        assert_eq!(
            compare_stable_versions("v0.3.1", "0.3.1"),
            Some(Ordering::Equal)
        );
        assert_eq!(
            compare_stable_versions("0.3.0", "0.3.1"),
            Some(Ordering::Less)
        );
    }

    #[test]
    fn version_satisfies_requested_rejects_older_versions() {
        assert!(version_satisfies_requested("0.3.1", Some("0.3.0")));
        assert!(version_satisfies_requested("v0.3.1", Some("0.3.1")));
        assert!(!version_satisfies_requested("0.2.9", Some("0.3.0")));
        assert!(version_satisfies_requested("0.2.9", None));
    }

    #[test]
    fn release_tag_candidates_prefer_github_v_tags() {
        assert_eq!(
            release_tag_candidates_for_version("0.3.1"),
            vec!["v0.3.1".to_string(), "0.3.1".to_string()],
        );
        assert_eq!(
            release_tag_candidates_for_version("v0.3.1"),
            vec!["v0.3.1".to_string(), "0.3.1".to_string()],
        );
    }

    #[test]
    fn pending_update_decision_resolves_when_pending_update_is_missing_or_too_old() {
        assert_eq!(
            pending_update_decision(None, Some("0.3.1")),
            PendingUpdateDecision::ResolveUpdate,
        );
        assert_eq!(
            pending_update_decision(Some("0.3.0"), Some("0.3.1")),
            PendingUpdateDecision::ResolveUpdate,
        );
        assert_eq!(
            pending_update_decision(Some("0.3.1"), Some("0.3.1")),
            PendingUpdateDecision::UsePending,
        );
        assert_eq!(
            pending_update_decision(Some("0.3.0"), None),
            PendingUpdateDecision::UsePending,
        );
    }

    #[test]
    fn download_failure_classification_retries_only_selected_transient_statuses() {
        for status in [408, 429, 500, 502, 503, 504] {
            let error = UpdaterError::Network(format!(
                "Download request failed with status: {status} Service Unavailable"
            ));
            assert_eq!(
                classify_download_failure(&error),
                DownloadFailureClass::Transient,
                "expected status {status} to be transient"
            );
        }

        for status in [400, 401, 403, 404, 409, 422] {
            let error = UpdaterError::Network(format!(
                "Download request failed with status: {status} Client Error"
            ));
            assert_eq!(
                classify_download_failure(&error),
                DownloadFailureClass::Permanent,
                "expected status {status} to be permanent"
            );
        }
    }

    #[test]
    fn download_percentage_is_bounded_and_requires_a_total() {
        assert_eq!(download_percentage(25, Some(100)), Some(25));
        assert_eq!(download_percentage(125, Some(100)), Some(100));
        assert_eq!(download_percentage(25, Some(0)), None);
        assert_eq!(download_percentage(25, None), None);
    }

    #[test]
    fn download_failure_classification_does_not_guess_from_unstructured_network_errors() {
        let error = UpdaterError::Network("server temporarily unavailable".to_string());

        assert_eq!(network_error_status("server temporarily unavailable"), None);
        assert_eq!(
            classify_download_failure(&error),
            DownloadFailureClass::Permanent
        );
    }

    #[test]
    fn download_failure_classification_does_not_retry_signature_errors() {
        let error = UpdaterError::Base64(base64::DecodeError::InvalidLength(1));

        assert_eq!(
            classify_download_failure(&error),
            DownloadFailureClass::Permanent
        );
        assert!(!should_retry_download(&error, 1));
    }

    #[test]
    fn download_retry_policy_allows_exactly_one_retry() {
        let transient = UpdaterError::Network(
            "Download request failed with status: 503 Service Unavailable".to_string(),
        );
        let permanent =
            UpdaterError::Network("Download request failed with status: 404 Not Found".to_string());

        assert!(should_retry_download(&transient, 1));
        assert!(!should_retry_download(&transient, 2));
        assert!(!should_retry_download(&permanent, 1));
    }
}
