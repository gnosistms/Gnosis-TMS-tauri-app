use std::{fs, path::PathBuf};

use tauri::{AppHandle, Manager};

use crate::broker_auth::BrokerSession;

const BROKER_AUTH_SESSION_FILE: &str = "broker-auth-session.json";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

fn auth_session_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve the app data directory: {error}"))?;

    Ok(app_data_dir.join(BROKER_AUTH_SESSION_FILE))
}

/// Atomically write `contents` to `path` via a sibling `.tmp` file.
fn atomic_write(path: &PathBuf, contents: &str) -> Result<(), String> {
    let tmp_path = path.with_extension("json.tmp");
    fs::write(&tmp_path, contents)
        .map_err(|e| format!("Could not write broker session: {e}"))?;
    fs::rename(&tmp_path, path)
        .map_err(|e| format!("Could not save broker session: {e}"))?;
    Ok(())
}

fn write_session_json(session_path: &PathBuf, session: &BrokerSession) -> Result<(), String> {
    let contents = serde_json::to_string(session)
        .map_err(|e| format!("Could not encode the broker session: {e}"))?;
    atomic_write(session_path, &contents)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

fn load_broker_auth_session_from_disk(app: &AppHandle) -> Result<Option<BrokerSession>, String> {
    let session_path = auth_session_path(app)?;
    if !session_path.exists() {
        return Ok(None);
    }

    let contents = fs::read_to_string(&session_path)
        .map_err(|e| format!("Could not read the saved broker session: {e}"))?;

    let session = serde_json::from_str::<BrokerSession>(&contents)
        .map_err(|e| format!("Could not parse the saved broker session: {e}"))?;

    Ok(Some(session))
}

pub(crate) fn load_broker_auth_session_internal(
    app: &AppHandle,
) -> Result<Option<BrokerSession>, String> {
    load_broker_auth_session_from_disk(app)
}

#[tauri::command]
pub(crate) fn load_broker_auth_session(app: AppHandle) -> Result<Option<BrokerSession>, String> {
    load_broker_auth_session_from_disk(&app)
}

#[tauri::command]
pub(crate) fn save_broker_auth_session(
    app: AppHandle,
    session: BrokerSession,
) -> Result<(), String> {
    let session_path = auth_session_path(&app)?;
    let session_dir = session_path
        .parent()
        .ok_or_else(|| "Could not resolve the broker session folder.".to_string())?;

    fs::create_dir_all(session_dir)
        .map_err(|e| format!("Could not create the broker session folder: {e}"))?;

    write_session_json(&session_path, &session)?;

    Ok(())
}

#[tauri::command]
pub(crate) fn clear_broker_auth_session(app: AppHandle) -> Result<(), String> {
    let session_path = auth_session_path(&app)?;
    if session_path.exists() {
        fs::remove_file(&session_path)
            .map_err(|e| format!("Could not remove the saved broker session: {e}"))?;
    }

    Ok(())
}
