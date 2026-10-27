use sha2::{Digest, Sha256};
use tauri::AppHandle;

use crate::ai_secret_storage::{
    delete_store_value, load_store_value, save_store_value, stronghold_snapshot_path,
    with_snapshot_write_lock,
};

const LEGACY_WORDPRESS_CONNECTION_KEY: &str = "wordpress/connection";
const WORDPRESS_CONNECTIONS_KEY_PREFIX: &str = "wordpress/connections/v1";
const WORDPRESS_CONNECTION_LABEL: &str = "WordPress connections";

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WordPressConnection {
    pub(crate) site_id: String,
    pub(crate) site_url: String,
    pub(crate) display_name: String,
    #[serde(flatten)]
    pub(crate) auth: WordPressConnectionAuth,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum WordPressConnectionAuth {
    WordPressCom {
        access_token: String,
        blog_id: String,
    },
    SelfHosted {
        api_root: String,
        username: String,
        password: String,
    },
}

#[derive(Clone, Debug, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WordPressConnectionInfo {
    pub(crate) site_id: String,
    pub(crate) kind: &'static str,
    pub(crate) site_url: String,
    pub(crate) display_name: String,
    pub(crate) blog_id: Option<String>,
    pub(crate) api_root: Option<String>,
    pub(crate) username: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct WordPressConnectionCollection {
    version: u8,
    connections: Vec<WordPressConnection>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyWordPressConnection {
    access_token: String,
    blog_id: String,
    blog_url: String,
}

impl WordPressConnection {
    pub(crate) fn wordpress_com(
        access_token: String,
        blog_id: String,
        blog_url: String,
        display_name: String,
    ) -> Self {
        let blog_id = blog_id.trim().to_string();
        let site_url = blog_url.trim().trim_end_matches('/').to_string();
        let display_name = if display_name.trim().is_empty() {
            url::Url::parse(&site_url)
                .ok()
                .and_then(|url| url.host_str().map(str::to_string))
                .unwrap_or_else(|| site_url.clone())
        } else {
            display_name.trim().to_string()
        };
        Self {
            site_id: format!("wpcom:{blog_id}"),
            site_url,
            display_name,
            auth: WordPressConnectionAuth::WordPressCom {
                access_token,
                blog_id,
            },
        }
    }

    pub(crate) fn self_hosted(
        site_url: String,
        display_name: String,
        api_root: String,
        username: String,
        password: String,
    ) -> Self {
        let api_root = api_root.trim().trim_end_matches('/').to_string();
        let site_url = site_url.trim().trim_end_matches('/').to_string();
        let display_name = if display_name.trim().is_empty() {
            url::Url::parse(&site_url)
                .ok()
                .and_then(|url| url.host_str().map(str::to_string))
                .unwrap_or_else(|| site_url.clone())
        } else {
            display_name.trim().to_string()
        };
        let mut hasher = Sha256::new();
        hasher.update(api_root.to_lowercase().as_bytes());
        Self {
            site_id: format!("selfhosted:{:x}", hasher.finalize()),
            site_url,
            display_name,
            auth: WordPressConnectionAuth::SelfHosted {
                api_root,
                username: username.trim().to_string(),
                password,
            },
        }
    }

    pub(crate) fn info(&self) -> WordPressConnectionInfo {
        match &self.auth {
            WordPressConnectionAuth::WordPressCom { blog_id, .. } => WordPressConnectionInfo {
                site_id: self.site_id.clone(),
                kind: "wordpressCom",
                site_url: self.site_url.clone(),
                display_name: self.display_name.clone(),
                blog_id: Some(blog_id.clone()),
                api_root: None,
                username: None,
            },
            WordPressConnectionAuth::SelfHosted {
                api_root, username, ..
            } => WordPressConnectionInfo {
                site_id: self.site_id.clone(),
                kind: "selfHosted",
                site_url: self.site_url.clone(),
                display_name: self.display_name.clone(),
                blog_id: None,
                api_root: Some(api_root.clone()),
                username: Some(username.clone()),
            },
        }
    }

    pub(crate) fn blog_id(&self) -> Option<&str> {
        match &self.auth {
            WordPressConnectionAuth::WordPressCom { blog_id, .. } => Some(blog_id),
            WordPressConnectionAuth::SelfHosted { .. } => None,
        }
    }
}

fn collection_key(storage_login: &str) -> Result<String, String> {
    let login = storage_login.trim().to_lowercase();
    if login.is_empty() {
        return Err("Sign in to Gnosis TMS before managing WordPress sites.".to_string());
    }
    let mut hasher = Sha256::new();
    hasher.update(login.as_bytes());
    Ok(format!(
        "{WORDPRESS_CONNECTIONS_KEY_PREFIX}/{:x}",
        hasher.finalize()
    ))
}

fn load_collection_at_path(
    path: &std::path::Path,
    key: &str,
) -> Result<WordPressConnectionCollection, String> {
    let Some(raw) = load_store_value(path, key, WORDPRESS_CONNECTION_LABEL)? else {
        return Ok(WordPressConnectionCollection {
            version: 1,
            connections: Vec::new(),
        });
    };
    let mut collection: WordPressConnectionCollection = serde_json::from_str(&raw)
        .map_err(|_| "The saved WordPress connections could not be decoded.".to_string())?;
    if collection.version != 1 {
        return Err("The saved WordPress connections use an unsupported version.".to_string());
    }
    collection
        .connections
        .retain(|item| !item.site_id.trim().is_empty() && !item.site_url.trim().is_empty());
    Ok(collection)
}

fn save_collection_at_path(
    path: &std::path::Path,
    key: &str,
    collection: &WordPressConnectionCollection,
) -> Result<(), String> {
    if collection.connections.is_empty() {
        if load_store_value(path, key, WORDPRESS_CONNECTION_LABEL)?.is_none() {
            return Ok(());
        }
        return delete_store_value(path, key, WORDPRESS_CONNECTION_LABEL);
    }
    let raw = serde_json::to_string(collection)
        .map_err(|error| format!("Could not encode the WordPress connections: {error}"))?;
    save_store_value(path, key, &raw, WORDPRESS_CONNECTION_LABEL)
}

fn migrate_legacy_connection(
    path: &std::path::Path,
    key: &str,
    collection: &mut WordPressConnectionCollection,
) -> Result<(), String> {
    let Some(raw) = load_store_value(
        path,
        LEGACY_WORDPRESS_CONNECTION_KEY,
        "WordPress connection",
    )?
    else {
        return Ok(());
    };
    let legacy: LegacyWordPressConnection = serde_json::from_str(&raw)
        .map_err(|_| "The saved WordPress connection could not be decoded.".to_string())?;
    if legacy.access_token.trim().is_empty() || legacy.blog_id.trim().is_empty() {
        // Do not destroy a legacy record that could not be migrated. A later
        // app version may be able to recover it more safely.
        return Ok(());
    }
    let connection = WordPressConnection::wordpress_com(
        legacy.access_token,
        legacy.blog_id,
        legacy.blog_url,
        String::new(),
    );
    collection
        .connections
        .retain(|item| item.site_id != connection.site_id);
    collection.connections.push(connection);
    save_collection_at_path(path, key, collection)?;
    delete_store_value(
        path,
        LEGACY_WORDPRESS_CONNECTION_KEY,
        "WordPress connection",
    )
}

pub(crate) fn list_wordpress_connections(
    app: &AppHandle,
    storage_login: &str,
) -> Result<Vec<WordPressConnectionInfo>, String> {
    let path = stronghold_snapshot_path(app)?;
    let key = collection_key(storage_login)?;
    with_snapshot_write_lock(|| {
        let mut collection = load_collection_at_path(&path, &key)?;
        migrate_legacy_connection(&path, &key, &mut collection)?;
        let mut infos: Vec<_> = collection
            .connections
            .iter()
            .map(WordPressConnection::info)
            .collect();
        infos.sort_by_key(|item| {
            if item.display_name.is_empty() {
                item.site_url.to_lowercase()
            } else {
                item.display_name.to_lowercase()
            }
        });
        Ok(infos)
    })
}

pub(crate) fn load_wordpress_connection(
    app: &AppHandle,
    storage_login: &str,
    site_id: &str,
) -> Result<Option<WordPressConnection>, String> {
    let path = stronghold_snapshot_path(app)?;
    let collection = load_collection_at_path(&path, &collection_key(storage_login)?)?;
    Ok(collection
        .connections
        .into_iter()
        .find(|item| item.site_id == site_id.trim()))
}

pub(crate) fn save_wordpress_connection(
    app: &AppHandle,
    storage_login: &str,
    connection: &WordPressConnection,
) -> Result<(), String> {
    let path = stronghold_snapshot_path(app)?;
    let key = collection_key(storage_login)?;
    with_snapshot_write_lock(|| {
        let mut collection = load_collection_at_path(&path, &key)?;
        collection
            .connections
            .retain(|item| item.site_id != connection.site_id);
        collection.connections.push(connection.clone());
        save_collection_at_path(&path, &key, &collection)
    })
}

pub(crate) fn forget_wordpress_connection(
    app: &AppHandle,
    storage_login: &str,
    site_id: &str,
) -> Result<(), String> {
    let path = stronghold_snapshot_path(app)?;
    let key = collection_key(storage_login)?;
    with_snapshot_write_lock(|| {
        let mut collection = load_collection_at_path(&path, &key)?;
        collection
            .connections
            .retain(|item| item.site_id != site_id.trim());
        save_collection_at_path(&path, &key, &collection)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wordpress_com_identity_is_stable_per_blog() {
        let first = WordPressConnection::wordpress_com(
            "one".into(),
            " 123 ".into(),
            "https://example.wordpress.com/".into(),
            String::new(),
        );
        let second = WordPressConnection::wordpress_com(
            "two".into(),
            "123".into(),
            "https://custom.example".into(),
            String::new(),
        );
        assert_eq!(first.site_id, "wpcom:123");
        assert_eq!(first.site_id, second.site_id);
    }

    #[test]
    fn self_hosted_identity_uses_the_canonical_api_root() {
        let first = WordPressConnection::self_hosted(
            "https://example.com".into(),
            String::new(),
            "https://example.com/wp-json/".into(),
            "a".into(),
            "one".into(),
        );
        let second = WordPressConnection::self_hosted(
            "https://example.com".into(),
            String::new(),
            "https://example.com/wp-json".into(),
            "b".into(),
            "two".into(),
        );
        assert_eq!(first.site_id, second.site_id);
        assert!(first.site_id.starts_with("selfhosted:"));
    }

    #[test]
    fn connection_collection_keys_are_case_insensitive_and_login_scoped() {
        assert_eq!(
            collection_key(" Alice ").unwrap(),
            collection_key("alice").unwrap()
        );
        assert_ne!(
            collection_key("alice").unwrap(),
            collection_key("bob").unwrap()
        );
    }
}
