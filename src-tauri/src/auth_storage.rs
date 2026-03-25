use std::{
  fs,
  path::PathBuf,
};

use tauri::{AppHandle, Manager};

use crate::auth::GithubSession;

const AUTH_SESSION_FILE: &str = "github-auth-session.json";

#[tauri::command]
pub(crate) fn load_github_auth_session(app: AppHandle) -> Result<Option<GithubSession>, String> {
  let session_path = auth_session_path(&app)?;
  if !session_path.exists() {
    return Ok(None);
  }

  let contents = fs::read_to_string(&session_path)
    .map_err(|error| format!("Could not read the saved GitHub session: {error}"))?;
  let session = serde_json::from_str::<GithubSession>(&contents)
    .map_err(|error| format!("Could not parse the saved GitHub session: {error}"))?;

  Ok(Some(session))
}

#[tauri::command]
pub(crate) fn save_github_auth_session(
  app: AppHandle,
  session: GithubSession,
) -> Result<(), String> {
  let session_path = auth_session_path(&app)?;
  let session_dir = session_path
    .parent()
    .ok_or_else(|| "Could not resolve the GitHub session folder.".to_string())?;

  fs::create_dir_all(session_dir)
    .map_err(|error| format!("Could not create the GitHub session folder: {error}"))?;

  let contents = serde_json::to_string(&session)
    .map_err(|error| format!("Could not encode the GitHub session: {error}"))?;

  fs::write(&session_path, contents)
    .map_err(|error| format!("Could not save the GitHub session: {error}"))?;

  Ok(())
}

#[tauri::command]
pub(crate) fn clear_github_auth_session(app: AppHandle) -> Result<(), String> {
  let session_path = auth_session_path(&app)?;
  if !session_path.exists() {
    return Ok(());
  }

  fs::remove_file(&session_path)
    .map_err(|error| format!("Could not remove the saved GitHub session: {error}"))?;

  Ok(())
}

fn auth_session_path(app: &AppHandle) -> Result<PathBuf, String> {
  let app_data_dir = app
    .path()
    .app_data_dir()
    .map_err(|error| format!("Could not resolve the app data directory: {error}"))?;

  Ok(app_data_dir.join(AUTH_SESSION_FILE))
}
