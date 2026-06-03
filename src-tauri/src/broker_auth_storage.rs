use std::{fs, path::PathBuf};

use tauri::{AppHandle, Manager};

use crate::broker_auth::{BrokerSession, BrokerSessionProfile};

const BROKER_AUTH_SESSION_FILE: &str = "broker-auth-session.json";
const KEYRING_SERVICE: &str = "gnosis-tms";
const KEYRING_ACCOUNT: &str = "broker-session-token";

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

/// Write only the display-field profile to the JSON file (never the token).
fn write_profile_json(session_path: &PathBuf, profile: &BrokerSessionProfile) -> Result<(), String> {
    let contents = serde_json::to_string(profile)
        .map_err(|e| format!("Could not encode the broker session profile: {e}"))?;
    atomic_write(session_path, &contents)
}

/// Store the session token in the OS credential store.
fn save_token_to_keychain(token: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|e| format!("Could not open keychain entry: {e}"))?;
    entry
        .set_secret(token.as_bytes())
        .map_err(|e| format!("Could not store broker session token in keychain: {e}"))?;
    Ok(())
}

/// Load the session token from the OS credential store.
/// Returns `None` when the entry is simply absent (no token stored yet / already deleted).
fn load_token_from_keychain() -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|e| format!("Could not open keychain entry: {e}"))?;
    match entry.get_secret() {
        Ok(bytes) => {
            let token = String::from_utf8(bytes)
                .map_err(|e| format!("Broker session token in keychain is not valid UTF-8: {e}"))?;
            Ok(Some(token))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Could not read broker session token from keychain: {e}")),
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Internal-only function that returns the full `BrokerSession` including the
/// bearer token.  NOT exposed as a Tauri command.
pub(crate) fn load_broker_auth_session_internal(
    app: &AppHandle,
) -> Result<Option<BrokerSession>, String> {
    let session_path = auth_session_path(app)?;
    if !session_path.exists() {
        return Ok(None);
    }

    let contents = fs::read_to_string(&session_path)
        .map_err(|e| format!("Could not read the saved broker session: {e}"))?;

    // --- Migration path: try the old plaintext schema first ---
    // Old JSON included `session_token`; new JSON only has the display fields.
    // We use the presence of a parseable `BrokerSession` as the discriminator
    // because the old schema has the required `session_token` field.
    if let Ok(old_session) = serde_json::from_str::<BrokerSession>(&contents) {
        // Found an old-format file; migrate it to the new split layout.
        let profile = BrokerSessionProfile {
            login: old_session.login.clone(),
            name: old_session.name.clone(),
            avatar_url: old_session.avatar_url.clone(),
        };
        // Best-effort migration: write token to keychain and rewrite profile JSON.
        // If either step fails, proceed with the in-memory session rather than
        // blocking the user — the next launch will reattempt.
        let _ = save_token_to_keychain(&old_session.session_token);
        let _ = write_profile_json(&session_path, &profile);
        return Ok(Some(old_session));
    }

    // --- Normal path: new-format profile JSON + keychain token ---
    let profile = serde_json::from_str::<BrokerSessionProfile>(&contents)
        .map_err(|e| format!("Could not parse the saved broker session: {e}"))?;

    let Some(token) = load_token_from_keychain()? else {
        // Profile JSON exists but keychain has no token → inconsistent state.
        // Force re-authentication rather than returning a token-less session.
        return Ok(None);
    };

    Ok(Some(BrokerSession {
        session_token: token,
        login: profile.login,
        name: profile.name,
        avatar_url: profile.avatar_url,
    }))
}

/// Tauri command — returns ONLY display fields, never the bearer token.
#[tauri::command]
pub(crate) fn get_broker_auth_profile(
    app: AppHandle,
) -> Result<Option<BrokerSessionProfile>, String> {
    Ok(load_broker_auth_session_internal(&app)?.map(|s| BrokerSessionProfile {
        login: s.login,
        name: s.name,
        avatar_url: s.avatar_url,
    }))
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

    // Store the bearer token in the OS keychain.
    save_token_to_keychain(&session.session_token)?;

    // Write only the display fields to disk.
    let profile = BrokerSessionProfile {
        login: session.login,
        name: session.name,
        avatar_url: session.avatar_url,
    };
    write_profile_json(&session_path, &profile)?;

    Ok(())
}

#[tauri::command]
pub(crate) fn clear_broker_auth_session(app: AppHandle) -> Result<(), String> {
    let session_path = auth_session_path(&app)?;
    if session_path.exists() {
        fs::remove_file(&session_path)
            .map_err(|e| format!("Could not remove the saved broker session: {e}"))?;
    }

    // Delete the keychain credential; tolerate the case where it does not exist.
    match keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT) {
        Ok(entry) => match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(e) => {
                return Err(format!(
                    "Could not remove the broker session token from keychain: {e}"
                ))
            }
        },
        Err(e) => {
            return Err(format!("Could not open keychain entry for deletion: {e}"))
        }
    }

    Ok(())
}
