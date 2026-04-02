use std::sync::Mutex;

use tauri::{AppHandle, State};
use tauri_plugin_updater::{Update, UpdaterExt};
use url::Url;

const GITHUB_LATEST_JSON_URL: &str =
  "https://github.com/gnosistms/Gnosis-TMS-tauri-app/releases/latest/download/latest.json";
const UPDATER_PUBLIC_KEY: &str = include_str!("../updater-public-key.txt");

pub(crate) struct PendingUpdate(pub(crate) Mutex<Option<Update>>);

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateMetadata {
  available: bool,
  version: Option<String>,
  current_version: String,
  body: Option<String>,
}

fn updates_enabled() -> bool {
  !cfg!(debug_assertions)
}

#[tauri::command]
pub(crate) async fn check_for_app_update(
  app: AppHandle,
  pending_update: State<'_, PendingUpdate>,
) -> Result<UpdateMetadata, String> {
  let current_version = app.package_info().version.to_string();

  if !updates_enabled() {
    return Ok(UpdateMetadata {
      available: false,
      version: None,
      current_version,
      body: None,
    });
  }

  let update = app
    .updater_builder()
    .pubkey(UPDATER_PUBLIC_KEY.trim())
    .endpoints(vec![
      Url::parse(GITHUB_LATEST_JSON_URL)
        .map_err(|error| format!("Could not parse the updater URL: {error}"))?,
    ])
    .map_err(|error| format!("Could not configure the updater endpoint: {error}"))?
    .build()
    .map_err(|error| format!("Could not initialize the updater: {error}"))?
    .check()
    .await
    .map_err(|error| format!("Could not check for updates: {error}"))?;

  let metadata = update.as_ref().map(|update| UpdateMetadata {
    available: true,
    version: Some(update.version.clone()),
    current_version: update.current_version.clone(),
    body: update.body.clone(),
  });
  *pending_update.0.lock().map_err(|_| "Could not store the pending update.".to_string())? = update;

  Ok(metadata.unwrap_or(UpdateMetadata {
    available: false,
    version: None,
    current_version,
    body: None,
  }))
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
