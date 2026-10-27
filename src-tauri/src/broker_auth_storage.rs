use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

use tauri::{AppHandle, Manager};

use crate::broker_auth::BrokerSession;

const BROKER_AUTH_SESSION_FILE: &str = "broker-auth-session.json";
static SESSION_FILE_LOCK: Mutex<()> = Mutex::new(());

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
fn atomic_write(path: &Path, contents: &str) -> Result<(), String> {
    let tmp_path = path.with_extension("json.tmp");
    fs::write(&tmp_path, contents)
        .map_err(|_| "Could not write the saved GitHub login.".to_string())?;
    // Do not delete the old login if replacement fails (including on Windows).
    fs::rename(&tmp_path, path).map_err(|_| "Could not save the GitHub login.".to_string())?;
    Ok(())
}

fn write_session_json(session_path: &Path, session: &BrokerSession) -> Result<(), String> {
    let contents = serde_json::to_string(session)
        .map_err(|e| format!("Could not encode the broker session: {e}"))?;
    atomic_write(session_path, &contents)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

fn load_broker_auth_session_from_disk(app: &AppHandle) -> Result<Option<BrokerSession>, String> {
    let session_path = auth_session_path(app)?;
    let _guard = lock_session_file()?;
    read_session_json(&session_path)
}

fn lock_session_file() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    SESSION_FILE_LOCK
        .lock()
        .map_err(|_| "Could not access the saved GitHub login.".to_string())
}

// Called under SESSION_FILE_LOCK, including the read in a conditional save.
fn read_session_json(session_path: &Path) -> Result<Option<BrokerSession>, String> {
    let contents = match fs::read_to_string(session_path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("Could not read the saved GitHub login.".to_string()),
    };

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
    expected_session_token: Option<String>,
) -> Result<(), String> {
    let session_path = auth_session_path(&app)?;
    save_session_at(&session_path, &session, expected_session_token.as_deref())
}

fn save_session_at(
    session_path: &Path,
    session: &BrokerSession,
    expected_session_token: Option<&str>,
) -> Result<(), String> {
    let _guard = lock_session_file()?;
    if let Some(expected) = expected_session_token {
        let current = read_session_json(session_path)?;
        if !current
            .is_some_and(|saved| saved.session_token == expected && saved.login == session.login)
        {
            return Err("AUTH_SESSION_CHANGED:The saved GitHub login has changed.".to_string());
        }
    }
    let session_dir = session_path
        .parent()
        .ok_or_else(|| "Could not resolve the broker session folder.".to_string())?;

    fs::create_dir_all(session_dir)
        .map_err(|e| format!("Could not create the broker session folder: {e}"))?;

    write_session_json(session_path, session)?;

    Ok(())
}

#[tauri::command]
pub(crate) fn clear_broker_auth_session(app: AppHandle) -> Result<(), String> {
    let session_path = auth_session_path(&app)?;
    clear_session_at(&session_path)
}

fn clear_session_at(session_path: &Path) -> Result<(), String> {
    let _guard = lock_session_file()?;
    match fs::remove_file(session_path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("Could not remove the saved GitHub login.".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            Self(std::env::temp_dir().join(format!(
                "gnosis-auth-test-{}",
                crate::util::random_token(16)
            )))
        }
        fn path(&self) -> PathBuf {
            self.0.join(BROKER_AUTH_SESSION_FILE)
        }
        fn token(&self) -> Option<String> {
            let _guard = lock_session_file().unwrap();
            read_session_json(&self.path())
                .unwrap()
                .map(|session| session.session_token)
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn session(login: &str, token: &str) -> BrokerSession {
        BrokerSession {
            login: login.into(),
            session_token: token.into(),
            name: None,
            avatar_url: None,
        }
    }

    #[test]
    fn conditional_refresh_replaces_only_the_expected_login() {
        let fixture = Fixture::new();
        save_session_at(&fixture.path(), &session("alice", "old"), None).unwrap();
        save_session_at(&fixture.path(), &session("alice", "new"), Some("old")).unwrap();
        assert_eq!(fixture.token().as_deref(), Some("new"));
        assert!(save_session_at(&fixture.path(), &session("alice", "late"), Some("old")).is_err());
        assert_eq!(fixture.token().as_deref(), Some("new"));
    }

    #[test]
    fn late_refresh_cannot_recreate_a_deleted_login() {
        let fixture = Fixture::new();
        save_session_at(&fixture.path(), &session("alice", "old"), None).unwrap();
        clear_session_at(&fixture.path()).unwrap();
        let error =
            save_session_at(&fixture.path(), &session("alice", "late"), Some("old")).unwrap_err();
        assert!(error.starts_with("AUTH_SESSION_CHANGED:"));
        assert_eq!(fixture.token(), None);
        clear_session_at(&fixture.path()).unwrap();
    }

    #[test]
    fn late_refresh_cannot_overwrite_a_new_account() {
        let fixture = Fixture::new();
        save_session_at(&fixture.path(), &session("bob", "bob-token"), None).unwrap();
        assert!(save_session_at(&fixture.path(), &session("alice", "late"), Some("old")).is_err());
        assert!(save_session_at(
            &fixture.path(),
            &session("alice", "late"),
            Some("bob-token")
        )
        .is_err());
        assert_eq!(fixture.token().as_deref(), Some("bob-token"));
    }

    #[test]
    fn write_failure_preserves_the_saved_login() {
        let fixture = Fixture::new();
        save_session_at(&fixture.path(), &session("alice", "old"), None).unwrap();
        fs::create_dir(fixture.path().with_extension("json.tmp")).unwrap();
        assert!(save_session_at(&fixture.path(), &session("alice", "new"), Some("old")).is_err());
        assert_eq!(fixture.token().as_deref(), Some("old"));
    }

    #[test]
    fn deletion_failure_is_reported() {
        let fixture = Fixture::new();
        fs::create_dir_all(fixture.path()).unwrap();
        assert!(clear_session_at(&fixture.path()).is_err());
        assert!(fixture.path().exists());
    }

    #[test]
    fn racing_refresh_and_sign_out_always_leave_the_login_deleted() {
        let fixture = Fixture::new();
        save_session_at(&fixture.path(), &session("alice", "old"), None).unwrap();
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let other_barrier = barrier.clone();
        let path = fixture.path();
        let refresh = std::thread::spawn(move || {
            other_barrier.wait();
            save_session_at(&path, &session("alice", "new"), Some("old"))
        });
        barrier.wait();
        clear_session_at(&fixture.path()).unwrap();
        let _ = refresh.join().unwrap();
        assert_eq!(fixture.token(), None);
    }
}
