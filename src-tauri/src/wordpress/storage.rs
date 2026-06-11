use tauri::AppHandle;

use crate::ai_secret_storage::{
    delete_store_value, load_store_value, save_store_value, stronghold_snapshot_path,
};

const WORDPRESS_CONNECTION_KEY: &str = "wordpress/connection";
const WORDPRESS_CONNECTION_LABEL: &str = "WordPress connection";

/// The stored WordPress.com connection. The access token never leaves the Rust
/// backend; the frontend only ever sees blog id/url through
/// `WordPressConnectionInfo`.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WordPressConnection {
    pub(crate) access_token: String,
    pub(crate) blog_id: String,
    pub(crate) blog_url: String,
}

#[derive(Clone, Debug, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WordPressConnectionInfo {
    pub(crate) blog_id: String,
    pub(crate) blog_url: String,
}

impl WordPressConnection {
    pub(crate) fn info(&self) -> WordPressConnectionInfo {
        WordPressConnectionInfo {
            blog_id: self.blog_id.clone(),
            blog_url: self.blog_url.clone(),
        }
    }
}

pub(crate) fn load_wordpress_connection(
    app: &AppHandle,
) -> Result<Option<WordPressConnection>, String> {
    let snapshot_path = stronghold_snapshot_path(app)?;
    let Some(raw) = load_store_value(
        &snapshot_path,
        WORDPRESS_CONNECTION_KEY,
        WORDPRESS_CONNECTION_LABEL,
    )?
    else {
        return Ok(None);
    };

    let connection: WordPressConnection = serde_json::from_str(&raw)
        .map_err(|_| "The saved WordPress connection could not be decoded.".to_string())?;
    if connection.access_token.trim().is_empty() || connection.blog_id.trim().is_empty() {
        return Ok(None);
    }
    Ok(Some(connection))
}

pub(crate) fn save_wordpress_connection(
    app: &AppHandle,
    connection: &WordPressConnection,
) -> Result<(), String> {
    let snapshot_path = stronghold_snapshot_path(app)?;
    let raw = serde_json::to_string(connection)
        .map_err(|error| format!("Could not encode the WordPress connection: {error}"))?;
    save_store_value(
        &snapshot_path,
        WORDPRESS_CONNECTION_KEY,
        &raw,
        WORDPRESS_CONNECTION_LABEL,
    )
}

pub(crate) fn clear_wordpress_connection(app: &AppHandle) -> Result<(), String> {
    let snapshot_path = stronghold_snapshot_path(app)?;
    delete_store_value(
        &snapshot_path,
        WORDPRESS_CONNECTION_KEY,
        WORDPRESS_CONNECTION_LABEL,
    )
}
