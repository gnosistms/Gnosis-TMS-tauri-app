use crate::{
    ai_secret_storage::with_snapshot_write_lock, broker_auth::BrokerSession, credential_vault,
};
use tauri::AppHandle;
use zeroize::Zeroizing;

pub(crate) fn load_local_author(
    app: &AppHandle,
) -> Result<Option<crate::local_author::LocalAuthor>, String> {
    credential_vault::read_local_author(&credential_vault::app_path(app)?)
}

pub(crate) fn load_broker_auth_session_internal(
    app: &AppHandle,
) -> Result<Option<BrokerSession>, String> {
    read_session(&credential_vault::app_path(app)?)
}
fn read_session(path: &std::path::Path) -> Result<Option<BrokerSession>, String> {
    credential_vault::read(path, credential_vault::SESSION_KEY)?
        .map(|raw| {
            let raw = Zeroizing::new(raw);
            serde_json::from_str(&raw)
                .map_err(|_| "The saved broker login could not be decoded.".into())
        })
        .transpose()
}
fn save_session(
    path: &std::path::Path,
    session: &BrokerSession,
    expected_session_token: Option<&str>,
) -> Result<(), String> {
    let previous = read_session(path)?;
    if let Some(expected) = expected_session_token {
        if previous.as_ref().map(|s| s.session_token.as_str()) != Some(expected) {
            return Err(
                "AUTH_REQUIRED:The signed-in account changed. Retry with the current account."
                    .into(),
            );
        }
    }
    if session.session_token.trim().is_empty() || session.login.trim().is_empty() {
        return Err("The broker login is incomplete.".into());
    }
    let changed_account = previous
        .as_ref()
        .is_some_and(|s| !s.login.eq_ignore_ascii_case(&session.login));
    if previous.as_ref().map(|s| &s.session_token) != Some(&session.session_token) {
        crate::team_ai::invalidate_session();
    }
    let raw = Zeroizing::new(
        serde_json::to_string(&session).map_err(|_| "Could not encode broker login.")?,
    );
    credential_vault::replace_session(path, Some(&raw), changed_account)
}
#[tauri::command]
pub(crate) async fn load_broker_auth_session(
    app: AppHandle,
) -> Result<Option<BrokerSession>, String> {
    tauri::async_runtime::spawn_blocking(move || load_broker_auth_session_internal(&app))
        .await
        .map_err(|_| "Could not load the saved broker login.")?
}
#[tauri::command]
pub(crate) async fn save_broker_auth_session(
    app: AppHandle,
    session: BrokerSession,
    expected_session_token: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        with_snapshot_write_lock(|| {
            save_session(
                &credential_vault::app_path(&app)?,
                &session,
                expected_session_token.as_deref(),
            )
        })
    })
    .await
    .map_err(|_| "Could not save the broker login.")?
}
#[tauri::command]
pub(crate) async fn clear_broker_auth_session(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        with_snapshot_write_lock(|| {
            crate::team_ai::invalidate_session();
            credential_vault::replace_session(&credential_vault::app_path(&app)?, None, true)
        })
    })
    .await
    .map_err(|_| "Could not clear the broker login.")?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn account_change_and_logout_clear_team_secrets_and_reject_late_refreshes() {
        let root = std::env::temp_dir().join(format!("gnosis-auth-test-{}", uuid::Uuid::now_v7()));
        let path = root.join("test.hold");
        credential_vault::test_path(&path);
        let session = |token: &str, login: &str| BrokerSession {
            session_token: token.into(),
            login: login.into(),
            name: None,
            avatar_url: None,
        };
        with_snapshot_write_lock(|| {
            save_session(&path, &session("first", "alice"), None)?;
            credential_vault::update(
                &path,
                &[
                    (
                        "team-ai/42/openai/api-key".into(),
                        Some("synthetic-team".into()),
                    ),
                    (
                        "ai-provider/openai/api-key".into(),
                        Some("synthetic-personal".into()),
                    ),
                ],
            )?;
            save_session(&path, &session("refreshed", "alice"), Some("first"))?;
            assert!(credential_vault::read(&path, "team-ai/42/openai/api-key")?.is_some());
            save_session(&path, &session("second", "bob"), None)?;
            assert!(credential_vault::read(&path, "team-ai/42/openai/api-key")?.is_none());
            assert!(credential_vault::read(&path, "ai-provider/openai/api-key")?.is_some());
            assert!(save_session(&path, &session("late", "alice"), Some("refreshed")).is_err());
            credential_vault::replace_session(&path, None, true)?;
            assert!(save_session(&path, &session("late", "bob"), Some("second")).is_err());
            assert!(read_session(&path)?.is_none());
            Ok(())
        })
        .unwrap();
        let _ = std::fs::remove_dir_all(root);
    }
}
